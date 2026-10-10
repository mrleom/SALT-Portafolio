export function money(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString(undefined, { style: 'currency', currency: 'USD' }) : '—';
}

export function valuePercentage(asset) {
  if (!Number.isFinite(asset.purchaseValue) || asset.purchaseValue <= 0 ||
      !Number.isFinite(asset.currentBookValue)) return null;
  return asset.currentBookValue / asset.purchaseValue * 100;
}

export function portfolioTotals(assets) {
  const valued = assets.filter(a => [a.purchaseValue, a.currentBookValue, a.accumulatedDepreciation].every(Number.isFinite));
  const sum = field => valued.reduce((total, a) => total + a[field], 0);
  return { count: assets.length, valuedCount: valued.length, purchase: sum('purchaseValue'),
    book: sum('currentBookValue'), depreciation: sum('accumulatedDepreciation'),
    belowHalf: assets.filter(a => valuePercentage(a) !== null && valuePercentage(a) < 50).length };
}

export function filterDepreciation(assets, { threshold = 50, all = false, query = '', category = '', sort = 'value' } = {}) {
  const term = query.trim().toLowerCase();
  const rows = assets.filter(a => {
    const percentage = valuePercentage(a);
    return (all || (percentage !== null && percentage < threshold)) && (!category || a.category === category) &&
      (!term || [a.assetTag, a.description, a.department].some(v => String(v || '').toLowerCase().includes(term)));
  });
  return rows.sort((a, b) => {
    if (sort === 'replacement') return (a.expectedReplacementDate || '9999').localeCompare(b.expectedReplacementDate || '9999');
    if (sort === 'tag') return String(a.assetTag).localeCompare(String(b.assetTag));
    return (valuePercentage(a) ?? Infinity) - (valuePercentage(b) ?? Infinity) || String(a.assetTag).localeCompare(String(b.assetTag));
  });
}

// Spreadsheet applications must not interpret user-entered strings as formulas.
export function depreciationCsv(assets) {
  const cell = value => {
    const text = String(value ?? '');
    const safe = /^[=+@\-\t\r\n]|^[\s\u0000-\u001f]*[=+@-]/.test(text) ? "'" + text : text;
    return '"' + safe.replaceAll('"', '""') + '"';
  };
  const rows = [['Tag', 'Category', 'Department', 'Purchase value USD', 'Salvage value USD',
    'Annual depreciation USD', 'Accumulated depreciation USD', 'Book value USD', 'Value retained percent',
    'Useful life consumed percent', 'Expected replacement date'],
  ...assets.map(a => [a.assetTag, a.category, a.department, a.purchaseValue, a.salvageValue,
    a.annualDepreciation, a.accumulatedDepreciation, a.currentBookValue,
    valuePercentage(a)?.toFixed(1), a.usefulLifeConsumed, a.expectedReplacementDate])];
  return rows.map(row => row.map(cell).join(',')).join('\r\n');
}
