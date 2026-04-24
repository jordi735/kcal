import { expect, test, type Page } from '@playwright/test';

// Sheet.tsx:43 DISMISS_THRESHOLD_PX=80, :44 SLOP_PX=6, FADE_EXIT_MS=300.
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

test('drag down past 80px dismisses the sheet', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).tap();
  await expect(page.getByText('Daily goals')).toBeVisible();

  await dragSheet(page, 90);

  // beginExit() slides the sheet off, then setTimeout(onClose, FADE_EXIT_MS)
  // unmounts. toHaveCount(0) waits for full unmount automatically.
  await expect(page.getByText('Daily goals')).toHaveCount(0);
});

test('drag down under 80px snaps back; sheet stays open', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).tap();
  await expect(page.getByText('Daily goals')).toBeVisible();

  await dragSheet(page, 40);

  // Snap transition is 0.3s (line 210 adds .sheet--snapping, line 206
  // removes on transitionend). 'Daily goals' never leaves the DOM.
  await expect(page.getByText('Daily goals')).toBeVisible();
});

test('drag starting on an input is skipped; sheet stays open', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).tap();
  await expect(page.getByText('Daily goals')).toBeVisible();

  // Sheet.tsx:152 — if the gesture starts inside input/textarea/select,
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
});
