// Local development config — extends the base config and adds the mock-auth middleware.
// Used by `npm run dev` via --config vite.config.local.mjs.
//
// Kept separate from vite.config.mjs so that the aws build path never touches
// local/mock-auth.mjs or its backend dependencies (@aws-sdk packages that live
// only in backend/node_modules, not at the root).
import { defineConfig, loadEnv, mergeConfig } from 'vite';
import { localAuthPlugin } from './local/mock-auth.mjs';
import { readLocalSettings } from './local/settings.mjs';
import base from './vite.config.mjs';

export default defineConfig((env) => {
  const loaded = loadEnv(env.mode, process.cwd(), '');
  const settings = readLocalSettings(loaded);
  return mergeConfig(base(env), {
    define: { 'import.meta.env.VITE_AUTH_MODE': JSON.stringify('local') },
    plugins: [localAuthPlugin(settings)],
  });
});
