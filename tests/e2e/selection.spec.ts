import { expect, test, type Locator, type Page } from '@playwright/test';
import { longPress, seedProductAndLog } from './helpers';

// Macros are chosen so the kcal readout in the SelectionBar is unambiguous:
//   A = 100 kcal/100g × 100g = 100 kcal
//   B = 200 kcal/100g × 100g = 200 kcal
//   combined = 300 kcal
// Macro columns (P30/C30/F6) do not contain the digits "300" as a substring,
// so asserting the bar contains "300" isolates the kcal total.
const MACROS_A = { kcal: '100', protein: '10', carbs: '10', fat: '2' };
const MACROS_B = { kcal: '200', protein: '20', carbs: '20', fat: '4' };

// Each test uses a unique suffix — the test DB persists across tests within
// a run, so shared names would accumulate rows and break row locators.
async function seedPair(page: Page, suffix: string) {
  await page.goto('/');
  await seedProductAndLog(page, `E2E Sel A ${suffix}`, MACROS_A, '100');
  await seedProductAndLog(page, `E2E Sel B ${suffix}`, MACROS_B, '100');
}

// The FoodRow's main <button> wires both onClick (tap → select/edit) and
// onContextMenu (long-press → select). Within each row there are exactly
// two buttons: index 0 is the dot (aria-label="Mark as eaten"), index 1
// is the main body button — selecting positionally avoids depending on
// the rendered casing of the product name.
function mainButton(page: Page, rowText: string): Locator {
  return page.locator('.food-row').filter({ hasText: rowText })
    .locator('button').nth(1);
}

function dot(page: Page, rowText: string): Locator {
  return page.locator('.food-row').filter({ hasText: rowText })
    .getByRole('button', { name: /Mark as (not )?eaten/ });
}

// SelectionBar doesn't have a stable container selector (CSS-modules hashed
// class). Probe via the stable aria-label on the Clear button — presence of
// that button == bar mounted. During exit animation the bar stays mounted
// for FADE_EXIT_MS; toHaveCount(0) waits for the full unmount.
function clearBtn(page: Page): Locator {
  return page.getByRole('button', { name: 'Clear selection', exact: true });
}

// The bar root is two ancestors above the Clear button (button → actions
// container → bar). Used to scope text assertions to the bar.
function selectionBarRoot(page: Page): Locator {
  return clearBtn(page).locator('..').locator('..');
}

test('[J-023] long-press enters selection mode with count 1', async ({ page }) => {
  const s = 'S1';
  await seedPair(page, s);

  await longPress(mainButton(page, `E2E Sel A ${s}`));
  await expect(page.getByText('1 selected', { exact: true })).toBeVisible();
  // Clear button mounted == bar mounted (proves selectionMode flipped, not
  // just that the count text appeared somewhere).
  await expect(clearBtn(page)).toHaveCount(1);
});

test('[J-024] tap after long-press adds a second row; bar sums kcal AND macros', async ({ page }) => {
  const s = 'S2';
  await seedPair(page, s);

  await longPress(mainButton(page, `E2E Sel A ${s}`));
  await mainButton(page, `E2E Sel B ${s}`).tap();

  await expect(page.getByText('2 selected', { exact: true })).toBeVisible();
  // sumMacros is independent per macro key — a bug in any one of the four
  // accumulators surfaces here without affecting the others. P30 = 10 + 20,
  // C30 = 10 + 20, F6 = 2 + 4. The "300" kcal substring cannot collide with
  // P/C/F values because the breakdown renders "P30" not "300".
  const bar = selectionBarRoot(page);
  await expect(bar).toContainText('300');
  await expect(bar).toContainText('P30');
  await expect(bar).toContainText('C30');
  await expect(bar).toContainText('F6');
});

