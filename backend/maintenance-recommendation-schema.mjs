import { HttpError } from './auth.mjs';

export const MAINTENANCE_PRIORITIES = Object.freeze(['LOW', 'MEDIUM', 'HIGH']);
const FIELDS = Object.freeze([
  'priority', 'recommendedAction', 'recommendedCompletionDate',
  'maintenanceIntervalDays', 'expectedReplacementWindow', 'explanation', 'reviewStatus',
]);
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const PROHIBITED_CLAIMS = /\b(?:serial\s+(?:number|no\.?|identifier)|guaranteed\s+(?:failure|to fail)|will\s+(?:definitely\s+)?fail|predictive\s+maintenance|depreciation|book\s+value|purchase\s+(?:price|value))\b/i;

function fail(message = 'AI maintenance recommendation did not match the required schema') {
  throw new HttpError(502, message);
}

function cleanString(value, field, maxLength, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string') fail(`AI recommendation field ${field} is invalid`);
  const result = value.trim();
  if (!result || result.length > maxLength || CONTROL_CHARACTERS.test(result)) {
    fail(`AI recommendation field ${field} is invalid`);
  }
  if (PROHIBITED_CLAIMS.test(result)) {
    fail('AI maintenance recommendation included a prohibited unsupported claim');
  }
  return result;
}

function nullableDate(value) {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    fail('AI recommendation completion date is invalid');
  }
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    fail('AI recommendation completion date is invalid');
  }
  return value;
}

export function parseMaintenanceRecommendation(rawText) {
  if (typeof rawText !== 'string' || rawText.length > 20_000) {
    fail('AI maintenance recommendation was not valid JSON');
  }
  let value;
  try { value = JSON.parse(rawText); }
  catch { fail('AI maintenance recommendation was not valid JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  const keys = Object.keys(value);
  if (keys.length !== FIELDS.length || keys.some(key => !FIELDS.includes(key)) ||
      FIELDS.some(key => !Object.hasOwn(value, key))) {
    fail('AI maintenance recommendation included missing or unexpected fields');
  }
  if (!MAINTENANCE_PRIORITIES.includes(value.priority)) {
    fail('AI recommendation priority is invalid');
  }
  if (value.reviewStatus !== 'AI_SUGGESTED') {
    fail('AI recommendation review status is invalid');
  }
  if (value.maintenanceIntervalDays !== null &&
      (!Number.isInteger(value.maintenanceIntervalDays) || value.maintenanceIntervalDays < 1 ||
       value.maintenanceIntervalDays > 3650)) {
    fail('AI recommendation maintenance interval is invalid');
  }
  return Object.freeze({
    priority: value.priority,
    recommendedAction: cleanString(value.recommendedAction, 'recommendedAction', 500),
    recommendedCompletionDate: nullableDate(value.recommendedCompletionDate),
    maintenanceIntervalDays: value.maintenanceIntervalDays,
    expectedReplacementWindow: cleanString(
      value.expectedReplacementWindow, 'expectedReplacementWindow', 300, { nullable: true },
    ),
    explanation: cleanString(value.explanation, 'explanation', 1000),
    reviewStatus: 'AI_SUGGESTED',
  });
}
