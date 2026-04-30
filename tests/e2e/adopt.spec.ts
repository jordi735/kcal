import { expect, test, type APIRequestContext } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Cross-user barcode catalog. Per CLAUDE.md: "barcode = shared, no barcode =
// private" — barcoded products surface across users via the ?global=1 search
// branch (statements.ts:94-95) and can be adopted into the caller's library
// via POST /products/adopt/:id (products.ts:172-228). Non-barcoded products
// stay strictly per-user.
//
// Coverage in this spec:
//   J-034 — adopt happy path through the UI
//   J-035 — adopt is idempotent on (created_by, barcode); 201 then 200
//   J-036 — privacy invariant (UI side): non-barcoded rows never appear in
//           another user's Global search results
//   J-048 — adopt rejects non-barcoded source with 400 not_adoptable
//           (privacy invariant, server side — guards against a malicious
//           caller guessing private product ids)
//   J-049 — adopt rejects unknown id with 404 not_found
//   J-050 — adopt rejects malformed id (zero, negative, non-numeric) with
//           400 invalid_id
//   J-051 — self-adopt fast path: caller adopting their own barcoded row
//           returns the same id with status 200, no duplicate insert
//
// This spec uses BOTH users:
// - User A is the SEEDER. Their session token is read from user.json (written
//   by auth.setup.ts) and used for direct HTTP product creation — no second
//   browser context needed.
// - User B is the DRIVER. Their storageState is user2.json (written by
//   auth.setup2.ts); the spec runs in that logged-in context.
test.use({ storageState: 'tests/e2e/.auth/user2.json' });

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

type SeedInput = {
  name: string;
  barcode: string | null;
  per100: { kcal: number; protein: number; carbs: number; fat: number };
};

