import { expect, test, type Page } from '@playwright/test';

// Settings.tsx renders 4 GoalField number inputs in order:
// Protein, Carbs, Fat, Kcal (Kcal is last — see src/screens/Settings.tsx:173-182).
// Macro and kcal fields are now decoupled — bumping a macro never overwrites
// the kcal field. The mismatch banner is the single source of drift signal.
test('[J-018] change daily kcal goal persists and updates MacroSummary', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Settings' }).tap();
  await expect(page.getByText('Daily goals')).toBeVisible();

  // Set kcal to 1800 via the last spinbutton. Macro mismatch warning may show
  // but doesn't block save.
  await page.getByRole('spinbutton').last().fill('1800');
  await page.getByRole('button', { name: 'Save', exact: true }).tap();

  // Back on home; MacroSummary shows "{left} / {goal}" (src/components/MacroSummary.tsx:36).
  await expect(page.getByText(/\/ 1800/)).toBeVisible();

  // Reload to confirm server-side persistence.
  await page.reload();
  await expect(page.getByText(/\/ 1800/)).toBeVisible();
});

// Each GoalField row has exactly 2 buttons — minus first, plus last.
// Climb from the input three levels: input → valueBox → fieldRight → field row.
function bumpButtons(page: Page, fieldIndex: number) {
  const field = page.getByRole('spinbutton').nth(fieldIndex).locator('../../..');
  return {
    minus: field.getByRole('button').first(),
    plus: field.getByRole('button').last(),
  };
}

test.describe('advanced', () => {
  test('[J-019] + button increments protein without touching kcal', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings' }).tap();
    await expect(page.getByText('Daily goals')).toBeVisible();

    const proteinIn = page.getByRole('spinbutton').nth(0);
    const kcalIn = page.getByRole('spinbutton').nth(3);

    const oldP = parseInt(await proteinIn.inputValue(), 10);
    const oldKcal = parseInt(await kcalIn.inputValue(), 10);

    await bumpButtons(page, 0).plus.tap();

    // The macro→kcal cross-derive in Settings.tsx was deliberately removed:
    // editing a macro never overwrites kcal. Drift surfaces via the mismatch
    // banner instead.
    await expect(proteinIn).toHaveValue(String(oldP + 5));
    await expect(kcalIn).toHaveValue(String(oldKcal));
  });

  test('[J-020] - button clamps protein at 0', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings' }).tap();
    await expect(page.getByText('Daily goals')).toBeVisible();

    const proteinIn = page.getByRole('spinbutton').nth(0);
    await proteinIn.fill('3');

    // Each minus tap = bump(Math.max(0, value - 5)) per Settings.tsx:60. After
    // the first tap protein is 0; subsequent taps stay at 0.
    for (let i = 0; i < 5; i++) {
      await bumpButtons(page, 0).minus.tap();
    }

    await expect(proteinIn).toHaveValue('0');
  });

  test('[J-021] mismatch warning shows when kcal disagrees with macros by >50', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings' }).tap();
    await expect(page.getByText('Daily goals')).toBeVisible();

    // Macro fills no longer touch kcal — kcal stays at whatever it was
    // (default 2400, or whatever a prior test persisted). Derived kcal
    // after the three fills is 4*50 + 4*50 + 9*10 = 490, so the gap to the
    // user-typed kcal will be well over 50.
    await page.getByRole('spinbutton').nth(0).fill('50');
    await page.getByRole('spinbutton').nth(1).fill('50');
    await page.getByRole('spinbutton').nth(2).fill('10');

    // Pin kcal at a known value to make the assertion deterministic.
    await page.getByRole('spinbutton').nth(3).fill('3000');

    // |3000 - 490| = 2510 > 50 → mismatch warning visible (Settings.tsx:213).
    await expect(page.getByText(/Heads up/)).toBeVisible();
  });

  test('[J-019] + button increments carbs without touching kcal', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings' }).tap();
    await expect(page.getByText('Daily goals')).toBeVisible();

    const carbsIn = page.getByRole('spinbutton').nth(1);
    const kcalIn = page.getByRole('spinbutton').nth(3);

    const oldC = parseInt(await carbsIn.inputValue(), 10);
    const oldKcal = parseInt(await kcalIn.inputValue(), 10);

    await bumpButtons(page, 1).plus.tap();

    await expect(carbsIn).toHaveValue(String(oldC + 5));
    await expect(kcalIn).toHaveValue(String(oldKcal));
  });

  test('[J-019] + button increments fat without touching kcal', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings' }).tap();
    await expect(page.getByText('Daily goals')).toBeVisible();

    const fatIn = page.getByRole('spinbutton').nth(2);
    const kcalIn = page.getByRole('spinbutton').nth(3);

    const oldF = parseInt(await fatIn.inputValue(), 10);
    const oldKcal = parseInt(await kcalIn.inputValue(), 10);

    await bumpButtons(page, 2).plus.tap();

    await expect(fatIn).toHaveValue(String(oldF + 5));
    await expect(kcalIn).toHaveValue(String(oldKcal));
  });

  test('[J-021] mismatch warning persists after a macro change; clears only when kcal is realigned', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings' }).tap();
    await expect(page.getByText('Daily goals')).toBeVisible();

    // Arrange a big mismatch — kcal=3000, derivedKcal=490.
    await page.getByRole('spinbutton').nth(0).fill('50');
    await page.getByRole('spinbutton').nth(1).fill('50');
    await page.getByRole('spinbutton').nth(2).fill('10');
    await page.getByRole('spinbutton').nth(3).fill('3000');
    await expect(page.getByText(/Heads up/)).toBeVisible();

    // Macro changes no longer auto-derive kcal. Bumping fat to 20 changes
    // derivedKcal to 580, but the user-typed kcal stays at 3000 — mismatch
    // remains > 50, banner stays.
    await page.getByRole('spinbutton').nth(2).fill('20');
    await expect(page.getByText(/Heads up/)).toBeVisible();

    // Manually realign kcal to the new derived total to clear the banner.
    await page.getByRole('spinbutton').nth(3).fill('580');
    await expect(page.getByText(/Heads up/)).toHaveCount(0);
  });

  test('[J-022] Cancel does not persist changes', async ({ page }) => {
    await page.goto('/');

    // Establish a known baseline of 2000 first, so the assertion is decoupled
    // from whatever the previous test happened to save.
    await page.getByRole('button', { name: 'Settings' }).tap();
    await expect(page.getByText('Daily goals')).toBeVisible();
    await page.getByRole('spinbutton').nth(3).fill('2000');
    await page.getByRole('button', { name: 'Save', exact: true }).tap();
    await expect(page.getByText(/\/ 2000/)).toBeVisible();
    // MacroSummary becomes visible the instant Save fires (it's behind the
    // sheet), but the sheet is still mid-exit. Wait for it to fully unmount
    // before re-opening — otherwise the second open animation collides with
    // the first close, and Cancel never settles into a stable position.
    await expect(page.getByText('Daily goals')).toHaveCount(0);

    // Open Settings again, change kcal to 1234, tap Cancel.
    await page.getByRole('button', { name: 'Settings' }).tap();
    await expect(page.getByText('Daily goals')).toBeVisible();
    await page.getByRole('spinbutton').nth(3).fill('1234');
    await page.getByRole('button', { name: 'Cancel', exact: true }).tap();

    // Goal still 2000 — never persisted.
    await expect(page.getByText(/\/ 2000/)).toBeVisible();
    await page.reload();
    await expect(page.getByText(/\/ 2000/)).toBeVisible();
  });
});
