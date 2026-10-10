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
| Source comparison | Initial snapshot: 69 copied files match the reviewed source; one test uses synthetic replacements. Later changes update build dependencies, CI checks, and one documentation path in an error message |
| Privacy patterns and documentation links | PASS: 81 text files reviewed, no unhandled findings or broken local links |
| Local HTTP smoke test | Blocked: this workspace denied both IPv4 and IPv6 loopback connections with EACCES; the development server started successfully |
| SAM packaging build | Blocked: Windows denied creation of a dependency directory with EPERM after a retry using workspace-local temporary storage |
| Fresh dependency installation and public GitHub CI | PASS: clean root/backend installs, 104 tests, frontend fixture build, local HTTP role checks, SAM lint, and all six function packages |

The public release passed [Verify SALT run 38069458905](https://github.com/mrleom/SALT-Portafolio/actions/runs/38069458905) on source commit `0e24cb23e94ceedaaa8259935c061d8145e5c30c`. GitHub's Linux runner completed the HTTP and packaging checks that were blocked in the local Windows workspace. Local tests reused installed dependencies; CI verified fresh installs. These checks do not establish live Cognito, API Gateway, Bedrock, or notification acceptance.

The original AWS demo remains paused. Preparing this source copy does not deploy, resume, or delete cloud resources.

## Dependency review: October 10, 2026

The installation warning came from `source-map-js` 1.2.1, a transitive dependency of PostCSS used by Vite. Its [high-severity advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) describes excessive processing of a crafted source map. The lockfile now uses patched version 1.2.2. Vite was also updated from 8.3.0 to 8.3.3 to include its published development-server security fixes.

[Verification run 38070488370](https://github.com/mrleom/SALT-Portafolio/actions/runs/38070488370) installed and tested these patches. Both frontend and backend audits reported zero known vulnerabilities. All 104 tests, the 623-module frontend build, anonymous and five-role HTTP checks, SAM validation, and all six function packages passed. The npm-generated lockfile was retained in the repository; routine CI installs it without changing dependency versions.

CI now audits both dependency sets and fails for high or critical advisories. Checkout, Node setup, and SAM setup use their current Node 24 action versions. Node 22 remains the application test runtime. Known-advisory audits and source-pattern checks are limited checks, not a full production security assessment.
