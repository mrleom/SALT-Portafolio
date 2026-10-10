import { randomUUID } from 'node:crypto';
import { validateOwnedImageKey } from './image-reference.mjs';
import { auditRecord, changeTimestamp } from './lifecycle.mjs';
import {
  HttpError, STATUSES, authorize, canReadAllAssets, hasGroup, patchFieldsFor,
} from './auth.mjs';

const MAX = Object.freeze({
  tag: 64, text: 200, description: 2000, note: 1000,
});
const CREATE_FIELDS = Object.freeze([
  'assetTag', 'category', 'description', 'manufacturer', 'model', 'serialNumber',
  'purchaseDate', 'purchaseValue', 'salvageValue', 'usefulLifeYears', 'depreciationMethod',
  'assignedUserId', 'assignedEmail', 'department', 'building', 'room', 'condition', 'status',
  'lastCleaningDate', 'lastMaintenanceDate', 'nextMaintenanceDate', 'expectedReplacementDate',
  'photoKey', 'aiReviewStatus',
]);

function requireStore(store) {
  if (!store) throw new HttpError(503, 'Asset storage is not configured');
  return store;
}

function parseBody(event) {
  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { throw new HttpError(400, 'Request body must be JSON'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Request body must be an object');
  return body;
}

function text(value, name, max) {
  if (typeof value !== 'string') throw new HttpError(400, `${name} must be a string`);
  const trimmed = value.trim();
  if (!trimmed) throw new HttpError(400, `${name} is required`);
  if (trimmed.length > max) throw new HttpError(400, `${name} is too long`);
  return trimmed;
}

function optionalText(value, name, max) {
  if (value === undefined || value === null || value === '') return '';
  return text(value, name, max);
}

function money(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    throw new HttpError(400, `${name} must be a non-negative number`);
  return Math.round(value * 100) / 100;
}

function years(value) {
  if (!Number.isInteger(value) || value < 1 || value > 80)
    throw new HttpError(400, 'usefulLifeYears must be an integer from 1 to 80');
  return value;
}

function isoDate(value, name) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new HttpError(400, `${name} must be YYYY-MM-DD`);
  const epoch = Date.parse(value + 'T00:00:00Z');
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString().slice(0, 10) !== value) throw new HttpError(400, `${name} is not a valid date`);
  return value;
}

function optionalDate(value, name) {
  if (value === undefined || value === null || value === '') return '';
  return isoDate(value, name);
}

function rejectUnknown(body, allowed) {
  const extra = Object.keys(body).filter(key => !allowed.includes(key));
  if (extra.length) throw new HttpError(400, 'Unknown property: ' + extra[0]);
}

export function computeDepreciation(asset, now = new Date()) {
  const purchase = Number(asset.purchaseValue);
  const salvage = Number(asset.salvageValue);
  const life = Number(asset.usefulLifeYears);
  if (![purchase, salvage, life].every(Number.isFinite) || life <= 0 || !asset.purchaseDate) {
    return { annualDepreciation: null, accumulatedDepreciation: null, currentBookValue: null, usefulLifeConsumed: null };
  }
  const annual = (purchase - salvage) / life;
  const start = Date.parse(asset.purchaseDate + 'T00:00:00Z');
  const elapsedYears = Math.max(0, (now.getTime() - start) / (365.25 * 24 * 3600 * 1000));
  const accumulated = Math.min(Math.max(0, annual * elapsedYears), Math.max(0, purchase - salvage));
  const book = Math.max(salvage, purchase - accumulated);
  return {
    annualDepreciation: Math.round(annual * 100) / 100,
    accumulatedDepreciation: Math.round(accumulated * 100) / 100,
    currentBookValue: Math.round(book * 100) / 100,
    usefulLifeConsumed: Math.round(Math.min(100, (elapsedYears / life) * 100) * 10) / 10,
  };
}

export function normalizeDepartment(value) { return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase(); }

function keysFor(asset) {
  return {
    PK: `ASSET#${asset.assetId}`,
    SK: 'METADATA',
    GSI1PK: `TAG#${asset.assetTag.toLowerCase()}`,
    GSI1SK: `ASSET#${asset.assetId}`,
    GSI2PK: `USER#${asset.assignedUserId}`,
    GSI2SK: `ASSET#${asset.assetId}`,
    GSI3PK: `DEPT#${asset.department}`,
    GSI3SK: `ASSET#${asset.assetId}`,
  };
}

export function toPublic(item, now = new Date()) {
  const { PK, SK, GSI1PK, GSI1SK, GSI2PK, GSI2SK, GSI3PK, GSI3SK, ...rest } = item;
  let replacement = rest.expectedReplacementDate;
  if (!replacement && rest.purchaseDate && rest.usefulLifeYears) {
    const date = new Date(rest.purchaseDate + 'T00:00:00Z');
    const month = date.getUTCMonth();
    date.setUTCFullYear(date.getUTCFullYear() + rest.usefulLifeYears);
    if (date.getUTCMonth() !== month) date.setUTCDate(0);
    replacement = date.toISOString().slice(0, 10);
  }
  return { ...rest, expectedReplacementDate: replacement || '', ...computeDepreciation(rest, now) };
}

