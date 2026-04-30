import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fillNutField } from './helpers';

// Product CREATION specifics not owned by another spec. The retroactive-edit
// invariant lives in edit.spec.ts (J-013); kcal>2000 + XSS in validation.spec.ts
// (J-011/J-012); the two-tap delete + cascade in delete.spec.ts (J-058..J-065);
// the disabled-until-filled gating in entry.spec.ts (J-086). What's left for
// this spec: unit toggle (g/ml), brand round-trip, per-macro range guards
// across the four fields, and the full isNewProductBody body-shape contract.

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

test('[J-109] unit toggle to ml flips "Per 100ml" label and persists unit:"ml"', async ({
  page,
  request,
}) => {
  // NewProductForm.tsx:302 renders the macro card label as `Per 100${unit}`,
  // and NewProductForm.tsx:289-298 maps the toggle buttons to setUnit('g'|'ml').
  // Mutation that hard-codes the POST body unit (App.tsx:395-406) would let
  // the form *display* "Per 100ml" but persist 'g'; the GET round-trip at the
  // bottom catches that. Mutation that swaps the JSX template literal to
  // `Per 100g` (a hardcode) is caught by the toggle assertions above.
  const name = `E2E Unit ML ${Date.now()}`;
  await page.goto('/');
  await page.getByRole('button', { name: 'ADD FOOD' }).tap();
  await page.getByRole('button', { name: 'Add New' }).tap();

  // Default state is 'g' → label reads "Per 100g". `exact: true` to avoid
  // matching AddPicker's lowercase "per 100g" section header (which isn't
  // mounted right now anyway, but keeps the assertion robust to a regression
  // that left it stacked behind the form).
  await expect(page.getByText('Per 100g', { exact: true })).toBeVisible();

  // Tap the Millilitres button. Both unit buttons live inside the Sheet, so
  // tap() — click() drops on the Pixel 7 mobile profile.
  await page.getByRole('button', { name: 'Millilitres' }).tap();

  // Label flipped. Asserting the "Per 100g" label is GONE proves it's the
  // same span swapping content (template-literal interpolation), not a stale
  // co-render bug.
  await expect(page.getByText('Per 100ml', { exact: true })).toBeVisible();
  await expect(page.getByText('Per 100g', { exact: true })).toHaveCount(0);

  await page.getByPlaceholder('e.g. Peanut Butter').fill(name);
  await fillNutField(page, 'Kcal', '50');
  await fillNutField(page, 'Protein', '0');
  await fillNutField(page, 'Carbs', '12');
  await fillNutField(page, 'Fat', '0');
  await page.getByRole('button', { name: /Save & Continue/ }).tap();

  // Log 100ml so the row appears with the unit string suffix.
  await page.getByText('How much?').waitFor({ state: 'visible' });
  await page.getByRole('spinbutton').fill('100');
  await page.getByRole('button', { name: /Add to day/ }).tap();

  // FoodRow.tsx:59 renders `${grams}${unit}`. A regression that ignored the
  // unit toggle in the POST body would land here as "100g".
  const row = page.locator('.food-row').filter({ hasText: name });
  await expect(row).toContainText('100ml');
  await expect(row.getByText('100g')).toHaveCount(0);

  // Server round-trip: GET /products/all goes through rowToProduct
  // (products.ts:69) which projects unit verbatim. This is the load-bearing
  // assertion — the FoodRow string above could be satisfied by a UI bug
  // that displayed unit from the form's local state without persisting it.
  // Comparison is case-insensitive because normalizeProductName
  // (shared/normalize.ts:14) sentence-cases the stored name (`E2E ...` →
  // `E2e ...`); identity here is established by the unique Date.now() suffix,
  // not by case.
  const token = tokenFromAuthFile();
  const res = await request.get('/products/all', {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok()).toBeTruthy();
  const products = (await res.json()) as Array<{ name: string; unit: 'g' | 'ml' }>;
  const saved = products.find((p) => p.name.toLowerCase() === name.toLowerCase());
  expect(saved, 'newly created ml product missing from /products/all').toBeDefined();
  expect(saved!.unit).toBe('ml');
});

test('[J-110] brand persists through create and renders in row + AddPicker', async ({
  page,
}) => {
  // NewProductForm.tsx:254-261 — the Brand field is a ClearableField, sent in
  // the POST body as `brand.trim() || null` (line 174). Two consumers render
  // it: FoodRow.tsx:60 case-preserved with a "·" separator; AddPicker.tsx:123
  // uppercased via .toUpperCase(). Picking a brand value with explicit mixed
  // case ("Atlas Farms") makes the two assertions catch independent bugs:
  //   - if FoodRow normalised case, the row check fails.
  //   - if AddPicker dropped the .toUpperCase(), the picker check fails.
  // A regression that dropped brand entirely from the POST body fails both.
  const name = `E2E Brand ${Date.now()}`;
  const brand = 'Atlas Farms';
  await page.goto('/');
  await page.getByRole('button', { name: 'ADD FOOD' }).tap();
  await page.getByRole('button', { name: 'Add New' }).tap();

  await page.getByPlaceholder('e.g. Peanut Butter').fill(name);
  // Climb from the Brand <label> to its sibling input. /^Brand$/ excludes
  // the "Name *" and "Barcode" labels, both of which also wrap a textbox.
  await page
    .locator('label')
    .filter({ hasText: /^Brand$/ })
    .locator('..')
    .getByRole('textbox')
    .fill(brand);
  await fillNutField(page, 'Kcal', '100');
  await fillNutField(page, 'Protein', '10');
  await fillNutField(page, 'Carbs', '10');
  await fillNutField(page, 'Fat', '2');
  await page.getByRole('button', { name: /Save & Continue/ }).tap();

  await page.getByText('How much?').waitFor({ state: 'visible' });
  await page.getByRole('spinbutton').fill('100');
  await page.getByRole('button', { name: /Add to day/ }).tap();

  // Row carries the brand case-preserved (FoodRow.tsx:60).
  const row = page.locator('.food-row').filter({ hasText: name });
  await expect(row).toContainText(brand);

  // Reopen AddPicker, scope to our product by name, verify the brand pill
  // renders UPPERCASED. Mixed-case input → uppercase output proves the
  // .toUpperCase() at AddPicker.tsx:123 is still in play; if a regression
  // stripped it, "Atlas Farms" (mixed case) would not match exact "ATLAS FARMS".
  await page.getByRole('button', { name: 'ADD FOOD' }).tap();
  await page.getByPlaceholder('Search products...').fill(name);
  const picker = page
    .locator('.sheet')
    .filter({ has: page.getByPlaceholder('Search products...') });
  await expect(picker.getByText('ATLAS FARMS', { exact: true })).toBeVisible();
  // And the case-preserved spelling is NOT visible inside the picker — proves
  // the uppercase transform actually replaced rather than appended.
  await expect(picker.getByText(brand, { exact: true })).toHaveCount(0);
});

test('[J-111] POST /products rejects per100 macro out-of-range across all four fields', async ({
  request,
}) => {
  // products.ts:233-242 isPer100 enforces:
  //   kcal in [0, 2000], protein/carbs/fat each in [0, 200].
  // J-011 already exercises the kcal cap end-to-end via the UI; this spec
  // pins the FULL contract at the route level: each macro × {cap, floor}
  // is its own boundary case (8 cases). 2001/201 are the smallest cap
  // violations; -1 is the smallest floor violation. Any single mutation
  // (e.g. `kcal <= 2000` → `kcal < 2000`) collapses one case and keeps the
  // other seven green — so the failure points directly at the regressed
  // macro/direction.
  const token = tokenFromAuthFile();
  const valid = {
    name: 'E2E Cap Probe',
    brand: null,
    unit: 'g' as const,
    barcode: null,
    is_temp: false,
    per100: { kcal: 100, protein: 10, carbs: 10, fat: 2 },
  };
  const cases: Array<{ label: string; per100: typeof valid.per100 }> = [
    { label: 'kcal=2001 (cap)', per100: { ...valid.per100, kcal: 2001 } },
    { label: 'kcal=-1 (floor)', per100: { ...valid.per100, kcal: -1 } },
    { label: 'protein=201 (cap)', per100: { ...valid.per100, protein: 201 } },
    { label: 'protein=-1 (floor)', per100: { ...valid.per100, protein: -1 } },
    { label: 'carbs=201 (cap)', per100: { ...valid.per100, carbs: 201 } },
    { label: 'carbs=-1 (floor)', per100: { ...valid.per100, carbs: -1 } },
    { label: 'fat=201 (cap)', per100: { ...valid.per100, fat: 201 } },
    { label: 'fat=-1 (floor)', per100: { ...valid.per100, fat: -1 } },
  ];
  for (const c of cases) {
    const res = await request.post('/products', {
      headers: { Authorization: `Bearer ${token}` },
      data: { ...valid, per100: c.per100 },
    });
    expect(res.status(), c.label).toBe(400);
    expect(await res.json(), c.label).toEqual({ error: 'invalid_product' });
  }
});

test('[J-112] POST /products rejects each isNewProductBody structural branch', async ({
  request,
}) => {
  // products.ts:244-257 → isProductBaseBody (six branches) +
  // isNewProductBody (one extra: is_temp must be boolean). One case per
  // branch, each tripping exactly that branch:
  //   - name whitespace-only (trim().length === 0)
  //   - name length > 200
  //   - brand length > 120 (when non-null)
  //   - barcode length > 64 (when non-null)
  //   - unit not 'g'|'ml'
  //   - per100 not isPer100 (missing object)
  //   - is_temp missing entirely
  //   - is_temp non-boolean (string 'false' is the classic false-positive)
  // Eight independent branches; mutation in any one will break exactly one
  // case, surfacing the regression precisely.
  const token = tokenFromAuthFile();
  const valid = {
    name: 'E2E Body Probe',
    brand: null,
    unit: 'g' as const,
    barcode: null,
    is_temp: false,
    per100: { kcal: 100, protein: 10, carbs: 10, fat: 2 },
  };
  // Two omitted-field bodies built by destructuring so the intent is visible
  // at the case site (vs. setting fields to undefined, which JSON-serialises
  // identically but reads as a typo).
  const { is_temp: _dropTemp, ...validNoTemp } = valid;
  const { per100: _dropPer100, ...validNoPer100 } = valid;
  const cases: Array<{ label: string; body: Record<string, unknown> }> = [
    { label: 'name whitespace-only', body: { ...valid, name: '   ' } },
    { label: 'name >200 chars', body: { ...valid, name: 'a'.repeat(201) } },
    { label: 'brand >120 chars', body: { ...valid, brand: 'b'.repeat(121) } },
    { label: 'barcode >64 chars', body: { ...valid, barcode: '0'.repeat(65) } },
    { label: 'unit invalid (kg)', body: { ...valid, unit: 'kg' } },
    { label: 'per100 missing', body: validNoPer100 },
    { label: 'is_temp missing', body: validNoTemp },
    { label: 'is_temp string', body: { ...valid, is_temp: 'false' } },
  ];
  for (const c of cases) {
    const res = await request.post('/products', {
      headers: { Authorization: `Bearer ${token}` },
      data: c.body,
    });
    expect(res.status(), c.label).toBe(400);
    expect(await res.json(), c.label).toEqual({ error: 'invalid_product' });
  }
});
