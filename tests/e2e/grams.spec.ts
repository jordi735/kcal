import { expect, test, type Page } from '@playwright/test';
import { fillNutField, seedProductAndLog, signInFresh } from './helpers';

// Per-test fresh user — every assertion below checks a `current/goal` macro
// projection where `current = existingTotals + entry` (GramsPicker.tsx:51,88).
// The shared `auth.setup.ts` user accumulates entries from prior specs (adopt,
// delete, edit, entry…) on today's date, so existingTotals is non-zero by the
// time grams.spec.ts runs and breaks every hardcoded number. Fresh user →
// existingTotals = 0, so the projection equals the displayed total.
test.use({ storageState: { cookies: [], origins: [] } });

// GramsPicker (src/modals/GramsPicker.tsx) — add-mode coverage. Edit-mode flows
// (title 'Edit amount') live in edit.spec.ts; the Enter key handler lives in
// keyboard.spec.ts. Here we exercise the bump +/- buttons (with clamp), the
// quick-value pills (DEFAULT vs recent-grams), the live macro projection, and
// the negative-path absence of edit-only affordances when the picker is opened
// from the Add flow.

const MACROS = { kcal: '100', protein: '10', carbs: '10', fat: '2' };

// Scope to the add-mode GramsPicker sheet via its title. Re-using a shared
// `.sheet` selector wouldn't disambiguate when AddPicker / NewProductForm are
// transitively in the DOM (they unmount after FADE_EXIT_MS=300).
function addSheet(page: Page) {
  return page.locator('.sheet').filter({ has: page.getByText('How much?') });
}

// The bump buttons are unlabelled icon-only buttons inside the .gramsBox div
// — siblings of the .gramsRow that wraps the input. Walking up two levels
// from the spinbutton lands on .gramsBox; the first/last children of that
// box are minus/plus respectively (GramsPicker.tsx:213-249).
//
// `getByRole('spinbutton')` plus role-anchor scoping is the only way to
// disambiguate without raw class selectors — there are several other icon-
// only buttons in this sheet (the Edit-product pencil in the header) that
// would otherwise alias.
function bumpButtons(page: Page) {
  const gramsBox = page.getByRole('spinbutton').locator('../..');
  return {
    minus: gramsBox.locator('button').first(),
    plus: gramsBox.locator('button').last(),
  };
}

// Walk the AddPicker → Add New → fill → Save & Continue flow, stopping at the
// moment GramsPicker opens. The freshly-created product has no logs, so the
// /entries/recent-grams response is empty and the DEFAULT quick row stays
// visible — necessary precondition for J-087/088/089/090/091/093/094.
async function openAddGramsForNewProduct(
  page: Page,
  name: string,
  macros: typeof MACROS,
) {
  await page.goto('/');
  await page.getByRole('button', { name: 'ADD FOOD' }).tap();
  await page.getByRole('button', { name: 'Add New' }).tap();
  await page.getByPlaceholder('e.g. Peanut Butter').fill(name);
  await fillNutField(page, 'Kcal', macros.kcal);
  await fillNutField(page, 'Protein', macros.protein);
  await fillNutField(page, 'Carbs', macros.carbs);
  await fillNutField(page, 'Fat', macros.fat);
  await page.getByRole('button', { name: /Save & Continue/ }).tap();
  await page.getByText('How much?').waitFor({ state: 'visible' });
}

// GoalRow concatenates: <label> (span) + <track> (no text) + <current>/<goal><unit>.
// Asserting the row's full text via regex is the load-bearing mutation catch:
// a divisor flip in computeMacros (e.g. /100 → /1000) would render a current
// value an order of magnitude off, breaking the substring. Anchored on label-
// then-current-then-/-then-goal-then-unit so a stray match within an adjacent
// projection (e.g. carbs 100 colliding with kcal 100) is excluded.
async function expectMacroRow(
  page: Page,
  label: 'Kcal' | 'Protein' | 'Carbs' | 'Fat',
  current: string,
  goal: number,
  unit: '' | 'g',
) {
  const row = addSheet(page).getByText(label, { exact: true }).locator('..');
  const escaped = current.replace('.', '\\.');
  await expect(row).toHaveText(new RegExp(`${label}\\s*${escaped}\\s*/\\s*${goal}${unit}`));
}

