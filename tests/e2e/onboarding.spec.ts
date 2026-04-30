import { expect, test, type Page, type APIRequestContext } from '@playwright/test';
import { fillNutField, seedProductAndLog } from './helpers';

// Onboarding is the chain of state transitions a brand-new account walks
// through on its first session — empty Home, idleEmpty AddPicker, migration-
// default goals, then the cascade triggered by the first log: Recent surfaces
// in AddPicker, addedProductIds checkmark appears, MacroSummary recomputes.
// Each one of those transitions is fragile in its own way, so each gets
// dedicated proof. Shared storageState carries 20+ products from Tier 1
// tests, so a per-test fresh sign-in is mandatory.
test.use({ storageState: { cookies: [], origins: [] } });

async function signInFresh(page: Page, request: APIRequestContext): Promise<string> {
  const email = `onb-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;
  await page.goto('/');
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByRole('button', { name: 'Send sign-in code' }).tap();
  const res = await request.get(`/auth/test/last-code/${email}`);
  const { code } = await res.json();
  await page.getByLabel('6-digit sign-in code').fill(code);
  // Login.tsx:114 auto-submits at 6 digits — wait for the home shell to land.
  await expect(page.getByRole('button', { name: 'ADD FOOD' })).toBeVisible();
  return email;
}

test('[J-104] full first-time onboarding: signup → empty → first product → first log → updated home', async ({
  page,
  request,
}) => {
  // The end-to-end happy path that NO existing test asserts in one go. Each
  // hop along the chain is individually covered (empty state, AddPicker
  // idleEmpty, NewProductForm validation, GramsPicker default 100, MacroSummary
  // computed totals), but the integration between them is not — a regression
  // that broke the new-product → grams-picker modal transition, dropped the
  // optimistic addEntry update, or stale-cached entriesByDate would slip past
  // every per-component test. This spec ties them together.
  await signInFresh(page, request);

  // Sanity: brand-new user lands on the empty home with default kcal goal.
  await expect(page.getByText('No food logged')).toBeVisible();
  await expect(page.getByText('Kcal remaining')).toBeVisible();
  await expect(page.getByText('/ 2400')).toBeVisible();

  // Open AddPicker via the empty pill (Home.tsx:92 — full-pill button) — this
  // also exercises J-076's path implicitly. AddPicker should show idleEmpty.
  await page.getByRole('button').filter({ hasText: 'No food logged' }).tap();
  await expect(
    page.getByText('Your library is empty. Tap + Add New to create your first product.'),
  ).toBeVisible();

  // First product. Pick deterministic per-100 macros so the row's kcal is
  // exact: 100g × 400 kcal/100g = 400 kcal. A divisor-mutation (/100 → /1000)
  // produces 40, easy to distinguish.
  await page.getByRole('button', { name: 'Add New', exact: true }).tap();
  await page.getByPlaceholder('e.g. Peanut Butter').fill('E2E Onb First');
  await fillNutField(page, 'Kcal', '400');
  await fillNutField(page, 'Protein', '10');
  await fillNutField(page, 'Carbs', '70');
  await fillNutField(page, 'Fat', '5');
  await page.getByRole('button', { name: /Save & Continue/ }).tap();

  // App.tsx:395-406 — onProductSave transitions modal to grams-picker after
  // the POST /products resolves. AddPicker's search input is gone; "How much?"
  // (GramsPicker.tsx) is mounted. Catches a regression that re-opened
  // AddPicker instead of GramsPicker after save.
  await expect(page.getByText('How much?')).toBeVisible();
  await expect(page.getByPlaceholder('Search products...')).toHaveCount(0);
  await page.getByRole('spinbutton').fill('100');
  await page.getByRole('button', { name: /Add to day/ }).tap();

  // Row appears on Home — the empty pill is gone (entries.length > 0 branch).
  const row = page.locator('.food-row').filter({ hasText: 'E2E Onb First' });
  await expect(row).toHaveCount(1);
  await expect(page.getByText('No food logged')).toHaveCount(0);

  // Computed kcal: 100g × 400/100 = 400. Exact match scoped inside the row
  // catches a mutation that flipped the divisor and produced 40.
  await expect(row.getByText('400', { exact: true })).toBeVisible();
  await expect(row).toContainText('100g');

  // MacroSummary refresh: 2400 - 400 = 2000 remaining; "400 kcal" consumed.
  // useMemo on `entries` in MacroSummary.tsx:19 must re-fire — a stale dep
  // array would leave both numbers at 2400/0.
  await expect(page.getByText('Kcal remaining')).toBeVisible();
  await expect(page.getByText('Over budget')).toHaveCount(0);
  await expect(page.getByText('2000', { exact: true })).toBeVisible();
  await expect(page.getByText('400 kcal')).toBeVisible();
  await expect(page.getByText('/ 2400')).toBeVisible();
});

test('[J-105] first log replaces idleEmpty with Recent section in AddPicker', async ({
  page,
  request,
}) => {
  // AddPicker.tsx:106-111 sets idleEmpty when BOTH /products/recent and
  // /products/all return []. After the first log, /products/recent returns
  // exactly one product, so the branch flips to Recent + recents.map(renderRow).
  // Mutation: dropping `recents.length > 0` from the conditional would still
  // render the empty list but skip the Recent header — this catches that.
  await signInFresh(page, request);
  await seedProductAndLog(
    page,
    'E2E Onb Recent',
    { kcal: '120', protein: '10', carbs: '15', fat: '3' },
    '100',
  );

  await page.getByRole('button', { name: 'ADD FOOD' }).tap();
  const picker = page
    .locator('.sheet')
    .filter({ has: page.getByPlaceholder('Search products...') });

  // Recent header now visible — exact:true so it doesn't substring-match
  // "Recent..." in any tooltip text or future copy.
  await expect(picker.getByText('Recent', { exact: true })).toBeVisible();
  // idleEmpty message is GONE — proves the post-log branch was taken, not
  // both branches accidentally co-firing.
  await expect(page.getByText('Your library is empty')).toHaveCount(0);
  // Product appears under Recent (scoped to the picker sheet to avoid
  // matching the food-row beneath the open sheet).
  await expect(picker.getByText('E2E Onb Recent')).toBeVisible();
});

test('[J-106] addedProductIds check icon appears next to today logged products in AddPicker', async ({
  page,
  request,
}) => {
  // AddPicker.tsx:118-119 — `{added && <CheckIcon size={12} ...}`. App.tsx:215-218
  // builds `addedProductIds` from `todayEntries.map((e) => e.product.id)`.
  // Any mutation that drops the Set construction, swaps `todayEntries` for a
  // different list, or breaks the `addedProductIds.has(p.id)` check would
  // hide the affordance. Compare a logged product (icon expected) against an
  // unlogged-but-owned product (no icon) for full mutation resistance.
  await signInFresh(page, request);

  // Fresh user's bearer token — read after sign-in completes so we can seed
  // a sibling product via the API without an extra log.
  const token = await page.evaluate(() => localStorage.getItem('kcal_session_token'));
  if (token === null || token === '') throw new Error('no session token after sign-in');

  await seedProductAndLog(
    page,
    'E2E Onb Logged',
    { kcal: '100', protein: '5', carbs: '10', fat: '2' },
    '100',
  );

  // API-only: same user, no log. /products/all and /products/recent are user-
  // scoped so this row appears in AddPicker but not in addedProductIds (the
  // user hasn't logged it on `selectedKey`).
  const seed = await request.post('/products', {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name: 'E2E Onb Unlogged',
      brand: null,
      unit: 'g',
      barcode: null,
      per100: { kcal: 200, protein: 10, carbs: 20, fat: 5 },
      is_temp: false,
    },
  });
  expect(seed.ok(), await seed.text()).toBeTruthy();

  await page.getByRole('button', { name: 'ADD FOOD' }).tap();
  const picker = page
    .locator('.sheet')
    .filter({ has: page.getByPlaceholder('Search products...') });

  const loggedRow = picker.getByRole('button').filter({ hasText: 'E2E Onb Logged' });
  const unloggedRow = picker.getByRole('button').filter({ hasText: 'E2E Onb Unlogged' });
  await expect(loggedRow).toHaveCount(1);
  await expect(unloggedRow).toHaveCount(1);

  // CheckIcon is the only SVG inside an AddPicker product row — MacroBreakdown
  // (per-100 macros) is plain text spans, no icons. So an SVG count of 1 vs 0
  // is a faithful proxy for "added today" without depending on hashed CSS
  // module class names.
  await expect(loggedRow.locator('svg')).toHaveCount(1);
  await expect(unloggedRow.locator('svg')).toHaveCount(0);
});

test('[J-107] brand-new user has migration default goals visible in Settings', async ({
  page,
  request,
}) => {
  // server/migrations/001_init.sql — kcal=2400, protein=180, carbs=240, fat=80.
  // After signin, App.tsx:264 calls userToGoals(res.user) and seeds the goals
  // state from the User row the server just minted. Settings then reads those
  // goals from props (App.tsx:601). Mutation surface: server returning a User
  // without goal_* fields → undefined → Number(undefined) = NaN; or App reading
  // mockGoals instead of user goals (mockGoals coincidentally matches in this
  // codebase, so the comparison is value-by-value to exercise the four
  // independent props rather than rely on a structural diff).
  //
  // Settings spinbutton order is positional per CLAUDE.md: 0=Protein, 1=Carbs,
  // 2=Fat, 3=Kcal (MACRO_KEYS first, kcal last). A label-based query would be
  // ambiguous — "Kcal" appears in the daily-goals row AND in the "kcal from
  // macros" subheading.
  await signInFresh(page, request);

  await page.getByRole('button', { name: 'Settings' }).tap();
  await expect(page.getByText('Daily goals')).toBeVisible();

  const inputs = page.getByRole('spinbutton');
  await expect(inputs.nth(0)).toHaveValue('180');
  await expect(inputs.nth(1)).toHaveValue('240');
  await expect(inputs.nth(2)).toHaveValue('80');
  await expect(inputs.nth(3)).toHaveValue('2400');

  // Macro split readout in Settings derives total kcal from 4*p + 4*c + 9*f.
  // 4*180 + 4*240 + 9*80 = 720 + 960 + 720 = 2400 — equal to kcal goal,
  // so |2400-2400| = 0 ≤ 50 → mismatch banner stays hidden. This is the
  // "defaults are internally consistent" invariant; if a future migration
  // bumps any one default into mismatch territory, this surfaces it.
  await expect(page.getByText(/Heads up — your macros add up to/)).toHaveCount(0);
});

test('[J-108] first log persists across page reload (server actually received POST)', async ({
  page,
  request,
}) => {
  // useEntries.tsx applies optimistic updates BEFORE the network resolves —
  // so a regression that silently dropped the POST /entries call would still
  // show the row on screen until reload. After reload, the cold cache has
  // nothing; useEntries fetches /entries?date=today fresh, and the row only
  // reappears if the server actually persisted it. This separates "the UI
  // updated" from "the data is durable".
  await signInFresh(page, request);
  await seedProductAndLog(
    page,
    'E2E Onb Persist',
    { kcal: '300', protein: '20', carbs: '40', fat: '5' },
    '150',
  );

  // Capture the kcal value pre-reload for the post-reload comparison.
  // 150g × 300/100 = 450 kcal.
  const row = page.locator('.food-row').filter({ hasText: 'E2E Onb Persist' });
  await expect(row.getByText('450', { exact: true })).toBeVisible();

  // The session token in localStorage survives reload, so the user stays
  // signed in. App's useEffect (line 228-232) re-fetches entries for today.
  await page.reload();

  // Home shell must come back signed-in (session token persisted) — sanity.
  await expect(page.getByRole('button', { name: 'ADD FOOD' })).toBeVisible();

  // The food row reappears with identical macros. A bug that dropped the
  // POST would surface here as `.food-row` count 0 plus "No food logged".
  const reloadedRow = page.locator('.food-row').filter({ hasText: 'E2E Onb Persist' });
  await expect(reloadedRow).toHaveCount(1);
  await expect(reloadedRow.getByText('450', { exact: true })).toBeVisible();
  await expect(reloadedRow).toContainText('150g');
  await expect(page.getByText('No food logged')).toHaveCount(0);

  // MacroSummary computed-from-entries totals also survive — proves the
  // sumMacros chain re-runs against the server-fetched list, not a stale
  // cache. 2400 - 450 = 1950 remaining.
  await expect(page.getByText('1950', { exact: true })).toBeVisible();
  await expect(page.getByText('450 kcal')).toBeVisible();
});
