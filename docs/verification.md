# Portfolio verification

Prepared October 10, 2026 for the public SALT-Portafolio edition. The original team repository remains private.

## Source and privacy review

The portfolio was built from an explicit source-file list. It contains the application, tests, synthetic fixtures, infrastructure, public configuration placeholders, and new public documentation. Original Git history, deployment records, private evidence, generated illustrations, and the instructor's PDF are excluded.

Personal email examples in the display-label test were replaced with reserved example addresses. The application's behavior and original license are unchanged. A deliberately fake account number remains in a mocked SNS ARN in a unit test; it is not a deployment target.

All included files are UTF-8 text, including the small favicon SVG. The SVG was inspected and contains only drawing elements. Review checks cover common AWS key, GitHub token, private-key, JWT, personal-email, deployed-endpoint, signed-link, account-number, and absolute-user-path patterns, plus local documentation links. Pattern checks are not a guarantee that every possible secret has been detected.

## Checks

| Check | October 10 result |
| --- | --- |
| Automated tests | PASS: 104/104 |
| Frontend fixture build | PASS: 623 modules transformed |
| SAM template lint/validation | PASS |
| Source comparison | 69 copied files match the reviewed GitHub source after line-ending normalization; one test contains the reviewed synthetic replacements |
| Privacy patterns and documentation links | PASS: 81 text files reviewed, no unhandled findings or broken local links |
| Local HTTP smoke test | Blocked: this workspace denied both IPv4 and IPv6 loopback connections with EACCES; the development server started successfully |
| SAM packaging build | Blocked: Windows denied creation of a dependency directory with EPERM after a retry using workspace-local temporary storage |
| Fresh dependency installation and public GitHub CI | PASS: clean root/backend installs, 104 tests, frontend fixture build, local HTTP role checks, SAM lint, and all six function packages |

The public release passed [Verify SALT run 38069458905](https://github.com/mrleom/SALT-Portafolio/actions/runs/38069458905) on source commit `0e24cb23e94ceedaaa8259935c061d8145e5c30c`. GitHub's Linux runner completed the HTTP and packaging checks that were blocked in the local Windows workspace. Local tests reused installed dependencies; CI verified fresh installs. These checks do not establish live Cognito, API Gateway, Bedrock, or notification acceptance.

The original AWS demo remains paused. Preparing this source copy does not deploy, resume, or delete cloud resources.
