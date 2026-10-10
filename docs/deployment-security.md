# Preparing an AWS deployment

The local demo needs no AWS account. Deploying the SAM template is a separate activity for an authorized account owner and can create billable resources. This public repository does not provide access to the original team's AWS account, users, or data.

## Before deployment

1. Verify the intended AWS identity, account, region, and stack name.
2. Review template parameters, IAM permissions, estimated costs, storage retention, and recovery requirements.
3. Build the backend and review the processed CloudFormation change set before executing it.
4. Configure the frontend from the new stack's outputs. The example environment file contains blank public settings, not credentials.
5. Plan first-admin provisioning and test users privately.
6. Verify real sign-in, role restrictions, persistence, private photos, AI review, notification delivery, and recovery.

GitHub Actions validates/builds the template but does not deploy. A passing build is not evidence of live authorization or notification delivery.

## Included controls and remaining decisions

The template includes private buckets, encryption, transport restrictions, scoped photo/model access, DynamoDB point-in-time recovery, log retention, error alarms, and an encrypted notification topic. Review the deployed configuration rather than assuming every control is sufficient for production.

The CloudFront default certificate does not establish TLS 1.2-only viewer access. Durable CloudTrail coverage, API access logging, table deletion protection, spending controls, and full recovery procedures need an account-specific review.

Photo storage and the notification encryption key have retention behavior. Stack deletion is not a guarantee that all resources or charges disappear. Inspect retained resources separately; never delete them without checking ownership and recovery needs.

## Optional helper scripts

The `seed:sandbox`, `verify:sandbox`, and `publish:frontend` commands use an explicit `AWS_PROFILE`, `SALT_ACCOUNT`, and `SALT_STACK`, with `AWS_REGION` defaulting to `us-east-1`. They verify the target account before continuing. Read the scripts before using them: seeding writes synthetic assets and publishing uploads frontend files and refreshes CloudFront.

None of these helpers runs during dependency installation, local startup, tests, or CI. Do not run them against another person's account or use the original private deployment settings.
