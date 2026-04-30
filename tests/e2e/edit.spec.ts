import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fillNutField, seedProductAndLog } from './helpers';

// Edit flows. Entry edit opens GramsPicker in mode='edit' (title 'Edit amount',
// confirm button 'Save', delete TrashIcon aria-label 'Delete entry'). Product
// edit opens NewProductForm in mode='edit' (title 'Save changes'). The
// retroactive-macro invariant lives in App.tsx:413-426: product-edit save
// refetches the day + week, so macros change without a page reload. Cancel in
// edit-product routes back to GramsPicker (App.tsx:586-592), NOT home.

const MACROS = { kcal: '100', protein: '10', carbs: '10', fat: '2' };

// auth.setup.ts persisted user A's session token to user.json. The contract
// tests just need a bearer token to prove route validators reject bad input —
// no UI needed, so read the file directly to avoid a page navigation.
type StorageState = {
  origins: Array<{ localStorage: Array<{ name: string; value: string }> }>;
};

function tokenFromAuthFile(): string {
  const parsed = JSON.parse(
    readFileSync('tests/e2e/.auth/user.json', 'utf8'),
  ) as StorageState;
  const entry = parsed.origins[0]?.localStorage.find(
    (e) => e.name === 'kcal_session_token',
  );
  if (entry === undefined) throw new Error('no session token in user.json');
  return entry.value;
}

test('[J-016] edit grams updates the row without adding a new entry', async ({ page }) => {
  const name = 'E2E Edit Grams';
  await page.goto('/');
  await seedProductAndLog(page, name, MACROS, '100');

  const row = page.locator('.food-row').filter({ hasText: name });

  // Tap the main button (nth(1) — dot is 0) to open GramsPicker in edit mode.
  await row.locator('button').nth(1).tap();
  await page.getByText('Edit amount').waitFor({ state: 'visible' });

  await page.getByRole('spinbutton').fill('200');
  // Confirm button in edit mode is 'Save' (GramsPicker.tsx:160).
  await page.getByRole('button', { name: 'Save', exact: true }).tap();

  // Editing an existing entry updates in place — still exactly one row.
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('200g');
});

test('[J-017] delete button in edit sheet removes the entry', async ({ page }) => {
  const name = 'E2E Edit Delete';
  await page.goto('/');
  await seedProductAndLog(page, name, MACROS, '100');

  const row = page.locator('.food-row').filter({ hasText: name });
  await row.locator('button').nth(1).tap();
  await page.getByText('Edit amount').waitFor({ state: 'visible' });

  // GramsPicker.tsx:262-269 — TrashIcon button with aria-label 'Delete entry'.
  // No confirmation dialog; one tap removes the row.
  await page.getByRole('button', { name: 'Delete entry' }).tap();

  await expect(row).toHaveCount(0);
});

test('[J-013] editing a product retroactively updates the row on the same day', async ({ page }) => {
  // The crown jewel: per CLAUDE.md, "Macros are computed, never stored."
  // entries only store grams + product_id; macro totals join products on every
  // read. After a product edit, App.tsx:419-420 refetches the day + week,
  // re-deriving macros via the sumMacros useMemo without a page reload.
  const name = 'E2E Edit Product';
  await page.goto('/');
  await seedProductAndLog(page, name, MACROS, '100');

  const row = page.locator('.food-row').filter({ hasText: name });
  // Anchored to the kcal column (FoodRow.tsx:65 renders rounded kcal as a
  // standalone integer node). `exact: true` forces the assertion past
  // substrings like "100g" or the time stamp — a flipped-comparator bug
  // that left kcal at 100 would still satisfy a loose toContainText("100").
  await expect(row.getByText('100', { exact: true })).toBeVisible();

  // Enter edit mode, then tap the pencil icon to escalate to product-edit.
  await row.locator('button').nth(1).tap();
  await page.getByText('Edit amount').waitFor({ state: 'visible' });
  // `exact: true` — the FoodRow behind the sheet has an accessible name that
  // substring-matches 'edit product' (the product's own name is 'E2E Edit
  // Product'), so Playwright's default substring match resolves two buttons.
  await page.getByRole('button', { name: 'Edit product', exact: true }).tap();

  // NewProductForm in mode='edit' — wait on the Save-changes button (unique
  // to edit mode) rather than the 'Edit Product' title, which collides with
  // other rendered text.
  await page.getByRole('button', { name: 'Save changes' }).waitFor({ state: 'visible' });
  await fillNutField(page, 'Kcal', '500');
  await page.getByRole('button', { name: 'Save changes' }).tap();

  // Sheet must close — Save-changes button is gone. Without the loadEntries
  // refetch, the modal would still close, but the row would still show 100.
  await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
  // Row's kcal column now reads 500 exactly. A bug that returned the stale
  // PUT response without invalidating the entries cache would fail here
  // because /entries returns the joined macros, not the cached macro.
  await expect(row.getByText('500', { exact: true })).toBeVisible();
  // And the old kcal value (100) is no longer present in the row at all —
  // proves no stale row leaked through. (100 also doesn't appear elsewhere:
  // grams="100g" is not exact "100", protein/carbs/fat are 10/10/2.)
  await expect(row.getByText('100', { exact: true })).toHaveCount(0);
});