function validateAssetFields(body, { partial = false } = {}) {
  const required = [
    'assetTag', 'category', 'description', 'manufacturer', 'model', 'serialNumber',
    'purchaseDate', 'purchaseValue', 'salvageValue', 'usefulLifeYears', 'assignedUserId',
    'assignedEmail', 'department', 'building', 'room', 'condition', 'status',
  ];
  if (!partial) for (const name of required) if (body[name] === undefined) throw new HttpError(400, `${name} is required`);
  const out = {};
  const set = (name, fn) => { if (body[name] !== undefined) out[name] = fn(); };
  set('assetTag', () => text(body.assetTag, 'assetTag', MAX.tag).toUpperCase());
  set('category', () => text(body.category, 'category', MAX.text));
  set('description', () => text(body.description, 'description', MAX.description));
  set('manufacturer', () => optionalText(body.manufacturer, 'manufacturer', MAX.text));
  set('model', () => optionalText(body.model, 'model', MAX.text));
  set('serialNumber', () => optionalText(body.serialNumber, 'serialNumber', MAX.text));
  set('purchaseDate', () => isoDate(body.purchaseDate, 'purchaseDate'));
  set('purchaseValue', () => money(body.purchaseValue, 'purchaseValue'));
  set('salvageValue', () => money(body.salvageValue, 'salvageValue'));
  set('usefulLifeYears', () => years(body.usefulLifeYears));
  set('depreciationMethod', () => {
    const method = text(body.depreciationMethod || 'straight-line', 'depreciationMethod', MAX.text);
    if (method !== 'straight-line') throw new HttpError(400, 'depreciationMethod must be straight-line');
    return method;
  });
  set('assignedUserId', () => optionalText(body.assignedUserId, 'assignedUserId', MAX.text));
  set('assignedEmail', () => optionalText(body.assignedEmail, 'assignedEmail', MAX.text));
  set('department', () => text(body.department, 'department', MAX.text));
  set('building', () => text(body.building, 'building', MAX.text));
  set('room', () => text(body.room, 'room', MAX.text));
  set('condition', () => text(body.condition, 'condition', MAX.text));
  set('status', () => {
    const status = text(body.status, 'status', MAX.text);
    if (!STATUSES.includes(status)) throw new HttpError(400, 'status is not a recognized value');
    return status;
  });
  set('problemNote', () => optionalText(body.problemNote, 'problemNote', MAX.note));
  set('lastCleaningDate', () => optionalDate(body.lastCleaningDate, 'lastCleaningDate'));
  set('lastMaintenanceDate', () => optionalDate(body.lastMaintenanceDate, 'lastMaintenanceDate'));
  set('nextMaintenanceDate', () => optionalDate(body.nextMaintenanceDate, 'nextMaintenanceDate'));
  set('expectedReplacementDate', () => optionalDate(body.expectedReplacementDate, 'expectedReplacementDate'));
  set('aiReviewStatus', () => {
    if (!['ManualEntry', 'UserConfirmed', 'UserCorrected', 'UserRejected'].includes(body.aiReviewStatus)) throw new HttpError(400, 'A final user review status is required');
    return body.aiReviewStatus;
  });
  set('photoKey', () => {
    const v = body.photoKey;
    // Allow clearing the photo key with null, or setting a valid asset-photos path
    if (v === null || v === '') return null;
    if (typeof v !== 'string' || v.length > 512 ||
        !/^asset-photos\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.(jpe?g|png)$/i.test(v)) {
      throw new HttpError(400, 'photoKey must be a valid asset-photos path or null');
    }
    return v;
  });
  if (out.purchaseValue !== undefined && out.salvageValue !== undefined && out.salvageValue > out.purchaseValue)
    throw new HttpError(400, 'salvageValue cannot exceed purchaseValue');
  return out;
}

export function canSeeAsset(identity, asset, profile) {
  if (canReadAllAssets(identity)) return true;
  if (hasGroup(identity, 'Manager') && profile?.department && normalizeDepartment(asset.department) === normalizeDepartment(profile.department)) return true;
  if (hasGroup(identity, 'Employee') && asset.assignedUserId === identity.subject) return true;
  return false;
}

function matchesSearch(asset, query) {
  const q = (query.q || '').trim().toLowerCase();
  if (query.tag && asset.assetTag.toLowerCase() !== query.tag.trim().toLowerCase()) return false;
  if (query.status && asset.status !== query.status) return false;
  if (query.category && asset.category.toLowerCase() !== query.category.trim().toLowerCase()) return false;
  if (!q) return true;
  return [asset.assetTag, asset.category, asset.description, asset.manufacturer, asset.model, asset.serialNumber]
    .some(value => String(value).toLowerCase().includes(q));
}

