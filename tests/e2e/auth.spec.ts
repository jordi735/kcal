import { expect, test } from '@playwright/test';

// Sign-out invalidates the server session (server/routes/auth.ts:83 calls
// deleteSession). If we ran this against the shared auth.setup.ts session,
// the storageState used by every other spec would be killed. Override
// storageState here so we sign in a separate, throw-away session that we
// own and can safely log out of.
test.use({ storageState: { cookies: [], origins: [] } });

test('[J-002] sign out clears the server session and returns to Login', async ({ page, request }) => {
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

  // Capture the bearer BEFORE sign-out so we can prove the server actually
  // deleted the session row, not just the localStorage entry. With LS
  // cleared, a reload alone doesn't distinguish the two — the client has
  // no token to send either way.
  const tokenBefore = await page.evaluate(() =>
    localStorage.getItem('kcal_session_token'),
  );
  expect(tokenBefore).toBeTruthy();

  // Sign out from Settings.
  await page.getByRole('button', { name: 'Settings' }).tap();
  await page.getByRole('button', { name: 'Sign out' }).tap();

  // Back on the Login screen — and the home shell is gone. Asserting both
  // halves locks down the SPA actually unmounted Home.
  await expect(page.getByPlaceholder('you@example.com')).toBeVisible();
  await expect(page.getByRole('button', { name: 'ADD FOOD' })).toHaveCount(0);

  // Server-side proof: the captured token now 401s on a protected route.
  // If deleteSession were a no-op, this token would still resolve to a
  // valid session and the route would 200.
  const probe = await request.get('/entries?date=2024-01-01', {
    headers: { Authorization: `Bearer ${tokenBefore}` },
  });
  expect(probe.status()).toBe(401);
  expect(await probe.json()).toEqual({ error: 'unauthorized' });
});

// Tiny helper — mutate one digit so the submitted code is guaranteed wrong
// regardless of what the real code happens to be. `code ^ 1` flips the last
// digit; for '0' → '1', for '9' → '8', etc.
function wrongFor(code: string): string {
  const last = code.slice(-1);
  const flipped = last === '9' ? '8' : String(Number(last) + 1);
  return code.slice(0, -1) + flipped;
}

test('[J-003] wrong code shows error and keeps user on the code step', async ({ page, request }) => {
  const email = 'wrongcode@test.local';
  await page.goto('/');
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByRole('button', { name: 'Send sign-in code' }).tap();

  // Peek the real code so we can deliberately submit a wrong-one-digit variant.
  const { code } = await (await request.get(`/auth/test/last-code/${email}`)).json();
  const codeInput = page.getByLabel('6-digit sign-in code');
  await codeInput.fill(wrongFor(code));

  // Login.tsx:93 converts the server's `invalid_or_expired_code` into this text.
  await expect(page.getByText('Invalid or expired code.')).toBeVisible();
  // Login.tsx:95 clears the input on error so the user can retype without
  // a select-all dance — that UX invariant is part of the journey.
  await expect(codeInput).toHaveValue('');
  // Negative-path: the home shell never rendered. The user is still on
  // step='code' and can retry without losing context.
  await expect(page.getByRole('button', { name: 'ADD FOOD' })).toHaveCount(0);
});

test('[J-004] five wrong codes lock the input and reset to the email step', async ({ page, request }) => {
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
  // Resets back to the email-step UI — the email input reappears AND the
  // code input is fully unmounted. `toHaveCount(0)` locks both halves of
  // the transition: not just hidden, gone.
  await expect(page.getByPlaceholder('you@example.com')).toBeVisible();
  await expect(codeInput).toHaveCount(0);
});

