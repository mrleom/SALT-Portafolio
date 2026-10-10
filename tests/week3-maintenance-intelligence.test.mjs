import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  addDays, calculateDueDates, classifyDueDate,
} from '../backend/maintenance-dates.mjs';
import {
  parseMaintenanceRecommendation,
} from '../backend/maintenance-recommendation-schema.mjs';
import {
  MAINTENANCE_SYSTEM_PROMPT,
  createMaintenanceRecommendationService,
  maintenanceAssetSnapshot,
} from '../backend/maintenance-recommendation.mjs';
import {
  createMaintenanceRecommendationHandler,
} from '../backend/maintenance-recommendation-handler.mjs';
import { buildMaintenanceNotification } from '../backend/maintenance-notification.mjs';
import { createMaintenanceCheckHandler } from '../backend/maintenance-check-handler.mjs';

const validRecommendation = Object.freeze({
  priority: 'MEDIUM',
  recommendedAction: 'Inspect cooling vents and schedule routine service.',
  recommendedCompletionDate: '2026-10-03',
  maintenanceIntervalDays: 90,
  expectedReplacementWindow: null,
  explanation: 'The supplied condition and maintenance date support a routine inspection.',
  reviewStatus: 'AI_SUGGESTED',
});

test('SLT-60 validates and sanitizes a structured AI maintenance result', () => {
  assert.deepEqual(parseMaintenanceRecommendation(JSON.stringify({
    ...validRecommendation,
    recommendedAction: '  Inspect cooling vents.  ',
  })), {
    ...validRecommendation,
    recommendedAction: 'Inspect cooling vents.',
  });
});

test('SLT-60 rejects malformed, incomplete, and invalid AI results', () => {
  assert.throws(() => parseMaintenanceRecommendation('not json'), { statusCode: 502 });
  assert.throws(() => parseMaintenanceRecommendation(JSON.stringify({
    ...validRecommendation, priority: 'URGENT',
  })), { statusCode: 502 });
  assert.throws(() => parseMaintenanceRecommendation(JSON.stringify({
    ...validRecommendation, inventedCost: 500,
  })), { statusCode: 502 });
  assert.throws(() => parseMaintenanceRecommendation(JSON.stringify({
    ...validRecommendation, recommendedCompletionDate: '2026-02-30',
  })), { statusCode: 502 });
  assert.throws(() => parseMaintenanceRecommendation(JSON.stringify({
    ...validRecommendation, explanation: 'This asset is guaranteed to fail.',
  })), { statusCode: 502 });
});

test('SLT-60 safely handles missing optional asset information', async () => {
  let command;
  const service = createMaintenanceRecommendationService({
    modelId: 'provider.model-v1:0',
    bedrockClient: { async send(value) {
      command = value;
      return { output: { message: { content: [{ text: JSON.stringify({
        ...validRecommendation, recommendedCompletionDate: null,
      }) }] } } };
    } },
  });
  assert.deepEqual(await service.recommend({ category: 'Laptop' }), {
    ...validRecommendation, recommendedCompletionDate: null,
  });
  const supplied = JSON.parse(command.input.messages[0].content[0].text.match(/\n(\{.*\})\nReturn only/s)[1]);
  assert.deepEqual(supplied, { category: 'Laptop' });
  assert.equal(command.input.inferenceConfig.temperature, 0);
});

test('SLT-60 input boundary excludes financial, identity, and depreciation calculations', () => {
  assert.deepEqual(maintenanceAssetSnapshot({
    category: 'Printer', purchaseDate: '2025-01-01', purchaseValue: 4000,
    currentBookValue: 2500, depreciationMethod: 'straight-line', serialNumber: 'secret',
    assignedEmail: 'person@example.test', totalRepairCost: 125,
  }), {
    category: 'Printer', purchaseDate: '2025-01-01', totalRepairCost: 125,
  });
  assert.match(MAINTENANCE_SYSTEM_PROMPT, /Do not calculate depreciation, book value/i);
  assert.match(MAINTENANCE_SYSTEM_PROMPT, /never invent/i);
  assert.match(MAINTENANCE_SYSTEM_PROMPT, /not predictive maintenance/i);
  assert.match(MAINTENANCE_SYSTEM_PROMPT, /recommendedCompletionDate must be null/i);
});

