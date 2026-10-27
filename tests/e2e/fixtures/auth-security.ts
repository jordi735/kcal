import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { once } from 'node:events';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import express from 'express';

export type AuthSecurityCase = 'no-code-budget' | 'user-creation' | 'delivery-race'
  | 'source-ingress' | 'account-limits' | 'transaction-failure';
export type AuthSecurityResult = {
  scenario: 'no-code-budget';
  codeBeforeGuesses: string | null;
  guessStatuses: number[];
  issueStatus: number;
  loginStatus: number;
  retryAfter: string | null;
  hasSessionToken: boolean;
  codeConsumed: boolean;
  users: number;
  sessions: number;
} | {
  scenario: 'user-creation';
  failedStatus: number;
  usersAfterFailedDelivery: number;
  pendingStatus: number;
  usersBeforeProof: number;
  loginStatus: number;
  usersAfterProof: number;
  sessionsAfterProof: number;
  failedAccountExists: boolean;
  user: unknown;
  createdAt: number | null;
  verifiedAt: number;
} | {
  scenario: 'delivery-race';
  oldStatus: number;
  newStatus: number;
  sameDigits: boolean;
  newCodeSurvivedOldFailure: boolean;
  newCodeLoginStatus: number;
  currentFailureStatus: number;
  currentFailedCodeRetained: boolean;
  currentFailedCodeLoginStatus: number;
} | {
  scenario: 'source-ingress';
  malformedIssueStatuses: number[];
  issueAfterMalformedStatus: number;
  issueRetryAfter: string | null;
  malformedVerifyStatuses: number[];
  verifyAfterMalformedStatus: number;
  verifyRetryAfter: string | null;
  validIssueStatuses: number[];
  issueOverLimitStatus: number;
} | {
  scenario: 'account-limits';
  perCodeErrors: unknown[][];
  blockedCorrectStatus: number;
  blockedCorrectRetryAfter: string | null;
  blockedCodeRetained: boolean;
  sixthIssueStatus: number;
  expiredStatus: number;
  guessesAfterExpiry: number[];
  freshAfterExpiryStatus: number;
} | {
  scenario: 'transaction-failure';
  failedStatus: number;
  usersAfterFailure: number;
  sessionsAfterFailure: number;
  consumedAfterFailure: boolean;
  replayStatus: number;
  recoveredStatus: number;
  usersAfterRecovery: number;
  sessionsAfterRecovery: number;
};

const scenario = process.env.AUTH_SECURITY_CASE;
assert.ok(scenario === 'no-code-budget' || scenario === 'user-creation' || scenario === 'delivery-race'
  || scenario === 'source-ingress' || scenario === 'account-limits' || scenario === 'transaction-failure');
assert.equal(process.env.TEST_MODE, 'false');

let now = Date.UTC(2026, 9, 27, 12);
Date.now = () => now;
if (scenario === 'delivery-race') {
  // Only this disposable child uses deterministic codes. Equal successive
  // codes exercise identity-safe invalidation rather than chance collisions.
  Object.defineProperty(crypto, 'randomInt', { value: () => 314159 });
}
for (const transport of [http, https]) {
  transport.request = transport.get = () => {
    throw new Error('Unexpected external HTTP request in auth security fixture');
  };
}
syncBuiltinESMExports();

type HeldMail = { settle: (success: boolean) => void };
let waitingForMail: ((mail: HeldMail) => void) | undefined;
let mailFails = false;
let localOrigin: string | null = null;
const nativeFetch = globalThis.fetch;

function mailResponse(success: boolean): Response {
  return Response.json(success
    ? { ErrorCode: 0, Message: 'OK', MessageID: 'fixture-message',
        SubmittedAt: '2026-10-27T12:00:00Z', To: 'recipient@example.test' }
    : { ErrorCode: 300, Message: 'Fixture rejected recipient' },
  { status: success ? 200 : 422 });
}

function holdNextMail(): Promise<HeldMail> {
  assert.equal(waitingForMail, undefined);
  return new Promise((resolve) => { waitingForMail = resolve; });
}

globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  if (localOrigin !== null && new URL(request.url).origin === localOrigin) {
    return nativeFetch(input, init);
  }
  if (request.url !== 'https://api.postmarkapp.com/email') {
    throw new Error('Unexpected external fetch in auth security fixture');
  }
  if (waitingForMail !== undefined) {
    const started = waitingForMail;
    waitingForMail = undefined;
    return new Promise<Response>((resolve) => {
      started({ settle: (success) => resolve(mailResponse(success)) });
    });
  }
  return mailResponse(!mailFails);
};

// Install the clock and all external-network guards before importing modules
// that capture environment, login state, or the disposable database.
const { peekLoginCode } = await import('../../../server/auth.js');
const { db } = await import('../../../server/db.js');

