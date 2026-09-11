# Repository Guidelines

These instructions apply to the entire repository.

## Project Structure & Module Organization

- `src/` is the Preact SPA. `App.tsx` owns cross-screen auth, date, and modal
  transitions; `components/AppModals.tsx` renders its modal slots and `modalState.ts` defines
  modal context and draft-return helpers. Session/goal and notification lifecycles
  live in hooks; components, screens, and modals own local interaction state.
- `server/` is the Express 5 and SQLite backend. Routes live in `server/routes/`,
  SQL migrations in `server/migrations/`, and normal application statements in
  `server/statements.ts`. `server/reads.ts` shares read functions and serializers
  between REST routes and MCP tools; `server/writes.ts` shares transactional entry,
  entry-group, and product mutations. `server/mcp/` owns MCP schemas, registration,
  and result handling; its HTTP route owns auth and transport lifetime. Setup is
  in `docs/mcp.md`.
- `shared/` contains code compiled by both TypeScript projects, especially wire
  types, unrounded macro arithmetic, stored-text normalization, and API-prefix
  detection. Frontend display metadata and entry adapters live in `src/macros.ts`.
- `public/` contains PWA and site assets copied into the Vite build. `tests/e2e/`
  contains the Playwright suite; `tests/JOURNEYS.md` indexes covered user flows.
  `docs/refactoring.md` records the structural passes and behavior-parity checks.
- The root TypeScript project uses bundler resolution and Preact JSX for `src/`,
  `shared/`, and `vite.config.ts`. `server/tsconfig.json` separately checks
  `server/` and `shared/` with NodeNext resolution.

Development uses two processes: Vite on `:5173` and Express on `:3000`; Vite
proxies the prefixes in `shared/apiPrefixes.ts`. Production uses one Express
process on configured `PORT` to serve both `dist/` and the API on one origin.

## Build, Test, and Development Commands

Run commands from the repository root.

- `npm run dev` starts only Vite on strict port `5173`.
- `npm run server:dev` starts the `.env`-loaded backend on `PORT` with watch mode.
  Keep local `PORT=3000` unless `vite.config.ts` is changed with it.
- `npm run server:start` starts the backend without watch and without building.
- `npm start` runs the production entry point: build, then start Express.
- `npm run typecheck` checks the frontend/shared project.
- `npm run typecheck:server` checks the backend/shared project. Run both checks
  after changing `shared/`.
- `npm run build` runs the frontend/shared typecheck and creates `dist/`; it does
  not typecheck `server/`, so run `npm run typecheck:server` separately.
- `npm test` runs the full Playwright suite. `test:ui`, `test:headed`, and
  `test:debug` provide UI mode, a visible browser, and debugger mode.
- `npx playwright test tests/e2e/<name>.spec.ts` runs one focused E2E spec.
- `npm run icons` regenerates tracked PWA/social PNGs from `kcal-logo-blue.png`
  and requires ImageMagick's `convert`.
- `./scripts/review-e2e.sh` runs the resumable Codex E2E-maintenance loop. It
  requires the repository-local Codex CLI to be authenticated; `--reset` clears
  only its `/tmp/kcal-e2e-review` state.

There is no configured lint, formatter, or unit-test command. Do not invent one
in validation reports. The backend loads root `.env`; use `.env.example` as the
required-key inventory and never commit real credentials.

## Coding Style & Naming Conventions

