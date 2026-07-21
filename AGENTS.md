# Repository Guidelines

These instructions apply to the entire repository.

## Project Structure & Module Organization

- `src/` is the Preact SPA. `App.tsx` owns cross-screen auth, date, and modal
  transitions; components, screens, modals, and hooks own local interaction state.
- `server/` is the Express 5 and SQLite backend. Routes live in `server/routes/`,
  SQL migrations in `server/migrations/`, and normal application statements in
  `server/statements.ts`.
- `shared/` contains code compiled by both TypeScript projects, especially wire
  types, product-name normalization, and API-prefix detection.
- `public/` contains PWA and site assets copied into the Vite build. `tests/e2e/`
  contains the Playwright suite; `tests/JOURNEYS.md` indexes covered user flows.
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
- Normalize stored product names and brands with the helpers in
  `shared/normalize.ts` on both create and update paths.
- `useEntries` applies local cache changes only after successful requests. Preserve
  `(local_time, id)` ordering and recompute week totals only for loaded dates;
  tagged-only updates do not change totals.
- Use `MACRO_KEYS`/`MACRO_META` for P/C/F presentation, CSS modules for component
  styles, and `cssVars` for dynamic custom properties. Kcal stays separate.
- Prefer Heroicons 16/solid for reusable icons and add SVGs as named exports in
  `src/components/Icon.tsx`, preserving its shared `BASE` props. `BarcodeIcon`
  and `CircleIcon` are the current custom icons.

## Backend Safety Invariants

- `server/index.ts` must import `server/env.ts` first. Add new environment keys to
  centralized validation/export and to `.env.example`.
- Migrations are forward-only and keyed by filename. Add a new lexically ordered
  `server/migrations/*.sql` file; never revise an applied migration.
- Put normal application SQL in `server/statements.ts`. Bootstrap/migration SQL
  stays in `server/db.ts`; deliberately unscoped debug reads stay isolated in
  `server/routes/debug.ts`. Document bind order beside statements and mirror it
  at call sites; within scoped `WHERE` bindings, owner precedes resource ID.
- Scope entries by authenticated `user_id`, owned products by `created_by`, and
  settings by authenticated user `id` at the SQL layer. Verify product ownership
  before inserting an entry; never trust a client-supplied user identity.
- The sharing boundary is `barcode = shared, no barcode = private`. Global search
  may expose only barcoded products, arbitrary-ID adoption must reject null
  barcodes, and adoption creates a caller-owned copy. The current existing-copy
  check is sequential; do not claim database-enforced concurrency safety.
- Entries store grams and product references, not macro snapshots. Compute macros
  from current per-100 product values so product edits intentionally update past
  totals.
- Authentication uses emailed six-digit codes and Bearer sessions. Login codes and
  AI scan quotas are process-local maps, so multi-process deployment requires
  shared state or affinity. Preserve timing-safe code comparison and attempt caps.
- `TEST_MODE` disables email delivery and exposes login-code lookup; `LOG_LEVEL=debug`
  logs live codes. Never enable either behavior in production.
- Preserve the `{ error: string }` failure shape. Keep request-body guards beside
  their routes and build them from `server/guards.ts` primitives.
- `/debug` is an unauthenticated raw-data endpoint and the only administrative
  cross-user read. Keep its fail-closed `DEBUG_ALLOW_IPS` middleware ahead of the
  router. Configure `TRUST_PROXY` with trusted proxy addresses/subnets; the current
  string parser does not make `"1"` a one-hop setting.
- Use `server/log.ts` for runtime logs and `log.emailHash(email)` for explicit email
  correlation fields. Direct console calls are limited to `server/env.ts` bootstrap
  diagnostics and logger internals.
- Keep AI label extraction one-turn and tool-free. Treat model output as untrusted:
  JSON-parse it, validate/coerce it, retain macro caps, and map
  `InvalidExtractionError` to the controlled route error.

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
- The suite uses one worker. Global setup resets the database once per run, but
  tests within that run share database and default-user state. Use unique product
  names/barcodes for persisted fixtures.
- The mobile project uses the Pixel 7 profile, depends on both auth setup projects,
  and defaults to `tests/e2e/.auth/user.json`. Use `user2.json` for user B.
- Tests needing a pristine user, logout isolation, or absolute totals must use
  blank `storageState` and `signInFresh` from `tests/e2e/helpers.ts`.
- Reuse `signInFresh`, `fillNutField`, `longPress`, and `seedProductAndLog`. Use
  `.tap()` for touch-oriented Sheet interactions; use `.click()` only when a test
  deliberately exercises mouse behavior.
- Scope transient locators to the active `.sheet` or `.food-row`, use `exact: true`
  for collision-prone aria labels, and wait for modal visibility/unmount rather
  than racing animations.
- Prefix every `test()` and `setup()` name with a stable `[J-###]`. Update
  `tests/JOURNEYS.md` whenever journeys change and run the duplicate-ID and
  bidirectional-link checks in its `Verification` section. Never record fixed
  suite counts or PR-numbered coverage snapshots here.

## Commit & Pull Request Guidelines

- Match repository history: use a capitalized imperative subject of at most 72
  characters, without a Conventional Commit prefix or trailing period.
