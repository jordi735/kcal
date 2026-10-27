# Repository Guidelines

These instructions apply to the entire repository.

## Project Structure & Module Organization

- `src/` is the Preact SPA. `App.tsx` owns cross-screen auth, date, and modal
  transitions; `components/AppModals.tsx` renders its modal slots and `modalState.ts` defines
  modal context and draft-return helpers. `useSessionState` owns session state;
  settings and notification lifecycles
  live in hooks; components, screens, and modals own local interaction state.
  `useFoodData` owns entry, group, and product requests, their shared mutation
  queue, and cache reconciliation; App keeps navigation and modal flow guards.
- `server/` is the Express 5 and SQLite backend. Routes live in `server/routes/`,
  SQL migrations in `server/migrations/`, and normal application statements in
  `server/statements.ts`. `server/reads.ts` shares read functions and serializers
  between REST routes and MCP tools; `server/products.ts` owns product discovery,
  serialization, and sequential adoption with exact source-value preservation,
  and `server/goals.ts` owns settings/history and current-goal resolution.
  `server/errors.ts` defines dependency-neutral domain errors; goals must not
  import the reads or writes modules. `server/writes.ts` shares
  transactional entry, entry-group, and product mutations; `server/idempotency.ts`
  wraps MCP creates in durable receipt transactions. `server/mcp/` owns MCP schemas, registration,
  and result handling; its HTTP route owns auth and transport lifetime. Setup is
  in `docs/mcp.md`.
- `shared/` contains code compiled by both TypeScript projects, especially wire
  types, unrounded macro arithmetic, stored-text normalization, and API-prefix
  detection. Shared email validation bounds raw and normalized UTF-8 bytes before
  regex work. Frontend display metadata and entry adapters live in `src/macros.ts`.
- `public/` contains PWA and site assets copied into the Vite build. `tests/e2e/`
  contains the Playwright suite; `tests/JOURNEYS.md` indexes covered user flows.
  `docs/refactoring.md` records the structural passes and behavior-parity checks.
- The root TypeScript project uses bundler resolution and Preact JSX for `src/`,
  `shared/`, and `vite.config.ts`. `server/tsconfig.json` separately checks
  `server/` and `shared/` with NodeNext resolution.
  `tsconfig.tests.json` checks Playwright tests and configuration with the root
  project's strict compiler settings.

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
- `npm run typecheck:tests` checks Playwright tests and configuration, including
  application modules imported by tests.
- `npm run check:journeys` compares the journey catalogue with executable test
  titles discovered by Playwright; it does not run tests or start the server.
- `npm run check` runs all three TypeScript checks and journey validation.
- `npm run build` runs the frontend/shared typecheck and creates `dist/`; it does
  not typecheck `server/`, so run `npm run typecheck:server` separately.
- `npm test` runs the full Playwright suite. `test:ui`, `test:headed`, and
  `test:debug` provide UI mode, a visible browser, and debugger mode.
- `npx playwright test tests/e2e/<name>.spec.ts` runs one focused E2E spec.
- `npm run icons` regenerates tracked PWA/social PNGs from `kcal-logo-blue.png`
  and requires ImageMagick's `convert`.
- `./scripts/review-e2e.sh` runs the resumable Codex E2E-maintenance loop. It
  requires the repository-local Codex CLI development dependency to be
  authenticated; `--reset` clears only its `/tmp/kcal-e2e-review` state.

There is no configured lint, formatter, or unit-test command. Do not invent one
in validation reports. The backend loads root `.env`; use `.env.example` as the
required-key inventory and never commit real credentials.
The committed lockfile owns the release dependency tree. Use `npm ci`, including
development dependencies for the current build/start workflow. Review pinned
install-script approvals when updating SQLite or esbuild; do not broadly allow
dependency scripts or silently discard the lockfile.

## Coding Style & Naming Conventions