async function visibleAssets(store, identity, profile, query = {}) {
  let items;
  if (query.tag) {
    const found = await store.getByTag(query.tag.trim().toUpperCase());
    items = found ? [found] : [];
  } else if (canReadAllAssets(identity)) items = await store.scanAssets();
  else if (hasGroup(identity, 'Manager')) {
    if (!profile?.department) return [];
    // Normalize at the authorization boundary, including records created before this change.
    items = (await store.scanAssets()).filter(asset => normalizeDepartment(asset.department) === normalizeDepartment(profile.department));
  } else items = await store.listByUser(identity.subject);
  return items.filter(asset => canSeeAsset(identity, asset, profile) && matchesSearch(asset, query));
}

export async function createAsset(event, identity, store) {
  authorize(identity, 'assets:create');
  const body = parseBody(event);
  rejectUnknown(body, CREATE_FIELDS);
  const fields = validateAssetFields({ depreciationMethod: 'straight-line', ...body });
  if (fields.photoKey) {
    validateOwnedImageKey(fields.photoKey, identity.subject);
    if (!fields.aiReviewStatus) throw new HttpError(400, 'Confirm review before saving an uploaded photo');
  }
  if (await store.getByTag(fields.assetTag)) throw new HttpError(409, 'Asset tag already exists');
  const now = new Date().toISOString();
  const asset = {
    assetId: randomUUID(),
    depreciationMethod: 'straight-line',
    photoKey: null,
    aiReviewStatus: 'ManualEntry',
    problemNote: '',
    lastCleaningDate: '',
    lastMaintenanceDate: '',
    nextMaintenanceDate: '',
    expectedReplacementDate: '',
    ...fields,
    createdAt: now,
    updatedAt: now,
  };
  await store.commitAsset({ ...asset, ...keysFor(asset) }, [auditRecord(identity, null, asset, 'AssetCreated')], null);
  return toPublic(asset);
}

export async function listAssets(event, identity, store) {
  authorize(identity, 'assets:read');
  const profile = await store.getProfile(identity.subject);
  const query = event.queryStringParameters || {};
  const items = await visibleAssets(store, identity, profile, query);
  return { assets: items.map(item => toPublic(item)) };
}

export async function getAsset(event, identity, store) {
  authorize(identity, 'assets:read');
  const id = event.pathParameters?.id;
  if (!id) throw new HttpError(400, 'Asset id is required');
  const item = await store.getAsset(id);
  if (!item) throw new HttpError(404, 'Asset not found');
  const profile = await store.getProfile(identity.subject);
  if (!canSeeAsset(identity, item, profile)) throw new HttpError(403, 'Your group does not have permission');
  return toPublic(item);
}

export async function patchAsset(event, identity, store) {
  authorize(identity, 'assets:update');
  const id = event.pathParameters?.id;
  if (!id) throw new HttpError(400, 'Asset id is required');
  const existing = await store.getAsset(id);
  if (!existing) throw new HttpError(404, 'Asset not found');
  const profile = await store.getProfile(identity.subject);
  if (!canSeeAsset(identity, existing, profile)) throw new HttpError(403, 'Your group does not have permission');
  if (hasGroup(identity, 'Employee') && !hasGroup(identity, 'Technician') && !hasGroup(identity, 'Administrator')
      && existing.assignedUserId !== identity.subject)
    throw new HttpError(403, 'Your group does not have permission');
  const allowed = patchFieldsFor(identity);
  if (!allowed.length) throw new HttpError(403, 'Your group does not have permission');
  const body = parseBody(event);
  rejectUnknown(body, allowed);
  if (!Object.keys(body).length) throw new HttpError(400, 'No updatable fields were provided');
  const updates = validateAssetFields(body, { partial: true });
  if (updates.photoKey) validateOwnedImageKey(updates.photoKey, identity.subject);
  if (updates.photoKey !== undefined && updates.aiReviewStatus === undefined) updates.aiReviewStatus = 'ManualEntry';
  if (updates.assetTag && updates.assetTag !== existing.assetTag) {
    const clash = await store.getByTag(updates.assetTag);
    if (clash && clash.assetId !== existing.assetId) throw new HttpError(409, 'Asset tag already exists');
  }
  const merged = { ...existing, ...updates, updatedAt: changeTimestamp(existing) };
  if (merged.salvageValue > merged.purchaseValue) throw new HttpError(400, 'salvageValue cannot exceed purchaseValue');
  await store.commitAsset({ ...merged, ...keysFor(merged) }, [auditRecord(identity, existing, merged, 'AssetUpdated')], existing.updatedAt, existing.assetTag);
  return toPublic(merged);
}

export async function handleAssetRoute(event, identity, store) {
  const route = `${event.httpMethod} ${event.resource}`;
  const isAsset = route === 'POST /assets' || route === 'GET /assets'
    || route === 'GET /assets/{id}' || route === 'PATCH /assets/{id}';
  if (!isAsset) return null;
  const assetsStore = requireStore(store);
  if (route === 'POST /assets') return { statusCode: 201, body: await createAsset(event, identity, assetsStore) };
  if (route === 'GET /assets') return { statusCode: 200, body: await listAssets(event, identity, assetsStore) };
  if (route === 'GET /assets/{id}') return { statusCode: 200, body: await getAsset(event, identity, assetsStore) };
  return { statusCode: 200, body: await patchAsset(event, identity, assetsStore) };
}
