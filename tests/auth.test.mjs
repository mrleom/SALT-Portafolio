import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, handler as awsHandler } from '../backend/handler.mjs';
import { GROUPS, authorize } from '../backend/auth.mjs';
import { createMockMiddleware } from '../local/mock-auth.mjs';
import { hostedUiHost, oauthScopes } from '../frontend/oauth-config.js';

const config = { requiredScope: 'asset-tracker/demo.read', clientId: 'test-client', issuer: 'https://issuer.example/pool', origin: 'http://localhost:3000' };
const handler = createHandler(config);
function event(group = 'Employee', resource = '/demo', overrides = {}) {
  return {
    httpMethod: 'GET', resource,
    requestContext: { authorizer: { claims: {
      sub: 'test-subject', iss: config.issuer, client_id: config.clientId,
      token_use: 'access', exp: Math.floor(Date.now() / 1000) + 60,
      scope: 'openid asset-tracker/demo.read', 'cognito:groups': [group], ...overrides,
    } } },
  };
}

for (const group of GROUPS) {
  test(`${group} can read demo`, async () => {
    assert.equal((await handler(event(group))).statusCode, 200);
  });
  test(`${group} admin access is enforced in backend`, async () => {
    assert.equal((await handler(event(group, '/admin'))).statusCode, group === 'Administrator' ? 200 : 403);
  });
}
test('missing verified context rejects forged authorization and group headers', async () => {
  assert.equal((await handler({
    httpMethod: 'GET', resource: '/admin',
    headers: { Authorization: 'Bearer forged-token', 'cognito:groups': 'Administrator', 'x-role': 'Administrator' },
    body: JSON.stringify({ groups: ['Administrator'] }),
  })).statusCode, 401);
});
for (const [name, overrides, expected] of [
  ['expired token', { exp: 1 }, 401],
  ['missing expiry', { exp: undefined }, 401],
  ['API Gateway date-string expiry', { exp: new Date(Date.now() + 60000).toUTCString().replace('GMT', 'UTC') }, 200],
  ['API Gateway expired date-string expiry', { exp: 'Tue Oct 25 10:11:58 UTC 2022' }, 401],
  ['wrong pool', { iss: 'https://attacker.example/pool' }, 401],
  ['wrong client', { client_id: 'other-client' }, 401],
  ['ID token', { token_use: 'id' }, 401],
  ['missing subject', { sub: '' }, 401],
  ['missing scope', { scope: 'openid' }, 403],
  ['unknown group', { 'cognito:groups': ['Superuser'] }, 403],
  ['no groups', { 'cognito:groups': undefined }, 403],
  ['group name substring', { 'cognito:groups': ['NotAdministrator'] }, 403],
]) {
  test(name, async () => assert.equal((await handler(event('Employee', '/demo', overrides))).statusCode, expected));
}
for (const groups of [['Employee', 'Administrator'], 'Employee,Administrator', '[Employee, Administrator]', '["Employee","Administrator"]']) {
  test('recognizes trusted multiple groups: ' + JSON.stringify(groups), async () => {
    assert.equal((await handler(event('Employee', '/admin', { 'cognito:groups': groups }))).statusCode, 200);
  });
}
test('unknown action defaults to deny', () => {
  assert.throws(() => authorize({ groups: ['Administrator'] }, 'assets:delete'), { statusCode: 403 });
});
test('role in request cannot upgrade authenticated Employee', async () => {
  const request = event('Employee', '/admin');
  request.headers = { 'x-role': 'Administrator' };
  request.body = '{"groups":["Administrator"]}';
  assert.equal((await handler(request)).statusCode, 403);
});
test('wrong method is not an allowed operation', async () => {
  const request = event();
  request.httpMethod = 'POST';
  assert.equal((await handler(request)).statusCode, 404);
});
test('unconfigured production handler fails closed even with LOCAL_AUTH set', async () => {
  const previous = process.env.LOCAL_AUTH;
  process.env.LOCAL_AUTH = 'true';
  try { assert.equal((await awsHandler(event())).statusCode, 503); }
  finally { if (previous === undefined) delete process.env.LOCAL_AUTH; else process.env.LOCAL_AUTH = previous; }
});

