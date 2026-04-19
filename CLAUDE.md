# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — Vite frontend on `:5173`. Proxies the prefixes in `shared/apiPrefixes.ts` to `:3000` (dev-only).
- `npm run server:dev` — `tsx watch` backend on `:3000`, loads `.env` automatically.
- `npm run server:start` — same as above without watch. In prod, this one process serves both the SPA (`dist/`) and the API.
- `npm run build` — runs `typecheck` then `vite build` (outputs to `dist/`).
- `npm start` — `build` then `server:start`. The single prod entry point.
- `npm run seed -- <email>` — inserts the 12 starter products from `shared/seedProducts.ts` for an existing user. Idempotent (skips by name).
- `npm run typecheck` — typechecks the frontend project (`src/`, `shared/`, `vite.config.ts`).
- `npm run typecheck:server` — typechecks the backend project (`server/`, `shared/`).
- `npm test` — currently a no-op (prints "no tests").

There is no lint step and no test runner wired up.

## Dev vs prod topology

- **Dev**: two processes. Vite (`:5173`) serves the SPA with HMR and proxies API prefixes to Express (`:3000`). Set `MAGIC_LINK_BASE_URL=http://localhost:5173` so magic links land on Vite.
- **Prod**: one process. Express (`:3000`) serves the built SPA from `dist/` AND the API on the same origin — no CORS, no reverse proxy required. Set `MAGIC_LINK_BASE_URL` to the Express origin (e.g. `http://localhost:3000` locally, or your real domain behind TLS). Run `npm start`.

## Architecture

Two TypeScript projects share the `shared/` folder but use different module-resolution strategies: root `tsconfig.json` (bundler, Preact JSX) for the frontend, `server/tsconfig.json` (nodenext ESM) for the backend. Because the backend is nodenext ESM, server-internal imports must use `.js` extensions (e.g. `import { env } from './env.js'`).

### Backend (`server/`)

