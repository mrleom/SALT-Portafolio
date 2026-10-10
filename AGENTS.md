# Project working instructions

- Use React + Vite for the frontend and AWS SAM for infrastructure.
- Keep the local simulated sessions separate from Cognito authentication.
- Enforce permissions in the backend, including direct API requests.
- AI suggestions require backend validation and explicit human review before saving. Do not add face recognition.
- Keep financial calculations and maintenance dates in application code.
- Update the relevant public design and verification notes when behavior changes.
- Preserve team credit and the original license. Do not claim sole authorship or unverified live acceptance.
- Do not store credentials, tokens, private evidence, or account-specific outputs in this repository or in VITE_ variables.
- Local setup and CI must not deploy to AWS. Cloud changes require the account owner's authorization and a verified target.
- On Windows use npm.cmd; npm.ps1 may be blocked by execution policy.