- TypeScript is strict with `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `noUnusedLocals`, and
  `noUnusedParameters`. Use `import type`
  where applicable and handle possibly missing indexed values explicitly.
- Relative imports from `server/`, including imports into `shared/`, must end in
  `.js` because the backend uses NodeNext ESM resolution.
- Define frontend/backend wire shapes in `shared/types.ts`, then re-export them
  through `src/types.ts` and `server/types.ts`; call sites import the local module.
- When adding a top-level API router, mount it before static serving and add its
  prefix to `shared/apiPrefixes.ts`. That list drives the Vite proxy and prevents
  unknown production API paths from falling through to SPA HTML.
- Route all frontend HTTP through `src/api.ts`; it owns Bearer injection, JSON
  requests, 401 logout, and `ApiError`. Do not call raw `fetch` elsewhere.
- Treat `GET /settings` as the authoritative settings snapshot: editable goals,
  sparse `goal_history`, and the MCP reminder. Cached user goals are undated
  editable defaults, never historical targets. Boot/foreground revalidation,
  initialization, saves and reminder dismissal must protect against stale
  responses and update the live snapshot and cached current user goals together.
  Disable goal editing until the first authoritative snapshot arrives; initial
  failures offer Retry. A pristine form follows snapshots, but actual input or
  increment actions make the whole goal vector a draft. Focus alone does not.
  Preserve that complete draft across refreshes and mounted Sheet subviews.
- Keep navigation client-state-driven through `App.tsx`; do not add a router for
  the current addressless flow. Add Sheet-backed modal kinds to `SHEET_KINDS` and
  preserve the distinction between explicit `onClose` and gesture `onDismiss`.
  Invalidate pending modal navigation when Sheet exit begins, before its fade,
  so a delayed save cannot reopen an editor the user is dismissing.
- The shared `ChatGPTGuide` and connection card are available from New Product,
  Add Temp, and Settings. Show the guide as a local Sheet subview; keep forms
  mounted but hidden to preserve drafts, and give only the visible pane the
  `data-sheet-scroll` attribute. Back restores the form; dismissal closes the Sheet.
- Keep `local_date` and `local_time` as timezone-free `YYYY-MM-DD` and `HH:MM`
  strings. Generate them with `src/dates.ts`; weeks are Monday-first.
- Normalize supplied product names/brands and entry-group names with the helpers
  in `shared/normalize.ts`. `shared/productText.ts` owns pure stored-product field
  parsing, raw and normalized length limits, and barcode trimming; REST and MCP
  keep their input-shape parsing local. Product normalization must be
  Unicode-idempotent. Partial product edits preserve
  omitted metadata exactly; adoption deliberately preserves source values.
- Use `shared/constraints.ts` for the UI/REST/MCP entry minimum and group-name
  validation, weight numeric rules, and product/weight limits. Keep interface
  parsing local: REST and MCP product validators have different coercion
  rules, and the weight UI counts raw note length while REST counts trimmed text.
  New or changed entry amounts must be within the shared 1–MAX_ENTRY_AMOUNT g/ml
  bounds; decimals are allowed.
  Check shared integer/range predicates before goal saves and amount submissions,
  including keyboard submissions. Invalid input stays editable with feedback;
  increment buttons clamp to the applicable bounds.
  Do not rewrite legacy smaller entries or reject their tag-only edits or deletion.
- `useFoodData` applies local cache changes only after successful requests. Preserve
  entry insertion order by `id` and recompute week totals only for loaded dates;
  amount/product corrections update totals, while time/tagged-only updates do not.
  Entry corrections retain date, identity, creation timestamp and group membership.
  The amount editor preserves its complete draft through Change food and library
  editing; a replacement with a different unit clears the amount for explicit input.
  Its single cache state uses pure
  `entryCache.ts` transformations; mutation callbacks retain their captured
  loaded-date eligibility when a day loads while a request is pending.
- Product edits/deletions retire pending food reads, project committed changes
  into retained day snapshots, and refresh the latest selected/today dates plus
  the visible week and its neighbors inside the same queue. Do not refresh every
  visited week. Protect day snapshots read during a pending product edit and
  derive totals only when the captured complete-day eligibility and read version
  allow it. Deletion removes the product from every cached day but counts group
  members only in complete snapshots. Off-screen summaries and protected days
  remain cached fallback until normal navigation revalidation; retain loaded
  flags and the existing cached-first presentation.
- Weight history uses one local read path for initial load, refresh, Retry and
  reconciliation. Count successfully applied reads and fence pending reads after
  a committed write. If a read applied during that write, retain it and reconcile
  instead of applying the older response. A failed reconciliation is a refresh
  failure, never a failed write or invitation to duplicate it.
- Product picker requests distinguish loading, success and failure. Show empty
  states only after successful empty responses, keep independently usable library
  sections, and retain cached search results only for the same query and scope.
- Scanner cancellation invalidates navigation when closing starts, before its
  fade. Suppress late decoder/lookup callbacks and stop controls that initialize
  after cancellation. Clear close timers on unmount. Carousel completion accepts
  only the track's own transform transition and removes superseded listeners.
- Keep the day-entry wire response flat. `EntryWithMacros.group` annotates real
  child entries; derive collapsed parents, aggregate macros, and mixed/all-tagged
  state in the client without adding a synthetic calorie-bearing entry.
- Use `MACRO_KEYS`/`MACRO_META` for P/C/F presentation, CSS modules for component
  styles, and `cssVars` for dynamic custom properties. Kcal stays separate.
- `Home.module.css` owns day-list dividers: nonfinal top-level rows/groups,
  expanded group headers, and nonfinal group children. Keep the `.food-row`
  and `.entry-group` interaction anchors; do not duplicate their dividers in
  global styles or the row components.
- Shared `.tiny` and `.caps` utilities intentionally supply effective typography
  where used. Preserve `.tiny` at 10px/0.12em and `.caps` at 0.08em when used
  without `.tiny`. Keep the global stylesheet ordering described in
  `docs/themes.md`; changing it can also activate overridden field/button rules.
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
  barcodes and temporary sources, and adoption creates a caller-owned saved copy.
  Owned barcode lookup and adoption's existing-copy check exclude temporary rows.
  Shared barcode templates omit source IDs, ownership and temporary metadata;
  lookups never adopt or create automatically. The current existing-copy
  check is sequential; do not claim database-enforced concurrency safety.
- Product name/brand search requires every distinct whitespace-separated query
  term to occur literally in either field, in any order. Reuse NFC Unicode
  lowercase normalization for REST and MCP; filter before pagination. There is
  no fuzzy matching, relevance score, alias or serving metadata. `%`, `_`, and backslashes are
  literal; accents remain meaningful. Keep deterministic ID tie-breakers for
  name, recency and barcode order. Recents use surviving entries' creation times,
  not their local dates. Keep global barcode and private-ID partition keys in
  separate dimensions so real barcode strings cannot collide with private rows.
- `goal_history` has at most one row per user/effective date. Resolve goals using
  the latest record on or before each requested day; before the first row return
  null. Never backfill old user defaults into the past. Only authenticated app
  initialization/save POST/PUT actions create history, deriving today's local
  date server-side from the browser's validated timezone. GETs/MCP are read-only.
  Same-day changes upsert, unchanged saves create no extra row, and saves before
  the newest effective date are rejected. No backdating/scheduling editor exists.
  Current goals come from latest history with legacy user values as undated
  fallback. The app and MCP share the date resolver; unknown and zero targets
  must not be confused.
- Entries store `amount` in the product's g/ml unit and product references, not macro snapshots. Compute macros
  from current per-100 product values so product edits intentionally update past
  totals. Scale with `(amount * per100) / 100`, matching SQL, and round only for
  display. Existing creation receipt snapshots keep their original arithmetic.
  REST/MCP reject the old `grams` input. Recent portions use
  `/entries/recent-amounts` and `{ amounts: number[] }`. New product replacements
  must be owned saved foods; switching units requires an explicit amount, with
  no conversion. Validate only supplied entry replacements so legacy values
  remain readable, taggable, deletable and otherwise correctable.
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
- Authentication uses emailed six-digit codes and Bearer sessions. Login codes are
  process-local maps, so multi-process deployment requires shared state or
  affinity. Preserve timing-safe code comparison, attempt caps, and issue/verify
  throttles; reissuing a code must not reset the account's verification budget.
- `TEST_MODE` disables email delivery, exposes login-code lookup, and relaxes auth
  throttles for suite fixtures sharing a loopback IP. Injected-clock limiter tests
  exercise production budgets independently;
  `LOG_LEVEL=debug` logs live codes. Never enable either behavior in production.
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
  granted both `kcal:read` and `kcal:write` additionally expose `create_entries`,
  `update_entry`, `delete_entry`, `create_product`, `update_product`,
  `delete_product`, `create_entry_group`, `update_entry_group`,
  `ungroup_entries`, and `delete_entry_group`. Check write scope before mutation
  and reuse `server/writes.ts` from REST and MCP. MCP entry
  creation requires owned saved foods; do not reuse temporary foods. `create_entries`
  accepts 1–50 items at one explicit local date/time, preserves duplicate products
  and input order, and optionally groups all items when there are at least two.
  Its totals describe only the new entries. No legacy `create_entry` tool remains.
  Keep the
  UI's new-temporary-food workflow and existing temporary-entry operations working.
  MCP entry edits require `entry_id` and at least one of `amount`, `product_id`,
  or `local_time`, and reject `tagged` and date/group changes. Use one
  MCP-entry projection without `tagged` for every read and write result, including
  text content and output schemas. Food checkmarks remain an app/REST feature;
  MCP mutations preserve existing checkmarks internally. All recorded food counts
  toward totals; a food record proves neither complete logging nor actual
  consumption. Product updates preserve omitted metadata/macros. Product deletion
  cascades through the owner's logs and dissolves undersized groups. Controlled
  failures must leave no partial changes; validate MCP output before committing
  the mutation transaction, and emit mutation success logs only after commit.
  Every MCP create requires an account-wide `idempotency_key`. The durable receipt
  and all business changes commit in one immediate transaction. Same key/tool/
  normalized input replays the original validated snapshot and timestamp with
  `replayed: true`; a different tool/input conflicts. Preserve batch entry order;
  canonicalize existing group membership as sorted IDs.
  Replays never recreate deleted data, bypass current write authorization, or
  rewrite history. Failed creates consume no key; unreadable receipts fail closed.
  Retain receipts for the account lifetime and do not log replays as new mutations.
  New receipts use schema version 5. Frozen v4 schemas/fingerprints recognize old
  snapshots and project entry `grams` to `amount` without changing saved bytes,
  timestamps or macro values. Keep historical fixtures unchanged when renaming code.
  MCP may offer a more convenient interface, but cannot enable an action or
  stored value forbidden by the UI. Keep explicit creation timestamps, partial
  updates, summaries/pagination, and single-call deletion; UI gestures and
  confirmation steps are not protocol requirements. Apply this rule to future tools.
  `get_meals` returns flat food entries and totals per date for an inclusive range
  of at most 31 days, including empty dates; named groups remain entry metadata.
  `get_summary` accepts at most 366 days, averages only days containing entries
  (including zero-calorie entries), and compares first/last in-range weights.
  Empty-period averages and changes with fewer than two weights are null;
  summary reads exclude impossible stored dates. Day/range/week reads attach
  nullable goals per date; summaries return goal periods and paired comparisons
  only for dates with both logs and known goals. Never attach current goals to
  historical reads. Read summary daily aggregates, weights and history once each,
  then derive coverage, periods and comparisons from those same inputs. Keep
  zero-calorie logged days distinct from missing rows.
  `search_products` browses without a query, supports name/recent
  sorting and 1–100-item pages (default 50), or accepts barcode alone. Always return
  `{ user_id, products, template, next_offset }`; library mode is caller-owned and
  saved-only, while barcode mode may return one safe shared template. Every tool
  declares an output schema matching its structured result. MCP server version is
  5.0.0. Migration 009 seeds refresh reminder version 5 for eligible existing
  connections, including accounts that dismissed v4. Show the reminder only at
  the top of the main app. A v4 dismissal cannot clear v5. The reminder is informational and persistently
  dismissible; it never revokes credentials, alters scopes, or gates access.
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
  `tests/e2e/test-config.ts` owns the shared origin, port, database, and auth-state
  paths; isolated subprocess fixtures retain their own environment settings.
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
  `tests/JOURNEYS.md` whenever journeys change and run `npm run check:journeys`.
  Catalogue IDs must be unique; related executable tests may share an ID.
  Comments and fixture text cannot satisfy coverage. Never record fixed
  suite counts or PR-numbered coverage snapshots here.
- For a reproduced bug, first run its regression against the unchanged behavior
  and record the intended failure, then run it after the fix. Control deferred
  responses, animation clocks and real camera fixtures rather than adding sleeps.
  For structural cleanup, use passing before/after characterization, including
  baseline receipt fixtures when changing normalization or fingerprint inputs.
  Run Playwright invocations sequentially because they share the test database.
  Isolated server programs belong in typed `tests/e2e/fixtures/` modules; use
  `server-fixture.ts` for subprocess/environment setup, with explicit temporary
  database paths and bounded timeouts. Keep scenario assertions in the programs.

## Commit & Pull Request Guidelines

- Match repository history: use a capitalized imperative subject of at most 72
  characters, without a Conventional Commit prefix or trailing period.
