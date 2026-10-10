import React, { useEffect, useMemo, useRef, useState } from 'react';
import { prefillAssetDraft } from './ai-prefill.mjs';
import { suggestAssetTag, assetPhotoCaption } from './asset-presentation.mjs';
import { LifecyclePanel } from './lifecycle.jsx';
import { apiRequest, isLocal, uploadPhoto, uploadAndAnalyzePhoto, analyzeExistingPhoto } from './auth.js';

const STATUSES = ['Available', 'Assigned', 'Checked Out', 'In Maintenance', 'Damaged', 'Lost', 'Stolen', 'Retired'];

export function canCreateAssets(identity) {
  return identity.groups.includes('Technician') || identity.groups.includes('Administrator');
}

function canPatchAssets(identity) {
  return identity.groups.includes('Employee') || identity.groups.includes('Technician') || identity.groups.includes('Administrator');
}

function isAssetsPage(page) {
  return page === '/assets' || page.startsWith('/assets/');
}

export { isAssetsPage };

function emptyCreate() {
  return {
    assetTag: '', category: '', description: '', manufacturer: '', model: '', serialNumber: '',
    purchaseDate: '', purchaseValue: '', salvageValue: '', usefulLifeYears: '4',
    assignedUserId: '', assignedEmail: '', department: '', building: '', room: '',
    condition: 'Good', status: 'Available',
  };
}

function money(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return Number(value).toLocaleString(undefined, { style: 'currency', currency: 'USD' });
}

export function AssetsView({ identity, page, navigate, busy, act }) {
  if (page === '/assets/new') {
    return <AssetCreate identity={identity} navigate={navigate} busy={busy} act={act} />;
  }
  const detail = page.match(/^\/assets\/([^/]+)$/);
  if (detail) {
    return <AssetDetail id={decodeURIComponent(detail[1])} identity={identity} navigate={navigate} busy={busy} act={act} />;
  }
  return <AssetList identity={identity} navigate={navigate} busy={busy} act={act} />;
}

function AssetList({ identity, navigate, busy, act }) {
  const [assets, setAssets] = useState([]);
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const creator = canCreateAssets(identity);

  async function load(next = { q, tag, status, category }) {
    const params = new URLSearchParams();
    if (next.q.trim()) params.set('q', next.q.trim());
    if (next.tag.trim()) params.set('tag', next.tag.trim());
    if (next.status) params.set('status', next.status);
    if (next.category.trim()) params.set('category', next.category.trim());
    const query = params.toString();
    const data = await apiRequest('/assets' + (query ? '?' + query : ''));
    setAssets(data.assets || []);
  }

  useEffect(() => { act(() => load()); }, []);

  return <section>
    <span className="eyebrow">03 / ASSETS</span>
    <h2>Asset records</h2>
    <p>The API only returns assets your group is allowed to see. Search uses an exact tag, or filters the visible list.</p>
    <form className="search-grid" onSubmit={event => { event.preventDefault(); act(() => load()); }}>
      <label>Search<input value={q} onChange={e => setQ(e.target.value)} placeholder="Tag, model, serial" /></label>
      <label>Exact tag<input value={tag} onChange={e => setTag(e.target.value)} placeholder="LAP-001" /></label>
      <label>Status<select value={status} onChange={e => setStatus(e.target.value)}>
        <option value="">Any</option>
        {STATUSES.map(name => <option key={name}>{name}</option>)}
      </select></label>
      <label>Category<input value={category} onChange={e => setCategory(e.target.value)} /></label>
      <button className="primary" disabled={busy}>Search</button>
    </form>
    {creator && <p><button className="primary" disabled={busy} onClick={() => navigate('/assets/new')}>Register asset</button></p>}
    {identity.groups.includes('Manager') && !identity.department && <p role="status">Your account has no department. Ask an administrator to assign one.</p>}
    {!assets.length && <p className="hint">No assets match this view.</p>}
    {!!assets.length && <div className="table-wrap"><table className="asset-table">
      <thead><tr><th>Tag</th><th>Category</th><th>Status</th><th>Department</th><th>Book value</th></tr></thead>
      <tbody>
        {assets.map(asset => <tr key={asset.assetId}>
          <td><button className="link" onClick={() => navigate('/assets/' + asset.assetId)}>{asset.assetTag}</button></td>
          <td>{asset.category}</td>
          <td>{asset.status}</td>
          <td>{asset.department}</td>
          <td>{money(asset.currentBookValue)}</td>
        </tr>)}
      </tbody>
    </table></div>}
  </section>;
}

