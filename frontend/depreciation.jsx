import React, { useMemo, useState } from 'react';
import { Icon, Metric, useAssets } from './workspace.jsx';
import { depreciationCsv, filterDepreciation, money, portfolioTotals, valuePercentage } from './portfolio.mjs';

export function DepreciationView({ busy, act, navigate }) {
  const { assets, loaded, load } = useAssets(act);
  const [threshold, setThreshold] = useState('50');
  const [all, setAll] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState('value');
  const [selected, setSelected] = useState('');
  const validThreshold = threshold !== '' && Number.isFinite(Number(threshold)) && Number(threshold) >= 0 && Number(threshold) <= 100;
  const totals = portfolioTotals(assets);
  const categories = [...new Set(assets.map(a => a.category).filter(Boolean))].sort();
  const rows = useMemo(() => (!all && !validThreshold) ? [] : filterDepreciation(assets, { threshold: Number(threshold), all, query, category, sort }), [assets, threshold, all, query, category, sort, validThreshold]);
  const asset = rows.find(a => a.assetId === selected) || rows[0];
  const excluded = assets.filter(a => valuePercentage(a) === null).length;

  function download() {
    const url = URL.createObjectURL(new Blob([depreciationCsv(rows)], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'salt-depreciation.csv'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <div className="workspace-stack">
    <div className="section-heading"><div><span className="eyebrow">WORKSPACE / FINANCIAL LIFECYCLE</span><h1>Depreciation <span>intelligence.</span></h1><p className="intro">Understand retained value. Make informed replacement decisions.</p></div><button disabled={busy} onClick={() => act(load)}>Refresh values</button></div>
    <div className="metrics-grid">
      <Metric label="Original investment" value={loaded ? money(totals.purchase) : '—'} detail="Purchase value across permitted assets" icon="box" />
      <Metric label="Current book value" value={loaded ? money(totals.book) : '—'} detail="Today's code-calculated value" accent="cyan" />
      <Metric label="Accumulated depreciation" value={loaded ? money(totals.depreciation) : '—'} detail="Book value never falls below salvage" accent="violet" />
      <Metric label="Below 50% retained" value={loaded ? totals.belowHalf : '—'} detail="A review signal, not a replacement mandate" icon="report" accent="amber" />
    </div>
    <section>
      <div className="panel-title"><div><span className="eyebrow">VALUE EXPLORER</span><h2>{all ? 'All permitted assets' : validThreshold ? `Assets below ${threshold}% of purchase value` : 'Enter a valid threshold'}</h2></div><button disabled={busy || !rows.length} onClick={download}>Export filtered CSV</button></div>
      <div className="depreciation-filters">
        <label>Retained-value threshold (%)<input type="number" min="0" max="100" step="1" disabled={all} value={threshold} onChange={e => setThreshold(e.target.value)} aria-invalid={!all && !validThreshold} /></label>
        <label>Search<input value={query} onChange={e => setQuery(e.target.value)} placeholder="Tag, description, department" /></label>
        <label>Category<select value={category} onChange={e => setCategory(e.target.value)}><option value="">All categories</option>{categories.map(c => <option key={c}>{c}</option>)}</select></label>
        <label>Sort by<select value={sort} onChange={e => setSort(e.target.value)}><option value="value">Lowest retained value</option><option value="replacement">Earliest replacement</option><option value="tag">Asset tag</option></select></label>
      </div>
      <div className="filter-meta"><label className="check-label"><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} />Show all permitted assets</label><span className="hint" role="status">{loaded ? rows.length + ' of ' + assets.length + ' assets' : 'Loading assets…'}</span></div>
      {!all && !validThreshold && <p className="error" role="alert">Enter a threshold from 0 to 100.</p>}
      {!!excluded && <p className="hint">{excluded} assets have no meaningful retained-value percentage (missing financial data or zero purchase value). Choose “Show all” to review them.</p>}
      <p className="hint">Summary cards cover your entire permitted portfolio; filters apply to the table and export. Values are in USD.</p>
      {loaded && !rows.length ? <div className="empty-state"><Icon name="chart" size={32} /><h3>No assets match these filters</h3><p>Raise the threshold, clear your search, or show all permitted assets.</p></div> : <div className="table-wrap"><table className="asset-table depreciation-table"><caption className="sr-only">Asset depreciation and expected replacement dates</caption><thead><tr><th>Asset</th><th>Purchase</th><th>Book value</th><th>Value retained</th><th>Life consumed</th><th>Replace by</th><th><span className="sr-only">Inspect calculation</span></th></tr></thead><tbody>{rows.map(a => {
        const percentage = valuePercentage(a);
        return <tr key={a.assetId} className={asset?.assetId === a.assetId ? 'selected-row' : ''}><td><button className="link asset-tag" onClick={() => navigate('/assets/' + encodeURIComponent(a.assetId))}>{a.assetTag}</button><span className="cell-secondary">{a.category} · {a.department}</span></td><td>{money(a.purchaseValue)}</td><td className="value-cell">{money(a.currentBookValue)}</td><td><div className="value-meter"><span style={{ width: `${Math.max(0, Math.min(100, percentage || 0))}%` }} /></div><span>{percentage === null ? 'Not applicable' : percentage.toFixed(1) + '%'}</span></td><td>{Number.isFinite(a.usefulLifeConsumed) ? a.usefulLifeConsumed.toFixed(1) + '%' : '—'}</td><td>{a.expectedReplacementDate || 'Not established'}</td><td><button className="inspect-button" aria-pressed={asset?.assetId === a.assetId} onClick={() => setSelected(a.assetId)} aria-label={'Inspect ' + a.assetTag}><Icon name="arrow" size={18} /></button></td></tr>;
      })}</tbody></table></div>}
    </section>
    {asset && <section><div className="panel-title"><div><span className="eyebrow">CALCULATION BREAKDOWN / {asset.assetTag}</span><h2>{asset.description || asset.category}</h2></div><span className="scope-pill">Straight-line method</span></div><div className="calculation-grid"><dl className="detail-list"><dt>Purchase date</dt><dd>{asset.purchaseDate || 'Not recorded'}</dd><dt>Purchase value</dt><dd>{money(asset.purchaseValue)}</dd><dt>Salvage value</dt><dd>{money(asset.salvageValue)}</dd><dt>Useful life</dt><dd>{asset.usefulLifeYears} years</dd><dt>Annual depreciation</dt><dd>{money(asset.annualDepreciation)}</dd><dt>Accumulated</dt><dd>{money(asset.accumulatedDepreciation)}</dd><dt>Current book value</dt><dd className="value-cell">{money(asset.currentBookValue)}</dd><dt>Expected replacement</dt><dd>{asset.expectedReplacementDate || 'Not established'}</dd></dl><div className="formula-card"><Icon name="chart" size={28} /><h3>Transparent by design</h3><p>Annual depreciation = (purchase value − salvage value) ÷ useful life.</p><p>Book value = the greater of salvage value and purchase value minus accumulated depreciation.</p><p className="hint">Elapsed time is calculated daily using 365.25 days per year. Useful life consumed and value retained measure different things. Expected replacement dates are planning estimates.</p><button onClick={() => navigate('/assets/' + encodeURIComponent(asset.assetId))}>Open asset record <Icon name="arrow" size={16} /></button></div></div></section>}
  </div>;
}
