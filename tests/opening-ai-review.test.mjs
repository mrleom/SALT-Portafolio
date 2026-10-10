import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SIGN_IN_ROLES, SIGN_IN_DESTINATION, rolePreferenceNotice } from '../frontend/sign-in-policy.mjs';
import { prefillAssetDraft } from '../frontend/ai-prefill.mjs';
import { parseAiSuggestion } from '../backend/ai-suggestion.mjs';

const eyewear = {
  schemaVersion: '1.0', category: 'Eyewear', manufacturer: null,
  possibleModelFamily: null, description: 'Black rectangular glasses with clear lenses.',
  visibleCondition: 'GOOD', suggestedUsefulLifeYears: 3, maintenanceCategory: 'ROUTINE',
  confidence: 0.8, reviewStatus: 'REVIEW_REQUIRED',
  uncertaintyNotes: ['Serial number is not visible.', 'Purchase price cannot be determined.'],
};
const draft = {
  category: '', manufacturer: '', description: '', usefulLifeYears: '4', condition: 'Good',
  model: '', serialNumber: '', purchaseValue: '', purchaseDate: '', assignedUserId: '',
};

test('sign-in choices match all five PDF roles; IT means Technician', () => {
  assert.deepEqual(SIGN_IN_ROLES.map(role => role.value), ['Employee', 'Technician', 'Manager', 'Administrator', 'Auditor']);
  assert.match(SIGN_IN_ROLES[1].label, /IT/);
  assert.equal(SIGN_IN_DESTINATION, '/');
});

test('role preference cannot turn an Employee into an Administrator', () => {
  const groups = Object.freeze(['Employee']);
  assert.match(rolePreferenceNotice('Administrator', groups), /account is assigned Employee/);
  assert.deepEqual(groups, ['Employee']);
  assert.equal(rolePreferenceNotice('', groups), '');
  assert.equal(rolePreferenceNotice('Employee', groups), '');
  assert.equal(rolePreferenceNotice('forged-role', groups), '');
});

test('frontend uses shared Overview destination and hides signed-out workspace navigation', () => {
  const app = readFileSync(new URL('../frontend/main.jsx', import.meta.url), 'utf8');
  const auth = readFileSync(new URL('../frontend/team-auth.js', import.meta.url), 'utf8');
  assert.match(app, /\{identity && <aside className="sidebar">/);
  assert.match(app, /navigate\(SIGN_IN_DESTINATION\)/);
  assert.match(auth, /stripOAuthParams\(SIGN_IN_DESTINATION\)/);
  assert.doesNotMatch(app, /Sign in with Cognito/);
  assert.doesNotMatch(app, /\['\/protected', 'Protected page'/);
  assert.match(auth, /responseType: 'code'/);
});

test('uncertainty about prohibited details no longer rejects usable photo suggestions', () => {
  const result = parseAiSuggestion(JSON.stringify(eyewear));
  assert.equal(result.category, 'Eyewear');
  assert.equal(result.description, eyewear.description);
  assert.deepEqual(result.uncertaintyNotes, ['Some details cannot be verified from a photograph. Confirm missing information manually.']);
});

test('claimed identifiers hidden in notes are replaced, never exposed', () => {
  const result = parseAiSuggestion(JSON.stringify({ ...eyewear, uncertaintyNotes: ['Serial number is FAKE-123456.'] }));
  assert.doesNotMatch(JSON.stringify(result), /FAKE-123456/);
  assert.equal(result.reviewStatus, 'REVIEW_REQUIRED');
});

test('forbidden fields and identifier claims in asset descriptions remain rejected', () => {
  for (const field of ['serialNumber', 'exactModelNumber', 'purchaseValue', 'purchaseDate', 'assignedUserId']) {
    assert.throws(() => parseAiSuggestion(JSON.stringify({ ...eyewear, [field]: 'invented' })), /prohibited unverifiable field/);
  }
  assert.throws(() => parseAiSuggestion(JSON.stringify({ ...eyewear, description: 'Serial number is FAKE-123.' })), /prohibited unverifiable data/);
  for (const uncertaintyNotes of [[null], [''], ['x'.repeat(201)], Array(6).fill('Unclear')]) {
    assert.throws(() => parseAiSuggestion(JSON.stringify({ ...eyewear, uncertaintyNotes })), { statusCode: 502 });
  }
});

test('AI fills only supported draft fields; sensitive fields stay manual', () => {
  const suggestion = parseAiSuggestion(JSON.stringify(eyewear));
  const result = prefillAssetDraft(draft, { ...suggestion, serialNumber: 'invented', model: 'exact', purchaseValue: 100, assignedUserId: 'other' });
  assert.equal(result.category, 'Eyewear');
  assert.equal(result.description, eyewear.description);
  assert.equal(result.usefulLifeYears, '3');
  for (const field of ['model', 'serialNumber', 'purchaseValue', 'purchaseDate', 'assignedUserId']) assert.equal(result[field], '');
  assert.equal(draft.category, '');
});

test('manual-entry output never prefills the draft; concurrent edits are preserved', () => {
  const manual = parseAiSuggestion(JSON.stringify({ ...eyewear, confidence: 0.2 }));
  assert.equal(prefillAssetDraft(draft, manual), draft);
  const edited = { ...draft, description: 'My corrected description', usefulLifeYears: '7' };
  const result = prefillAssetDraft(edited, eyewear, draft);
  assert.equal(result.description, edited.description);
  assert.equal(result.usefulLifeYears, '7');
  assert.equal(result.category, 'Eyewear');
});
