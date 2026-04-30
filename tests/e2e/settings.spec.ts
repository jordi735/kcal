import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Settings.tsx renders 4 GoalField number inputs in order:
// Protein, Carbs, Fat, Kcal (Kcal is last — see src/screens/Settings.tsx:163-172).
// Macro and kcal fields are decoupled (Settings.tsx:115-117): bumping a macro
// never overwrites the kcal field. The mismatch banner (Settings.tsx:202-206)
// is the single source of drift signal between typed kcal and the macro-derived
// total. MAX_KCAL=20000 and MAX_MACRO_GRAMS=2000 are server-only caps
// (server/routes/settings.ts:15-16); the UI does not enforce them.

// Each GoalField row has exactly 2 buttons — minus first, plus last.
// Climb from the input three levels: input → valueBox → fieldRight → field row.
function bumpButtons(page: Page, fieldIndex: number) {
  const field = page.getByRole('spinbutton').nth(fieldIndex).locator('../../..');
  return {
    minus: field.getByRole('button').first(),
    plus: field.getByRole('button').last(),
  };
}

// Inline tokenFrom — same pattern as entry/edit/race/adopt/search specs.
// helpers.ts is read-only from review passes; if a third spec adopts this
// snippet it would graduate into helpers.ts via a dedicated extraction pass.
type StorageState = {
  origins: Array<{ localStorage: Array<{ name: string; value: string }> }>;
};
function tokenFrom(path: string): string {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as StorageState;
  const entry = parsed.origins[0]?.localStorage.find(
    (e) => e.name === 'kcal_session_token',
  );
  if (entry === undefined) throw new Error(`no session token in ${path}`);
  return entry.value;
}

