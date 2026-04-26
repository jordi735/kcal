# User journeys

Source-of-truth list of user flows covered (or queued as TODO) by the Playwright e2e suite under `tests/e2e/`. Each bullet is one flow. The `[J-###]` prefix on every `test()` / `setup()` name in the suite is the back-link — to find which spec(s) verify a flow, run `grep -RF '[J-019]' tests/e2e/`. IDs are stable (never reuse one); when adding a flow, write the next free `J-###` yourself. Promote a `J-T###` to a `J-###` once its spec lands. The bidirectional grep in `## Verification` is the safety net that proves every doc ID has a matching test and vice versa.

# 1. Authentication & sessions

- J-001 · Sign in via emailed 6-digit code
- J-002 · Sign out clears the server session and returns to Login
- J-003 · Wrong code shows error and keeps user on the code step
- J-004 · Five wrong codes lock the input and reset to the email step
- J-005 · Requesting a new code invalidates the previous one
- J-006 · Unknown email reaches the code screen (no enumeration leak)
- J-007 · Malformed email disables the "Send sign-in code" button

# 2. Empty states

- J-008 · Home for a brand-new user shows "No food logged"
- J-009 · AddPicker search with no matches shows the empty-results block

# 3. Product creation & editing

- J-010 · Create a new product via AddPicker, save & continue, log to day
- J-011 · Server rejects product with kcal > 2000 cap; form stays open
- J-012 · Product names containing HTML render as literal text (XSS safe)
- J-013 · Editing a product retroactively updates already-logged entries
- J-014 · Add Temp Item flow renders the TMP badge

# 4. Entry CRUD

- J-015 · Log an entry (pick product, enter grams, save)
- J-016 · Edit entry grams in place
- J-017 · Delete an entry

# 5. Daily goals & macro auto-compute

- J-018 · Daily kcal goal persists and updates MacroSummary
- J-019 · `+` button increments a macro and auto-recomputes kcal
- J-020 · `-` button clamps a macro at 0
- J-021 · Mismatch warning when kcal disagrees with macros by > 50
- J-022 · Cancel does not persist Settings changes

# 6. Multi-select & bulk operations

- J-023 · Long-press on a row enters selection mode
- J-024 · Tapping a second row adds it to the selection; SelectionBar sums kcal
- J-025 · Tapping an already-selected row deselects it
- J-026 · Clear-selection button exits selection mode
- J-027 · Multi-delete removes all selected rows
- J-028 · Multi-tag flips all to tagged when any row is untagged ("every, not some")
- J-029 · Multi-untag flips all to untagged when every selected row is already tagged
- J-030 · Switching day clears the selection

# 7. Tagging single entries

- J-031 · Dot toggle flips `aria-pressed` both ways
- J-032 · Tagged state persists across reload
- J-033 · Dot `aria-label` flips between "Mark as eaten" and "Mark as not eaten"

# 8. Cross-user catalog (barcode adopt)

- J-034 · Barcoded product auto-adopts on tap from global search
- J-035 · Adopt is idempotent on `(created_by, barcode)`
- J-036 · Non-barcoded products never appear in another user's global search

# 9. Sheet gestures

- J-037 · Drag sheet down past 80 px dismisses it
- J-038 · Drag sheet down under 80 px snaps back; sheet stays open
- J-039 · Drag starting on an input is ignored; sheet stays open
- J-046 · Swipe-down on a stacked sheet (NewProductForm over AddPicker) clears the whole stack to none

# 10. WeekStrip gestures

- J-040 · Swipe left past 50 px commits to the next week
- J-041 · Swipe shorter than 50 px snaps back to the same week
- J-042 · Next-arrow button advances the week

# 11. Keyboard `Enter` semantics

- J-043 · Enter on GramsPicker add-mode input logs the entry
- J-044 · Enter on GramsPicker edit-mode input saves the change
- J-045 · Enter on AddPicker search only blurs (no submit)

# Coverage gaps (TODO journeys)

- J-T001 · Barcode camera scan happy path
- J-T002 · AI label scan happy path
- J-T003 · 401 response auto-logs out and clears localStorage
- J-T004 · Login code expiry shows "Invalid or expired code."
- J-T005 · First-time onboarding (new user, first product, first log)

# Verification

Run from the repo root:

```bash
# 1. Total bullet entries (should be 51: 46 implemented + 5 TODO)
grep -c '^- J' tests/JOURNEYS.md

# 2. No duplicate IDs
grep -oP '^- (J-T?\d+)' tests/JOURNEYS.md | sort | uniq -d

# 3. Spot-check that a J-ID resolves to a test in the suite (the [J-XXX]
# prefix on every test name is the implicit back-link):
grep -RF "[J-035]" tests/e2e/

# 4. Bidirectional back-link (load-bearing): every implemented J-### in the
# doc appears in tests/e2e/ and vice versa. TODO IDs (J-T###) live only
# here, so they don't round-trip; the regex \bJ-\d+\b excludes them.
diff \
  <(grep -oP '\bJ-\d+\b' tests/JOURNEYS.md | sort -u) \
  <(grep -oRhP '\bJ-\d+\b' tests/e2e/ | sort -u)
```
