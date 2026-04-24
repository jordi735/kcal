import { defineConfig, devices } from '@playwright/test';

// Prod topology: one Express process on :3001 serves both dist/ and the API.
// Invoking tsx directly (not via `npm run server:start`) so that our test env
// below is the sole source of truth — avoids shadowing from .env-file loading.

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3001',
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
        storageState: 'tests/e2e/.auth/user.json',
      },
      dependencies: ['setup', 'setup-user2'],
    },
  ],
  webServer: {
    command: 'npm run build && npx tsx server/index.ts',
    url: 'http://localhost:3001',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      PORT: '3001',
      DATABASE_PATH: '/tmp/kcal-e2e.db',
      TEST_MODE: 'true',
      POSTMARK_SERVER_TOKEN: 'unused',
      POSTMARK_FROM: 'test@test.local',
      SESSION_EXPIRY_DAYS: '7',
      LOGIN_CODE_EXPIRY_MINUTES: '10',
      AI_SCAN_DAILY_CAP: '100',
      LOG_LEVEL: 'warn',
    },
  },
});
