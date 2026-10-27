// A valid environment reaches the real DB import and creates its parent folder.
// Invalid production/test configuration must exit first. Never import .env.
if (process.env.SECURITY_OMIT_APP_ENV === 'true') delete process.env.APP_ENV;
await import('../../../server/env.js');
const { db } = await import('../../../server/db.js');
db.close();
process.stdout.write('SECURITY_DB_OPENED\n');
