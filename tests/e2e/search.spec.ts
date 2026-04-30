import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { seedProductAndLog } from './helpers';

// AddPicker search — server-side LIKE on (name, brand) + scope toggle (My
// Library vs Global) + idle Recent/All sections + clear-X reset. Implementation:
//   - AddPicker.tsx:71-97 — debounced /products/search with optional &global=1
//   - server/routes/products.ts:107-136 — /products/search handler + scope gate
//   - server/statements.ts:69-114 — `searchOwn` (own only) vs blended `search`
//
// Coverage in this spec:
//   J-118 — Clear-X resets q to '' and restores idle Recent/All
//   J-119 — Default scope is My Library (no &global=1); Global re-queries
//   J-120 — My Library hides barcoded cross-user; Global surfaces them
//   J-121 — Section header pluralization "1 result" vs "2 results"
//   J-122 — Idle list dedup: a logged product appears under Recent only
//   J-123 — Search matches against `brand` LIKE pattern, not just `name`
//   J-124 — addedProductIds CheckIcon also renders in search-results section
//   J-125 — GET /products/search short-circuits empty/whitespace q to []
//   J-126 — GET /products/search global flag is strict-equality '1'
//   J-127 — Blended results sort caller's own row before another user's
//
// J-120 / J-126 / J-127 need a barcoded row owned by user B; auth.setup2.ts
// wrote that token to user2.json. We seed via direct API as user B and drive
// the spec as user A (default storageState) — same pattern as adopt.spec.ts.

type StorageState = {
  origins: Array<{ localStorage: Array<{ name: string; value: string }> }>;
};

function tokenFrom(path: string): string {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as StorageState;
  const entry = parsed.origins[0]?.localStorage.find(
    (e) => e.name === 'kcal_session_token',
  );
  if (entry === undefined) throw new Error(`no session token in ${path}`);
  return entry.value;
}

test('[J-118] Clear-X resets the search query and restores the idle Recent/All view', async ({
  page,
}) => {
  // Seed one logged product so the idle Recent section has at least one row,
  // independent of accumulated state from prior specs.
  const seedName = `E2E ClearX ${Date.now()}`;
  await page.goto('/');
  await seedProductAndLog(page, seedName, { kcal: '100', protein: '10', carbs: '10', fat: '2' }, '100');

  await page.getByRole('button', { name: 'ADD FOOD' }).tap();
  const search = page.getByPlaceholder('Search products...');
  const picker = page.locator('.sheet').filter({ has: search });
  const clearBtn = picker.getByRole('button', { name: 'Clear', exact: true });

  // Idle: AddPicker.tsx:162 conditionally renders clearBtn only when `q` is
  // truthy. Empty q → button NOT in the DOM. Mutation: dropping the `q && ...`
  // gate would render the button at idle — caught here.
  await expect(clearBtn).toHaveCount(0);

  // Type a guaranteed-zero-match query — the 250 ms debounce + GET lands and
  // emptySearch fires (results === []).
  await search.fill(`xyzNoMatch${Date.now()}`);
  await expect(page.getByText('not in your library yet.')).toBeVisible();
  await expect(clearBtn).toBeVisible();

  // Tap clear: AddPicker.tsx:164 → setQ(''). showingSearch flips false; the
  // search effect's empty-trim early-return clears `results`, idle re-renders.
  // Mutation: dropping setQ('') would leave both clearBtn AND emptySearch
  // mounted indefinitely — both negative-paths below catch it.
  await clearBtn.tap();
  await expect(search).toHaveValue('');
  await expect(clearBtn).toHaveCount(0);
  await expect(page.getByText('not in your library yet.')).toHaveCount(0);

  // Recent header re-renders — proves the idle branch took over (not stuck
  // in loading or empty-search). Anchored by exact:true on the section label.
  await expect(picker.getByText('Recent', { exact: true })).toBeVisible();
});

