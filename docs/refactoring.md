# Behavior-preserving refactoring

This campaign keeps Preact, Express, SQLite, addressless navigation, REST and
MCP contracts, session storage keys, and database migrations unchanged. Existing
read/write helpers remain the business-operation boundary. Each pass is reviewed
against observable behavior, rather than a target file size.

## Baseline and inventory

- Starting revision: `46d86d0` (clean working tree).
- Planning checks: frontend/server TypeScript checks and exploratory
  `--noUnusedLocals --noUnusedParameters` checks passed. Journey duplicate-ID and
  bidirectional-link checks passed.
- Implementation baseline: `npm test` passed on the unchanged application
  (2026-09-11; 5.7 minutes). Log: `/tmp/kcal-refactor-baseline.log`.
- Confirmed dead code: `isPositiveFinite`; no runtime callers remain. Its test
  comments describe the superseded validator. No dead SQL or dependency was found.
- Live code with stale organization: `mocks.ts` contains production macro scaling
  and fallback goals; `src/types.ts` contains runtime summation.
- Duplicate paths: macro arithmetic, goal/user mapping, REST write-error handling,
  entry-cache transforms, test login/token helpers, and MCP test support.
- Large responsibility bundles: App (session, goals, notifications, overlay,
  modal rendering/transitions) and the MCP route (schemas, reads, writes,
  results, transport). Gesture algorithms and scanner internals are outside scope.

## Passes and validation

Run each affected spec with `npx playwright test tests/e2e/<name>.spec.ts`.
Multiple affected paths can be passed to a single invocation. Never run E2E
invocations concurrently: startup resets the shared `/tmp/kcal-e2e.db` before
Express opens it. Playwright builds the frontend; it does not typecheck the server.

| Pass | Behavior | Structural change | Validation |
| --- | --- | --- | --- |
| 1 | Shared amount minimum, fresh E2E startup | Remove dead guard; correct maintenance guidance | Both typechecks; entry/edit/MCP amount journeys; `bash -n scripts/review-e2e.sh` |
| 2 | Shared and isolated test identities stay distinct | Share login/token primitives | Auth, logout, onboarding, adoption, search, settings and helper consumers |
| 3 | Real OAuth/SDK connections and explicit scopes | Share MCP fixture lifecycle and equivalent helpers | MCP reads/writes/groups and OAuth |
| 4 | Unrounded scaling and ordered summation | Shared arithmetic; production defaults; runtime helpers out of types | Both typechecks; grams, onboarding, entry, edit, tagging, grouping and MCP |
| 5 | WriteError status/body; other errors propagate | Share REST error adapter at existing mount positions | Entry/product validation, ownership, deletion, grouping |
| 6 | Persistent backdrop, synchronized exit | Extract SheetOverlay | Sheet, edit, race |
| 7 | Replacement errors restart notification lifetime | Extract notification lifecycle | Race failures and overlapping-notification parity |
| 8 | Cached goals hot-start; server goals authoritative | Extract session/goal lifecycle and mappings | Auth, logout, settings, onboarding, cross-device and request-count parity |
| 9 | Draft round trips; explicit Close versus Dismiss | Typed modal helpers and renderer; App owns transitions | Sheet, edit, grouping, keyboard, race, barcode cancellation/draft parity |
| 10 | Successful response precedes cache changes | One cache state with pure transformations | Entry, edit, delete, selection, tagging, grouping, weekstrip and response-order parity |
| 11 | Identical advertised schemas and annotations | Extract MCP schemas | Read/write discovery comparison; all MCP suites |
| 12 | Identical account-scoped read results | Extract read registrations | MCP ranges, empty dates, pagination, summaries and ownership |
| 13 | Scoped writes validate output before commit | Extract write registrations | MCP writes/groups, OAuth, rollback and temporary-food rules |

## Modal and client-state contract

