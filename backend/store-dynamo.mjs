import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, ScanCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';

import { HttpError } from './auth.mjs';

export function createDynamoStore(tableName, client) {
  if (!tableName) return undefined;
  client ??= DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const get = async (pk, sk) => {
    const result = await client.send(new GetCommand({ TableName: tableName, Key: { PK: pk, SK: sk } }));
    return result.Item;
  };
  const queryIndex = async (index, pk) => {
    const items = [];
    let start;
    do {
      const result = await client.send(new QueryCommand({
        TableName: tableName, IndexName: index, ExclusiveStartKey: start,
        KeyConditionExpression: '#pk = :pk',
        ExpressionAttributeNames: { '#pk': index === 'GSI1' ? 'GSI1PK' : index === 'GSI2' ? 'GSI2PK' : 'GSI3PK' },
        ExpressionAttributeValues: { ':pk': pk },
      }));
      items.push(...(result.Items || []));
      start = result.LastEvaluatedKey;
    } while (start);
    return items;
  };
  return {
    async getAsset(id) { return get(`ASSET#${id}`, 'METADATA'); },
    async getByTag(tag) {
      const items = await queryIndex('GSI1', `TAG#${tag.toLowerCase()}`);
      return items[0];
    },
    async listByUser(userId) { return queryIndex('GSI2', `USER#${userId}`); },
    async listByDepartment(department) { return queryIndex('GSI3', `DEPT#${department}`); },
    async scanAssets() {
      const items = [];
      let start;
      do {
        const result = await client.send(new ScanCommand({
          TableName: tableName, ExclusiveStartKey: start,
          FilterExpression: 'SK = :meta',
          ExpressionAttributeValues: { ':meta': 'METADATA' },
        }));
        items.push(...(result.Items || []));
        start = result.LastEvaluatedKey;
      } while (start);
      return items;
    },
    async putAsset(item) {
      await client.send(new PutCommand({ TableName: tableName, Item: item }));
    },
    async putRecord(item) { await client.send(new PutCommand({ TableName: tableName, Item: item })); },
    async listRecords(id, prefix) {
      const items = []; let start;
      do {
        const result = await client.send(new QueryCommand({ TableName: tableName, ExclusiveStartKey: start,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
          ExpressionAttributeValues: { ':pk': `ASSET#${id}`, ':prefix': prefix }, ScanIndexForward: false }));
        items.push(...(result.Items || [])); start = result.LastEvaluatedKey;
      } while (start);
      return items;
    },
    async scanRecords(prefix) {
      const items = []; let start;
      do {
        const result = await client.send(new ScanCommand({ TableName: tableName, ExclusiveStartKey: start,
          FilterExpression: 'begins_with(SK, :prefix)', ExpressionAttributeValues: { ':prefix': prefix } }));
        items.push(...(result.Items || [])); start = result.LastEvaluatedKey;
      } while (start);
      return items;
    },
    async commitAsset(item, records, previousUpdatedAt, previousTag) {
      const condition = previousUpdatedAt === null ? { ConditionExpression: 'attribute_not_exists(PK)' } : {
        ConditionExpression: 'updatedAt = :previous', ExpressionAttributeValues: { ':previous': previousUpdatedAt } };
      try {
        const tagWrites = item.assetTag ? [{ Put: { TableName: tableName,
          Item: { PK: `TAG#${item.assetTag.toLowerCase()}`, SK: 'UNIQUE', assetId: item.assetId },
          ConditionExpression: 'attribute_not_exists(PK) OR assetId = :id', ExpressionAttributeValues: { ':id': item.assetId } } }] : [];
        if (previousTag && previousTag.toLowerCase() !== item.assetTag.toLowerCase()) tagWrites.push({ Delete: {
          TableName: tableName, Key: { PK: `TAG#${previousTag.toLowerCase()}`, SK: 'UNIQUE' },
          ConditionExpression: 'attribute_not_exists(PK) OR assetId = :id', ExpressionAttributeValues: { ':id': item.assetId } } });
        await client.send(new TransactWriteCommand({ TransactItems: [
          { Put: { TableName: tableName, Item: item, ...condition } },
          ...tagWrites,
          ...records.map(record => ({ Put: { TableName: tableName, Item: record } }))
        ] }));
      } catch (error) {
        if (error.name === 'TransactionCanceledException') throw new HttpError(409, 'Record changed; reload and try again');
        throw error;
      }
    },
    async getProfile(sub) { return get(`USER#${sub}`, 'PROFILE'); },
    async putProfile(item) {
      await client.send(new PutCommand({ TableName: tableName, Item: item }));
    },
  };
}
