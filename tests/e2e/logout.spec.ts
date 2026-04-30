import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

// Logout surfaces: voluntary sign-out, 401 auto-logout, resend cooldown, and
// the "Use a different email" reset. All page-driven tests sign in fresh so
// they never invalidate the shared storageState in user.json — same isolation
// rationale as auth.spec.ts.
test.use({ storageState: { cookies: [], origins: [] } });

async function signInFresh(page: Page, request: APIRequestContext): Promise<{ email: string }> {
  const email = `logout-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;
  await page.goto('/');
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByRole('button', { name: 'Send sign-in code' }).tap();
  const res = await request.get(`/auth/test/last-code/${email}`);
  expect(res.ok()).toBeTruthy();
  const { code } = (await res.json()) as { code: string };
  await page.getByLabel('6-digit sign-in code').fill(code);
  // Login.tsx:114 auto-submits at 6 digits; wait for the home shell.
  await expect(page.getByRole('button', { name: 'ADD FOOD' })).toBeVisible();
  return { email };
}

test('[J-097] 401 auto-logout: corrupt bearer redirects to Login', async ({ page, request }) => {
  await signInFresh(page, request);
  // Gate on "No food logged" — Home.tsx:91 only shows this once the
  // App.tsx:228 useEffect's loadEntries call has returned. Without the gate,
  // those initial fetches (which use the still-valid token) race the corrupt
  // step below and the auto-logout path fires from the wrong trigger.
  await expect(page.getByText('No food logged')).toBeVisible();

  // api.ts:50 — every fetch wrapper bounces 401 to clearStoredSession() +
  // window.location.assign('/'). Corrupting the stored bearer makes the next
  // request hit authMiddleware's invalid_session branch (server/auth.ts:127).
  await page.evaluate(() => {
    window.localStorage.setItem('kcal_session_token', 'corrupt-not-a-real-token');
  });

  // ADD FOOD opens AddPicker, which fires GET /products/recent + /products/all
  // (AddPicker.tsx:52,60). Either 401 trips the auto-logout path. The tap()
  // itself completes synchronously (setModal is sync state); the navigation
  // happens later when the 401 response arrives, so there's no tap-vs-nav race.
  await page.getByRole('button', { name: 'ADD FOOD' }).tap();

  // Hard navigation to '/' completes; the post-reload App reads localStorage
  // (now cleared), finds no token, and renders Login. Asserting the email
  // input is visible AND the home shell is gone locks both halves of the
  // unmount/remount transition.
  await expect(page.getByPlaceholder('you@example.com')).toBeVisible();
  await expect(page.getByRole('button', { name: 'ADD FOOD' })).toHaveCount(0);
});

test('[J-098] 401 auto-logout clears both kcal_session_token and kcal_user', async ({ page, request }) => {
  await signInFresh(page, request);
  await expect(page.getByText('No food logged')).toBeVisible();

  // Pre-condition: App.tsx writes both keys on successful verify-code, so
  // signing in implies both are populated. Reading via page.evaluate proves
  // the storage actually has them — without this, the post-condition could
  // pass vacuously if the keys had never been written.
  const before = await page.evaluate(() => ({
    token: window.localStorage.getItem('kcal_session_token'),
    user: window.localStorage.getItem('kcal_user'),
  }));
  expect(before.token).toBeTruthy();
  expect(before.user).toBeTruthy();

  // Same recipe as J-097: corrupt the token, trigger any API call.
  await page.evaluate(() => {
    window.localStorage.setItem('kcal_session_token', 'corrupt');
  });
  await page.getByRole('button', { name: 'ADD FOOD' }).tap();
  await expect(page.getByPlaceholder('you@example.com')).toBeVisible();

  // api.ts:6-9 clearStoredSession removes BOTH SESSION_TOKEN_KEY and USER_KEY.
  // Mutation guard: dropping the USER_KEY removeItem would leave the cached
  // user record (email + goals) behind — readable by anyone with devtools
  // even after sign-out. Both keys must end null.
  const after = await page.evaluate(() => ({
    token: window.localStorage.getItem('kcal_session_token'),
    user: window.localStorage.getItem('kcal_user'),
  }));
  expect(after.token).toBeNull();
  expect(after.user).toBeNull();
});

test('[J-099] Resend button shows "Resend in {n}s" and stays disabled during cooldown', async ({ page }) => {
  await page.goto('/');
  const email = `resend-cd-${Date.now()}@test.local`;
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByRole('button', { name: 'Send sign-in code' }).tap();
  // Login.tsx:50 sets resendCooldown=RESEND_COOLDOWN_S (=30) on the
  // request-code success branch. The button label flips to "Resend in {n}s".

  // Anchored regex tolerates any decremented value (30, 29, …) without
  // hard-coding 30 — the 1s ticker (Login.tsx:37) may have fired by the time
  // the assertion runs. Mutation guard: dropping the cooldown init would
  // leave the label as "Resend code" → regex fails the ^ anchor.
  const resend = page.getByRole('button', { name: /^Resend in \d+s$/ });
  await expect(resend).toBeVisible();
  // Login.tsx:205 — disabled={resendCooldown > 0 || submitting || verifying}.
  // submitting=false post-await, verifying=false (we never typed a code),
  // so resendCooldown>0 is the only thing keeping it disabled here.
  await expect(resend).toBeDisabled();
});

test('[J-100] Resend during cooldown does not POST /auth/request-code', async ({ page }) => {
  // Two layers of defense protect against double-emit: (1) the disabled
  // attribute on the button, (2) the JS guard `if (resendCooldown > 0) return`
  // at Login.tsx:60. J-099 covers visual-disabled. This test pins the JS
  // guard specifically — force:true bypasses Playwright's disabled-actionable
  // check, so the synthetic click DOES reach React's onClick handler. If the
  // guard were dropped, the request count would jump to 2.
  let requestCount = 0;
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().endsWith('/auth/request-code')) {
      requestCount += 1;
    }
  });

  await page.goto('/');
  const email = `resend-noop-${Date.now()}@test.local`;
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByRole('button', { name: 'Send sign-in code' }).tap();
  // Synchronise on the code-step UI before sampling the counter.
  await expect(page.getByLabel('6-digit sign-in code')).toBeVisible();
  expect(requestCount).toBe(1);

  const resend = page.getByRole('button', { name: /^Resend in \d+s$/ });
  await resend.click({ force: true });

  // Counter unchanged → JS guard short-circuited before fetch was called.
  expect(requestCount).toBe(1);
  // Cooldown still active — the click didn't accidentally complete the
  // resend (which on success would set resendCooldown=30 again, keeping
  // the button disabled with a fresh "Resend in 30s" label — same regex).
  await expect(resend).toBeDisabled();
});

test('[J-101] "Use a different email" returns to email step and preserves the email value', async ({ page }) => {
  await page.goto('/');
  const email = `different-${Date.now()}@test.local`;
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByRole('button', { name: 'Send sign-in code' }).tap();
  const codeInput = page.getByLabel('6-digit sign-in code');
  await expect(codeInput).toBeVisible();

  // Login.tsx:103-109 — useDifferentEmail resets step, code, error, info, and
  // resendCooldown, but deliberately does NOT clear the email. The button
  // text is "Use a different email" (CSS uppercases the rendering only;
  // accessible name is the underlying text content).
  await page.getByRole('button', { name: 'Use a different email', exact: true }).tap();

  // Code step fully unmounted: code input gone AND the "✓ CODE SENT" card.
  await expect(codeInput).toHaveCount(0);
  await expect(page.getByText(/CODE SENT/)).toHaveCount(0);

  // Email step is back AND the prior value is retained — proves
  // useDifferentEmail did not call setEmail(''). Mutation guard: adding
  // setEmail('') would empty the input → toHaveValue(email) fails.
  const emailInput = page.getByPlaceholder('you@example.com');
  await expect(emailInput).toBeVisible();
  await expect(emailInput).toHaveValue(email);
  // emailValid is still true (regex passed earlier), so the submit button
  // re-enables. If useDifferentEmail had cleared email, this would be disabled.
  await expect(page.getByRole('button', { name: 'Send sign-in code' })).toBeEnabled();
});

test('[J-102] POST /auth/logout without bearer returns 401 unauthorized', async ({ request }) => {
  // server/routes/auth.ts:81 mounts /auth/logout BEHIND authMiddleware. A
  // request with no Authorization header trips the missing_bearer branch
  // (server/auth.ts:120). Same opaque shape J-056 pins for /entries — but
  // worth a route-specific assertion because losing authMiddleware on the
  // logout endpoint would not be caught by the /entries-only test.
  const r = await request.post('/auth/logout');
  expect(r.status()).toBe(401);
  expect(await r.json()).toEqual({ error: 'unauthorized' });
});

test('[J-103] Manual sign-out also clears kcal_user from localStorage', async ({ page, request }) => {
  await signInFresh(page, request);

  // Pre-condition: both keys are present after sign-in.
  const before = await page.evaluate(() => ({
    token: window.localStorage.getItem('kcal_session_token'),
    user: window.localStorage.getItem('kcal_user'),
  }));
  expect(before.token).toBeTruthy();
  expect(before.user).toBeTruthy();

  // App.tsx:494-503 onLogout calls clearStoredSession() (api.ts:6-9) then
  // setUser(null). J-002 in auth.spec.ts proves the SERVER session is
  // revoked; this test pins the LOCAL side specifically — both keys must
  // end null. Mutation guard: dropping USER_KEY removeItem would leave the
  // cached email behind even after sign-out, a privacy leak surfaceable
  // via window.localStorage.
  await page.getByRole('button', { name: 'Settings' }).tap();
  await page.getByRole('button', { name: 'Sign out' }).tap();
  await expect(page.getByPlaceholder('you@example.com')).toBeVisible();

  const after = await page.evaluate(() => ({
    token: window.localStorage.getItem('kcal_session_token'),
    user: window.localStorage.getItem('kcal_user'),
  }));
  expect(after.token).toBeNull();
  expect(after.user).toBeNull();
});