test('[J-014] Add Temp Item flow renders a TMP badge on the row', async ({ page }) => {
  // FoodRow.tsx:54-56 — is_temp products render a 'TMP' badge next to the
  // product name. The temp flow is AddPicker search → 'Add Temp' button →
  // NewProductForm (isTemp=true, save button reads 'Add to Day') → GramsPicker.
  const name = 'E2E Temp Thing';
  await page.goto('/');

  await page.getByRole('button', { name: 'ADD FOOD' }).tap();
  await page.getByPlaceholder('Search products...').fill(name);
  await page.getByRole('button', { name: 'Add Temp' }).tap();

  // NewProductForm temp title (NewProductForm.tsx:209) — sync before filling
  // macros so inputs aren't hit mid-animation.
  await page.getByText('Add Temp Item').waitFor({ state: 'visible' });
  await fillNutField(page, 'Kcal', '50');
  await fillNutField(page, 'Protein', '5');
  await fillNutField(page, 'Carbs', '5');
  await fillNutField(page, 'Fat', '1');
  // Temp-mode confirm is 'Add to Day' (capital D) per NewProductForm.tsx:352 —
  // distinct from GramsPicker's 'Add to day' (lowercase d). `exact: true`
  // would collide because Playwright's name-match is already case-insensitive
  // by default; rely on the fact that only one of the two sheets is mounted.
  await page.getByRole('button', { name: 'Add to Day' }).tap();

  await page.getByText('How much?').waitFor({ state: 'visible' });
  await page.getByRole('spinbutton').fill('50');
  await page.getByRole('button', { name: /Add to day/ }).tap();

  const row = page.locator('.food-row').filter({ hasText: name });
  await expect(row.getByText('TMP')).toBeVisible();
});

test('[J-066] Atwater mismatch warning appears when kcal disagrees with macros by >5%', async ({ page }) => {
  // NewProductForm.tsx:154-166 — soft Atwater check: kcal ≈ 4·P + 4·C + 9·F.
  // Threshold is 5% of the larger of (actual, expected). A boundary mutation
  // (e.g. >0.05 → >0.50) would silence the warning entirely; an off-by-one
  // on the coefficients (4,4,9 → 4,9,4) would shift the implied kcal text.
  // Both classes of regression must be caught here.
  const name = 'E2E Atwater';
  await page.goto('/');
  // Seed with kcal=100, P=10, C=10, F=2 → Atwater = 4·10+4·10+9·2 = 98.
  // |100-98|/100 = 0.02 — below threshold, no warning at form open.
  await seedProductAndLog(page, name, MACROS, '100');

  const row = page.locator('.food-row').filter({ hasText: name });
  await row.locator('button').nth(1).tap();
  await page.getByText('Edit amount').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Edit product', exact: true }).tap();
  await page.getByRole('button', { name: 'Save changes' }).waitFor({ state: 'visible' });

  // Initially aligned — no warning rendered.
  await expect(page.getByText(/Macros imply ~\d+ kcal/)).toHaveCount(0);

  // Move kcal to 200 → ratio (200-98)/200 = 0.51, well above 5%.
  await fillNutField(page, 'Kcal', '200');

  // Expected text is the rounded Atwater integer — a coefficient typo
  // (e.g. 9·P + 4·F instead of 4·P + 9·F) would yield a different number.
  await expect(
    page.getByText('Macros imply ~98 kcal — double-check the label.'),
  ).toBeVisible();
});