| Starting flow | Event | Destination / preserved state |
| --- | --- | --- |
| Add picker | New / temporary food | New product, retaining the temporary flag |
| New product | Explicit Cancel | Add picker |
| New or edit product | Backdrop / dismiss gesture | Home, not the parent picker |
| Grams picker | Edit product | Product editor with original product and optional entry |
| Edit product | Explicit Cancel | Grams picker with original product/entry |
| New product | Barcode scan detected / cancelled | New form with live draft; only detection replaces barcode |
| Edit product | Barcode scan detected / cancelled | Edit form with product/entry and live draft; only detection replaces barcode |
| Add picker scanner | Owned barcode / shared barcode / unknown barcode | Grams picker / new form from safe template / new form with barcode |
| Add picker scanner | Close | Add picker |
| Group create / edit | Successful save | Home; selection resets only after successful creation |

Keep conditional sibling slots and component mount boundaries when moving modal
markup. Sheet-backed kinds share one registered close callback and backdrop;
scanner overlays stay outside that provider. Keep the existing 300ms fade and
3750ms notification hold. Do not rewrite numeric inputs: product fields clear
the underlying value, while goal/grams fields retain a model and restore text.

Session storage uses `kcal_session_token` and `kcal_user`. GET `/settings` and
successful saves update live goals and the cached user. Goal-only user refreshes
must not repeat day/week loading. 401 handling and OAuth request preservation stay
in the HTTP wrapper; logout still clears local state if its server request fails.

Cache changes occur after successful requests. Entry IDs define insertion order,
including reversed POST responses. A day load marks it loaded but does not derive
week totals. Mutations derive totals only when their existing callback's captured
loaded-date set permits it; do not silently switch that decision to the latest
state at response time. Tags and group metadata never change nutrition. Deletion
clears dissolved-group metadata. Week loads merge their response as before.

## REST/MCP compatibility and parity

| Boundary | Contract to preserve | Existing checks |
| --- | --- | --- |
| HTTP errors | Existing statuses and `{ error: string }`; unexpected errors forwarded | validation, entry, edit, product, delete |
| Entry validation | Shared >=1 amount floor; legacy smaller entries still readable/taggable/deletable | J-223 |
| Date/time validation | REST entry/weight inputs retain shape-only date acceptance; group creation still requires calendar-valid dates; MCP entry creation retains calendar/clock validation and its amount cap | entry, weight, grouping, MCP |
| Product updates | REST full PUT and existing unknown-field behavior; MCP strict partial updates and omitted/null distinction | product, validation, MCP writes |
| Ownership/sharing | SQL owner binding; barcoded shared catalog; owner copies; temporary-food restrictions | adopt, search, J-224 |
| Nutrition | Current product values recalculate old entries; SQL aggregation unchanged; flat real group children | edit, grouping, MCP reads/writes/groups |
| MCP discovery | Same names, order, descriptions, schemas, defaults, annotations, instructions and scope-specific inventory | MCP and OAuth |
| Mutation atomicity | Shared writes, scope check, output validation within outer transaction before commit | J-209, J-220 and MCP writes/groups |
| OAuth/transport | Resource/scopes, origin rejection, token lifecycle, per-request transport cleanup unchanged | OAuth and MCP |

Preserve the explicit safe barcode-template projection. Do not route adoption
through ordinary creation: source-value preservation, normalization, statuses,
and the sequential existing-copy check differ. Keep omitted weight flags and
legacy migration compatibility. No SQL, protocol, dependency, or data migration
is part of this campaign.

## Coverage gaps and completion record

Before the corresponding extraction, add or run parity checks for overlapping
notifications, barcode cancellation/draft return, goal refresh request counts,
reversed mutation responses, failed writes, and an unloaded day with week totals.
The browser parity checks J-225 through J-233 passed against the unchanged
frontend before its refactor (`/tmp/kcal-refactor-parity-baseline.log`, 29.3
seconds). J-234 checks the extracted pure barcode-result helpers after extraction.
Keep existing assertions in test-support refactors. New journey IDs enter
`tests/JOURNEYS.md` only with their tests.