test('[J-018] change daily kcal goal persists and updates MacroSummary', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Settings' }).tap();
  await expect(page.getByText('Daily goals')).toBeVisible();

  // Set kcal to 1800 via the last spinbutton.
  await page.getByRole('spinbutton').last().fill('1800');
  await page.getByRole('button', { name: 'Save', exact: true }).tap();

  // Sheet must close on success — Settings.tsx:137 calls close() inside the
  // try/finally. Mutation: a save handler that swallowed the error and never
  // closed the sheet would fail this assertion.
  await expect(page.getByText('Daily goals')).toHaveCount(0);

  // MacroSummary.tsx:36 — `<span>/ {goals.kcal}</span>`. Anchor-match the goal
  // exactly so a stray "1800" in some other component doesn't false-positive.
  await expect(page.getByText(/^\/ 1800$/)).toBeVisible();

  // Reload to confirm server-persistence path round-trips through localStorage
  // (App.tsx:482-491 stores the saved goals back into the User record).
  await page.reload();
  await expect(page.getByText(/^\/ 1800$/)).toBeVisible();
});

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

    // The macro→kcal cross-derive in Settings.tsx was deliberately removed
    // (Settings.tsx:115-117). Editing a macro never overwrites kcal; drift
    // surfaces via the mismatch banner only. Both halves are asserted —
    // a regression that re-wires kcal=4P+4C+9F on every bump would fail
    // the kcalIn assertion.
    await expect(proteinIn).toHaveValue(String(oldP + 5));
    await expect(kcalIn).toHaveValue(String(oldKcal));
  });

  test('[J-134] + button increments carbs without touching kcal', async ({ page }) => {
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

  test('[J-135] + button increments fat without touching kcal', async ({ page }) => {
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

  test('[J-138] kcal +/- buttons step by 50 (macros step by 5)', async ({ page }) => {
    // GoalField defaults step=5 (Settings.tsx:38); kcal renders with step=50
    // (Settings.tsx:172). Mutation: flipping kcal's step to 5 (or wiring the
    // macro fields to 50) would silently break the daily-budget UX. Asserting
    // both directions catches off-by-one between bumps.
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings' }).tap();
    await expect(page.getByText('Daily goals')).toBeVisible();

    const kcalIn = page.getByRole('spinbutton').nth(3);
    const oldKcal = parseInt(await kcalIn.inputValue(), 10);

    await bumpButtons(page, 3).plus.tap();
    await expect(kcalIn).toHaveValue(String(oldKcal + 50));

    await bumpButtons(page, 3).minus.tap();
    await expect(kcalIn).toHaveValue(String(oldKcal));
  });

  test('[J-020] - button clamps protein at 0', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings' }).tap();
    await expect(page.getByText('Daily goals')).toBeVisible();

    const proteinIn = page.getByRole('spinbutton').nth(0);
    await proteinIn.fill('3');

    // Each minus tap = bump(Math.max(0, value - 5)) per Settings.tsx:60. After
    // the first tap protein is 0; subsequent taps stay at 0. Mutation guard:
    // dropping `Math.max(0, …)` would let value drift to -22 over five taps.
    for (let i = 0; i < 5; i++) {
      await bumpButtons(page, 0).minus.tap();
    }

    await expect(proteinIn).toHaveValue('0');
  });

  test('[J-021] mismatch banner shows when kcal disagrees with macros by >50; quotes both sides', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings' }).tap();
    await expect(page.getByText('Daily goals')).toBeVisible();

    // Macro fills no longer touch kcal (Settings.tsx:115-117). Derived total
    // = 4*50 + 4*50 + 9*10 = 490; kcal pinned at 3000 → gap = 2510 > 50.
    await page.getByRole('spinbutton').nth(0).fill('50');
    await page.getByRole('spinbutton').nth(1).fill('50');
    await page.getByRole('spinbutton').nth(2).fill('10');
    await page.getByRole('spinbutton').nth(3).fill('3000');

    // Banner exists AND quotes BOTH sides of the mismatch (Settings.tsx:204).
    // Independent assertions — a mutation that swapped derivedKcal/kcal in
    // the message would survive a label-only check.
    const banner = page.getByText(/^Heads up — /);
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('490 kcal'); // derivedKcal
    await expect(banner).toContainText('not 3000'); // user-typed kcal

    // The macro-card header surfaces the derived total independently
    // (Settings.tsx:178). Pins the 4P+4C+9F formula — flipping a coefficient
    // (e.g. F*4 instead of F*9) would produce a different number here.
    await expect(page.getByText('490 kcal from macros', { exact: true })).toBeVisible();
  });

  test('[J-137] mismatch banner boundary: gap of 50 stays clean, gap of 51 fires', async ({ page }) => {
    // Settings.tsx:120 — `Math.abs(derivedKcal - kcal) > 50`. Mutation guards:
    // (a) `> 50` → `>= 50` would fire at gap=50;
    // (b) `> 50` → `> 49` would also fire at gap=50.
    // Both mutations are caught by asserting absent at 50 AND present at 51.
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings' }).tap();
    await expect(page.getByText('Daily goals')).toBeVisible();

    // Pin a small derived total: P=0, C=0, F=100 → derivedKcal = 0+0+900 = 900.
    await page.getByRole('spinbutton').nth(0).fill('0');
    await page.getByRole('spinbutton').nth(1).fill('0');
    await page.getByRole('spinbutton').nth(2).fill('100');
    // Sanity-check the formula evaluation before exercising the comparator.
    await expect(page.getByText('900 kcal from macros', { exact: true })).toBeVisible();

    // Gap exactly 50 → comparator FALSE → no banner.
    await page.getByRole('spinbutton').nth(3).fill('950');
    await expect(page.getByText(/^Heads up — /)).toHaveCount(0);

    // Gap of 51 → comparator TRUE → banner fires.
    await page.getByRole('spinbutton').nth(3).fill('951');
    await expect(page.getByText(/^Heads up — /)).toBeVisible();
  });

  test('[J-136] mismatch banner persists across a macro change; clears only when kcal is realigned', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings' }).tap();
    await expect(page.getByText('Daily goals')).toBeVisible();

    // Arrange a big mismatch — kcal=3000, derivedKcal=490.
    await page.getByRole('spinbutton').nth(0).fill('50');
    await page.getByRole('spinbutton').nth(1).fill('50');
    await page.getByRole('spinbutton').nth(2).fill('10');
    await page.getByRole('spinbutton').nth(3).fill('3000');
    await expect(page.getByText(/^Heads up — /)).toBeVisible();

    // Macro changes no longer auto-derive kcal. Bumping fat to 20 changes
    // derivedKcal to 580, but the user-typed kcal stays at 3000 — mismatch
    // remains > 50, banner stays. Verifying the new derived total ALONGSIDE
    // banner persistence pins both the 9*F coefficient AND the comparator.
    await page.getByRole('spinbutton').nth(2).fill('20');
    await expect(page.getByText('580 kcal from macros', { exact: true })).toBeVisible();
    await expect(page.getByText(/^Heads up — /)).toBeVisible();

    // Manually realign kcal to the new derived total (gap=0) → banner gone.
    await page.getByRole('spinbutton').nth(3).fill('580');
    await expect(page.getByText(/^Heads up — /)).toHaveCount(0);
  });

  test("[J-141] Settings Account section displays the user's signed-in email", async ({ page }) => {
    // Settings.tsx:218-220 renders `userEmail` (passed from App.tsx:605) under
    // a "Signed in as" label. Shared storageState user is e2e@test.local
    // (auth.setup.ts:8). Mutation guard: a regression passing `null` here would
    // render the 'you@example.com' fallback (Settings.tsx:219).
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings' }).tap();
    await expect(page.getByText('Daily goals')).toBeVisible();

    await expect(page.getByText('Signed in as')).toBeVisible();
    await expect(page.getByText('e2e@test.local', { exact: true })).toBeVisible();
    // Negative path: the fallback string must NOT render — proves the userEmail
    // prop actually populated, not the null-fallback branch.
    await expect(page.getByText('you@example.com', { exact: true })).toHaveCount(0);
  });

  test('[J-022] Cancel does not persist changes (kcal nor macros)', async ({ page }) => {
    await page.goto('/');

    // Establish a known baseline (kcal=2000, protein=180) so the assertion is
    // decoupled from prior test state.
    await page.getByRole('button', { name: 'Settings' }).tap();
    await expect(page.getByText('Daily goals')).toBeVisible();
    await page.getByRole('spinbutton').nth(0).fill('180');
    await page.getByRole('spinbutton').nth(3).fill('2000');
    await page.getByRole('button', { name: 'Save', exact: true }).tap();
    await expect(page.getByText(/^\/ 2000$/)).toBeVisible();
    // MacroSummary becomes visible the instant Save fires; wait for the sheet
    // to fully unmount before re-opening (per CLAUDE.md Sheet animation note).
    await expect(page.getByText('Daily goals')).toHaveCount(0);

    // Open Settings again, change kcal AND protein, tap Cancel.
    await page.getByRole('button', { name: 'Settings' }).tap();
    await expect(page.getByText('Daily goals')).toBeVisible();
    await page.getByRole('spinbutton').nth(0).fill('999');
    await page.getByRole('spinbutton').nth(3).fill('1234');
    await page.getByRole('button', { name: 'Cancel', exact: true }).tap();

    // Goal kcal still 2000 — never persisted.
    await expect(page.getByText(/^\/ 2000$/)).toBeVisible();

    // Reload + reopen Settings to confirm protein also reverted. Mutation
    // guard: a Cancel that accidentally invoked onSave would persist 999
    // and this assertion would fail.
    await page.reload();
    await expect(page.getByText(/^\/ 2000$/)).toBeVisible();
    await page.getByRole('button', { name: 'Settings' }).tap();
    await expect(page.getByText('Daily goals')).toBeVisible();
    await expect(page.getByRole('spinbutton').nth(0)).toHaveValue('180');
  });

  test('[J-140] Save persists all four goals across reload', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings' }).tap();
    await expect(page.getByText('Daily goals')).toBeVisible();

    // Distinctive values that don't collide with defaults / prior-test residue.
    // Mutation guard: a save handler that wrote kcal but dropped any of the
    // three macros would fail this on reload.
    await page.getByRole('spinbutton').nth(0).fill('111'); // protein
    await page.getByRole('spinbutton').nth(1).fill('222'); // carbs
    await page.getByRole('spinbutton').nth(2).fill('33'); // fat
    await page.getByRole('spinbutton').nth(3).fill('1888'); // kcal

    await page.getByRole('button', { name: 'Save', exact: true }).tap();
    await expect(page.getByText('Daily goals')).toHaveCount(0);
    await expect(page.getByText(/^\/ 1888$/)).toBeVisible();

    // Reload + reopen → every input reads back the saved value. The kcal bar
    // also re-renders /1888 from cold cache, proving the User record in
    // localStorage was synced (App.tsx:482-491).
    await page.reload();
    await expect(page.getByText(/^\/ 1888$/)).toBeVisible();
    await page.getByRole('button', { name: 'Settings' }).tap();
    await expect(page.getByText('Daily goals')).toBeVisible();
    await expect(page.getByRole('spinbutton').nth(0)).toHaveValue('111');
    await expect(page.getByRole('spinbutton').nth(1)).toHaveValue('222');
    await expect(page.getByRole('spinbutton').nth(2)).toHaveValue('33');
    await expect(page.getByRole('spinbutton').nth(3)).toHaveValue('1888');
  });

  test('[J-139] PUT /settings rejects invalid_goals across every isGoalsBody branch', async ({ request }) => {
    // server/routes/settings.ts:22-30 — isGoalsBody requires every field to be
    // an integer in [0, MAX]. MAX_KCAL=20000, MAX_MACRO_GRAMS=2000. A bad body
    // returns 400 `{ error: 'invalid_goals' }`. The matrix below exercises
    // every branch of isGoalInt / isGoalsBody at least once.
    const token = tokenFrom('tests/e2e/.auth/user.json');
    const headers = { Authorization: `Bearer ${token}` };

    const cases: Array<[string, unknown]> = [
      ['empty body', {}],
      ['missing kcal', { protein: 100, carbs: 100, fat: 100 }],
      ['kcal not number (string)', { kcal: 'x', protein: 100, carbs: 100, fat: 100 }],
      ['kcal not integer (3.14)', { kcal: 3.14, protein: 100, carbs: 100, fat: 100 }],
      ['kcal negative', { kcal: -1, protein: 100, carbs: 100, fat: 100 }],
      ['kcal over MAX_KCAL', { kcal: 20001, protein: 100, carbs: 100, fat: 100 }],
      ['protein over MAX_MACRO_GRAMS', { kcal: 2000, protein: 2001, carbs: 100, fat: 100 }],
      ['carbs negative', { kcal: 2000, protein: 100, carbs: -1, fat: 100 }],
      ['fat as string', { kcal: 2000, protein: 100, carbs: 100, fat: '50' }],
      ['fat not integer (10.5)', { kcal: 2000, protein: 100, carbs: 100, fat: 10.5 }],
    ];

    for (const [label, body] of cases) {
      const res = await request.put('/settings', {
        headers,
        data: body as Record<string, unknown>,
      });
      expect(res.status(), `${label}: status`).toBe(400);
      const json = (await res.json()) as { error: string };
      expect(json.error, `${label}: error code`).toBe('invalid_goals');
    }
  });
});
