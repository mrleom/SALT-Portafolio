import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { authenticate, authorize, HttpError } from './auth.mjs';
import { createDynamoStore } from './store-dynamo.mjs';
import { createMaintenanceRecommendationService } from './maintenance-recommendation.mjs';

function validateRequest(event) {
  if (event.httpMethod !== 'POST' || event.resource !== '/assets/{id}/maintenance-recommendation') {
    throw new HttpError(404, 'Route not found');
  }
  const id = event.pathParameters?.id;
  if (typeof id !== 'string' || !id.trim() || id.length > 128 || /[\u0000-\u001f/]/.test(id)) {
    throw new HttpError(400, 'A valid asset id is required');
  }
  if (event.body && event.body.trim()) {
    let body;
    try { body = JSON.parse(event.body); }
    catch { throw new HttpError(400, 'Request body must be valid JSON'); }
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length > 0) {
      throw new HttpError(400, 'Request body must be empty');
    }
  }
  return id.trim();
}

export function createMaintenanceRecommendationHandler(config) {
  return async event => {
    const headers = {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': config.origin,
      'Vary': 'Origin',
    };
    try {
      const identity = authenticate(event, config);
      authorize(identity, 'maintenance:recommend');
      const id = validateRequest(event);
      if (!config.store) throw new HttpError(503, 'Asset storage is not configured');
      const asset = await config.store.getAsset(id);
      if (!asset) throw new HttpError(404, 'Asset was not found');
      const recommendation = await config.service.recommend(asset);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ assetId: id, recommendation, requiresUserReview: true }),
      };
    } catch (error) {
      const known = error instanceof HttpError;
      return {
        statusCode: known ? error.statusCode : 500,
        headers,
        body: JSON.stringify({ error: known ? error.message : 'Internal server error' }),
      };
    }
  };
}

let runtimeService;
function serviceFromEnvironment() {
  runtimeService ??= createMaintenanceRecommendationService({
    bedrockClient: new BedrockRuntimeClient({}),
    modelId: process.env.BEDROCK_MODEL_ID,
  });
  return runtimeService;
}

export const handler = event => createMaintenanceRecommendationHandler({
  clientId: process.env.COGNITO_CLIENT_ID,
  issuer: process.env.COGNITO_ISSUER,
  origin: process.env.FRONTEND_ORIGIN,
  requiredScope: process.env.REQUIRED_SCOPE,
  store: createDynamoStore(process.env.ASSETS_TABLE),
  service: serviceFromEnvironment(),
})(event);
