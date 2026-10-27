// SQLite handle + forward-only migration runner.
// Opens the DB on module load, applies any new migrations, and prunes expired sessions.

import Database from 'better-sqlite3';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { foldProductSearchText } from '../shared/normalize.js';
import { env } from './env.js';
import { log } from './log.js';
import { hashSessionToken } from './session-token.js';
import type { MigrationRow } from './types.js';

const dbPath = env.DATABASE_PATH;
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
// Register before application statements are prepared. instr() keeps queries
// literal; SQLite's built-in lower()/NOCASE do not fold accented characters.
db.function('kcal_search_text', { deterministic: true }, (value: unknown) =>
  typeof value === 'string' ? foldProductSearchText(value) : null,
);
// Migration 010 needs SHA-256 during the same SQLite transaction as its schema
// change. Keep this registered for fresh installations applying all migrations.
db.function('kcal_session_token_hash', { deterministic: true }, (value: unknown) => {
  if (typeof value !== 'string') throw new TypeError('Session token must be text');
  return hashSessionToken(value);
});

db.exec(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename   TEXT    PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )
`);

const migrationsDir = fileURLToPath(new URL('./migrations/', import.meta.url));

const applied = new Set(
  (db.prepare('SELECT filename FROM schema_migrations').all() as MigrationRow[]).map(
    (r) => r.filename,
  ),
);

const pending = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .filter((f) => !applied.has(f));

const recordMigration = db.prepare(
  'INSERT INTO schema_migrations (filename, applied_at) VALUES (?, ?)',
);

for (const filename of pending) {
  const sql = readFileSync(join(migrationsDir, filename), 'utf8');
  const run = db.transaction(() => {
    db.exec(sql);
    recordMigration.run(filename, Date.now());
  });
  run();
  log.info('migration applied', { filename });
}

// Startup cleanup: drop expired sessions.
const swept = db
  .prepare('DELETE FROM sessions WHERE expires_at < ?')
  .run(Date.now()) as { changes: number };
if (swept.changes > 0) {
  log.debug('expired sessions pruned', { count: swept.changes });
}
