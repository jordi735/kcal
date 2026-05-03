import { expect, test } from '@playwright/test';
import { signInFresh } from './helpers';

// App.tsx boot revalidation: the cached `kcal_user` blob in localStorage is a
// hot-start optimisation; goals must be re-fetched from GET /settings on every
// app open so updates from another device aren't masked by the local cache.
//
// This spec exercises the cross-device path without spinning up a second
// browser context: PUT /settings via the REST API simulates "the other device
// just saved", then `page.reload()` represents this device opening the app.
//
// Per CLAUDE.md, fresh users sign in via the helper to avoid contaminating
// the shared `e2e@test.local` storageState that settings.spec.ts depends on.
test.use({ storageState: { cookies: [], origins: [] } });

test('[J-167] goals updated on another device appear after page reload (boot revalidation)', async ({
  page,
  request,
}) => {
  await signInFresh(page, request, 'cross-device');

  // Pull this user's bearer token to drive the side-channel PUT below.
  const token = await page.evaluate(() => localStorage.getItem('kcal_session_token'));
  expect(token).not.toBeNull();

  // Default goals from statements.ts:53 — kcal=2400. MacroSummary.tsx:36 renders
  // the kcal target as "/ {goals.kcal}", so anchor on that exact pattern.
  await expect(page.getByText(/^\/ 2400$/)).toBeVisible();

  // Simulate "another device" pushing new goals to the server. Crucially we do
  // NOT touch this page's localStorage — only the server moves to the new
  // values. Pre-fix: the dashboard would stay on / 2400 forever (until a
  // logout/login). Post-fix: the boot useEffect fires GET /settings on the
  // next reload and reconciles.
  const fresh = { kcal: 1234, protein: 56, carbs: 78, fat: 90 };
  const putRes = await request.put('/settings', {
    headers: { Authorization: `Bearer ${token}` },
    data: fresh,
  });
  expect(putRes.ok(), await putRes.text()).toBeTruthy();

  // Sanity: localStorage on this "device" still holds the OLD (default) goals.
  // Anything else here would mean the PUT side-channel leaked into local
  // state — which would invalidate the rest of the test.
  const cachedBefore = await page.evaluate(
    () => JSON.parse(localStorage.getItem('kcal_user') ?? '{}') as { goal_kcal?: number },
  );
  expect(cachedBefore.goal_kcal).toBe(2400);

  // Reload — this triggers the `useEffect(..., [user?.id])` boot revalidation
  // path under test. App.tsx renders cached goals first (still 2400), then
  // the GET resolves and setGoals(fresh) swaps in the server values.
  await page.reload();

  // The kcal target re-renders with the fresh server value. `toBeVisible` polls,
  // so it tolerates the brief "stale-then-fresh" swap inherent to the
  // stale-while-revalidate pattern.
  await expect(page.getByText(/^\/ 1234$/)).toBeVisible();

  // The cached user blob in localStorage was synchronised alongside `goals`
  // state (App.tsx setUser branch inside the success handler). Pinning every
  // field guards against a regression that updated `goals` but forgot to
  // mirror it back into the cache — the next boot would then revert to stale.
  const cachedAfter = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('kcal_user') ?? '{}') as {
        goal_kcal?: number;
        goal_protein?: number;
        goal_carbs?: number;
        goal_fat?: number;
      },
  );
  expect(cachedAfter.goal_kcal).toBe(1234);
  expect(cachedAfter.goal_protein).toBe(56);
  expect(cachedAfter.goal_carbs).toBe(78);
  expect(cachedAfter.goal_fat).toBe(90);
});
