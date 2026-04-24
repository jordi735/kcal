import { expect, test, type APIRequestContext } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Cross-user barcode catalog. Per CLAUDE.md: "barcode = shared, no barcode =
// private" — barcoded products surface across users via the ?global=1 search
// branch (statements.ts:94-95) and can be adopted into the caller's library
// via POST /products/adopt/:id (products.ts:172-228). Non-barcoded products
// stay strictly per-user.
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

test('barcoded product adopts silently on tap from global search', async ({
  page,
  request,
}) => {
  // Unique barcode per run — adopt is idempotent on (created_by, barcode),
  // and the test DB persists across specs within a run.
  const barcode = `590${Date.now()}`;
  const name = `E2E PB Shared ${Date.now()}`;
  await seedAsUserA(request, {
    name,
    barcode,
    per100: { kcal: 100, protein: 10, carbs: 10, fat: 2 },
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'ADD FOOD' }).tap();

  // Flip AddPicker scope to Global (AddPicker.tsx:185) so the cross-user
  // search branch kicks in — without it, the request lacks ?global=1 and
  // user B never sees user A's catalog (statements.ts:94-95 gated path).
  await page.getByRole('button', { name: 'Global', exact: true }).tap();
  await page.getByPlaceholder('Search products...').fill(name);

  // The result carries is_mine=false; App.tsx:269-282 auto-POSTs to
  // /products/adopt/:id behind the scenes before opening GramsPicker with
  // user B's newly-minted copy.
  const picker = page
    .locator('.sheet')
    .filter({ has: page.getByPlaceholder('Search products...') });
  await picker.getByText(name).first().tap();

  await page.getByText('How much?').waitFor({ state: 'visible' });
  await page.getByRole('spinbutton').fill('100');
  await page.getByRole('button', { name: /Add to day/ }).tap();

  // Row visible in user B's log. The mere presence of this row proves the
  // adopt succeeded — the entry FK would fail if user B didn't own the row.
  await expect(page.locator('.food-row').filter({ hasText: name })).toBeVisible();
});

test('adopt is idempotent on (created_by, barcode)', async ({ page, request }) => {
  // Server-side test: call POST /products/adopt/:id as user B TWICE. The
  // first inserts a row; the second hits products.ts:195-200's fast path and
  // returns the existing row. Both responses should carry the same id —
  // concurrent or repeated adopts must never duplicate.
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
    expect(res.ok()).toBeTruthy();
    return (await res.json()) as { id: number };
  };

  const first = await adopt();
  const second = await adopt();
  expect(second.id).toBe(first.id);
  // Sanity: the adopted copy is a NEW row (not user A's), so its id differs
  // from the source.
  expect(first.id).not.toBe(sourceA.id);
});

test('non-barcoded products never cross users (privacy invariant)', async ({
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
});
