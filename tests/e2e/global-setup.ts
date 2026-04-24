import { rmSync } from 'node:fs';

// Wipe the test DB (and its WAL/SHM siblings) before Playwright boots the
// webServer. Each `npm test` run sees a completely empty database, so
// migrations apply fresh and there is no leftover state from prior runs.
export default async function globalSetup() {
  for (const suffix of ['', '-wal', '-shm']) {
    rmSync(`/tmp/kcal-e2e.db${suffix}`, { force: true });
  }
}
