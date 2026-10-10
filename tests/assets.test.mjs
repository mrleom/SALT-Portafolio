import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../backend/handler.mjs';
import { computeDepreciation } from '../backend/assets.mjs';
import { createMemoryStore, localUserId, seedLocalAssets } from '../backend/store-memory.mjs';
import { createMockMiddleware } from '../local/mock-auth.mjs';

const config = { requiredScope: 'asset-tracker/demo.read', clientId: 'test-client', issuer: 'https://issuer.example/pool', origin: 'http://localhost:3000' };

function event(group, resource, { method = 'GET', body, query, id, sub, extraClaims = {} } = {}) {
  return {
    httpMethod: method, resource,
    pathParameters: id ? { id } : undefined,
    queryStringParameters: query,
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: { authorizer: { claims: {
      sub: sub || localUserId(group), iss: config.issuer, client_id: config.clientId,
      token_use: 'access', exp: Math.floor(Date.now() / 1000) + 60,
      scope: 'openid asset-tracker/demo.read', 'cognito:groups': [group], ...extraClaims,
    } } },
  };
}

async function seededHandler() {
  const store = createMemoryStore();
  await seedLocalAssets(store);
  return { store, handler: createHandler({ ...config, store }) };
}

const sample = {
  assetTag: 'NEW-100', category: 'Laptop', description: 'Spare laptop', manufacturer: 'ExampleCo',
  model: 'Z1', serialNumber: 'SN-NEW', purchaseDate: '2024-01-15', purchaseValue: 1200, salvageValue: 100,
  usefulLifeYears: 4, assignedUserId: localUserId('Employee'), assignedEmail: 'employee@local.test',
  department: 'IT', building: 'HQ', room: '101', condition: 'Good', status: 'Available',
};

test('straight-line book value is computed on read and not treated as stored principal', () => {
  const result = computeDepreciation({
    purchaseValue: 1500, salvageValue: 100, usefulLifeYears: 4, purchaseDate: '2024-01-15',
  }, new Date('2026-01-15T00:00:00Z'));
  assert.equal(result.annualDepreciation, 350);
  assert.ok(result.currentBookValue < 1500);
  assert.ok(result.currentBookValue >= 100);
});

