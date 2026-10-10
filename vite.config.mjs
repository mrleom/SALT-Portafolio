import { defineConfig, loadEnv } from 'vite';
import { readLocalSettings } from './local/settings.mjs';

// local/mock-auth.mjs is intentionally NOT imported here at the top level.
// Vite bundles vite.config.mjs with esbuild before executing it, which means
// all static (and dynamic) imports are resolved at bundle time regardless of
// runtime conditions. mock-auth.mjs pulls in backend/store-dynamo.mjs which
// depends on @aws-sdk packages that only live in backend/node_modules and are
// not present at the root. Importing them here would break every aws-mode build.
// Instead, local dev is handled by vite.config.local.mjs (--config flag).

export default defineConfig(({ command, mode }) => {
  const authMode = command === 'build' || mode === 'aws' ? 'aws' : 'local';
  const env = loadEnv(mode, process.cwd(), '');
  const settings = readLocalSettings(env);
  if (authMode === 'aws') {
    for (const key of ['VITE_COGNITO_DOMAIN', 'VITE_COGNITO_CLIENT_ID', 'VITE_API_URL',
      'VITE_COGNITO_USER_POOL_ID', 'VITE_COGNITO_ISSUER', 'VITE_AUTH_SCOPE',
      'VITE_AUTH_CALLBACK_URL', 'VITE_AUTH_LOGOUT_URL']) {
      if (!env[key]) throw new Error(`Missing ${key}; see .env.example and docs/deployment.md`);
    }
    for (const key of ['VITE_COGNITO_DOMAIN', 'VITE_COGNITO_ISSUER', 'VITE_API_URL']) {
      const url = new URL(env[key]);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
        throw new Error(`${key} must be an HTTPS URL without credentials, query, or fragment`);
    }
    for (const key of ['VITE_AUTH_CALLBACK_URL', 'VITE_AUTH_LOGOUT_URL']) {
      const url = new URL(env[key]);
      if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === 'localhost')) ||
          url.username || url.password || url.search || url.hash)
        throw new Error(`${key} must use HTTPS (HTTP allowed only for localhost)`);
    }
  }
  return {
    define: { 'import.meta.env.VITE_AUTH_MODE': JSON.stringify(authMode) },
    plugins: [],
    appType: 'spa',
    server: { host: settings.host, port: settings.port, strictPort: true },
    preview: { host: settings.host, port: settings.port, strictPort: true },
  };
});