test('[J-067] edit-mode kcal>2000 cap is rejected; form stays open', async ({ page }) => {
  // products.ts:299-302 — PUT /products/:id runs the same isProductBaseBody
  // check as POST. App.tsx:421-425 leaves the modal open on error so the
  // user can correct without losing their changes. Mutation: dropping the
  // `if (!isProductBaseBody...) return 400` would let kcal=2001 through and
  // close the sheet (test fails on the still-visible Save-changes assertion).
  const name = 'E2E Edit Cap';
  await page.goto('/');
  await seedProductAndLog(page, name, MACROS, '100');

  const row = page.locator('.food-row').filter({ hasText: name });
  await row.locator('button').nth(1).tap();
  await page.getByText('Edit amount').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Edit product', exact: true }).tap();
  await page.getByRole('button', { name: 'Save changes' }).waitFor({ state: 'visible' });

  // 2001 is the smallest over-the-cap value — proves the boundary, not just
  // some arbitrary large number that would also satisfy a loose >100 check.
  await fillNutField(page, 'Kcal', '2001');
  await page.getByRole('button', { name: 'Save changes' }).tap();

  // Form is still open — the journey is "rejection, do not close". Anchor on
  // the unique edit-mode button rather than the title (which substring-
  // matches "Edit product" on the FoodRow behind the sheet).
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible();
  // And the row's kcal column was NOT updated to the rejected value — the
  // PUT failed at the validator, so loadEntries was never called. 2001 must
  // not appear anywhere in the row text.
  await expect(row.getByText('2001')).toHaveCount(0);
});

test('[J-068] PUT /products/:id with unknown id returns 404 not_found', async ({ request }) => {
  // products.ts:316-319 — `update` runs scoped by created_by; an id that
  // doesn't exist (or belongs to another user) returns changes=0, which the
  // route translates to 404. 9_999_999 is far above any test seeding could
  // reach.
  const token = tokenFromAuthFile();
  const res = await request.put('/products/9999999', {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name: 'whatever',
      brand: null,
      unit: 'g',
      barcode: null,
      per100: { kcal: 100, protein: 10, carbs: 10, fat: 2 },
    },
  });
  expect(res.status()).toBe(404);
  expect(await res.json()).toEqual({ error: 'not_found' });
});

test('[J-069] PUT /products/:id with malformed id returns 400 invalid_id', async ({ request }) => {
  // products.ts:294-298 → parsePositiveInt returns null for zero, negatives,
  // and non-numerics; all three funnel through the same guard. Cover the
  // three flavors in one test to lock the contract.
  const token = tokenFromAuthFile();
  const validBody = {
    name: 'whatever',
    brand: null,
    unit: 'g' as const,
    barcode: null,
    per100: { kcal: 100, protein: 10, carbs: 10, fat: 2 },
  };
  for (const bad of ['0', '-1', 'abc']) {
    const res = await request.put(`/products/${bad}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: validBody,
    });
    expect(res.status(), `id="${bad}"`).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_id' });
  }
});

test('[J-070] PATCH /entries/:id with unknown id returns 404 not_found', async ({ request }) => {
  // entries.ts:181-185 — updateGrams returns changes=0 for an id outside the
  // user's scope; the route maps that to 404. Same pattern for tagged at :188.
  const token = tokenFromAuthFile();
  const res = await request.patch('/entries/9999999', {
    headers: { Authorization: `Bearer ${token}` },
    data: { grams: 200 },
  });
  expect(res.status()).toBe(404);
  expect(await res.json()).toEqual({ error: 'not_found' });
});

test('[J-071] PATCH /entries/:id with malformed id returns 400 invalid_id', async ({ request }) => {
  // entries.ts:170-173 → parsePositiveInt rejects 0, negatives, non-numerics.
  const token = tokenFromAuthFile();
  for (const bad of ['0', '-1', 'abc']) {
    const res = await request.patch(`/entries/${bad}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { grams: 200 },
    });
    expect(res.status(), `id="${bad}"`).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_id' });
  }
});

