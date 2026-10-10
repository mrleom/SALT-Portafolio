# SALT — Smart Asset Lifecycle Tracker

SALT helps a team keep track of its equipment: who uses it, what it is worth, and when it needs attention. We built it as a class project and presented it on October 10, 2026.

This portfolio edition contains the application, synthetic local demo, tests, and reusable AWS infrastructure. It starts with fresh history; the original team repository stays private. The personal AWS demo is paused. You can explore the local version without an AWS account.

## What it does

- Registers equipment and tracks its assignment, condition, and history.
- Lets employees report problems and administrators follow their progress.
- Calculates depreciation and exports filtered results to CSV.
- Supports private photos and AI suggestions that a person must review before saving.
- Provides five roles with different permissions.
- Includes scheduled maintenance checks and notification infrastructure for AWS.

AI provides suggestions. The application calculates financial values and maintenance dates in code.

## Try it locally

You need Git, Node.js 22.12 or later, and npm.

```powershell
git clone https://github.com/mrleom/SALT-Portafolio.git
cd SALT-Portafolio
npm.cmd ci
npm.cmd --prefix backend ci --omit=dev --ignore-scripts
npm.cmd run dev
```

On macOS or Linux, use `npm` instead of `npm.cmd`. Open [http://localhost:3000](http://localhost:3000).

The local demo uses simulated sign-in and sample data. Restarting the server resets the data. Local setup does not deploy resources or call AWS. Photo analysis, Cognito user management, and scheduled notifications require a separate AWS deployment.

## A five-minute walkthrough

1. Sign in as Administrator and open Overview.
2. Open Assets, inspect a record, and register a sample asset.
3. Open Depreciation, try the below-50% filter, and export the visible rows.
4. Sign out and enter as Employee to report a problem on an assigned asset.
5. Return as Administrator to review the report, then try Manager and Auditor access.

| Role | Main access |
| --- | --- |
| Employee | Assigned assets and problem reporting |
| Technician | Equipment registration and maintenance |
| Manager | Assets and reports in their department |
| Administrator | Assets, assignments, users, and report status |
| Auditor | Read-only records and history |

In AWS, Cognito groups and backend checks determine access. Selecting a role on a sign-in screen cannot grant permissions.

## How it works

React and Vite provide the interface. The local demo uses an in-memory JavaScript store. In AWS, CloudFront serves the interface from private S3 storage, Cognito handles sign-in, and API Gateway passes authorized requests to Lambda. DynamoDB stores records; a separate private S3 bucket stores photos. Bedrock supplies reviewed suggestions, and EventBridge and SNS support maintenance reminders.

See the [architecture](docs/architecture.md), [data model](docs/assets-data-model.md), and [depreciation rules](docs/depreciation.md).

## Check it

```powershell
npm.cmd test
npm.cmd run check:build
```

With the local server running in another terminal:

```powershell
npm.cmd run test:local
```

The frontend check uses deliberately non-routable AWS fixture values. Its output is a test build and must not be published. GitHub Actions is configured to run tests, the build, local HTTP checks, and SAM validation/build. It does not deploy.

Fresh results and review limits are recorded in [verification](docs/verification.md).

## Where to start in the code

| Path | What to look for |
| --- | --- |
| `frontend/workspace.jsx` | Navigation and workspace layout |
| `frontend/assets.jsx` | Registration, editing, and reviewed photo suggestions |
| `backend/auth.mjs` | Identity, role, and record-access checks |
| `backend/assets.mjs` | Asset validation and depreciation |
| `backend/lifecycle.mjs` | Reports, maintenance, and history |
| `local/` | Simulated sessions and local middleware |
| `tests/` | Validation, permissions, workflows, and infrastructure checks |
| `template.yaml` | AWS SAM resources |

## What we learned and what comes next

The project brought together frontend integration, backend authorization, infrastructure, and human review of AI output. It also made the difference between passing local tests and proving live AWS behavior clear.

The presentation recorded live asset persistence, private saved-photo access, depreciation views, and Employee/Administrator reporting. That does not establish every role, AI flow, or notification path. The next steps are broader live permission checks, complete AI workflow evidence, delivered-notification tests, better auditing and recovery, and pagination for larger datasets.

This is a class and portfolio project. Read the [security notes](SECURITY.md) and [AWS preparation notes](docs/deployment-security.md) before planning a deployment.

## Team and credit

SALT is a team project, maintained here by [mrleom](https://github.com/mrleom). This public snapshot does not represent sole authorship. Sushma's SMART workflows helped shape the integration. The original license and attribution are preserved; see [credits](CREDITS.md) and [LICENSE](LICENSE).

For feedback or a small improvement, see [CONTRIBUTING.md](CONTRIBUTING.md).
