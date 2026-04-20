# kcal — Clean Code Audit Report

Two-phase DRY/KISS/YAGNI audit per `KCAL_AUDIT.md`. 40 files in scope (1 missing from disk → 39 reviewed). All findings passed the pragmatism gate: concrete impact today, obvious and net-positive fix, no what-ifs, no style.

---

## 1. Executive Summary

### Totals

| Severity | DRY | KISS | YAGNI | Total |
|---|---|---|---|---|
| **HIGH** | 1 | 0 | 0 | **1** |
| **MEDIUM** | 2 | 0 | 0 | **2** |
| **LOW** | 4 | 0 | 5 | **9** |
| **All** | **7** | **0** | **5** | **12** |

Plus one scope-list error: `server/asyncHandler.ts` is listed in the audit scope but does not exist on disk.

### Top 5 Highest-Impact Fixes (effort → benefit)

1. **Create `shared/types.ts` for wire-contract types** (HIGH / DRY). Hoist `Macros`, `Product`, `ProductTemplate`, `BarcodeLookupResponse`, `EntryWithMacros`, `ExtractedLabel` — currently declared verbatim in both `server/types.ts` and `src/types.ts` (and a 7th inline instance in `shared/seedProducts.ts`). One mechanical move removes 6 type-declaration duplicates and collapses `Goals → type Goals = Macros`. Biggest structural win; the `shared/` folder already exists for this purpose (`shared/seedProducts.ts`, `shared/apiPrefixes.ts`, `shared/normalize.ts`).
2. **Extract storage-key constants** (MEDIUM / DRY). `'kcal_session_token'` and `'kcal_user'` appear 10× across `src/App.tsx` and `src/api.ts`; the logout cleanup is also duplicated. Export two constants and optionally a `clearStoredSession()` from `api.ts`; ~15 min of work.
3. **Drop `entry_count` from the week wire** (LOW / YAGNI). Emitted by `GET /entries/week` but zero frontend consumers. Four-surface delete: `DaySummary` + `summariseDay` (entries route), `COUNT(*)` in `statements.ts`, `WeekSumRow` in server types, `WeekResponse` in `useEntries.ts`. Shrinks the wire contract.
4. **Drop `goal_*` columns from the sessions JOIN** (LOW / YAGNI). `verifySession` fetches them via `sessions JOIN users`, populates `SessionUserRow` → `AuthedUser`, but `authMiddleware` only reads `user.id`. Simplifies the statement, lets `verifySession` return `number | null`, and lets `AuthedUser` be deleted.
5. **Strip `export` from 10 unused `*Props` types** (LOW / YAGNI). All five components and all five modals export a `*Props` type with zero external consumers. One-line delete per file.

---

## 2. Findings Table

Sorted by severity desc, then category. All locations are absolute paths rooted at the repo.

