export const GROUPS = Object.freeze([
  'Employee', 'Technician', 'Manager', 'Administrator', 'Auditor',
]);

const permissions = Object.freeze({
  'demo:read': GROUPS,
  'admin:read': ['Administrator'],
  'assets:create': ['Technician', 'Administrator'],
  'assets:read': GROUPS,
  'assets:update': ['Employee', 'Technician', 'Administrator'],
  'images:analyze': ['Technician', 'Administrator'],
  'images:read-draft': ['Technician', 'Administrator'],
  'maintenance:recommend': ['Technician', 'Administrator'],
});

export const STATUSES = Object.freeze([
  'Available', 'Assigned', 'Checked Out', 'In Maintenance', 'Damaged', 'Lost', 'Stolen', 'Retired',
]);

export function hasGroup(identity, group) {
  return identity.groups.includes(group);
}

export function canReadAllAssets(identity) {
  return ['Technician', 'Administrator', 'Auditor'].some(group => hasGroup(identity, group));
}

export function canReadDepartment(identity) {
  return hasGroup(identity, 'Manager') || canReadAllAssets(identity);
}

export function patchFieldsFor(identity) {
  if (hasGroup(identity, 'Administrator')) {
    return Object.freeze([
      'assetTag', 'category', 'description', 'manufacturer', 'model', 'serialNumber',
      'purchaseDate', 'purchaseValue', 'salvageValue', 'usefulLifeYears', 'depreciationMethod',
      'assignedUserId', 'assignedEmail', 'department', 'building', 'room', 'condition', 'status',
      'problemNote', 'lastCleaningDate', 'lastMaintenanceDate', 'nextMaintenanceDate', 'expectedReplacementDate',
      'photoKey', 'aiReviewStatus',
    ]);
  }
  if (hasGroup(identity, 'Technician')) {
    return Object.freeze([
      'condition', 'status', 'lastCleaningDate', 'lastMaintenanceDate',
      'nextMaintenanceDate', 'expectedReplacementDate',
      'photoKey', 'aiReviewStatus',
    ]);
  }
  if (hasGroup(identity, 'Employee')) {
    return Object.freeze(['status', 'condition', 'problemNote']);
  }
  return Object.freeze([]);
}

export class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function parseGroups(value) {
  if (typeof value === 'string') {
    // REST API Gateway can stringify multi-valued Cognito claims.
    try { value = JSON.parse(value); }
    catch { value = value.replace(/^\[|\]$/g, '').split(',').map(v => v.trim()); }
  }
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(group => GROUPS.includes(group)))];
}

export function claimExpirySeconds(value) {
  if (value == null || value === '') return NaN;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric > 1e12 ? numeric / 1000 : numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed / 1000 : NaN;
}

export function authenticate(event, config, now = Date.now()) {
  if (!config.clientId || !config.issuer || !config.requiredScope) throw new HttpError(503, 'Authentication is not configured');
  // Only API Gateway's verified authorizer context is trusted. Never decode a
  // client-supplied JWT, role header, query parameter, or request body here.
  const authorizer = event.requestContext?.authorizer;
  const claims = authorizer?.claims && typeof authorizer.claims === 'object' ? authorizer.claims : authorizer;
  const exp = claimExpirySeconds(claims?.exp);
  if (!claims || typeof claims.sub !== 'string' || !claims.sub ||
      claims.token_use !== 'access' || claims.client_id !== config.clientId ||
      claims.iss !== config.issuer || !Number.isFinite(exp) || exp <= now / 1000) {
    throw new HttpError(401, 'Sign in required');
  }
  if (!String(claims.scope ?? '').split(' ').includes(config.requiredScope)) {
    throw new HttpError(403, 'Required API scope is missing');
  }
  return { subject: claims.sub, groups: parseGroups(claims['cognito:groups']) };
}

export function authorize(identity, action) {
  if (!permissions[action]?.some(group => identity.groups.includes(group))) {
    throw new HttpError(403, 'Your group does not have permission');
  }
}
