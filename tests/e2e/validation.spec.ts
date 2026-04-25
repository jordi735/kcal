import { expect, test } from '@playwright/test';
import { fillNutField } from './helpers';

// Scenarios 1-2 need a signed-out context. Override storageState for this
// describe block so the default auth.setup session isn't carried in.
test.describe('signed-out', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('[J-007] bad email disables the submit button', async ({ page }) => {
    await page.goto('/');
    await page.getByPlaceholder('you@example.com').fill('not-an-email');
    // Login.tsx:147 — disabled={!emailValid || submitting}; regex \S+@\S+\.\S+
    await expect(page.getByRole('button', { name: 'Send sign-in code' })).toBeDisabled();
  });

  test('[J-003] wrong 6-digit code shows inline error and stays on code step', async ({ page }) => {
    await page.goto('/');
    await page.getByPlaceholder('you@example.com').fill('wrong-code@test.local');
    await page.getByRole('button', { name: 'Send sign-in code' }).tap();
    await expect(page.getByText('CODE SENT')).toBeVisible();

    // Login.tsx:114 auto-submits at 6 digits. Server returns invalid_or_expired_code,
    // mapped to 'Invalid or expired code.' in Login.tsx:93.
    await page.getByLabel('6-digit sign-in code').fill('000000');
    await expect(page.getByText('Invalid or expired code.')).toBeVisible();

    // Still on code step — the field is cleared and re-focused (Login.tsx:95-96)
    // rather than navigating back to email.
    await expect(page.getByLabel('6-digit sign-in code')).toBeVisible();
  });
});

// Scenarios 3-4 run signed in using the default project storageState.
test.describe('signed-in', () => {
  test('[J-011] server rejects product kcal > 2000 cap — form stays open', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'ADD FOOD' }).tap();
    await page.getByRole('button', { name: 'Add New' }).tap();

    await page.getByPlaceholder('e.g. Peanut Butter').fill('E2E Over Cap');
    // Client-side 'valid' (NewProductForm.tsx:117) only checks fields are filled,
    // not numeric range. Server enforces kcal <= 2000 (products.ts:237).
    await fillNutField(page, 'Kcal', '5000');
    await fillNutField(page, 'Protein', '10');
    await fillNutField(page, 'Carbs', '10');
    await fillNutField(page, 'Fat', '10');
    await page.getByRole('button', { name: /Save & Continue/ }).tap();

    // Server returns 400 invalid_product. App.tsx:363-367 catches, reports error,
    // leaves modal open. GramsPicker ("How much?") never appears.
    await expect(page.getByText('New Product', { exact: true })).toBeVisible();
    await expect(page.getByText('How much?')).not.toBeVisible();
  });

  test('[J-012] product name containing HTML is rendered as text (XSS safe)', async ({ page }) => {
    // Tripwire: any unexpected alert/confirm/prompt fails the test.
    page.on('dialog', async (dialog) => {
      await dialog.dismiss();
      throw new Error(`unexpected dialog: ${dialog.message()}`);
    });

    const XSS_NAME = '<b>e2e-xss</b>';

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

    // If Preact escapes (the safe path), text content contains literal "<b>e2e-xss</b>".
    // If it rendered as HTML (unsafe), text content would just be "e2e-xss" and
    // toContainText(XSS_NAME) would fail.
    const row = page.locator('.food-row').filter({ hasText: XSS_NAME });
    await expect(row).toContainText(XSS_NAME);
  });
});
