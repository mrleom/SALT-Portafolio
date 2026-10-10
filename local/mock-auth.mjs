// Development-only adapter. Outside backend/ so SAM never packages it.
import { randomUUID } from 'node:crypto';
import { createHandler } from '../backend/handler.mjs';
import { createMemoryStore, localUserId, seedLocalAssets } from '../backend/store-memory.mjs';
import { readLocalSettings } from './settings.mjs';
import { GROUPS } from '../backend/auth.mjs';

function readBody(req) {
  if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) return Promise.resolve(String(req.body));
  if (typeof req.on !== 'function') return Promise.resolve('');
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function apiEvent(req, path, body, claims) {
  const url = new URL(req.url, 'http://localhost');
  const nested = path.match(/^\/assets\/([^/]+)\/(maintenance|history|reports|maintenance-approval|reports-status)$/);
  const match = path.match(/^\/assets\/([^/]+)$/);
  return {
    httpMethod: req.method,
    resource: nested ? '/assets/{id}/' + nested[2] : match ? '/assets/{id}' : path,
    pathParameters: nested || match ? { id: decodeURIComponent((nested || match)[1]) } : undefined,
    queryStringParameters: Object.fromEntries(url.searchParams),
    body: body || undefined,
    requestContext: { authorizer: { claims } },
  };
}

export function createMockMiddleware({ origin = readLocalSettings().origin } = {}) {
  const config = { clientId: 'local-demo', issuer: 'local-demo', origin, requiredScope: 'local-demo/demo.read' };
  const sessions = new Map();
  const store = createMemoryStore();
  const seeded = seedLocalAssets(store);
  const handler = createHandler({ ...config, store });
  return async (req, res, next) => {
    const path = new URL(req.url, origin).pathname;
    if (!path.startsWith('/api/')) return next();
    await seeded;
    const send = (status, data, extra = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra });
      res.end(JSON.stringify(data));
    };
    if (req.headers.host !== new URL(origin).host) return send(403, { error: 'Localhost only' });
    if (req.headers.origin && req.headers.origin !== origin) return send(403, { error: 'Origin not allowed' });
    if (['POST', 'PATCH'].includes(req.method) && req.headers.origin !== origin) return send(403, { error: 'Origin required' });
    for (const [key, session] of sessions) {
      if (session.exp <= Date.now() / 1000) sessions.delete(key);
    }
    const cookie = req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith('demo_session='));
    const sessionId = cookie?.slice('demo_session='.length);
    if (req.method === 'POST' && path === '/api/local/login') {
      const group = new URL(req.url, origin).searchParams.get('group');
      if (!GROUPS.includes(group)) return send(400, { error: 'Choose a demo group' });
      if (sessions.size >= 1000) return send(429, { error: 'Too many demo sessions; restart the dev server' });
      sessions.delete(sessionId);
      const id = randomUUID();
      sessions.set(id, { group, exp: Math.floor(Date.now() / 1000) + 1800 });
      return send(200, { mode: 'local' }, { 'Set-Cookie': `demo_session=${id}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=1800` });
    }
    if (req.method === 'POST' && path === '/api/local/logout') {
      sessions.delete(sessionId);
      return send(200, {}, { 'Set-Cookie': 'demo_session=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0' });
    }
    const apiPath = path.slice(4);
    const allowed = (req.method === 'GET' && (apiPath === '/reports' || apiPath === '/demo' || apiPath === '/admin' || apiPath === '/assets' || apiPath.startsWith('/assets/')))
      || (req.method === 'POST' && (apiPath === '/assets' || /^\/assets\/[^/]+\/(maintenance|reports|maintenance-approval|reports-status)$/.test(apiPath)))
      || (req.method === 'PATCH' && apiPath.startsWith('/assets/'));
    if (!allowed) return send(404, { error: 'Route not found' });
    const session = sessions.get(sessionId);
    const claims = session ? {
      sub: localUserId(session.group), client_id: config.clientId, iss: config.issuer,
      token_use: 'access', scope: config.requiredScope, exp: session.exp,
      'cognito:groups': [session.group],
    } : undefined;
    const body = ['POST', 'PATCH'].includes(req.method) ? await readBody(req) : '';
    const result = await handler(apiEvent(req, apiPath, body, claims));
    res.writeHead(result.statusCode, result.headers);
    res.end(result.body);
  };
}

export function localAuthPlugin(settings) {
  return {
    name: 'local-auth-demonstration',
    apply: 'serve',
    configureServer(server) { server.middlewares.use(createMockMiddleware(settings)); },
  };
}
