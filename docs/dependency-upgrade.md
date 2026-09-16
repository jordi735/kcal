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
| `multer` | 2.4.0 |
| `@types/multer` | 2.2.0 |
| `postmark` | 5.1.0 |
| `zod` | 4.6.5 |
| `@openai/codex` | 0.154.0 |
| `@zxing/browser` | 0.2.1 |
| `@zxing/library` | 0.23.0 |
| `@types/node` | 24.13.4 |

The other direct dependencies remain `@modelcontextprotocol/sdk` 1.30.0,
`express` 5.2.1, and `@types/express` 5.0.6. Node typings intentionally follow
the Node 24 runtime rather than the Node 26 version suggested by `ncu`.

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

The main Playwright run passed 259 tests using
`npm test -- --grep-invert '\[J-255\]'`, covering the existing application and
MCP ownership, schemas, and transaction rollback, plus the new upload, email, and
barcode cases. The final Codex J-255 passed separately with
`npx playwright test tests/e2e/codex-runner.spec.ts --project=mobile --no-deps`.
Together these runs passed all 260 tests, including 11 new journeys. The focused
run rebuilt and started the production app after the final runner changes.

All three final typechecks passed: `npm run typecheck`,
`npm run typecheck:server`, and `npm run typecheck:tests`. Matching Playwright
Chromium was installed. Journey duplicate-ID and bidirectional-link checks and
`git diff --check` passed.

## Scope of integration coverage

Upload tests exercise the production Express app with a deterministic extractor,
temporary database, and dummy environment. They cover one image at the exact
8 MiB limit, byte preservation, malformed multipart requests, authentication,
and extraction failures. Uploads now reject extra files and text fields and set
an explicit zero nesting limit while retaining existing error responses.

Barcode tests pass real EAN-13 and UPC-A video frames through the installed ZXing
decoder. They cover exact results, duplicate suppression, camera teardown,
reopening, and denied/missing cameras. Email tests exercise the actual sender and
Postmark client using a local fetch stub, including API and network failures.

The Codex regression exercises the actual installed CLI against a local Responses
endpoint. It inspects tool definitions in both the top-level request and developer
input items. This exposed tools that the existing runner flags had allowed in
both the old and upgraded CLI. The runner now reads the installed CLI's bundled
model metadata offline and disables model-forced Code Mode and apply_patch for
the existing Terra and Luna models, alongside explicit tool feature gates.
It preserves the shipped prompts and model capabilities without vendoring a
prompt snapshot. Unknown models or unsupported metadata fail before inference.
The per-turn catalog and schema share the existing temporary-file cleanup;
service-account authentication and the read-only sandbox remain in place.
Metadata discovery has a five-second timeout and a 2 MiB output limit, with
process-group termination on either failure. Tests include descendants holding
inherited output pipes open to verify this cleanup.

Rerun J-255 for future Codex CLI or model changes. Checking only the top-level
`tools` array is insufficient to establish that an inference request is tool-free.

Physical Android/iOS camera behavior and live AI model availability/extraction
remain deployment smoke checks. No real email delivery or live model inference
is part of the automated tests.
