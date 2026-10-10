import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseAiSuggestion } from '../backend/ai-suggestion.mjs';
import { createImageAccessService } from '../backend/image-access.mjs';
import { createImageAccessHandler } from '../backend/image-access-handler.mjs';
import { createImageAnalysisService } from '../backend/image-analysis.mjs';
import { createImageAnalysisHandler } from '../backend/image-analysis-handler.mjs';
import { validateOwnedImageKey } from '../backend/image-reference.mjs';

const validSuggestion = Object.freeze({
  schemaVersion: '1.0',
  category: 'Laptop',
  manufacturer: 'Example',
  possibleModelFamily: 'BusinessBook',
  description: 'A portable computer with visible wear on the lid.',
  visibleCondition: 'FAIR',
  suggestedUsefulLifeYears: 4,
  maintenanceCategory: 'INSPECTION_REQUIRED',
  confidence: 0.82,
  reviewStatus: 'REVIEW_REQUIRED',
  uncertaintyNotes: ['The product family is not fully legible.'],
});

const authConfig = {
  requiredScope: 'asset-tracker/demo.read',
  clientId: 'test-client',
  issuer: 'https://issuer.example/pool',
  origin: 'https://frontend.example',
};

function event(group = 'Technician', resource = '/asset-images/analyze', body = {}) {
  return {
    httpMethod: 'POST',
    resource,
    body: JSON.stringify(body),
    requestContext: { authorizer: { claims: {
      sub: 'user-123',
      iss: authConfig.issuer,
      client_id: authConfig.clientId,
      token_use: 'access',
      exp: Math.floor(Date.now() / 1000) + 60,
      scope: `openid ${authConfig.requiredScope}`,
      'cognito:groups': [group],
    } } },
  };
}

function resourceBlock(template, logicalId) {
  template = template.replace(/\r\n/g, '\n');
  const start = template.indexOf(`  ${logicalId}:\n`);
  assert.notEqual(start, -1, `${logicalId} must exist`);
  const next = template.slice(start + 3).search(/\n  [A-Za-z][A-Za-z0-9]+:\n/);
  return next === -1 ? template.slice(start) : template.slice(start, start + 3 + next);
}

test('SLT-17/19 photo bucket is private, encrypted, retained, and TLS-only', () => {
  const template = readFileSync(new URL('../template.yaml', import.meta.url), 'utf8');
  const bucket = resourceBlock(template, 'AssetPhotoBucket');
  for (const setting of [
    'BlockPublicAcls: true',
    'BlockPublicPolicy: true',
    'IgnorePublicAcls: true',
    'RestrictPublicBuckets: true',
    'SSEAlgorithm: AES256',
    'ObjectOwnership: BucketOwnerEnforced',
    'Status: Enabled',
    'DeletionPolicy: Retain',
  ]) assert.match(bucket, new RegExp(setting));
  assert.doesNotMatch(bucket, /BucketName:/);

  const policy = resourceBlock(template, 'AssetPhotoBucketPolicy');
  assert.match(policy, /DenyInsecureTransport/);
  assert.match(policy, /aws:SecureTransport: false/);
  assert.doesNotMatch(policy, /Effect: Allow/);
});

test('SLT-21 IAM keeps image upload, analysis, and persistence permissions isolated', () => {
  const template = readFileSync(new URL('../template.yaml', import.meta.url), 'utf8');
  const analysis = resourceBlock(template, 'ImageAnalysisFunction');
  const access = resourceBlock(template, 'ImageAccessFunction');
  assert.match(analysis, /bedrock:InvokeModel/);
  assert.match(analysis, /s3:GetObject/);
  assert.doesNotMatch(analysis, /s3:PutObject|dynamodb:/);
  assert.match(access, /s3:GetObject/);
  assert.match(access, /s3:PutObject/);
  assert.doesNotMatch(access, /bedrock:|dynamodb:/);
});

test('SLT-22 structured suggestion accepts only the documented contract', () => {
  assert.deepEqual(parseAiSuggestion(JSON.stringify(validSuggestion)), validSuggestion);
  assert.throws(
    () => parseAiSuggestion(JSON.stringify({ ...validSuggestion, rawModelOutput: 'unsafe' })),
    { statusCode: 502, message: 'AI response included missing or unexpected fields' },
  );
});

test('SLT-23 rejects prohibited unverifiable fields and invalid values', () => {
  assert.throws(
    () => parseAiSuggestion(JSON.stringify({ ...validSuggestion, serialNumber: 'invented' })),
    { statusCode: 502, message: 'AI response included a prohibited unverifiable field' },
  );
  assert.throws(
    () => parseAiSuggestion(JSON.stringify({ ...validSuggestion, confidence: 1.1 })),
    { statusCode: 502, message: 'AI suggestion confidence is invalid' },
  );
  assert.throws(
    () => parseAiSuggestion(JSON.stringify({ ...validSuggestion, manufacturer: 'x'.repeat(121) })),
    { statusCode: 502, message: 'AI suggestion field manufacturer is invalid' },
  );
  assert.throws(
    () => parseAiSuggestion(JSON.stringify({
      ...validSuggestion,
      description: 'The serial number appears to be an invented value.',
    })),
    { statusCode: 502, message: 'AI response included prohibited unverifiable data' },
  );
});

