#!/usr/bin/env bash
# review-e2e.sh — Iterates through every Playwright e2e spec (existing AND
# planned-but-missing) with a fresh Claude context each time, autonomously
# building and maintaining tests/JOURNEYS.md, strengthening existing tests,
# and CREATING new spec files for uncovered journeys. State is held in
# /tmp/kcal-e2e-review/ so each invocation picks up where the last left off.
#
# Usage:
#   ./scripts/review-e2e.sh              # run continuously until all specs reviewed
#   ./scripts/review-e2e.sh --reset      # wipe state and start over

set -euo pipefail

STATE_DIR="/tmp/kcal-e2e-review"

if [[ "${1:-}" == "--reset" ]]; then
  rm -rf "$STATE_DIR"
  echo "State cleared. Run again without --reset to start fresh."
  exit 0
fi

PROMPT='You are auditing AND extending the Playwright e2e suite for the kcal project, ONE spec file per invocation. You are the autonomous owner of `tests/JOURNEYS.md` and the entire `tests/e2e/` directory (excluding the four infrastructure files listed below) — you write, edit, curate, AND CREATE NEW SPEC FILES whenever the source code reveals a journey with no e2e coverage. The hand-maintained `tests/STORIES.md` has been retired; if it still exists in the working tree, delete it during INIT.

**Tone — be harsh.** Favor more tests over fewer. When you find an uncovered branch, error path, gesture threshold, validation cap, or edge case, ADD A TEST FOR IT — do not log it under MISSING and walk away. MISSING is the last resort for gaps you genuinely cannot close in this pass (needs camera, needs clock hatch, needs infrastructure not yet wired). Every other gap gets a test.

You operate as a state machine using files in /tmp/kcal-e2e-review/.

## Your state files

- `/tmp/kcal-e2e-review/manifest.txt` — ordered list of all spec files (one per line; may include planned-but-missing files)
- `/tmp/kcal-e2e-review/current.txt` — 0-based index of the spec to handle THIS run
- `/tmp/kcal-e2e-review/log.txt` — append-only log of what you did each run

## Phase logic

### If manifest.txt does NOT exist → INIT phase

This is gap-discovery, not just file enumeration. The manifest you produce drives every subsequent pass.

1. **Read broadly** to discover every distinct user-visible journey:
   - All source files under `src/components/`, `src/hooks/`, `src/`, and `server/routes/`.
   - The Testing section of `CLAUDE.md` (kcal-specific gotchas, "Coverage" callouts, deferred items).
   - The existing `tests/JOURNEYS.md` if present.
   - Every existing `*.spec.ts` under `tests/e2e/` to inventory current coverage.
2. **List every existing `*.spec.ts`** under `tests/e2e/`, EXCLUDING `auth.setup.ts`, `auth.setup2.ts`, `global-setup.ts`, and `helpers.ts`.
3. **Identify uncovered feature areas**: every gesture threshold, validation rule, error response, race condition, edge case, or user behavior in the source that no existing spec asserts. Concrete signals: `Coverage gaps` / `Deferred` callouts in CLAUDE.md, source files with rich UX behavior and no matching spec name, error paths with no corresponding spec, components without any spec exercising them.
4. **For each uncovered area, mint a planned spec path** like `tests/e2e/<feature>.spec.ts` — lowercase, single concept, no underscores, no hyphens, follow the naming pattern of existing specs (`adopt`, `auth`, `edit`, `empty`, `entry`, `keyboard`, `product`, `race`, `selection`, `settings`, `sheet`, `tagging`, `validation`, `weekstrip`). Do NOT split a tightly-coupled journey into a new spec when an existing spec already covers the surrounding area — extend the existing one in REVIEW mode instead.
5. **Write the COMBINED list** (existing-on-disk + planned-but-missing, absolute paths, one per line, sorted) to `manifest.txt`. Whether each path exists on disk is resolved per-pass.
6. Write `0` to `current.txt`.
7. Write a header line to `log.txt`: `--- e2e review started <date> — <N total = E existing + P planned> ---`.
8. If `tests/STORIES.md` exists, delete it and append to log.txt: `INIT — removed obsolete tests/STORIES.md`.
9. If `tests/JOURNEYS.md` does NOT exist, create it with: an HTML comment banner reading `<!-- AUTOMATED FILE — managed by scripts/review-e2e.sh. Do not hand-edit. -->`, a level-1 heading `# User journeys`, and a one-paragraph description noting that this file is the source-of-truth catalog of user flows covered by `tests/e2e/`, that every `test()` / `setup()` block in the suite is prefixed with `[J-###]` to back-link to an entry below, that to find which spec verifies a flow you grep `tests/e2e/` for the ID, and that IDs are stable and never reused.
10. Print `INIT complete: <E> existing + <P> planned = <N> specs in manifest`. Print the planned-but-missing paths so the user can sanity-check the gap analysis. Stop. Do NOT handle a spec yet.

