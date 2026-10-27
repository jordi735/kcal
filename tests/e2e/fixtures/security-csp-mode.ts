// Finite startup probe: invalid CSP settings must fail before opening SQLite.
// No .env, HTTP listener, browser, mail delivery or production database.
export type CspModeResult = { appEnv: string; mode: string | null };
const { env } = await import('../../../server/env.js');
const { db } = await import('../../../server/db.js');
db.close();
// Reflect keeps the pre-implementation red test executable before CSP_MODE is
// added to env. Its missing value is asserted as a failure by the parent test.
const raw: unknown = Reflect.get(env, 'CSP_MODE');
const result: CspModeResult = { appEnv: env.APP_ENV, mode: typeof raw === 'string' ? raw : null };
process.stdout.write('CSP_MODE_RESULT ' + JSON.stringify(result) + '\n');