test('[J-087] default grams in add mode is 100 for a brand-new product', async ({ page, request }) => {
  await signInFresh(page, request, 'grams');

  // GramsPicker.tsx:109 — `useState(initialGrams ?? 100)`. For a brand-new
  // product the recent-grams API returns []; the effect at lines 131-137
  // bails out on `history.length === 0` and the initial 100 sticks.
  // Mutation: changing the default constant from 100 to e.g. 0 or 50 would
  // surface here instantly without changing any other test's assertions.
  await openAddGramsForNewProduct(page, 'E2E Default 100', MACROS);

  // toHaveValue auto-retries past the recent-grams API roundtrip — if the
  // effect erroneously fired (history-not-empty mutation), the value would
  // change from 100 mid-poll and the assertion would fail.
  await expect(page.getByRole('spinbutton')).toHaveValue('100');
  // The kcal projection at 100g of a 100kcal/100g product is exactly 100.
  // Anchors the regex shape used by the rest of the spec — proves the helper
  // works against a known-good baseline.
  await expectMacroRow(page, 'Kcal', '100', 2400, '');
});

test('[J-088] plus button bumps grams +10 and the live kcal projection scales linearly', async ({
  page,
  request,
}) => {
  await signInFresh(page, request, 'grams');

  // GramsPicker.tsx:157 — `bump(10)` calls selectGrams(Math.max(1, grams+10))
  // → 110 from a 100 base. selectGrams syncs both `grams` (state, drives the
  // projection) and `text` (drives the input value). Mutation: dropping the
  // setText() in selectGrams would leave the input at "100" while the
  // projection scales — caught by the spinbutton assertion.
  await openAddGramsForNewProduct(page, 'E2E Plus Bump', MACROS);
  await expect(page.getByRole('spinbutton')).toHaveValue('100');

  // Tap the plus bump (second/last child button inside .gramsBox).
  await bumpButtons(page).plus.tap();

  // Grams advanced from 100 to 110; spinbutton AND projection both moved.
  await expect(page.getByRole('spinbutton')).toHaveValue('110');
  // 100kcal/100g × 110g = 110 kcal. A divisor mutation (/100 → /1000) would
  // render 11 here; a numerator mutation (per100.kcal × grams × 100) would
  // render an absurd number. The exact-match regex catches both.
  await expectMacroRow(page, 'Kcal', '110', 2400, '');
});

test('[J-089] minus button decreases grams by 10 and the projection scales', async ({ page, request }) => {
  await signInFresh(page, request, 'grams');

  // GramsPicker.tsx:157 (bump(-10)) → selectGrams(Math.max(1, 100 - 10)) = 90.
  // Symmetric to J-088 but exercising the `delta < 0` branch. A bug that
  // dropped the sign of `delta` in `bump` would push grams to 110 here — the
  // assertion would fail because the spinbutton would read "110".
  await openAddGramsForNewProduct(page, 'E2E Minus Bump', MACROS);
  await expect(page.getByRole('spinbutton')).toHaveValue('100');

  await bumpButtons(page).minus.tap();

  await expect(page.getByRole('spinbutton')).toHaveValue('90');
  // 100kcal/100g × 90g = 90 kcal.
  await expectMacroRow(page, 'Kcal', '90', 2400, '');
});