### If manifest.txt exists AND current.txt < total spec count → REVIEW phase

1. Read `current.txt` to get the index. Read that line from `manifest.txt` to get the spec path.
2. **Determine mode**: does the spec path exist on disk?
   - YES → `REVIEW MODE`: existing spec to audit and strengthen.
   - NO → `CREATE MODE`: planned spec to author from scratch.
3. Print a clear header: `=== [<index+1>/<total>] <Reviewing|Creating>: <relative path> ===`.
4. **Read context**:
   - `tests/JOURNEYS.md` (your running catalog).
   - The Testing section of `CLAUDE.md` (kcal-specific gotchas).
   - Source files in `src/components/`, `src/hooks/`, `server/routes/` that this spec exercises. REVIEW MODE: infer from existing imports, button labels, URL paths, role queries. CREATE MODE: infer from the planned filename and the gap that put it on the manifest, plus any related source.
   - `tests/e2e/helpers.ts` (read-only — you may invoke its exports but not modify it).
   - 1-2 existing specs as style references (`entry.spec.ts` for AddPicker → NewProductForm → GramsPicker flow; `sheet.spec.ts` for gesture patterns; `auth.spec.ts` for sign-in flows; pick whichever is closest to the spec under work).
   - REVIEW MODE only: the spec file itself.
5. **CREATE MODE branch** (skip if REVIEW MODE):
   a. Identify every journey this new spec should own. Use the filename, the gap analysis from INIT, and the source code to enumerate them. Aim high: a new spec typically covers 4-8 journeys (happy + negative + edge cases for the same feature area). Examples of journey clusters per spec name: `onboarding` covers first-time user, first product, first log; `barcode` covers scan-found, scan-not-found, scan-malformed, scan-cancel; `logout` covers 401-auto-logout, login-code-expiry, session-revocation.
   b. For each journey, mint a fresh `[J-###]` ID — next free across `JOURNEYS.md` AND every `tests/e2e/*.spec.ts`. Track your own minted IDs within this pass to avoid collisions. Add a one-line description to `JOURNEYS.md` under the appropriate section heading.
   c. **Author the spec file**. Use the existing specs as style references — same imports (`import { expect, test } from "@playwright/test"`, helper imports from `./helpers`), same `tap()` / `fill()` patterns, same comment density (terse but explanatory where the gotcha is non-obvious). Every test starts `test("[J-###] <plain-language summary>", async ({ page }) => { ... })`.
   d. Each test MUST satisfy every relevant criterion in the "Review criteria" section below — falsifiability, mutation resistance, negative-path assertions, no `waitForTimeout`, `tap()` for Sheet-internals, `exact: true` on aria-label assertions, unique `E2E ` product names per test.
   e. Run `npx playwright test <new-spec>`. Iterate until all tests pass, OR until you have made 3 attempts at the same failure. After 3 attempts, categorize per step 8.
   f. Skip step 6 (curate) — your fresh entries from step 5b are the curation for this pass.

6. **REVIEW MODE branch — Curate `tests/JOURNEYS.md`** (skip if CREATE MODE). This is your job, not the user job:
   - For every `test()` / `setup()` / `test.describe()` block in the spec, ensure the accessible name starts with `[J-###]`. If yes, validate the ID exists in `JOURNEYS.md` and the description matches actual behavior. If no, decide: does the test cover an existing catalog entry? If yes, edit the spec to use that ID. If not, mint the next free `J-###` (highest existing ID across the entire `JOURNEYS.md` plus 1, zero-padded to three digits), add a one-line description to `JOURNEYS.md` under the appropriate section heading, and edit the spec to add the prefix.
   - If you encounter a duplicate `[J-###]` across two unrelated tests, the second one needs a fresh ID — assign it.
   - Group entries in `JOURNEYS.md` by feature area (Authentication & sessions, Empty states, Product creation & editing, Entry CRUD, Daily goals & macro auto-compute, Multi-select & bulk operations, Tagging single entries, Cross-user catalog, Sheet gestures, WeekStrip gestures, Keyboard `Enter` semantics — add new sections as needed). Do NOT keep a separate "TODO journeys" section; uncovered gaps go into the log under `MISSING`, not the catalog. The catalog is exclusively for journeys with at least one passing assertion in the suite.
   - If a journey description in the catalog has drifted from actual test behavior, update the description to match what the test now proves. Never leave the catalog stale.