function AssetCreate({ identity, navigate, busy, act }) {
  const [form, setForm] = useState(emptyCreate);
  const [photoKey, setPhotoKey] = useState(null);
  const [preview, setPreview] = useState(null);
  const [suggestion, setSuggestion] = useState(null);
  const [analyzeStatus, setAnalyzeStatus] = useState(''); // '', 'analyzing', 'done', 'error'
  const [analyzeError, setAnalyzeError] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [existingAssets, setExistingAssets] = useState(null);
  const [automaticTag, setAutomaticTag] = useState(true);
  const [tagError, setTagError] = useState('');
  useEffect(() => {
    if (!canCreateAssets(identity)) return;
    let active = true;
    apiRequest('/assets').then(data => { if (active) setExistingAssets(data.assets || []); })
      .catch(() => { if (active) setTagError('Tag suggestion unavailable. Enter a unique tag manually.'); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (automaticTag && existingAssets) {
      setForm(current => ({ ...current, assetTag: suggestAssetTag(current.category, existingAssets) }));
    }
  }, [form.category, existingAssets, automaticTag]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const inputRef = useRef(null);
  const beforePhoto = useRef(null);
  const canAnalyze = !isLocal && (identity.groups.includes('Technician') || identity.groups.includes('Administrator'));

  if (!canCreateAssets(identity)) {
    return <section>
      <span className="eyebrow">03 / ASSETS</span>
      <h2>Create is not available</h2>
      <p>Employee, Manager, and Auditor cannot register assets. The API returns 403 for those groups.</p>
      <button onClick={() => navigate('/assets')}>Back to assets</button>
    </section>;
  }

  function set(name, value) {
    if (name === 'assetTag') setAutomaticTag(false);
    setForm(current => ({ ...current, [name]: value }));
  }

  async function handlePhotoChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      setAnalyzeError('Only JPEG and PNG files are supported.');
      return;
    }
    if (file.size > 3_500_000) {
      setAnalyzeError('File must be 3.5 MB or smaller.');
      return;
    }
    setAnalyzeError('');
    beforePhoto.current = form;
    setPhotoKey(null);
    setReviewed(false);
    setPreview(URL.createObjectURL(file));
    setAnalyzeStatus('analyzing');
    setSuggestion(null);
    try {
      const result = await uploadAndAnalyzePhoto(file);
      setPhotoKey(result.imageKey);
      setSuggestion(result.suggestion);
      setAnalyzeStatus('done');
      setForm(current => prefillAssetDraft(current, result.suggestion, beforePhoto.current));
    } catch (err) {
      // If upload succeeded but analysis failed, err.imageKey may be set
      if (err.imageKey) setPhotoKey(err.imageKey);
      setAnalyzeStatus('error');
      setAnalyzeError(err.imageKey
        ? 'Your photo was uploaded, but AI suggestions could not be used. Enter the details manually or choose another photo. ' + err.message
        : err.message);
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (photoKey && !reviewed) { setAnalyzeError('Review the photo and asset details before saving'); return; }
    await act(async () => {
      const created = await apiRequest('/assets', {
        method: 'POST',
        body: {
          ...form,
          ...(photoKey ? { photoKey } : {}),
          aiReviewStatus: suggestion?.reviewStatus === 'MANUAL_ENTRY_REQUIRED' || !suggestion ? 'ManualEntry' : 'UserCorrected',
          purchaseValue: Number(form.purchaseValue),
          salvageValue: Number(form.salvageValue),
          usefulLifeYears: Number(form.usefulLifeYears),
        },
      });
      navigate('/assets/' + created.assetId);
    });
  }

  return <section>
    <span className="eyebrow">03 / ASSETS</span>
    <h2>Register an asset</h2>

    {canAnalyze && <div className="photo-upload">
      <h3>Step 1 — Upload a photo (optional)</h3>
      <p className="hint">AI can suggest a category, description, visible manufacturer, condition, and useful life. Review every suggestion before saving. Prices, dates, exact model, serial number, location, and assignments must be entered or verified manually.</p>
      <div className="photo-upload-row">
        <label className="file-label">
          Choose photo
          <input ref={inputRef} type="file" accept="image/jpeg,image/png"
            onChange={handlePhotoChange} disabled={busy || analyzeStatus === 'analyzing'} />
        </label>
        {analyzeStatus === 'analyzing' && <span className="hint">Uploading and analyzing…</span>}
        {analyzeStatus === 'done' && <span className="success" style={{padding:'6px 12px'}}>{suggestion?.reviewStatus === 'MANUAL_ENTRY_REQUIRED' ? 'Manual entry needed - photo retained' : 'AI suggestions ready - review the draft below'}</span>}
      </div>
      {analyzeError && <p className="error" role="alert">{analyzeError}</p>}
      {preview && <div className="photo-preview"><img src={preview} alt="Preview of selected asset photo" /></div>}
      {suggestion && <div className="ai-suggestion">
        <strong>AI confidence: {Math.round(suggestion.confidence * 100)}%</strong>
        {suggestion.reviewStatus === 'MANUAL_ENTRY_REQUIRED' && (
          <p className="hint">AI could not reliably identify this photo. No suggestions were applied; please enter the details manually.</p>
        )}
        {suggestion.reviewStatus === 'REVIEW_REQUIRED' && <dl><dt>Possible product family</dt><dd>{suggestion.possibleModelFamily || 'Not identified'} - unverified, not an exact model</dd><dt>Suggested maintenance category</dt><dd>{suggestion.maintenanceCategory.replaceAll('_', ' ')} - guidance only</dd></dl>}
        {suggestion.uncertaintyNotes?.length > 0 && (
          <ul className="hint">{suggestion.uncertaintyNotes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        )}
        <button type="button" disabled={busy} onClick={() => { setForm(beforePhoto.current || emptyCreate()); setSuggestion(null); setReviewed(false); setAnalyzeStatus(''); }}>Reject suggestions and enter details manually</button>
      </div>}
    </div>}

    <form className="form-grid" onSubmit={submit}>
      {photoKey && <label className="wide"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} required /> I reviewed the photograph, corrected the suggested details, and approve saving this record.</label>}
      {canAnalyze && <p className="wide hint" style={{margin:'4px 0 0'}}>
        {photoKey ? 'Step 2 — Review the pre-filled fields, complete any missing ones, then save.' : 'Fill in the asset details below.'}
      </p>}
      {[['assetTag', 'Asset tag'], ['category', 'Category'], ['manufacturer', 'Manufacturer'], ['model', 'Model'],
        ['serialNumber', 'Serial number'], ['assignedUserId', 'Assigned user id'], ['assignedEmail', 'Assigned email'],
        ['department', 'Department'], ['building', 'Building'], ['room', 'Room']].map(([name, label]) =>
        <label key={name}>{label}<input required={!['manufacturer', 'model', 'serialNumber', 'assignedUserId', 'assignedEmail'].includes(name)} value={form[name]} onChange={e => set(name, e.target.value)} /></label>)}
      <p className="wide hint">Tags use the first three category letters and the next number, for example MOU-001, MOU-002. You can edit the suggestion; the server rejects duplicates. {tagError}</p>
      {!automaticTag && <button type="button" disabled={!existingAssets} onClick={() => setAutomaticTag(true)}>Use suggested tag</button>}
      <p className="wide hint">Leave unknown manufacturer, model, or serial details blank. A department is required; an administrator can assign an employee later.</p>
      <label>Purchase date<input required type="date" value={form.purchaseDate} onChange={e => set('purchaseDate', e.target.value)} /></label>
      <label>Purchase value<input required type="number" min="0" step="0.01" value={form.purchaseValue} onChange={e => set('purchaseValue', e.target.value)} /></label>
      <label>Salvage value<input required type="number" min="0" step="0.01" value={form.salvageValue} onChange={e => set('salvageValue', e.target.value)} /></label>
      <label>Useful life (years)<input required type="number" min="1" max="80" value={form.usefulLifeYears} onChange={e => set('usefulLifeYears', e.target.value)} /></label>
      <label>Condition<input required value={form.condition} onChange={e => set('condition', e.target.value)} /></label>
      <label>Status<select value={form.status} onChange={e => set('status', e.target.value)}>
        {STATUSES.map(name => <option key={name}>{name}</option>)}
      </select></label>
      <label className="wide">Description<textarea required value={form.description} onChange={e => set('description', e.target.value)} /></label>
      <div className="actions">
        <button className="primary" disabled={busy || analyzeStatus === 'analyzing' || (photoKey && !reviewed)}>Save asset</button>
        <button type="button" disabled={busy} onClick={() => navigate('/assets')}>Cancel</button>
      </div>
    </form>
  </section>;
}

function AiAnalysisPanel({ asset, identity, busy, act, onUpdated }) {
  const [suggestion, setSuggestion] = useState(null);
  const [status, setStatus] = useState(''); // '', 'analyzing', 'done', 'error'
  const [error, setError] = useState('');
  const canAnalyze = !isLocal &&
    (identity.groups.includes('Technician') || identity.groups.includes('Administrator'));

  if (!canAnalyze || !asset.photoKey) return null;

  async function handleAnalyze() {
    setStatus('analyzing');
    setError('');
    setSuggestion(null);
    await act(async () => {
      try {
        const s = await analyzeExistingPhoto(asset.photoKey);
        setSuggestion(s);
        setStatus('done');
      } catch (err) {
        setStatus('error');
        setError(err.message);
        throw err;
      }
    });
  }

  async function handleApply() {
    if (!suggestion) return;
    // Map AI fields to patchable asset fields and save
    const body = {};
    if (suggestion.category)              body.category    = suggestion.category;
    if (suggestion.manufacturer)          body.manufacturer = suggestion.manufacturer;
    if (suggestion.description)           body.description  = suggestion.description;
    if (suggestion.suggestedUsefulLifeYears) body.usefulLifeYears = suggestion.suggestedUsefulLifeYears;
    if (suggestion.visibleCondition && suggestion.visibleCondition !== 'UNKNOWN') {
      body.condition = suggestion.visibleCondition.charAt(0) +
        suggestion.visibleCondition.slice(1).toLowerCase();
    }
    if (!Object.keys(body).length) return;
    if (!identity.groups.includes('Administrator')) {
      for (const field of Object.keys(body)) if (field !== 'condition') delete body[field];
    }
    body.aiReviewStatus = 'UserConfirmed';
    await act(async () => {
      const updated = await apiRequest('/assets/' + encodeURIComponent(asset.assetId), {
        method: 'PATCH', body,
      });
      setSuggestion(null);
      setStatus('');
      onUpdated(updated);
    });
  }

  return (
    <div className="photo-upload">
      <h3>AI analysis</h3>
      <p className="hint">Ask Bedrock to re-analyze the existing photo and suggest updated field values. You review before anything is saved.</p>
      <div className="photo-upload-row">
        <button className="primary" type="button"
          disabled={busy || status === 'analyzing'}
          onClick={handleAnalyze}>
          {status === 'analyzing' ? 'Analyzing…' : 'Analyze photo with AI'}
        </button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {suggestion && (
        <div className="ai-suggestion">
          <strong>AI confidence: {Math.round(suggestion.confidence * 100)}%
            {' '}({suggestion.reviewStatus === 'MANUAL_ENTRY_REQUIRED' ? 'manual entry required' : 'review required'})
          </strong>
          <dl className="detail-list" style={{fontSize:'.9rem'}}>
            {suggestion.category          && <><dt>Category</dt><dd>{suggestion.category}</dd></>}
            {suggestion.manufacturer      && <><dt>Manufacturer</dt><dd>{suggestion.manufacturer}</dd></>}
            {suggestion.possibleModelFamily && <><dt>Model family</dt><dd>{suggestion.possibleModelFamily}</dd></>}
            {suggestion.description       && <><dt>Description</dt><dd>{suggestion.description}</dd></>}
            {suggestion.visibleCondition  && <><dt>Condition</dt><dd>{suggestion.visibleCondition}</dd></>}
            {suggestion.suggestedUsefulLifeYears && <><dt>Useful life</dt><dd>{suggestion.suggestedUsefulLifeYears} years</dd></>}
            {suggestion.maintenanceCategory && <><dt>Maintenance</dt><dd>{suggestion.maintenanceCategory}</dd></>}
          </dl>
          {suggestion.uncertaintyNotes?.length > 0 && (
            <ul className="hint">{suggestion.uncertaintyNotes.map((n, i) => <li key={i}>{n}</li>)}</ul>
          )}
          {suggestion.reviewStatus !== 'MANUAL_ENTRY_REQUIRED' && (
            <div className="actions" style={{marginTop:'12px'}}>
              <button className="primary" type="button" disabled={busy} onClick={handleApply}>
                Apply suggestions to asset
              </button>
              <button type="button" disabled={busy} onClick={() => { setSuggestion(null); setStatus(''); }}>
                Discard
              </button>
            </div>
          )}
          {suggestion.reviewStatus === 'MANUAL_ENTRY_REQUIRED' && (
            <p className="hint">Confidence too low to apply automatically — update fields manually above.</p>
          )}
        </div>
      )}
    </div>
  );
}

function PhotoUpload({ assetId, identity, busy, act, onUploaded }) {
  const inputRef = useRef(null);
  const [preview, setPreview] = useState(null);
  const [file, setFile] = useState(null);
  const [uploadStatus, setUploadStatus] = useState(''); // '', 'uploading', 'done', 'error'
  const [uploadError, setUploadError] = useState('');
  const canUpload = identity.groups.includes('Technician') || identity.groups.includes('Administrator');

  if (isLocal) return (
    <div className="photo-upload">
      <h3>Asset photo</h3>
      <p className="hint">Photo upload is not available in local demo mode.</p>
    </div>
  );
  if (!canUpload) return null;

  function handleFileChange(e) {
    const chosen = e.target.files?.[0];
    if (!chosen) return;
    if (!['image/jpeg', 'image/png'].includes(chosen.type)) {
      setUploadError('Only JPEG and PNG files are supported.');
      return;
    }
    if (chosen.size > 3_500_000) {
      setUploadError('File must be 3.5 MB or smaller.');
      return;
    }
    setUploadError('');
    setFile(chosen);
    setPreview(URL.createObjectURL(chosen));
    setUploadStatus('');
  }

  async function handleUpload() {
    if (!file) return;
    setUploadStatus('uploading');
    setUploadError('');
    await act(async () => {
      try {
        const imageKey = await uploadPhoto(file);
        // Save the imageKey onto the asset record
        const updated = await apiRequest('/assets/' + encodeURIComponent(assetId), {
          method: 'PATCH',
          body: { photoKey: imageKey },
        });
        setUploadStatus('done');
        setFile(null);
        setPreview(null);
        if (inputRef.current) inputRef.current.value = '';
        onUploaded(updated);
      } catch (err) {
        setUploadStatus('error');
        setUploadError(err.message);
        throw err; // let act() surface it in the page error banner too
      }
    });
  }

  function handleClear() {
    setFile(null);
    setPreview(null);
    setUploadStatus('');
    setUploadError('');
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <div className="photo-upload">
      <h3>Asset photo</h3>
      <p className="hint">JPEG or PNG, max 3.5 MB. Uploading replaces the current photo key on this asset.</p>
      <div className="photo-upload-row">
        <label className="file-label">
          Choose photo
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png"
            onChange={handleFileChange}
            disabled={busy}
          />
        </label>
        {file && (
          <button type="button" onClick={handleClear} disabled={busy}>Clear</button>
        )}
      </div>
      {uploadError && <p className="error" role="alert">{uploadError}</p>}
      {preview && (
        <div className="photo-preview">
          <img src={preview} alt="Preview of selected photo" />
        </div>
      )}
      {file && uploadStatus !== 'done' && (
        <button
          className="primary"
          type="button"
          disabled={busy || uploadStatus === 'uploading'}
          onClick={handleUpload}
        >
          {uploadStatus === 'uploading' ? 'Uploading…' : 'Upload photo'}
        </button>
      )}
      {uploadStatus === 'done' && (
        <p className="success" role="status">Photo uploaded and saved to this asset.</p>
      )}
    </div>
  );
}

function AssetSummary({ asset }) {
  const [photo, setPhoto] = useState('');
  const [photoStatus, setPhotoStatus] = useState('');
  useEffect(() => {
    let active = true;
    setPhoto('');
    setPhotoStatus(asset.photoKey && !isLocal ? 'loading' : 'missing');
    if (asset.photoKey && !isLocal) {
      apiRequest('/assets/' + encodeURIComponent(asset.assetId) + '/photo')
        .then(data => { if (active) { setPhoto(data.url); setPhotoStatus('ready'); } })
        .catch(() => { if (active) setPhotoStatus('error'); });
    }
    return () => { active = false; };
  }, [asset.assetId, asset.photoKey, asset.updatedAt]);
  return <header className="asset-summary">
    <figure className="asset-summary-image">
      {photo && photoStatus === 'ready'
        ? <img className="asset-photo" src={photo} alt={asset.category + ' · ' + asset.assetTag}
            onError={() => { setPhoto(''); setPhotoStatus('error'); }} />
        : <div className="asset-image-placeholder" role="status">{photoStatus === 'loading' ? 'Loading private image…' : photoStatus === 'error' ? 'Image unavailable. Refresh this page to retry.' : 'No image attached yet'}</div>}
      {photo && <figcaption>{assetPhotoCaption(asset.photoKey)}</figcaption>}
    </figure>
    <div className="asset-summary-copy">
      <span className="eyebrow">03 / ASSET RECORD</span>
      <h2>{asset.assetTag}</h2>
      <p className="asset-description">{asset.description}</p>
      <div className="actions"><span className="scope-pill">{asset.category}</span><span className="scope-pill">{asset.status}</span></div>
    </div>
  </header>;
}

function AssetDetail({ id, identity, navigate, busy, act }) {
  const [asset, setAsset] = useState(null);
  const [patch, setPatch] = useState({});
  const groups = identity.groups;
  const employeeOnly = groups.includes('Employee') && !groups.includes('Technician') && !groups.includes('Administrator');
  const technician = groups.includes('Technician') && !groups.includes('Administrator');
  const admin = groups.includes('Administrator');

  async function load() {
    const data = await apiRequest('/assets/' + encodeURIComponent(id));
    setAsset(data);
    setPatch(employeeOnly
      ? { status: data.status, condition: data.condition, problemNote: data.problemNote || '' }
      : technician
        ? {
            status: data.status, condition: data.condition,
            lastCleaningDate: data.lastCleaningDate || '', lastMaintenanceDate: data.lastMaintenanceDate || '',
            nextMaintenanceDate: data.nextMaintenanceDate || '', expectedReplacementDate: data.expectedReplacementDate || '',
          }
        : admin
          ? {
              assetTag: data.assetTag, category: data.category, description: data.description,
              manufacturer: data.manufacturer, model: data.model, serialNumber: data.serialNumber,
              purchaseDate: data.purchaseDate, purchaseValue: data.purchaseValue, salvageValue: data.salvageValue,
              usefulLifeYears: data.usefulLifeYears, assignedUserId: data.assignedUserId, assignedEmail: data.assignedEmail,
              department: data.department, building: data.building, room: data.room, condition: data.condition,
              status: data.status, problemNote: data.problemNote || '',
              lastCleaningDate: data.lastCleaningDate || '', lastMaintenanceDate: data.lastMaintenanceDate || '',
              nextMaintenanceDate: data.nextMaintenanceDate || '', expectedReplacementDate: data.expectedReplacementDate || '',
            }
          : {});
  }
  useEffect(() => { act(load); }, [id]);

  const fields = useMemo(() => asset ? [
    ['Tag', asset.assetTag], ['Status', asset.status], ['Condition', asset.condition],
    ['Category', asset.category], ['Manufacturer', asset.manufacturer], ['Model', asset.model],
    ['Serial', asset.serialNumber], ['Department', asset.department],
    ['Assigned', asset.assignedEmail || asset.assignedUserId],
    ['Location', `${asset.building} ${asset.room}`.trim()],
    ['Purchase date', asset.purchaseDate], ['Purchase value', money(asset.purchaseValue)],
    ['Salvage value', money(asset.salvageValue)], ['Useful life', asset.usefulLifeYears + ' years'],
    ['Book value', money(asset.currentBookValue)], ['Annual depreciation', money(asset.annualDepreciation)],
    ['Accumulated depreciation', money(asset.accumulatedDepreciation)], ['Useful life consumed', asset.usefulLifeConsumed + '%'],
    ['Expected replacement', asset.expectedReplacementDate || 'Not set'],
    ['Last cleaning', asset.lastCleaningDate || 'Not recorded'], ['Last maintenance', asset.lastMaintenanceDate || 'Not recorded'],
    ['Next maintenance', asset.nextMaintenanceDate || 'Not scheduled'], ['Next cleaning', asset.nextCleaningDate || 'Not scheduled'],
    ['Created', asset.createdAt], ['Modified', asset.updatedAt],
    ['Problem note', asset.problemNote || '—'], ['Photo', asset.photoKey || 'none'],
    ['AI review', asset.aiReviewStatus],
  ] : [], [asset]);

  async function save(event) {
    event.preventDefault();
    const body = { ...patch };
    if (body.purchaseValue !== undefined) body.purchaseValue = Number(body.purchaseValue);
    if (body.salvageValue !== undefined) body.salvageValue = Number(body.salvageValue);
    if (body.usefulLifeYears !== undefined) body.usefulLifeYears = Number(body.usefulLifeYears);
    await act(async () => {
      setAsset(await apiRequest('/assets/' + encodeURIComponent(id), { method: 'PATCH', body }));
    });
  }

  if (!asset) return <section><h2>Asset</h2><p>Loading record…</p></section>;
  return <section>
    <AssetSummary key={asset.assetId} asset={asset} />
    <h3>Asset details</h3>
    <dl className="detail-list">{fields.map(([label, value]) => <React.Fragment key={label}><dt>{label}</dt><dd>{String(value)}</dd></React.Fragment>)}</dl>
    {canPatchAssets(identity) && <form className="form-grid" onSubmit={save}>
      <h3>{employeeOnly ? 'Report a problem' : 'Update asset'}</h3>
      {patch.status !== undefined && <label>Status<select value={patch.status} onChange={e => setPatch({ ...patch, status: e.target.value })}>
        {STATUSES.map(name => <option key={name}>{name}</option>)}
      </select></label>}
      {patch.condition !== undefined && <label>Condition<input value={patch.condition} onChange={e => setPatch({ ...patch, condition: e.target.value })} /></label>}
      {patch.problemNote !== undefined && <label className="wide">Problem note<textarea value={patch.problemNote} onChange={e => setPatch({ ...patch, problemNote: e.target.value })} /></label>}
      {patch.lastCleaningDate !== undefined && <label>Last cleaned<input type="date" value={patch.lastCleaningDate} onChange={e => setPatch({ ...patch, lastCleaningDate: e.target.value })} /></label>}
      {patch.lastMaintenanceDate !== undefined && <label>Last maintenance<input type="date" value={patch.lastMaintenanceDate} onChange={e => setPatch({ ...patch, lastMaintenanceDate: e.target.value })} /></label>}
      {patch.nextMaintenanceDate !== undefined && <label>Next maintenance<input type="date" value={patch.nextMaintenanceDate} onChange={e => setPatch({ ...patch, nextMaintenanceDate: e.target.value })} /></label>}
      {patch.expectedReplacementDate !== undefined && <label>Expected replacement<input type="date" value={patch.expectedReplacementDate} onChange={e => setPatch({ ...patch, expectedReplacementDate: e.target.value })} /></label>}
      {admin && <>
        <label>Purchase value<input type="number" min="0" step="0.01" value={patch.purchaseValue} onChange={e => setPatch({ ...patch, purchaseValue: e.target.value })} /></label>
        <label>Salvage value<input type="number" min="0" step="0.01" value={patch.salvageValue} onChange={e => setPatch({ ...patch, salvageValue: e.target.value })} /></label>
        <label>Useful life in years<input type="number" min="1" max="80" value={patch.usefulLifeYears} onChange={e => setPatch({ ...patch, usefulLifeYears: e.target.value })} /></label>
        <label>Purchase date<input type="date" required value={patch.purchaseDate} onChange={e => setPatch({ ...patch, purchaseDate: e.target.value })} /></label>
        {['manufacturer', 'model', 'serialNumber', 'building', 'room'].map(name => <label key={name}>{name}<input value={patch[name]} onChange={e => setPatch({ ...patch, [name]: e.target.value })} /></label>)}
        <label>Asset tag<input value={patch.assetTag} onChange={e => setPatch({ ...patch, assetTag: e.target.value })} /></label>
        <label>Category<input value={patch.category} onChange={e => setPatch({ ...patch, category: e.target.value })} /></label>
        <label>Department<input value={patch.department} onChange={e => setPatch({ ...patch, department: e.target.value })} /></label>
        <label>Assigned user id<input value={patch.assignedUserId} onChange={e => setPatch({ ...patch, assignedUserId: e.target.value })} /></label>
        <label>Assigned email<input value={patch.assignedEmail} onChange={e => setPatch({ ...patch, assignedEmail: e.target.value })} /></label>
        <label className="wide">Description<textarea value={patch.description} onChange={e => setPatch({ ...patch, description: e.target.value })} /></label>
      </>}
      <button className="primary" disabled={busy}>Save changes</button>
    </form>}
    <LifecyclePanel asset={asset} identity={identity} busy={busy} act={act} onChanged={load} />
    <PhotoUpload assetId={id} identity={identity} busy={busy} act={act} onUploaded={updated => setAsset(updated)} />
    <AiAnalysisPanel asset={asset} identity={identity} busy={busy} act={act} onUpdated={updated => setAsset(updated)} />
    <p><button type="button" onClick={() => navigate('/assets')}>Back to assets</button></p>
  </section>;
}
