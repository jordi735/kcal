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

// Tiny helper — mutate one digit so the submitted code is guaranteed wrong
// regardless of what the real code happens to be. `code ^ 1` flips the last
// digit; for '0' → '1', for '9' → '8', etc.
function wrongFor(code: string): string {
  const last = code.slice(-1);
  const flipped = last === '9' ? '8' : String(Number(last) + 1);
  return code.slice(0, -1) + flipped;
}

test('wrong code shows "Invalid or expired code."', async ({ page, request }) => {
  const email = 'wrongcode@test.local';
  await page.goto('/');
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByRole('button', { name: 'Send sign-in code' }).tap();

  // Peek the real code so we can deliberately submit a wrong-one-digit variant.
  const { code } = await (await request.get(`/auth/test/last-code/${email}`)).json();
  await page.getByLabel('6-digit sign-in code').fill(wrongFor(code));

  // Login.tsx:93 converts the server's `invalid_or_expired_code` into this text.
  await expect(page.getByText('Invalid or expired code.')).toBeVisible();
});

test('5 wrong attempts locks the code and resets to email step', async ({ page, request }) => {
  const email = 'lock5@test.local';
  await page.goto('/');
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByRole('button', { name: 'Send sign-in code' }).tap();

  const { code } = await (await request.get(`/auth/test/last-code/${email}`)).json();
  const wrong = wrongFor(code);
  const codeInput = page.getByLabel('6-digit sign-in code');

  // MAX_CODE_ATTEMPTS=5 (server/auth.ts:29). 5th wrong attempt deletes the
  // code entry and returns 'exhausted' → 'too_many_attempts' → Login resets
  // to step='email' and shows the lockout message (Login.tsx:86-89). On
  // attempts 1-4 the server returns 'invalid_or_expired_code' and Login just
  // clears the input for retry — we wait on that clear before refilling.
  // On attempt 5 the code input unmounts, so skip the clear-wait.
  for (let i = 0; i < 5; i++) {
    await codeInput.fill(wrong);
    if (i < 4) {
      await expect(codeInput).toHaveValue('');
    }
  }

  await expect(page.getByText('Too many attempts — request a new code.')).toBeVisible();
  // Resets back to the email-step UI — the email input reappears.
  await expect(page.getByPlaceholder('you@example.com')).toBeVisible();
});

test('requesting a new code invalidates the previous one', async ({ page, request }) => {
  const email = 'recode@test.local';
  await page.goto('/');
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByRole('button', { name: 'Send sign-in code' }).tap();

  const { code: codeA } = await (await request.get(`/auth/test/last-code/${email}`)).json();

  // Re-issue via a raw POST — issueLoginCode (server/auth.ts:44-55) atomically
  // overwrites the in-memory map, so code A is now gone from the server's view.
  const second = await request.post('/auth/request-code', { data: { email } });
  expect(second.ok()).toBeTruthy();
  const { code: codeB } = await (await request.get(`/auth/test/last-code/${email}`)).json();
  expect(codeB).not.toBe(codeA);

  // Submitting the stale code A now lands in the server's 'invalid' branch
  // (consumeLoginCode compares against codeB).
  await page.getByLabel('6-digit sign-in code').fill(codeA);
  await expect(page.getByText('Invalid or expired code.')).toBeVisible();
});

test('never-seen email reaches the code screen (no enumeration leak)', async ({ page }) => {
  // server/routes/auth.ts:41 upserts the users row on request-code, so there
  // is no "email not found" surface — every request succeeds identically.
  // This pins that property: a fresh email lands on the same 6-digit screen.
  const email = `unknown-${Date.now()}@test.local`;
  await page.goto('/');
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByRole('button', { name: 'Send sign-in code' }).tap();

  await expect(page.getByLabel('6-digit sign-in code')).toBeVisible();
  await expect(page.getByText(/not found|no such account|unknown email/i)).toHaveCount(0);
});
