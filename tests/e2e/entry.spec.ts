import { expect, test } from '@playwright/test';
import { tokenFrom } from './auth-helpers';
import { fillNutField, seedProductAndLog } from './helpers';

// auth.setup.ts persisted user A's session token to user.json. Several contract
// tests below need a bearer token to hit /entries directly without driving the
// UI. For the cross-user isolation test (J-081) we also need user B's token —
// that's user2.json (auth.setup2.ts).
test('[J-010] create new product, save & continue, log to day', async ({ page }) => {
  await page.goto('/');

  // Add flow: home → AddPicker → NewProductForm.
  // NOTE: buttons inside Sheet modals respond to touch events, not mouse.
  // Use tap() on mobile device profiles, not click().
  await page.getByRole('button', { name: 'ADD FOOD' }).tap();
  await page.getByRole('button', { name: 'Add New' }).tap();

  await page.getByPlaceholder('e.g. Peanut Butter').fill('E2E Oats');
  await fillNutField(page, 'Kcal', '400');
  await fillNutField(page, 'Protein', '15');
  await fillNutField(page, 'Carbs', '60');
  await fillNutField(page, 'Fat', '8');
  await page.getByRole('button', { name: /Save & Continue/ }).tap();

  // GramsPicker opens (Save & Continue flows into it). Fill 150g and log.
  // We fill the input directly rather than tapping the quick-value button,
  // because once a recent-grams history exists, the quick list shrinks and
  // the 50/100/150/200/250 DEFAULT buttons get replaced — causing detach flake.
  await expect(page.getByText('How much?')).toBeVisible();
  await page.getByRole('spinbutton').fill('150');
  await page.getByRole('button', { name: /Add to day/ }).tap();

  // 150g × 400 kcal/100g = 600 kcal — proves macros computed from the new
  // product. Exact-match scoped inside the row catches a mutation flipping
  // the divisor (e.g. /100 → /1000 would produce 60 and pass `toContainText('600')`
  // since 60 is a substring of 600 in the row's serialized text).
  const row = page.locator('.food-row').filter({ hasText: 'E2E Oats' });
  await expect(row.getByText('600', { exact: true })).toBeVisible();
  // Grams string also rendered — proves the entry's `grams` field round-tripped
  // through the POST /entries response (FoodRow.tsx renders {grams}{unit}).
  await expect(row).toContainText('150g');
});

test('[J-015] pick existing product from AddPicker, log to day', async ({ page }) => {
  // J-015 is the "log a product I've used before" flow — distinct from J-010,
  // which always goes through Add New. Seed once via the helper, then re-log
  // through the existing-product search path.
  const name = 'E2E Existing Log';
  const macros = { kcal: '100', protein: '10', carbs: '10', fat: '2' };
  await page.goto('/');
  await seedProductAndLog(page, name, macros, '100');

  await page.getByRole('button', { name: 'ADD FOOD' }).tap();
  // Scope the text match to the AddPicker sheet — getByText(name) would also
  // hit the food-row beneath the open sheet and tap the wrong target.
  const picker = page
    .locator('.sheet')
    .filter({ has: page.getByPlaceholder('Search products...') });
  await picker.getByText(name).first().tap();

  await expect(page.getByText('How much?')).toBeVisible();
  // Override the recent-grams pre-fill (100g) so this log is distinguishable
  // from the seeded one — strict counts below would tolerate a bug that
  // accidentally double-inserted the seed entry.
  await page.getByRole('spinbutton').fill('200');
  await page.getByRole('button', { name: /Add to day/ }).tap();

  // Two distinct rows now: the seeded 100g and this fresh 200g log.
  const rows = page.locator('.food-row').filter({ hasText: name });
  await expect(rows).toHaveCount(2);
  // Each row carries its own grams — proves the second log inserted a new
  // entry (not overwrote the first). A mutation that PUT-style replaced the
  // entry instead of POST-style appending would leave only one row at 200g.
  await expect(rows.filter({ hasText: '100g' })).toHaveCount(1);
  await expect(rows.filter({ hasText: '200g' })).toHaveCount(1);
});