function localCall(middleware, url, { method = 'GET', cookie, origin, host = 'localhost:3000' } = {}) {
  return new Promise((resolve, reject) => {
    const req = { url, method, headers: { host, cookie, origin } };
    let status, headers;
    const res = {
      writeHead(code, value) { status = code; headers = value; },
      end(body) { resolve({ status, headers, data: JSON.parse(body) }); },
    };
    Promise.resolve(middleware(req, res, () => reject(new Error('Unexpected next')))).catch(reject);
  });
}
test('local session lifecycle: anonymous, Employee denial, Administrator allowed, logout', async () => {
  const middleware = createMockMiddleware({ origin: config.origin });
  assert.equal((await localCall(middleware, '/api/demo')).status, 401);
  const login = async group => {
    const response = await localCall(middleware, '/api/local/login?group=' + group,
      { method: 'POST', origin: config.origin });
    assert.equal(response.status, 200);
    assert.match(response.headers['Set-Cookie'], /HttpOnly; SameSite=Strict/);
    return response.headers['Set-Cookie'].split(';')[0];
  };
  const employee = await login('Employee');
  assert.equal((await localCall(middleware, '/api/demo', { cookie: employee })).status, 200);
  assert.equal((await localCall(middleware, '/api/admin', { cookie: employee })).status, 403);
  const admin = await login('Administrator');
  assert.equal((await localCall(middleware, '/api/admin', { cookie: admin })).status, 200);
  assert.equal((await localCall(middleware, '/api/local/logout', {
    method: 'POST', cookie: admin, origin: config.origin,
  })).status, 200);
  assert.equal((await localCall(middleware, '/api/demo', { cookie: admin })).status, 401);
});
test('local adapter rejects cross-origin login, unknown groups, and unexpected Host', async () => {
  const middleware = createMockMiddleware({ origin: config.origin });
  assert.equal((await localCall(middleware, '/api/local/login?group=Administrator',
    { method: 'POST', origin: 'https://evil.example' })).status, 403);
  assert.equal((await localCall(middleware, '/api/local/login?group=Administrator',
    { method: 'POST' })).status, 403);
  assert.equal((await localCall(middleware, '/api/local/login?group=Superuser',
    { method: 'POST', origin: config.origin })).status, 400);
  assert.equal((await localCall(middleware, '/api/demo', { host: 'evil.example' })).status, 403);
});

test('deployment-selected scope is required instead of a fixed namespace', async () => {
  const customHandler = createHandler({ ...config, requiredScope: 'team-security/demo.read' });
  assert.equal((await customHandler(event())).statusCode, 403);
  assert.equal((await customHandler(event('Employee', '/demo', { scope: 'team-security/demo.read' }))).statusCode, 200);
});
test('missing deployment scope fails closed', async () => {
  assert.equal((await createHandler({ ...config, requiredScope: undefined })(event())).statusCode, 503);
});
test('hosted UI host is the Cognito domain hostname', () => {
  assert.equal(hostedUiHost('https://login.example.invalid'), 'login.example.invalid');
});
test('hosted UI host rejects non-HTTPS Cognito domains', () => {
  assert.throws(() => hostedUiHost('http://login.example.invalid'), /HTTPS/);
});
test('oauth scopes always include openid, email, and the required API scope', () => {
  assert.deepEqual(oauthScopes('salt-sandbox/demo.read'), ['openid', 'email', 'salt-sandbox/demo.read']);
});
test('local origin can use a team-selected port', async () => {
  const origin = 'http://localhost:4317';
  const middleware = createMockMiddleware({ origin });
  const login = await localCall(middleware, '/api/local/login?group=Employee',
    { method: 'POST', origin, host: 'localhost:4317' });
  assert.equal(login.status, 200);
  assert.equal((await localCall(middleware, '/api/demo', { host: 'localhost:3000' })).status, 403);
});