Device-only checklist (record as unverified if hardware/services are unavailable):
camera permission allow/deny; detecting a real barcode from new/edit forms;
camera release on dismissal; barcode cancellation with a populated draft.
Automated cancellation and pure draft-merge checks do not prove live decoding.
Barcode scanner internals are unchanged.

Known behavior to leave for separate functional work: product create/adoption/
barcode/group callbacks guard stale results, whereas product edit/delete callbacks
currently do not. Do not standardize cancellation in an extraction.

Separate future tasks: dependency/runtime and lockfile reproducibility policy,
test typechecking, framework/router/state-library or ORM migration, OAuth redesign,
adoption concurrency guarantees, offline caching, and
parallel test-database architecture. Weight form and broad SQL/type decomposition
are deferred.

Completion gates are both typechecks, full `npm test`, journey duplicate/backlink
checks, and a clean diff check. Results and remaining manual coverage limits are
recorded below.

### Implementation record

All thirteen structural passes are implemented. App retains navigation and
asynchronous mutations; its modal renderer, session/goal state, notifications,
and overlay are separate. Entry caches update through one pure state transform.
Production arithmetic lives in `shared/macros.ts`, UI fallback goals in
`src/defaults.ts`, and the former mock module is removed. MCP schemas, read/write
registration, and results live in `server/mcp/`; the route retains HTTP and
transport handling. REST errors and test authentication/MCP support are shared.

- `npm run typecheck` and `npm run typecheck:server`: passed after integration.
- Focused Playwright run covering refactor parity, sheet, race, keyboard,
  grouping, MCP reads/writes/groups, and OAuth: passed (2.1 minutes), recorded in
  `/tmp/kcal-refactor-focused.log`.
- SDK discovery for both read-only and read/write connections: byte-identical
  before/after, including schemas, descriptions, annotations, instructions and
  server version. The capture and AST comparison scripts/results are in
  `/tmp/kcal-backend-refactor/`. AST comparison also confirms unchanged tool
  registration bodies, result/date helpers, and HTTP handling.
- Strict ad hoc TypeScript checks of affected test-support files and the new
  parity spec: passed using the existing compiler; no new tooling was installed.
- Catalog duplicate/backlink checks and actual Playwright-discovered test-name
  prefixes: passed. `bash -n scripts/review-e2e.sh` and `git diff --check`: passed.
- Final `npm test`: passed (2026-09-11; 6.1 minutes), recorded in
  `/tmp/kcal-refactor-final.log`. Both typechecks passed immediately before this
  run. All original journeys and the new parity checks passed together.
- Real-device camera permission/detection/release remains unverified. Browser
  cancellation, draft preservation, and pure result-merging checks pass; they
  do not replace those manual checks.

## Follow-up cleanup campaign

The second campaign starts at clean revision `84bbe41`. The first campaign's
record above remains historical; test typechecking and the narrow operation
result-type cleanup previously deferred there are now in scope. Framework,
dependency, database, deployment, and public API changes remain outside scope.

Confirmed opportunities are unused global font/animation definitions, an
obsolete CSS custom-property cast, stale source-line comments, duplicate food-row
wiring and product-form nutrition construction, repeated weight/product limits,
and shared operations described through MCP-specific result types. All prepared
statements have consumers; no further dead SQL or dependency was confirmed.

