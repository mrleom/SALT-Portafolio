import assert from 'node:assert/strict';
const base = process.env.LOCAL_TEST_ORIGIN || 'http://localhost:3000';
const page = await fetch(base + '/protected');
assert.equal(page.status, 200);
assert.match(await page.text(), /frontend\/main.jsx/);
console.log('PASS /protected serves React entry');
assert.equal((await fetch(base + '/api/demo')).status, 401);
assert.equal((await fetch(base + '/api/assets')).status, 401);
console.log('PASS anonymous API returns 401');
for (const group of ['Employee', 'Technician', 'Manager', 'Administrator', 'Auditor']) {
  const login = await fetch(base + '/api/local/login?group=' + group, { method: 'POST', headers: { Origin: base } });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(base + '/api/demo', { headers: { Cookie: cookie } })).status, 200);
  assert.equal((await fetch(base + '/api/admin', { headers: { Cookie: cookie } })).status, group === 'Administrator' ? 200 : 403);
  const assets = await fetch(base + '/api/assets', { headers: { Cookie: cookie } });
  assert.equal(assets.status, 200);
  const listed = await assets.json();
  if (group === 'Employee') assert.equal(listed.assets.length, 3);
  if (group === 'Auditor') assert.ok(listed.assets.length >= 10);
  if (group === 'Technician' || group === 'Administrator') {
    const created = await fetch(base + '/api/assets', {
      method: 'POST', headers: { Origin: base, Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assetTag: 'SMOKE-' + group.slice(0, 3).toUpperCase(), category: 'Laptop', description: 'Smoke test',
        manufacturer: 'ExampleCo', model: 'S1', serialNumber: 'SMOKE-' + group, purchaseDate: '2024-01-15',
        purchaseValue: 900, salvageValue: 50, usefulLifeYears: 4, assignedUserId: 'local-employee',
        assignedEmail: 'employee@local.test', department: 'IT', building: 'HQ', room: '1',
        condition: 'Good', status: 'Available',
      }),
    });
    assert.equal(created.status, 201);
  } else {
    const denied = await fetch(base + '/api/assets', {
      method: 'POST', headers: { Origin: base, Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ assetTag: 'NOPE' }),
    });
    assert.equal(denied.status, 403);
  }
  const logout = await fetch(base + '/api/local/logout', { method: 'POST', headers: { Origin: base, Cookie: cookie } });
  assert.equal(logout.status, 200);
  assert.equal((await fetch(base + '/api/demo', { headers: { Cookie: cookie } })).status, 401);
  console.log('PASS ' + group + ': demo/admin policy and logout');
}
