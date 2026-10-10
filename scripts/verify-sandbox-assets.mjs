#!/usr/bin/env node
// Invoke the deployed Lambda with trusted authorizer-shaped events. No passwords or tokens are used.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { awsTarget } from './aws-target.mjs';

const { profile: PROFILE, region: REGION, stack: STACK, account: EXPECTED_ACCOUNT } = awsTarget();

function aws(args, extra = {}) {
  const result = spawnSync('aws', [...args, '--profile', PROFILE, '--region', REGION], {
    encoding: extra.encoding ?? 'utf8',
    ...extra,
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'aws command failed');
  return result.stdout;
}

function awsJson(args) {
  return JSON.parse(aws([...args, '--output', 'json']) || 'null');
}

function output(stack, key) {
  const found = stack.Outputs?.find(item => item.OutputKey === key);
  if (!found) throw new Error('Missing stack output ' + key);
  return found.OutputValue;
}

function attr(user, name) {
  return user.Attributes?.find(item => item.Name === name)?.Value;
}

const identity = awsJson(['sts', 'get-caller-identity']);
if (identity.Account !== EXPECTED_ACCOUNT) {
  throw new Error(`Refusing to verify: account ${identity.Account} is not ${EXPECTED_ACCOUNT}`);
}

const stack = awsJson(['cloudformation', 'describe-stacks', '--stack-name', STACK]).Stacks[0];
const poolId = output(stack, 'UserPoolId');
const clientId = output(stack, 'ClientId');
const issuer = output(stack, 'IssuerUrl');
const apiBase = output(stack, 'ApiBaseUrl');
const requiredScope = output(stack, 'RequiredScope');
const functionName = awsJson([
  'cloudformation', 'describe-stack-resource', '--stack-name', STACK, '--logical-resource-id', 'DemoFunction',
]).StackResourceDetail.PhysicalResourceId;

const users = awsJson(['cognito-idp', 'list-users', '--user-pool-id', poolId]).Users || [];
const byEmail = Object.fromEntries(users.map(user => [attr(user, 'email'), attr(user, 'sub') || user.Username]));

const anonymous = spawnSync('curl', ['-sS', '-o', '/dev/null', '-w', '%{http_code}', apiBase + '/assets'], { encoding: 'utf8' });
if (anonymous.status !== 0) throw new Error(anonymous.stderr || 'curl failed');
const anonymousStatus = anonymous.stdout.trim();
if (!['401', '403'].includes(anonymousStatus)) {
  throw new Error('Unauthenticated GET /assets returned ' + anonymousStatus);
}

function invoke(group, email, { method = 'GET', resource = '/assets', path, body } = {}) {
  const payload = {
    httpMethod: method,
    resource,
    path: path || resource,
    pathParameters: resource.includes('{id}') ? { id: path.split('/').pop() } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    requestContext: { authorizer: { claims: {
      sub: byEmail[email], iss: issuer, client_id: clientId, token_use: 'access',
      exp: Math.floor(Date.now() / 1000) + 300, scope: requiredScope, 'cognito:groups': group ? [group] : [],
    } } },
  };
  const dir = mkdtempSync(join(tmpdir(), 'salt-verify-'));
  const inFile = join(dir, 'in.json');
  const outFile = join(dir, 'out.json');
  writeFileSync(inFile, JSON.stringify(payload));
  aws(['lambda', 'invoke', '--function-name', functionName, '--cli-binary-format', 'raw-in-base64-out',
    '--payload', 'fileb://' + inFile, outFile]);
  return JSON.parse(readFileSync(outFile, 'utf8'));
}

const employee = invoke('Employee', 'employee@salt-sandbox.test');
const auditor = invoke('Auditor', 'auditor@salt-sandbox.test');
const employeeAssets = JSON.parse(employee.body).assets || [];
const auditorAssets = JSON.parse(auditor.body).assets || [];
if (employee.statusCode !== 200) throw new Error('Employee list failed: ' + employee.body);
if (auditor.statusCode !== 200) throw new Error('Auditor list failed: ' + auditor.body);
if (!employeeAssets.length) throw new Error('Employee saw no assigned assets');
if (employeeAssets.length >= auditorAssets.length) throw new Error('Employee should see a subset of auditor assets');
if (auditorAssets.length < 10) throw new Error('Auditor should see the seeded assets');

const auditorPost = invoke('Auditor', 'auditor@salt-sandbox.test', {
  method: 'POST', resource: '/assets',
  body: { assetTag: 'SHOULD-FAIL', category: 'X', description: 'no', manufacturer: 'n', model: 'n', serialNumber: 'n',
    purchaseDate: '2024-01-15', purchaseValue: 1, salvageValue: 0, usefulLifeYears: 1,
    assignedUserId: byEmail['auditor@salt-sandbox.test'], assignedEmail: 'auditor@salt-sandbox.test',
    department: 'Finance', building: 'HQ', room: '1', condition: 'Good', status: 'Available' },
});
if (auditorPost.statusCode !== 403) throw new Error('Auditor POST should be 403, got ' + auditorPost.statusCode);

console.log(JSON.stringify({
  unauthenticated: Number(anonymousStatus),
  employeeCount: employeeAssets.length,
  auditorCount: auditorAssets.length,
  auditorPost: auditorPost.statusCode,
}, null, 2));
