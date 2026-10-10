# Security notes

SALT is a class and portfolio project. It has not had a complete production security review.

## Report a concern

Contact the repository owner privately with the affected file, expected behavior, and a short reproduction using synthetic data. Do not put credentials, tokens, real asset data, or private photo links in an issue.

## Important boundaries

- Local sign-in and sample data are development fixtures. They do not prove Cognito or API Gateway security.
- The deployed API checks Cognito access tokens; Lambda also checks groups and record access.
- Direct Lambda invocation must be restricted to approved callers.
- Private photo links grant temporary access. Do not log or publish them.
- AI output is validated and reviewed before saving. The app does not use face recognition.
- Every VITE_ value is visible in the browser. Use only public configuration there.
- Existing access tokens can remain valid until expiry after logout or membership changes.

## Areas for further review

Complete live five-role and forbidden-request checks, password recovery, both AI workflows, and actual notification delivery before relying on the app in production. Review audit coverage, recovery, deletion protection, access logging, and pagination.

The template uses CloudFront's default certificate, which does not establish a TLS 1.2-only viewer policy. Retained storage, backups, logs, and the notification encryption key can incur charges. See [deployment notes](docs/deployment-security.md).

This public edition includes source and synthetic fixtures. It contains no live database export or personal deployment configuration. Pattern checks reduce accidental disclosure; they are not proof that every possible secret has been detected.