| Pass | Current behavior to preserve | Structural improvement | Validation |
| --- | --- | --- | --- |
| 1 | Existing strict compiler settings and Playwright runtime | Dedicated test TypeScript project and command | `npm run typecheck:tests` |
| 2 | Geist/JetBrains Mono families, active weights and animations | Remove nine unused families and three unreferenced keyframes | Build; login/home/product-form screenshots and computed fonts |
| 3 | Same inline style object and test assertions | Remove obsolete cast; replace stale source-line references with handler/module names | Frontend typecheck; executable test AST and journey catalog checks |
| 4 | Identical grouped/ungrouped row interactions and keys | One local food-row rendering helper | Selection, tagging, grouping and grouped-child edit journeys |
| 5 | All-or-nothing nutrition drafts, unchanged metadata and warnings | One render-local nutrition snapshot | Required fields, Atwater, product flows and scanner parity |
| 6 | Weight range/precision, note/date parsing and checkbox defaults | Shared weight constants and numeric predicate | Weight UI/API boundary and persistence journeys; both app typechecks |
| 7 | REST guards and strict MCP schemas | Shared product limits without shared validators | Product boundaries and discovery JSON |
| 8 | Same group/summary results and public MCP types | Neutral shared operation-result types composed into existing MCP exports | All typechecks; MCP summary/group and schema parity |

### Contracts and checks before application changes

- Extend weight journeys with exact 0.1/1000 boundaries, excess precision,
  blank input, and note limits. The UI measures the raw note; REST measures its
  trimmed value. Keep the existing one-decimal tolerance and shape-only dates.
- Extend scanner parity to cover complete and incomplete nutrition drafts and
  raw draft metadata versus trimmed submission metadata. An incomplete nutrition
  object stays absent from the scanner draft; do not preserve extra fields as a
  side effect of consolidation.
- Capture MCP SDK discovery under read-only and read/write scopes before and
  after backend edits and require identical JSON.
- Preserve FoodRow's props and surrounding mount/group structure. Keep product
  form parsing, submission guards, Atwater arithmetic and metadata trimming local.

Run added assertions against unchanged application code before the affected
refactors. Use existing journeys when expanding the same behavior, and catalog
new IDs only when adding a distinct journey. Each pass remains independently
reviewable and separately committed. Run focused E2E checks sequentially; finish
with all three typechecks, full `npm test`, journey duplicate/backlink checks,
and `git diff --check`. Record actual outcomes below without fixed suite counts.

### Deferred work

Stricter date validation, adoption concurrency changes, font-hosting changes,
generic form/CRUD abstractions and size-only file splits are deferred.

### Follow-up implementation record

- Added strict test typechecking; `npm run typecheck:tests` passed before
  application behavior edits.
- Extended weight validation and scanner draft assertions and added J-235.
  `weight.spec.ts` and `refactor-parity.spec.ts` passed against unchanged
  application logic (50.2 seconds): `/tmp/kcal-cleanup-2-parity-baseline.log`.
- Obsolete CSS casting was removed without changing emitted JavaScript.
  Source-reference edits preserve the comment-stripped executable AST of every
  affected E2E file. Frontend typecheck passed for this pass.
- CSS-only before/after production builds used an isolated archive, database and
  port. Active Google fonts loaded successfully; computed styles and rendered
  platform fonts match. Login/Home screenshots are pixel-identical. Product-form
  captures differ only by one-channel rounded-edge variation also seen when
  capturing unchanged CSS twice. Report and images:
  `/tmp/kcal-css-parity-w6td_ebi/captures/`.
- Weight parser source comparison preserves results and exact failures for
  boundary values, precision tolerance, invalid calendar-shaped dates, trimmed
  notes and omitted flags. Both scope-specific SDK discovery results match
  baseline byte-for-byte after product constant extraction.
  Probe sources/results: `/tmp/kcal-cleanup-2-backend/`.
- Neutral operation-result types preserve all existing shared exported type
  structures. Core reads/writes emit identical runtime JavaScript, and final MCP
  discovery still matches both baseline scope inventories.
- The first row-focused run exposed a grouping-test synchronization race: group
  visibility can precede Home's selection-reset effect and the outgoing selection
  bar's exit. The unchanged parent logic passed an immediate repeated check.
  `createGroupFromRows` now waits for both Sheet unmount and selection-bar exit
  before the next interaction; assertions and application behavior are unchanged.
  Initial log: `/tmp/kcal-cleanup-2-rows.log`; repeated check:
  `/tmp/kcal-cleanup-2-group-repeat.log`.

