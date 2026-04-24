import { expect, test, type Page, type APIRequestContext } from '@playwright/test';

// Fresh-user isolation: the shared storageState user already has 20+ products
// from Tier 1 tests, so its Home and AddPicker are never empty. Per-test
// inline sign-in with a unique email guarantees a clean slate without
// entangling these specs with the user2 fixture used by adopt.spec.ts.
test.use({ storageState: { cookies: [], origins: [] } });

async function signInFresh(page: Page, request: APIRequestContext) {
  const email = `empty-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;
  await page.goto('/');
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByRole('button', { name: 'Send sign-in code' }).tap();
  const res = await request.get(`/auth/test/last-code/${email}`);
  const { code } = await res.json();
  await page.getByLabel('6-digit sign-in code').fill(code);
  // Login.tsx:114 auto-submits at 6 digits; wait for the home shell to land.
  await expect(page.getByRole('button', { name: 'ADD FOOD' })).toBeVisible();
}

test('home shows "No food logged" for a user with no entries', async ({ page, request }) => {
  await signInFresh(page, request);

  // Home.tsx:96 renders this label when entriesForDay is empty. The emptyBtn
  // sibling also opens AddPicker; we don't assert on it to keep the test
  // loose against copy tweaks in the CTA.
  await expect(page.getByText('No food logged')).toBeVisible();
});

test('AddPicker search with no matches shows the empty-results block', async ({ page, request }) => {
  await signInFresh(page, request);

  await page.getByRole('button', { name: 'ADD FOOD' }).tap();

  const q = 'XYZZY_UNLIKELY_MATCH';
  await page.getByPlaceholder('Search products...').fill(q);

  // AddPicker.tsx:197-202 — when results.length === 0, it renders:
  //   <div>"{q}"</div>
  //   not in your library yet.
  // Both strings should be visible; assert on the tail text (stable).
  await expect(page.getByText('not in your library yet.')).toBeVisible();
  await expect(page.getByText(`"${q}"`)).toBeVisible();
});
