# Dependency workflow and security upgrade — 2026-10-27

The app continues to target Node 24.x. `package-lock.json` is now committed and
defines the reviewed dependency tree. This supersedes the unlocked-install
policy recorded in the historical September 15 section below. Keep that record
as evidence of its own release; it is not the current installation procedure.

## Reproducible installation

Use `npm ci` for local installation. The existing production workflow builds
the frontend and starts the TypeScript server through `tsx`, so install with
`npm ci --include=dev` there. Do not use `--omit=dev` with this workflow. The
build, startup and serial Playwright commands retain their current roles.

Update `package.json` and `package-lock.json` together when changing dependencies.
Review changed transitive packages and npm's version-specific install-script
allowlist; do not broadly permit installation scripts. Verify a clean `npm ci`
using the committed lockfile before releasing an upgrade. Restore the matching
manifest and lockfile together when rolling back an upgrade checkpoint.

`@types/node` follows Node 24 rather than npm's newest Node declaration major.
`@openai/codex` remains a development-only maintenance tool; normal app startup
and tests do not require Codex authentication. Its review script is checked with
shell syntax and CLI compatibility probes, without launching the autonomous
editing loop as validation.

The backend launchers explicitly select development or production mode. The
test harness selects test mode. Raw server execution defaults to production,
and `TEST_MODE=true` outside test mode is rejected. Production deployment steps
are documented in [the hosting checklist](security-deployment.md).

## Upgrade checkpoints

Security-related runtime dependencies are upgraded first, with the MCP tool
argument budget and resource check configured explicitly. Check the resolved
body-parser and proxy-addr versions in the lockfile: an Express version range
alone does not establish the transitive versions actually installed.

The build/test/maintenance updates and the Preact 11 major upgrade have separate
validation checkpoints. Preact compatibility changes preserve the existing
rendering, layout, drafts and dismissal behavior. Compare the old and new app
with one pinned Chromium executable; also exercise the final tree with the
Chromium revision bundled with the updated Playwright package.

## Validated upgrade checkpoint

Runtime: v24.21.0; npm 11.19.0. Native SQLite reports 3.53.4.

| Package | Resolved version |
| --- | --- |
| `@modelcontextprotocol/sdk` | 1.32.2 |
| `@zxing/browser` | 0.2.1 |
| `@zxing/library` | 0.23.0 |
| `better-sqlite3` | 13.0.3 |
| `express` | 5.3.0 |
| `express-rate-limit` | 8.7.1 |
| `postmark` | 5.1.0 |
| `preact` | 11.1.0 |
| `zod` | 4.6.7 |
| `@openai/codex` | 0.164.0 |
| `@playwright/test` | 1.64.1 |
| `@preact/preset-vite` | 2.10.6 |
| `@types/better-sqlite3` | 9.6.0 |
| `@types/express` | 5.0.6 |
| `@types/node` | 24.19.2 |
| `tsx` | 4.23.15 |
| `typescript` | 7.0.2 |
| `vite` | 8.3.5 |
| `body-parser` | 2.4.0 |
| `proxy-addr` | 2.0.8 |
| `@babel/core` | 7.29.7 |
| `baseline-browser-mapping` | 2.11.33 |
| `browserslist` | 4.29.5 |

The tooling checkpoint passed all three TypeScript checks, journey validation,
the production build and the focused serial compatibility suite before the
Preact major upgrade. Matching Chromium, Firefox and WebKit are installed.
The maintenance script passes shell syntax checking and the new CLI accepts its
feature flags; its autonomous editing loop was not run. The existing large-chunk
build warning remains a separate optimization concern.

See [security controls](security-hardening.md) and [deployment/rollback](security-deployment.md)
for release gates. A release must pass a clean locked installation, dependency
audits, the full serial suite and same-browser visual comparison.

---

The following is the historical September release record; its unlocked-install
policy no longer applies.

# Dependency upgrade — 2026-09-15

The app targets Node 24.x. Validation used Node 24.18.0 and npm 11.16.0.
`package-lock.json` remains ignored, as requested. Versions below describe the
installed and tested dependency tree; subsequent unlocked installs can resolve
new compatible releases.

## Installed versions

| Package | Version |
| --- | --- |
| `preact` | 10.29.8 |
| `@preact/preset-vite` | 2.10.6 |
| `vite` | 8.3.0 |
| `@playwright/test` | 1.63.0 |
| `typescript` | 7.0.2 |
| `tsx` | 4.23.13 |
| `better-sqlite3` | 13.0.3 |
| `@types/better-sqlite3` | 9.6.0 |
| `postmark` | 5.1.0 |
| `zod` | 4.6.5 |
| `@openai/codex` | 0.154.0 |
| `@zxing/browser` | 0.2.1 |
| `@zxing/library` | 0.23.0 |
| `@types/node` | 24.13.4 |

The other direct dependencies remain `@modelcontextprotocol/sdk` 1.30.0,
`express` 5.2.1, and `@types/express` 5.0.6. Node typings intentionally follow
the Node 24 runtime rather than the Node 26 version suggested by `ncu`.
`@openai/codex` is a development dependency used only by
`scripts/review-e2e.sh`; the application does not require Codex authentication.

## Installation and runtime checks

- `npm install` followed by `npm update` refreshed compatible transitive packages.
- `npm ls --all` passed. Full and production-only audits report zero
  vulnerabilities, down from 17 findings (including 10 high) in the original
  installed tree.
- A fresh installation from only `package.json`, with no lockfile, resolved all
  the same direct versions and passed native SQLite, TypeScript, and tsx probes.
- `npm run build` passed. Vite retains its existing warning about a minified
  JavaScript chunk larger than 500 kB.
- The production `server:start` script served both the build and API using a
  temporary database and explicit test environment.
- Vite startup, API proxying, and a real Preact hot update passed. The hot update
  preserved an unfinished email field; the temporary source edit was restored.
- The `server:dev` script successfully restarted after a watched source change.
- SQLite 13 loaded its native module, applied all migrations, prepared all
  application statements, rolled back a failed transaction, and retained grouped
  entries and a weigh-in after closing and reopening a temporary database.
  Integrity and foreign-key checks passed with bundled SQLite 3.53.4.

## Regression validation

The Playwright validation covered application behavior, MCP ownership, schemas,
transaction rollback, email delivery integration, and barcode decoding.

All three final typechecks passed: `npm run typecheck`,
`npm run typecheck:server`, and `npm run typecheck:tests`. Matching Playwright
Chromium was installed. Journey duplicate-ID and bidirectional-link checks and
`git diff --check` passed.

## Scope of integration coverage

Barcode tests pass real EAN-13 and UPC-A video frames through the installed ZXing
decoder. They cover exact results, duplicate suppression, camera teardown,
reopening, and denied/missing cameras. Email tests exercise the actual sender and
Postmark client using a local fetch stub, including API and network failures.

Physical Android/iOS camera behavior remains a deployment smoke check. No real
email delivery is part of the automated tests.
