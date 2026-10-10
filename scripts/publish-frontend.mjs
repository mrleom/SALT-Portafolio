#!/usr/bin/env node
// Build the AWS-mode SPA and publish it to the sandbox CloudFront origin.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { awsTarget } from './aws-target.mjs';

const { profile: PROFILE, region: REGION, stack: STACK, account: EXPECTED_ACCOUNT } = awsTarget();
const root = fileURLToPath(new URL('..', import.meta.url));

function awsJson(args) {
  const result = spawnSync('aws', [...args, '--profile', PROFILE, '--region', REGION, '--output', 'json'], {
    encoding: 'utf8', cwd: root,
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'aws command failed');
  return JSON.parse(result.stdout || 'null');
}

function run(command, args, env = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', cwd: root, env: { ...process.env, ...env } });
  if (result.status !== 0) throw new Error(command + ' failed');
}

const identity = awsJson(['sts', 'get-caller-identity']);
if (identity.Account !== EXPECTED_ACCOUNT) {
  throw new Error(`Refusing to publish: account ${identity.Account} is not ${EXPECTED_ACCOUNT}`);
}

const outputs = Object.fromEntries(
  (awsJson(['cloudformation', 'describe-stacks', '--stack-name', STACK]).Stacks[0].Outputs || [])
    .map(item => [item.OutputKey, item.OutputValue]),
);
for (const key of ['HostedFrontendUrl', 'FrontendBucketName', 'FrontendDistributionId', 'CognitoDomain',
  'ClientId', 'UserPoolId', 'IssuerUrl', 'ApiBaseUrl', 'RequiredScope', 'CallbackUrl', 'LogoutUrl']) {
  if (!outputs[key]) throw new Error('Missing stack output ' + key);
}

run(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'build', '--mode', 'aws', '--outDir', 'dist'], {
  VITE_COGNITO_DOMAIN: outputs.CognitoDomain,
  VITE_COGNITO_CLIENT_ID: outputs.ClientId,
  VITE_COGNITO_USER_POOL_ID: outputs.UserPoolId,
  VITE_COGNITO_ISSUER: outputs.IssuerUrl,
  VITE_API_URL: outputs.ApiBaseUrl,
  VITE_AUTH_SCOPE: outputs.RequiredScope,
  VITE_AUTH_CALLBACK_URL: outputs.CallbackUrl,
  VITE_AUTH_LOGOUT_URL: outputs.LogoutUrl,
});

const dist = join(root, 'dist');
const awsArgs = ['--profile', PROFILE, '--region', REGION];
run('aws', ['s3', 'sync', dist, 's3://' + outputs.FrontendBucketName, '--delete',
  '--cache-control', 'public,max-age=31536000,immutable', '--exclude', 'index.html', ...awsArgs]);
run('aws', ['s3', 'cp', join(dist, 'index.html'), 's3://' + outputs.FrontendBucketName + '/index.html',
  '--cache-control', 'no-cache', '--content-type', 'text/html; charset=utf-8', ...awsArgs]);
run('aws', ['cloudfront', 'create-invalidation', '--distribution-id', outputs.FrontendDistributionId,
  '--paths', '/*', ...awsArgs]);

console.log(JSON.stringify({ url: outputs.HostedFrontendUrl, bucket: outputs.FrontendBucketName }, null, 2));
