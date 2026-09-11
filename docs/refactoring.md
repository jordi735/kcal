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
| 9 | Draft round trips; explicit Close versus Dismiss | Typed modal helpers and renderer; App owns transitions | Sheet, edit, grouping, keyboard, race, scanner cancellation/draft parity |
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
| New product | AI scan cancelled | New form with live draft |
| AI scan | Extracted label | New form: typed nonblank name/brand win; extracted macros/unit win; unrelated draft fields survive |
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
notifications, scanner cancellation/draft return, goal refresh request counts,
reversed mutation responses, failed writes, and an unloaded day with week totals.
The browser parity checks J-225 through J-233 passed against the unchanged
frontend before its refactor (`/tmp/kcal-refactor-parity-baseline.log`, 29.3
seconds). J-234 checks the extracted pure scan-result helpers after extraction.
Keep existing assertions in test-support refactors. New journey IDs enter
`tests/JOURNEYS.md` only with their tests.

Device-only checklist (record as unverified if hardware/services are unavailable):
camera permission allow/deny; detecting a real barcode from new/edit forms;
camera release on dismissal; live AI label extraction and cancellation with a
populated draft. Automated cancellation and pure draft-merge checks do not prove
live decoding or model inference. Scanner internals and the runner are unchanged.

Known behavior to leave for separate functional work: product create/adoption/
barcode/group callbacks guard stale results, whereas product edit/delete callbacks
currently do not. Do not standardize cancellation in an extraction.

Separate future tasks: dependency/runtime and lockfile reproducibility policy,
test typechecking, framework/router/state-library or ORM migration, OAuth redesign,
shared process quotas, adoption concurrency guarantees, offline caching, and
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
- Real-device camera permission/detection/release and live AI inference remain
  unverified. Browser cancellation, draft preservation, and pure result-merging
  checks pass; they do not replace those manual checks.

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
| 7 | REST guards, strict MCP schemas, permissive AI coercion | Shared product limits without shared validators | Product boundaries, discovery JSON, deterministic AI coercion comparison |
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
- Use a temporary source-derived AI coercion probe with the installed TypeScript
  compiler. Compare successful values and exact controlled errors for bounds,
  coercible values, missing macros, and metadata defaults. Do not invoke live AI,
  expose test-only APIs, or add a test framework.
- Preserve FoodRow's props and surrounding mount/group structure. Keep product
  form parsing, submission guards, Atwater arithmetic and metadata trimming local.

Run added assertions against unchanged application code before the affected
refactors. Use existing journeys when expanding the same behavior, and catalog
new IDs only when adding a distinct journey. Each pass remains independently
reviewable and separately committed. Run focused E2E checks sequentially; finish
with all three typechecks, full `npm test`, journey duplicate/backlink checks,
and `git diff --check`. Record actual outcomes below without fixed suite counts.

### Deferred upload work

Image-upload and quota handling stay in the product router. A separate
preparatory task should characterize real multipart/auth behavior with a
deterministic extractor and UTC clock: missing/non-image/oversize uploads,
successful extraction, controlled/general failures, per-user exhaustion,
failed-inference quota consumption, UTC rollover and process reset. TEST_MODE
does not replace extraction, so ordinary test uploads must not call live AI.

Stricter date validation, durable quotas, adoption concurrency changes,
font-hosting changes, generic form/CRUD abstractions and size-only file splits
are also deferred.

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
  notes and omitted flags. AI coercion and both scope-specific SDK discovery
  results match baseline byte-for-byte after product constant extraction.
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
duplicate/backlink checks and `git diff --check` pass. The upload/quota extraction
and the confirmed carousel child-transition issue remain separate follow-ups.
Live camera decoding and AI inference were not exercised; this campaign's
automated scanner checks cover cancellation/draft behavior and deterministic
coercion, as described above.
