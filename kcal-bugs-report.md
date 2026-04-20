# kcal — Bug Audit & Fix Report

Three-phase audit (per-file → per-domain → apply) executed against the
PRAGMATISM GATE: every finding had to be reachable, observable, non-speculative,
and fixable with a small local change.

---

## 1. Executive Summary

- **Files in scope:** 40 listed; 39 audited (`server/asyncHandler.ts` does not exist — audit list was stale; codebase relies on Express 5 native async-rejection propagation).
- **Phase 1 findings:** 3 (1 HIGH client bug, 2 LOW client bugs).
- **Phase 2 cross-file findings:** 1 (LOW client bug discovered in domain D6).
- **Phase 2 conflicts:** 0 — every fix touches one file in one domain.
- **Phase 3 applied:** 4 / 4 (100%). 0 skipped.
- **Typecheck:** client `pass`, server `pass`.

**Counts by severity**

| severity | count |
| --- | --- |
| critical | 0 |
| high | 1 |
| medium | 0 |
| low | 3 |

**Counts by class**

| class | count |
| --- | --- |
| ASYNC | 1 |
| LOGIC | 2 |
| STATE | 1 |

**Most impactful fixes (in order):**

1. **Verify.tsx (HIGH)** — magic-link verifications were silently failing for any user whose verify request raced an App re-render: the second token consumption returned 400, the `Verify` catch fired, and the user was bounced to `/` despite the original verify having succeeded server-side.
2. **MacroSummary.tsx (LOW)** — kcal progress bar rendered as an unfilled `NaN%` width whenever `goals.kcal === 0` and the day's totals were also 0 (a state Settings explicitly permits).
3. **NewProductForm.tsx (LOW)** — the green "✓ Filled from label" banner appeared on the most common create path (type a name in AddPicker, click "Create new product"), misleading the user into thinking macros were prefilled when they weren't.
4. **BarcodeScanner.tsx (LOW)** — during the 250 ms close-fade animation, a late barcode detection could fire and trigger a modal transition that the parent's `onClose` then immediately overwrote, dropping the user's scan.

---

## 2. Fixed Table

Sorted by severity desc, then class.

| severity | class | location | observable impact | fix summary |
| --- | --- | --- | --- | --- |
| HIGH | ASYNC | `src/screens/Verify.tsx:22-49` | Successful magic-link verify silently fails: parent re-renders before the component unmounts → effect re-fires with the same single-use token → server returns **400 invalid_or_expired_token** → catch sets `state: 'invalid'` → `setTimeout(onFailure, 1600)` redirects to `/` → user lands on Login despite a working magic link. | Stash `onVerified` and `onFailure` in refs updated by a separate effect; main verify effect now runs once with `[]` deps so prop-identity churn cannot re-fire it. |
| LOW | LOGIC | `src/components/MacroSummary.tsx:21` | `kcalPct = 0/0 = NaN` when `goals.kcal === 0` and totals are 0 → CSS `--kcal-pct: NaN%` is invalid → kcal bar visually empty. | Mirror the existing `MacroBar` guard: `goals.kcal > 0 ? Math.min(100, totals.kcal/goals.kcal*100) : 0`. |
| LOW | LOGIC | `src/modals/NewProductForm.tsx:98-100` | "✓ Filled from label" success banner shown on the Create-from-search path even though no scan happened (user only typed a name). | `prefilled = initial?.per100 !== undefined` — the banner now lights up only when macros (per100) were actually prefilled by an AI scan or a barcode template. |
| LOW | STATE | `src/modals/BarcodeScanner.tsx` (interval + close handler) | A barcode detected during the 250 ms exit-fade after user-clicked close fires `onDetect` → modal briefly transitions, then the close timer overwrites it back to `add-picker`. User's scan is lost. | Promote `intervalId` and `stream` to refs; introduce a `closeNow` wrapper that synchronously clears the interval and stops camera tracks before delegating to `useFadeClose`'s `requestClose`. The unmount cleanup remains as a no-op safety net. |

---

## 3. Cross-File Bugs

Two of the four fixes have a cross-file root cause worth calling out.

**Verify.tsx ↔ App.tsx (HIGH).** The proximate bug was the `useEffect` deps `[onVerified, onFailure]` in `Verify.tsx`. The deeper cause is `App.tsx` defining both callbacks inline on every render (`onVerified`, `onFailure` at App.tsx:215-232), so they get fresh identities each time the parent re-renders. Phase 2 chose the local Verify-side fix (refs + empty deps) over `useCallback` in `App.tsx` because (a) it isolates the contract — the Verify effect is a single-shot side effect by design — and (b) `useCallback` in App.tsx would have to memoize correctly across many other handlers that also recreate per render. The server side of the chain (`server/auth.ts` `consumeMagicLink` deletes the token from the in-memory `Map` on first read, returning 400 on the second call) was confirmed in Phase 2 to be operating exactly as documented; no server change is needed.

