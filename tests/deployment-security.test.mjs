import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Configuration regressions only: cfn-lint/Guard and real AWS acceptance remain separate.
const template = readFileSync(new URL('../template.yaml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function resource(id) {
  const match = template.match(new RegExp(`^  ${id}:\\n([\\s\\S]*?)(?=^  [A-Za-z][A-Za-z0-9]*:|^Outputs:)`, 'm'));
  assert.ok(match, `Missing resource ${id}`);
  return match[1];
}

const alarms = {
  DemoFunctionErrorsAlarm: 'demo-errors',
  ImageAnalysisFunctionErrorsAlarm: 'image-analysis-errors',
  ImageAccessFunctionErrorsAlarm: 'image-access-errors',
  MaintenanceRecommendationFunctionErrorsAlarm: 'maintenance-recommendation-errors',
  MaintenanceCheckFunctionErrorsAlarm: 'maintenance-check-errors',
  UsersFunctionErrorsAlarm: 'users-errors',
};

test('deployment: both private S3 buckets deny HTTP at bucket and object scope', () => {
  for (const id of ['FrontendBucket', 'AssetPhotoBucket']) {
    const bucket = resource(id);
    for (const setting of ['BlockPublicAcls', 'BlockPublicPolicy', 'IgnorePublicAcls', 'RestrictPublicBuckets']) {
      assert.ok(bucket.includes(`${setting}: true`));
    }
    assert.ok(bucket.includes('SSEAlgorithm: AES256'));
    const policy = resource(`${id}Policy`);
    assert.match(policy, /Sid: DenyInsecureTransport\n\s+Effect: Deny\n\s+Principal: '\*'\n\s+Action: 's3:\*'/);
    assert.ok(policy.includes(`!GetAtt ${id}.Arn`));
    assert.ok(policy.includes(`!Sub '\$\{${id}.Arn\}/*'`));
    assert.match(policy, /Bool:\n\s+aws:SecureTransport: false/);
    assert.doesNotMatch(policy, /Effect: Allow\n\s+Principal: '\*'/);
  }
  assert.match(resource('FrontendBucketPolicy'), /Service: cloudfront.amazonaws.com/);
  assert.ok(resource('FrontendBucketPolicy').includes('distribution/${FrontendDistribution}'));
});

test('deployment: notification encryption uses a rotated, retained symmetric customer key', () => {
  const key = resource('MaintenanceNotificationsKey');
  for (const setting of ['DeletionPolicy: Retain', 'UpdateReplacePolicy: Retain', 'KeySpec: SYMMETRIC_DEFAULT',
    'KeyUsage: ENCRYPT_DECRYPT', 'EnableKeyRotation: true', 'PendingWindowInDays: 30']) {
    assert.ok(key.includes(setting));
  }
  assert.ok(key.includes("AWS: !Sub 'arn:${AWS::Partition}:iam::${AWS::AccountId}:root'"));
  assert.doesNotMatch(key, /BypassPolicyLockoutSafetyCheck|alias\/aws\/sns/);
  assert.ok(resource('MaintenanceNotificationsTopic').includes('KmsMasterKeyId: !GetAtt MaintenanceNotificationsKey.Arn'));
});

test('deployment: key and topic grants match only the six stack-specific alarms without cycles', () => {
  const key = resource('MaintenanceNotificationsKey');
  const topicPolicy = resource('MaintenanceNotificationsTopicPolicy');
  for (const policy of [key, topicPolicy]) {
    assert.match(policy, /Service: cloudwatch.amazonaws.com/);
    assert.match(policy, /aws:SourceAccount: !Ref AWS::AccountId/);
    assert.match(policy, /ArnEquals:\n\s+aws:SourceArn:/);
    const allowed = [...policy.matchAll(/- !Sub '(arn:[^'\n]+:alarm:[^'\n]+)'/g)].map(match => match[1]);
    assert.deepEqual(allowed.sort(), Object.values(alarms).map(suffix =>
      `arn:\$\{AWS::Partition\}:cloudwatch:\$\{AWS::Region\}:\$\{AWS::AccountId\}:alarm:\$\{AWS::StackName\}-${suffix}`).sort());
    assert.doesNotMatch(policy, /!GetAtt .*ErrorsAlarm|!Ref .*ErrorsAlarm/);
  }
  assert.match(key, /Action: \[kms:GenerateDataKey, kms:Decrypt\]/);
  assert.match(topicPolicy, /Action: sns:Publish\n\s+Resource: !Ref MaintenanceNotificationsTopic/);
  for (const [id, suffix] of Object.entries(alarms)) {
    const alarm = resource(id);
    assert.ok(alarm.includes(`AlarmName: !Sub '\$\{AWS::StackName\}-${suffix}'`));
    assert.match(alarm, /DependsOn: MaintenanceNotificationsTopicPolicy/);
    assert.match(alarm, /AlarmActions: \[!Ref MaintenanceNotificationsTopic\]/);
  }
});

test('deployment: maintenance publisher KMS access is limited to its key and SNS topic context', () => {
  const checker = resource('MaintenanceCheckFunction');
  const encryptionStatement = checker.split('Sid: EncryptMaintenanceNotifications')[1].split('\n      Events:')[0];
  assert.match(encryptionStatement, /Action: \[kms:GenerateDataKey, kms:Decrypt\]/);
  assert.match(encryptionStatement, /Resource: !GetAtt MaintenanceNotificationsKey.Arn/);
  assert.ok(encryptionStatement.includes("kms:ViaService: !Sub 'sns.${AWS::Region}.${AWS::URLSuffix}'"));
  assert.match(encryptionStatement, /kms:EncryptionContext:aws:sns:topicArn: !Ref MaintenanceNotificationsTopic/);
  assert.doesNotMatch(encryptionStatement, /Resource: '\*'|Action: 'kms:\*'/);
  for (const id of ['DemoFunction', 'ImageAccessFunction', 'ImageAnalysisFunction', 'MaintenanceRecommendationFunction', 'UsersFunction']) {
    assert.doesNotMatch(resource(id), /kms:/);
  }
});

test('deployment: hosting and optional email remain unchanged by security hardening', () => {
  assert.match(resource('FrontendDistribution'), /ViewerProtocolPolicy: redirect-to-https/);
  assert.match(resource('FrontendDistribution'), /CloudFrontDefaultCertificate: true/);
  assert.doesNotMatch(template, /Type: AWS::Amplify::/);
  assert.match(resource('MaintenanceNotificationEmailSubscription'), /Condition: HasMaintenanceNotificationEmail/);
  assert.match(resource('MaintenanceNotificationEmailSubscription'), /Endpoint: !Ref MaintenanceNotificationEmail/);
});