test('[J-119] Default scope is My Library; tapping Global re-queries with ?global=1', async ({
  page,
}) => {
  // AddPicker.tsx:46 — `global` state defaults to false. AddPicker.tsx:87
  // appends `&global=1` only when global is true. Mutation surface: flipping
  // the default, removing `global` from the [debouncedQ, global] dep array,
  // or swapping the ternary would all be caught by the URL parity checks.
  await page.goto('/');
  await page.getByRole('button', { name: 'ADD FOOD' }).tap();
  const search = page.getByPlaceholder('Search products...');

  // Default scope: the next /products/search request must NOT carry &global=1.
  // Set the listener BEFORE the action so the post-debounce request resolves
  // it. The /products/recent and /products/all calls fire on AddPicker open
  // but don't match this predicate (different paths).
  const myLibraryReq = page.waitForRequest(
    (req) => req.url().includes('/products/search?q=') && req.method() === 'GET',
  );
  await search.fill(`xqsearch${Date.now()}`);
  const r1 = await myLibraryReq;
  expect(r1.url()).not.toContain('global=1');

  // Tap Global — `global` state flips, the dep-array re-fires the search
  // effect, this time with &global=1 appended.
  const globalReq = page.waitForRequest(
    (req) => req.url().includes('/products/search?q=') && req.url().includes('global=1'),
  );
  await page.getByRole('button', { name: 'Global', exact: true }).tap();
  const r2 = await globalReq;
  expect(r2.url()).toContain('global=1');
});

test('[J-120] My Library scope hides barcoded cross-user rows; Global surfaces them', async ({
  page,
  request,
}) => {
  // statements.ts:69-77 (searchOwn) filters strictly by created_by; statements
  // .ts:87-114 (blended search) opens up to barcoded cross-user rows via
  // `created_by = ? OR barcode IS NOT NULL`. The scope toggle is the only path
  // between them. Seed a barcoded row OWNED BY USER B and verify both sides
  // of the gate as user A.
  const tokenB = tokenFrom('tests/e2e/.auth/user2.json');
  const barcode = `593${Date.now()}`;
  const name = `E2E SearchCross ${Date.now()}`;
  const seed = await request.post('/products', {
    headers: { Authorization: `Bearer ${tokenB}` },
    data: {
      name,
      brand: null,
      unit: 'g',
      barcode,
      per100: { kcal: 100, protein: 10, carbs: 10, fat: 2 },
      is_temp: false,
    },
  });
  expect(seed.ok(), await seed.text()).toBeTruthy();

  await page.goto('/');
  await page.getByRole('button', { name: 'ADD FOOD' }).tap();
  const search = page.getByPlaceholder('Search products...');
  const picker = page.locator('.sheet').filter({ has: search });

  // My Library scope: emptySearch fires because user B's row is filtered out
  // by created_by. Negative-path scoped to button-role catches a regression
  // where searchOwn lost its created_by filter.
  await search.fill(name);
  await expect(page.getByText('not in your library yet.')).toBeVisible();
  await expect(picker.getByRole('button').filter({ hasText: name })).toHaveCount(0);

  // Toggle Global: the same query now hits the blended SQL — `barcode IS NOT
  // NULL` clears the candidates filter and the row appears.
  await page.getByRole('button', { name: 'Global', exact: true }).tap();
  await expect(picker.getByRole('button').filter({ hasText: name })).toHaveCount(1);
});

test('[J-121] Search section header pluralizes "result" / "results" on count', async ({
  page,
}) => {
  // AddPicker.tsx:204 — `${results.length} result${results.length === 1 ? '' : 's'}`.
  // Mutation: dropping or flipping the ternary would render "1 results" or
  // "2 result". The exact:true negative-path locator below catches it.
  const namePrefix = `E2E Plural ${Date.now()}`;
  await page.goto('/');
  await seedProductAndLog(
    page,
    `${namePrefix} A`,
    { kcal: '100', protein: '10', carbs: '10', fat: '2' },
    '100',
  );
  await seedProductAndLog(
    page,
    `${namePrefix} B`,
    { kcal: '120', protein: '12', carbs: '15', fat: '3' },
    '100',
  );

  await page.getByRole('button', { name: 'ADD FOOD' }).tap();
  const search = page.getByPlaceholder('Search products...');

  // Two-row match → "2 results" (plural). exact:true on both directions —
  // "2 result" without the s would substring-match "2 results", but exact
  // mode requires the full text node to equal the query.
  await search.fill(namePrefix);
  await expect(page.getByText('2 results', { exact: true })).toBeVisible();
  await expect(page.getByText('2 result', { exact: true })).toHaveCount(0);

  // Refine to a one-row match → "1 result" (singular).
  await search.fill(`${namePrefix} A`);
  await expect(page.getByText('1 result', { exact: true })).toBeVisible();
  await expect(page.getByText('1 results', { exact: true })).toHaveCount(0);
});

