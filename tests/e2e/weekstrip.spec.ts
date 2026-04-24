import { expect, test, type Page } from '@playwright/test';

// WeekStrip.tsx:22-23 — AXIS_LOCK_PX=8, COMMIT_THRESHOLD_PX=50. The .wrap
// div hosts onPointerDown/Move/Up; Playwright's page.mouse (pointerType=
// 'mouse') drives it — no 'touch' filter to bypass. animatingRef suppresses
// a second swipe during the 300ms snap — we assert on the caption text
// changing (or not), which happens only AFTER commitTrack's transitionend
// fires, so we don't need explicit animation waits.
async function swipeTrack(page: Page, deltaX: number) {
  // Anchor via the .days viewport — CSS-module-hashed class, so match via
  // the substring selector. Pointer events bubble up to .wrap.
  const viewport = page.locator('[class*="days"]').first();
  const box = await viewport.boundingBox();
  if (box === null) throw new Error('viewport has no bounding box');
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Stepping crosses AXIS_LOCK_PX incrementally. With horizontal-dominant
  // motion (|dx| > |dy|), the handler locks axis='x' and setPointerCapture
  // takes over — subsequent moves pan the track 1:1 with the cursor.
  await page.mouse.move(startX + deltaX, startY, { steps: 10 });
  await page.mouse.up();
}

// Caption text "APR 2026 · W17" changes whenever weekStart shifts. Using
// it as a stable identity: before/after comparison works regardless of the
// current date.
const captionLocator = (page: Page) => page.getByText(/W\d{2}/).first();

test('swipe left past threshold commits to next week', async ({ page }) => {
  await page.goto('/');
  const caption = captionLocator(page);
  const before = await caption.textContent();

  await swipeTrack(page, -60); // > COMMIT_THRESHOLD_PX=50 in the "next" direction

  // commitTrack (line 200) runs the 300ms snap animation, then transitionend
  // fires shiftWeek(1), updating weekStart and re-rendering with a new caption.
  await expect(caption).not.toHaveText(before ?? '');
});

test('swipe shorter than threshold snaps back; same week', async ({ page }) => {
  await page.goto('/');
  const caption = captionLocator(page);
  const before = await caption.textContent();

  await swipeTrack(page, -30); // < COMMIT_THRESHOLD_PX=50 — should snap back

  // snapTrackBack (line 188) animates track back to TRACK_CENTER; weekStart
  // never changes, caption stays identical. Allow 350ms for the snap anim
  // plus a buffer to catch any stray commit.
  await page.waitForTimeout(400);
  await expect(caption).toHaveText(before ?? '');
});

test('next arrow button advances to next week', async ({ page }) => {
  await page.goto('/');
  const caption = captionLocator(page);
  const before = await caption.textContent();

  // WeekStrip.tsx:319 — the arrow button calls shiftWeek(1) synchronously,
  // no animation wait needed beyond the next render.
  await page.locator('[class*="nextBtn"]').tap();

  await expect(caption).not.toHaveText(before ?? '');
});
