// Compile with public, deliberately non-routable fixture values. No AWS calls.
import { spawnSync } from 'node:child_process';
const env = { ...process.env,
  VITE_COGNITO_DOMAIN: 'https://login.example.invalid',
  VITE_COGNITO_CLIENT_ID: 'build-check-placeholder',
  VITE_COGNITO_USER_POOL_ID: 'fixture_pool',
  VITE_COGNITO_ISSUER: 'https://issuer.example.invalid/fixture_pool',
  VITE_API_URL: 'https://api.example.invalid/team-stage',
  VITE_AUTH_SCOPE: 'team-fixture/demo.read',
  VITE_AUTH_CALLBACK_URL: 'https://frontend.example.invalid/auth/callback',
  VITE_AUTH_LOGOUT_URL: 'https://frontend.example.invalid/signed-out',
};
const result = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--mode', 'aws',
  '--outDir', '.local/build-check'], { env, stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
