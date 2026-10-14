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