test('SLT-60 reports unavailable Bedrock without requiring a live invocation', async () => {
  const service = createMaintenanceRecommendationService({
    modelId: 'provider.model-v1:0',
    bedrockClient: { async send() { throw new Error('model access pending'); } },
  });
  await assert.rejects(service.recommend({}), {
    statusCode: 503, message: 'AI maintenance recommendation is temporarily unavailable',
  });
});

test('SLT-60 rejects a completion date not supplied by deterministic application data', async () => {
  const service = createMaintenanceRecommendationService({
    modelId: 'provider.model-v1:0',
    bedrockClient: { async send() {
      return { output: { message: { content: [{ text: JSON.stringify(validRecommendation) }] } } };
    } },
  });
  await assert.rejects(service.recommend({ category: 'Laptop' }), {
    statusCode: 502, message: 'AI maintenance recommendation invented an unsupported date',
  });
});

test('SLT-61 calculates maintenance and cleaning dates with UTC-safe arithmetic', () => {
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.deepEqual(calculateDueDates({
    lastMaintenanceDate: '2026-09-01', maintenanceIntervalDays: 30,
    lastCleaningDate: '2026-09-25', cleaningIntervalDays: 7,
  }), {
    nextMaintenanceDate: '2026-10-01',
    nextCleaningDate: '2026-10-02',
  });
});

test('SLT-61 returns null when required date inputs are unavailable', () => {
  assert.deepEqual(calculateDueDates({ lastMaintenanceDate: '2026-09-01' }), {
    nextMaintenanceDate: null,
    nextCleaningDate: null,
  });
});

test('SLT-61 rejects invalid dates and intervals instead of inventing dates', () => {
  assert.throws(() => addDays('2026-02-30', 30), /valid calendar date/);
  assert.throws(() => addDays('2026-01-01', 0), /integer from 1/);
  assert.throws(() => addDays('09\/01\/2026', 30), /YYYY-MM-DD/);
});

test('SLT-63 classifies overdue, upcoming, and not-due dates', () => {
  const now = new Date('2026-09-28T23:59:59Z');
  assert.deepEqual(classifyDueDate('2026-09-27', now), { status: 'OVERDUE', daysUntilDue: -1 });
  assert.deepEqual(classifyDueDate('2026-10-05', now), { status: 'UPCOMING', daysUntilDue: 7 });
  assert.deepEqual(classifyDueDate('2026-10-06', now), { status: 'NOT_DUE', daysUntilDue: 8 });
});

test('SLT-64 notification contains useful non-sensitive fields and consolidates due work', () => {
  const result = buildMaintenanceNotification({
    assetId: 'asset-1', assetTag: 'LAP-001', assignedEmail: 'private@example.test',
    nextMaintenanceDate: '2026-09-27', nextCleaningDate: '2026-10-02',
  }, { now: new Date('2026-09-28T12:00:00Z') });
  assert.equal(result.payload.status, 'OVERDUE');
  assert.equal(result.payload.items.length, 2);
  assert.match(result.message, /Schedule asset maintenance/);
  assert.doesNotMatch(result.message, /private@example\.test/);
});