| Sev | Cat | Location | Concrete impact | Suggested fix |
|---|---|---|---|---|
| **HIGH** | DRY | `server/types.ts:11-16,79-102,136-143` + `src/types.ts:1-47` + `src/modals/AILabelScanner.tsx:11-16` + `shared/seedProducts.ts:11` | Wire-contract types (`Macros`, `Product`, `ProductTemplate`, `BarcodeLookupResponse`, `EntryWithMacros`, `ExtractedLabel`) declared verbatim in both projects, inline-cloned once in seed data; silent drift between client assumption and server-validated output is currently only prevented by hand. | Create `shared/types.ts` exporting the 6 wire types. Re-export / import from `src/types.ts` and `server/types.ts`. Collapse `export type Goals = Macros`. Retype `SeedProductData.per100` as `Macros`. Both tsconfigs already include `shared/`. |
| **MEDIUM** | DRY | `src/App.tsx:55,65,216,217,435,446,447` + `src/api.ts:20,43,44` | Storage keys `'kcal_session_token'` and `'kcal_user'` are string-duplicated 10× across two files; the 401 auto-logout in `api.ts:43-44` also duplicates the cleanup block in `App.tsx:446-447`. Typo on one side silently breaks session handling on the other. | Export `SESSION_TOKEN_KEY` and `USER_KEY` from `api.ts` (or a tiny `src/session-storage.ts`). Optional: add `clearStoredSession()` called by both `onLogout` and the 401 handler. |
| **MEDIUM** | DRY | `src/modals/AILabelScanner.tsx:11-16` + `server/types.ts:167-172` | (Subsumed by HIGH finding.) Same 5-line `ExtractedLabel` shape on both sides of the AI-scan wire. Listed separately because the fix touches a client modal, which some readers may audit in isolation. | Same as HIGH: move to `shared/types.ts`; both sides import. |
| **LOW** | DRY | `src/App.tsx:335-341` + `src/App.tsx:531-537` | `Product → Partial<ProductDraft>` fallback literal written twice: once in `onScanBarcodeFromForm`'s `draftSoFar`, again as the `<NewProductForm initial>` fallback for the edit-product modal. Both update together on `Product`/`ProductDraft` shape change. | Extract top-level `productToDraft(p: Product): Partial<ProductDraft>` in `App.tsx` and reuse at both sites. |
| **LOW** | DRY | `src/App.tsx:125-132` + `src/App.tsx:220-225` | Identical `User → Goals` rename-mapping (strip `goal_` prefix from 4 fields) appears in both the `useState` init factory and the `onVerified` handler. | Extract `userToGoals(u: User): Goals`; call from both sites. The inverted mapping at `:428-433` stays inline (different shape — merges into existing User). |
| **LOW** | DRY | `src/types.ts:1-47` (subsumed by HIGH) | `Goals` is a structural clone of `Macros` — same 4 numeric fields, read identically. Server already does `type GoalsBody = Macros`. | `export type Goals = Macros`. Happens naturally when the HIGH shared-types fix lands. |
| **LOW** | DRY | `src/components/Sheet.tsx:30` + `src/hooks/useFadeClose.ts:3` | `Sheet.tsx` declares private `const EXIT_MS = 250`, a copy of already-exported `FADE_EXIT_MS = 250` from `useFadeClose.ts`. Same animation-timing contract; would be updated together. | In `Sheet.tsx` delete local `EXIT_MS` and `import { FADE_EXIT_MS } from '../hooks/useFadeClose'`. Use at both call sites (`:79`, `:137`). Inline CSS transition string at `:134` stays (animation timing already requires a CSS edit too). |
| **LOW** | DRY | `server/claude.ts:205-219` + `server/claude.ts:260-269` | `probeClaude` and `extractNutrition` rebuild the same SDK usage-context: find the `result` message, copy `total_cost_usd`, `input_tokens`, `output_tokens` onto a ctx object. Identical shape and field names. | Extract a local helper `buildUsageCtx(messages)` returning `{ cost_usd, input_tokens, output_tokens }` when a result message exists; spread into the log ctx at each site. |
| **LOW** | YAGNI | `server/routes/entries.ts:79-92` (+ `server/statements.ts:201` + `server/types.ts:151` + `src/hooks/useEntries.ts:23`) | `DaySummary.entry_count` is emitted on every `/entries/week` response and propagated through `WeekSumRow` and the client `WeekResponse` inline type, but no consumer reads it (`useEntries.ts:44-46` reads only `dt.consumed`). | Four-surface delete: drop from `DaySummary`+`summariseDay`; remove `COUNT(*) AS entry_count` from `statements.entries.weekSum`; remove from `WeekSumRow`; remove from `WeekResponse`. No schema migration (`COUNT(*)` is a projection). |
| **LOW** | YAGNI | `server/auth.ts:66-79,96-100` + `server/statements.ts:40-53` + `server/types.ts:24-33` | `verifySession` fetches `goal_kcal`/`goal_protein`/`goal_carbs`/`goal_fat` via `sessions JOIN users`, populates `SessionUserRow → AuthedUser`, but the only consumer (`authMiddleware`) reads `user.id` only. The goal fields travel through the type chain and are discarded. | Rewrite `statements.sessions.selectWithUser` to `SELECT user_id, expires_at FROM sessions WHERE token = ?` (no JOIN). Shrink `SessionUserRow` to `{ user_id: number; expires_at: number }`. Change `verifySession` return to `number | null`. Delete `AuthedUser`. |
| **LOW** | YAGNI | `src/components/Sheet.tsx`, `FoodRow.tsx`, `MacroBar.tsx`, `MacroSummary.tsx`, `WeekStrip.tsx` + `src/modals/GramsPicker.tsx`, `NewProductForm.tsx`, `AddPicker.tsx`, `BarcodeScanner.tsx`, `AILabelScanner.tsx` | Every component and every modal exports a `*Props` type with zero external consumers across the whole repo. Same habit in 10 files. | Drop the `export` keyword in all 10 files (or inline the type at the function signature, matching the `DayPillProps` local-only pattern already used inside `WeekStrip.tsx:24`). |
| **LOW** | YAGNI | `shared/seedProducts.ts:1-4` + `CLAUDE.md:65` | File header and `CLAUDE.md` both claim the data is used by "the frontend mocks". No `src/` file imports `seedProducts`; `src/mocks.ts` hard-codes its own values. Doc drift. | Rewrite header to describe only the real use (server seed). Update `CLAUDE.md:65` to drop the frontend-mocks language. Optionally move file to `server/seedProducts.ts` since it's no longer shared. |
| **LOW** | YAGNI | `shared/seedProducts.ts:6,14` | `export type SeedProductData` has no external consumer — referenced only once, as the element type of the `seedProducts` constant in the same file. | Drop `export` so the type becomes file-local. |

