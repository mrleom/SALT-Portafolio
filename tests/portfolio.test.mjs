import test from 'node:test';
import assert from 'node:assert/strict';
import { filterDepreciation, portfolioTotals, valuePercentage, depreciationCsv } from '../frontend/portfolio.mjs';
import { createHandler } from '../backend/handler.mjs';
import { createMemoryStore, seedLocalAssets, localUserId } from '../backend/store-memory.mjs';
import { computeDepreciation } from '../backend/assets.mjs';

test('PDF financial example, pre-purchase date and salvage floor remain deterministic', () => {
  const asset = { purchaseValue: 1500, salvageValue: 100, usefulLifeYears: 4, purchaseDate: '2024-01-15' };
  const start = Date.parse(asset.purchaseDate + 'T00:00:00Z');
  const atYears = years => computeDepreciation(asset, new Date(start + years * 365.25 * 86400000));
  assert.deepEqual(atYears(2), { annualDepreciation: 350, accumulatedDepreciation: 700, currentBookValue: 800, usefulLifeConsumed: 50 });
  assert.equal(atYears(-1).currentBookValue, 1500);
  assert.deepEqual(atYears(20), { annualDepreciation: 350, accumulatedDepreciation: 1400, currentBookValue: 100, usefulLifeConsumed: 100 });
  assert.equal(computeDepreciation({ ...asset, purchaseValue: 0, salvageValue: 0 }).currentBookValue, 0);
});

test('retained-value filters distinguish zero purchase, missing values and the exact boundary', () => {
  const rows = [
    { assetId: 'low', assetTag: 'A', purchaseValue: 100, currentBookValue: 49, accumulatedDepreciation: 51 },
    { assetId: 'boundary', assetTag: 'B', purchaseValue: 100, currentBookValue: 50, accumulatedDepreciation: 50 },
    { assetId: 'zero', assetTag: 'C', purchaseValue: 0, currentBookValue: 0, accumulatedDepreciation: 0 },
    { assetId: 'missing', assetTag: 'D', purchaseValue: null, currentBookValue: null },
  ];
  assert.equal(valuePercentage(rows[2]), null);
  assert.equal(valuePercentage(rows[3]), null);
  assert.deepEqual(filterDepreciation(rows).map(a => a.assetId), ['low']);
  assert.equal(filterDepreciation(rows, { threshold: 0 }).length, 0);
  assert.equal(filterDepreciation(rows, { all: true }).length, 4);
  assert.deepEqual(portfolioTotals(rows), { count: 4, valuedCount: 3, purchase: 200, book: 99, depreciation: 101, belowHalf: 1 });
});

test('financial summaries and exports operate only on backend-authorized asset lists', async () => {
  const store = createMemoryStore(); await seedLocalAssets(store);
  const config = { clientId: 'client', issuer: 'issuer', requiredScope: 'salt/read', origin: 'http://localhost', store };
  const handler = createHandler(config);
  for (const [group, expected] of [['Employee', 3], ['Manager', 4], ['Auditor', 10], ['Technician', 10], ['Administrator', 10]]) {
    const event = { httpMethod: 'GET', resource: '/assets', requestContext: { authorizer: { claims: {
      sub: localUserId(group), client_id: 'client', iss: 'issuer', token_use: 'access', scope: 'salt/read',
      exp: Math.floor(Date.now() / 1000) + 60, 'cognito:groups': [group],
    } } } };
    const response = await handler(event); assert.equal(response.statusCode, 200);
    const assets = JSON.parse(response.body).assets;
    assert.equal(portfolioTotals(assets).count, expected);
    const filtered = filterDepreciation(assets, { all: true, category: 'Laptop', query: 'IT' });
    assert.ok(filtered.every(a => a.category === 'Laptop' && a.department === 'IT'));
    assert.equal(depreciationCsv(assets).split('\r\n').length, expected + 1);
  }
  assert.equal((await handler({ httpMethod: 'GET', resource: '/assets' })).statusCode, 401);
});

test('CSV exports escape delimiters and spreadsheet formula prefixes', () => {
  const csv = depreciationCsv([{ assetTag: '=HYPERLINK("bad")', category: 'A,B', department: '+CMD', purchaseValue: 100, currentBookValue: 25 }]);
  assert.ok(csv.includes('"\'=HYPERLINK(""bad"")"'));
  assert.ok(csv.includes('"A,B"'));
  assert.ok(csv.includes('"\'+CMD"'));
  assert.ok(csv.includes('"25.0"'));
  assert.ok(depreciationCsv([{ assetTag: '  =1+1' }]).includes('"\'  =1+1"'));
});