**MacroSummary.tsx ↔ Settings.tsx ↔ server/routes/settings.ts (LOW).** The NaN-width bug requires the precondition `goals.kcal === 0`. That state is permitted at three layers:
- `server/routes/settings.ts` accepts integer 0 (intentional — the route lets users clear a goal).
- `src/screens/Settings.tsx` minus button uses `Math.max(0, value - step)` so `0` is reachable from the UI.
- `src/components/MacroSummary.tsx` previously divided unconditionally.

`MacroBar.tsx` already had the right guard (`goal > 0 ? consumed/goal : 0`); `MacroSummary.tsx` simply hadn't mirrored it. Fix landed in MacroSummary; server and Settings remain unchanged because their permissive behavior is intentional.

---

## 4. Skipped / Rejected Table

| item | reason |
| --- | --- |
| `server/asyncHandler.ts` (audit scope) | File does not exist. The codebase relies on Express 5's native async-rejection propagation. No wrapper module is needed or present. |

### Phase-1 candidates considered and dropped (audit trail)

These were noted by file-level reviewers in `notes_for_domain_pass` but did not pass the PRAGMATISM GATE; they're listed here so future audits don't re-flag them.

| candidate | why dropped |
| --- | --- |
| `EMAIL_RE` lacks anchors (`/\S+@\S+\.\S+/`) | Server is the only consumer; loose regex is upstream of `.trim().toLowerCase()` and Postmark would reject genuinely malformed emails. No exploit path. |
| `DATE_RE` / `TIME_RE` allow `2026-13-99` / `99:99` | Front-end uses date pickers; direct-API garbage only corrupts the misuser's own `local_date`-keyed entries (internal consistency preserved). Self-injury only. |
| `MAGIC_LINK_BASE_URL` trailing slash → `//verify` | Operator-config issue, not a code bug. Browsers and Vite normalize. `.env.example` documents the no-slash form. |
| `POST /products/adopt/:id` returns **400 not_adoptable** vs **404** | Intentional per `CLAUDE.md`: distinguishing these codes lets a logged-in user enumerate the existence of other users' private product IDs but never their data. Documented behavior. |
| `PUT /products/:id` permits a user to set a barcode they already own (no DB unique on `(created_by, barcode)`) | Design choice; only triggered by deliberate user action and only impacts their own non-deterministic `byBarcode` lookup. |
| `useFadeClose` timer not cleared on unmount | Bounded leak: no current caller unmounts mid-fade except logout, where the resulting `setModal` is a harmless no-op on already-reset state. |
| `Sheet.tsx` `transitionend` listener leak when pointerdown→pointerup with zero movement | DOM element is GC'd anyway; no leaked handler accumulates. |
| `Settings.tsx` permits typing decimals / negative goals | Server rejects with 400 `invalid_goals`, surfaced via the existing error toast. UX wart, not a bug. |
| `Login.tsx` `submit()` rethrow → unhandled promise rejection | UI state stays correct (`submitting` resets in `finally`, `sent` stays false). No user-visible issue. |
| `AddPicker.tsx` 250 ms transient empty-state mismatch (debounced search) | Self-healing within the next debounce tick; no permanent bad state. |
| `useEntries.ts` `let newList = [] + setState(updater)` pattern | Relies on Preact 10 invoking setState updaters synchronously, which it does. Would break under a future concurrent renderer; not a current bug. |
| `claude.ts` `stripCodeFences` only handles a starting fence | Documented trade-off; mismatched output yields `unparseable_json` → 422. |
| `App.tsx` Sheet exit-animation bypassed when callbacks call `setModal({kind:'none'})` directly | Cosmetic-only; UX inconsistency, not a functional bug. |
| `App.tsx` toast scheduling overlap | Earlier-scheduled timer can shorten a later toast. Cosmetic timing only. |

---

## 5. Typecheck Status

| project | command | result |
| --- | --- | --- |
| client | `npm run typecheck` | ✅ pass |
| server | `npm run typecheck:server` | ✅ pass |

No residual errors after all four fixes.

A separate, pre-existing IDE deprecation diagnostic is present on `src/components/Sheet.tsx` for `CSSProperties` and `TargetedPointerEvent` (Preact 10 type deprecations, unrelated to this audit). These do not fail `tsc --noEmit` and are out of scope.

---

## Phase Summary

| phase | files / domains | findings raised | confirmed | fixed |
| --- | --- | --- | --- | --- |
| Phase 1 (per-file) | 39 | 3 | n/a | n/a |
| Phase 2 (per-domain) | 8 | +1 cross-file | 4 | n/a |
| Phase 3 (apply) | 4 | n/a | n/a | 4 |

End of report.