async function seedAsUserA(
  request: APIRequestContext,
  product: SeedInput,
): Promise<{ id: number }> {
  const token = tokenFrom('tests/e2e/.auth/user.json');
  const res = await request.post('/products', {
    headers: { Authorization: `Bearer ${token}` },
    // isProductBaseBody (products.ts:244-253) requires `brand` to be null
    // or a string — omitting it fails validation. Same for `is_temp`.
    data: { ...product, brand: null, unit: 'g', is_temp: false },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as { id: number };
}

test('[J-034] barcoded product adopts silently on tap from global search', async ({
  page,
  request,
}) => {
  // Unique barcode per run — adopt is idempotent on (created_by, barcode),
  // and the test DB persists across specs within a run.
  const barcode = `590${Date.now()}`;
  const name = `E2E PB Shared ${Date.now()}`;
  // kcal=237 is distinctive enough that 100g of it shows up as a clean "237"
  // text node — proves the adopted COPY carries the right per100, not just
  // that an arbitrary product was logged. A bug that adopted a stale row or
  // dropped per100 fields on the way across would make this fail.
  await seedAsUserA(request, {
    name,
    barcode,
    per100: { kcal: 237, protein: 10, carbs: 10, fat: 2 },
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'ADD FOOD' }).tap();

  // Flip AddPicker scope to Global (AddPicker.tsx:185) so the cross-user
  // search branch kicks in — without it, the request lacks ?global=1 and
  // user B never sees user A's catalog (statements.ts:94-95 gated path).
  await page.getByRole('button', { name: 'Global', exact: true }).tap();
  await page.getByPlaceholder('Search products...').fill(name);

  // The result carries is_mine=false; App.tsx:298-314 auto-POSTs to
  // /products/adopt/:id behind the scenes before opening GramsPicker with
  // user B's newly-minted copy.
  const picker = page
    .locator('.sheet')
    .filter({ has: page.getByPlaceholder('Search products...') });
  await picker.getByText(name).first().tap();

  await page.getByText('How much?').waitFor({ state: 'visible' });
  await page.getByRole('spinbutton').fill('100');
  await page.getByRole('button', { name: /Add to day/ }).tap();

  // Row visible in user B's log. Strict-mode locator means strict count of 1
  // — a duplicate adopt insert would resolve to 2 and flunk this assertion.
  const row = page.locator('.food-row').filter({ hasText: name });
  await expect(row).toBeVisible();
  // 100g × 237 kcal/100 = 237 kcal. Scoped exact-match avoids any false
  // positive from "237" appearing inside the timestamp portion of `name`.
  await expect(row.getByText('237', { exact: true })).toBeVisible();
});

test('[J-035] adopt is idempotent on (created_by, barcode)', async ({ page, request }) => {
  // Server-side test: call POST /products/adopt/:id as user B TWICE. The
  // first inserts a row (201, products.ts:227); the second hits the existing
  // fast path (products.ts:198-200) and returns 200 with the same row.
  const barcode = `591${Date.now()}`;
  const name = `E2E Idem Shared ${Date.now()}`;
  const sourceA = await seedAsUserA(request, {
    name,
    barcode,
    per100: { kcal: 200, protein: 20, carbs: 20, fat: 4 },
  });

  await page.goto('/');
  const tokenB = await page.evaluate(() =>
    localStorage.getItem('kcal_session_token'),
  );
  expect(tokenB).not.toBeNull();

  const adopt = async () => {
    const res = await request.post(`/products/adopt/${sourceA.id}`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    return { status: res.status(), body: (await res.json()) as { id: number } };
  };

  const first = await adopt();
  const second = await adopt();
  // 201 then 200 distinguishes "fresh insert" from "fast path returned the
  // existing row". Mutation: if the existing branch were dropped, the
  // second call would also be 201 with a NEW id — both assertions catch it.
  expect(first.status).toBe(201);
  expect(second.status).toBe(200);
  expect(second.body.id).toBe(first.body.id);
  // Sanity: the adopted copy is a NEW row (not user A's), so its id differs
  // from the source.
  expect(first.body.id).not.toBe(sourceA.id);
});

test('[J-036] non-barcoded products never cross users (privacy invariant, UI search)', async ({
  page,
  request,
}) => {
  // Seed a product OWNED BY USER A with barcode=null. The search statement
  // (statements.ts:94-95) only surfaces cross-user rows where barcode IS NOT
  // NULL — user B searching for this name should get zero matches regardless
  // of scope.
  const name = `E2E Private Only ${Date.now()}`;
  await seedAsUserA(request, {
    name,
    barcode: null,
    per100: { kcal: 100, protein: 10, carbs: 10, fat: 2 },
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'ADD FOOD' }).tap();
  await page.getByRole('button', { name: 'Global', exact: true }).tap();
  await page.getByPlaceholder('Search products...').fill(name);

  // AddPicker.tsx:197-202 renders the empty-results block when the server
  // returns zero matches — the proof of the privacy invariant.
  await expect(page.getByText('not in your library yet.')).toBeVisible();
  // Negative-path: no result-row button exists for the seeded name. Scope
  // to button-role to skip the empty-state echo (`AddPicker.tsx:198`
  // re-renders the query string in a div, which would false-positive a
  // raw text search). A bug flipping the SQL filter to surface non-barcoded
  // cross-user rows would render a clickable result button here.
  const picker = page
    .locator('.sheet')
    .filter({ has: page.getByPlaceholder('Search products...') });
  await expect(picker.getByRole('button').filter({ hasText: name })).toHaveCount(0);
});

test('[J-048] adopt rejects non-barcoded source with 400 not_adoptable', async ({
  page,
  request,
}) => {
  // Privacy guard at products.ts:185-188. Even if a malicious user knew the
  // numeric id of another user's private product, the server must refuse to
  // clone it. Seed a barcode=null row as user A, then attempt adopt as user
  // B — must return 400 not_adoptable, NOT a copy.
  const name = `E2E Not Adoptable ${Date.now()}`;
  const sourceA = await seedAsUserA(request, {
    name,
    barcode: null,
    per100: { kcal: 100, protein: 10, carbs: 10, fat: 2 },
  });

  await page.goto('/');
  const tokenB = await page.evaluate(() =>
    localStorage.getItem('kcal_session_token'),
  );
  expect(tokenB).not.toBeNull();

  const res = await request.post(`/products/adopt/${sourceA.id}`, {
    headers: { Authorization: `Bearer ${tokenB}` },
  });
  expect(res.status()).toBe(400);
  expect(await res.json()).toEqual({ error: 'not_adoptable' });
  // Negative-path: confirm no row leaked into user B's library. /products/all
  // is user-scoped, so user A's source row must not appear regardless.
  const myProducts = await request.get('/products/all', {
    headers: { Authorization: `Bearer ${tokenB}` },
  });
  expect(myProducts.ok()).toBeTruthy();
  const list = (await myProducts.json()) as Array<{ name: string }>;
  expect(list.find((p) => p.name === name)).toBeUndefined();
});

test('[J-049] adopt rejects unknown id with 404 not_found', async ({ page, request }) => {
  // products.ts:179-181: byIdAnyUser returns undefined for an id that does
  // not exist in the products table; the route returns 404. Use a very
  // large id that no test seeding could ever reach.
  await page.goto('/');
  const tokenB = await page.evaluate(() =>
    localStorage.getItem('kcal_session_token'),
  );
  expect(tokenB).not.toBeNull();

  const res = await request.post('/products/adopt/9999999', {
    headers: { Authorization: `Bearer ${tokenB}` },
  });
  expect(res.status()).toBe(404);
  expect(await res.json()).toEqual({ error: 'not_found' });
});

test('[J-050] adopt rejects malformed id with 400 invalid_id', async ({ page, request }) => {
  // products.ts:173-176 → parsePositiveInt returns null for zero, negatives,
  // and non-numerics; the route returns 400 invalid_id. Cover three flavors
  // in one test — they all funnel through the same guard.
  await page.goto('/');
  const tokenB = await page.evaluate(() =>
    localStorage.getItem('kcal_session_token'),
  );
  expect(tokenB).not.toBeNull();

  const cases = ['0', '-1', 'abc'];
  for (const bad of cases) {
    const res = await request.post(`/products/adopt/${bad}`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    expect(res.status(), `id="${bad}"`).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_id' });
  }
});

test('[J-051] self-adopt fast path returns the same row, no duplicate insert', async ({
  page,
  request,
}) => {
  // products.ts:189-191: when source.created_by === req.userId, the route
  // skips the insert and returns the source row as-is with status 200.
  // Without this guard, a user could duplicate their own row arbitrarily.
  const barcode = `592${Date.now()}`;
  const name = `E2E Self Adopt ${Date.now()}`;
  const sourceA = await seedAsUserA(request, {
    name,
    barcode,
    per100: { kcal: 150, protein: 5, carbs: 20, fat: 5 },
  });

  // Drive the spec as the same user who owns the source — needed to exercise
  // the self-adopt branch. user.json holds user A's session token.
  await page.goto('/');
  const tokenA = tokenFrom('tests/e2e/.auth/user.json');

  const res = await request.post(`/products/adopt/${sourceA.id}`, {
    headers: { Authorization: `Bearer ${tokenA}` },
  });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { id: number };
  // Same id => no insert ran; if the guard were missing, lastInsertRowid
  // would have produced a fresh row id distinct from sourceA.id.
  expect(body.id).toBe(sourceA.id);
});