test('[J-090] minus button clamps grams at 1 (Math.max floor)', async ({ page, request }) => {
  await signInFresh(page, request, 'grams');

  // GramsPicker.tsx:157 — `Math.max(1, grams + delta)`. From 5g, bump(-10)
  // would yield -5 without the floor; the floor pins it at 1. Mutation:
  // `Math.max(1, ...)` → `Math.max(0, ...)` would let grams reach 0, and
  // `computeMacros` would render projection 0 / 2400. Mutation:
  // dropping Math.max entirely would let grams go negative → projection -5
  // — the assertion '1 / 2400' fails on both flavors.
  await openAddGramsForNewProduct(page, 'E2E Min Clamp', MACROS);

  // Type a small starting value so a single minus tap crosses the boundary.
  // Using fill() instead of bumping down 10 times keeps the test fast and
  // avoids accumulated focus state between iterations.
  await page.getByRole('spinbutton').fill('5');

  // Tap the minus bump. From 5 → Math.max(1, 5 - 10) = 1.
  await bumpButtons(page).minus.tap();

  // Spinbutton clamps to 1 — proves the floor fired. Assert as string so a
  // bug that yielded "0" or "-5" surfaces clearly.
  await expect(page.getByRole('spinbutton')).toHaveValue('1');
  // Projection at 1g of 100kcal/100g = 1 kcal. Negative-path: the row text
  // doesn't contain '0 / 2400' (which would result from a 0-floor mutation).
  await expectMacroRow(page, 'Kcal', '1', 2400, '');
  await expect(addSheet(page).getByText('Kcal', { exact: true }).locator('..')).not.toHaveText(
    /Kcal\s*0\s*\//,
  );
});

test('[J-091] quick-value pill tap sets grams and updates the live projection', async ({ page, request }) => {
  await signInFresh(page, request, 'grams');

  // GramsPicker.tsx:253-260 — each pill button onClick calls selectGrams(v).
  // For a brand-new product, history is [], so quickValues = DEFAULT_QUICK_
  // VALUES = [50, 100, 150, 200, 250]. Tap '150': grams → 150, text → "150",
  // projection scales. Mutation: dropping setUserChangedGrams in selectGrams
  // would let the recent-grams effect overwrite 150 once history loaded for
  // a non-fresh product (out of scope here, but the test covers the wiring).
  await openAddGramsForNewProduct(page, 'E2E Quick Tap', MACROS);
  await expect(page.getByRole('spinbutton')).toHaveValue('100');

  // The pills are buttons with numeric-only text content. exact:true so
  // '150' doesn't substring-match a goal suffix like '/ 250g' (which lives
  // in spans, not buttons, but belt-and-suspenders).
  await page.getByRole('button', { name: '150', exact: true }).tap();

  await expect(page.getByRole('spinbutton')).toHaveValue('150');
  // 100kcal/100g × 150g = 150 kcal.
  await expectMacroRow(page, 'Kcal', '150', 2400, '');
});

test('[J-092] recent-grams replaces the DEFAULT [50,100,150,200,250] quick row', async ({ page, request }) => {
  await signInFresh(page, request, 'grams');

  // GramsPicker.tsx:139-142 — `quickValues = history.length > 0 ? history :
  // DEFAULT`. Seed once at 175g (a value not in DEFAULT_QUICK_VALUES so a
  // false-positive can't happen by coincidence), then re-open via search.
  // The quick row should show only the historical 175 button, NOT the five
  // DEFAULT entries. Mutation: dropping the conditional and always returning
  // DEFAULT would surface the '50' button — caught below.
  const name = 'E2E Quick History';
  await page.goto('/');
  await seedProductAndLog(page, name, MACROS, '175');

  await page.getByRole('button', { name: 'ADD FOOD' }).tap();
  // Scope to the AddPicker sheet, not the food-row beneath it (CLAUDE.md
  // documents this: substring matches collide between picker and row).
  const picker = page
    .locator('.sheet')
    .filter({ has: page.getByPlaceholder('Search products...') });
  await picker.getByText(name).first().tap();
  await page.getByText('How much?').waitFor({ state: 'visible' });

  // Pre-fill from recent-grams effect lands the spinbutton on 175 (J-085
  // contract; we verify here too as the precondition for the pill assertion).
  await expect(page.getByRole('spinbutton')).toHaveValue('175');

  // The 175 pill exists in the new quick row.
  await expect(
    addSheet(page).getByRole('button', { name: '175', exact: true }),
  ).toHaveCount(1);
  // The DEFAULT '50' pill is gone — the conditional replaced the list. A
  // mutation that always rendered DEFAULT would still have '50' present.
  await expect(
    addSheet(page).getByRole('button', { name: '50', exact: true }),
  ).toHaveCount(0);
  // Belt-and-suspenders on the upper end of DEFAULT: '250' is the largest
  // default value and an off-by-one slice mutation might leave it behind.
  await expect(
    addSheet(page).getByRole('button', { name: '250', exact: true }),
  ).toHaveCount(0);
});