- **Boot order matters.** `server/index.ts` imports `env.ts` FIRST; that module validates every required env var and exits the process on any missing key — so nothing else can accidentally read `process.env` before validation. Then `db.ts` opens SQLite (WAL, FKs on), applies forward-only migrations from `server/migrations/*.sql`, and prunes expired sessions on startup.
- **Every prepared statement lives in `server/statements.ts`**, grouped by domain. Convention: user-scoped reads/writes take `user_id` as the FIRST parameter, then the resource id. When adding new queries, follow this pattern and keep migration-bookkeeping statements in `db.ts` itself.
- **Single-tenant isolation is enforced at the SQL layer.** Every `/entries`, `/products`, and `/settings` query filters by `created_by`/`user_id`. Don't add queries that omit this scope.
- **Macros are computed, never stored.** `entries` stores only `grams` + `product_id`; kcal/protein/carbs/fat come from `products.*_per100 * grams / 100` via JOINs (see `statements.entries.selectForDay`, `weekSum`). This means editing a product retroactively updates every past day's totals — intentional.
- **Auth model:** magic-link tokens live only in memory (`Map` in `server/auth.ts`, purged by a self-`unref`'d timer); session tokens are stored raw in the `sessions` table. Bearer auth via `authMiddleware`, which slides `expires_at` on every valid request. The `/auth/magic-link` endpoint deliberately never leaks whether an account exists.
- **AI label extraction (`server/claude.ts`)** uses the Claude Agent SDK with `tools: []`, `allowedTools: []`, `settingSources: []`, and `maxTurns: 1` to force pure vision-to-JSON inference. Output is stripped of code fences, JSON-parsed, then hard-validated by `validateAndCoerce` (throws `InvalidExtractionError` on bad data; per-macro caps of kcal≤2000 and protein/carbs/fat≤200). A per-user daily cap (`AI_SCAN_DAILY_CAP`) is tracked in memory in `server/routes/products.ts`.
- **Error shape:** all error responses are `{ error: string }`. The top-level `ErrorRequestHandler` in `server/index.ts` logs and responds with the `err.status` if numeric, else 500.
- **SPA + API on one origin.** After the API routers, `server/index.ts` serves `dist/` via `express.static(..., { index: false })` and a path-less fallback middleware returns `dist/index.html` for unmatched GET/HEAD. Critically, the fallback first checks the request path against `API_PREFIXES` (from `shared/apiPrefixes.ts`) and returns `404 JSON` for unknown API paths — otherwise `/auth/typo` would silently leak HTML to a `fetch()` caller. Express 5 forbids bare `'*'` route paths (path-to-regexp v8), which is why the fallback is a middleware, not `app.get('*', ...)`.

### Frontend (`src/`)

- **`App.tsx` is the single orchestrator.** It owns the auth state (user + session token in `localStorage`), the `ModalState` tagged union (`add-picker` → `barcode-scanner` | `new-product` | `ai-label-scanner` | `grams-picker` | `edit-product`), the selected/week dates, and the transient error toast. Screens/modals are dumb: they receive props and emit callbacks.
- **`api.ts` is the only network entry point.** It injects the Bearer token from `localStorage`, auto-logs-out on 401 (clears storage + hard-navigates to `/`), and throws `ApiError` on non-2xx. Never fetch directly from components or hooks.
- **Entries cache (`src/hooks/useEntries.ts`)** is keyed by `local_date`. `add`/`update`/`remove` optimistically re-derive `weekTotals` via `sumMacros` so the week strip updates without a refetch. When adding new mutation paths, follow this same derive-locally pattern.
- **Routing is minimal.** Only `/verify` is special-cased (in `App.tsx`, matches `window.location.pathname`). Everything else is client-state-driven. Don't introduce a router library.
- **Dates are local-only.** `local_date` and `local_time` strings (`YYYY-MM-DD` / `HH:MM`) are the contract on the wire; helpers in `src/dates.ts` convert to/from `Date`. The week strip uses Monday-first weeks (`getMonday`).

### PWA / installability (`public/`)

The app is an installable PWA with no offline caching — the service worker exists only to satisfy Android's installability criteria. Static assets in `public/` are copied to `dist/` at build time and served at the site root by Vite (dev) and `express.static(dist/)` (prod).

- `public/manifest.webmanifest` — single source of truth for `name`/`short_name` (`"kcal."`), colors (`#1d2021` for both `theme_color` and `background_color`), `display: standalone`, `orientation: portrait`, and the icon set. If you change app branding, change it here AND the Apple-specific meta tags in `index.html` (iOS ignores the manifest for install behavior).
- `public/sw.js` — pass-through SW with `install`/`activate`/noop-`fetch` handlers. Registered from `src/main.tsx` only when `import.meta.env.PROD` so dev HMR isn't touched. Do NOT add caching here without a version-bump + cleanup strategy — stale asset caches are the #1 PWA footgun.
- Icons are generated from the 938×938 `kcal-logo.png` at the repo root via ImageMagick. The logo's dark area is exactly `#1d2021` (matches `--bg`), so the `-flatten` step below produces seamless full-bleed dark squares. Regenerate with:
  ```
  convert kcal-logo.png -resize 192x192 public/icon-192.png
  convert kcal-logo.png -resize 512x512 public/icon-512.png
  convert kcal-logo.png -resize 512x512 -background "#1d2021" -flatten public/icon-512-maskable.png
  convert kcal-logo.png -resize 180x180 -background "#1d2021" -flatten public/apple-touch-icon.png
  convert kcal-logo.png -resize 32x32 public/favicon.png
  ```
- The iOS tag set in `index.html` (`apple-touch-icon`, `apple-mobile-web-app-capable`, `apple-mobile-web-app-title`, `apple-mobile-web-app-status-bar-style`) is required — iOS Safari ignores the manifest entirely for "Add to Home Screen", Android/Chrome read only the manifest.

### Shared (`shared/`)

- `shared/seedProducts.ts` is the ONE source of starter-product data. Used by the server seed script to insert real rows, and structurally mirrors the frontend `Product.per100` shape so no remapping is needed. If you change product shape, update both projects.
- `shared/apiPrefixes.ts` is the ONE source of API path prefixes. Consumed by `vite.config.ts` (to build the dev proxy map) and `server/index.ts` (to decide which unmatched requests are 404 JSON vs SPA HTML). When adding a new top-level router, add its prefix here too — otherwise Vite won't proxy it in dev and the SPA fallback will swallow it in prod.

### Data flow example (adding an entry)

1. User picks a product in `AddPicker`, then grams in `GramsPicker`.
2. `App.tsx` → `useEntries.add()` → `POST /entries` via `api`.
3. `entriesRouter` validates (`isNewEntryBody`), checks product ownership (`statements.products.ownedByUser`), inserts, re-reads the joined row, and returns `EntryWithMacros`.
4. Hook updates `entriesByDate[date]` (preserving `local_time ASC` order) and recomputes `weekTotals[date]`.

## Conventions

- TypeScript is strict with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and `verbatimModuleSyntax`. Use `type` imports explicitly and never index into arrays/records without a null check or `!`.
- Icons come from [Heroicons 16/solid](https://github.com/tailwindlabs/heroicons/tree/master/src/16/solid) whenever possible. Add new icons as named exports in `src/components/Icon.tsx`, copying the path data verbatim from upstream and keeping the shared `BASE` props (`viewBox: '0 0 16 16'`, `fill: 'currentColor'`). Never use text glyphs like `→`/`✓`/`★` in buttons — import the matching Heroicon instead. The only custom icon is `BarcodeIcon` (Heroicons has no equivalent), drawn in the same solid style.
- Server logging goes through `server/log.ts` (never `console.log` directly). `log.emailHash(email)` produces a short sha256 prefix — use it whenever an email would otherwise appear in a log line.
- Guards for request bodies live alongside their route (e.g. `isNewEntryBody` in `entries.ts`), built from the primitives in `server/guards.ts` (`isObject`, `isPositiveInt`, `isPositiveFinite`, `EMAIL_RE`/`DATE_RE`/`TIME_RE`).
- The `FRONTEND_DEMO/` folder is a legacy static mock — not wired into the build. Don't edit it.
