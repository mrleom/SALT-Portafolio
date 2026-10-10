import { ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { HttpError } from './auth.mjs';
import { BEDROCK_SYSTEM_PROMPT, parseAiSuggestion } from './ai-suggestion.mjs';
import {
  MAX_IMAGE_BYTES,
  bodyToBytes,
  detectImageFormat,
  validateOwnedImageKey,
} from './image-reference.mjs';

function modelText(response) {
  const content = response?.output?.message?.content;
  if (!Array.isArray(content)) throw new HttpError(502, 'AI service returned an unusable response');
  const textParts = content.filter(part => typeof part?.text === 'string').map(part => part.text);
  if (textParts.length !== 1) throw new HttpError(502, 'AI service returned an unusable response');
  return textParts[0];
}

function configured(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(503, `${name} is not configured`);
  return value.trim();
}

export function createImageAnalysisService({
  s3Client,
  bedrockClient,
  bucketName,
  modelId,
  maxImageBytes = MAX_IMAGE_BYTES,
  manualThreshold = 0.5,
}) {
  return Object.freeze({
    async analyze({ imageKey, subject }) {
      const Bucket = configured(bucketName, 'Asset photo bucket');
      const selectedModel = configured(modelId, 'Bedrock model');
      const Key = validateOwnedImageKey(imageKey, subject);
      let object;
      try {
        object = await s3Client.send(new GetObjectCommand({ Bucket, Key }));
      } catch (error) {
        if (error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404) {
          throw new HttpError(404, 'Image was not found');
        }
        throw new HttpError(502, 'Private image could not be read');
      }
      if (Number(object.ContentLength) > maxImageBytes) {
        throw new HttpError(413, 'Image exceeds the maximum allowed size');
      }
      const bytes = await bodyToBytes(object.Body, maxImageBytes);
      const image = detectImageFormat(bytes, object.ContentType);

      let response;
      try {
        response = await bedrockClient.send(new ConverseCommand({
          modelId: selectedModel,
          system: [{ text: BEDROCK_SYSTEM_PROMPT }],
          inferenceConfig: { maxTokens: 900, temperature: 0, topP: 0.1 },
          messages: [{
            role: 'user',
            content: [
              { image: { format: image.format, source: { bytes } } },
              { text: 'Analyze this asset photograph and return only the required JSON object.' },
            ],
          }],
        }));
      } catch {
        throw new HttpError(502, 'AI service could not analyze the image');
      }
      return parseAiSuggestion(modelText(response), { manualThreshold });
    },
  });
}
