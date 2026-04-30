import { expect, test } from '@playwright/test';
import { signInFresh } from './helpers';

// Fresh-user isolation: the shared storageState user already has 20+ products
// from Tier 1 tests, so its Home and AddPicker are never empty. Per-test
// inline sign-in with a unique email guarantees a clean slate without
// entangling these specs with the user2 fixture used by adopt.spec.ts.
test.use({ storageState: { cookies: [], origins: [] } });

test('[J-008] home shows "No food logged" for a user with no entries', async ({ page, request }) => {
  await signInFresh(page, request, 'empty');

  // Home.tsx:96 renders this label when entriesForDay is empty.
  await expect(page.getByText('No food logged')).toBeVisible();
  // No FoodRow renders — proves the empty branch was actually taken
  // (Home.tsx:91 — `entries.length === 0` triggers the empty button rather
  // than the .food-row map). Mutation: flipping the comparator would render
  // both, and this assertion catches that.
  await expect(page.locator('.food-row')).toHaveCount(0);
});

test('[J-075] empty home shows the "Tap here..." secondary hint', async ({ page, request }) => {
  await signInFresh(page, request, 'empty');

  // Home.tsx:97-99 — the empty CTA carries a 2-line message: the caps label
  // ("No food logged") AND the lowercase hint. The hint is what tells a
  // brand-new user the pill is itself a button — without it the affordance
  // is unclear.
  await expect(page.getByText('Tap here to log your first item of the day.')).toBeVisible();
});

test('[J-076] tapping the empty-state pill opens AddPicker', async ({ page, request }) => {
  await signInFresh(page, request, 'empty');

  // Home.tsx:92 wraps the entire empty CTA in a single <button onClick={onAddEntry}>.
  // App.tsx:274 onAddEntry sets modal=add-picker — so tapping anywhere on the pill
  // should reach the same screen as tapping "ADD FOOD" in MacroSummary. Filter
  // the role lookup by the inner caps label to disambiguate from the bottom
  // ADD FOOD button.
  await page.getByRole('button').filter({ hasText: 'No food logged' }).tap();

  // AddPicker's search input has a unique placeholder; visible only when the
  // sheet is mounted.
  await expect(page.getByPlaceholder('Search products...')).toBeVisible();
});

test('[J-009] AddPicker search with no matches shows the empty-results block', async ({ page, request }) => {
  await signInFresh(page, request, 'empty');

  await page.getByRole('button', { name: 'ADD FOOD' }).tap();

  const q = 'XYZZY_UNLIKELY_MATCH';
  await page.getByPlaceholder('Search products...').fill(q);

  // AddPicker.tsx:197-200 — emptySearch branch. Both the typed query and the
  // "not in your library yet." tail line should be visible.
  await expect(page.getByText('not in your library yet.')).toBeVisible();
  await expect(page.getByText(`"${q}"`)).toBeVisible();
  // Negative-path: section headers contain the literal "per 100g" sibling
  // (AddPicker.tsx:137) which is ONLY rendered alongside list rows. Asserting
  // its absence guards against a regression where emptySearch and results-
  // rendering accidentally co-fire.
  await expect(page.getByText('per 100g')).toHaveCount(0);
});

test('[J-077] AddPicker idle on a brand-new user shows "library is empty"; no Recent/All headers', async ({ page, request }) => {
  await signInFresh(page, request, 'empty');

  await page.getByRole('button', { name: 'ADD FOOD' }).tap();

  // AddPicker.tsx:211-213 — idleEmpty fires when /products/recent AND
  // /products/all both return [] for the new account. Mutation-resistance:
  // if a future migration seeds default starter products into new accounts,
  // idleEmpty stops firing and this assertion catches it.
  await expect(
    page.getByText('Your library is empty. Tap + Add New to create your first product.'),
  ).toBeVisible();

  // "Recent" / "All" section headers (AddPicker.tsx:219, 225) only render when
  // their list is non-empty. With 0 products, neither appears, and the
  // companion "per 100g" header is also gone.
  await expect(page.getByText('Recent', { exact: true })).toHaveCount(0);
  await expect(page.getByText('All', { exact: true })).toHaveCount(0);
  await expect(page.getByText('per 100g')).toHaveCount(0);

  // Add New / Add Temp stay operable from the empty state — these are the
  // only forward paths (AddPicker.tsx:233-247). Without them the empty-state
  // user is stuck.
  await expect(page.getByRole('button', { name: 'Add New', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add Temp', exact: true })).toBeVisible();
});

test('[J-078] empty-day MacroSummary shows full default kcal goal as remaining + 0 consumed', async ({ page, request }) => {
  await signInFresh(page, request, 'empty');

  // Default user goals from migrations/001_init.sql: kcal=2400. With totals.kcal=0,
  // MacroSummary.tsx:21-22 sets kcalLeft=2400, kcalOver=false → "Kcal remaining"
  // headline (line 31). Mutation: flipping `>` to `>=` on line 22 would surface
  // "Over budget" at the boundary 0===0 — assert that does NOT appear.
  await expect(page.getByText('Kcal remaining')).toBeVisible();
  await expect(page.getByText('Over budget')).toHaveCount(0);

  // The remaining number "2400" and the goal "/ 2400" render as separate
  // spans (MacroSummary.tsx:33-37). Exact-match catches the standalone
  // remaining number; substring catches the goal-prefix span.
  await expect(page.getByText('2400', { exact: true })).toBeVisible();
  await expect(page.getByText('/ 2400')).toBeVisible();

  // Consumed column shows "0 kcal" (MacroSummary.tsx:41-44). Outer span's
  // textContent concatenates "0 " and "kcal" — matched as one substring.
  await expect(page.getByText('Consumed')).toBeVisible();
  await expect(page.getByText('0 kcal')).toBeVisible();
});