test('[J-122] Idle list dedup: a logged product appears under Recent only, never under All', async ({
  page,
  request,
}) => {
  // AddPicker.tsx:104-105 — `allMinusRecents = (allProducts ?? []).filter((p)
  // => !recentIds.has(p.id))`. Without that filter, every logged product
  // would appear twice (in Recent AND in All), confusing the user. Seed two
  // products: one logged via UI (→ Recent) and one unlogged via API (→ All
  // only) so both sections render and the dedup can be observed by row count.
  const prefix = `E2E Dedup ${Date.now()}`;
  await page.goto('/');
  await seedProductAndLog(
    page,
    `${prefix} Logged`,
    { kcal: '100', protein: '10', carbs: '10', fat: '2' },
    '100',
  );

  const tokenA = tokenFrom('tests/e2e/.auth/user.json');
  const seed = await request.post('/products', {
    headers: { Authorization: `Bearer ${tokenA}` },
    data: {
      name: `${prefix} Unlogged`,
      brand: null,
      unit: 'g',
      barcode: null,
      per100: { kcal: 80, protein: 5, carbs: 12, fat: 1 },
      is_temp: false,
    },
  });
  expect(seed.ok(), await seed.text()).toBeTruthy();

  await page.getByRole('button', { name: 'ADD FOOD' }).tap();
  const picker = page.locator('.sheet').filter({
    has: page.getByPlaceholder('Search products...'),
  });

  // Both section headers visible — proves recents.length > 0 AND
  // allMinusRecents.length > 0 conditionals both fired.
  await expect(picker.getByText('Recent', { exact: true })).toBeVisible();
  await expect(picker.getByText('All', { exact: true })).toBeVisible();

  // The logged product appears EXACTLY ONCE in the AddPicker — proves dedup.
  // A bug dropping the !recentIds.has(p.id) filter would render it twice.
  const loggedRows = picker.getByRole('button').filter({ hasText: `${prefix} Logged` });
  await expect(loggedRows).toHaveCount(1);

  // Unlogged sibling appears once (sanity) — confirms /products/all is
  // populated and the row didn't accidentally land in Recent.
  const unloggedRows = picker.getByRole('button').filter({ hasText: `${prefix} Unlogged` });
  await expect(unloggedRows).toHaveCount(1);
});

test('[J-123] Search matches against brand, not just name', async ({ page, request }) => {
  // statements.ts:74 + 94 — both `searchOwn` and the blended `search` include
  // `(name LIKE ? OR (brand IS NOT NULL AND brand LIKE ?))`. Mutation:
  // dropping the brand branch would render zero results when searching by
  // brand alone. API seed since the journey is server-side LIKE behavior,
  // not the NewProductForm Brand input.
  const tokenA = tokenFrom('tests/e2e/.auth/user.json');
  const brandUnique = `Zebra${Date.now()}`;
  const productName = `E2E BrandSearch ${Date.now()}`;
  const seed = await request.post('/products', {
    headers: { Authorization: `Bearer ${tokenA}` },
    data: {
      name: productName,
      brand: brandUnique,
      unit: 'g',
      barcode: null,
      per100: { kcal: 100, protein: 5, carbs: 10, fat: 2 },
      is_temp: false,
    },
  });
  expect(seed.ok(), await seed.text()).toBeTruthy();

  await page.goto('/');
  await page.getByRole('button', { name: 'ADD FOOD' }).tap();
  // Searching by the brand alone — `productName` does NOT contain `brandUnique`,
  // so a name-only LIKE branch wouldn't surface this row.
  await page.getByPlaceholder('Search products...').fill(brandUnique);

  const picker = page.locator('.sheet').filter({
    has: page.getByPlaceholder('Search products...'),
  });
  await expect(picker.getByRole('button').filter({ hasText: productName })).toHaveCount(1);
});

