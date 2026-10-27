import { test, expect } from '@playwright/test';
import { runServerFixture } from './server-fixture';

test('[J-254] Login email transport renders both bodies and propagates delivery failures', async () => {
  // The suite normally skips email in TEST_MODE. Exercise the real sender and
  // Postmark client in a separate process with fake credentials and no network.
  const child = runServerFixture(new URL('./fixtures/email-transport.ts', import.meta.url), ':memory:', {
    PATH: process.env.PATH ?? '',
    TEST_MODE: 'false',
    POSTMARK_SERVER_TOKEN: 'email-transport-test-token', POSTMARK_FROM: 'sender@example.test',
    LOGIN_CODE_EXPIRY_MINUTES: '13', LOG_LEVEL: 'warn',
  }, { timeoutMs: 15_000, inheritEnv: false });
  expect(child.status, child.stderr).toBe(0);

  const result = JSON.parse(child.stdout);
  expect(result.requests).toHaveLength(3);
  for (const request of result.requests) {
    expect(request).toMatchObject({
      url: 'https://api.postmarkapp.com/email',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-postmark-server-token': 'email-transport-test-token',
      },
      body: {
        From: 'sender@example.test',
        To: 'recipient@example.test',
        Subject: 'Your kcal. sign-in code',
      },
    });
    for (const body of [request.body.HtmlBody, request.body.TextBody]) {
      expect(body).toContain('482731');
      expect(body).toContain('13 minutes');
      expect(body).not.toContain('{{');
    }
  }
  expect(result.failures).toEqual([
    { message: 'Invalid email request', code: 300, statusCode: 422 },
    { message: 'Email transport unavailable', code: 0, statusCode: 0 },
  ]);
});