- Focused integration covering weight, refactor parity, product, validation,
  edit, onboarding, MCP reads/writes/groups and grouping passed (2.6 minutes):
  `/tmp/kcal-cleanup-2-focused.log`. This includes the grouping synchronization
  check and the new weight/scanner assertions after all application edits.
- Final frontend, server and test typechecks passed, as did the journey catalog
  duplicate/backlink and whitespace checks. Independent reviews found no
  additional behavior or public API differences.

- The first full-suite run passed every journey except the existing week-strip
  animation-lock test (`/tmp/kcal-cleanup-2-final.log`). Its two awaited mouse
  swipes did not guarantee the second began during the 300ms transition. The
  carousel runtime and its stylesheet are unchanged.

The animation-lock test now pauses the real CSS transition before the second
mouse swipe, verifies the same transition remains active, then finishes it and
checks the original one-week result. The complete week-strip spec passes:
`/tmp/kcal-cleanup-2-weekstrip.log`. In an isolated archive, the corrected test
passes with the guard present and fails when only the `animatingRef` guard is
removed (the original animation is cancelled instead of remaining paused).
Proof logs: `/tmp/kcal-j166-parity-u5n2w9tt/`.

A subsequent full run (`/tmp/kcal-cleanup-2-final-verified.log`) failed before
the second swipe because the paused track was already cancelled and its week
committed. An isolated probe reproduced this existing behavior with both a real
child opacity transition and a synthetic child event: the track's unfiltered
`transitionend` listener accepts bubbled events and commits prematurely. Late
progress-dot transitions from the populated shared account are the inferred
trigger in the full run. Probe: `/tmp/kcal-week-bubble-w23da76a/result.json`.
J-166 now uses blank storage and `signInFresh`, waits for
the empty day, and tests the track lock without unrelated history animations.
The whole week-strip spec passes repeated runs with this setup:
`/tmp/kcal-cleanup-2-weekstrip-isolated.log`.
The fresh-account version also passes the isolated guard-present check and fails
the guard-removal mutation at the intended animation-preservation assertion:
`/tmp/kcal-j166-parity-u5n2w9tt/baseline-j166-fresh.log` and
`/tmp/kcal-j166-parity-u5n2w9tt/mutation-j166-fresh.log`.

Separate functional follow-up: restrict the carousel's commit/snap-back completion
handlers to the track's own transform transition. Characterize child opacity/
background transition events and late week-total loads before changing it.
This application behavior is deliberately unchanged in the cleanup campaign.

All eight cleanup passes are complete in separate commits, with the parity
additions and test-synchronization fixes separately reviewable. Final `npm test`
passed (2026-09-11; 6.2 minutes), including the isolated animation-lock test:
`/tmp/kcal-cleanup-2-final-complete.log`. All three typechecks, journey
duplicate/backlink checks and `git diff --check` pass. The confirmed carousel
child-transition issue remains a separate follow-up. Live camera decoding was
not exercised; this campaign's automated barcode checks cover cancellation and
draft behavior, as described above.

## MCP v4 and dated-goal follow-up

This follow-up changes behavior and public contracts; it is not another parity-only
cleanup. MCP v4 replaces single-entry creation with atomic `create_entries`, adds
durable account-scoped create receipts, and expands the existing product discovery
tool. The app and MCP now use one effective-date goal model. Detailed client
contracts and migration behavior are in [mcp.md](mcp.md).

- Goal history stores complete macro vectors, one row per user/effective date.
  Initialization records existing editable values only from the server-derived
  local day when the authenticated app supplies its timezone. Older dates stay
  unknown. Same-day saves replace the row, unchanged saves stay sparse, and saves
  before the newest row fail. GETs and MCP never initialize history. Historical
  progress and comparisons use effective goals; summary comparisons pair the same
  logged, known-goal dates on both sides.
