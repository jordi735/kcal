import { expect, test } from '@playwright/test';
import { fillNutField } from './helpers';

// validation.spec.ts owns UI-level form-validation invariants — the gates
// that stop bad data from reaching the server (client-side trim/maxLength
// checks), the boundary the server enforces (kcal cap), and the rendering
// invariants that protect against malicious input (XSS on product.name +
// product.brand). Wire-contract negative paths for the route bodies live in
// product.spec.ts (J-111 / J-112) — this spec stays at the UI / render layer.
//
// J-003 (wrong code) and J-007 (bad email disables submit) used to live here
// as duplicates; the canonical, mutation-resistant versions are in
// auth.spec.ts:62 and auth.spec.ts:162 respectively.

test('[J-011] server rejects product kcal > 2000 cap — form stays open, no row added', async ({
  page,
}) => {
  // products.ts:237 caps kcal at 2000. NewProductForm's `valid` (line 127)
  // only checks fields-are-filled, so the request goes through and the
  // server returns 400 invalid_product. App.tsx catches the error, leaves
  // the sheet mounted for retry, and the entry is never created.
  //
  // Mutation cases this catches:
  //   - cap removed entirely (kcal flowed through, row appears) — fails
  //     `food-row count == 0` and the GramsPicker negative-path.
  //   - error swallowed in App.tsx (sheet auto-closes despite 400) — fails
  //     `New Product` visibility.
  //   - response status code wrong — fails the explicit response.status() check.

  await page.goto('/');
  await page.getByRole('button', { name: 'ADD FOOD' }).tap();
  await page.getByRole('button', { name: 'Add New' }).tap();

  await page.getByPlaceholder('e.g. Peanut Butter').fill('E2E Over Cap');
  await fillNutField(page, 'Kcal', '5000');
  await fillNutField(page, 'Protein', '10');
  await fillNutField(page, 'Carbs', '10');
  await fillNutField(page, 'Fat', '10');

  // Anchor the assertions on the network round-trip — without this we'd
  // be racing against the in-flight POST and the negative-path checks
  // could pass too early (before the response had a chance to mutate state).
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        new URL(r.url()).pathname === '/products',
    ),
    page.getByRole('button', { name: /Save & Continue/ }).tap(),
  ]);
  expect(response.status()).toBe(400);
  expect(await response.json()).toEqual({ error: 'invalid_product' });

  // Form still mounted (positive — error UX leaves it open for retry).
  await expect(page.getByText('New Product', { exact: true })).toBeVisible();
  // GramsPicker never opened (negative — successful flow short-circuited
  // before reaching App.tsx's setModal('grams-picker')).
  await expect(page.getByText('How much?')).toHaveCount(0);
  // No row inserted on the home list — proves the entry was never created.
  await expect(
    page.locator('.food-row').filter({ hasText: 'E2E Over Cap' }),
  ).toHaveCount(0);
});

test('[J-155] kcal at the 2000 cap is accepted (boundary; positive control for J-011)', async ({
  page,
}) => {
  // products.ts:237 — `kcal <= 2000`. A mutation flipping `<=` to `<` would
  // also reject 2000 itself; J-011 (5000) and J-111 (2001) would both keep
  // passing in that bug because 5000 and 2001 both exceed any tighter cap.
  // This pins the comparator direction at exactly 2000 — the largest
  // accepted value — so the integer threshold is fully bracketed.
  await page.goto('/');
  await page.getByRole('button', { name: 'ADD FOOD' }).tap();
  await page.getByRole('button', { name: 'Add New' }).tap();

  await page.getByPlaceholder('e.g. Peanut Butter').fill('E2E Cap Boundary');
  // 2000 kcal/100g + macros below caps. Atwater check fails (2000 is far
  // from 4·10+4·10+9·10=170) but Atwater is a soft warning, not a gate.
  await fillNutField(page, 'Kcal', '2000');
  await fillNutField(page, 'Protein', '10');
  await fillNutField(page, 'Carbs', '10');
  await fillNutField(page, 'Fat', '10');

  // Anchor on a 201 to ensure the server actually accepted before we
  // check the UI transition.
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        new URL(r.url()).pathname === '/products',
    ),
    page.getByRole('button', { name: /Save & Continue/ }).tap(),
  ]);
  expect(response.status()).toBe(201);

  // Save flowed through to GramsPicker — the success path.
  await expect(page.getByText('How much?')).toBeVisible();
  // NewProductForm unmounted (sheet replaced, not stacked underneath).
  await expect(page.getByText('New Product', { exact: true })).toHaveCount(0);
});