test('[J-168] future-day entries stay in insertion order across reload', async ({ page }) => {
  const name = `E2E Future Order ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const rows = page.locator('.food-row').filter({ hasText: name });

  // Start on a Monday afternoon, select Tuesday, and pre-log an item. The
  // browser clock drives App's timezone-free local_date/local_time fields;
  // setFixedTime leaves animation timers running normally.
  await page.clock.setFixedTime(new Date(2030, 0, 7, 16, 0));
  await page.goto('/');
  const selectedDayLoad = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === '/entries' && url.searchParams.get('date') === '2030-01-08';
  });
  await page.getByRole('button', { name: 'T 8', exact: true }).first().tap();
  await selectedDayLoad;
  await seedProductAndLog(
    page,
    name,
    { kcal: '100', protein: '10', carbs: '10', fat: '2' },
    '160',
  );

  const logExisting = async (grams: string) => {
    await page.getByRole('button', { name: 'ADD FOOD' }).tap();
    const picker = page
      .locator('.sheet')
      .filter({ has: page.getByPlaceholder('Search products...') });
    // Stored product-name normalization changes "E2E" to "E2e"; the normal
    // string matcher is case-insensitive while exact matching is not.
    await picker.getByText(name).first().tap();
    await page.getByText('How much?', { exact: true }).waitFor({ state: 'visible' });
    await page.getByRole('spinbutton').fill(grams);
    await page.getByRole('button', { name: /Add to day/ }).tap();
  };

  // The next morning's entry has an earlier HH:MM, but it must append after
  // the pre-log. A later same-day entry appends after both.
  await page.clock.setFixedTime(new Date(2030, 0, 8, 8, 0));
  await logExisting('80');
  await expect(rows).toHaveCount(2);

  await page.clock.setFixedTime(new Date(2030, 0, 8, 17, 0));
  await logExisting('170');

  const expectInsertionOrder = async () => {
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('160g');
    await expect(rows.nth(0)).toContainText('16:00');
    await expect(rows.nth(1)).toContainText('80g');
    await expect(rows.nth(1)).toContainText('08:00');
    await expect(rows.nth(2)).toContainText('170g');
    await expect(rows.nth(2)).toContainText('17:00');
  };

  // First assertion covers useEntries' live cache; reload covers the server's
  // SELECT ordering. The HH:MM labels intentionally remain unchanged.
  await expectInsertionOrder();
  await page.reload();
  await expectInsertionOrder();
});

test('[J-085] re-logging an existing product pre-fills grams from recent history', async ({
  page,
}) => {
  // GramsPicker.tsx — when mode is 'add' and the user hasn't typed,
  // the spinbutton resets from the default 100 to history[0] (the most
  // recently logged grams) once /entries/recent-grams returns. This is the
  // "log it the way I did last time" UX shortcut.
  //
  // Mutation: dropping `setGrams(history[0]!)` would leave the input at 100
  // forever, regardless of past logs. Use 175g — distinct from the default
  // (100) and the legacy DEFAULT_QUICK_VALUES so a coincidence can't paper
  // over the regression.
  const name = 'E2E Recent Grams';
  const macros = { kcal: '120', protein: '8', carbs: '12', fat: '3' };
  await page.goto('/');
  await seedProductAndLog(page, name, macros, '175');

  await page.getByRole('button', { name: 'ADD FOOD' }).tap();
  const picker = page
    .locator('.sheet')
    .filter({ has: page.getByPlaceholder('Search products...') });
  await picker.getByText(name).first().tap();
  await page.getByText('How much?').waitFor({ state: 'visible' });

  // toHaveValue auto-retries until GramsPicker's recent-grams effect
  // overwrites the 100 default with 175. A bug that left the default in
  // place would time out here.
  await expect(page.getByRole('spinbutton')).toHaveValue('175');
});

test('[J-086] Save & Continue is disabled until name and all four macros are filled', async ({
  page,
}) => {
  // NewProductForm.tsx — `valid` requires name.trim().length > 0
  // AND every per-100 macro to be a number. Mutation: dropping any one of
  // the four `kcal !== '' && protein !== '' && carbs !== '' && fat !== ''`
  // checks would let the form submit with an empty field, and the server's
  // isPer100 guard would 400 it — but only after we've sent garbage upstream.
  await page.goto('/');
  await page.getByRole('button', { name: 'ADD FOOD' }).tap();
  await page.getByRole('button', { name: 'Add New' }).tap();

  const submit = page.getByRole('button', { name: /Save & Continue/ });

  // All five fields empty at form open — disabled.
  await expect(submit).toBeDisabled();

  // Fill name + four macros — button toggles to enabled.
  await page.getByPlaceholder('e.g. Peanut Butter').fill('E2E Gating');
  await fillNutField(page, 'Kcal', '100');
  await fillNutField(page, 'Protein', '10');
  await fillNutField(page, 'Carbs', '10');
  await fillNutField(page, 'Fat', '2');
  await expect(submit).toBeEnabled();

  // NutField wires onFocus={() => onChange('')} (NewProductForm.tsx) so
  // refocusing kcal alone clears just that field. Button must flip back to
  // disabled — proves kcal !== '' is load-bearing in the `valid` expression.
  await page
    .locator('label')
    .filter({ hasText: /^Kcal$/ })
    .locator('..')
    .getByRole('spinbutton')
    .focus();
  await expect(submit).toBeDisabled();
});

test('[J-079] POST /entries with malformed body returns 400 invalid_entry', async ({
  request,
}) => {
  // entries.ts → isNewEntryBody chains four guards: product_id positive
  // int, grams accepted by isEntryAmount, local_date matches DATE_RE, local_time matches
  // TIME_RE. Each malformed body below fails exactly one branch, so all four
  // guard mutations are caught.
  const token = tokenFrom('tests/e2e/.auth/user.json');
  const today = new Date().toISOString().slice(0, 10);
  const cases: Array<{ label: string; body: unknown }> = [
    // Missing product_id — isPositiveInt(undefined) → false.
    { label: 'product_id missing', body: { grams: 100, local_date: today, local_time: '12:00' } },
    // product_id zero — isPositiveInt rejects 0 (must be > 0).
    { label: 'product_id=0', body: { product_id: 0, grams: 100, local_date: today, local_time: '12:00' } },
    // grams zero — isEntryAmount rejects 0.
    { label: 'grams=0', body: { product_id: 1, grams: 0, local_date: today, local_time: '12:00' } },
    // grams negative — isEntryAmount rejects negatives.
    { label: 'grams=-5', body: { product_id: 1, grams: -5, local_date: today, local_time: '12:00' } },
    // Bad date format — DATE_RE requires \d{4}-\d{2}-\d{2}.
    { label: 'local_date=2026/01/01', body: { product_id: 1, grams: 100, local_date: '2026/01/01', local_time: '12:00' } },
    // Bad time format — TIME_RE requires \d{2}:\d{2}.
    { label: 'local_time=25-00', body: { product_id: 1, grams: 100, local_date: today, local_time: '25-00' } },
    // Empty body — isObject({}) is true, but every field guard fails.
    { label: 'empty body', body: {} },
  ];
  for (const { label, body } of cases) {
    const res = await request.post('/entries', {
      headers: { Authorization: `Bearer ${token}` },
      data: body,
    });
    expect(res.status(), label).toBe(400);
    expect(await res.json(), label).toEqual({ error: 'invalid_entry' });
  }
});

test('[J-080] POST /entries with non-existent product_id returns 404 product_not_found', async ({
  request,
}) => {
  // The entries route validates the body, then server/writes.ts createEntry
  // looks up the caller-owned product with statements.products.selectById.
  // A missing product raises product_not_found, mapped to 404 by middleware.
  const token = tokenFrom('tests/e2e/.auth/user.json');
  const today = new Date().toISOString().slice(0, 10);
  const res = await request.post('/entries', {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      product_id: 9_999_999,
      grams: 100,
      local_date: today,
      local_time: '12:00',
    },
  });
  expect(res.status()).toBe(404);
  expect(await res.json()).toEqual({ error: 'product_not_found' });
});

test('[J-081] user B cannot log an entry against user A’s product (per-user isolation)', async ({
  request,
}) => {
  // The architecture's load-bearing privacy invariant: every /entries query
  // scopes by user_id. ownedByUser SELECT filters on (user_id, product_id),
  // so user B's POST /entries referencing user A's product_id gets undefined
  // back and the route 404s. A regression that dropped the user_id scope
  // would silently cross-link users' logs against each other's products —
  // AGENTS.md flags this as the privacy invariant for the non-barcode path.
  //
  // Pattern lifted from adopt.spec.ts: seed via direct API as user A, attack
  // via direct API as user B. No browser context needed — the journey is
  // server-side scope enforcement.
  const tokenA = tokenFrom('tests/e2e/.auth/user.json');
  const tokenB = tokenFrom('tests/e2e/.auth/user2.json');

  const seed = await request.post('/products', {
    headers: { Authorization: `Bearer ${tokenA}` },
    data: {
      name: `E2E Cross Entry ${Date.now()}`,
      brand: null,
      unit: 'g',
      // Non-barcoded — barcoded products are the explicit cross-user catalog
      // (J-034/J-035). This row is strictly user A's private library.
      barcode: null,
      per100: { kcal: 100, protein: 10, carbs: 10, fat: 2 },
      is_temp: false,
    },
  });
  expect(seed.ok(), await seed.text()).toBeTruthy();
  const product = (await seed.json()) as { id: number };

  const today = new Date().toISOString().slice(0, 10);
  const res = await request.post('/entries', {
    headers: { Authorization: `Bearer ${tokenB}` },
    data: {
      product_id: product.id,
      grams: 100,
      local_date: today,
      local_time: '12:00',
    },
  });
  expect(res.status()).toBe(404);
  expect(await res.json()).toEqual({ error: 'product_not_found' });

  // Negative-path: user B's day is unchanged — no entry leaked through. The
  // user-scoped GET /entries returns whatever B has for today; the seeded
  // product must NOT appear in it regardless.
  const list = await request.get(`/entries?date=${today}`, {
    headers: { Authorization: `Bearer ${tokenB}` },
  });
  expect(list.ok()).toBeTruthy();
  const entries = (await list.json()) as Array<{ product: { id: number } }>;
  expect(entries.find((e) => e.product.id === product.id)).toBeUndefined();
});

test('[J-082] GET /entries with malformed or missing date returns 400 invalid_date', async ({
  request,
}) => {
  // entries.ts — `date` query param must be a string AND match DATE_RE.
  // A missing param coerces to '' which fails the regex. Cover both branches.
  const token = tokenFrom('tests/e2e/.auth/user.json');
  for (const path of ['/entries', '/entries?date=', '/entries?date=2026/01/01', '/entries?date=abc']) {
    const res = await request.get(path, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status(), path).toBe(400);
    expect(await res.json(), path).toEqual({ error: 'invalid_date' });
  }
});

test('[J-083] GET /entries/week with malformed or missing start returns 400 invalid_date', async ({
  request,
}) => {
  // entries.ts — same DATE_RE guard as the day endpoint, applied to
  // `start`. Missing/malformed both funnel through the same 400 invalid_date.
  const token = tokenFrom('tests/e2e/.auth/user.json');
  for (const path of ['/entries/week', '/entries/week?start=', '/entries/week?start=2026/01/01', '/entries/week?start=xx']) {
    const res = await request.get(path, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status(), path).toBe(400);
    expect(await res.json(), path).toEqual({ error: 'invalid_date' });
  }
});

test('[J-084] GET /entries/recent-grams with malformed product_id returns 400 invalid_product_id', async ({
  request,
}) => {
  // entries.ts — parsePositiveInt rejects 0, negatives, non-numerics,
  // AND missing param (typeof !== 'string'). Every branch funnels to 400
  // invalid_product_id. This exercises the GET /entries/recent-grams handler
  // in server/routes/entries.ts directly.
  const token = tokenFrom('tests/e2e/.auth/user.json');
  for (const path of [
    '/entries/recent-grams',
    '/entries/recent-grams?product_id=',
    '/entries/recent-grams?product_id=0',
    '/entries/recent-grams?product_id=-1',
    '/entries/recent-grams?product_id=abc',
  ]) {
    const res = await request.get(path, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status(), path).toBe(400);
    expect(await res.json(), path).toEqual({ error: 'invalid_product_id' });
  }
});