---

## 3. Architectural Notes (grouped by domain)

### D1 — server-core
- Well-partitioned: `env` (validation gate) → `db` (migration + handle) → `statements` (SQL) → `auth`/`email`/`claude`/`log`/`util`/`guards` (domain helpers). Each file has one responsibility; no reorganization warranted.
- Bootstrap ordering in `server/index.ts` (env → db → routes → `probeClaude`) is load-bearing and correctly documented at the top of the file.
- `shared/` already hosts three cross-project modules (`seedProducts`, `apiPrefixes`, `normalize`) using the nodenext `.js` extension convention. Adding `shared/types.ts` is a direct extension of that pattern, not a new layer.
- `env.ts`'s bare `console.error + exit(1)` is load-bearing (log.ts depends on env).
- `server/asyncHandler.ts` listed in the Phase-1/Phase-2 scope does not exist on disk and has no consumers — drop from the audit template.

### D2 — server-routes
- All four routers follow the same skeleton: default-export `Router()`, optional `router.use(authMiddleware)` at top, colocated `isXxxBody` guards built from `guards.ts` primitives, `req.userId!` assertion post-middleware, `res.status(N).json({ error: 'snake_case' })`. Good consistency.
- `authRouter` is the one router that does NOT `router.use(authMiddleware)` — applies it per-route on `/logout` only, because `/magic-link` and `/verify` are pre-auth. Correct as-is.
- Insert-then-reselect pattern in three sites (`POST /entries`, `POST /products`, `POST /products/adopt/:id`). A shared helper would need to parameterize statement, args, mapper, and log fields — more mechanism than saved. Keep as-is.
- Inline `as { lastInsertRowid: number | bigint }` and `as { changes: number }` casts across routes signal a typing gap in `server/statements.ts` (default `Statement<unknown[], unknown>`). D1 concern, not routes.
- `settings.ts`'s local `isGoalInt(v, max)` helper is a clean single-use internal — don't promote to `guards.ts`.

### D3 — server-data
- Minimal by design: one dev-only CLI (`server/seed.ts`) + one data file (`shared/seedProducts.ts`).
- `server/seed.ts` conceptually belongs to server-tooling, not server-core (one-shot CLI with `process.exit`). Today the split is fine; if more scripts appear, group under `server/scripts/`.
- Once `shared/types.ts` lands, `SeedProductData.per100` should be retyped as `Macros`. Blocked on D1/D4 fix.

### D4 — client-core
- `src/mocks.ts` is misnamed and holds two unrelated real-prod symbols: `computeMacros` (called by `GramsPicker` at render time) and `mockGoals` (pre-auth goals default). Recommendation: move `computeMacros` into `src/types.ts` next to `sumMacros`, inline the 4-line `mockGoals` literal at its single `App.tsx` consumer (or rename to `DEFAULT_GOALS` in types.ts), delete `src/mocks.ts`. No new abstractions.
- The `User` type carries goals as four flat `goal_*` fields, forcing the rename-transform in three places in `App.tsx` (125-132, 220-225, inverted at 428-433). If the server response shape becomes `{ ...user, goals: Goals }`, all three transforms disappear. Server-side cleanup, not unilateral D4.

### D5 — client-screens
- Small, cleanly split (Home presentation, Login/Verify pre-auth, Settings editor). No hoisting warranted.
- `EMAIL_RE` is the only concrete D5 duplication that crosses domains (to `server/guards.ts`). Cheapest fix: export from `shared/` paralleling `shared/apiPrefixes.ts`, import in both.
- `Login.module.css` and `Verify.module.css` share `padding: 80px 28px 40px` + `BrandMark` — 1-line style coincidence; not worth an `.auth-shell` abstraction.

### D6 — client-components
- Flat leaf folder of five independent presentational components. Appropriate for size.
- `MacroBar` / `MacroSummary` split is load-bearing: `MacroBar` is a reusable thin labelled progress bar with a 4-band color scale; `MacroSummary` composes three of those plus a distinct kcal headline + binary-colored progress bar. Consolidating would require a variant prop. Leave as-is.
- `Sheet.tsx`'s drag-off path (lines 123-137) intentionally bypasses `requestClose()` and drives slide-off with inline styles — documented at `:124-131` to avoid a visual bug. Do not "simplify."
- `WeekStrip.tsx`'s local `cx` helper and `DayPill` subcomponent are correctly local.