test('[J-156] whitespace-only name keeps Save & Continue disabled (`.trim()` mutation guard)', async ({
  page,
}) => {
  // NewProductForm.tsx:128 — `name.trim().length > 0` is the gate. A bug
  // dropping `.trim()` would treat '   ' (three spaces) as length 3 and
  // enable submit, which would hit the server and 400 with
  // `name whitespace-only` (J-112's first case). This test pins the gate
  // *at the client* — bad data should never leave the browser.
  //
  // J-086 covers the all-empty + sequential-refill ordering, but never
  // tests the trim-only case, so a regression dropping `.trim()` would
  // slip past J-086 because the macros are still filled at submit time.
  await page.goto('/');
  await page.getByRole('button', { name: 'ADD FOOD' }).tap();
  await page.getByRole('button', { name: 'Add New' }).tap();

  const submit = page.getByRole('button', { name: /Save & Continue/ });

  // Whitespace-only name + all macros filled — should still be disabled
  // because the name fails `.trim().length > 0`.
  await page.getByPlaceholder('e.g. Peanut Butter').fill('   ');
  await fillNutField(page, 'Kcal', '100');
  await fillNutField(page, 'Protein', '10');
  await fillNutField(page, 'Carbs', '10');
  await fillNutField(page, 'Fat', '2');
  await expect(submit).toBeDisabled();

  // Sanity branch — re-typing real text re-enables submit. Without this
  // the test would also pass if the button were perma-disabled (a different
  // bug that breaks all submission). Pure-negative assertions are too easy
  // to satisfy.
  await page.getByPlaceholder('e.g. Peanut Butter').fill('E2E Real');
  await expect(submit).toBeEnabled();
});

test('[J-012] XSS in product name renders as literal text everywhere', async ({ page }) => {
  // Tripwire across the whole test — any unexpected dialog (alert, confirm,
  // prompt) fails immediately. `<img src=x onerror=...>` is the canonical
  // XSS payload because the onerror handler fires on parse if rendered as
  // HTML — even when the URL is invalid. A bug switching either FoodRow.tsx:53
  // (`{product.name}`) or AddPicker.tsx:120 (same shape) to
  // dangerouslySetInnerHTML would surface here.
  page.on('dialog', async (dialog) => {
    await dialog.dismiss();
    throw new Error(`unexpected dialog: ${dialog.message()}`);
  });

  const XSS_NAME = '<img src=x onerror=alert(1)><b>e2e-xss-name</b>';

  await page.goto('/');
  await page.getByRole('button', { name: 'ADD FOOD' }).tap();
  await page.getByRole('button', { name: 'Add New' }).tap();
  await page.getByPlaceholder('e.g. Peanut Butter').fill(XSS_NAME);
  await fillNutField(page, 'Kcal', '100');
  await fillNutField(page, 'Protein', '5');
  await fillNutField(page, 'Carbs', '5');
  await fillNutField(page, 'Fat', '5');
  await page.getByRole('button', { name: /Save & Continue/ }).tap();

  await expect(page.getByText('How much?')).toBeVisible();
  await page.getByRole('spinbutton').fill('50');
  await page.getByRole('button', { name: /Add to day/ }).tap();

  // Surface 1: FoodRow renders `{product.name}` as text — exact substring
  // implies Preact escaped, not innerHTML'd. The literal `<` and `>` make
  // it through to textContent only if escaping happened.
  const row = page.locator('.food-row').filter({ hasText: XSS_NAME });
  await expect(row).toContainText(XSS_NAME);

  // Surface 2: AddPicker re-render — re-open the picker; the just-logged
  // product appears under "Recent". The same name string MUST also render
  // as literal text in this second context (AddPicker.tsx:120, different
  // template than FoodRow.tsx:53). A regression that escapes correctly in
  // FoodRow but accidentally uses dangerouslySetInnerHTML in AddPicker
  // would fail here while J-012's surface-1 check passed.
  await page.getByRole('button', { name: 'ADD FOOD' }).tap();
  const picker = page
    .locator('.sheet')
    .filter({ has: page.getByPlaceholder('Search products...') });
  await expect(picker).toContainText(XSS_NAME);
});

