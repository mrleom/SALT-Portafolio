import React, { useEffect, useState } from 'react';
import { apiRequest } from './auth.js';
import { money, portfolioTotals, valuePercentage } from './portfolio.mjs';

const paths = {
  grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  box: 'M12 3 3 8v9l9 5 9-5V8L12 3ZM3 8l9 5 9-5M12 13v9M7 5.8l9 5',
  chart: 'M3 3v18h18 M6 7l5 5 4-3 6 7 M17 16h4v-4',
  shield: 'M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7l-9-4ZM8 12l3 3 5-6',
  plus: 'M12 5v14M5 12h14',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM17 4a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.9',
  report: 'M14 2H5v20h14V7l-5-5ZM14 2v5h5M8 12h8M8 16h6',
  exit: 'M9 3H3v18h6M14 8l5 4-5 4M7 12h12',
  arrow: 'M5 12h14M14 7l5 5-5 5',
  spark: 'M12 2l3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7Z',
};
export function Icon({ name, size = 20 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.box} /></svg>;
}
export function Metric({ label, value, detail, icon = 'chart', accent = '' }) {
  return <div className={'metric ' + accent}><div className="metric-label"><span>{label}</span><Icon name={icon} /></div><strong>{value}</strong><span className="hint">{detail}</span></div>;
}
export function useAssets(act) {
  const [assets, setAssets] = useState([]);
  const [loaded, setLoaded] = useState(false);
  async function load() {
    const data = await apiRequest('/assets');
    setAssets(data.assets || []); setLoaded(true);
  }
  useEffect(() => { act(load); }, []);
  return { assets, loaded, load };
}
export function Dashboard({ identity, busy, act, navigate }) {
  const { assets, loaded } = useAssets(act);
  const totals = portfolioTotals(assets);
  const today = new Date().toISOString().slice(0, 10);
  const due = assets.filter(a => [a.nextCleaningDate, a.nextMaintenanceDate].some(d => d && d <= today));
  const flagged = assets.filter(a => ['Damaged', 'In Maintenance', 'Lost', 'Stolen'].includes(a.status));
  const candidates = assets.filter(a => valuePercentage(a) !== null && valuePercentage(a) < 50);
  return <div className="workspace-stack">
    <div className="section-heading"><div><span className="eyebrow">WORKSPACE / OVERVIEW</span><h1>Every asset. <span>One clear picture.</span></h1><p className="intro">Track what you own, understand its value, and plan what comes next.</p></div><div className="scope-pill"><Icon name="shield" size={16} /> Your permitted assets</div></div>
    <div className="metrics-grid">
      <Metric label="Assets in view" value={loaded ? totals.count : '—'} detail="Within your access scope" icon="box" />
      <Metric label="Current book value" value={loaded ? money(totals.book) : '—'} detail={totals.valuedCount + ' assets with financial data'} accent="cyan" />
      <Metric label="Value depreciated" value={loaded ? money(totals.depreciation) : '—'} detail="Calculated using straight-line depreciation" accent="violet" />
      <Metric label="Maintenance due" value={loaded ? due.length : '—'} detail="Cleaning or maintenance due today or earlier" icon="report" accent="amber" />
    </div>
    <div className="dashboard-grid">
      <section className="feature-panel"><span className="eyebrow">LIFECYCLE INTELLIGENCE</span><h2>See the value.<br />Plan the next move.</h2><p>Explore depreciation, compare retained value, and review assets approaching replacement.</p><button className="primary" disabled={busy} onClick={() => navigate('/depreciation')}>Explore depreciation <Icon name="arrow" /></button><div className="orbit-art" aria-hidden="true"><div className="orbit-ring" /><div className="orbit-ring second" /><div className="orbit-core"><Icon name="box" size={58} /></div><span className="orbit-node n1" /><span className="orbit-node n2" /><span className="orbit-node n3" /></div></section>
      <section><div className="panel-title"><div><span className="eyebrow">ATTENTION QUEUE</span><h2>What needs a closer look</h2></div><Icon name="spark" /></div>
        <div className="queue-row"><span className="queue-dot amber" /><div><strong>{loaded ? due.length : '—'} assets with scheduled work due</strong><p>Check approved cleaning and maintenance dates.</p></div></div>
        <div className="queue-row"><span className="queue-dot violet" /><div><strong>{loaded ? candidates.length : '—'} assets below 50% value</strong><p>Review lifecycle and replacement plans.</p></div></div>
        <div className="queue-row"><span className="queue-dot cyan" /><div><strong>{loaded ? flagged.length : '—'} assets with a flagged status</strong><p>Damaged, in maintenance, lost, or stolen.</p></div></div>
        <button className="link" onClick={() => navigate('/assets')}>Open asset inventory <Icon name="arrow" size={16} /></button>
      </section>
    </div>
    <section><div className="panel-title"><div><span className="eyebrow">HUMAN REVIEW BUILT IN</span><h2>AI assists. You approve.</h2></div><Icon name="spark" /></div><div className="capability-grid"><div><span className="step-number">01</span><h3>Identify from a photo</h3><p>Review suggested category, description, condition, and useful life before saving.</p></div><div><span className="step-number">02</span><h3>Understand asset value</h3><p>Application code calculates depreciation, with a protected salvage-value floor.</p></div><div><span className="step-number">03</span><h3>Make maintenance decisions</h3><p>Review AI recommendations and approve an interval before scheduling work.</p></div></div></section>
    {identity.groups.includes('Manager') && !identity.department && <p className="error">Your account needs a department. Ask an administrator to assign one.</p>}
  </div>;
}
