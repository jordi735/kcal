import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Server modules capture their database and environment at import time. Run
// these fixtures separately so they cannot alter the suite's running server.
export function serverFixtureEnvironment(databasePath: string, envOverrides: Record<string, string> = {},
  options: { inheritEnv?: boolean } = {}): NodeJS.ProcessEnv {
  return {
    ...(options.inheritEnv === false ? {} : process.env),
    PORT: '3000',
    DATABASE_PATH: databasePath,
    TEST_MODE: 'true',
    POSTMARK_SERVER_TOKEN: 'unused',
    POSTMARK_FROM: 'test@test.local',
    SESSION_EXPIRY_DAYS: '7',
    LOGIN_CODE_EXPIRY_MINUTES: '10',
    LOG_LEVEL: 'error',
    PUBLIC_ORIGIN: '',
    ...envOverrides,
  };
}

export function runServerFixture(program: URL, databasePath: string, envOverrides: Record<string, string> = {},
  options: { timeoutMs?: number; inheritEnv?: boolean } = {}) {
  const child = spawnSync(process.execPath, ['--import', 'tsx', fileURLToPath(program)], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 20_000,
    env: serverFixtureEnvironment(databasePath, envOverrides, options),
  });
  if (child.error !== undefined) {
    throw new Error(`Server fixture ${program.pathname} failed to run.\n${child.stdout}\n${child.stderr}`, { cause: child.error });
  }
  return child;
}