test('SLT-23 unclear results fail safely into manual entry with identifying guesses removed', () => {
  const result = parseAiSuggestion(JSON.stringify({
    ...validSuggestion,
    confidence: 0.2,
    reviewStatus: 'REVIEW_REQUIRED',
  }));
  assert.equal(result.reviewStatus, 'MANUAL_ENTRY_REQUIRED');
  assert.equal(result.category, null);
  assert.equal(result.manufacturer, null);
  assert.equal(result.possibleModelFamily, null);
  assert.equal(result.suggestedUsefulLifeYears, null);
  assert.equal(result.maintenanceCategory, 'UNKNOWN');
  assert.equal(result.description, validSuggestion.description);
});

test('draft image references are limited to the authenticated user and safe image names', () => {
  assert.equal(
    validateOwnedImageKey('asset-photos/user-123/4f3a.jpg', 'user-123'),
    'asset-photos/user-123/4f3a.jpg',
  );
  assert.throws(
    () => validateOwnedImageKey('asset-photos/other-user/4f3a.jpg', 'user-123'),
    { statusCode: 403 },
  );
  assert.throws(
    () => validateOwnedImageKey('asset-photos/user-123/../other-user/4f3a.jpg', 'user-123'),
    { statusCode: 400 },
  );
  assert.throws(
    () => validateOwnedImageKey('asset-photos/user-123/script.svg', 'user-123'),
    { statusCode: 400 },
  );
});

test('SLT-21 analysis reads the configured private object and invokes the configured model', async () => {
  const calls = [];
  const service = createImageAnalysisService({
    bucketName: 'generated-private-bucket',
    modelId: 'approved.vision-model-v1:0',
    s3Client: { async send(command) {
      calls.push(command);
      return {
        ContentLength: 4,
        ContentType: 'image/jpeg',
        Body: Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]),
      };
    } },
    bedrockClient: { async send(command) {
      calls.push(command);
      return { output: { message: { content: [{ text: JSON.stringify(validSuggestion) }] } } };
    } },
  });
  const result = await service.analyze({
    imageKey: 'asset-photos/user-123/4f3a.jpg',
    subject: 'user-123',
  });
  assert.deepEqual(result, validSuggestion);
  assert.deepEqual(calls[0].input, {
    Bucket: 'generated-private-bucket',
    Key: 'asset-photos/user-123/4f3a.jpg',
  });
  assert.equal(calls[1].input.modelId, 'approved.vision-model-v1:0');
  assert.equal(calls[1].input.messages[0].content[0].image.format, 'jpeg');
});

test('analysis rejects a content-type/signature mismatch before Bedrock', async () => {
  let bedrockCalled = false;
  const service = createImageAnalysisService({
    bucketName: 'generated-private-bucket',
    modelId: 'approved.vision-model-v1:0',
    s3Client: { async send() {
      return {
        ContentLength: 8,
        ContentType: 'image/jpeg',
        Body: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      };
    } },
    bedrockClient: { async send() { bedrockCalled = true; } },
  });
  await assert.rejects(
    service.analyze({ imageKey: 'asset-photos/user-123/4f3a.jpg', subject: 'user-123' }),
    { statusCode: 400, message: 'Stored object is not a supported JPEG or PNG image' },
  );
  assert.equal(bedrockCalled, false);
});

test('analysis API requires a verified Technician or Administrator token and never saves', async () => {
  let received;
  const handler = createImageAnalysisHandler({
    ...authConfig,
    service: { async analyze(value) { received = value; return validSuggestion; } },
  });
  const anonymous = event();
  delete anonymous.requestContext.authorizer;
  assert.equal((await handler(anonymous)).statusCode, 401);
  assert.equal((await handler(event('Employee'))).statusCode, 403);
  const response = await handler(event('Technician', '/asset-images/analyze', {
    imageKey: 'asset-photos/user-123/4f3a.jpg',
  }));
  assert.equal(response.statusCode, 200);
  assert.deepEqual(received, {
    imageKey: 'asset-photos/user-123/4f3a.jpg',
    subject: 'user-123',
  });
  assert.equal(JSON.parse(response.body).requiresUserReview, true);
});

test('SLT-28 secure draft access uses a short-lived signed URL and enforces ownership', async () => {
  let signed;
  const service = createImageAccessService({
    bucketName: 'generated-private-bucket',
    s3Client: { name: 'fake-s3' },
    expiresIn: 60,
    async presign(client, command, options) {
      signed = { client, input: command.input, options };
      return 'https://signed.example/private';
    },
  });
  const result = await service.createReadUrl({
    imageKey: 'asset-photos/user-123/4f3a.png',
    subject: 'user-123',
  });
  assert.equal(result.url, 'https://signed.example/private');
  assert.equal(result.expiresIn, 60);
  assert.deepEqual(signed.input, {
    Bucket: 'generated-private-bucket',
    Key: 'asset-photos/user-123/4f3a.png',
  });
  assert.deepEqual(signed.options, { expiresIn: 60 });
  await assert.rejects(
    service.createReadUrl({ imageKey: 'asset-photos/other-user/4f3a.png', subject: 'user-123' }),
    { statusCode: 403 },
  );
});

test('secure draft access API does not accept unverified or unauthorized callers', async () => {
  const handler = createImageAccessHandler({
    ...authConfig,
    service: { async createReadUrl({ imageKey }) {
      return { imageKey, url: 'https://signed.example/private', expiresIn: 60 };
    } },
  });
  const forged = event('Technician', '/asset-images/access', {
    imageKey: 'asset-photos/user-123/4f3a.jpg',
  });
  delete forged.requestContext.authorizer;
  forged.headers = { Authorization: 'Bearer forged', 'x-role': 'Administrator' };
  assert.equal((await handler(forged)).statusCode, 401);
  assert.equal((await handler(event('Employee', '/asset-images/access', {
    imageKey: 'asset-photos/user-123/4f3a.jpg',
  }))).statusCode, 403);
});
