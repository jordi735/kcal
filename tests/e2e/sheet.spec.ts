import { expect, test, type Page } from '@playwright/test';

// Sheet.tsx:55 DISMISS_THRESHOLD_PX=80, :56 SLOP_PX=6, FADE_EXIT_MS=300.
// Two input paths wired (touch via addEventListener, pointer via JSX), but
// the pointer path filters `pointerType='touch'` — so Playwright's page.mouse
// (which synthesizes pointerType='mouse') cleanly drives the JSX path on any
// device profile, mobile or desktop.
async function dragSheet(page: Page, deltaY: number) {
  const sheet = page.locator('.sheet');
  // The sheet slides in over FADE_EXIT_MS=300; calling boundingBox() while
  // it's still animating reads a y-coordinate that's no longer accurate by
  // the time pointerdown fires. Poll until two consecutive reads agree —
  // that's our signal the slide-in transform has settled.
  let prev = await sheet.boundingBox();
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(50);
    const next = await sheet.boundingBox();
    if (prev !== null && next !== null && Math.abs(prev.y - next.y) < 0.5) {
      prev = next;
      break;
    }
    prev = next;
  }
  const box = prev;
  if (box === null) throw new Error('sheet has no bounding box');
  const x = box.x + box.width / 2;
  // Start near the top of the sheet — above any inputs. beginGesture (line 152)
  // bails out if the pointer target is inside input/textarea/select.
  const startY = box.y + 20;
  await page.mouse.move(x, startY);
  await page.mouse.down();
  // Interpolate so the first pointermove crosses SLOP_PX=6 and commits phase
  // to 'dragging'. Single-move 90px jumps also work, but stepping matches a
  // real finger and exercises updateGesture() more realistically.
  await page.mouse.move(x, startY + deltaY, { steps: 10 });
  await page.mouse.up();
}

test('[J-037] drag down past 80px dismisses the sheet', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).tap();
  await expect(page.getByText('Daily goals')).toBeVisible();

  await dragSheet(page, 90);

  // beginExit() slides the sheet off, then setTimeout(onClose, FADE_EXIT_MS)
  // unmounts. toHaveCount(0) waits for full unmount automatically.
  await expect(page.getByText('Daily goals')).toHaveCount(0);
  // Belt-and-braces: prove the .sheet element is truly gone, not just the text.
  // Catches a regression where Settings were swapped for a different sheet.
  await expect(page.locator('.sheet')).toHaveCount(0);
});

test('[J-038] drag down under 80px snaps back; sheet stays open', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).tap();
  await expect(page.getByText('Daily goals')).toBeVisible();

  await dragSheet(page, 40);

  // Snap transition is 0.3s (line 240 adds .sheet--snapping, line 237
  // removes on transitionend). 'Daily goals' never leaves the DOM AND
  // exactly one sheet remains mounted (no rogue unmount-then-remount).
  await expect(page.getByText('Daily goals')).toBeVisible();
  await expect(page.locator('.sheet')).toHaveCount(1);
});

test('[J-039] drag starting on an input is skipped; sheet stays open', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).tap();
  await expect(page.getByText('Daily goals')).toBeVisible();

  // Sheet.tsx:177 — if the gesture starts inside input/textarea/select,
  // beginGesture returns false and the drag state never activates, so native
  // focus/selection keeps working. 90px downward pull = would otherwise
  // dismiss, but here it shouldn't.
  const input = page.getByRole('spinbutton').first();
  const box = await input.boundingBox();
  if (box === null) throw new Error('input has no bounding box');
  const x = box.x + box.width / 2;
  const startY = box.y + box.height / 2;

  await page.mouse.move(x, startY);
  await page.mouse.down();
  await page.mouse.move(x, startY + 90, { steps: 10 });
  await page.mouse.up();

  await expect(page.getByText('Daily goals')).toBeVisible();
  await expect(page.locator('.sheet')).toHaveCount(1);
});