test('[J-005] requesting a new code invalidates the previous one', async ({ page, request }) => {
  const email = 'recode@test.local';
  await page.goto('/');
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByRole('button', { name: 'Send sign-in code' }).tap();

  const { code: codeA } = await (await request.get(`/auth/test/last-code/${email}`)).json();

  // Re-issue via a raw POST — issueLoginCode (server/auth.ts:46-55) atomically
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

test('[J-006] unknown email reaches the code screen (no enumeration leak)', async ({ page, request }) => {
  // server/routes/auth.ts:41 upserts the users row on request-code, so there
  // is no "email not found" surface — every request succeeds identically.
  // This pins that property on TWO surfaces: the UI lands on the code step
  // for a fresh email, and the JSON response shape is byte-identical to a
  // known account.
  const email = `unknown-${Date.now()}@test.local`;
  await page.goto('/');
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByRole('button', { name: 'Send sign-in code' }).tap();

  await expect(page.getByLabel('6-digit sign-in code')).toBeVisible();
  await expect(page.getByText(/not found|no such account|unknown email/i)).toHaveCount(0);

  // Direct API parity: known account vs fresh account must return the same
  // status AND body. Any divergence — different status, extra fields, ms
  // differences observable to the client — would be an enumeration leak.
  const known = await request.post('/auth/request-code', { data: { email: 'e2e@test.local' } });
  const unknown = await request.post('/auth/request-code', {
    data: { email: `unknown-api-${Date.now()}@test.local` },
  });
  expect(known.status()).toBe(200);
  expect(unknown.status()).toBe(200);
  expect(await known.json()).toEqual({ ok: true });
  expect(await unknown.json()).toEqual({ ok: true });
});

test('[J-007] malformed email keeps the Send sign-in code button disabled', async ({ page }) => {
  await page.goto('/');
  // Login.tsx:147 disables the button via `!emailValid || submitting`.
  // emailValid = /\S+@\S+\.\S+/.test(email). Initial state: empty → disabled.
  const sendBtn = page.getByRole('button', { name: 'Send sign-in code' });
  await expect(sendBtn).toBeDisabled();

  const emailInput = page.getByPlaceholder('you@example.com');
  // Each of these strings fails /\S+@\S+\.\S+/ for a different reason:
  //   'notanemail'      — no '@'
  //   'no-at-sign.com'  — no '@' (period without an @ doesn't help)
  //   '@nope.com'       — empty before '@' (\S+ before requires ≥1)
  //   'a@b'             — no '.' anywhere
  for (const malformed of ['notanemail', 'no-at-sign.com', '@nope.com', 'a@b']) {
    await emailInput.fill(malformed);
    await expect(sendBtn).toBeDisabled();
  }

  // Sanity branch: a well-formed email re-enables. Without this the test
  // would also pass if the button were perma-disabled — pure-negative
  // assertions are too easy to satisfy.
  await emailInput.fill('valid@test.local');
  await expect(sendBtn).toBeEnabled();
});

test('[J-052] code auto-submits at exactly 6 digits, never at 5', async ({ page, request }) => {
  const email = `auto-${Date.now()}@test.local`;
  await page.goto('/');
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByRole('button', { name: 'Send sign-in code' }).tap();
  const { code } = await (await request.get(`/auth/test/last-code/${email}`)).json();

  // Network instrumentation is the only mutation-resistant probe here:
  // toHaveCount(0) / not.toBeVisible pass on first frame, so a brief
  // submit-and-clear cycle in the bug case slips past them. Counting POSTs
  // catches the cycle deterministically.
  let verifyCount = 0;
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().includes('/auth/verify-code')) {
      verifyCount += 1;
    }
  });

  const codeInput = page.getByLabel('6-digit sign-in code');

  // 5 of 6 digits → Login.tsx:79 short-circuits, no API call. Mutation
  // guard: if the comparator were `>= 5`, this fill would emit a verify
  // POST and bump verifyCount.
  await codeInput.fill(code.slice(0, 5));
  await expect(codeInput).toHaveValue(code.slice(0, 5));
  expect(verifyCount).toBe(0);

  // Now complete the 6th digit. fill() replaces, so refill the full code.
  await codeInput.fill(code);
  await expect(page.getByRole('button', { name: 'ADD FOOD' })).toBeVisible();
  expect(verifyCount).toBe(1);
});

