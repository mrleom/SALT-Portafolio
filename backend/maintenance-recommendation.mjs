import { ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { HttpError } from './auth.mjs';
import { parseMaintenanceRecommendation } from './maintenance-recommendation-schema.mjs';

const INPUT_FIELDS = Object.freeze([
  'category', 'purchaseDate', 'condition', 'usageLevel', 'operatingEnvironment',
  'lastCleaningDate', 'lastMaintenanceDate', 'repairCount', 'totalRepairCost',
  'warrantyExpiration', 'usefulLifeYears', 'expectedUsefulLifeYears', 'nextMaintenanceDate',
]);

export const MAINTENANCE_SYSTEM_PROMPT = `
You provide conservative, AI-assisted maintenance recommendations for business assets.
Use only facts in the supplied asset JSON. Missing properties are unknown: never invent
serial numbers, costs, dates, usage, maintenance history, warranty details, or other facts.
Do not calculate depreciation, book value, financial forecasts, budgets, or dates. If the
input contains nextMaintenanceDate, recommendedCompletionDate may only copy that exact date;
otherwise recommendedCompletionDate must be null. Do not claim that equipment failure is
guaranteed. This is not predictive maintenance. The result is
an AI-assisted suggestion that requires human review. Return only one JSON object with
exactly these properties and no Markdown:
{
  "priority": "LOW" | "MEDIUM" | "HIGH",
  "recommendedAction": string,
  "recommendedCompletionDate": "YYYY-MM-DD" or null,
  "maintenanceIntervalDays": integer from 1 through 3650 or null,
  "expectedReplacementWindow": string or null,
  "explanation": string,
  "reviewStatus": "AI_SUGGESTED"
}
Use null when supplied facts do not support a date, interval, or replacement window.
`.trim();

function configured(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(503, `${name} is not configured`);
  return value.trim();
}

function modelText(response) {
  const content = response?.output?.message?.content;
  if (!Array.isArray(content)) throw new HttpError(502, 'AI service returned an unusable response');
  const text = content.filter(part => typeof part?.text === 'string').map(part => part.text);
  if (text.length !== 1) throw new HttpError(502, 'AI service returned an unusable response');
  return text[0];
}

export function maintenanceAssetSnapshot(asset) {
  const result = {};
  for (const field of INPUT_FIELDS) {
    const value = asset?.[field];
    if (typeof value === 'string' && value.trim()) result[field] = value.trim().slice(0, 1000);
    else if (typeof value === 'number' && Number.isFinite(value) && value >= 0) result[field] = value;
  }
  return Object.freeze(result);
}

export function createMaintenanceRecommendationService({ bedrockClient, modelId }) {
  return Object.freeze({
    async recommend(asset) {
      const selectedModel = configured(modelId, 'Bedrock model');
      const snapshot = maintenanceAssetSnapshot(asset);
      let response;
      try {
        response = await bedrockClient.send(new ConverseCommand({
          modelId: selectedModel,
          system: [{ text: MAINTENANCE_SYSTEM_PROMPT }],
          inferenceConfig: { maxTokens: 800, temperature: 0, topP: 0.1 },
          messages: [{
            role: 'user',
            content: [{ text: `Asset information:\n${JSON.stringify(snapshot)}\nReturn only the required JSON object.` }],
          }],
        }));
      } catch {
        throw new HttpError(503, 'AI maintenance recommendation is temporarily unavailable');
      }
      const recommendation = parseMaintenanceRecommendation(modelText(response));
      if (recommendation.recommendedCompletionDate !== null &&
          recommendation.recommendedCompletionDate !== snapshot.nextMaintenanceDate) {
        throw new HttpError(502, 'AI maintenance recommendation invented an unsupported date');
      }
      return recommendation;
    },
  });
}
