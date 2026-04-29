import { expect, test } from '@playwright/test';
import { fillNutField } from './helpers';

// Modal-hijack guard: async handlers in App.tsx (onPick, onBarcodeDetect,
// onProductSave) capture flowGenRef before awaiting and bail if the modal
// transitioned during the await. Pre-fix, a slow network response would
// unconditionally setModal({kind:'grams-picker',...}) — yanking the user
// back into a flow they had already cancelled. This spec exercises the
// onProductSave path: it's the simplest to set up (no cross-user seeding
// needed) and uses the same flowGenRef gate as onPick / onBarcodeDetect.

test('[J-047] slow product save with mid-flight dismiss does not hijack modal', async ({ page }) => {
  await page.goto('/');

  // Throttle the products POST so we have a clear window to dismiss.
  await page.route('**/products', async (route) => {
    if (route.request().method() === 'POST') {
      await new Promise((r) => setTimeout(r, 1500));
    }
    await route.continue();
  });

  await page.getByRole('button', { name: 'ADD FOOD' }).tap();
  await page.getByRole('button', { name: 'Add New' }).tap();
  await page.getByPlaceholder('e.g. Peanut Butter').fill('E2E Race Save');
  await fillNutField(page, 'Kcal', '100');
  await fillNutField(page, 'Protein', '10');
  await fillNutField(page, 'Carbs', '10');
  await fillNutField(page, 'Fat', '2');

  // Tap Save → POST is in flight, server hangs ~1500ms.
  await page.getByRole('button', { name: /Save & Continue/ }).tap();

  // While the POST is pending, dismiss via backdrop. closeModal flips
  // modal=none and bumps flowGenRef. The pending await sees the gen
  // mismatch post-resolution and bails — without the fix, GramsPicker
  // would pop over the empty home as soon as the POST returns.
  // dispatchEvent bypasses pointer-event interception by the sheet that
  // visually covers most of the overlay on the mobile viewport.
  await page.locator('.overlay').first().dispatchEvent('click');

  // Wait past the throttle so any spurious post-await setModal would have
  // landed by now.
  await page.waitForTimeout(1700);

  // GramsPicker would render 'How much?' on hijack. With the fix, the
  // modal stays closed.
  await expect(page.getByText('How much?')).toHaveCount(0);
});