### D7 — client-modals
- Outer/Inner Sheet split (`AddPicker`/`Inner`, `NewProductForm`/`Inner`, `GramsPicker`/`Inner`) is load-bearing for the Sheet context model: `useSheetClose()` consumes a context provider that `Sheet` itself installs. Do not flatten.
- Two distinct modal patterns are used consistently: bottom-sheet via `Sheet` (food-adding flows) and fullscreen-overlay via `useFadeClose` (Settings, BarcodeScanner, AILabelScanner). No consolidation opportunity.
- Dual-effect fetch-with-cancel-guard pattern appears with divergent integration details — a shared helper would hide cancellation without shortening code. Local idiom is fine.

### D8 — client-hooks
- `useEntries.ts` `add`/`update`/`remove` share a closure-capture pattern: each calls `setEntriesByDate` with an updater that captures `newList`, then `setWeekTotals(sumMacros(newList))`. The inner transforms (sort-insert, map-replace, filter-delete) genuinely differ — extraction would need a transform callback identical in shape to what's inlined. Keep.
- `UseEntriesReturn` export has no external consumers but serves as the hook's public-API documentation at the declaration site. Keep.
- `src/hooks/useFadeClose.ts` is out of Phase-1 scope but is structurally trivial (11 lines) and cleanly consumed by 3 callers. No issues.

---

## 4. Rejected Findings (audit trail)

| Ref | Why rejected |
|---|---|
| Home.tsx `MacroSummary` recomputes `sumMacros` vs App's `totalsByDate` | Not DRY. `weekTotals` is loaded from `/entries/week` for `weekStart`; `selectedDate` can drift outside that week, leaving `weekTotals[selectedKey]` undefined. Deriving from the rendered list preserves the "summary matches the list" invariant. |
| Verify.tsx `VerifyResponse` mirrors server shape | There is no named server-side `VerifyResponse` today — the route returns an inline literal. Treating this separately would invent a new abstraction for one anonymous response. Subsumed by the broader HIGH shared-types finding. |
| Login.tsx fullscreen-close vs other screens | Within D5, only Settings uses the fade-close pattern. The pattern is already hoisted to `useFadeClose` + `.fullscreen-exit` in `styles.css`. No further hoisting warranted. |
| Settings.tsx `save()` finally fires after unmount on success | Not a DRY/KISS/YAGNI category (minor state-on-unmount warning). Out of audit scope. |
| `MacroSummary` kcal bar vs `MacroBar` internals | Different color policy (binary accent/danger vs 4-band scale) and layout (split headline vs inline label+value). Folding would require a variant prop — trades one smell for another. |
| `WeekStrip.tsx` `cx()` helper | Grepped the repo — only site. No cross-file duplicates. |
| `UseEntriesReturn` export (useEntries.ts) | Serves as public-API documentation at the declaration site; inlining the return forces readers to scan the whole function body. |
| `server/auth.ts` `randomBytes(32).toString('base64url')` twice | Two semantically distinct concerns (magic-link token vs session token). Extracting saves one line and hides intent. |
| `server/env.ts` uses `console.error` instead of log.ts | Load-bearing: `log.ts` depends on `env.ts` (reads `env.LOG_LEVEL` at module load). Circular-dep avoidance. |
| `server/email.ts` constructs new `ServerClient` per call | Magic-link email frequency is low (one per sign-in); no observed pain. Fails concrete-impact. |
| `server/statements.ts` `PRODUCT_COLS` vs `PRODUCT_COLS_P` | Intentional: `PRODUCT_COLS_P` carries the `p.` alias required only by `products.recent` (entries JOIN products AS p). Collapsing would force runtime string concat. |
| `server/routes/entries.ts` `rowToEntry` vs `products.ts` `rowToProduct` | `rowToEntry` reads `r.p_id/p_name/...` from `EntryJoinRow` (JOIN aliased to avoid collisions with the entry's own `id`/`name`); `rowToProduct` reads unprefixed `r.id/r.name/...` from `ProductRow`. Unifying requires renaming JOIN aliases (breaks `r.id` meaning) or a prefix-parameterized runtime mapper — both worse. |
| Insert-then-reselect pattern across 3 routes | Helper would need to parameterize two statement handles, args, mapper, log fields. More mechanism than saved. |
| `server/routes/settings.ts` `MAX_KCAL`/`MAX_MACRO_GRAMS` vs Claude caps | Different physical quantities (daily goals vs per-100g density). Consolidating would be harmful. |
| `server/routes/auth.ts` three identical `/verify` errors | Deliberate non-disclosure: attacker can't distinguish consumed-token vs missing-user. Privacy feature, not duplication. |
| `useEntries.ts` `add/update/remove` shared scaffolding | Inner transforms genuinely differ (sort/map/filter). Extracted helper needs a transform callback identical in shape to current inline body. Pragmatism gate #2. |

---

## 5. Scope-List Error

- `server/asyncHandler.ts` is listed in the Phase-1 scope of `KCAL_AUDIT.md` but does not exist on disk. No route or module references it. Remove from the audit template.
