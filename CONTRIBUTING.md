# Working on SALT

Use a small branch and pull request for each change. Explain the problem, resulting behavior, and how you checked it.

Install both dependency sets, then run `npm.cmd test` and `npm.cmd run check:build`. Use `npm` on macOS or Linux. For API or role changes, also run `npm.cmd run test:local` against the local server. For infrastructure changes, run SAM lint/build and inspect the result.

Use synthetic data in examples. Keep credentials, account-specific settings, real asset exports, and private screenshots out of Git. Local setup and CI must stay separate from AWS deployment.

Update the relevant documentation when behavior changes. Add focused regression tests when needed. Report sensitive security findings privately to the repository owner; see [SECURITY.md](SECURITY.md).
