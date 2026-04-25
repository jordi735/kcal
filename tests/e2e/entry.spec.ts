import { expect, test } from '@playwright/test';
import { fillNutField, seedProductAndLog } from './helpers';

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

  // 150g × 400 kcal/100g = 600 kcal — proves macros computed from the new product.
  const row = page.locator('.food-row').filter({ hasText: 'E2E Oats' });
  await expect(row).toContainText('600');
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
  await page.getByRole('spinbutton').fill('200');
  await page.getByRole('button', { name: /Add to day/ }).tap();

  // Two rows now: the seeded 100g and this fresh 200g log.
  await expect(page.locator('.food-row').filter({ hasText: name })).toHaveCount(2);
});