test('[J-046] swipe-down on stacked sheet clears the whole modal stack', async ({ page }) => {
  // App.tsx wires NewProductForm's onClose to back-nav (kind: 'add-picker'),
  // so without onDismiss the swipe would tear NewProductForm down only to
  // re-mount AddPicker. With onDismiss=closeModal (App.tsx:552), gesture/
  // backdrop dismiss bypasses the back-nav and the stack lands at
  // ModalState 'none' → 0 sheets in the DOM.
  await page.goto('/');
  await page.getByRole('button', { name: 'ADD FOOD' }).tap();
  await expect(page.locator('.sheet')).toHaveCount(1);

  await page.getByRole('button', { name: 'Add New' }).tap();
  // Replaced AddPicker with NewProductForm — still one sheet on screen.
  await expect(page.getByPlaceholder('e.g. Peanut Butter')).toBeVisible();

  await dragSheet(page, 90);

  await expect(page.locator('.sheet')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'ADD FOOD' })).toBeVisible();
});

test('[J-142] backdrop tap dismisses the sheet (registerClose=requestDismiss)', async ({ page }) => {
  // SheetOverlay's onClick (App.tsx:532) fires `activeSheetCloseRef.current?.()`,
  // and Sheet.tsx:160 registers `requestDismiss` (NOT requestClose) — so even
  // for a sheet whose onClose would back-nav, a backdrop tap fully tears down.
  // Settings has only onClose=closeModal, so this test verifies the
  // backdrop-routes-through-registered-callback wiring on the simpler case.
  //
  // We dispatch click directly on the overlay rather than `.tap()`-ing a
  // coordinate: `.overlay` (z=50) sits BEHIND `.sheet` (z=51), so a Playwright
  // tap centered on the overlay element gets intercepted by the sheet's
  // pointer-event-receiving inputs. dispatchEvent fires the onClick handler
  // unconditionally, which is precisely what the test asserts.
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).tap();
  await expect(page.getByText('Daily goals')).toBeVisible();
  await expect(page.locator('.overlay')).toBeVisible();

  await page.locator('.overlay').dispatchEvent('click');

  await expect(page.locator('.sheet')).toHaveCount(0);
  await expect(page.getByText('Daily goals')).toHaveCount(0);
});

test('[J-143] Cancel on stacked NewProductForm back-navs to AddPicker (onClose path)', async ({ page }) => {
  // NewProductForm's Cancel button calls useSheetClose() → requestClose →
  // beginExit('close') → finalize=onClose. App.tsx:551 wires onClose to
  // setModal({ kind: 'add-picker' }), so Cancel is a back-nav, NOT a
  // tear-down. Contrast with J-144 (backdrop) and J-046 (drag), which both
  // route through onDismiss=closeModal and land at ModalState 'none'.
  await page.goto('/');
  await page.getByRole('button', { name: 'ADD FOOD' }).tap();
  await page.getByRole('button', { name: 'Add New' }).tap();
  await expect(page.getByPlaceholder('e.g. Peanut Butter')).toBeVisible();

  await page.getByRole('button', { name: 'Cancel', exact: true }).tap();

  // After the slide-off (FADE_EXIT_MS=300) onClose fires and a fresh Sheet
  // mounts with AddPicker. NewProductForm-specific elements gone, AddPicker
  // still mounted.
  await expect(page.getByPlaceholder('e.g. Peanut Butter')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add New' })).toBeVisible();
  await expect(page.locator('.sheet')).toHaveCount(1);
});

test('[J-144] backdrop tap on stacked sheet clears the whole modal stack (onDismiss path)', async ({ page }) => {
  // Backdrop tap counterpart to J-046's drag. The same onDismiss=closeModal
  // wiring at App.tsx:552 should land us at ModalState 'none', not back at
  // AddPicker. If a regression swapped registerClose to requestClose
  // (Sheet.tsx:160), this test would catch it: the stack would unwind to
  // AddPicker instead of fully tearing down.
  await page.goto('/');
  await page.getByRole('button', { name: 'ADD FOOD' }).tap();
  await page.getByRole('button', { name: 'Add New' }).tap();
  await expect(page.getByPlaceholder('e.g. Peanut Butter')).toBeVisible();

  // dispatchEvent (rather than tap) — see J-142 for the z-index rationale.
  await page.locator('.overlay').dispatchEvent('click');

  await expect(page.locator('.sheet')).toHaveCount(0);
  // Negative-path: rule out the back-nav-to-AddPicker outcome.
  await expect(page.getByRole('button', { name: 'Add New' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'ADD FOOD' })).toBeVisible();
});

test('[J-145] drag exactly 80px dismisses (>= boundary)', async ({ page }) => {
  // Sheet.tsx:227 reads `if (deltaY >= DISMISS_THRESHOLD_PX) requestDismiss()`.
  // Mutation `>=` → `>` would let exactly 80px snap back instead. Pinning the
  // boundary at 80 catches that. J-146 pins the symmetric direction (79=snap).
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).tap();
  await expect(page.getByText('Daily goals')).toBeVisible();

  await dragSheet(page, 80);

  await expect(page.locator('.sheet')).toHaveCount(0);
  await expect(page.getByText('Daily goals')).toHaveCount(0);
});

