import { E2E_DATABASE_PATH, E2E_ORIGIN, E2E_PORT, E2E_USER_STATE } from './tests/e2e/test-config';
import { defineConfig, devices } from '@playwright/test';

// Prod topology: one Express process on :3001 serves both dist/ and the API.
// Invoking tsx directly (not via `npm run server:start`) so that our test env
// below is the sole source of truth — avoids shadowing from .env-file loading.

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: E2E_ORIGIN,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    { name: 'setup-user2', testMatch: /auth\.setup2\.ts/ },
    {
      name: 'mobile',
      // Match both setup files: `setup2?` makes the '2' optional, so the
      // regex matches auth.setup.ts and auth.setup2.ts.
      testIgnore: /auth\.setup2?\.ts/,
      use: {
        ...devices['Pixel 7'],
        storageState: E2E_USER_STATE,
      },
      dependencies: ['setup', 'setup-user2'],
    },
  ],
  webServer: {
    // Playwright launches webServer before globalSetup hooks. Reset before
    // Express opens SQLite, otherwise cleanup unlinks its live DB and WAL.
    command: 'npm run build && npx tsx tests/e2e/global-setup.ts && npx tsx server/index.ts',
    url: E2E_ORIGIN,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      PORT: E2E_PORT,
      DATABASE_PATH: E2E_DATABASE_PATH,
      TEST_MODE: 'true',
      POSTMARK_SERVER_TOKEN: 'unused',
      POSTMARK_FROM: 'test@test.local',
      SESSION_EXPIRY_DAYS: '7',
      LOGIN_CODE_EXPIRY_MINUTES: '10',
      LOG_LEVEL: 'warn',
      PUBLIC_ORIGIN: E2E_ORIGIN,
    },
  },
});