test('[J-025] tapping an already-selected row deselects it', async ({ page }) => {
  const s = 'S3';
  await seedPair(page, s);

  await longPress(mainButton(page, `E2E Sel A ${s}`));
  await mainButton(page, `E2E Sel B ${s}`).tap();
  await expect(page.getByText('2 selected', { exact: true })).toBeVisible();

  // Tap A again — already in selection mode, so onClick hits toggleSelect
  // and removes it. Count drops to 1; kcal drops to B-only (200) — and
  // crucially the combined "300" is gone, proving sumMacros recomputed
  // off the smaller list (mutation guard for "did we re-derive the sum").
  await mainButton(page, `E2E Sel A ${s}`).tap();
  await expect(page.getByText('1 selected', { exact: true })).toBeVisible();
  const bar = selectionBarRoot(page);
  await expect(bar).toContainText('200');
  await expect(bar).not.toContainText('300');
});

test('[J-026] clear button exits selection mode', async ({ page }) => {
  const s = 'S4';
  await seedPair(page, s);

  await longPress(mainButton(page, `E2E Sel A ${s}`));
  await expect(page.getByText('1 selected', { exact: true })).toBeVisible();

  await clearBtn(page).tap();
  await expect(clearBtn(page)).toHaveCount(0);
});

test('[J-027] multi-delete removes both selected rows AND clears the selection', async ({ page }) => {
  const s = 'S5';
  await seedPair(page, s);

  await longPress(mainButton(page, `E2E Sel A ${s}`));
  await mainButton(page, `E2E Sel B ${s}`).tap();
  await page.getByRole('button', { name: 'Delete 2 selected', exact: true }).tap();

  await expect(page.locator('.food-row').filter({ hasText: `E2E Sel A ${s}` })).toHaveCount(0);
  await expect(page.locator('.food-row').filter({ hasText: `E2E Sel B ${s}` })).toHaveCount(0);
  // Home.tsx:69 calls setSelectedIds(new Set()) AFTER onDeleteEntries. If
  // the clear were dropped, the bar would stick (with selectedIds pointing
  // at IDs that no longer exist; n=0 but selectionMode=true). Pin the clear.
  await expect(clearBtn(page)).toHaveCount(0);
});

test('[J-128] multi-tag with all rows untagged tags both', async ({ page }) => {
  const s = 'S6';
  await seedPair(page, s);

  await longPress(mainButton(page, `E2E Sel A ${s}`));
  await mainButton(page, `E2E Sel B ${s}`).tap();
  await page.getByRole('button', { name: 'Tag 2 selected', exact: true }).tap();

  await expect(dot(page, `E2E Sel A ${s}`)).toHaveAttribute('aria-pressed', 'true');
  await expect(dot(page, `E2E Sel B ${s}`)).toHaveAttribute('aria-pressed', 'true');
  // Home.tsx:74 clears selection AFTER onMarkTagged — pin the clear.
  await expect(clearBtn(page)).toHaveCount(0);
});