test('[J-072] PATCH /entries/:id with empty body returns 400 invalid_entry', async ({ request }) => {
  // entries.ts:63-69 — isUpdateEntryBody requires at least one of `grams`
  // or `tagged`. Empty {} is rejected so a stray no-op PATCH can't masquerade
  // as a successful update.
  const token = tokenFromAuthFile();
  const res = await request.patch('/entries/1', {
    headers: { Authorization: `Bearer ${token}` },
    data: {},
  });
  expect(res.status()).toBe(400);
  expect(await res.json()).toEqual({ error: 'invalid_entry' });
});

test('[J-073] PATCH /entries/:id rejects non-positive grams with 400 invalid_entry', async ({ request }) => {
  // guards.ts isPositiveFinite excludes 0, negatives, NaN, Infinity. Three
  // bad values exercise three branches: zero (the boundary), a negative,
  // and a string ("abc" coerces to NaN at the type-guard check). All must
  // funnel to 400 `invalid_entry` BEFORE the router touches any statement.
  const token = tokenFromAuthFile();
  const cases: Array<unknown> = [0, -10, 'abc'];
  for (const grams of cases) {
    const res = await request.patch('/entries/1', {
      headers: { Authorization: `Bearer ${token}` },
      data: { grams },
    });
    expect(res.status(), `grams=${JSON.stringify(grams)}`).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_entry' });
  }
});

test('[J-074] cancel in product-edit form returns to GramsPicker without issuing a PUT', async ({ page }) => {
  // App.tsx:586-592: edit-product onClose flips back to grams-picker (NOT
  // home). The Cancel button (NewProductForm.tsx:217-219) calls useSheetClose
  // → onClose. A regression that wired Cancel to onDismiss instead would land
  // the user on the home screen and silently lose the edit context.
  const name = 'E2E Edit Cancel';
  await page.goto('/');
  await seedProductAndLog(page, name, MACROS, '100');

  // Count PUT /products/:id requests. A bug that fired the PUT through Cancel
  // (e.g. wiring Cancel onClick to submit() by accident) would show up here
  // even if the UI assertions happened to pass.
  let putCount = 0;
  await page.route('**/products/*', async (route) => {
    if (route.request().method() === 'PUT') putCount++;
    await route.continue();
  });

  const row = page.locator('.food-row').filter({ hasText: name });
  await row.locator('button').nth(1).tap();
  await page.getByText('Edit amount').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Edit product', exact: true }).tap();
  await page.getByRole('button', { name: 'Save changes' }).waitFor({ state: 'visible' });

  // Modify a field — proves Cancel discards the dirty state, not just that
  // the form was opened-and-closed without changes.
  await fillNutField(page, 'Kcal', '999');

  // Cancel button (top-right of NewProductForm).
  await page.getByRole('button', { name: 'Cancel', exact: true }).tap();

  // Back to GramsPicker — Edit amount heading is mounted again.
  await expect(page.getByText('Edit amount')).toBeVisible();
  // Save-changes button must be unmounted — proves the edit form actually
  // closed, not just that "Edit amount" reappeared in the background stack.
  await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
  // No PUT was issued — the cancel discarded the in-flight kcal=999 change.
  expect(putCount).toBe(0);

  // Belt-and-suspenders: the row's kcal column is still 100 (unchanged).
  // Close GramsPicker by saving the unchanged grams, then check the row.
  await page.getByRole('spinbutton').fill('100');
  await page.getByRole('button', { name: 'Save', exact: true }).tap();
  await expect(row.getByText('100', { exact: true })).toBeVisible();
  await expect(row.getByText('999')).toHaveCount(0);
});