- Creation receipts commit with business mutations under an immediate SQLite
  transaction. Tool output is validated before commit. Retries replay the original
  snapshot even if records later change or disappear; conflicting reuse and
  unreadable receipts fail without writing. Mutation success logs happen after
  commit. Batch entries retain input order; existing group membership IDs are
  compared as a sorted set. Optional batch grouping is atomic.
- Saved-food browsing/search/recents and barcode lookup share one service.
  Literal NFC/lowercase matching fixes wildcard and accented-case mismatches;
  deterministic tie-breakers support pagination. Separate global deduplication
  dimensions prevent private-ID/barcode collisions. Barcode/adoption paths exclude
  temporary rows, and shared templates retain their explicit safe projection.
  Normalized text limits account for Unicode expansion; omitted product fields
  keep their exact legacy values. Failed scanner lookup returns to a usable picker.
- The migration seeds a dismissible account notice only for existing grants with
  usable credentials. It does not revoke tokens, widen scopes, or gate access.
  Settings snapshots carry history and notice state; old timezone-free goal saves
  receive an explicit refresh error. Client session and mutation generations guard
  late responses, including goal reads and reminder dismissal.
- Related validation fixes share real-calendar date and bounded amount rules
  across interfaces. Authentication throttles use independent issuance and
  verification budgets. `TEST_MODE` relaxes throttles for suite fixtures; separate
  injected-clock limiter tests exercise production limits and expiry. Shared
  civil-date helpers keep range calculations independent of timezone and DST.

Verification completed on 2026-10-19: all three TypeScript checks, the production
build, the full Playwright suite, journey duplicate/backlink checks, and
`git diff --check` passed. The full run is recorded in
`/tmp/kcal-v4-complete.log`. Focused session/history checks also passed, including
delayed settings reconciliation and the distinction between latest editable
defaults and dated targets. Mobile previews verified the reminder, history
subview, and connection guide without horizontal overflow. Fresh and upgraded
test databases were exercised; production data was untouched.

## Verified consistency fixes after MCP v4

Work began at `20defe4` on the existing v4 branch. Application code stayed
unchanged until the new regressions demonstrated the planned failures:

- Settings retained stale values or allowed saving before its authoritative read;
  fractional and oversized goals remained submittable (J-400/401/403/407/408).
- A real REST save committed 80 kg, another client saved 81, and a completed
  foreground read returned 81; releasing the held save response reverted the UI
  to 80. Failed reconciliation had the same stale-response problem (J-404/405).
- A real canvas-camera decoder's lookup replaced a closing scanner during its
  controlled fade (J-410). Real child opacity transitions prematurely committed
  a paused week swipe or completed its snap-back (J-412/413).
- Product loading failures looked empty or lacked failure feedback (J-420–423).
  Oversized portions reached POST /entries through button and Enter, and the
  increment button exceeded MAX_ENTRY_AMOUNT (J-424–426).
- Shared arithmetic returned 14.499999999999998 for 29 g at 50 kcal/100 g,
  producing a displayed 14 while SQLite returned 14.5 (J-430).

Proof runs: `/tmp/kcal-quality-picker-baseline.log`,
`/tmp/kcal-quality-baseline.log`, and
`/tmp/kcal-quality-bounds-baseline.log`. The latter uses rendered-frame
synchronization to assert the increment itself rather than racing its rerender.
An initial combined run stopped at a JSON fixture import error before tests;
that harness error was corrected before collecting behavioral evidence.

The same regressions now pass. Focused runs are recorded in
`/tmp/kcal-quality-picker-arithmetic-fixed.log` and
`/tmp/kcal-quality-ordering-fixed.log`. Additional checks cover drafts, session
replacement, stale pending reads, late camera initialization, and exact replay of
receipts captured before the fixes. These are preservation checks, not additional
claims of discovered defects. Settings and weight reconciliation failures retain
valid state; successful writes remain successful. Shared arithmetic now multiplies
before dividing, matching SQL without rounding intermediate values.