test('[J-029] multi-tag with all rows tagged flips to untagged', async ({ page }) => {
  const s = 'S7';
  await seedPair(page, s);

  // Pre-tag both via dot taps (not multi-tag — that would clear selection).
  await dot(page, `E2E Sel A ${s}`).tap();
  await expect(dot(page, `E2E Sel A ${s}`)).toHaveAttribute('aria-pressed', 'true');
  await dot(page, `E2E Sel B ${s}`).tap();
  await expect(dot(page, `E2E Sel B ${s}`)).toHaveAttribute('aria-pressed', 'true');

  // Select both. allTagged=true → button label is "Untag", "Tag" never shows.
  await longPress(mainButton(page, `E2E Sel A ${s}`));
  await mainButton(page, `E2E Sel B ${s}`).tap();
  // Negative-path: only "Untag" mounts — proves SelectionBar.tsx:61 allTagged
  // resolved to true (not "Tag" via an && → || flip on n > 0 && every).
  await expect(page.getByRole('button', { name: 'Tag 2 selected', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Untag 2 selected', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Untag 2 selected', exact: true }).tap();

  await expect(dot(page, `E2E Sel A ${s}`)).toHaveAttribute('aria-pressed', 'false');
  await expect(dot(page, `E2E Sel B ${s}`)).toHaveAttribute('aria-pressed', 'false');
  await expect(clearBtn(page)).toHaveCount(0);
});

test('[J-028] multi-tag with mixed state tags all (every, not some)', async ({ page }) => {
  const s = 'S8';
  await seedPair(page, s);

  // Tag only A. B stays untagged.
  await dot(page, `E2E Sel A ${s}`).tap();
  await expect(dot(page, `E2E Sel A ${s}`)).toHaveAttribute('aria-pressed', 'true');

  await longPress(mainButton(page, `E2E Sel A ${s}`));
  await mainButton(page, `E2E Sel B ${s}`).tap();

  // The invariant: allTagged = n > 0 && shown.every((e) => e.tagged). With
  // a mixed selection, every() returns false, so the button tags-all (label
  // "Tag"), not untags-all ("Untag"). A regression from every → some would
  // silently flip this — these two opposite-direction assertions pin it.
  await expect(page.getByRole('button', { name: 'Tag 2 selected', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Untag 2 selected', exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Tag 2 selected', exact: true }).tap();
  await expect(dot(page, `E2E Sel A ${s}`)).toHaveAttribute('aria-pressed', 'true');
  await expect(dot(page, `E2E Sel B ${s}`)).toHaveAttribute('aria-pressed', 'true');
  await expect(clearBtn(page)).toHaveCount(0);
});

test('[J-030] switching day clears the selection', async ({ page }) => {
  const s = 'S9';
  await seedPair(page, s);

  await longPress(mainButton(page, `E2E Sel A ${s}`));
  await expect(page.getByText('1 selected', { exact: true })).toBeVisible();

  // Compute a non-today day pill in the current week. If today is Monday,
  // reach for tomorrow instead (yesterday would be in the previous week
  // grid, which is rendered off-screen inside the carousel).
  const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const today = new Date();
  const todayIdx = (today.getDay() + 6) % 7;
  const delta = todayIdx === 0 ? 1 : -1;
  const other = new Date(today.getFullYear(), today.getMonth(), today.getDate() + delta);
  const otherIdx = (other.getDay() + 6) % 7;
  const otherText = `${DAY_LETTERS[otherIdx]} ${other.getDate()}`;

  await page.getByRole('button', { name: otherText, exact: true }).first().tap();

  // Home.tsx:46-48 — useEffect on selectedDate change calls setSelectedIds(new Set()).
  await expect(clearBtn(page)).toHaveCount(0);
});

test('[J-129] long-press on already-selected row deselects (input symmetry)', async ({ page }) => {
  // Suffixes ZA..ZE for the new tests — picking non-numeric tail letters
  // sidesteps the "E2E Sel A S1" + "100g" → "...s1100g..." substring
  // collision that would otherwise let `hasText: 'E2E Sel A S11'` match
  // both the S1 row and an S11 row simultaneously.
  const s = 'ZA';
  await seedPair(page, s);

  // First long-press: A enters selection.
  await longPress(mainButton(page, `E2E Sel A ${s}`));
  await expect(page.getByText('1 selected', { exact: true })).toBeVisible();

  // Second long-press on the SAME row: toggleSelect runs again and the
  // entry is removed from the Set (Home.tsx:59 `if (next.has(...)) next.delete`).
  // selectionMode flips to false → SelectionBar unmounts after the slide-down.
  // A mutation that swaps `if (next.has(...))` to `if (!next.has(...))`
  // would only ever add, leaving the bar stuck at "1 selected".
  await longPress(mainButton(page, `E2E Sel A ${s}`));
  await expect(clearBtn(page)).toHaveCount(0);
});

test('[J-130] dot tap in selection mode toggles tagged, not select', async ({ page }) => {
  const s = 'ZB';
  await seedPair(page, s);

  await longPress(mainButton(page, `E2E Sel A ${s}`));
  await expect(page.getByText('1 selected', { exact: true })).toBeVisible();

  // Tap A's dot WHILE A is selected. The dot's onClick = onToggleTagged
  // (FoodRow.tsx:34) and is NOT gated by selectionMode — so it should flip
  // tagged regardless of the selection state, AND must not affect the
  // selection. A regression that gates the dot on selectionMode (or routes
  // it through toggleSelect) would either no-op the tag OR drop the
  // selection.
  await dot(page, `E2E Sel A ${s}`).tap();
  await expect(dot(page, `E2E Sel A ${s}`)).toHaveAttribute('aria-pressed', 'true');
  // Selection survives — bar still shows '1 selected'.
  await expect(page.getByText('1 selected', { exact: true })).toBeVisible();
});

test('[J-131] long-press on the dot does NOT enter selection mode', async ({ page }) => {
  const s = 'ZC';
  await seedPair(page, s);

  // The dot is a sibling of the main body button (FoodRow.tsx:31-39 vs
  // 40-68). onContextMenu is wired only on the main body, so a contextmenu
  // event dispatched on the dot doesn't bubble to a handler — selection
  // mode stays off. A regression that wires onLongPress onto the row root
  // (or the dot) would erroneously activate selection here.
  await longPress(dot(page, `E2E Sel A ${s}`));
  // No bar mounted: clearBtn count stays 0; '1 selected' text never appears.
  await expect(clearBtn(page)).toHaveCount(0);
  await expect(page.getByText('1 selected', { exact: true })).toHaveCount(0);
});

test('[J-132] tap in selection mode adds to selection only — no GramsPicker', async ({ page }) => {
  const s = 'ZD';
  await seedPair(page, s);

  await longPress(mainButton(page, `E2E Sel A ${s}`));
  await expect(page.getByText('1 selected', { exact: true })).toBeVisible();

  // Tapping B in selection mode hits the if-branch in FoodRow.tsx:42:
  //   if (selectionMode) onToggleSelect(entry); else onEdit(entry);
  // so onEdit must NOT fire and GramsPicker must NOT mount. A regression
  // that drops the `if` (or flips the comparator) would open the editor
  // here while still adding to selection — dual-effect bug.
  await mainButton(page, `E2E Sel B ${s}`).tap();
  await expect(page.getByText('2 selected', { exact: true })).toBeVisible();
  await expect(page.getByText('How much?')).toHaveCount(0);
});

test('[J-133] multi-tag mixed state issues exactly one PATCH (already-tagged skip)', async ({ page }) => {
  const s = 'ZE';
  await seedPair(page, s);

  // Pre-tag A. This issues one PATCH; we wait for the optimistic UI to
  // catch up before attaching the request listener (so this PATCH is not
  // counted).
  await dot(page, `E2E Sel A ${s}`).tap();
  await expect(dot(page, `E2E Sel A ${s}`)).toHaveAttribute('aria-pressed', 'true');

  // Now count every PATCH /entries/<numeric-id> issued from here on out.
  // App.tsx:290 has `if (entry.tagged === tagged) continue;` — the
  // already-tagged A must be skipped, leaving exactly one PATCH (for B).
  // A mutation that drops the continue would emit two PATCHes.
  const patchUrls: string[] = [];
  page.on('request', (req) => {
    if (req.method() === 'PATCH' && /\/entries\/\d+$/.test(req.url())) {
      patchUrls.push(req.url());
    }
  });

  await longPress(mainButton(page, `E2E Sel A ${s}`));
  await mainButton(page, `E2E Sel B ${s}`).tap();
  await page.getByRole('button', { name: 'Tag 2 selected', exact: true }).tap();

  // End state: both tagged. The aria-pressed assertions also block on the
  // PATCH for B landing, so by the time both pass the network is settled.
  await expect(dot(page, `E2E Sel A ${s}`)).toHaveAttribute('aria-pressed', 'true');
  await expect(dot(page, `E2E Sel B ${s}`)).toHaveAttribute('aria-pressed', 'true');
  expect(patchUrls).toHaveLength(1);
});
