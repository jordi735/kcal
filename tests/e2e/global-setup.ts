import { rmSync } from 'node:fs';

// Invoked by webServer.command BEFORE Express opens SQLite. Playwright's
// globalSetup hook runs after webServer and would unlink a live database.
// Each test run starts a new server with a fresh DB and fresh migrations.
for (const suffix of ['', '-wal', '-shm']) {
  rmSync(`/tmp/kcal-e2e.db${suffix}`, { force: true });
}
