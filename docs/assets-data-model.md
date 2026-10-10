# Asset records and permissions

SALT stores asset metadata, maintenance, audit, and problem-report records in one DynamoDB table. Local mode implements the same store interface in memory using synthetic records.

| Record | Partition key | Sort key |
| --- | --- | --- |
| Asset metadata | `ASSET#<id>` | `METADATA` |
| Maintenance | `ASSET#<id>` | `MAINT#<date>#<id>` |
| Audit history | `ASSET#<id>` | `AUDIT#<timestamp>#<id>` |
| Problem report | `ASSET#<id>` | `REPORT#<id>` |
| User profile | `USER#<subject>` | `PROFILE` |
| Unique asset tag | `TAG#<normalized-tag>` | `UNIQUE` |

Indexes support tag lookup, assignment, and department lists. Asset metadata and related audit/maintenance writes use transactions. A tag reservation prevents conflicting new tag writes. Existing legacy data may have no historical audit records.

The backend restricts Employee access to assigned assets and Manager access to the user's department. Technician and Administrator can register assets; Auditor reads records and history without editing. Administrative user management and financial edits have separate permission checks. Hidden buttons are not the security boundary.

Asset inputs include category, description, assignment, location, condition, status, purchase values, useful life, dates, and a private photo reference. Validation rejects unknown properties, invalid values, and overlong text. Book value is calculated when records are read; it is not a stored balance.

Reports follow Open, In Progress, and Resolved states. A resolved practice report is not evidence of a real equipment repair. Use synthetic data for demonstrations and tests.
