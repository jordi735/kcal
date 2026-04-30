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
      // Count POST /auth/request-code so we can prove Enter fired exactly one
      // submission — not zero (handler removed) and not two (double-fire).
      let requestCount = 0;
      page.on('request', (req) => {
        if (req.method() === 'POST' && req.url().endsWith('/auth/request-code')) {
          requestCount += 1;
        }
      });

      await page.goto('/');
      await page.getByPlaceholder('you@example.com').fill('kbd-login@test.local');
      await page.getByPlaceholder('you@example.com').press('Enter');

      // Successful submit flips step='email' → 'code', rendering the
      // 6-digit code input. Assert on its accessible name — unambiguous.
      await expect(page.getByLabel('6-digit sign-in code')).toBeVisible();
      // Email field is unmounted (step transitioned away from 'email').
      await expect(page.getByPlaceholder('you@example.com')).toHaveCount(0);
      // Exactly one request — proves Enter triggered submitEmail and did
      // not double-fire (e.g. if browser added a phantom default-submit).
      expect(requestCount).toBe(1);
    });

    test('[J-096] Enter on invalid email is a no-op', async ({ page }) => {
      // Login.tsx:42 — submitEmail returns early when !emailValid. A regression
      // dropping that guard (e.g. flipping `!emailValid || submitting` to
      // `!emailValid && submitting`) would advance to the code step and fire
      // POST /auth/request-code with junk. This pins all three guard exits.
      let requestCount = 0;
      page.on('request', (req) => {
        if (req.method() === 'POST' && req.url().endsWith('/auth/request-code')) {
          requestCount += 1;
        }
      });

      await page.goto('/');
      const email = page.getByPlaceholder('you@example.com');
      await email.fill('not-an-email');
      await email.press('Enter');

      // Still on email step — the code input was never mounted.
      await expect(page.getByLabel('6-digit sign-in code')).toHaveCount(0);
      // Email field is still visible and holds the typed (invalid) value.
      await expect(email).toBeVisible();
      await expect(email).toHaveValue('not-an-email');
      // Submit button remains disabled — proves emailValid === false stuck.
      await expect(page.getByRole('button', { name: 'Send sign-in code' })).toBeDisabled();
      // No /auth/request-code request was issued — guard held.
      expect(requestCount).toBe(0);
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
    // GramsPicker.tsx:235 — Enter preventDefaults, blurs, then calls onConfirm.
    await page.getByRole('spinbutton').press('Enter');

    // Sheet dismissed — proves the Enter path drove onConfirm → onClose, not
    // just blurred the input. (Catches a regression dropping the onConfirm.)
    await expect(page.getByText('How much?')).toHaveCount(0);
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

    // Sheet closed — proves Enter committed via onConfirm, not just blurred.
    await expect(page.getByText('Edit amount')).toHaveCount(0);
    // Same row, grams updated from 100g → 250g. Original 100g must be gone.
    await expect(
      page.locator('.food-row').filter({ hasText: name }).filter({ hasText: '250g' }),
    ).toHaveCount(1);
    await expect(
      page.locator('.food-row').filter({ hasText: name }).filter({ hasText: '100g' }),
    ).toHaveCount(0);
  });

  test('[J-095] Enter on empty GramsPicker input is a no-op', async ({ page }) => {
    // Pre-fix: clearing the input then pressing Enter would silently log a
    // 1g entry — Number('') === 0, Math.max(1, 0) === 1, onConfirm(1) fires.
    // Post-fix (GramsPicker.tsx:237): the Enter handler returns early when
    // text is empty. The sheet stays open and no entry is mutated.
    //
    // Mutation resistance: dropping the early-return would close the sheet
    // (commit grams=1 fires onConfirm → onClose). The follow-up `fill('150')`
    // would then operate on a dismounted input and the spec breaks loudly.
    // Strictly stronger than a timed sleep — anchors on element state, not
    // wall-clock.
    const name = 'E2E Kbd Empty';
    await page.goto('/');
    await seedProductAndLog(page, name, MACROS, '200');

    await page.locator('.food-row').filter({ hasText: name }).locator('button').nth(1).tap();
    await page.getByText('Edit amount').waitFor({ state: 'visible' });

    await page.getByRole('spinbutton').fill('');
    await page.getByRole('spinbutton').press('Enter');

    // Sheet still open — Enter was a no-op (would have closed via onConfirm).
    await expect(page.getByText('Edit amount')).toBeVisible();

    // Bonus: the input is still alive and continues to accept input. Typing
    // a real value and pressing Enter must commit it — proves the no-op
    // path didn't leave the input in a zombie state.
    await page.getByRole('spinbutton').fill('150');
    await page.getByRole('spinbutton').press('Enter');

    // Final state: 200g → 150g. A regression that committed grams=1 first
    // would either dismount the sheet (the visibility assertion above would
    // already have failed) or surface a 1g row instead of 150g here.
    await expect(
      page.locator('.food-row').filter({ hasText: name }).filter({ hasText: '150g' }),
    ).toHaveCount(1);
  });

  test('[J-045] Enter on AddPicker search only blurs (no submit)', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'ADD FOOD' }).tap();

    const search = page.getByPlaceholder('Search products...');
    await search.fill('random query no-hit');
    await expect(search).toBeFocused();

    // AddPicker.tsx:158 — Enter calls e.currentTarget.blur() and nothing else.
    // A regression wiring it to "create new from query" or "pick top result"
    // would silently break UX. Assert blur happened AND no follow-on UI fired.
    await search.press('Enter');

    await expect(search).not.toBeFocused();
    // AddPicker sheet is still open (Enter didn't dismiss anything).
    await expect(page.getByText('Add Food', { exact: true })).toBeVisible();
    // Negative-path: Enter must NOT have routed to onCreateNew(q) /
    // onAddTemp(q) / onPick(top result). Each would mount a different sheet
    // or screen — assert none of them did.
    await expect(page.getByText('New Product', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Add Temp Item', { exact: true })).toHaveCount(0);
    await expect(page.getByText('How much?')).toHaveCount(0);
  });
});
