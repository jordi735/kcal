import { expect, test } from '@playwright/test';
import { seedProductAndLog } from './helpers';

// The app has zero <form> elements — every Enter-to-submit is hand-wired
// via onKeyDown. Each test here pins one of those paths so a regression
// removing `if (e.key === 'Enter')` from any handler surfaces immediately.

const MACROS = { kcal: '100', protein: '10', carbs: '10', fat: '2' };

test.describe('keyboard Enter submits', () => {
  test.describe('Login email field', () => {
    // Login.tsx:140-141 — Enter on email input calls submitEmail().
    // Isolated storageState: this is the only way to see the email-step UI;
    // the shared session is already signed in and skips Login entirely.
    test.use({ storageState: { cookies: [], origins: [] } });

    test('[J-001] Enter on email field advances to code step', async ({ page }) => {
      await page.goto('/');
      await page.getByPlaceholder('you@example.com').fill('kbd-login@test.local');
      await page.getByPlaceholder('you@example.com').press('Enter');

      // Successful submit flips step='email' → 'code', rendering the 'CODE SENT'
      // card and the 6-digit input. Assert on the a11y name of the input —
      // unambiguous and stable.
      await expect(page.getByLabel('6-digit sign-in code')).toBeVisible();
    });
  });

  test('[J-043] Enter on GramsPicker add-mode input logs the entry', async ({ page }) => {
    // Seed the product (100g), then re-add at 200g via Enter instead of the
    // 'Add to day' button. After, there should be one row on the day with 200g.
    const name = 'E2E Kbd Add';
    await page.goto('/');
    await seedProductAndLog(page, name, MACROS, '100');

    await page.getByRole('button', { name: 'ADD FOOD' }).tap();
    // Scope the text match to the AddPicker sheet specifically — otherwise
    // `getByText(name).first()` matches the food-row behind the sheet and
    // Playwright's tap lands on the search input that's intercepting.
    const picker = page
      .locator('.sheet')
      .filter({ has: page.getByPlaceholder('Search products...') });
    await picker.getByText(name).first().tap();
    await page.getByText('How much?').waitFor({ state: 'visible' });

    await page.getByRole('spinbutton').fill('200');
    // GramsPicker.tsx:232 — Enter preventDefaults, blurs, then calls onConfirm.
    await page.getByRole('spinbutton').press('Enter');

    // The Enter-path entry has 200g, seeded entry has 100g. Exactly one row
    // should carry '200g' text.
    await expect(
      page.locator('.food-row').filter({ hasText: name }).filter({ hasText: '200g' }),
    ).toHaveCount(1);
  });

  test('[J-044] Enter on GramsPicker edit-mode input saves the change', async ({ page }) => {
    const name = 'E2E Kbd Edit';
    await page.goto('/');
    await seedProductAndLog(page, name, MACROS, '100');

    // Tap the row to open GramsPicker in edit mode (title 'Edit amount').
    await page.locator('.food-row').filter({ hasText: name }).locator('button').nth(1).tap();
    await page.getByText('Edit amount').waitFor({ state: 'visible' });

    await page.getByRole('spinbutton').fill('250');
    await page.getByRole('spinbutton').press('Enter');

    // Same row, grams updated from 100g → 250g.
    await expect(
      page.locator('.food-row').filter({ hasText: name }).filter({ hasText: '250g' }),
    ).toHaveCount(1);
  });

  test('[J-046] Enter on empty GramsPicker input is a no-op', async ({ page }) => {
    // Pre-fix: clearing the input then pressing Enter would silently log a
    // 1g entry — Number('') === 0, Math.max(1, 0) === 1, onConfirm(1) fires.
    // Post-fix: onInput skips setGrams when the raw text is empty, AND the
    // Enter handler returns early when text is empty. So Enter on an empty
    // input is a no-op: the sheet stays open and no entry is mutated.
    const name = 'E2E Kbd Empty';
    await page.goto('/');
    await seedProductAndLog(page, name, MACROS, '200');

    await page.locator('.food-row').filter({ hasText: name }).locator('button').nth(1).tap();
    await page.getByText('Edit amount').waitFor({ state: 'visible' });

    await page.getByRole('spinbutton').fill('');
    await page.getByRole('spinbutton').press('Enter');

    // Wait past Sheet.tsx FADE_EXIT_MS (300ms) so a buggy onConfirm-driven
    // close would have fully unmounted the sheet by now.
    await page.waitForTimeout(400);

    // Sheet still open — Enter was a no-op (would have closed via onConfirm).
    await expect(page.getByText('Edit amount')).toBeVisible();
  });

  test('[J-045] Enter on AddPicker search only blurs (no submit)', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'ADD FOOD' }).tap();

    const search = page.getByPlaceholder('Search products...');
    await search.fill('random query no-hit');
    await expect(search).toBeFocused();

    // AddPicker.tsx:158 — Enter calls e.currentTarget.blur() and nothing else.
    // A regression wiring it to "pick top result" would silently break UX.
    await search.press('Enter');

    await expect(search).not.toBeFocused();
    // AddPicker sheet is still open (Enter didn't dismiss anything).
    await expect(page.getByText('Add Food', { exact: true })).toBeVisible();
  });
});
