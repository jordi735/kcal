# User journeys

Source-of-truth list of user flows covered by the Playwright e2e suite under `tests/e2e/`. Each bullet is one flow with at least one passing assertion. The `[J-###]` prefix on every `test()` / `setup()` name in the suite is the back-link — to find which spec(s) verify a flow, run `grep -RF '[J-019]' tests/e2e/`. IDs are stable (never reuse one); when adding a flow, mint the next free `J-###`. Uncovered gaps live in `/tmp/kcal-e2e-review/log.txt` under MISSING — never on this page. The bidirectional grep in `## Verification` is the safety net that proves every doc ID has a matching test and vice versa.

# 1. Authentication & sessions

- J-001 · Sign in via emailed 6-digit code
- J-002 · Sign out clears the server session and returns to Login
- J-003 · Wrong code shows error and keeps user on the code step
- J-004 · Five wrong codes lock the input and reset to the email step
- J-005 · Requesting a new code invalidates the previous one
- J-006 · Unknown email reaches the code screen (no enumeration leak)
- J-007 · Malformed email disables the "Send sign-in code" button
- J-052 · Code auto-submits at exactly 6 digits, never at 5 (boundary)
- J-053 · Code input strips non-digits before counting to 6
- J-054 · `/auth/request-code` normalizes email to lowercase (mixed-case requests share one account)
- J-055 · `/auth/verify-code` rejects malformed code body with 400 `invalid_or_expired_code`
- J-056 · `authMiddleware` returns 401 `unauthorized` on missing / empty / invalid / wrong-scheme bearer
- J-097 · 401 from any API call auto-logs-out: clearStoredSession + hard-navigation back to Login
- J-098 · 401 auto-logout clears both `kcal_session_token` AND `kcal_user` from localStorage
- J-099 · After requesting a code, the resend button shows "Resend in {n}s" and is disabled
- J-100 · Resend during cooldown is a no-op: forced click does not POST `/auth/request-code`
- J-101 · "Use a different email" returns to the email step and preserves the typed email value
- J-102 · `POST /auth/logout` without a bearer returns 401 `unauthorized`
- J-103 · Manual sign-out clears `kcal_user` from localStorage (complement to J-002's server-side proof)

# 2. Empty states

- J-008 · Home for a brand-new user shows "No food logged" and renders zero `.food-row`
- J-009 · AddPicker search with no matches shows the empty-results block; no list headers
- J-075 · Empty home pill shows the "Tap here to log your first item of the day." hint
- J-076 · Tapping the empty-state pill (whole-pill button) opens AddPicker
- J-077 · AddPicker idle on a brand-new user shows "Your library is empty"; no Recent/All headers; Add New / Add Temp remain operable
- J-078 · Empty-day MacroSummary shows the full default kcal goal as remaining + "0 kcal" consumed; "Over budget" never appears at the boundary

# 3. Onboarding & first-run state

- J-104 · Full first-time onboarding flow: signup → empty home → first product (Add New) → first log (100g of 400 kcal/100g) → row + MacroSummary update from 2400/0 to 2000/400
- J-105 · First log replaces AddPicker `idleEmpty` with the `Recent` section + the just-logged product
- J-106 · `addedProductIds` check icon (CheckIcon) appears next to today-logged products in AddPicker; an unlogged sibling product (same library) does not get the icon
- J-107 · A brand-new user opens Settings and sees migration defaults in all four goal fields (kcal=2400, protein=180, carbs=240, fat=80), with no macro-vs-kcal mismatch banner
- J-108 · First log persists across a hard page reload: row, grams, kcal, and MacroSummary totals all rebuild from `GET /entries` after the cold-cache fetch

# 4. Product creation & editing

- J-010 · Create a new product via AddPicker, save & continue, log to day
- J-011 · Server rejects product with kcal > 2000 cap; form stays open
- J-012 · Product names containing HTML render as literal text (XSS safe)
- J-013 · Editing a product retroactively updates already-logged entries
- J-014 · Add Temp Item flow renders the TMP badge
- J-058 · Product delete: first tap arms (aria-label flips to "Confirm delete", sheet stays open, row not deleted)
- J-059 · Product delete arm state does not persist across close-and-reopen of the edit form
- J-060 · Product delete cascades all entries the user logged for that product (multi-row same-day cascade)
- J-064 · `DELETE /products/:id` with malformed id returns 400 `invalid_id`
- J-065 · `DELETE /products/:id` with unknown id returns 404 `not_found`
- J-066 · Atwater warning appears when kcal disagrees with macros by > 5 % (per-100 form)
- J-067 · Edit-mode `PUT /products/:id` rejects kcal > 2000 cap; form stays open
- J-068 · `PUT /products/:id` with unknown id returns 404 `not_found`
- J-069 · `PUT /products/:id` with malformed id (zero, negative, non-numeric) returns 400 `invalid_id`
- J-074 · Cancel in product-edit form returns to GramsPicker without issuing a PUT
- J-086 · NewProductForm Save & Continue is disabled until name and all four macros are filled (and re-disables when any one is cleared)
- J-109 · Unit toggle to "ml" flips the macro-card label to "Per 100ml" and the saved product round-trips through `/products/all` with `unit: "ml"`
- J-110 · Brand entered in NewProductForm persists: case-preserved in the FoodRow ("· Atlas Farms") and uppercased in the AddPicker row ("ATLAS FARMS")
- J-111 · `POST /products` rejects out-of-range per-100 macros: kcal cap=2000 / floor=0 and protein/carbs/fat cap=200 / floor=0 each return 400 `invalid_product`
- J-112 · `POST /products` rejects each `isNewProductBody` structural branch (name empty/whitespace, name >200, brand >120, barcode >64, unit ∉ {g,ml}, per100 missing, is_temp missing, is_temp non-boolean) with 400 `invalid_product`
- J-155 · `POST /products` accepts kcal exactly 2000 (boundary; positive control for J-011 — pins `<=` vs `<`)
- J-156 · NewProductForm `Save & Continue` stays disabled when the name is whitespace-only (mutation guard for the `.trim()` call in `valid`)
- J-157 · XSS in `brand`: an `<img onerror>` brand string renders as literal text in FoodRow's `· {product.brand}` span (no dialog fires)
- J-158 · NewProductForm barcode field caps user typing at 64 characters via native `maxLength` (mutation guard for the attribute value)

- J-226 · Cancelling barcode scanning returns to a new product with its entire draft intact
- J-227 · Cancelling barcode scanning preserves a temporary product draft and its temporary status
- J-228 · Cancelling barcode scanning preserves an edited product draft and its GramsPicker return destination
- J-229 · Cancelling the AI file picker preserves temporary metadata and complete nutrition; incomplete nutrition returns as blank fields
- J-234 · Scan-result merging preserves typed metadata, temporary status and edit context while replacing only intended draft fields
- J-235 · Scanner snapshots keep complete nutrition and raw metadata, omit incomplete nutrition, and trim metadata only when submitting

# 5. Entry CRUD

- J-015 · Log an entry (pick product, enter grams, save)
- J-016 · Edit entry grams in place
- J-017 · Delete an entry
- J-062 · `DELETE /entries/:id` with malformed id (zero, negative, non-numeric) returns 400 `invalid_id`
- J-063 · `DELETE /entries/:id` with unknown id returns 404 `not_found`
- J-070 · `PATCH /entries/:id` with unknown id returns 404 `not_found`
- J-071 · `PATCH /entries/:id` with malformed id (zero, negative, non-numeric) returns 400 `invalid_id`
- J-072 · `PATCH /entries/:id` with empty body returns 400 `invalid_entry`
- J-073 · `PATCH /entries/:id` with grams ≤ 0 returns 400 `invalid_entry`
- J-079 · `POST /entries` with malformed body (each `isNewEntryBody` branch — bad product_id, grams, date, time) returns 400 `invalid_entry`
- J-080 · `POST /entries` with non-existent `product_id` returns 404 `product_not_found`
- J-081 · `POST /entries` enforces per-user isolation: user B logging against user A's private product returns 404 `product_not_found` and never inserts
- J-082 · `GET /entries` with malformed or missing `date` returns 400 `invalid_date`
- J-083 · `GET /entries/week` with malformed or missing `start` returns 400 `invalid_date`
- J-084 · `GET /entries/recent-grams` with malformed or missing `product_id` returns 400 `invalid_product_id`
- J-085 · GramsPicker pre-fills grams from the product's most recent log (recent-grams effect overrides the 100 default)
- J-087 · Default grams in add-mode GramsPicker is 100 for a brand-new product (no recent history → DEFAULT sticks)
- J-088 · `+` button in GramsPicker bumps grams by +10 and the live kcal projection scales linearly
- J-089 · `-` button in GramsPicker decreases grams by 10 and the live kcal projection scales linearly
- J-090 · `-` button in GramsPicker clamps grams at 1 (cannot go to 0 or below)
- J-091 · Quick-value pill tap in GramsPicker sets grams and updates the live macro projection
- J-092 · Recent-grams response replaces the DEFAULT `[50,100,150,200,250]` quick row after history loads
- J-093 · Add-mode GramsPicker shows the pencil (`Edit product`, escalation to product-edit) but hides the trash (`Delete entry` is edit-only)
- J-094 · Protein/carbs/fat GoalRow projections render with one-decimal formatting (not integer)
- J-168 · Future-day entries stay in insertion order: a pre-log remains above next-morning and later additions before and after reload

- J-231 · Reversed entry responses retain insertion order and totals across reload
- J-232 · Adding before a day loads does not overwrite its already loaded week total
- J-233 · A rejected entry edit leaves client entries and totals unchanged

# 6. Daily goals & macro auto-compute

- J-018 · Daily kcal goal persists and updates MacroSummary
- J-019 · `+` button increments protein without touching kcal (no cross-derive — Settings protein control)
- J-020 · `-` button clamps a macro at 0
- J-021 · Mismatch banner shows when kcal disagrees with macros by > 50; banner content quotes both derived total and typed kcal
- J-022 · Cancel does not persist Settings changes (kcal nor macros)
- J-134 · `+` button increments carbs without touching kcal
- J-135 · `+` button increments fat without touching kcal
- J-136 · Mismatch banner persists across a macro change; clears only when kcal is realigned
- J-137 · Mismatch banner boundary: gap of 50 stays clean, gap of 51 fires (`> 50`, not `>= 50`)
- J-138 · Kcal `+/-` buttons step by 50 (macros step by 5; mutation guard for the GoalField `step` parameter)
- J-139 · `PUT /settings` rejects invalid_goals across every `isGoalsBody` branch (missing field, non-int, negative, over MAX_KCAL=20000, over MAX_MACRO_GRAMS=2000)
- J-140 · Save persists all four goals (kcal/protein/carbs/fat); a hard reload + reopen reads each input back at its saved value
- J-141 · Settings Account section displays the signed-in user's email (rules out the `'you@example.com'` fallback in Settings Account section)
- J-167 · Goals saved on another device appear after reload through authoritative boot revalidation from `GET /settings`

- J-225 · Goal boot revalidation and saves update cached goals without repeating day/week reads

# 7. Multi-select & bulk operations

- J-023 · Long-press on a row enters selection mode
- J-024 · Tapping a second row adds it to the selection; SelectionBar sums kcal
- J-025 · Tapping an already-selected row deselects it
- J-026 · Clear-selection button exits selection mode
- J-027 · Multi-delete removes all selected rows
- J-028 · Multi-tag flips all to tagged when any row is untagged ("every, not some")
- J-029 · Multi-untag flips all to untagged when every selected row is already tagged
- J-030 · Switching day clears the selection
- J-057 · Multi-delete leaves unselected rows untouched (delete 2 of 3, third row survives)
- J-061 · SelectionBar delete button aria-label scales with the count ("Delete 3 selected")
- J-128 · Multi-tag with all rows untagged tags both (degenerate happy-path complement to J-028's mixed-state pin)
- J-129 · Long-press on an already-selected row deselects it (input symmetry — `toggleSelect` runs whether triggered by tap or by `onContextMenu`)
- J-130 · Dot tap in selection mode toggles `tagged`, not `select` (the dot button bypasses `selectionMode` logic; tagging stays operational while a row is selected)
- J-131 · Long-press on the dot does NOT enter selection mode (`onContextMenu` is wired only on the main body button — sibling dispatches don't bubble to the body's handler)
- J-132 · Tap in selection mode adds to selection only — `onEdit` does not fire and GramsPicker does not mount (negative-path of the `if (selectionMode)` branch in `FoodRow` click handler)
- J-133 · Multi-tag mixed state issues exactly one PATCH (already-tagged entry skipped per `App.onMarkTagged` skip-when-equal guard); pinned via a `page.on('request')` counter

# 7a. Named entry groups

- J-169 · Two selected entries become one collapsed, persistent parent with the same default background as a loose row; parent macros aggregate children while daily totals remain unchanged
- J-170 · Group action requires two eligible entries; blank names stay disabled and cancelling the naming Sheet preserves selection
- J-171 · Failed group creation retains the Sheet, typed name, and selection so the request can be retried
- J-172 · Parent eaten control exposes mixed state and tags/untags every child through one atomic group PATCH
- J-173 · Rename normalizes group whitespace; Ungroup preserves and restores every child entry
- J-174 · Long-pressing a collapsed parent selects its real children and a selection-mode tap deselects them without expanding
- J-175 · Deleting one child from a two-entry group automatically unfolds the remaining child, including after reload
- J-176 · Group creation rejects malformed, duplicate, mixed-date, missing, foreign, and already-grouped memberships without partial writes; group mutations are owner-scoped
- J-177 · Product deletion cleans up a group that would otherwise be left with one child
- J-178 · Enter submits the group-name field and creates the folded parent
- J-179 · Backdrop dismissal creates no group and preserves the underlying entry selection
- J-180 · Editing a grouped child’s grams updates the parent aggregate while retaining persisted membership

# 8. Tagging single entries

- J-031 · Dot toggle flips `aria-pressed` both ways
- J-032 · Tagged state persists across reload (proves the PATCH lands server-side, not just optimistic UI)
- J-033 · Dot `aria-label` flips between "Mark as eaten" and "Mark as not eaten"
- J-149 · `PATCH /entries/:id` rejects non-boolean `tagged` (`'true'` / `1` / `null`) with 400 `invalid_entry`
- J-150 · `PATCH /entries/:id` from another user returns 404 `not_found` and never flips the owner's flag (per-user isolation)
- J-151 · Dot tap does not change MacroSummary kcal totals (`tagged` is purely a UI marker; macros come from grams × per100)
- J-152 · Tagged flag survives a grams edit (grams-only PATCH must not clear `tagged`)
- J-153 · Two rows tag/untag independently (per-row state isolation; no shared mutation)
- J-154 · Dot tap issues exactly one PATCH per toggle (network counter; `App.onMarkTagged` skip-when-equal guard)

# 9. Cross-user catalog (barcode adopt)

- J-034 · Barcoded product auto-adopts on tap from global search
- J-035 · Adopt is idempotent on `(created_by, barcode)` (201 then 200)
- J-036 · Non-barcoded products never appear in another user's global search
- J-048 · `POST /products/adopt/:id` rejects a non-barcoded source row with 400 `not_adoptable`
- J-049 · `POST /products/adopt/:id` rejects an unknown id with 404 `not_found`
- J-050 · `POST /products/adopt/:id` rejects a malformed id (zero, negative, non-numeric) with 400 `invalid_id`
- J-051 · Self-adopt fast path: caller adopting their own barcoded row returns the same id with status 200, no duplicate insert

# 10. AddPicker search & scope

- J-118 · Clear-X (`aria-label="Clear"`) is hidden when query is empty; tapping it clears the input and restores the idle Recent/All view
- J-119 · Default scope is "My Library" (no `?global=1` on `/products/search`); tapping "Global" re-queries with `?global=1`
- J-120 · "My Library" scope hides barcoded cross-user rows; toggling to "Global" surfaces them
- J-121 · Search section header pluralizes "1 result" / "2 results" based on the result count
- J-122 · Idle list dedup: a logged product appears under "Recent" only, never under "All"
- J-123 · `/products/search` matches against `brand` LIKE pattern, not just `name`
- J-124 · `addedProductIds` CheckIcon also renders next to today-logged products in the search-results section (parity with idle Recent)
- J-125 · `GET /products/search` short-circuits an empty / whitespace-only `q` to `[]`, regardless of the `global` flag
- J-126 · `GET /products/search` `global` flag is strict-equality `'1'`: any other value (`true`, `0`, missing) keeps default My Library scope
- J-127 · `GET /products/search?global=1` blended results sort the caller's own row before another user's (`is_mine DESC`)

# 11. Sheet gestures

- J-037 · Drag sheet down past 80 px dismisses it
- J-038 · Drag sheet down under 80 px snaps back; sheet stays open
- J-039 · Drag starting on an input is ignored; sheet stays open
- J-046 · Swipe-down on a stacked sheet (NewProductForm over AddPicker) clears the whole stack to none
- J-142 · Backdrop tap dismisses the sheet (`registerClose` is wired to `requestDismiss`, not `requestClose`)
- J-143 · Cancel button on stacked NewProductForm back-navs to AddPicker (`onClose` route — distinct from gesture/backdrop dismiss)
- J-144 · Backdrop tap on a stacked sheet clears the whole stack to none (`onDismiss` route — counterpart to J-046's drag, ruling out the back-nav outcome)
- J-145 · Drag exactly 80 px dismisses (`>=` boundary; mutation guard for `>` vs `>=`)
- J-146 · Drag exactly 79 px snaps back (symmetric pin for the threshold)
- J-147 · Upward drag is a no-op; sheet stays open and a follow-up downward dismiss still works (gesture state not stranded)
- J-148 · Re-opening a sheet after a dismiss-drag works on the second mount (no stale `exitingRef`; gesture hooks rebind cleanly)

# 12. WeekStrip gestures

- J-040 · Swipe left past 50 px commits to the next week
- J-041 · Swipe shorter than 50 px snaps back to the same week
- J-042 · Next-arrow button advances the week
- J-159 · Swipe right past 50 px commits to the previous week (`dx < 0 ? 1 : -1` direction map)
- J-160 · Prev-arrow button retreats one week (mirror of J-042)
- J-161 · Swipe exactly 50 px commits (`>=` boundary; mutation guard for `>` vs `>=`)
- J-162 · Swipe exactly 49 px snaps back (symmetric pin: J-161 + J-162 bracket the threshold to a single integer)
- J-163 · Vertical drag is a no-op (axis lock to `'y'` on first move; gesture state isn't stranded — a follow-up horizontal swipe still commits)
- J-164 · Tapping a day pill selects that date and applies the `selected` class without shifting `weekStart` (caption stays the same)
- J-165 · Caption ends with a zero-padded `· W##` (`padStart(2, '0')` shape; positive control across all three `monthLabel` branches)
- J-166 · A second swipe initiated during the 300 ms snap animation is suppressed by `animatingRef` (only one commit fires; PREV arrow returns to the original caption in exactly one tap)

# 13. Keyboard `Enter` semantics

- J-043 · Enter on GramsPicker add-mode input logs the entry
- J-044 · Enter on GramsPicker edit-mode input saves the change
- J-045 · Enter on AddPicker search only blurs (no submit; no implicit create / pick)
- J-095 · Enter on empty GramsPicker input is a no-op (sheet stays open; no entry mutated; input remains alive)
- J-096 · Enter on invalid email is a no-op (still on email step; submit button stays disabled; no `/auth/request-code` request)

# 14. Modal-hijack guard (flowGenRef race)

- J-047 · `onProductSave`: dismiss while `POST /products` is in-flight does NOT pop GramsPicker after the response lands
- J-113 · `onProductSave`: without dismissal, GramsPicker DOES open after a slow `POST /products` resolves (positive control for J-047 — pins the comparator direction)
- J-114 · `onProductSave`: dismiss mid-save followed by a server 500 suppresses the error toast (catch-branch `flowGenRef` gate)
- J-115 · `onPick`: dismiss while `POST /products/adopt/:id` is in-flight does NOT pop GramsPicker after the response lands
- J-116 · `onPick`: dismiss mid-adopt followed by a server 500 suppresses the error toast (catch-branch `flowGenRef` gate)
- J-117 · `onProductSave`: without dismissal, a server 500 DOES surface the error toast and leaves the form mounted for retry (positive control for J-114 — pins the catch-branch comparator)

- J-230 · A replacement error receives its full notification lifetime

# 15. Weight tracking

- J-181 · The bottom-dock Weights button opens an empty, usable weight-history Sheet
- J-182 · Adding a decimal weigh-in defaults to today and Peed only; its checkbox summary and full safe multiline note persist without a time
- J-183 · Future and note-free weigh-ins sort newest-first; Add opens today's existing record and restores its checkbox choices
- J-184 · Editing date, weight, checkbox choices, and note updates one record, reorders history, and persists after reload
- J-185 · One-tap weigh-in deletion removes only the chosen record and persists after reload
- J-186 · Weight form accepts inclusive numeric bounds, rejects excess precision and raw notes over 500 characters, and prevents blank writes; Cancel resets drafts and failed saves retain every field for retry
- J-187 · Weight API accepts inclusive numeric bounds and trimmed notes up to 500 characters, rejects invalid POST/PUT bodies atomically and date collisions, and isolates every user's records
- J-215 · Touch checkboxes toggle independently, persist all four combinations in history and edits, reset for new dates, and discard cancelled edits
- J-216 · Weight API supplies omitted checkbox defaults, preserves omitted flags on edits, and rejects non-boolean values without partial writes
- J-217 · Weight checkbox migration backfills every owner with Peed true and Pooped false, preserves legacy records and notes, and enforces defaults and constraints

# 16. MCP and OAuth

- J-188 · MCP discovers six account-scoped read-only tools with output schemas, requires boolean weigh-in flags, and rejects user discovery
- J-189 · Food reads and summaries isolate connected accounts and match app totals across groups, year boundaries, product edits, and current goals
- J-190 · Weigh-in tools match REST checkbox combinations and edits, preserve notes, and support inclusive date filters and newest-first pagination
- J-191 · MCP validates dates and pagination, preserves text-only errors, rejects user selection and arbitrary queries, and never changes stored records
- J-192 · MCP requires OAuth tokens, rejects app sessions and browser origins, and advertises discovery when unauthenticated
- J-193 · Missing or blank public origins disable MCP; unsafe configured origins prevent startup
- J-194 · OAuth discovery and DCR connect public/confidential clients through email login, escape client names, and separate app/connector tokens
- J-195 · Consent binds the browser, protects decisions, supports denial, and preserves login context after session expiry
- J-196 · OAuth rejects unsafe client metadata, mismatched PKCE/callbacks/resources, and expired or reused codes
- J-197 · OAuth rotates refresh tokens, revokes replayed grants, enforces client-bound revocation, and rejects expired credentials
- J-198 · OAuth registrations, hashed credentials, and write scopes survive backend restart and allow continued refresh
- J-199 · Meal reads include every date in an inclusive range, preserve empty days, and support single-day, leap-day, and 31-day ranges
- J-200 · Summaries distinguish missing days from zero-calorie logged days, average over logged days, and exclude impossible stored dates
- J-201 · Summaries compare first and last in-range weigh-ins, include measurement dates, and handle empty, single-point, rising, falling, and unchanged weights
- J-202 · Summaries support calendar boundaries and 366-day periods without truncating weight history to a page
- J-203 · MCP product search matches owned saved foods by name and brand, preserves nutrition and units, and excludes temporary and cross-user products
- J-204 · MCP product search caps broad queries at 50 alphabetically ordered results and supports narrowing the query
- J-205 · MCP write scopes advertise mutation schemas and deny writes to read-only tokens
- J-206 · MCP product creates and partial edits match REST and recalculate logged nutrition
- J-207 · MCP entry create/update/delete matches REST and preserves or dissolves groups
- J-208 · MCP writes reject foreign and missing products and entries without mutation
- J-209 · MCP write validation rejects malformed and unsupported inputs without mutation
- J-210 · MCP product deletion cascades through owned history and cleans groups while preserving adopted copies
- J-211 · OAuth advertises both scopes and requires explicit read and write consent
- J-212 · OAuth reconnects legacy clients for write without upgrading old or omitted-scope grants
- J-213 · OAuth refresh preserves or narrows scope without restoring write permissions
- J-214 · OAuth scope migration preserves legacy requests grants and tokens as read-only
- J-218 · MCP group tools declare write schemas and read-only tokens cannot mutate groups
- J-219 · MCP group creation, renaming, tagging, and ungrouping preserve child fields and totals and appear after UI reload
- J-220 · MCP groups reject invalid membership, impossible legacy dates, unsupported edits, and invalid output without partial changes
- J-221 · MCP group operations reject missing and foreign resources and isolate connected accounts
- J-222 · MCP groups support existing temporary children and individual edits, dissolve below two members, and delete whole groups while preserving products
- J-223 · MCP and REST enforce the UI amount minimum, allow fractional amounts above it, and preserve legacy reads and tag-only edits
- J-224 · MCP blocks temporary-food reuse while preserving UI temporary-food creation and existing temporary log edits and deletion

# Verification

Run from the repo root:

```bash
# 1. No duplicate IDs in this catalog.
grep -oP '^- J-\d+' tests/JOURNEYS.md | sort | uniq -d

# 2. Spot-check that a J-ID resolves to a test in the suite (the [J-XXX]
# prefix on every test name is the implicit back-link):
grep -RF "[J-035]" tests/e2e/

# 3. Bidirectional back-link (load-bearing): every J-### in the doc has a
# matching test, and every J-### used in tests has a catalog entry.
diff \
  <(grep -oP '\bJ-\d+\b' tests/JOURNEYS.md | sort -u) \
  <(grep -oRhP '\bJ-\d+\b' tests/e2e/ | sort -u)
```
