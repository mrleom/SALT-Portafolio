const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function dateParts(value, name) {
  if (typeof value !== 'string') throw new TypeError(`${name} must be an ISO date`);
  const match = ISO_DATE.exec(value);
  if (!match) throw new RangeError(`${name} must use YYYY-MM-DD`);
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const epoch = Date.UTC(year, month - 1, day);
  const parsed = new Date(epoch);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 ||
      parsed.getUTCDate() !== day) {
    throw new RangeError(`${name} is not a valid calendar date`);
  }
  return { epoch, year, month, day };
}

function intervalDays(value, name) {
  if (!Number.isInteger(value) || value < 1 || value > 3650) {
    throw new RangeError(`${name} must be an integer from 1 through 3650`);
  }
  return value;
}

function formatUtcDate(epoch) {
  return new Date(epoch).toISOString().slice(0, 10);
}

export function addDays(date, days, {
  dateName = 'date', intervalName = 'intervalDays',
} = {}) {
  if (date === undefined || date === null || date === '' ||
      days === undefined || days === null || days === '') return null;
  const { epoch } = dateParts(date, dateName);
  return formatUtcDate(epoch + intervalDays(days, intervalName) * DAY_MS);
}

export function calculateDueDates(asset) {
  if (!asset || typeof asset !== 'object' || Array.isArray(asset)) {
    throw new TypeError('asset must be an object');
  }
  return Object.freeze({
    nextMaintenanceDate: addDays(asset.lastMaintenanceDate, asset.maintenanceIntervalDays, {
      dateName: 'lastMaintenanceDate', intervalName: 'maintenanceIntervalDays',
    }),
    nextCleaningDate: addDays(asset.lastCleaningDate, asset.cleaningIntervalDays, {
      dateName: 'lastCleaningDate', intervalName: 'cleaningIntervalDays',
    }),
  });
}

function todayEpoch(now) {
  const instant = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(instant.getTime())) throw new RangeError('now must be a valid date');
  return Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate());
}

export function classifyDueDate(dueDate, now = new Date(), upcomingDays = 7) {
  if (dueDate === undefined || dueDate === null || dueDate === '') {
    return Object.freeze({ status: 'NOT_DUE', daysUntilDue: null });
  }
  if (!Number.isInteger(upcomingDays) || upcomingDays < 0 || upcomingDays > 365) {
    throw new RangeError('upcomingDays must be an integer from 0 through 365');
  }
  const daysUntilDue = Math.round((dateParts(dueDate, 'dueDate').epoch - todayEpoch(now)) / DAY_MS);
  const status = daysUntilDue < 0 ? 'OVERDUE' : daysUntilDue <= upcomingDays ? 'UPCOMING' : 'NOT_DUE';
  return Object.freeze({ status, daysUntilDue });
}

export function dueDateFor(asset, kind) {
  const isMaintenance = kind === 'maintenance';
  if (!isMaintenance && kind !== 'cleaning') throw new RangeError('kind must be maintenance or cleaning');
  const explicit = isMaintenance ? asset.nextMaintenanceDate : asset.nextCleaningDate;
  if (explicit !== undefined && explicit !== null && explicit !== '') {
    dateParts(explicit, isMaintenance ? 'nextMaintenanceDate' : 'nextCleaningDate');
    return explicit;
  }
  return addDays(
    isMaintenance ? asset.lastMaintenanceDate : asset.lastCleaningDate,
    isMaintenance ? asset.maintenanceIntervalDays : asset.cleaningIntervalDays,
    {
      dateName: isMaintenance ? 'lastMaintenanceDate' : 'lastCleaningDate',
      intervalName: isMaintenance ? 'maintenanceIntervalDays' : 'cleaningIntervalDays',
    },
  );
}