7. **Apply the review criteria below** to the spec (whether you authored it in CREATE MODE or audited it in REVIEW MODE). Bias toward extending the spec with new tests for adjacent uncovered behavior in the same feature area — do not stop the moment the file is "minimally OK".

8. **Run and verify.** Run `npx playwright test <spec-file>` to confirm. If everything passes, you are done — log normally and advance. If a test fails, categorize:
   - **App bug** → log as `BUG_FOUND`. The test correctly encodes the journey (per CLAUDE.md, the journey description, or a clear UX invariant) and the app violates it. Keep the failing test. The log line MUST cite (a) the journey or invariant being violated, and (b) the source `file:line` that disagrees.
   - **Broken test** → log as `BROKEN_TEST`. The test is wrong (bad selector, race in the harness, wrong helper invocation, stale snapshot). Try to fix it (up to 3 attempts). If you still cannot, revert your changes to that spec and log `BROKEN_TEST`. In CREATE MODE, if you cannot get a fresh test passing in 3 attempts, mark it as broken and keep going on the rest of the spec — do not delete the file.
   - When in doubt: would the app pass this test if it were rewritten from scratch following the journey? Yes → `BUG_FOUND`. No → `BROKEN_TEST`.
   - NEVER loosen an assertion to match buggy behavior.

9. Append a summary line to `log.txt`: `[<index+1>/<total>] <path> — <PASS|FIXED|ADDED|CREATED|REMOVED|MISSING|BUG_FOUND|BROKEN_TEST> — <one-line summary>`
   - PASS: tests are well-anchored to journeys, mutation-resistant, and the journey set for this spec is complete — no changes needed (REVIEW MODE only — CREATE MODE always produces CREATED or BUG_FOUND/BROKEN_TEST)
   - FIXED: existing tests strengthened (tighter assertions, mutation-resistant), or `JOURNEYS.md` updated, or J-IDs threaded through
   - ADDED: new tests added to an EXISTING spec for previously-uncovered journeys (REVIEW MODE)
   - CREATED: new spec file authored from scratch in CREATE MODE; list every minted J-ID in the summary
   - REMOVED: redundant or vanity tests removed (e2e is expensive — only remove if the journey is truly dead, the assertion is empty, or another spec already covers the same flow)
   - MISSING: real coverage gaps not filled this pass — list each gap explicitly (uncovered journey from CLAUDE.md, untested error path, missing negative assertion, helper drift, gotcha with no test). Reserve this for gaps you genuinely could not close (camera, clock hatch).
   - BUG_FOUND: per step 8
   - BROKEN_TEST: per step 8

10. Increment the index in `current.txt`.
11. Print a short summary of what you found, did, and minted.

### If current.txt >= total spec count → DONE phase
1. Print `All <N> e2e spec files have been handled.`
2. Print a summary from `log.txt` showing counts of PASS / FIXED / ADDED / CREATED / REMOVED / MISSING / BUG_FOUND / BROKEN_TEST.
3. Do NOT modify `current.txt` further.

## Review criteria — apply these strictly to BOTH new tests you write and existing tests you audit

**Source of truth — journey over implementation.** Tests must encode what the app is supposed to do (the user-visible journey), not what it currently does. The journey, in order of precedence, is: explicit assertions in `CLAUDE.md`, the journey description in `JOURNEYS.md`, the test name itself, and clear UX invariants (a 401 should sign the user out; a sheet drag past 80px should dismiss it; a kcal cap of 2000 should reject 2001 with the form still open; barcoded products are shared across users, non-barcoded are private). Never read the app source, observe what it does, and write a test asserting that exact behavior — that produces change-detector tests that bake bugs into the suite. The first question for every test is: "what is this user supposed to be able to do?", NOT "what does the app currently do?".

For each spec file (whether created or reviewed), check:

1. **Every test has a `[J-###]` prefix.** No exceptions. The ID must exist as a unique entry in `tests/JOURNEYS.md` with a one-line description that matches the test behavior. The accessible name format is `[J-###] <plain-language summary>` — both halves must be present.

2. **`tap()`, not `click()`, for buttons inside `Sheet` modals** (`AddPicker`, `NewProductForm`, `GramsPicker`, `Settings`). Per the Testing section of CLAUDE.md, `click()` silently drops events on the Pixel 7 mobile profile. `Login` is the only Sheet-free flow where `click()` is acceptable. `page.fill()` works fine in either context.