test('[J-053] code input strips non-digits before counting to 6', async ({ page, request }) => {
  const email = `strip-${Date.now()}@test.local`;
  await page.goto('/');
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByRole('button', { name: 'Send sign-in code' }).tap();
  const { code } = await (await request.get(`/auth/test/last-code/${email}`)).json();

  // Same network counter as J-052 — if Login.tsx:112's strip were removed,
  // the 6-char "12345a" fill below would submit verbatim and the server
  // would reject it with LOGIN_CODE_RE.
  let verifyCount = 0;
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().includes('/auth/verify-code')) {
      verifyCount += 1;
    }
  });

  const codeInput = page.getByLabel('6-digit sign-in code');
  // 5 digits + 1 letter — 6 chars total, 5 digits after the strip.
  const noisy = code.slice(0, 5) + 'a';
  await codeInput.fill(noisy);
  // Controlled re-render leaves only the stripped digits in the input.
  await expect(codeInput).toHaveValue(code.slice(0, 5));
  expect(verifyCount).toBe(0);
});

test('[J-054] /auth/request-code normalizes email to lowercase', async ({ request }) => {
  // server/routes/auth.ts:40 calls .trim().toLowerCase() before upsert and
  // issueLoginCode. server/routes/auth.ts:96 mirrors that on the test peek.
  // So issuing with mixed case and peeking with lowercase must return the
  // same code — the server treats them as one account. Mutation guard: if
  // the toLowerCase() were removed on either side, the peek would 404 with
  // 'no_code' under the lowercased key.
  const upper = `MixedCase-${Date.now()}@Test.LOCAL`;
  const lower = upper.toLowerCase();

  const issued = await request.post('/auth/request-code', { data: { email: upper } });
  expect(issued.ok()).toBeTruthy();

  const a = await (await request.get(`/auth/test/last-code/${upper}`)).json();
  const b = await (await request.get(`/auth/test/last-code/${lower}`)).json();
  expect(a.code).toBe(b.code);
  expect(a.code).toMatch(/^\d{6}$/);
});

test('[J-055] /auth/verify-code rejects malformed code body with 400 invalid_or_expired_code', async ({ request }) => {
  // server/routes/auth.ts:25-33's body validator requires LOGIN_CODE_RE
  // (/^\d{6}$/) on the code field AND EMAIL_RE on the email field. Each
  // case below trips a different branch and must surface the same opaque
  // error code — never leak which field was malformed.
  const email = `verify-${Date.now()}@test.local`;
  const cases: Array<Record<string, unknown>> = [
    { email, code: '12345' },                   // 5 digits
    { email, code: '1234567' },                 // 7 digits
    { email, code: '12345a' },                  // contains letter
    { email },                                  // missing code field
    { email, code: '' },                        // empty string
    { email: 'not-an-email', code: '123456' },  // bad email shape
  ];
  for (const data of cases) {
    const r = await request.post('/auth/verify-code', { data });
    expect(r.status()).toBe(400);
    expect(await r.json()).toEqual({ error: 'invalid_or_expired_code' });
  }
});

test('[J-056] authMiddleware rejects missing/invalid bearer with 401 unauthorized', async ({ request }) => {
  // server/auth.ts:117-133 has four rejection branches. All four MUST
  // surface as the same opaque 401 — `{ error: 'unauthorized' }` — never
  // leak the internal reason ('missing_bearer' / 'empty_token' /
  // 'invalid_session') to the client.
  const cases: Array<{ label: string; opts: Parameters<typeof request.get>[1] }> = [
    { label: 'no Authorization header', opts: undefined },
    { label: 'Bearer with empty token', opts: { headers: { Authorization: 'Bearer ' } } },
    { label: 'Bearer with bogus token', opts: { headers: { Authorization: 'Bearer not-a-real-token' } } },
    { label: 'wrong scheme (Basic)', opts: { headers: { Authorization: 'Basic some-base64' } } },
  ];
  for (const { label, opts } of cases) {
    const r = await request.get('/entries?date=2024-01-01', opts);
    expect(r.status(), label).toBe(401);
    expect(await r.json(), label).toEqual({ error: 'unauthorized' });
  }
});
