// SQLite handle + forward-only migration runner.
// Opens the DB on module load, applies any new migrations, and prunes expired sessions.

import Database from 'better-sqlite3';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from './env.js';
import { log } from './log.js';
import type { MigrationRow } from './types.js';

const dbPath = env.DATABASE_PATH;
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

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