test('[J-124] addedProductIds check icon also renders in search-results rows (parity with idle Recent)', async ({
  page,
  request,
}) => {
  // AddPicker.tsx:113-132 — renderRow is shared between the idle (Recent /
  // All) branch and the search-results branch. J-106 covers the idle Recent
  // path; this covers the search-results path. A mutation that branched
  // renderRow per-section and dropped `addedProductIds` on the search side
  // would slip past J-106 entirely.
  const prefix = `E2E SearchCheck ${Date.now()}`;
  await page.goto('/');
  await seedProductAndLog(
    page,
    `${prefix} Logged`,
    { kcal: '100', protein: '5', carbs: '10', fat: '2' },
    '100',
  );

  const tokenA = tokenFrom('tests/e2e/.auth/user.json');
  const seed = await request.post('/products', {
    headers: { Authorization: `Bearer ${tokenA}` },
    data: {
      name: `${prefix} Unlogged`,
      brand: null,
      unit: 'g',
      barcode: null,
      per100: { kcal: 80, protein: 5, carbs: 12, fat: 1 },
      is_temp: false,
    },
  });
  expect(seed.ok(), await seed.text()).toBeTruthy();

  await page.getByRole('button', { name: 'ADD FOOD' }).tap();
  await page.getByPlaceholder('Search products...').fill(prefix);

  const picker = page.locator('.sheet').filter({
    has: page.getByPlaceholder('Search products...'),
  });
  // Anchor on the section header to prove the search branch is rendered
  // (not the idle Recent/All branch).
  await expect(picker.getByText('2 results', { exact: true })).toBeVisible();

  const loggedRow = picker.getByRole('button').filter({ hasText: `${prefix} Logged` });
  const unloggedRow = picker.getByRole('button').filter({ hasText: `${prefix} Unlogged` });
  // CheckIcon is the only SVG inside an AddPicker product row (MacroBreakdown
  // is plain text spans, no icons). 1 vs 0 SVG count is a faithful proxy that
  // sidesteps hashed CSS module class names — same pattern as J-106.
  await expect(loggedRow.locator('svg')).toHaveCount(1);
  await expect(unloggedRow.locator('svg')).toHaveCount(0);
});

test('[J-125] GET /products/search short-circuits empty / whitespace q to []', async ({
  request,
}) => {
  // products.ts:107-113 — the route trims `q` and returns [] before ever
  // touching SQL when it's empty. Mutation: dropping the early-return would
  // feed pattern='%%' into LIKE and surface every product the user has —
  // both a perf concern (full-table scan) and, on the global branch, a
  // privacy-adjacent issue (pulls the entire cross-user catalog).
  const token = tokenFrom('tests/e2e/.auth/user.json');
  const cases = [
    '/products/search',
    '/products/search?q=',
    '/products/search?q=%20%20', // whitespace-only after URL decode
    // Same short-circuit must apply on the global branch — products.ts orders
    // q-trim BEFORE the global gate, so any of these stays []. A re-ordering
    // mutation would break this.
    '/products/search?q=&global=1',
    '/products/search?global=1',
  ];
  for (const path of cases) {
    const res = await request.get(path, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status(), path).toBe(200);
    expect(await res.json(), path).toEqual([]);
  }
});

test('[J-126] GET /products/search global flag is strict-equality "1" (not truthy)', async ({
  request,
}) => {
  // products.ts:117-118 — `global = typeof rawGlobal === 'string' && rawGlobal === '1'`.
  // Mutation: replacing `=== '1'` with `Boolean(rawGlobal)` or `!== ''` would
  // make every non-empty value enable the cross-user blend, breaking the
  // client's ability to opt out via `?global=0`. Seed a barcoded row as user B
  // and verify each value either hides (default scope) or surfaces (global=1)
  // user B's row from user A's perspective.
  const tokenA = tokenFrom('tests/e2e/.auth/user.json');
  const tokenB = tokenFrom('tests/e2e/.auth/user2.json');
  const barcode = `594${Date.now()}`;
  // Name must round-trip unchanged through normalizeProductName (sentence
  // case): single-token, lowercase except first char. Otherwise the strict
  // r.name === name comparison below would never match the stored row.
  const name = `Strictglobal${Date.now()}`;
  const seed = await request.post('/products', {
    headers: { Authorization: `Bearer ${tokenB}` },
    data: {
      name,
      brand: null,
      unit: 'g',
      barcode,
      per100: { kcal: 100, protein: 10, carbs: 10, fat: 2 },
      is_temp: false,
    },
  });
  expect(seed.ok(), await seed.text()).toBeTruthy();

  // Baseline: only `global=1` activates the cross-user blended path and
  // surfaces user B's barcoded row to user A.
  const baseline = await request.get(
    `/products/search?q=${encodeURIComponent(name)}&global=1`,
    { headers: { Authorization: `Bearer ${tokenA}` } },
  );
  expect(baseline.ok()).toBeTruthy();
  const baselineRows = (await baseline.json()) as Array<{ name: string }>;
  expect(baselineRows.find((r) => r.name === name)).toBeDefined();

  // Every other value (truthy strings, '0', empty) must fall back to My Library
  // scope, hiding the cross-user row.
  for (const val of ['', '0', 'true', 'yes', '11', '2']) {
    const res = await request.get(
      `/products/search?q=${encodeURIComponent(name)}&global=${val}`,
      { headers: { Authorization: `Bearer ${tokenA}` } },
    );
    expect(res.ok(), `global=${val}`).toBeTruthy();
    const rows = (await res.json()) as Array<{ name: string }>;
    expect(rows.find((r) => r.name === name), `global=${val}`).toBeUndefined();
  }
  // Without the param at all → also default scope.
  const missing = await request.get(
    `/products/search?q=${encodeURIComponent(name)}`,
    { headers: { Authorization: `Bearer ${tokenA}` } },
  );
  expect(missing.ok()).toBeTruthy();
  const missingRows = (await missing.json()) as Array<{ name: string }>;
  expect(missingRows.find((r) => r.name === name)).toBeUndefined();
});