- TypeScript is strict with `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, and `verbatimModuleSyntax`. Use `import type`
  where applicable and handle possibly missing indexed values explicitly.
- Relative imports from `server/`, including imports into `shared/`, must end in
  `.js` because the backend uses NodeNext ESM resolution.
- Define frontend/backend wire shapes in `shared/types.ts`, then re-export them
  through `src/types.ts` and `server/types.ts`; call sites import the local module.
- When adding a top-level API router, mount it before static serving and add its
  prefix to `shared/apiPrefixes.ts`. That list drives the Vite proxy and prevents
  unknown production API paths from falling through to SPA HTML.
- Route all frontend HTTP through `src/api.ts`; it owns Bearer injection, JSON and
  `FormData`, 401 logout, and `ApiError`. Do not call raw `fetch` elsewhere.
- Treat `GET /settings` as authoritative for goals. The stored user is a hot-start
  cache; boot revalidation and saves must update both live goal state and the
  cached user blob.
- Keep navigation client-state-driven through `App.tsx`; do not add a router for
  the current addressless flow. Add Sheet-backed modal kinds to `SHEET_KINDS` and
  preserve the distinction between explicit `onClose` and gesture `onDismiss`.
- Keep `local_date` and `local_time` as timezone-free `YYYY-MM-DD` and `HH:MM`
  strings. Generate them with `src/dates.ts`; weeks are Monday-first.
- Normalize stored product names, brands, and entry-group names with the helpers
  in `shared/normalize.ts` on every create and update path.
- Use `shared/constraints.ts` for the UI/REST/MCP entry minimum and group-name
  validation. New or changed amounts must be at least 1 g/ml; decimals are allowed.
  Do not rewrite legacy smaller entries or reject their tag-only edits or deletion.
- `useEntries` applies local cache changes only after successful requests. Preserve
  entry insertion order by `id` and recompute week totals only for loaded dates;
  tagged-only updates do not change totals. Its single cache state uses pure
  `entryCache.ts` transformations; mutation callbacks retain their captured
  loaded-date eligibility when a day loads while a request is pending.
- Keep the day-entry wire response flat. `EntryWithMacros.group` annotates real
  child entries; derive collapsed parents, aggregate macros, and mixed/all-tagged
  state in the client without adding a synthetic calorie-bearing entry.
- Use `MACRO_KEYS`/`MACRO_META` for P/C/F presentation, CSS modules for component
  styles, and `cssVars` for dynamic custom properties. Kcal stays separate.
- Prefer Heroicons 16/solid for reusable icons and add SVGs as named exports in
  `src/components/Icon.tsx`, preserving its shared `BASE` props. `BarcodeIcon`,
  `CircleIcon`, `MinusCircleIcon`, `GroupIcon`, and `WeightIcon` are the current
  custom icons.

## Backend Safety Invariants

- `server/index.ts` must import `server/env.ts` first. Add new environment keys to
  centralized validation/export and to `.env.example`.
- Migrations are forward-only and keyed by filename. Add a new lexically ordered
  `server/migrations/*.sql` file; never revise an applied migration.
- Put normal application SQL in `server/statements.ts`. Bootstrap/migration SQL
  stays in `server/db.ts`; deliberately unscoped debug reads stay isolated in
  `server/routes/debug.ts`. OAuth statements resolve users from credentials.
  Document bind order beside statements and mirror it at call sites; within scoped
  `WHERE` bindings, owner precedes resource ID.
- Scope entries and weights by authenticated `user_id`, owned products by
  `created_by`, and settings by authenticated user `id` at the SQL layer. Verify
  product ownership before inserting an entry; never trust a client-supplied user
  identity.
- The sharing boundary is `barcode = shared, no barcode = private`. Global search
  may expose only barcoded products, arbitrary-ID adoption must reject null
  barcodes, and adoption creates a caller-owned copy. The current existing-copy
  check is sequential; do not claim database-enforced concurrency safety.
- Entries store grams and product references, not macro snapshots. Compute macros
  from current per-100 product values so product edits intentionally update past
  totals.
- Entry groups are day-scoped metadata referenced by nullable `entries.group_id`.
  Create groups atomically from at least two unique, ungrouped entries owned by
  the caller on one valid calendar date, derived from the children. Normalize
  names to 1–64 characters, preserving case. Do not support nesting, silent
  regrouping, membership replacement, date changes, or group portions/nutrition. Group
  macros and tagged state derive from children, parent tagging is atomic, Ungroup
  preserves entries, and entry/product deletion dissolves groups below two members.
  Whole-group deletion atomically removes its children and metadata while
  preserving products. Return real children in entry-ID order.
- Weights are private, date-only records stored in kilograms, with at most one
  record per user and `local_date`. Accept 0.1–1000.0 kg at one-decimal precision,
  allow past or future dates, and normalize blank notes to null with a 500-character
  limit.
- Authentication uses emailed six-digit codes and Bearer sessions. Login codes and
  AI scan quotas are process-local maps, so multi-process deployment requires
  shared state or affinity. Preserve timing-safe code comparison and attempt caps.
- `TEST_MODE` disables email delivery and the startup Codex probe, and exposes
  login-code lookup; `LOG_LEVEL=debug` logs live codes. Never enable either
  behavior in production.
- Preserve the `{ error: string }` failure shape. Keep request-body guards beside
  their routes and build them from `server/guards.ts` primitives.
- `/debug` is an unauthenticated raw-data endpoint. Keep its fail-closed
  `DEBUG_ALLOW_IPS` middleware ahead of the router. Configure `TRUST_PROXY` with
  trusted proxy addresses/subnets; the current
  string parser does not make `"1"` a one-hop setting.
- `/mcp` exposes `get_day`, `get_meals`, `get_week`, `get_weighins`, `get_summary`,
  and `search_products` with user ownership resolved from separate OAuth tokens.
  Never accept app sessions, admin tokens, or caller-selected user IDs. Reuse app
  calculations. Read-only connections expose only these six tools. Connections
  granted both `kcal:read` and `kcal:write` additionally expose `create_entry`,
  `update_entry`, `delete_entry`, `create_product`, `update_product`, and
  `delete_product`, `create_entry_group`, `update_entry_group`,
  `set_entry_group_tagged`, `ungroup_entries`, and `delete_entry_group`. Check write
  scope before mutation and reuse `server/writes.ts` from REST and MCP. MCP entry
  creation requires an owned saved food; do not reuse temporary foods. Keep the
  UI's new-temporary-food workflow and existing temporary-entry operations working.
  Entry edits allow only grams/tagged; product updates preserve
  omitted metadata/macros. Product deletion cascades through the owner's logs and
  dissolves undersized groups. Controlled failures must leave no partial changes;
  validate MCP output before committing the mutation transaction.
  MCP may offer a more convenient interface, but cannot enable an action or
  stored value forbidden by the UI. Keep explicit creation timestamps, partial
  updates, summaries/pagination, and single-call deletion; UI gestures and
  confirmation steps are not protocol requirements. Apply this rule to future tools.
  `get_meals` returns flat food entries and totals per date for an inclusive range
  of at most 31 days, including empty dates; named groups remain entry metadata.
  `get_summary` accepts at most 366 days, averages only days containing entries
  (including zero-calorie entries), and compares first/last in-range weights.
  Empty-period averages and changes with fewer than two weights are null;
  summary reads exclude impossible stored dates. `search_products` reuses the
  app's saved-product name/brand search, limited to 50 caller-owned non-temporary
  products. Every tool declares an output schema matching its structured result.
  `PUBLIC_ORIGIN` enables OAuth/MCP; unset disables them. SDK OAuth routes own
  discovery/DCR/PKCE; `server/oauth.ts` persists clients, browser-bound consent,
  single-use codes, rotating tokens, scopes, and revocation in SQLite. Only
  read-only or read-and-write scope sets are valid; omitted authorization scopes
  default to read-only. Legacy credentials stay read-only; gaining write access
  requires fresh consent. Persist per-token scopes so refresh narrowing cannot
  regain write access; reject escalation before consuming a refresh token.
  Enforce resource
  binding in the provider (SDK bearer middleware does not check audience).
  Keep OAuth's standard error responses; reject Origin headers at `/mcp` and
  require same-origin authenticated consent. Preserve the pending OAuth request
  through app-session expiry without allowing arbitrary return URLs.
- Use `server/log.ts` for runtime logs and `log.emailHash(email)` for explicit email
  correlation fields. Direct console calls are limited to `server/env.ts` bootstrap
  diagnostics and logger internals.
- Keep AI label extraction one-turn and tool-free. `server/codex-runner.ts`
  must use the repository-local CLI with ephemeral sessions, an isolated temp
  workdir, read-only sandboxing, ignored ambient config/rules, disabled tools,
  and a JSON output schema. Authentication comes from the service account's
  persisted `CODEX_HOME`; do not add an application API key by default. Treat
  model output as untrusted: JSON-parse it, validate/coerce it, retain macro
  caps, and map `InvalidExtractionError` to the controlled route error.

## PWA and Generated Assets

- `public/sw.js` intentionally performs no offline caching and is registered only
  in production. Adding caching requires explicit cache versioning and cleanup.
- Branding is duplicated across `public/manifest.webmanifest`, `index.html`, and
  the icon generator. Synchronize names, colors, metadata, and icon references;
  when the origin changes, also update canonical/social URLs, `robots.txt`, and
  `sitemap.xml`.
- Do not hand-edit generated PNGs in `public/`; change `kcal-logo-blue.png` or the
  generator and run `npm run icons`.
- Do not edit ignored runtime/build state such as `dist/`, `data/`,
  `tests/e2e/.auth/`, `test-results/`, or `playwright-report/` as source.

## Testing Guidelines

- Playwright tests the production topology: it builds the SPA and starts Express
  on `:3001` with `TEST_MODE=true` and `/tmp/kcal-e2e.db`.
- The suite uses one worker and starts a fresh backend. Its startup command resets
  the database before opening SQLite; do not move cleanup into a Playwright global
  setup hook, which runs after the web server starts. Tests within a run share
  database and default-user state. Use unique product
  names/barcodes for persisted fixtures.
- The mobile project uses the Pixel 7 profile, depends on both auth setup projects,
  and defaults to `tests/e2e/.auth/user.json`. Use `user2.json` for user B.
- Tests needing a pristine user, logout isolation, or absolute totals must use
  blank `storageState` and `signInFresh` from `tests/e2e/helpers.ts`.
- Weight tests that reuse a user must avoid `local_date` collisions or deliberately
  assert the one-record-per-date conflict; use `signInFresh` when isolated history
  is required.
- Reuse `signInFresh`, `fillNutField`, `longPress`, and `seedProductAndLog`. Use
  `.tap()` for touch-oriented Sheet interactions; use `.click()` only when a test
  deliberately exercises mouse behavior.
  Reuse `auth-helpers.ts` for login primitives and stored tokens, and
  `mcp-helpers.ts` for scoped MCP fixtures/result helpers. Preserve fresh-user
  versus shared-user lifetimes and explicit read/read-write scope selection.
- Scope transient locators to the active `.sheet` or `.food-row`, use `exact: true`
  for collision-prone aria labels, and wait for modal visibility/unmount rather
  than racing animations.
- Grouping tests should use unique product/group names, scope parents through
  `.entry-group`, and verify that folding and parent tagging never change raw day
  or week macro totals.
- Prefix every `test()` and `setup()` name with a stable `[J-###]`. Update
  `tests/JOURNEYS.md` whenever journeys change and run the duplicate-ID and
  bidirectional-link checks in its `Verification` section. Never record fixed
  suite counts or PR-numbered coverage snapshots here.

## Commit & Pull Request Guidelines

- Match repository history: use a capitalized imperative subject of at most 72
  characters, without a Conventional Commit prefix or trailing period.