test('create/list/get/patch matrix and validation', async () => {
  const { handler } = await seededHandler();
  const list = async (group, query) => JSON.parse((await handler(event(group, '/assets', { query }))).body);

  const employeeList = await handler(event('Employee', '/assets'));
  assert.equal(employeeList.statusCode, 200);
  const employeeAssets = JSON.parse(employeeList.body).assets;
  assert.equal(employeeAssets.length, 3);
  assert.ok(employeeAssets.every(asset => asset.assignedUserId === localUserId('Employee')));
  assert.ok(employeeAssets.every(asset => asset.currentBookValue !== undefined));

  const managerAssets = (await list('Manager')).assets;
  assert.ok(managerAssets.length >= 3);
  assert.ok(managerAssets.every(asset => asset.department === 'Operations'));

  const auditorAssets = (await list('Auditor')).assets;
  assert.equal(auditorAssets.length, 10);

  assert.equal((await handler(event('Employee', '/assets', { method: 'POST', body: sample }))).statusCode, 403);
  assert.equal((await handler(event('Manager', '/assets', { method: 'POST', body: sample }))).statusCode, 403);
  assert.equal((await handler(event('Auditor', '/assets', { method: 'POST', body: sample }))).statusCode, 403);

  const created = await handler(event('Technician', '/assets', { method: 'POST', body: sample }));
  assert.equal(created.statusCode, 201);
  const createdAsset = JSON.parse(created.body);
  assert.equal(createdAsset.assetTag, 'NEW-100');
  assert.equal(createdAsset.depreciationMethod, 'straight-line');
  assert.equal(createdAsset.photoKey, null);
  assert.equal(createdAsset.aiReviewStatus, 'ManualEntry');
  assert.match(createdAsset.assetId, /^[0-9a-f-]{36}$/i);

  const duplicate = await handler(event('Administrator', '/assets', { method: 'POST', body: sample }));
  assert.equal(duplicate.statusCode, 409);

  const unknown = await handler(event('Technician', '/assets', { method: 'POST', body: { ...sample, assetTag: 'NEW-101', extra: true } }));
  assert.equal(unknown.statusCode, 400);

  const tooLong = await handler(event('Technician', '/assets', { method: 'POST', body: { ...sample, assetTag: 'NEW-102', description: 'x'.repeat(2001) } }));
  assert.equal(tooLong.statusCode, 400);

  const otherId = (await list('Auditor')).assets.find(asset => asset.assignedUserId !== localUserId('Employee')).assetId;
  assert.equal((await handler(event('Employee', '/assets/{id}', { id: otherId }))).statusCode, 403);

  const own = employeeAssets[0];
  const employeePatch = await handler(event('Employee', '/assets/{id}', {
    method: 'PATCH', id: own.assetId, body: { status: 'Damaged', condition: 'Poor', problemNote: 'Screen cracked' },
  }));
  assert.equal(employeePatch.statusCode, 200);
  assert.equal(JSON.parse(employeePatch.body).problemNote, 'Screen cracked');

  const employeeDeniedField = await handler(event('Employee', '/assets/{id}', {
    method: 'PATCH', id: own.assetId, body: { department: 'Finance' },
  }));
  assert.equal(employeeDeniedField.statusCode, 400);

  assert.equal((await handler(event('Manager', '/assets/{id}', { method: 'PATCH', id: own.assetId, body: { status: 'Lost' } }))).statusCode, 403);
  assert.equal((await handler(event('Auditor', '/assets/{id}', { method: 'PATCH', id: own.assetId, body: { status: 'Lost' } }))).statusCode, 403);

  const techPatch = await handler(event('Technician', '/assets/{id}', {
    method: 'PATCH', id: own.assetId, body: { status: 'In Maintenance', lastMaintenanceDate: '2026-09-01' },
  }));
  assert.equal(techPatch.statusCode, 200);

  const adminPatch = await handler(event('Administrator', '/assets/{id}', {
    method: 'PATCH', id: own.assetId, body: { department: 'Finance', assignedUserId: localUserId('Auditor') },
  }));
  assert.equal(adminPatch.statusCode, 200);
  assert.equal(JSON.parse(adminPatch.body).department, 'Finance');

  const tagged = await handler(event('Auditor', '/assets', { query: { tag: 'LAP-001' } }));
  assert.equal(JSON.parse(tagged.body).assets.length, 1);
  assert.equal(JSON.parse(tagged.body).assets[0].assetTag, 'LAP-001');

  assert.equal((await handler(event('Employee', '/assets', { extraClaims: { 'cognito:groups': [] } }))).statusCode, 403);
});

function localCall(middleware, url, { method = 'GET', cookie, origin, host = 'localhost:3000', body } = {}) {
  return new Promise((resolve, reject) => {
    const req = { url, method, headers: { host, cookie, origin }, body };
    let status, headers;
    const res = {
      writeHead(code, value) { status = code; headers = value; },
      end(payload) { resolve({ status, headers, data: JSON.parse(payload) }); },
    };
    Promise.resolve(middleware(req, res, () => reject(new Error('Unexpected next')))).catch(reject);
  });
}

test('local /api/assets uses the in-memory store and group-scoped subjects', async () => {
  const middleware = createMockMiddleware({ origin: config.origin });
  assert.equal((await localCall(middleware, '/api/assets')).status, 401);
  const login = async group => {
    const response = await localCall(middleware, '/api/local/login?group=' + group, { method: 'POST', origin: config.origin });
    return response.headers['Set-Cookie'].split(';')[0];
  };
  const employee = await login('Employee');
  const employeeList = await localCall(middleware, '/api/assets', { cookie: employee });
  assert.equal(employeeList.status, 200);
  assert.equal(employeeList.data.assets.length, 3);
  const auditor = await login('Auditor');
  const auditorList = await localCall(middleware, '/api/assets', { cookie: auditor });
  assert.equal(auditorList.status, 200);
  assert.equal(auditorList.data.assets.length, 10);
  const denied = await localCall(middleware, '/api/assets', {
    method: 'POST', cookie: auditor, origin: config.origin, body: JSON.stringify(sample),
  });
  assert.equal(denied.status, 403);
  const technician = await login('Technician');
  const created = await localCall(middleware, '/api/assets', {
    method: 'POST', cookie: technician, origin: config.origin,
    body: JSON.stringify({ ...sample, assetTag: 'LOC-777' }),
  });
  assert.equal(created.status, 201);
  const patched = await localCall(middleware, '/api/assets/' + created.data.assetId, {
    method: 'PATCH', cookie: technician, origin: config.origin,
    body: JSON.stringify({ status: 'Assigned' }),
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.data.status, 'Assigned');
});
