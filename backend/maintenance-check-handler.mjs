import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { createDynamoStore } from './store-dynamo.mjs';
import { buildMaintenanceNotification } from './maintenance-notification.mjs';

function configured(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is not configured`);
  return value.trim();
}

export function createMaintenanceCheckHandler({ store, snsClient, topicArn, upcomingDays = 7, now = () => new Date() }) {
  return async () => {
    if (!store) throw new Error('Asset storage is not configured');
    if (!Number.isInteger(upcomingDays) || upcomingDays < 0 || upcomingDays > 365) {
      throw new Error('Upcoming threshold must be an integer from 0 through 365');
    }
    const TopicArn = configured(topicArn, 'Maintenance notifications topic');
    const assets = await store.scanAssets();
    const result = { scanned: assets.length, notified: 0, skippedInvalid: 0 };
    for (const asset of assets) {
      let notification;
      try {
        notification = buildMaintenanceNotification(asset, { now: now(), upcomingDays });
      } catch (error) {
        result.skippedInvalid += 1;
        console.warn('Skipping asset with invalid maintenance scheduling data', {
          assetId: typeof asset?.assetId === 'string' ? asset.assetId : 'unknown',
          reason: error instanceof Error ? error.message : 'invalid data',
        });
        continue;
      }
      if (!notification) continue;
      await snsClient.send(new PublishCommand({
        TopicArn,
        Subject: notification.subject,
        Message: notification.message,
      }));
      result.notified += 1;
    }
    return result;
  };
}

let runtimeHandler;
export const handler = async event => {
  runtimeHandler ??= createMaintenanceCheckHandler({
    store: createDynamoStore(process.env.ASSETS_TABLE),
    snsClient: new SNSClient({}),
    topicArn: process.env.MAINTENANCE_TOPIC_ARN,
    upcomingDays: Number(process.env.UPCOMING_DAYS || 7),
  });
  return runtimeHandler(event);
};
