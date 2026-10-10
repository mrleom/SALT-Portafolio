import { S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { authenticate, authorize, HttpError } from './auth.mjs';
import { getAsset } from './assets.mjs';
import { createDynamoStore } from './store-dynamo.mjs';
import { createImageAccessService } from './image-access.mjs';

function parseReadBody(event) {
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

function parseUploadBody(event) {
  let body;
  try {
    body = JSON.parse(event.body ?? '');
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'Request body must be a JSON object');
  }
  const { filename, contentType } = body;
  const extra = Object.keys(body).filter(k => k !== 'filename' && k !== 'contentType');
  if (extra.length) throw new HttpError(400, 'Request body must contain only filename and contentType');
  if (typeof filename !== 'string') throw new HttpError(400, 'filename is required');
  if (typeof contentType !== 'string') throw new HttpError(400, 'contentType is required');
  return { filename, contentType };
}

export function createImageAccessHandler(config) {
  return async event => {
    const headers = {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': config.origin,
      'Vary': 'Origin',
    };
    try {
      const identity = authenticate(event, config);
      if (event.httpMethod === 'GET' && event.resource === '/assets/{id}/photo') {
        const asset = await getAsset(event, identity, config.store);
        if (!asset.photoKey) throw new HttpError(404, 'Asset has no photograph');
        const result = await config.service.createStoredReadUrl(asset.photoKey);
        return { statusCode: 200, headers, body: JSON.stringify(result) };
      }
      if (event.httpMethod !== 'POST') throw new HttpError(405, 'Method not allowed');

      if (event.resource === '/asset-images/upload') {
        // Get a pre-signed PUT URL so the browser can upload directly to S3
        authorize(identity, 'images:read-draft');
        const { filename, contentType } = parseUploadBody(event);
        const result = await config.service.createUploadUrl({
          subject: identity.subject,
          filename,
          contentType,
        });
        return { statusCode: 200, headers, body: JSON.stringify(result) };
      }

      if (event.resource === '/asset-images/access') {
        // Get a pre-signed GET URL to read an existing photo
        authorize(identity, 'images:read-draft');
        const { imageKey } = parseReadBody(event);
        const access = await config.service.createReadUrl({ imageKey, subject: identity.subject });
        return { statusCode: 200, headers, body: JSON.stringify(access) };
      }

      throw new HttpError(404, 'Route not found');
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
  runtimeService ??= createImageAccessService({
    s3Client: new S3Client({}),
    presign: getSignedUrl,
    bucketName: process.env.ASSET_PHOTO_BUCKET,
    expiresIn: 60,
  });
  return runtimeService;
}

export const handler = event => createImageAccessHandler({
  clientId: process.env.COGNITO_CLIENT_ID,
  issuer: process.env.COGNITO_ISSUER,
  origin: process.env.FRONTEND_ORIGIN,
  requiredScope: process.env.REQUIRED_SCOPE,
  service: serviceFromEnvironment(),
  store: createDynamoStore(process.env.ASSETS_TABLE),
})(event);