test('SLT-63 scheduled check scans once and publishes at most once per due asset', async () => {
  const sent = [];
  const handler = createMaintenanceCheckHandler({
    store: { async scanAssets() {
      return [
        { assetId: 'due', assetTag: 'DUE-1', nextMaintenanceDate: '2026-09-20', nextCleaningDate: '2026-10-01' },
        { assetId: 'later', assetTag: 'LATER-1', nextMaintenanceDate: '2026-12-01' },
      ];
    } },
    snsClient: { async send(command) { sent.push(command.input); } },
    topicArn: 'arn:aws:sns:us-east-1:111122223333:maintenance',
    now: () => new Date('2026-09-28T12:00:00Z'),
  });
  assert.deepEqual(await handler(), { scanned: 2, notified: 1, skippedInvalid: 0 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].TopicArn, 'arn:aws:sns:us-east-1:111122223333:maintenance');
  assert.equal(JSON.parse(sent[0].Message).items.length, 2);
});

const authConfig = {
  requiredScope: 'asset-tracker/demo.read', clientId: 'test-client',
  issuer: 'https://issuer.example/pool', origin: 'https://frontend.example.test',
};

function recommendationEvent(group = 'Technician', overrides = {}) {
  return {
    httpMethod: 'POST', resource: '/assets/{id}/maintenance-recommendation',
    pathParameters: { id: 'asset-1' },
    requestContext: { authorizer: { claims: {
      sub: 'user-1', iss: authConfig.issuer, client_id: authConfig.clientId,
      token_use: 'access', exp: Math.floor(Date.now() / 1000) + 60,
      scope: 'asset-tracker/demo.read', 'cognito:groups': [group],
    } } },
    ...overrides,
  };
}

test('maintenance recommendation API follows verified Cognito and group authorization conventions', async () => {
  let receivedAsset;
  const handler = createMaintenanceRecommendationHandler({
    ...authConfig,
    store: { async getAsset(id) { return id === 'asset-1' ? { assetId: id, condition: 'Fair' } : undefined; } },
    service: { async recommend(asset) { receivedAsset = asset; return validRecommendation; } },
  });
  const forged = recommendationEvent('Technician');
  delete forged.requestContext.authorizer;
  forged.headers = { Authorization: 'Bearer forged', 'x-role': 'Administrator' };
  assert.equal((await handler(forged)).statusCode, 401);
  assert.equal((await handler(recommendationEvent('Employee'))).statusCode, 403);
  assert.equal((await handler(recommendationEvent('Technician', { pathParameters: { id: 'missing' } }))).statusCode, 404);
  const response = await handler(recommendationEvent('Administrator'));
  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).requiresUserReview, true);
  assert.deepEqual(receivedAsset, { assetId: 'asset-1', condition: 'Fair' });
});

test('maintenance recommendation API rejects invalid requests before model use', async () => {
  let called = false;
  const handler = createMaintenanceRecommendationHandler({
    ...authConfig,
    store: { async getAsset() { return { assetId: 'asset-1' }; } },
    service: { async recommend() { called = true; return validRecommendation; } },
  });
  const response = await handler(recommendationEvent('Technician', { body: '{"priority":"HIGH"}' }));
  assert.equal(response.statusCode, 400);
  assert.equal(called, false);
});

test('Week 3 SAM resources use the shared table, protected API, schedule, and scoped IAM', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const template = readFileSync(`${root}/template.yaml`, 'utf8');
  assert.match(template, /MaintenanceRecommendationFunction:/);
  assert.match(template, /Path: \/assets\/\{id\}\/maintenance-recommendation/);
  assert.match(template, /Action: dynamodb:GetItem/);
  assert.match(template, /foundation-model\/\$\{BedrockModelId\}/);
  assert.match(template, /MaintenanceCheckFunction:/);
  assert.match(template, /Schedule: cron\(0 12 \* \* \? \*\)/);
  assert.match(template, /Action: dynamodb:Scan/);
  assert.match(template, /Action: sns:Publish/);
  assert.match(template, /Resource: !Ref MaintenanceNotificationsTopic/);
  assert.match(template, /MaintenanceNotificationEmail:[\s\S]*Default: ''/);
  assert.doesNotMatch(template, /AdministratorAccess/);
});
