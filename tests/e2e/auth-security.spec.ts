import { expect, test } from '@playwright/test';
import { runServerFixture } from './server-fixture';
import { AuthThrottle } from '../../server/auth-limits';
import type { AuthSecurityCase, AuthSecurityResult } from './fixtures/auth-security';

function runAuthCase<Case extends AuthSecurityCase>(scenario: Case): Extract<AuthSecurityResult, { scenario: Case }> {
  const child = runServerFixture(new URL('./fixtures/auth-security.ts', import.meta.url), ':memory:', {
    PATH: process.env.PATH ?? '',
    TEST_MODE: 'false',
    POSTMARK_SERVER_TOKEN: 'auth-security-fixture-token',
    POSTMARK_FROM: 'sender@example.test',
    LOG_LEVEL: 'error',
    AUTH_SECURITY_CASE: scenario,
  }, { timeoutMs: 15_000, inheritEnv: false });
  expect(child.status, child.stderr).toBe(0);
  return JSON.parse(child.stdout) as Extract<AuthSecurityResult, { scenario: Case }>;
}

test('[J-510] guesses without an issued code cannot spend the account verification allowance', () => {
  const result = runAuthCase('no-code-budget');
  expect(result.codeBeforeGuesses).toBeNull();
  expect(result.guessStatuses).toEqual(Array<number>(20).fill(400));
  expect(result.issueStatus).toBe(200);
  expect(result.loginStatus, `Unexpected retry-after: ${result.retryAfter}`).toBe(200);
  expect(result.hasSessionToken).toBe(true);
  expect(result.codeConsumed).toBe(true);
  expect(result.users).toBe(1);
  expect(result.sessions).toBe(1);
});

test('[J-511] failed delivery and unverified sign-in requests do not create permanent accounts', () => {
  const result = runAuthCase('user-creation');
  expect(result.failedStatus).toBe(500);
  expect(result.usersAfterFailedDelivery).toBe(0);
  expect(result.pendingStatus).toBe(200);
  expect(result.usersBeforeProof).toBe(0);
  expect(result.loginStatus).toBe(200);
  expect(result.usersAfterProof).toBe(1);
  expect(result.sessionsAfterProof).toBe(1);
  expect(result.failedAccountExists).toBe(false);
  expect(result.user).toMatchObject({
    email: 'verified-user@example.test',
    goal_kcal: 2400, goal_protein: 180, goal_carbs: 240, goal_fat: 80,
  });
  expect(result.createdAt).toBe(result.verifiedAt);
});

test('[J-512] failed delivery invalidates only its own issued code across overlapping resends', () => {
  const result = runAuthCase('delivery-race');
  expect(result.oldStatus).toBe(500);
  expect(result.newStatus).toBe(200);
  // Deliberately equal digits ensure invalidation uses issuance identity, not
  // code equality: a six-digit collision must not delete the newer issuance.
  expect(result.sameDigits).toBe(true);
  expect(result.newCodeSurvivedOldFailure).toBe(true);
  expect(result.newCodeLoginStatus).toBe(200);
  expect(result.currentFailureStatus).toBe(500);
  expect(result.currentFailedCodeRetained).toBe(false);
  expect(result.currentFailedCodeLoginStatus).toBe(400);
});

test('[J-513] source quotas are reserved once before malformed auth JSON is parsed', () => {
  const result = runAuthCase('source-ingress');
  expect(result.malformedIssueStatuses).toEqual(Array<number>(30).fill(400));
  expect(result.issueAfterMalformedStatus).toBe(429);
  expect(result.issueRetryAfter).toBe('3600');
  expect(result.malformedVerifyStatuses).toEqual(Array<number>(100).fill(400));
  expect(result.verifyAfterMalformedStatus).toBe(429);
  expect(result.verifyRetryAfter).toBe('900');
  expect(result.validIssueStatuses).toEqual(Array<number>(30).fill(200));
  expect(result.issueOverLimitStatus).toBe(429);
});

test('[J-514] IPv6 subnet aliases and mapped IPv4 share source quotas with independent adjacent subnets', () => {
  const aliases = [
    ['203.0.113.40', '::ffff:203.0.113.40', '203.0.113.41'],
    ['2001:db8:abcd:1200::1', '2001:db8:abcd:12ff::99', '2001:db8:abcd:1300::1'],
    ['2001:db8:abcd:1200::1', '2001:0db8:abcd:1200:0000:0000:0000:0001', '2001:db8:abcd:1300::1'],
  ] as const;
  for (const [first, alias, separate] of aliases) {
    let now = 1_000_000;
    const throttle = new AuthThrottle({ now: () => now });
    for (let i = 0; i < 30; i++) expect(throttle.reserveSource('issue', first)).toBe(0);
    expect.soft(throttle.reserveSource('issue', alias), alias).toBe(3600);
    expect(throttle.reserveSource('issue', separate)).toBe(0);
    for (let i = 0; i < 100; i++) expect(throttle.reserveSource('verify', first)).toBe(0);
    expect.soft(throttle.reserveSource('verify', alias), alias).toBe(900);
    now += 3_600_000;
    expect(throttle.reserveSource('issue', alias)).toBe(0);
  }
});

test('[J-515] code attempts and resend budgets remain bounded while expired codes cannot poison a fresh login', () => {
  const result = runAuthCase('account-limits');
  expect(result.perCodeErrors).toEqual(Array.from({ length: 4 }, () => [
    'invalid_or_expired_code', 'invalid_or_expired_code', 'invalid_or_expired_code',
    'invalid_or_expired_code', 'too_many_attempts',
  ]));
  expect(result.blockedCorrectStatus).toBe(429);
  expect(result.blockedCorrectRetryAfter).toBe('780');
  expect(result.blockedCodeRetained).toBe(true);
  expect(result.sixthIssueStatus).toBe(429);
  expect(result.expiredStatus).toBe(400);
  expect(result.guessesAfterExpiry).toEqual(Array<number>(20).fill(400));
  expect(result.freshAfterExpiryStatus).toBe(200);
});

test('[J-516] failed session creation rolls back a new account without resurrecting its consumed code', () => {
  const result = runAuthCase('transaction-failure');
  expect(result.failedStatus).toBe(500);
  expect(result.usersAfterFailure).toBe(0);
  expect(result.sessionsAfterFailure).toBe(0);
  expect(result.consumedAfterFailure).toBe(true);
  expect(result.replayStatus).toBe(400);
  expect(result.recoveredStatus).toBe(200);
  expect(result.usersAfterRecovery).toBe(1);
  expect(result.sessionsAfterRecovery).toBe(1);
});
