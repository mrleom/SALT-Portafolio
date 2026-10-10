import { classifyDueDate, dueDateFor } from './maintenance-dates.mjs';

function safeText(value, fallback, maxLength = 160) {
  if (typeof value !== 'string') return fallback;
  const result = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return result ? result.slice(0, maxLength) : fallback;
}

function dueItem(asset, kind, now, upcomingDays) {
  const dueDate = dueDateFor(asset, kind);
  if (!dueDate) return null;
  const classification = classifyDueDate(dueDate, now, upcomingDays);
  if (classification.status === 'NOT_DUE') return null;
  return Object.freeze({
    kind: kind.toUpperCase(),
    status: classification.status,
    dueDate,
    recommendedAction: kind === 'maintenance'
      ? 'Schedule asset maintenance and record the completed work.'
      : 'Schedule asset cleaning and record the completion date.',
  });
}

export function buildMaintenanceNotification(asset, {
  now = new Date(), upcomingDays = 7,
} = {}) {
  if (!asset || typeof asset !== 'object' || Array.isArray(asset)) {
    throw new TypeError('asset must be an object');
  }
  const items = [
    dueItem(asset, 'maintenance', now, upcomingDays),
    dueItem(asset, 'cleaning', now, upcomingDays),
  ].filter(Boolean);
  if (items.length === 0) return null;
  const overallStatus = items.some(item => item.status === 'OVERDUE') ? 'OVERDUE' : 'UPCOMING';
  const assetId = safeText(asset.assetId, safeText(asset.PK, 'Unknown asset').replace(/^ASSET#/, ''));
  const assetTag = safeText(asset.assetTag, assetId);
  const payload = Object.freeze({
    type: 'MAINTENANCE_DUE_NOTICE',
    assetId,
    assetTag,
    status: overallStatus,
    items,
    generatedAt: (now instanceof Date ? now : new Date(now)).toISOString(),
  });
  return Object.freeze({
    subject: `SALT ${overallStatus}: ${assetTag}`.slice(0, 100),
    message: JSON.stringify(payload),
    payload,
  });
}