// Exercise the real middleware order, including pre-parser reservations. Only
// listen is replaced: the real app runs on an ephemeral loopback port instead
// of the configured port, with no change to routes or their middleware.
const originalListen = express.application.listen;
let capturedServer: http.Server | undefined;
express.application.listen = function () {
  capturedServer = http.createServer(this);
  return capturedServer.listen(0, '127.0.0.1');
};
await import('../../../server/index.js');
express.application.listen = originalListen;
assert.ok(capturedServer);
const server = capturedServer;
if (!server.listening) await once(server, 'listening');
const address = server.address();
assert.ok(address !== null && typeof address !== 'string');
localOrigin = `http://127.0.0.1:${address.port}`;

async function postRaw(route: string, body: string, ip = '203.0.113.10') {
  const response = await fetch(`${localOrigin}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    body,
  });
  return {
    status: response.status,
    retryAfter: response.headers.get('retry-after'),
    body: await response.json() as Record<string, unknown>,
  };
}

function post(route: string, body: Record<string, unknown>, ip?: string) {
  return postRaw(route, JSON.stringify(body), ip);
}

function count(table: 'users' | 'sessions'): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
  return row.count;
}

async function run(): Promise<AuthSecurityResult> {
  if (scenario === 'source-ingress') {
    const malformedIssueStatuses: number[] = [];
    for (let attempt = 0; attempt < 30; attempt++) {
      malformedIssueStatuses.push((await postRaw('/auth/request-code', '{', '203.0.113.20')).status);
    }
    const issueAfterMalformed = await post('/auth/request-code', { email: 'after-malformed@example.test' }, '203.0.113.20');
    const malformedVerifyStatuses: number[] = [];
    for (let attempt = 0; attempt < 100; attempt++) {
      malformedVerifyStatuses.push((await postRaw('/auth/verify-code', '{', '203.0.113.21')).status);
    }
    const verifyAfterMalformed = await postRaw('/auth/verify-code', '{', '203.0.113.21');
    const validIssueStatuses: number[] = [];
    for (let attempt = 0; attempt < 30; attempt++) {
      validIssueStatuses.push((await post('/auth/request-code', { email: `once-${attempt}@example.test` }, '203.0.113.22')).status);
    }
    const issueOverLimit = await post('/auth/request-code', { email: 'over-limit@example.test' }, '203.0.113.22');
    return {
      scenario, malformedIssueStatuses, issueAfterMalformedStatus: issueAfterMalformed.status,
      issueRetryAfter: issueAfterMalformed.retryAfter, malformedVerifyStatuses,
      verifyAfterMalformedStatus: verifyAfterMalformed.status, verifyRetryAfter: verifyAfterMalformed.retryAfter,
      validIssueStatuses, issueOverLimitStatus: issueOverLimit.status,
    };
  }

  if (scenario === 'account-limits') {
    const email = 'aggregate-budget@example.test';
    const perCodeErrors: unknown[][] = [];
    for (let issuance = 0; issuance < 4; issuance++) {
      assert.equal((await post('/auth/request-code', { email })).status, 200);
      const code = peekLoginCode(email);
      assert.ok(code !== null);
      const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, '0');
      const errors: unknown[] = [];
      for (let attempt = 0; attempt < 5; attempt++) {
        const response = await post('/auth/verify-code', { email, code: wrong });
        assert.equal(response.status, 400);
        errors.push(response.body.error);
      }
      perCodeErrors.push(errors);
      now += 30_000;
    }
    assert.equal((await post('/auth/request-code', { email })).status, 200);
    const blockedCode = peekLoginCode(email);
    assert.ok(blockedCode !== null);
    const blocked = await post('/auth/verify-code', { email, code: blockedCode });
    const blockedCodeRetained = peekLoginCode(email) === blockedCode;
    now += 30_000;
    const sixthIssue = await post('/auth/request-code', { email });

    const expiredEmail = 'expired-budget@example.test';
    assert.equal((await post('/auth/request-code', { email: expiredEmail })).status, 200);
    const expiredCode = peekLoginCode(expiredEmail);
    assert.ok(expiredCode !== null);
    now += 600_001;
    const expired = await post('/auth/verify-code', { email: expiredEmail, code: expiredCode });
    const guessesAfterExpiry: number[] = [];
    for (let attempt = 0; attempt < 20; attempt++) {
      guessesAfterExpiry.push((await post('/auth/verify-code', { email: expiredEmail, code: '000000' })).status);
    }
    assert.equal((await post('/auth/request-code', { email: expiredEmail })).status, 200);
    const freshCode = peekLoginCode(expiredEmail);
    assert.ok(freshCode !== null);
    const fresh = await post('/auth/verify-code', { email: expiredEmail, code: freshCode });
    return {
      scenario, perCodeErrors, blockedCorrectStatus: blocked.status,
      blockedCorrectRetryAfter: blocked.retryAfter, blockedCodeRetained,
      sixthIssueStatus: sixthIssue.status, expiredStatus: expired.status,
      guessesAfterExpiry, freshAfterExpiryStatus: fresh.status,
    };
  }

  if (scenario === 'transaction-failure') {
    const email = 'transaction-failure@example.test';
    assert.equal((await post('/auth/request-code', { email })).status, 200);
    const code = peekLoginCode(email);
    assert.ok(code !== null);
    db.exec(`CREATE TEMP TRIGGER reject_fixture_session BEFORE INSERT ON sessions
      BEGIN SELECT RAISE(ABORT, 'fixture_session_failure'); END`);
    const failed = await post('/auth/verify-code', { email, code });
    const usersAfterFailure = count('users');
    const sessionsAfterFailure = count('sessions');
    const consumedAfterFailure = peekLoginCode(email) === null;
    db.exec('DROP TRIGGER reject_fixture_session');
    const replay = await post('/auth/verify-code', { email, code });
    now += 30_000;
    assert.equal((await post('/auth/request-code', { email })).status, 200);
    const newCode = peekLoginCode(email);
    assert.ok(newCode !== null);
    const recovered = await post('/auth/verify-code', { email, code: newCode });
    return {
      scenario, failedStatus: failed.status, usersAfterFailure, sessionsAfterFailure,
      consumedAfterFailure, replayStatus: replay.status, recoveredStatus: recovered.status,
      usersAfterRecovery: count('users'), sessionsAfterRecovery: count('sessions'),
    };
  }

  if (scenario === 'no-code-budget') {
    const email = 'existing-victim@example.test';
    db.prepare('INSERT INTO users (email, created_at) VALUES (?, ?)').run(email, now);
    const codeBeforeGuesses = peekLoginCode(email);
    const guessStatuses: number[] = [];
    for (let attempt = 0; attempt < 20; attempt++) {
      guessStatuses.push((await post('/auth/verify-code', { email, code: '000000' })).status);
    }
    const issued = await post('/auth/request-code', { email });
    const code = peekLoginCode(email);
    assert.ok(code !== null, 'Successful mocked delivery must issue a code');
    const login = await post('/auth/verify-code', { email, code });
    return {
      scenario, codeBeforeGuesses, guessStatuses, issueStatus: issued.status,
      loginStatus: login.status, retryAfter: login.retryAfter,
      hasSessionToken: typeof login.body.session_token === 'string',
      codeConsumed: peekLoginCode(email) === null,
      users: count('users'), sessions: count('sessions'),
    };
  }

  if (scenario === 'user-creation') {
    const failedEmail = 'failed-delivery@example.test';
    const email = 'Verified-User@Example.Test';
    const normalized = email.toLowerCase();
    mailFails = true;
    const failed = await post('/auth/request-code', { email: failedEmail });
    const usersAfterFailedDelivery = count('users');
    mailFails = false;
    const pending = await post('/auth/request-code', { email });
    const usersBeforeProof = count('users');
    const code = peekLoginCode(normalized);
    assert.ok(code !== null, 'Successful mocked delivery must issue a code');
    now += 1000;
    const verifiedAt = now;
    const login = await post('/auth/verify-code', { email, code });
    const stored = db.prepare('SELECT created_at FROM users WHERE email = ?').get(normalized) as
      { created_at: number } | undefined;
    return {
      scenario, failedStatus: failed.status, usersAfterFailedDelivery,
      pendingStatus: pending.status, usersBeforeProof, loginStatus: login.status,
      usersAfterProof: count('users'), sessionsAfterProof: count('sessions'),
      failedAccountExists: db.prepare('SELECT id FROM users WHERE email = ?').get(failedEmail) !== undefined,
      user: login.body.user, createdAt: stored?.created_at ?? null, verifiedAt,
    };
  }

  assert.equal(scenario, 'delivery-race');
  const email = 'resend-race@example.test';
  const heldMail = holdNextMail();
  const oldRequest = post('/auth/request-code', { email });
  const held = await heldMail;
  const oldCode = peekLoginCode(email);
  assert.ok(oldCode !== null);
  now += 30_000;
  const newer = await post('/auth/request-code', { email });
  const newCode = peekLoginCode(email);
  assert.ok(newCode !== null);
  held.settle(false);
  const older = await oldRequest;
  const newCodeSurvivedOldFailure = peekLoginCode(email) === newCode;
  const login = await post('/auth/verify-code', { email, code: newCode });
  now += 30_000;
  mailFails = true;
  const currentFailure = await post('/auth/request-code', { email });
  const currentFailedCodeRetained = peekLoginCode(email) !== null;
  const failedCodeLogin = await post('/auth/verify-code', { email, code: '314159' });
  return {
    scenario, oldStatus: older.status, newStatus: newer.status, sameDigits: oldCode === newCode,
    newCodeSurvivedOldFailure, newCodeLoginStatus: login.status,
    currentFailureStatus: currentFailure.status, currentFailedCodeRetained,
    currentFailedCodeLoginStatus: failedCodeLogin.status,
  };
}

try {
  process.stdout.write(JSON.stringify(await run()));
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error === undefined ? resolve() : reject(error));
  });
  db.close();
}
