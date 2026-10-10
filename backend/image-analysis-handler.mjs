import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { S3Client } from '@aws-sdk/client-s3';
import { authenticate, authorize, HttpError } from './auth.mjs';
import { createImageAnalysisService } from './image-analysis.mjs';

function parseBody(event) {
  let body;
  try {
    body = JSON.parse(event.body ?? '');
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).length !== 1 || typeof body.imageKey !== 'string') {
    throw new HttpError(400, 'Request body must contain only imageKey');
  }
  return body;
}

export function createImageAnalysisHandler(config) {
  return async event => {
    const headers = {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': config.origin,
      'Vary': 'Origin',
    };
    try {
      const identity = authenticate(event, config);
      authorize(identity, 'images:analyze');
      if (event.httpMethod !== 'POST' || event.resource !== '/asset-images/analyze') {
        throw new HttpError(404, 'Route not found');
      }
      const { imageKey } = parseBody(event);
      const suggestion = await config.service.analyze({ imageKey, subject: identity.subject });
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ imageKey, suggestion, requiresUserReview: true }),
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
  runtimeService ??= createImageAnalysisService({
    s3Client: new S3Client({}),
    bedrockClient: new BedrockRuntimeClient({}),
    bucketName: process.env.ASSET_PHOTO_BUCKET,
    modelId: process.env.BEDROCK_MODEL_ID,
  });
  return runtimeService;
}

export const handler = event => createImageAnalysisHandler({
  clientId: process.env.COGNITO_CLIENT_ID,
  issuer: process.env.COGNITO_ISSUER,
  origin: process.env.FRONTEND_ORIGIN,
  requiredScope: process.env.REQUIRED_SCOPE,
  service: serviceFromEnvironment(),
})(event);
