import { expect, test } from '@playwright/test';

// Sign-out invalidates the server session (server/routes/auth.ts:83 calls
// deleteSession). If we ran this against the shared auth.setup.ts session,
// the storageState used by every other spec would be killed. Override
// storageState here so we sign in a separate, throw-away session that we
// own and can safely log out of.
test.use({ storageState: { cookies: [], origins: [] } });

test('sign out returns to Login and clears server session', async ({ page, request }) => {
  const email = 'signout@test.local';

  // Manual sign-in mirrors auth.setup.ts but with a distinct email so this
  // session is fully isolated from the shared e2e@test.local token.
  await page.goto('/');
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByRole('button', { name: 'Send sign-in code' }).tap();
  const res = await request.get(`/auth/test/last-code/${email}`);
  expect(res.ok()).toBeTruthy();
  const { code } = await res.json();
  await page.getByLabel('6-digit sign-in code').fill(code);
  // Login.tsx:114 auto-submits at 6 digits — wait for the home shell.
  await expect(page.getByRole('button', { name: 'ADD FOOD' })).toBeVisible();

  // Sign out from Settings.
  await page.getByRole('button', { name: 'Settings' }).tap();
  await page.getByRole('button', { name: 'Sign out' }).tap();

  // Back on the Login screen.
  await expect(page.getByPlaceholder('you@example.com')).toBeVisible();

  // Reload proves the server-side session was deleted (not just localStorage
  // cleared client-side) — a stale token in the origin would auto-restore
  // the signed-in state on refresh.
  await page.reload();
  await expect(page.getByPlaceholder('you@example.com')).toBeVisible();
});
