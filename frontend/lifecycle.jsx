import React, { useEffect, useState } from 'react';
import { apiRequest, isLocal } from './auth.js';

export function LifecyclePanel({ asset, identity, busy, act, onChanged }) {
  const [records, setRecords] = useState([]);
  const [history, setHistory] = useState([]);
  const [recommendation, setRecommendation] = useState(null);
  const [interval, setInterval] = useState('');
  const [kind, setKind] = useState('maintenance');
  const [approved, setApproved] = useState(false);
  const [notes, setNotes] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [type, setType] = useState('Inspection');
  const [cost, setCost] = useState('0');
  const [problem, setProblem] = useState('');
  const tech = identity.groups.some(g => ['Technician', 'Administrator'].includes(g));
  const audit = identity.groups.some(g => ['Auditor', 'Administrator', 'Manager'].includes(g));
  const base = '/assets/' + encodeURIComponent(asset.assetId);
  async function load() {
    setRecords((await apiRequest(base + '/maintenance')).records);
    if (audit) setHistory((await apiRequest(base + '/history')).records);
  }
  useEffect(() => { act(load); }, [asset.assetId, asset.updatedAt, asset.photoKey]);
  return <>
    {identity.groups.includes('Employee') && asset.assignedUserId === identity.subject && <form onSubmit={e => {
      e.preventDefault(); act(async () => { await apiRequest(base + '/reports', { method: 'POST', body: { description: problem } }); setProblem(''); });
    }}><h3>Report a problem</h3><label>Description<textarea required maxLength={1000} value={problem} onChange={e => setProblem(e.target.value)} /></label><button disabled={busy}>Submit report</button></form>}
    <h3>Maintenance history</h3>
    {!records.length && <p>No maintenance recorded.</p>}
    {records.map(r => <article key={r.recordId}><strong>{r.performedDate} · {r.maintenanceType}</strong><p>{r.notes} · ${r.cost}</p></article>)}
    {tech && <form className="form-grid" onSubmit={e => { e.preventDefault(); act(async () => {
      await apiRequest(base + '/maintenance', { method: 'POST', body: { maintenanceType: type, performedDate: date, notes, cost: Number(cost) } });
      setNotes(''); await onChanged();
    }); }}><h3 className="wide">Record completed maintenance</h3>
      <label>Type<select value={type} onChange={e => setType(e.target.value)}>{['Cleaning','Inspection','Repair','Replacement'].map(t => <option key={t}>{t}</option>)}</select></label>
      <label>Performed date<input type="date" required value={date} max={new Date().toISOString().slice(0,10)} onChange={e => setDate(e.target.value)} /></label>
      <label>Cost<input type="number" min="0" step="0.01" required value={cost} onChange={e => setCost(e.target.value)} /></label>
      <label className="wide">Notes<textarea required maxLength={1000} value={notes} onChange={e => setNotes(e.target.value)} /></label>
      <button disabled={busy}>Save maintenance record</button>
    </form>}
    {tech && <section><h3>AI maintenance recommendation</h3>
      {isLocal ? <p>Bedrock runs after AWS deployment. No AI results are simulated here.</p> : <button disabled={busy} onClick={() => act(async () => {
        const data = await apiRequest(base + '/maintenance-recommendation', { method: 'POST' });
        setRecommendation(data.recommendation); setInterval(String(data.recommendation.maintenanceIntervalDays || '')); setApproved(false);
      })}>Get AI recommendation</button>}
      {recommendation && <article><strong>{recommendation.priority}: {recommendation.recommendedAction}</strong><p>{recommendation.explanation}</p><p>Completion date: {recommendation.recommendedCompletionDate || 'Choose during review'} · Replacement window: {recommendation.expectedReplacementWindow || 'Not established'}</p><p>Review this suggestion before approving a schedule.</p></article>}
      <form className="form-grid" onSubmit={e => { e.preventDefault(); act(async () => {
        await apiRequest(base + '/maintenance-approval', { method: 'POST', body: { kind, intervalDays: Number(interval) } });
        setApproved(false); await onChanged();
      }); }}>
        <label>Schedule<select value={kind} onChange={e => setKind(e.target.value)}><option value="maintenance">Maintenance</option><option value="cleaning">Cleaning</option></select></label>
        <label>Reviewed interval in days<input type="number" required min="1" max="3650" value={interval} onChange={e => { setInterval(e.target.value); setApproved(false); }} /></label>
        <label className="wide"><input type="checkbox" required checked={approved} onChange={e => setApproved(e.target.checked)} /> I approve this interval. The first due date will be this many days from today.</label>
        <button disabled={busy || !approved}>Approve schedule</button>
      </form>
    </section>}
    {audit && <section><h3>Change history</h3>{!history.length && <p>No changes recorded since history tracking was enabled.</p>}
      {history.map(r => <details key={r.recordId}><summary>{r.recordedAt} · {r.action} · {r.actor}</summary><pre>{JSON.stringify({ before: r.before, after: r.after }, null, 2)}</pre></details>)}
    </section>}
  </>;
}

export function ReportsView({ busy, act, identity }) {
  const [reports, setReports] = useState([]);
  async function load() { setReports((await apiRequest('/reports')).reports); }
  useEffect(() => { act(load); }, []);
  return <section><h2>Problem reports</h2>{!reports.length && <p>No reports available for your account.</p>}
    {reports.map(r => <article key={r.recordId}><h3>{r.assetTag} · {r.status}</h3><p>{r.description}</p><p>{r.department} · {r.createdAt}</p>
      {identity.groups.includes('Administrator') && <select aria-label="Report status" disabled={busy} value={r.status} onChange={e => act(async () => {
        await apiRequest('/assets/' + encodeURIComponent(r.assetId) + '/reports-status', { method: 'POST', body: { recordId: r.recordId, status: e.target.value } }); await load();
      })}>{['Open','In Progress','Resolved'].map(s => <option key={s}>{s}</option>)}</select>}
    </article>)}
  </section>;
}