test("[J-127] Blended search results sort the caller's own row before another user's (is_mine DESC)", async ({
  request,
}) => {
  // statements.ts:112 — `ORDER BY is_mine DESC, name COLLATE NOCASE ASC`.
  // Pick names so alphabetical alone would put user B's row first
  // (`A ...` < `Z ...`); only the is_mine DESC clause can flip the order so
  // user A's `Z ...` comes first. Mutation: dropping is_mine DESC → results
  // alphabetize and the index assertion below fails.
  const tokenA = tokenFrom('tests/e2e/.auth/user.json');
  const tokenB = tokenFrom('tests/e2e/.auth/user2.json');
  // Names must round-trip unchanged through normalizeProductName (sentence
  // case). Single-token names with only the first char uppercase satisfy
  // that. Pick first chars so alphabetical ASC alone would put nameB first
  // (`A...` < `Z...`); only the is_mine DESC clause flips the order so
  // user A's row comes first.
  const sharedToken = `sortmix${Date.now()}`;
  const nameA = `Z${sharedToken}`;
  const nameB = `A${sharedToken}`;
  const barcodeA = `595${Date.now()}A`;
  const barcodeB = `595${Date.now()}B`;

  const seedA = await request.post('/products', {
    headers: { Authorization: `Bearer ${tokenA}` },
    data: {
      name: nameA,
      brand: null,
      unit: 'g',
      barcode: barcodeA,
      per100: { kcal: 100, protein: 10, carbs: 10, fat: 2 },
      is_temp: false,
    },
  });
  expect(seedA.ok(), await seedA.text()).toBeTruthy();
  const seedB = await request.post('/products', {
    headers: { Authorization: `Bearer ${tokenB}` },
    data: {
      name: nameB,
      brand: null,
      unit: 'g',
      barcode: barcodeB,
      per100: { kcal: 200, protein: 20, carbs: 20, fat: 4 },
      is_temp: false,
    },
  });
  expect(seedB.ok(), await seedB.text()).toBeTruthy();

  const res = await request.get(
    `/products/search?q=${encodeURIComponent(sharedToken)}&global=1`,
    { headers: { Authorization: `Bearer ${tokenA}` } },
  );
  expect(res.ok()).toBeTruthy();
  const rows = (await res.json()) as Array<{ name: string; is_mine?: boolean }>;
  // sharedToken is unique per Date.now(), so this filter resolves to exactly
  // these two seeds — robust against accidental matches from prior specs.
  const ours = rows.filter((r) => r.name.includes(sharedToken));
  expect(ours).toHaveLength(2);

  // is_mine DESC means user A's "Z ..." row precedes user B's "A ...".
  // findIndex + LessThan keeps the assertion order-explicit; a mutation
  // dropping the is_mine DESC clause would alphabetize and put nameB first.
  const indexA = ours.findIndex((r) => r.name === nameA);
  const indexB = ours.findIndex((r) => r.name === nameB);
  expect(indexA).toBeGreaterThanOrEqual(0);
  expect(indexB).toBeGreaterThanOrEqual(0);
  expect(indexA).toBeLessThan(indexB);

  // Anchor the is_mine projection too — products.ts:127 maps via
  // searchRowToProduct, so the field is present on both rows. A mutation
  // that hard-coded is_mine=true (or dropped the projection) would still
  // produce the right ORDER but flunk one of the equality checks.
  const rowA = ours.find((r) => r.name === nameA);
  const rowB = ours.find((r) => r.name === nameB);
  expect(rowA?.is_mine).toBe(true);
  expect(rowB?.is_mine).toBe(false);
});
