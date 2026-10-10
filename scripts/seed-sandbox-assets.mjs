#!/usr/bin/env node
// One-shot sandbox seeder. Uses SSO profile credentials; never prints or writes passwords.
import { spawnSync } from 'node:child_process';
import { createDynamoStore } from '../backend/store-dynamo.mjs';
import { awsTarget } from './aws-target.mjs';

const { profile: PROFILE, region: REGION, stack: STACK, account: EXPECTED_ACCOUNT } = awsTarget();

function awsJson(args) {
  const result = spawnSync('aws', [...args, '--profile', PROFILE, '--region', REGION, '--output', 'json'], {
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'aws command failed');
  return JSON.parse(result.stdout || 'null');
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
  throw new Error(`Refusing to seed: account ${identity.Account} is not ${EXPECTED_ACCOUNT}`);
}

const stack = awsJson(['cloudformation', 'describe-stacks', '--stack-name', STACK]).Stacks[0];
const tableName = output(stack, 'AssetsTableName');
const poolId = output(stack, 'UserPoolId');
const users = awsJson(['cognito-idp', 'list-users', '--user-pool-id', poolId]).Users || [];
const byEmail = Object.fromEntries(users.map(user => [attr(user, 'email'), {
  username: user.Username,
  sub: attr(user, 'sub') || user.Username,
}]));

const emails = {
  Employee: 'employee@salt-sandbox.test',
  Technician: 'technician@salt-sandbox.test',
  Manager: 'manager@salt-sandbox.test',
  Administrator: 'administrator@salt-sandbox.test',
  Auditor: 'auditor@salt-sandbox.test',
  None: 'nogroup@salt-sandbox.test',
};
for (const [label, email] of Object.entries(emails)) {
  if (!byEmail[email]) throw new Error(`Missing Cognito user for ${label} (${email})`);
}

const departments = {
  Employee: 'IT', Technician: 'IT', Manager: 'Operations',
  Administrator: 'Operations', Auditor: 'Finance', None: 'Support',
};

const store = createDynamoStore(tableName);
for (const [group, email] of Object.entries(emails)) {
  const sub = byEmail[email].sub;
  await store.putProfile({
    PK: `USER#${sub}`, SK: 'PROFILE', subject: sub, department: departments[group], email,
  });
}

const now = '2024-01-15';
const samples = [
  ['SBX-LAP-001', 'Laptop', 'IT', 'Employee', 'Assigned', 'Good'],
  ['SBX-LAP-002', 'Laptop', 'IT', 'Employee', 'Available', 'Excellent'],
  ['SBX-MON-010', 'Monitor', 'IT', 'Technician', 'Assigned', 'Fair'],
  ['SBX-PRN-003', 'Printer', 'Operations', 'Manager', 'In Maintenance', 'Poor'],
  ['SBX-SRV-100', 'Server', 'Operations', 'Administrator', 'Assigned', 'Good'],
  ['SBX-PHN-021', 'Phone', 'Operations', 'Manager', 'Checked Out', 'Good'],
  ['SBX-DSK-004', 'Desk', 'Finance', 'Auditor', 'Available', 'Excellent'],
  ['SBX-CHR-008', 'Chair', 'IT', 'Employee', 'Damaged', 'Poor'],
  ['SBX-RTR-002', 'Router', 'Operations', 'Technician', 'Assigned', 'Good'],
  ['SBX-TBL-011', 'Tablet', 'Finance', 'Auditor', 'Retired', 'Fair'],
];

for (const [index, [assetTag, category, department, group, status, condition]] of samples.entries()) {
  const assignedUserId = byEmail[emails[group]].sub;
  const assetId = `sandbox-asset-${index + 1}`;
  await store.putAsset({
    PK: `ASSET#${assetId}`, SK: 'METADATA',
    GSI1PK: `TAG#${assetTag.toLowerCase()}`, GSI1SK: `ASSET#${assetId}`,
    GSI2PK: `USER#${assignedUserId}`, GSI2SK: `ASSET#${assetId}`,
    GSI3PK: `DEPT#${department}`, GSI3SK: `ASSET#${assetId}`,
    assetId, assetTag, category, description: `${category} used in ${department}`,
    manufacturer: 'ExampleCo', model: `SBX-${index + 1}`, serialNumber: `SBX-SN-${1000 + index}`,
    purchaseDate: now, purchaseValue: 1500 - index * 50, salvageValue: 100, usefulLifeYears: 4,
    depreciationMethod: 'straight-line', assignedUserId, assignedEmail: emails[group],
    department, building: 'HQ', room: String(200 + index), condition, status, problemNote: '',
    lastCleaningDate: '', lastMaintenanceDate: '', nextMaintenanceDate: '', expectedReplacementDate: '',
    photoKey: null, aiReviewStatus: 'none', createdAt: now + 'T00:00:00.000Z', updatedAt: now + 'T00:00:00.000Z',
  });
}

console.log(JSON.stringify({
  account: identity.Account,
  table: tableName,
  profiles: Object.keys(emails).length,
  assets: samples.length,
}, null, 2));
