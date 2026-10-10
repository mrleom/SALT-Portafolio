import * as teamAuth from './team-auth.js';

export const isLocal = import.meta.env.VITE_AUTH_MODE === 'local';

export async function signIn(group) {
  if (!isLocal) return teamAuth.signIn();
  const response = await fetch('/api/local/login?group=' + encodeURIComponent(group), { method: 'POST' });
  if (!response.ok) throw new Error('Local sign-in failed');
}

export async function completeSignIn() {
  if (!isLocal) await teamAuth.initialize();
}

function allowedPath(path) {
  const route = path.split('?')[0];
  return route === '/reports' || route === '/admin/users' || route.startsWith('/admin/users/') || route === '/demo' || route === '/admin' || route === '/assets' || route.startsWith('/assets/');
}

function allowedImagePath(path) {
  return path === '/asset-images/upload' || path === '/asset-images/access' || path === '/asset-images/analyze';
}

export async function apiRequest(path, { method = 'GET', body } = {}) {
  if (!allowedPath(path)) throw new Error('Unknown API operation');
  const headers = {};
  let base = '/api';
  if (!isLocal) {
    const api = new URL(import.meta.env.VITE_API_URL);
    if (api.protocol !== 'https:') throw new Error('AWS API endpoint must use HTTPS');
    base = api.href.replace(/\/$/, '');
    const token = await teamAuth.getAccessToken();
    if (!token) throw Object.assign(new Error('Sign in required'), { status: 401 });
    headers.Authorization = 'Bearer ' + token;
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(base + path, {
    method, headers, cache: 'no-store',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) {
    throw Object.assign(new Error(data.error || data.message || 'API request denied'), { status: response.status });
  }
  return data;
}

// Request a pre-signed PUT URL from the backend, then upload the file directly to S3.
// Returns the imageKey that should be saved on the asset record.
export async function uploadPhoto(file) {
  if (isLocal) throw new Error('Photo upload is not available in local demo mode');

  const api = new URL(import.meta.env.VITE_API_URL);
  if (api.protocol !== 'https:') throw new Error('AWS API endpoint must use HTTPS');
  const base = api.href.replace(/\/$/, '');

  const token = await teamAuth.getAccessToken();
  if (!token) throw Object.assign(new Error('Sign in required'), { status: 401 });

  // Sanitise the filename: keep only safe characters, preserve extension
  const ext = (file.name.includes('.') ? file.name.split('.').pop() : 'jpg').toLowerCase();
  const base64name = file.name
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/\.+/g, '.')
    .replace(/^[._-]+/, '');
  // Trim stem to 80 chars max, always append the validated extension
  const stem = crypto.randomUUID() + '-' + (base64name.replace(/\.[^.]+$/, '') || 'photo').slice(0, 80);
  const filename = stem + '.' + ext;

  const contentType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';

  // Step 1: ask the backend for a pre-signed upload URL
  const urlRes = await fetch(base + '/asset-images/upload', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({ filename, contentType }),
  });
  const urlData = await urlRes.json();
  if (!urlRes.ok) {
    throw Object.assign(new Error(urlData.error || 'Could not get upload URL'), { status: urlRes.status });
  }

  // Step 2: upload the file bytes directly to S3 using the pre-signed URL
  // No auth header here — the signature is baked into the URL
  const uploadRes = await fetch(urlData.url, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: file,
  });
  if (!uploadRes.ok) {
    throw new Error('Photo upload to storage failed (' + uploadRes.status + ')');
  }

  return urlData.imageKey;
}

// Upload a photo then ask Bedrock to analyze it.
// Returns { imageKey, suggestion } where suggestion contains the AI pre-fill fields.
export async function uploadAndAnalyzePhoto(file) {
  const imageKey = await uploadPhoto(file);

  const api = new URL(import.meta.env.VITE_API_URL);
  const base = api.href.replace(/\/$/, '');
  const token = await teamAuth.getAccessToken();
  if (!token) throw Object.assign(new Error('Sign in required'), { status: 401 });

  const analyzeRes = await fetch(base + '/asset-images/analyze', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({ imageKey }),
  });
  const analyzeData = await analyzeRes.json();
  if (!analyzeRes.ok) {
    // Upload succeeded but analysis failed — still return the key so it isn't lost
    throw Object.assign(
      new Error(analyzeData.error || 'AI analysis failed'),
      { status: analyzeRes.status, imageKey }
    );
  }

  return { imageKey, suggestion: analyzeData.suggestion };
}
export async function getAccessToken() {
  if (isLocal) return null;
  return teamAuth.getAccessToken();
}

export async function getProtected(path) {
  return apiRequest(path);
}

export async function getDisplayEmail(subject) {
  if (isLocal) return '';
  // A missing display claim must not turn a successful API check into a failed login.
  try { return await teamAuth.getDisplayEmail(subject); }
  catch { return ''; }
}

export async function signOut() {
  if (!isLocal) return teamAuth.signOut();
  const response = await fetch('/api/local/logout', { method: 'POST' });
  if (!response.ok) throw new Error('Local sign-out failed');
}

// Analyze an already-uploaded photo by its S3 key.
// Returns the suggestion object from Bedrock.
export async function analyzeExistingPhoto(imageKey) {
  if (isLocal) throw new Error('AI analysis is not available in local demo mode');

  const api = new URL(import.meta.env.VITE_API_URL);
  const base = api.href.replace(/\/$/, '');
  const token = await teamAuth.getAccessToken();
  if (!token) throw Object.assign(new Error('Sign in required'), { status: 401 });

  const res = await fetch(base + '/asset-images/analyze', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({ imageKey }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw Object.assign(new Error(data.error || 'AI analysis failed'), { status: res.status });
  }
  return data.suggestion;
}