test('[J-146] drag exactly 79px snaps back (just under boundary)', async ({ page }) => {
  // Symmetric pin to J-145. Mutation `>=` → `>=80` is fine; mutation
  // `>= 80` → `>= 75` would dismiss at 79. The pair J-145+J-146 brackets
  // the threshold to a single integer.
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).tap();
  await expect(page.getByText('Daily goals')).toBeVisible();

  await dragSheet(page, 79);

  await expect(page.getByText('Daily goals')).toBeVisible();
  await expect(page.locator('.sheet')).toHaveCount(1);
});

test('[J-147] upward drag is a no-op; sheet stays open and downward drag still dismisses', async ({ page }) => {
  // Pulling up commits phase to 'scrolling' (Sheet.tsx:207, deltaY < -SLOP_PX),
  // so endGesture returns early at line 222 (`drag.phase !== 'dragging'`).
  // The sheet must NOT dismiss, must stay mounted at translateY(0), and must
  // accept a fresh downward gesture afterwards. The follow-up downward drag
  // is the load-bearing assertion: a regression that strands `drag.active`
  // or `exitingRef` would prevent the second gesture from working.
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).tap();
  await expect(page.getByText('Daily goals')).toBeVisible();

  await dragSheet(page, -40);

  await expect(page.getByText('Daily goals')).toBeVisible();
  await expect(page.locator('.sheet')).toHaveCount(1);

  // Re-engage with a downward dismiss-grade drag — proves gesture state
  // wasn't stranded by the upward attempt.
  await dragSheet(page, 90);

  await expect(page.locator('.sheet')).toHaveCount(0);
});

test('[J-148] re-opening a sheet after a dismiss-drag works (no stale exitingRef)', async ({ page }) => {
  // Sheet.tsx:128 sets `exitingRef.current = true` on beginExit and only the
  // unmount cleanup (line 151) clears the timer; `exitingRef` itself is
  // local to the component instance, so a fresh mount starts clean. This
  // test fails if a regression hoisted `exitingRef` into a singleton
  // (e.g. via module scope or a shared context), which would make the
  // second open dead on arrival.
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).tap();
  await expect(page.getByText('Daily goals')).toBeVisible();

  await dragSheet(page, 90);
  // Wait for full teardown before reopening — opening mid-exit is a separate
  // concern (race.spec.ts territory) and not what this test pins.
  await expect(page.locator('.sheet')).toHaveCount(0);

  await page.getByRole('button', { name: 'Settings' }).tap();
  await expect(page.getByText('Daily goals')).toBeVisible();
  await expect(page.locator('.sheet')).toHaveCount(1);

  // Confirm the freshly-mounted sheet is fully interactive: drag again to
  // dismiss. If the gesture hooks didn't rebind, the drag is a no-op and
  // the assertion fails.
  await dragSheet(page, 90);
  await expect(page.locator('.sheet')).toHaveCount(0);
});