test('[J-157] XSS in brand field renders as literal text — no dialog fires', async ({
  page,
}) => {
  // FoodRow.tsx:60 renders `· {product.brand}`. A regression switching
  // that to dangerouslySetInnerHTML would let an attacker XSS via a brand
  // string. Same dialog tripwire + literal-text assertion as J-012, but
  // for the brand surface — separate template, separate render path,
  // separate test.
  //
  // Note: shared/normalize.ts:24 applies title-case to brand on insert
  // (`<img src=x onerror=alert(2)>` becomes `<img Src=x Onerror=alert(2)>`
  // because the regex capitalizes `\S` after `^|\s`). HTML tag attributes
  // are case-insensitive, so `<img Src` still triggers XSS in a browser
  // — the dialog tripwire is the load-bearing security assertion. The
  // textContent assertion uses the normalized form, since that's what
  // ends up in the DOM.
  page.on('dialog', async (dialog) => {
    await dialog.dismiss();
    throw new Error(`unexpected dialog: ${dialog.message()}`);
  });

  const RAW_BRAND = '<img src=x onerror=alert(2)>';
  const NORMALIZED_BRAND = '<img Src=x Onerror=alert(2)>';

  await page.goto('/');
  await page.getByRole('button', { name: 'ADD FOOD' }).tap();
  await page.getByRole('button', { name: 'Add New' }).tap();
  await page.getByPlaceholder('e.g. Peanut Butter').fill('E2E XSS Brand');
  // Brand is the second ClearableField (placeholder='optional', shared with
  // Barcode). Scope by the field-label sibling to avoid hitting Barcode.
  await page
    .locator('label')
    .filter({ hasText: /^Brand$/ })
    .locator('..')
    .getByRole('textbox')
    .fill(RAW_BRAND);
  await fillNutField(page, 'Kcal', '100');
  await fillNutField(page, 'Protein', '5');
  await fillNutField(page, 'Carbs', '5');
  await fillNutField(page, 'Fat', '5');
  await page.getByRole('button', { name: /Save & Continue/ }).tap();

  await expect(page.getByText('How much?')).toBeVisible();
  await page.getByRole('spinbutton').fill('50');
  await page.getByRole('button', { name: /Add to day/ }).tap();

  // FoodRow renders the brand string verbatim after a "·". textContent
  // includes the literal `<` and `>` only because Preact escaped them.
  // (If brand were innerHTML'd, the img would parse and the dialog
  // tripwire would fire instead of reaching this assertion.)
  const row = page.locator('.food-row').filter({ hasText: 'E2E XSS Brand' });
  await expect(row).toContainText(NORMALIZED_BRAND);
});

test('[J-158] barcode field caps user typing at 64 characters (`maxLength` mutation guard)', async ({
  page,
}) => {
  // NewProductForm.tsx:270 sets maxLength={64} on the barcode ClearableField.
  // The browser enforces this on real keystrokes (Playwright's
  // `pressSequentially` mimics that path — `fill()` would bypass maxLength
  // because it sets the value via the property setter). The server enforces
  // a parallel cap of 64 (J-112's `barcode >64 chars` case) — this test
  // pins the FIRST line of defense so a regression that drops the
  // attribute is caught before the round-trip.
  await page.goto('/');
  await page.getByRole('button', { name: 'ADD FOOD' }).tap();
  await page.getByRole('button', { name: 'Add New' }).tap();

  const barcodeInput = page
    .locator('label')
    .filter({ hasText: /^Barcode$/ })
    .locator('..')
    .getByRole('textbox');

  // Type 70 digits one-by-one; the browser drops anything past 64.
  await barcodeInput.pressSequentially('0'.repeat(70), { delay: 0 });

  // Exact count (not >=, not <=) — pinning the integer 64 specifically.
  // Mutation maxLength={32} or maxLength={128} would each fail this.
  await expect(barcodeInput).toHaveValue('0'.repeat(64));
});
