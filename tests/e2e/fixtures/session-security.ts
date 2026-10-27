import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import express from 'express';

export type StoredSession = {
  token?: string;
  token_hash?: string;
  user_id: number;
  created_at: number;
  last_used_at: number;
  expires_at: number;
};
export type SessionSnapshot = {
  columns: string[];
  sessions: StoredSession[];
  users: Array<Record<string, unknown>>;
  migrations: string[];
};
export type SessionFixtureCase = 'snapshot' | 'resolve' | 'new-session' | 'logout' | 'migration-failure';
export type SessionFixtureResult = {
  scenario: 'snapshot'; snapshot: SessionSnapshot;
} | {
  scenario: 'resolve'; owners: Array<number | null>;
} | {
  scenario: 'new-session'; rawToken: string; storedCredential: string; storedRow: StoredSession;
  storedCredentialOwner: number | null; hashOwner: number | null; rawOwner: number | null;
} | {
  scenario: 'logout'; otherOwnerLogoutStatus: number; afterOtherOwnerLogout: Array<number | null>;
  firstOwnerLogoutStatus: number; afterFirstOwnerLogout: Array<number | null>; remainingHashes: Array<string | undefined>;
} | {
  scenario: 'migration-failure'; failed: boolean; hashCalls: number; snapshot: SessionSnapshot;
};

const scenario = process.env.SESSION_SECURITY_CASE;
assert.ok(scenario === 'snapshot' || scenario === 'resolve' || scenario === 'new-session'
  || scenario === 'logout' || scenario === 'migration-failure');
const now = Number(process.env.SESSION_SECURITY_NOW);
assert.ok(Number.isSafeInteger(now) && now > 0);
Date.now = () => now;
const databasePath = process.env.DATABASE_PATH;
assert.ok(databasePath);
const rawTokens: unknown = JSON.parse(process.env.SESSION_SECURITY_TOKENS ?? 'null');
assert.ok(Array.isArray(rawTokens) && rawTokens.every((value) => typeof value === 'string'));
const tokens = rawTokens as string[];
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

for (const transport of [http, https]) {
  transport.request = transport.get = () => { throw new Error('External HTTP disabled in session fixture'); };
}
syncBuiltinESMExports();
let localOrigin: string | null = null;
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  if (localOrigin !== null && new URL(request.url).origin === localOrigin) return nativeFetch(input, init);
  throw new Error('External fetch disabled in session fixture');
};

function snapshot(db: Database.Database): SessionSnapshot {
  return {
    columns: (db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>).map((column) => column.name),
    sessions: db.prepare('SELECT * FROM sessions ORDER BY user_id, created_at').all() as StoredSession[],
    users: db.prepare('SELECT * FROM users ORDER BY id').all() as Array<Record<string, unknown>>,
    migrations: (db.prepare('SELECT filename FROM schema_migrations ORDER BY filename').all() as Array<{ filename: string }>)
      .map((row) => row.filename),
  };
}

async function migrationFailure(): Promise<Extract<SessionFixtureResult, { scenario: 'migration-failure' }>> {
  const originalFunction = Database.prototype.function;
  let migrationConnection: Database.Database | undefined;
  let importedConnection: Database.Database | undefined;
  let hashCalls = 0;
  let failed = false;
  Object.defineProperty(Database.prototype, 'function', {
    value: function (this: Database.Database, name: string, ...args: unknown[]) {
      if (name !== 'kcal_session_token_hash') return Reflect.apply(originalFunction, this, [name, ...args]);
      migrationConnection = this;
      return Reflect.apply(originalFunction, this, [name, { deterministic: true }, (value: unknown) => {
        hashCalls++;
        if (hashCalls === 2) throw new Error('fixture_hash_failure');
        assert.equal(typeof value, 'string');
        return digest(value as string);
      }]);
    },
  });
  try {
    importedConnection = (await import('../../../server/db.js')).db;
  } catch (error) {
    failed = error instanceof Error && error.message === 'fixture_hash_failure';
  } finally {
    Database.prototype.function = originalFunction;
    if (migrationConnection?.open) migrationConnection.close();
    if (importedConnection?.open) importedConnection.close();
  }
  const inspection = new Database(databasePath);
  try { return { scenario: 'migration-failure', failed, hashCalls, snapshot: snapshot(inspection) }; }
  finally { inspection.close(); }
}

async function run(): Promise<SessionFixtureResult> {
  if (scenario === 'migration-failure') return migrationFailure();
  const { db } = await import('../../../server/db.js');
  let server: http.Server | undefined;
  try {
    if (scenario === 'snapshot') return { scenario, snapshot: snapshot(db) };
    const { createSession, verifySession } = await import('../../../server/auth.js');
    if (scenario === 'resolve') return { scenario, owners: tokens.map(verifySession) };
    if (scenario === 'new-session') {
      const rawToken = createSession(1).token;
      const storedRow = snapshot(db).sessions[0];
      assert.ok(storedRow);
      const storedCredential = storedRow.token_hash ?? storedRow.token;
      assert.ok(storedCredential);
      return {
        scenario, rawToken, storedCredential, storedRow,
        storedCredentialOwner: verifySession(storedCredential),
        hashOwner: verifySession(digest(rawToken)), rawOwner: verifySession(rawToken),
      };
    }
    assert.equal(scenario, 'logout');
    const originalListen = express.application.listen;
    express.application.listen = function () {
      server = http.createServer(this);
      return server.listen(0, '127.0.0.1');
    };
    await import('../../../server/index.js');
    express.application.listen = originalListen;
    assert.ok(server);
    if (!server.listening) await once(server, 'listening');
    const address = server.address();
    assert.ok(address !== null && typeof address !== 'string');
    localOrigin = `http://127.0.0.1:${address.port}`;
    async function logout(presentedToken: string, bodySelectedToken: string): Promise<number> {
      const response = await fetch(`${localOrigin}/auth/logout`, {
        method: 'POST', headers: { Authorization: `Bearer ${presentedToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: bodySelectedToken, session_token: bodySelectedToken, user_id: 1 }),
      });
      await response.arrayBuffer();
      return response.status;
    }
    const otherOwnerLogoutStatus = await logout(tokens[2]!, tokens[0]!);
    const afterOtherOwnerLogout = tokens.map(verifySession);
    const firstOwnerLogoutStatus = await logout(tokens[0]!, tokens[1]!);
    return {
      scenario, otherOwnerLogoutStatus, afterOtherOwnerLogout, firstOwnerLogoutStatus,
      afterFirstOwnerLogout: tokens.map(verifySession), remainingHashes: snapshot(db).sessions.map((row) => row.token_hash),
    };
  } finally {
    if (server !== undefined) {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server!.close((error) => error === undefined ? resolve() : reject(error)));
    }
    db.close();
  }
}

process.stdout.write(JSON.stringify(await run()));
