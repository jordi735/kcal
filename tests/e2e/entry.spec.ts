import { expect, test } from '@playwright/test';
import { fillNutField } from './helpers';

test('create product, log entry, edit grams, delete', async ({ page }) => {
  await page.goto('/');

  // Add flow: home → AddPicker → NewProductForm.
  // NOTE: buttons inside Sheet modals respond to touch events, not mouse.
  // Use tap() on mobile device profiles, not click().
  await page.getByRole('button', { name: 'ADD FOOD' }).tap();
  await page.getByRole('button', { name: 'Add New' }).tap();

  // Product form: name + macros per 100g.
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

  // The entry is now on the day. 150g × 400 kcal/100g = 600 kcal.
  const row = page.locator('.food-row').filter({ hasText: 'E2E Oats' });
  await expect(row).toContainText('600');

  // Edit: tap the row's main button → GramsPicker in edit mode. Change to 200g.
  await row.locator('button').filter({ hasText: 'E2E Oats' }).tap();
  await expect(page.getByText('Edit amount')).toBeVisible();
  await page.getByRole('spinbutton').fill('200');
  await page.getByRole('button', { name: 'Save', exact: true }).tap();

  // 200g × 400/100 = 800 kcal.
  await expect(row).toContainText('800');

  // Delete the entry via GramsPicker's trash button.
  await row.locator('button').filter({ hasText: 'E2E Oats' }).tap();
  await page.getByRole('button', { name: 'Delete entry' }).tap();
  await expect(row).toHaveCount(0);
});
