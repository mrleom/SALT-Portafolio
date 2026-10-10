import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { suggestAssetTag, assetPhotoCaption } from '../frontend/asset-presentation.mjs';

test('tags use three category letters and category-specific increasing numbers', () => {
  assert.equal(suggestAssetTag('Mouse'), 'MOU-001');
  assert.equal(suggestAssetTag('mouse', [{ assetTag: 'MOU-001' }]), 'MOU-002');
  assert.equal(suggestAssetTag('Monitor', [{ assetTag: 'MOU-008' }]), 'MON-001');
  assert.equal(suggestAssetTag('Network Switch'), 'NET-001');
  assert.equal(suggestAssetTag('Printer'), 'PRI-001');
});
test('tag suggestions handle gaps, mixed case, malformed tags, and long sequences', () => {
  assert.equal(suggestAssetTag('Laptop', [{ assetTag: 'lap-004' }, { assetTag: 'LAP-001' }, { assetTag: 'DEMO-LAP-999' }]), 'LAP-005');
  assert.equal(suggestAssetTag('Mouse', [{ assetTag: 'MOU-999' }]), 'MOU-1000');
  assert.equal(suggestAssetTag(''), '');
  assert.equal(suggestAssetTag('12'), '');
  assert.equal(suggestAssetTag('PC'), '');
  assert.equal(suggestAssetTag('Mouse', [{ assetTag: 'MOU-9007199254740991' }]), '');
});
test('known generated images disclose their provenance without labeling ordinary photos AI', () => {
  assert.match(assetPhotoCaption('users/id/uuid-ai-illustration-mon-001.png'), /AI-generated illustration/);
  assert.match(assetPhotoCaption('ai-illustration-lap-001.png'), /not a photograph of actual equipment/);
  assert.equal(assetPhotoCaption('users/id/laptop.jpg'), 'Private asset photograph');
});
test('record summary precedes metadata and photos are no longer buried in maintenance', () => {
  const assets = readFileSync(new URL('../frontend/assets.jsx', import.meta.url), 'utf8');
  const lifecycle = readFileSync(new URL('../frontend/lifecycle.jsx', import.meta.url), 'utf8');
  assert.ok(assets.indexOf('<AssetSummary key=') < assets.indexOf('<dl className="detail-list">{fields.map'));
  assert.match(assets, /encodeURIComponent\(asset.assetId\) \+ '\/photo'/);
  assert.doesNotMatch(lifecycle, /setPhoto|className="asset-photo"/);
  assert.match(assets, /setAutomaticTag\(false\)/);
});