3. **No `waitForTimeout` or arbitrary sleeps.** Every wait must anchor on a locator state, a heading visibility, a `toHaveCount`, or a `page.waitForResponse`. Time-based waits are the #1 source of flake. The drag/swipe helpers in `Sheet`/`WeekStrip` synthesize pointer events via `page.mouse` — those are an acceptable exception because they have no asynchronous boundary to wait on.

4. **Selector quality.** Prefer `getByRole`, `getByPlaceholder`, scoped `.locator(".sheet").filter(...)`. The only sanctioned class anchors are `.food-row` and `.sheet`. Reject raw class selectors like `.btn-primary`, `#kcal-input`, or `nth-child(...)`. Positional `getByRole(...).nth(N)` is acceptable when CLAUDE.md documents it (Settings macro fields).

5. **`exact: true` on `getByRole({ name })` for aria-label assertions.** Substring matching collides with FoodRow accessible names. Default to `exact: true` for any aria-label-driven role lookup.

6. **Per-test product names are unique within the spec file** AND prefixed `E2E ` for grep-ability. Cross-spec collisions are mitigated by including a per-spec mnemonic (`E2E Sel A`, `E2E Tag Toggle`).

7. **Helpers usage (DRY).** Use `seedProductAndLog`, `fillNutField`, `longPress` from `tests/e2e/helpers.ts` instead of re-implementing them inline. If a new repeated pattern appears in three or more specs, log it under MISSING (helper extraction is a separate dedicated pass — do not modify `helpers.ts` from this pass).

8. **Assertion strength.** Prefer `toHaveCount(n)`, `toHaveText`, `toContainText("600")` (the computed value `grams × per100 / 100`) over `toBeVisible()` alone. Replace `toBeTruthy` with the most specific equality the assertion can express.

9. **Mutation resistance.** For each test, consider three mutations to the underlying source: (a) flip a comparator (`>` → `>=`, `===` → `!==`), (b) off-by-one a constant (Sheet drag threshold 80, WeekStrip commit threshold 50, kcal cap 2000, login attempt cap 5), (c) swap `&&`/`||` or negate a condition. If the assertions would still pass under any of these, strengthen them.

10. **Negative-path assertions are mandatory for negative journeys.** Every journey with a "rejects/clamps/locks/blocks/ignores" verb (J-004 attempt-cap lockout, J-011 kcal cap rejection, J-020 clamp-at-zero, J-039 input drag ignored, J-045 no submit on Enter) MUST also assert that the side effect did NOT happen — the form stays open, the row count is unchanged, the sheet is still mounted, the input value did not advance, the URL did not change.

11. **No external-service mocks.** kcal e2e runs against the real prod build with `TEST_MODE=true` (per `playwright.config.ts:33-51`). The only sanctioned test hatch is `GET /auth/test/last-code/:email`. If a spec stubs Postmark, Claude SDK, or the database, that is a regression — call it out.

12. **Per-spec isolation when needed.** Specs that need a fresh user (sign-out, empty state, first-time onboarding) MUST override `storageState` with `test.use({ storageState: { cookies: [], origins: [] } })` and sign in a per-test unique email like `*-${Date.now()}@test.local`.

13. **Coverage of CLAUDE.md gotchas.** Every IMPORTANT / MUST / Do-NOT in the Testing section of CLAUDE.md is an implicit test contract. Examples that MUST appear somewhere in the suite: `tap()` vs `click()` discipline (covered structurally — every Sheet-internal interaction is tap); Sheet drag thresholds 80/6 (J-037/J-038/J-039); WeekStrip swipe thresholds 50/8 (J-040/J-041/J-042); barcode adopt idempotency (J-035); cross-user catalog privacy "barcode = shared, no barcode = private" (J-036); long-press via `onContextMenu` (J-023); kcal computed-from-grams retroactive update (J-013); macro auto-recompute on `+`/`-` (J-019/J-020); kcal-vs-macros mismatch warning over 50 (J-021). If a CLAUDE.md gotcha has no journey, ADD a test for it (or log MISSING with a quote of the gotcha if camera/clock/infrastructure-blocked).

14. **Setup-file integrity (read-only check).** While handling a regular spec, if you notice `auth.setup.ts` / `auth.setup2.ts` / `global-setup.ts` / `helpers.ts` are referenced incorrectly, or a helper signature has drifted, log under MISSING. Do NOT modify those files from a regular pass.

15. **Falsifiable on add.** Every test you add must assert something that would FAIL if the underlying logic had a bug. Before committing a new assertion, ask: "what mistake in `App.tsx` / `useEntries.ts` / the matching server route would make this test go red?" If you cannot answer concretely, do not add the test.

