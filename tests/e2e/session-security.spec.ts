import { expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runServerFixture } from './server-fixture';
import type { SessionFixtureCase, SessionFixtureResult, SessionSnapshot } from './fixtures/session-security';

const NOW = Date.UTC(2026, 9, 27, 12);
const DAY = 86_400_000;
const MIGRATION = '010_hash_app_sessions.sql';
const tokens = [1, 2, 3].map((value) => Buffer.alloc(32, value).toString('base64url'));
const expiredToken = Buffer.alloc(32, 4).toString('base64url');
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

function seedLegacyDatabase(path: string, options: { sessions?: boolean; expired?: boolean } = {}): SessionSnapshot {
  const db = new Database(path);
  try {
    db.pragma('foreign_keys = ON');
    db.exec('CREATE TABLE schema_migrations (filename TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
    const record = db.prepare('INSERT INTO schema_migrations VALUES (?, ?)');
    for (const filename of readdirSync('server/migrations').filter((name) => name.endsWith('.sql') && name < MIGRATION).sort()) {
      db.exec(readFileSync(join('server/migrations', filename), 'utf8'));
      record.run(filename, NOW - DAY);
    }
    db.prepare('INSERT INTO users (id,email,goal_kcal,goal_protein,goal_carbs,goal_fat,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(1, 'session-owner-a@example.test', 2700, 150, 300, 80, NOW - 20 * DAY);
    db.prepare('INSERT INTO users (id,email,created_at) VALUES (?,?,?)')
      .run(2, 'session-owner-b@example.test', NOW - 10 * DAY);
    if (options.sessions !== false) {
      const insert = db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?)');
      tokens.forEach((token, index) => insert.run(token, index < 2 ? 1 : 2,
        NOW - (index + 1) * DAY, NOW - (index + 1) * 60_000, NOW + (index + 1) * DAY));
      if (options.expired) insert.run(expiredToken, 1, NOW - 12 * DAY, NOW - 10 * DAY, NOW - DAY);
    }
    return {
      columns: (db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>).map((column) => column.name),
      sessions: db.prepare('SELECT * FROM sessions ORDER BY user_id, created_at').all() as SessionSnapshot['sessions'],
      users: db.prepare('SELECT * FROM users ORDER BY id').all() as SessionSnapshot['users'],
      migrations: (db.prepare('SELECT filename FROM schema_migrations ORDER BY filename').all() as Array<{ filename: string }>)
        .map((row) => row.filename),
    };
  } finally {
    db.close();
  }
}

function withLegacyDatabase(work: (path: string, before: SessionSnapshot) => void,
  options: { sessions?: boolean; expired?: boolean } = {}): void {
  const directory = mkdtempSync(join(tmpdir(), 'kcal-session-security-'));
  try {
    const path = join(directory, 'app.db');
    work(path, seedLegacyDatabase(path, options));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function runSessionCase<Case extends SessionFixtureCase>(scenario: Case, path: string): Extract<SessionFixtureResult, { scenario: Case }> {
  const child = runServerFixture(new URL('./fixtures/session-security.ts', import.meta.url), path, {
    PATH: process.env.PATH ?? '', TEST_MODE: 'false', LOG_LEVEL: 'error',
    SESSION_SECURITY_CASE: scenario, SESSION_SECURITY_NOW: String(NOW),
    SESSION_SECURITY_TOKENS: JSON.stringify(tokens),
  }, { inheritEnv: false, timeoutMs: 15_000 });
  expect(child.status, child.stderr).toBe(0);
  return JSON.parse(child.stdout) as Extract<SessionFixtureResult, { scenario: Case }>;
}

test('[J-540] existing app bearers survive hashing migration and repeated process restarts', () => {
  withLegacyDatabase((path) => {
    const migrated = runSessionCase('snapshot', path).snapshot;
    expect(migrated.columns).toContain('token_hash');
    expect(migrated.columns).not.toContain('token');
    expect(migrated.migrations.filter((name) => name === MIGRATION)).toHaveLength(1);
    expect(migrated.sessions.map((row) => row.token_hash).sort()).toEqual(tokens.map(digest).sort());
    expect(runSessionCase('resolve', path).owners).toEqual([1, 1, 2]);
    expect(runSessionCase('resolve', path).owners).toEqual([1, 1, 2]);
    const restarted = runSessionCase('snapshot', path).snapshot;
    expect(restarted.migrations.filter((name) => name === MIGRATION)).toHaveLength(1);
    expect(restarted.sessions.map((row) => row.token_hash).sort()).toEqual(tokens.map(digest).sort());
  });
});

test('[J-541] new app sessions persist only hashes and stored credentials cannot authenticate', () => {
  withLegacyDatabase((path) => {
    const result = runSessionCase('new-session', path);
    expect(result.rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.storedCredential).toBe(digest(result.rawToken));
    expect(result.storedRow.token).toBeUndefined();
    expect(result.storedCredentialOwner).toBeNull();
    expect(result.hashOwner).toBeNull();
    expect(result.rawOwner).toBe(1);
    expect(result.storedRow.created_at).toBe(NOW);
    expect(result.storedRow.last_used_at).toBe(NOW);
    expect(result.storedRow.expires_at).toBe(NOW + 7 * DAY);
  }, { sessions: false });
});

test('[J-542] logout revokes only the presented bearer after migration regardless of body-selected tokens', () => {
  withLegacyDatabase((path) => {
    const result = runSessionCase('logout', path);
    expect(result.otherOwnerLogoutStatus).toBe(200);
    expect(result.afterOtherOwnerLogout).toEqual([1, 1, null]);
    expect(result.firstOwnerLogoutStatus).toBe(200);
    expect(result.afterFirstOwnerLogout).toEqual([null, 1, null]);
    expect(result.remainingHashes).toEqual([digest(tokens[1]!)]);
    expect(runSessionCase('resolve', path).owners).toEqual([null, 1, null]);
  });
});

test('[J-543] hashing preserves active session metadata and accounts while retaining expired-session cleanup', () => {
  withLegacyDatabase((path, before) => {
    const after = runSessionCase('snapshot', path).snapshot;
    const expected = before.sessions.filter((row) => row.expires_at >= NOW).map(({ token, ...row }) => ({
      ...row, token_hash: digest(token!),
    }));
    expect(after.sessions).toEqual(expected);
    expect(after.users).toEqual(before.users);
    expect(after.sessions).toHaveLength(3);
    expect(JSON.stringify(after.sessions)).not.toContain(expiredToken);
    expect(runSessionCase('snapshot', path).snapshot.sessions).toEqual(expected);
  }, { expired: true });
});

test('[J-544] a partially failing session-hash migration rolls back schema data and its marker before recovery', () => {
  withLegacyDatabase((path, before) => {
    const failure = runSessionCase('migration-failure', path);
    expect(failure.failed).toBe(true);
    expect(failure.hashCalls).toBe(2);
    expect(failure.snapshot).toEqual(before);
    const recovered = runSessionCase('snapshot', path).snapshot;
    expect(recovered.migrations).toContain(MIGRATION);
    expect(recovered.sessions.map((row) => row.token_hash).sort()).toEqual(tokens.map(digest).sort());
    expect(runSessionCase('resolve', path).owners).toEqual([1, 1, 2]);
  });
});