The query-count characterization measured three aggregate reads and two history
reads through the public MCP summary before structural consolidation (J-437).
Frozen baseline fixtures pin product request hashes, old receipt results, tool
names, and affected public schemas. MCP remains 4.0.0, reminder version remains 4,
and no database migration or production data change is part of this follow-up.

Structural passes are separate from the behavior commit:

- The session file now matches `useSessionState`; unused defaults/token reading
  and the public exposure of internal read invalidation are removed.
  `useSheetSubview` gives the existing mounted-form/focus-restoration behavior
  neutral names. Guide, settings, and draft characterizations pass unchanged.
- `shared/productText.ts` is the pure product text policy used by REST guards,
  MCP validation/fingerprints, and shared writes. Shape parsing remains local;
  omitted fields bypass normalization and adoption keeps its exact-copy path.
  Frozen baseline receipt fixtures replay after this change, with unchanged
  hashes and MCP schemas. Existing Unicode, ownership, and omission checks pass.
- Receipt restart and goal-clock scenarios now live in typed fixture modules.
  The shared subprocess helper handles only process/environment setup. The
  receipt scenario still uses two processes and one unique temporary database;
  assertions, journey IDs, sentinels, diagnostics, and 20-second timeouts remain.
- Summary reads reuse one daily-aggregate query, one weight query, and one goal
  history query. The same aggregate rows drive logging coverage and comparisons,
  including zero-calorie days; invalid legacy dates stay filtered. J-437 measured
  the reduction from three aggregate/two history reads to one each, and separately
  pins one weight read. Current-goal resolution now lives in the goal service;
  `WriteError` lives in a dependency-neutral module, eliminating the forwarding
  wrapper without a reads/goals import cycle. Exact summary and MCP-schema
  characterizations pass in `/tmp/kcal-quality-summary-fixed.log`.

Passing before/after runs include `/tmp/kcal-quality-preservation.log`,
`/tmp/kcal-quality-cleanup-characterization.log`, and
`/tmp/kcal-quality-product-fixtures.log`. No adoption-service extraction, broad
module split, generic async/cache abstraction, public contract, schema, or version
change was introduced.

Cancellation coverage also includes a held successful owned-product lookup
(J-418), alongside the 404/500 and late-camera paths. Its focused run passed in
`/tmp/kcal-quality-cancel-success.log`. Mobile previews with mocked API failures
confirmed readable picker Retry feedback and oversized-amount feedback without
page-width overflow. These previews did not access any database.

Final review caught a diagnostic-only drift introduced by text-policy extraction:
raw-oversized text whose normalized form fits acquired an extra normalized-length
error. The new J-438 assertion failed on that intermediate refactor; the original
`20defe4` schemas passed. Shared normalized-form parsers now let MCP's existing
raw bounds and normalized refinements retain their separate diagnostics,
including both errors when both limits fail. Baseline and corrected complete
Zod issues match. The first full run was deliberately interrupted after 110
passing tests to include this correction in the final full run.

The corrected compatibility suite passed in
`/tmp/kcal-quality-diagnostics-verified.log`. Its preceding attempt had one
harness failure: a concurrent production build briefly removed `dist/index.html`
while the browser was loading it. Re-running after the build completed passed;
the final full suite runs without concurrent builds or Playwright invocations.

Final verification completed on 2026-10-19: frontend, server and test TypeScript
checks passed; the production build passed with its existing bundle-size warning.
The full Playwright suite passed all 345 tests in 7.2 minutes, recorded in
`/tmp/kcal-quality-full-final.log`. Journey duplicate/backlink checks and
`git diff --check` passed. Tests exercised fresh and upgraded disposable databases;
production data was untouched. MCP remains 4.0.0 and the reminder remains version
4. No migration, deployment, or public REST/MCP contract change was included.

## MCP v5: amounts, literal word search and entry corrections

