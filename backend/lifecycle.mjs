import { randomUUID } from 'node:crypto';
import { authorize, hasGroup, HttpError } from './auth.mjs';
import { canSeeAsset, normalizeDepartment, toPublic } from './assets.mjs';
import { addDays } from './maintenance-dates.mjs';

export function readBody(event, allowed) {
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { throw new HttpError(400, 'Request body must be JSON'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Request body must be an object');
  if (Object.keys(body).some(k => !allowed.includes(k))) throw new HttpError(400, 'Unknown request property');
  return body;
}
export function shortText(value, name, max = 1000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))
    throw new HttpError(400, `${name} must be nonempty text of at most ${max} characters`);
  return value.trim();
}
export function validDate(value) {
  try { addDays(value, 1); } catch { throw new HttpError(400, 'Date must be a valid YYYY-MM-DD calendar date'); }
  if (!value) throw new HttpError(400, 'Date is required');
  return value;
}
export function changeTimestamp(asset) {
  return new Date(Math.max(Date.now(), (Date.parse(asset?.updatedAt) || 0) + 1)).toISOString();
}
function publicRecord(record) { const { PK, SK, ...rest } = record; return rest; }
export function auditRecord(identity, before, after, action) {
  const recordId = randomUUID();
  return { PK: `ASSET#${after.assetId}`, SK: `AUDIT#${new Date().toISOString()}#${recordId}`,
    recordId, assetId: after.assetId, action, actor: identity.subject, recordedAt: new Date().toISOString(),
    before: before ? toPublic(before) : null, after: toPublic(after) };
}
async function visibleAsset(identity, store, id) {
  authorize(identity, 'assets:read');
  const asset = await store.getAsset(id);
  if (!asset) throw new HttpError(404, 'Asset not found');
  const profile = await store.getProfile(identity.subject);
  if (!canSeeAsset(identity, asset, profile)) throw new HttpError(403, 'Your group does not have permission');
  return asset;
}
const maintainer = identity => hasGroup(identity, 'Administrator') || hasGroup(identity, 'Technician');

