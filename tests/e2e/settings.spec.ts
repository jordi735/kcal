import { expect, test, type Page } from '@playwright/test';

// Settings.tsx renders 4 GoalField number inputs in order:
// Protein, Carbs, Fat, Kcal (Kcal is last — see src/screens/Settings.tsx:173-182).
// Changing macros auto-recomputes kcal; changing kcal directly sticks.
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
  test('[J-019] + button increments protein and auto-recomputes kcal', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings' }).tap();
    await expect(page.getByText('Daily goals')).toBeVisible();

    const proteinIn = page.getByRole('spinbutton').nth(0);
    const carbsIn = page.getByRole('spinbutton').nth(1);
    const fatIn = page.getByRole('spinbutton').nth(2);
    const kcalIn = page.getByRole('spinbutton').nth(3);

    const oldP = parseInt(await proteinIn.inputValue(), 10);
    const c = parseInt(await carbsIn.inputValue(), 10);
    const f = parseInt(await fatIn.inputValue(), 10);

    await bumpButtons(page, 0).plus.tap();

    // Settings.tsx:117 — onChangeP fully re-derives kcal from p/c/f, it
    // doesn't increment. So expected new kcal = 4*(P+5) + 4*C + 9*F.
    const newP = oldP + 5;
    const expectedKcal = Math.round(newP * 4 + c * 4 + f * 9);

    await expect(proteinIn).toHaveValue(String(newP));
    await expect(kcalIn).toHaveValue(String(expectedKcal));
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

    // Set macros first — each fill auto-recomputes kcal via onChangeP/C/F.
    // After the third fill, derived kcal = 4*50 + 4*50 + 9*10 = 490.
    await page.getByRole('spinbutton').nth(0).fill('50');
    await page.getByRole('spinbutton').nth(1).fill('50');
    await page.getByRole('spinbutton').nth(2).fill('10');

    // Override kcal directly to 3000 — Settings.tsx:182 wires Kcal's onChange
    // straight to setKcal, so this does NOT trigger macro recomputation.
    await page.getByRole('spinbutton').nth(3).fill('3000');

    // |3000 - 490| = 2510 > 50 → mismatch warning visible (Settings.tsx:213).
    await expect(page.getByText(/Heads up/)).toBeVisible();
  });

  test('[J-019] + button increments carbs and auto-recomputes kcal', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings' }).tap();
    await expect(page.getByText('Daily goals')).toBeVisible();

    const proteinIn = page.getByRole('spinbutton').nth(0);
    const carbsIn = page.getByRole('spinbutton').nth(1);
    const fatIn = page.getByRole('spinbutton').nth(2);
    const kcalIn = page.getByRole('spinbutton').nth(3);

    const p = parseInt(await proteinIn.inputValue(), 10);
    const oldC = parseInt(await carbsIn.inputValue(), 10);
    const f = parseInt(await fatIn.inputValue(), 10);

    await bumpButtons(page, 1).plus.tap();

    const newC = oldC + 5;
    // Settings.tsx:121 — onChangeC recomputes kcal from p/(C+5)/f.
    const expectedKcal = Math.round(p * 4 + newC * 4 + f * 9);

    await expect(carbsIn).toHaveValue(String(newC));
    await expect(kcalIn).toHaveValue(String(expectedKcal));
  });

  test('[J-019] + button increments fat and auto-recomputes kcal', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings' }).tap();
    await expect(page.getByText('Daily goals')).toBeVisible();

    const proteinIn = page.getByRole('spinbutton').nth(0);
    const carbsIn = page.getByRole('spinbutton').nth(1);
    const fatIn = page.getByRole('spinbutton').nth(2);
    const kcalIn = page.getByRole('spinbutton').nth(3);

    const p = parseInt(await proteinIn.inputValue(), 10);
    const c = parseInt(await carbsIn.inputValue(), 10);
    const oldF = parseInt(await fatIn.inputValue(), 10);

    await bumpButtons(page, 2).plus.tap();

    const newF = oldF + 5;
    // Settings.tsx:125 — onChangeF recomputes kcal from p/c/(F+5).
    const expectedKcal = Math.round(p * 4 + c * 4 + newF * 9);

    await expect(fatIn).toHaveValue(String(newF));
    await expect(kcalIn).toHaveValue(String(expectedKcal));
  });

  test('[J-021] mismatch warning disappears after adjusting a macro', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings' }).tap();
    await expect(page.getByText('Daily goals')).toBeVisible();

    // Arrange a big mismatch exactly like the 'mismatch warning shows' test.
    await page.getByRole('spinbutton').nth(0).fill('50');
    await page.getByRole('spinbutton').nth(1).fill('50');
    await page.getByRole('spinbutton').nth(2).fill('10');
    await page.getByRole('spinbutton').nth(3).fill('3000');
    await expect(page.getByText(/Heads up/)).toBeVisible();

    // Touching any macro triggers onChangeP/C/F (Settings.tsx:115-126), which
    // re-derives kcal to exactly match p/c/f — mismatch becomes 0 by
    // definition, banner unmounts. This pins the reactive-clear branch of
    // Settings.tsx:130's mismatch condition.
    await page.getByRole('spinbutton').nth(2).fill('20');

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