The v5 work starts at `381128f`. Unlike the preceding consistency cleanup, this
is an intentional coordinated REST/MCP contract update. Quantities use `amount`
in the product's g/ml unit, with a forward-only column rename. Nutrition's real
gram units and unrounded multiply-then-divide arithmetic are unchanged.

Before changing production code, `v4-receipt-capture.ts` exercised the real v4
MCP handlers in a disposable database and captured product, batch and existing-
entry-group receipts in `v4-creation-receipts.json`. The capture verified that
morning/evening child times and IDs survive grouping. The original stored JSON,
hashes and schema versions are frozen. J-440 replays them in v5 before and after
resource edits/deletion and across a process restart; it also retains the older
`14.499999999999998` arithmetic fixture. Replay projects only the quantity field
name and never rewrites receipt storage. New receipts use version 5.

The liquid-picker label regression J-460 failed against unchanged production
code: the product row lacked `per 100ml` while the shared section header assumed
grams. The baseline is recorded in `/tmp/kcal-v5-label-baseline.log`. Picker rows
now show their own units. The first focused run passed the amount/editor,
receipt, and existing picker-preservation scenarios; its sole failure was a
search fixture expectation that omitted a second valid literal match.

Search remains deliberately small: every distinct whitespace-delimited term
must occur in name or brand, using the existing Unicode folding and literal
`instr` checks. A bound JSON array lets all three static SQL queries apply the
same predicate before sorting/pagination. Null brands use an empty string;
otherwise SQL's null comparison could accidentally accept a missing term.
There is no fuzzy matching, relevance score, alias metadata, or new dependency.

Entry corrections atomically change supplied amount/product/time fields while
preserving identity, date, checkmarks, and groups. Different-unit food
replacement requires an explicit quantity. The editor keeps its draft through
the saved-food picker and library editor; product changes participate in the
existing cache reconciliation and mutation queue. No new queue or generic cache
abstraction is introduced. Migration 009 seeds reminder version 5 for eligible
connections; the reminder remains only on the main screen.

Final editor review added J-468/J-469 for untouched legacy values. Against the
intermediate implementation, a time-only change on a 0.5-unit entry sent an
unwanted amount of 1; an amount-only change on an entry with a legacy `99:99`
time sent no request. Both expected failures are recorded in
`/tmp/kcal-v5-legacy-edit-baseline.log`. The editor now preserves untouched
values and validates only actual replacements, including across library-editor
round trips. The corrected amount/editor/keyboard suites passed 28 tests in
`/tmp/kcal-v5-entry-ui-final.log`.

A final review reproduced one race introduced by returning to the entry editor
after a library save. J-470 held the committed save response, started Sheet
dismissal, and released the response inside its controlled 300 ms fade. The
entry editor reopened and cancelled the dismissal timer. The expected failure
is recorded in `/tmp/kcal-v5-sheet-fade-baseline.log`. Modal navigation is now
invalidated synchronously when Sheet exit begins. The first full run was
intentionally stopped after 63 passing tests to include this fix in the final
run; no test had failed before interruption.

The first complete v5 run passed 370 tests and exposed one obsolete search
fixture: J-121 used a trailing `A` to select one product, but that term also
matches the shared word `Plural` under the new matching rules. Distinct `Mango`
and `Kiwi` terms preserve the singular/plural UI assertion without assuming
contiguous-phrase matching. No production search behavior changed for this fix.

Final verification completed on 2026-10-19: all three TypeScript checks and the
production build passed (with the existing bundle-size warning). All 18 focused
search tests passed, followed by the full Playwright suite: **371 passed in
7.9 minutes**, recorded in `/tmp/kcal-v5-full-final.log`. Journey duplicate and
bidirectional-link checks, maintenance-script syntax, and `git diff --check`
passed. Historical migrations and existing frozen receipt fixtures remain
unchanged. Fresh and upgraded disposable databases were exercised; production
data was untouched and no deployment was performed.
