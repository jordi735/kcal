import { expect, test, type Page } from '@playwright/test';
import { signInFresh } from './helpers';

// WeekStrip.tsx — AXIS_LOCK_PX=8, COMMIT_THRESHOLD_PX=50. The .wrap
// div hosts onPointerDown/Move/Up; Playwright's page.mouse (pointerType=
// 'mouse') drives it — no 'touch' filter to bypass. animatingRef suppresses
// a second swipe during the 300ms snap — we anchor on the global class
// 'week-strip--snap' (added/removed via classList; NOT a CSS-module name)
// to know when the animation has settled, replacing every waitForTimeout.
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

// Vertical-only drag — first move has |dx|=0, |dy|=stepDelta, so the lock
// resolves to 'y'. From that point on, onPointerMove is a no-op (no track
// pan), and onPointerEnd returns early (lock !== 'x').
async function dragTrackVertical(page: Page, deltaY: number) {
  const viewport = page.locator('[class*="days"]').first();
  const box = await viewport.boundingBox();
  if (box === null) throw new Error('viewport has no bounding box');
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, startY + deltaY, { steps: 10 });
  await page.mouse.up();
}

// Caption text "APR 2026 · W17" changes whenever weekStart shifts. Using
// it as a stable identity: before/after comparison works regardless of the
// current date.
const captionLocator = (page: Page) => page.getByText(/W\d{2}/).first();

// 'week-strip--snap' is a literal string added via track.classList.add(...)
// in commitTrack and snapTrackBack — NOT a CSS-module hashed name. After
// commit, useLayoutEffect on weekStart removes it; after snap-back, an
// inline transitionend handler removes it. Either way, "snap class absent"
// is the universal "animation done" anchor.
const trackLocator = (page: Page) => page.locator('[class*="track"]').first();
const snapClassRe = /week-strip--snap/;

test('[J-040] swipe left past threshold commits to next week', async ({ page }) => {
  await page.goto('/');
  const caption = captionLocator(page);
  const before = await caption.textContent();

  await swipeTrack(page, -60); // > COMMIT_THRESHOLD_PX=50 in the "next" direction

  // WeekStrip's commitTrack runs the 300ms snap animation, then transitionend
  // fires shiftWeek(1), updating weekStart and re-rendering with a new caption.
  await expect(caption).not.toHaveText(before ?? '');
});

test('[J-041] swipe shorter than threshold snaps back; same week', async ({ page }) => {
  await page.goto('/');
  const caption = captionLocator(page);
  const before = await caption.textContent();

  await swipeTrack(page, -30); // < COMMIT_THRESHOLD_PX=50 — should snap back

  // WeekStrip's snapTrackBack animates track back to TRACK_CENTER and removes
  // the snap class on transitionend. Anchoring on snap-class-absent proves
  // the snap-back animation completed without firing the commit branch.
  await expect(trackLocator(page)).not.toHaveClass(snapClassRe);
  await expect(caption).toHaveText(before ?? '');
});

test('[J-042] next arrow button advances to next week', async ({ page }) => {
  await page.goto('/');
  const caption = captionLocator(page);
  const before = await caption.textContent();

  // WeekStrip.tsx — the arrow button calls shiftWeek(1) synchronously,
  // no animation wait needed beyond the next render.
  await page.locator('[class*="nextBtn"]').tap();

  await expect(caption).not.toHaveText(before ?? '');
});

test('[J-159] swipe right past threshold commits to previous week', async ({ page }) => {
  await page.goto('/');
  const caption = captionLocator(page);
  const before = await caption.textContent();

  // Positive dx → "prev" direction: WeekStrip.tsx maps `dx < 0 ? 1 : -1`
  // to commitTrack(-1), shifting weekStart by -7 days.
  await swipeTrack(page, +60);
  await expect(caption).not.toHaveText(before ?? '');

  // Direction pin: tapping NEXT once should restore the original caption.
  // If the swipe had wrongly gone forward, NEXT would push another step
  // forward and never return to `before`.
  await page.locator('[class*="nextBtn"]').tap();
  await expect(caption).toHaveText(before ?? '');
});

test('[J-160] prev arrow button retreats to previous week', async ({ page }) => {
  await page.goto('/');
  const caption = captionLocator(page);
  const before = await caption.textContent();

  await page.locator('[class*="prevBtn"]').tap();
  await expect(caption).not.toHaveText(before ?? '');

  // Direction pin (mirror of J-159): NEXT once cancels PREV once.
  await page.locator('[class*="nextBtn"]').tap();
  await expect(caption).toHaveText(before ?? '');
});

test('[J-161] swipe exactly 50px commits (>= threshold boundary)', async ({ page }) => {
  await page.goto('/');
  const caption = captionLocator(page);
  const before = await caption.textContent();

  // WeekStrip.tsx — `Math.abs(dx) >= COMMIT_THRESHOLD_PX`. Off-by-one
  // mutation `>` would fail this test (dx=-50 → 50 >= 50 commits, but
  // 50 > 50 doesn't).
  await swipeTrack(page, -50);
  await expect(caption).not.toHaveText(before ?? '');
});

test('[J-162] swipe exactly 49px snaps back (< threshold boundary)', async ({ page }) => {
  await page.goto('/');
  const caption = captionLocator(page);
  const before = await caption.textContent();

  // 1 px under threshold — should NOT commit. Brackets J-161 to a single
  // integer (49 snap-back, 50 commit) so any threshold mutation in either
  // direction is caught.
  await swipeTrack(page, -49);
  await expect(trackLocator(page)).not.toHaveClass(snapClassRe);
  await expect(caption).toHaveText(before ?? '');
});