test('[J-093] add-mode GramsPicker shows the pencil but hides the trash (delete-entry is edit-only)', async ({
  page,
  request,
}) => {
  await signInFresh(page, request, 'grams');

  // App.tsx:576 passes `onEditProduct` UNCONDITIONALLY — both add and edit
  // modes get the pencil so the user can fix a product's macros before (or
  // during) logging. `onDelete` (App.tsx:571) is conditional on edit mode
  // (it deletes the entry, not the product), so the trash icon is gated.
  // The journey here is differential: the same sheet renders one of two
  // toolsets depending on whether an entry already exists.
  //
  // Mutation: dropping the conditional spread of `onDelete` and passing it
  // unconditionally would expose the trash icon in add mode — a footgun
  // (delete an entry that doesn't exist yet). Caught by the trash count.
  // Mutation: flipping the mode prop default from 'add' to 'edit' would
  // change the confirm-button label and surface the wrong toolset — caught
  // by the 'Save' vs 'Add to day' assertion.
  await openAddGramsForNewProduct(page, 'E2E Add No Trash', MACROS);

  // exact:true is mandatory per CLAUDE.md — the FoodRow under the sheet
  // could contribute a substring "edit product" via the product name and
  // trip a strict-mode collision otherwise. Pencil IS visible (add mode
  // still allows escalation to product-edit).
  await expect(
    addSheet(page).getByRole('button', { name: 'Edit product', exact: true }),
  ).toHaveCount(1);
  // Trash button is the load-bearing absence — would let the user invoke
  // onDelete (which dispatches DELETE /entries/<undefined>) in add mode.
  await expect(
    addSheet(page).getByRole('button', { name: 'Delete entry', exact: true }),
  ).toHaveCount(0);
  // Belt-and-suspenders: the confirm button reads 'Add to day' (add mode),
  // not 'Save' (edit mode). GramsPicker.tsx:160.
  await expect(addSheet(page).getByRole('button', { name: /Add to day/ })).toBeVisible();
  await expect(addSheet(page).getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
});

test('[J-094] protein/carbs/fat projections render with one-decimal formatting', async ({ page, request }) => {
  await signInFresh(page, request, 'grams');

  // GramsPicker.tsx:29 + :198-209 — fmtOneDecimal returns `.toFixed(1)` so
  // even whole-number projections surface as "N.0". Kcal uses fmtInt and
  // surfaces "N" (no decimal). Mutation: swapping fmtOneDecimal → fmtInt
  // for the three macro rows drops the ".M" suffix entirely; the regex
  // `\d+\.\d+` below requires the decimal form on each macro row.
  //
  // Order-independent: the assertion holds regardless of what existingTotals
  // contributes to total (it's `existing + entry`), because fmtOneDecimal
  // appends ".0" to whole numbers too. Implicit complement: J-087-J-091 use
  // integer-only regexes for the kcal row — a regression that wired
  // fmtOneDecimal to kcal would surface there ("Kcal 100.0 /" doesn't match
  // /Kcal\s*100\s*\//).
  await openAddGramsForNewProduct(page, 'E2E Decimals', MACROS);
  await expect(page.getByRole('spinbutton')).toHaveValue('100');

  const sheet = addSheet(page);
  for (const label of ['Protein', 'Carbs', 'Fat'] as const) {
    await expect(sheet.getByText(label, { exact: true }).locator('..')).toHaveText(
      new RegExp(`${label}\\s*\\d+\\.\\d+\\s*/\\s*\\d+g`),
    );
  }
});
