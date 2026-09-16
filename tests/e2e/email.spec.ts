import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('[J-254] Login email transport renders both bodies and propagates delivery failures', async () => {
  // The suite normally skips email in TEST_MODE. Exercise the real sender and
  // Postmark client in a separate process with fake credentials and no network.
  const { stdout } = await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    import http from 'node:http';
    import https from 'node:https';
    import { syncBuiltinESMExports } from 'node:module';

    for (const transport of [http, https]) {
      transport.request = transport.get = () => {
        throw new Error('Unexpected network request in email transport test');
      };
    }
    syncBuiltinESMExports();

    const requests = [];
    let outcome = 'success';
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      requests.push({
        url: request.url,
        method: request.method,
        headers: Object.fromEntries(request.headers),
        body: await request.json(),
      });
      if (outcome === 'network') throw new TypeError('Email transport unavailable');
      return Response.json(outcome === 'api'
        ? { ErrorCode: 300, Message: 'Invalid email request' }
        : { ErrorCode: 0, Message: 'OK', MessageID: 'test-message',
            SubmittedAt: '2026-09-15T12:00:00Z', To: 'recipient@example.test' },
        { status: outcome === 'api' ? 422 : 200 });
    };

    const { sendLoginCode } = await import('./server/email.ts');
    await sendLoginCode('recipient@example.test', '482731');

    const failures = [];
    for (outcome of ['api', 'network']) {
      try {
        await sendLoginCode('recipient@example.test', '482731');
        failures.push(null);
      } catch (error) {
        failures.push({ message: error.message, code: error.code, statusCode: error.statusCode });
      }
    }
    process.stdout.write(JSON.stringify({ requests, failures }));
  `], { timeout: 15_000, env: {
    PATH: process.env.PATH ?? '',
    PORT: '3000', DATABASE_PATH: ':memory:', PUBLIC_ORIGIN: '', TEST_MODE: 'false',
    POSTMARK_SERVER_TOKEN: 'email-transport-test-token', POSTMARK_FROM: 'sender@example.test',
    SESSION_EXPIRY_DAYS: '7', LOGIN_CODE_EXPIRY_MINUTES: '13', AI_SCAN_DAILY_CAP: '100', LOG_LEVEL: 'warn',
  } });

  const result = JSON.parse(stdout);
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