16. **Negative space — every journey for the spec is covered.** Before marking PASS or CREATED, list every journey ID that this spec covers. Cross-reference with CLAUDE.md and the source files: are there obvious user behaviors with no journey on this spec? If yes, ADD a test (default action) — only log MISSING if the gap requires infrastructure you cannot stand up. "Tested transitively by another spec" is acceptable only if the other spec actually has a passing assertion for that journey — verify, do not assume.

## Important rules

- Modify only: spec files (`*.spec.ts`, INCLUDING creating new ones in `tests/e2e/`) and `tests/JOURNEYS.md`. NEVER modify source under `src/`, `server/`, `shared/`, or `public/`.
- NEVER modify `tests/e2e/helpers.ts`, `tests/e2e/auth.setup.ts`, `tests/e2e/auth.setup2.ts`, or `tests/e2e/global-setup.ts` from a regular pass — those are infrastructure. Log issues under MISSING instead.
- When creating a new spec, follow the existing style closely (imports, helper invocations, `tap()` / `fill()` patterns, locator scoping, comment density). Read `entry.spec.ts` and one feature-adjacent spec before writing.
- Run only the spec under work with `npx playwright test <spec-file>` after changes — not the full suite. The runner boots a real prod build, so each pass takes 30s–2min. If a previous server is already on `:3001`, Playwright reuses it.
- A passing test is the default outcome, but a failing test that correctly encodes a journey is also a valid result — see step 8 in the REVIEW phase. Never weaken an assertion to match buggy behavior; classify as `BUG_FOUND` and keep it.
- Be brutal: "passing" and "adequate" are not the bar. If tests pass but would survive obvious mutations, skip negative-path assertions, leave a journey untracked, or have an aria-label substring collision, the spec is NOT ready for PASS — strengthen it.
- **Bias toward writing the test, not logging MISSING.** When you observe an uncovered gesture threshold, validation cap, error response, or edge case in the source, your default action is to ADD a test. MISSING is reserved for gaps you cannot close in this pass (camera, clock hatch, missing infrastructure). Every other gap gets a test.
- If a test is genuinely useless (vanity, change-detector, assertion-free, duplicate of another spec), remove it AND remove its catalog entry. Note both in the log.
- Keep printed output concise — `log.txt` is the detailed record.'

# Stall detection: if claude exits 0 without advancing current.txt, we assume it
# soft-failed (misinterpreted prompt, quota stall). Abort after 3 consecutive
# stalls instead of burning API credits in a tight loop.
STALL_COUNT=0
MAX_STALLS=3
PREVIOUS_CURRENT=""

while true; do
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Starting Claude e2e review pass — $(date '+%H:%M:%S')"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""

  # Explicit status check so set -e does not silently kill the loop on non-zero exits.
  if ! claude --print --dangerously-skip-permissions "$PROMPT"; then
    status=$?
    echo "claude exited non-zero ($status). Sleeping 5s before retrying."
    sleep 5
    continue
  fi

  # Check if we are done. awk counts lines correctly regardless of trailing newline;
  # regex guards against non-numeric junk an LLM might write to current.txt.
  if [[ -f "$STATE_DIR/manifest.txt" && -f "$STATE_DIR/current.txt" ]]; then
    total=$(awk 'END{print NR}' "$STATE_DIR/manifest.txt")
    current=$(cat "$STATE_DIR/current.txt")
    if [[ ! "$current" =~ ^[0-9]+$ ]]; then
      echo "Corrupt state: current.txt is non-numeric: $(printf %q "$current")" >&2
      exit 1
    fi
    if [[ ! "$total" =~ ^[0-9]+$ ]]; then
      echo "Corrupt state: manifest line count is non-numeric: $total" >&2
      exit 1
    fi
    if (( current >= total )); then
      echo ""
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      echo "  All $total e2e specs handled. See log:"
      echo "  $STATE_DIR/log.txt"
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      exit 0
    fi

    if [[ "$current" == "$PREVIOUS_CURRENT" ]]; then
      STALL_COUNT=$((STALL_COUNT + 1))
      echo "WARN: current.txt did not advance (stall $STALL_COUNT/$MAX_STALLS) — index still $current"
      if (( STALL_COUNT >= MAX_STALLS )); then
        echo "" >&2
        echo "ERROR: aborting after $MAX_STALLS consecutive stalls. Inspect state at $STATE_DIR" >&2
        exit 1
      fi
    else
      STALL_COUNT=0
    fi
    PREVIOUS_CURRENT="$current"
  fi

  sleep 5
done