test('[J-163] vertical drag is a no-op (axis lock to "y")', async ({ page }) => {
  await page.goto('/');
  const caption = captionLocator(page);
  const before = await caption.textContent();

  // First move has |dx|=0, |dy|=10 → lock = (0 > 10) ? 'x' : 'y' = 'y'.
  // Subsequent onPointerMove only moves the track for an 'x' lock,
  // and onPointerEnd hits `if (lock !== 'x') return` before
  // ever reaching the threshold check — no snapTrackBack, no commit.
  await dragTrackVertical(page, 100);
  await expect(caption).toHaveText(before ?? '');

  // Negative-path: gesture state isn't stranded after a y-lock. A
  // follow-up horizontal swipe still commits, proving drag.active and
  // drag.lock were reset cleanly by onPointerEnd.
  await swipeTrack(page, -60);
  await expect(caption).not.toHaveText(before ?? '');
});

test('[J-164] tapping a day pill selects that date but keeps the same week', async ({ page }) => {
  await page.goto('/');
  const caption = captionLocator(page);
  const captionBefore = await caption.textContent();

  // The track holds 3 WeekGrid renders (prev / current / next). The center
  // grid is the visible one — tap targets in prev/next sit behind .days
  // overflow:hidden and would mis-anchor the assertion.
  const centerGrid = page.locator('[class*="weekGrid"]').nth(1);
  const pills = centerGrid.locator('[class*="pill"]');
  await expect(pills).toHaveCount(7);

  // Find a pill that is NOT today's pill — selectedDate starts on `today`,
  // so tapping today is a no-op and wouldn't catch the flip. The 'today'
  // class is hashed (CSS module), `[class*="today"]` substring-matches it.
  const count = await pills.count();
  let targetIndex = -1;
  for (let i = 0; i < count; i++) {
    const cls = await pills.nth(i).getAttribute('class');
    if (cls !== null && !cls.includes('today')) {
      targetIndex = i;
      break;
    }
  }
  expect(targetIndex).not.toBe(-1);
  const target = pills.nth(targetIndex);

  await target.tap();
  // DayPill onClick → onSelect(date) → App.tsx setSelectedDate → re-render
  // applies styles.selected. Substring-match the hashed CSS-module class.
  await expect(target).toHaveClass(/selected/);

  // Same-week selection must NOT shift weekStart — pin against any future
  // wiring of onSelect that accidentally also calls onChangeWeek.
  await expect(caption).toHaveText(captionBefore ?? '');
});

test('[J-165] caption shows zero-padded W## week number after the month label', async ({ page }) => {
  await page.goto('/');
  // WeekStrip.tsx — `${monthLabel} · W${String(weekNum).padStart(2, '0')}`.
  // The trailing ` · W\d{2}$` is invariant across all 3 monthLabel branches
  // and any year. Catches a ` · ` separator drop, a W→V slip, or a missing
  // week-number digit.
  await expect(captionLocator(page)).toHaveText(/ · W\d{2}$/);
});

test.describe('animation lock', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('[J-166] second swipe during snap animation is suppressed by animatingRef', async ({ page, request }) => {
    // Keep delayed progress-dot transitions from unrelated shared history out
    // of this test of the track's own animation lock.
    await signInFresh(page, request, 'week-snap-lock');
    await expect(page.getByText('No food logged', { exact: true })).toBeVisible();
    const caption = captionLocator(page);
    const before = await caption.textContent();

    // Pause the actual first CSS transition when it starts. Awaited mouse
    // events can span more than 300ms under load, so a back-to-back swipe alone
    // cannot prove the second gesture began while the animation was active.
    const track = trackLocator(page);
    const snap = await track.evaluateHandle((element) => {
      const state = { animation: null as Animation | null };
      const onRun = (event: Event) => {
        if (!(event instanceof TransitionEvent) || event.target !== element || event.propertyName !== 'transform') return;
        const animation = element.getAnimations().find(
          (candidate) => candidate instanceof CSSTransition && candidate.transitionProperty === 'transform',
        );
        if (animation === undefined) return;
        element.removeEventListener('transitionrun', onRun);
        animation.pause();
        animation.currentTime = 100;
        state.animation = animation;
      };
      element.addEventListener('transitionrun', onRun);
      return state;
    });
    try {
      await swipeTrack(page, -60);
      await expect.poll(() => snap.evaluate(({ animation }) => animation?.playState)).toBe('paused');
      await expect(track).toHaveClass(snapClassRe);
      await expect(caption).toHaveText(before ?? '');

      await swipeTrack(page, -60);

      // Removing the guard cancels/replaces this transition on pointerdown.
      // Check its identity and state, not only the final week: replacing a
      // pending commit can still finish one week ahead and hide that regression.
      expect(await track.evaluate((element, { animation }) => ({
        active: animation !== null && element.getAnimations().includes(animation),
        playState: animation?.playState,
        currentTime: animation?.currentTime,
      }), snap)).toEqual({ active: true, playState: 'paused', currentTime: 100 });
      await expect(caption).toHaveText(before ?? '');
      await snap.evaluate(({ animation }) => animation!.finish());

      // Completing the real transition dispatches transitionend, commits the
      // week, and lets the layout effect clear its animation state normally.
      await expect(caption).not.toHaveText(before ?? '');
      await expect(track).not.toHaveClass(snapClassRe);
    } finally {
      await snap.dispose();
    }

    // If exactly ONE commit fired, weekStart is at before+7 — tap PREV once
    // and the caption returns to `before`. If the lock leaked and TWO commits
    // fired, weekStart is at before+14 — PREV leaves the caption one week
    // ahead and the assertion fails.
    await page.locator('[class*="prevBtn"]').tap();
    await expect(caption).toHaveText(before ?? '');
  });
});
