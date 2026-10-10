import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionDisplayEmail, userLabel } from '../frontend/user-display.mjs';

test('User label shows the email prefix without changing the internal subject', () => {
  const subject = 'immutable-cognito-subject';
  const payload = { sub: subject, email: 'demo.employee@example.test' };
  assert.equal(userLabel(sessionDisplayEmail(payload, subject)), 'demo.employee');
  assert.equal(userLabel('demo.admin@example.test'), 'demo.admin');
  assert.equal(payload.sub, subject);
});

test('display email belongs to the backend-authorized subject', () => {
  assert.equal(sessionDisplayEmail({ sub: 'other', email: 'other@example.test' }, 'current'), '');
  assert.equal(sessionDisplayEmail({ email: 'other@example.test' }, ''), '');
  assert.equal(sessionDisplayEmail({ sub: 'current' }, 'current'), '');
  assert.equal(sessionDisplayEmail(null, 'current'), '');
});

test('missing display email has a readable fallback and preserves valid prefixes', () => {
  for (const email of [undefined, null, '', 'invalid', '@example.test', 'name@']) {
    assert.equal(userLabel(email), 'Signed-in user');
  }
  assert.equal(userLabel('  user.name+demo@example.test  '), 'user.name+demo');
});
