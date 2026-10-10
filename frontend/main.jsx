import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { completeSignIn, getAccessToken, getDisplayEmail, getProtected, isLocal, signIn, signOut } from './auth.js';
import { userLabel } from './user-display.mjs';
import { SIGN_IN_ROLES, SIGN_IN_ROLE_KEY, SIGN_IN_DESTINATION, rolePreferenceNotice } from './sign-in-policy.mjs';
import { AssetsView, canCreateAssets, isAssetsPage } from './assets.jsx';
import { ReportsView } from './lifecycle.jsx';
import { UsersView } from './users.jsx';
import { Dashboard, Icon } from './workspace.jsx';
import { DepreciationView } from './depreciation.jsx';
import './styles.css';

let initialization;
function App() {
  const [identity, setIdentity] = useState(null);
  const [group, setGroup] = useState('');
  const [roleNotice, setRoleNotice] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const [page, setPage] = useState(window.location.pathname);

  async function loadIdentity() {
    try {
      if (!isLocal && !(await getAccessToken())) {
        setIdentity(null);
        return;
      }
      const verifiedIdentity = await getProtected('/demo');
      const email = await getDisplayEmail(verifiedIdentity.subject);
      setIdentity({ ...verifiedIdentity, email });
      // Store only a non-secret UI preference across the sign-in redirect.
      // Storage can be unavailable; that must not prevent authentication.
      try {
        const preference = sessionStorage.getItem(SIGN_IN_ROLE_KEY);
        sessionStorage.removeItem(SIGN_IN_ROLE_KEY);
        setRoleNotice(rolePreferenceNotice(preference, verifiedIdentity.groups));
      } catch { setRoleNotice(''); }
    } catch (err) {
      setIdentity(null);
      if (err.status === 401 || err.status === 403) return;
      throw err;
    }
  }
  useEffect(() => {
    initialization ??= completeSignIn();
    initialization.then(loadIdentity).catch(err => setError(err.message))
      .finally(() => { setPage(window.location.pathname); setBusy(false); });
    const onPop = () => setPage(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  function navigate(path) { history.pushState(null, '', path); setPage(path); setResult(''); setError(''); }
  async function act(action) {
    setBusy(true); setError(''); setResult('');
    try { await action(); }
    catch (err) { setError(err.message); if (err.status === 401) setIdentity(null); }
    finally { setBusy(false); }
  }
  async function login() {
    try { sessionStorage.setItem(SIGN_IN_ROLE_KEY, group); } catch { /* Optional UI preference only. */ }
    await signIn(group || 'Employee');
    if (isLocal || await getAccessToken()) {
      await loadIdentity();
      navigate(SIGN_IN_DESTINATION);
    }
  }
  async function logout() {
    await signOut();
    setIdentity(null); setRoleNotice(''); navigate('/');
  }
  const isAdmin = identity?.groups.includes('Administrator');
  const needsSignIn = ['/protected', '/reports', '/users', '/depreciation'].includes(page) || isAssetsPage(page);
  const navigation = [
    ['/', 'Overview', 'grid'], ['/assets', 'Assets', 'box'], ['/depreciation', 'Depreciation', 'chart'],
    ...(identity && canCreateAssets(identity) ? [['/assets/new', 'Register asset', 'plus']] : []),
    ...(identity ? [['/reports', 'Reports', 'report']] : []),
    ...(isAdmin ? [['/users', 'Users', 'users']] : []),
  ];
  const currentLabel = page === '/protected' ? 'Security checks' : navigation.find(([path]) => path === page)?.[1] || 'Asset record';
  return <div className={`app-shell${identity ? '' : ' landing-shell'}`}>
    <a className="skip-link" href="#workspace">Skip to content</a>
    {identity && <aside className="sidebar">
      <button className="brand" onClick={() => navigate('/')} aria-label="SALT overview"><span className="brand-mark"><Icon name="box" size={25} /></span><span>SALT<span className="brand-sub">ASSET INTELLIGENCE</span></span></button>
      <span className="nav-caption">WORKSPACE</span>
      <nav aria-label="Workspace navigation">{navigation.map(([path, label, icon]) => <button key={path} onClick={() => navigate(path)} aria-current={(path === '/assets' ? isAssetsPage(page) && page !== '/assets/new' : page === path) ? 'page' : undefined}><Icon name={icon} /><span>{label}</span></button>)}</nav>
      <div className="sidebar-bottom"><div className="system-label"><span className="status-dot" />{isLocal ? 'Local demonstration' : 'Cognito secured'}</div><p>Asset lifecycle workspace</p>{identity && <button className="logout-button" disabled={busy} onClick={() => act(logout)}><Icon name="exit" />Sign out</button>}</div>
    </aside>}
    <div className="workspace-body"><header className="topbar">{identity ? <div className="breadcrumb">Workspace <span>/</span> <strong>{currentLabel}</strong></div> : <div className="brand landing-brand"><span className="brand-mark"><Icon name="box" size={25} /></span><span>SALT<span className="brand-sub">ASSET INTELLIGENCE</span></span></div>}<div className="identity-pill"><span className="avatar"><Icon name={identity ? 'users' : 'shield'} size={18} /></span><div><strong>{identity ? userLabel(identity.email, 'Signed-in user') : 'Secure sign in'}</strong><span>{identity ? identity.groups.join(' · ') : 'Your workspace awaits'}</span></div></div></header>
    <main id="workspace" tabIndex="-1">
    {isLocal && <aside className="banner local"><strong>LOCAL DEMONSTRATION</strong><span>Fake sign-in and example data. The role picker is not real authentication.</span></aside>}
    {error && <p role="alert" className="error">{error}</p>}
    {identity && roleNotice && <p role="status" className="banner">{roleNotice}</p>}
    {busy && <p className="loading-indicator" role="status">Working…</p>}
    {!identity && !busy && <div className="login-grid"><div className="login-intro"><span className="eyebrow">SMART ASSET LIFECYCLE TRACKER</span><h1>Your assets.<br /><span>Future ready.</span></h1><p className="intro">A clearer view of every asset, from its first photograph to its next chapter.</p><div className="login-feature"><Icon name="spark" /><span>AI photo identification and maintenance guidance</span></div><div className="login-feature"><Icon name="chart" /><span>Transparent value and depreciation tracking</span></div><div className="login-feature"><Icon name="shield" /><span>Access tailored to your role and department</span></div></div><section className="login-card">
      <span className="eyebrow">01 / SIGN IN</span>
      <h2>{needsSignIn ? 'Sign in to your workspace' : 'Welcome to SALT'}</h2>
      <p>{isLocal ? 'Try Employee first, then Administrator to compare permissions.' : 'Sign in securely with your organization account. Password recovery is available on the sign-in screen.'}</p>
      <label>{isLocal ? 'Demo role' : 'Sign-in role'}<select value={group} onChange={e => setGroup(e.target.value)}>
        <option value="">{isLocal ? 'Employee (default)' : 'Use my assigned role'}</option>
        {SIGN_IN_ROLES.map(role => <option key={role.value} value={role.value}>{role.label}</option>)}
      </select></label>
      {!isLocal && <p className="hint">Choose your role, or let SALT use your assigned role. Your account must already have the selected permissions.</p>}
      <button className="primary" disabled={busy} onClick={() => act(login)}>
        {isLocal ? 'Start local demo' : (busy ? 'Opening secure sign-in…' : 'Sign in')}
      </button>
    </section></div>}
    {identity && page === '/' && <Dashboard identity={identity} busy={busy} act={act} navigate={navigate} />}
    {identity && page === '/depreciation' && <DepreciationView busy={busy} act={act} navigate={navigate} />}
    {identity && page === '/protected' && <section>
      <span className="eyebrow">SECURITY / DEMONSTRATION CHECKS</span><h2>Verify protected access</h2>
      <p>These optional checks demonstrate that the backend verifies sign-in and enforces Administrator permissions. They do not create or manage assets.</p>
      <dl><dt>User</dt><dd>{userLabel(identity.email)}</dd><dt>Groups</dt><dd>{identity.groups.join(', ')}</dd></dl>
      <div className="actions">
        <button className="primary" disabled={busy} onClick={() => act(async () => setResult((await getProtected('/demo')).message))}>Call protected API</button>
        {isAdmin && <button disabled={busy} onClick={() => act(async () => setResult((await getProtected('/admin')).message))}>Open admin demo</button>}
        {!isAdmin && <button disabled={busy} onClick={() => act(async () => setResult((await getProtected('/admin')).message))}>Test denied admin request</button>}
      </div>
      <p className="hint">All five groups can read this demo. Only Administrator can read the admin endpoint.</p>
      <button onClick={() => navigate('/')}>Back to Overview</button>
      {result && <p role="status" className="success">{result}</p>}
    </section>}
    {identity && isAssetsPage(page) && <AssetsView identity={identity} page={page} navigate={navigate} busy={busy} act={act} />}
    {identity && page === '/reports' && <ReportsView identity={identity} busy={busy} act={act} />}
    {identity && isAdmin && page === '/users' && <UsersView busy={busy} act={act} />}
    {identity && !isAdmin && page === '/users' && <p role="alert">User management requires Administrator access.</p>}
    <footer><span>SALT <span className="footer-divider">/</span> Smart Asset Lifecycle Tracker</span><span>AI suggestions require human review · Values calculated by application code</span></footer>
  </main></div></div>;
}
createRoot(document.getElementById('root')).render(<App />);
