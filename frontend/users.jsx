import React, { useEffect, useState } from 'react';
import { apiRequest, isLocal } from './auth.js';
const roles = ['Employee','Technician','Manager','Administrator','Auditor'];
export function UsersView({ busy, act }) {
  const [users, setUsers] = useState([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('Employee');
  const [department, setDepartment] = useState('');
  const [message, setMessage] = useState('');
  async function load() { setUsers((await apiRequest('/admin/users')).users); }
  useEffect(() => { if (!isLocal) act(load); }, []);
  if (isLocal) return <section><h2>Users</h2><p>User invitations and password resets use Cognito after deployment. Local demonstration accounts are separate.</p></section>;
  return <section><h2>Users</h2>{message && <p role="status">{message}</p>}
    <form className="form-grid" onSubmit={e => { e.preventDefault(); act(async () => {
      const data = await apiRequest('/admin/users', { method:'POST', body:{ email, role, department } });
      setMessage(data.message); setEmail(''); await load();
    }); }}>
      <label>Email<input type="email" required value={email} onChange={e=>setEmail(e.target.value)} /></label>
      <label>Role<select value={role} onChange={e=>setRole(e.target.value)}>{roles.map(r=><option key={r}>{r}</option>)}</select></label>
      <label>Department<input required={role==='Manager'} value={department} onChange={e=>setDepartment(e.target.value)} /></label>
      <button disabled={busy}>Invite user</button>
    </form>
    {users.map(user=><UserRow key={user.userId} user={user} busy={busy} act={act} load={load} say={setMessage} />)}
    <p>Reset codes require a verified email. Users who have never signed in receive a fresh invitation. Delivery and spam filtering must be checked in AWS.</p>
  </section>;
}
function UserRow({ user, busy, act, load, say }) {
  const [role,setRole]=useState(user.groups.find(g=>roles.includes(g))||'Employee');
  const [department,setDepartment]=useState(user.department);
  const [enabled,setEnabled]=useState(user.enabled);
  const [confirmedEmail,setConfirmedEmail]=useState(false);
  const path='/admin/users/'+encodeURIComponent(user.userId);
  return <article><h3>{user.email}</h3><p>{user.status}</p><p>User ID: {user.email?.split('@')[0] || user.subject}</p>
    <form className="form-grid" onSubmit={e=>{e.preventDefault();act(async()=>{const r=await apiRequest(path,{method:'PATCH',body:{role,department,enabled}});say(r.message);await load();});}}>
      <label>Role<select value={role} onChange={e=>setRole(e.target.value)}>{roles.map(r=><option key={r}>{r}</option>)}</select></label>
      <label>Department<input required={role==='Manager'} value={department} onChange={e=>setDepartment(e.target.value)} /></label>
      <label><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)} />Enabled</label>
      <button disabled={busy}>Update access</button>
    </form>
    {!user.emailVerified && user.status !== 'FORCE_CHANGE_PASSWORD' && <label className="check-label"><input type="checkbox" checked={confirmedEmail} onChange={e=>setConfirmedEmail(e.target.checked)} />I confirmed this email belongs to the user.</label>}
    <button disabled={busy || (!user.emailVerified && user.status !== 'FORCE_CHANGE_PASSWORD' && !confirmedEmail)} onClick={()=>act(async()=>say((await apiRequest(path+'/password-reset',{method:'POST',body:{confirmEmailOwnership:confirmedEmail}})).message))}>Send password reset</button>
  </article>;
}