export async function handleLifecycleRoute(event, identity, store) {
  const route = `${event.httpMethod} ${event.resource}`;
  if (route === 'GET /reports') {
    authorize(identity, 'assets:read');
    const profile = await store.getProfile(identity.subject);
    const records = await store.scanRecords('REPORT#');
    const reports = records.filter(r => hasGroup(identity, 'Administrator') || hasGroup(identity, 'Auditor') ||
      (hasGroup(identity, 'Manager') && profile?.department && normalizeDepartment(profile.department) === normalizeDepartment(r.department)) ||
      (hasGroup(identity, 'Employee') && r.reportedBy === identity.subject));
    return { statusCode: 200, body: { reports: reports.map(publicRecord) } };
  }
  const suffix = event.resource?.match(/^\/assets\/\{id\}\/(maintenance|history|reports|maintenance-approval|reports-status)$/)?.[1];
  if (!suffix) return null;
  const id = event.pathParameters?.id;
  const asset = await visibleAsset(identity, store, id);
  if (event.httpMethod === 'GET' && ['maintenance', 'history'].includes(suffix)) {
    if (suffix === 'history' && !['Auditor', 'Administrator', 'Manager'].some(g => hasGroup(identity, g)))
      throw new HttpError(403, 'Your group does not have permission to view change history');
    const records = await store.listRecords(id, suffix === 'history' ? 'AUDIT#' : 'MAINT#');
    return { statusCode: 200, body: { records: records.map(publicRecord) } };
  }
  if (event.httpMethod !== 'POST') throw new HttpError(405, 'Method not allowed');
  if (suffix === 'reports') {
    if (!hasGroup(identity, 'Employee') || asset.assignedUserId !== identity.subject)
      throw new HttpError(403, 'Only the assigned employee can submit a problem report');
    const body = readBody(event, ['description']);
    const recordId = randomUUID();
    const report = { PK: `ASSET#${id}`, SK: `REPORT#${recordId}`, recordId, assetId: id,
      assetTag: asset.assetTag, department: asset.department, reportedBy: identity.subject,
      description: shortText(body.description, 'description'), status: 'Open', createdAt: new Date().toISOString() };
    await store.putRecord(report);
    return { statusCode: 201, body: publicRecord(report) };
  }
  if (suffix === 'reports-status') {
    if (!hasGroup(identity, 'Administrator')) throw new HttpError(403, 'Administrator access required');
    const body = readBody(event, ['recordId', 'status']);
    if (!['Open', 'In Progress', 'Resolved'].includes(body.status)) throw new HttpError(400, 'Invalid report status');
    const record = (await store.listRecords(id, 'REPORT#')).find(r => r.recordId === body.recordId);
    if (!record) throw new HttpError(404, 'Report not found');
    const updated = { ...record, status: body.status, updatedAt: new Date().toISOString(), updatedBy: identity.subject };
    await store.putRecord(updated);
    return { statusCode: 200, body: publicRecord(updated) };
  }
  if (!maintainer(identity)) throw new HttpError(403, 'Your group does not have permission');
  const now = changeTimestamp(asset);
  if (suffix === 'maintenance') {
    const body = readBody(event, ['maintenanceType', 'performedDate', 'notes', 'cost', 'intervalDays']);
    if (!['Cleaning', 'Inspection', 'Repair', 'Replacement'].includes(body.maintenanceType)) throw new HttpError(400, 'Invalid maintenance type');
    const performedDate = validDate(body.performedDate);
    if (performedDate > now.slice(0, 10)) throw new HttpError(400, 'Completed maintenance cannot be in the future');
    const cost = body.cost ?? 0;
    if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0 || cost > 100000000) throw new HttpError(400, 'Invalid maintenance cost');
    const cleaning = body.maintenanceType === 'Cleaning';
    const updated = { ...asset, updatedAt: now };
    const lastField = cleaning ? 'lastCleaningDate' : 'lastMaintenanceDate';
    updated[lastField] = !asset[lastField] || performedDate > asset[lastField] ? performedDate : asset[lastField];
    if (body.intervalDays !== undefined) {
      try { addDays(performedDate, body.intervalDays); } catch { throw new HttpError(400, 'Invalid interval'); }
      updated[cleaning ? 'cleaningIntervalDays' : 'maintenanceIntervalDays'] = body.intervalDays;
    }
    const interval = updated[cleaning ? 'cleaningIntervalDays' : 'maintenanceIntervalDays'];
    if (interval) updated[cleaning ? 'nextCleaningDate' : 'nextMaintenanceDate'] = addDays(updated[lastField], interval);
    if (body.maintenanceType === 'Repair') {
      updated.repairCount = (asset.repairCount || 0) + 1;
      updated.totalRepairCost = Math.round(((asset.totalRepairCost || 0) + cost) * 100) / 100;
    }
    const recordId = randomUUID();
    const record = { PK: `ASSET#${id}`, SK: `MAINT#${performedDate}#${recordId}`, recordId, assetId: id,
      maintenanceType: body.maintenanceType, performedDate, notes: shortText(body.notes, 'notes'), cost,
      recordedBy: identity.subject, createdAt: now };
    await store.commitAsset(updated, [record, auditRecord(identity, asset, updated, 'MaintenanceRecorded')], asset.updatedAt);
    return { statusCode: 201, body: publicRecord(record) };
  }
  if (suffix === 'maintenance-approval') {
    const body = readBody(event, ['intervalDays', 'kind']);
    if (!['cleaning', 'maintenance'].includes(body.kind)) throw new HttpError(400, 'Invalid maintenance kind');
    let due;
    try { due = addDays(now.slice(0, 10), body.intervalDays); } catch { throw new HttpError(400, 'Invalid interval'); }
    if (!due) throw new HttpError(400, 'Interval is required');
    const updated = { ...asset, updatedAt: now,
      [body.kind === 'cleaning' ? 'cleaningIntervalDays' : 'maintenanceIntervalDays']: body.intervalDays,
      [body.kind === 'cleaning' ? 'nextCleaningDate' : 'nextMaintenanceDate']: due,
      maintenanceReviewStatus: 'UserConfirmed', maintenanceApprovedBy: identity.subject };
    await store.commitAsset(updated, [auditRecord(identity, asset, updated, 'ScheduleApproved')], asset.updatedAt);
    return { statusCode: 200, body: toPublic(updated) };
  }
  throw new HttpError(404, 'Route not found');
}
