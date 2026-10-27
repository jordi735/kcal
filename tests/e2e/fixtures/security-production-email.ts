import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';

for (const transport of [http, https]) {
  transport.request = transport.get = () => {
    throw new Error('Unexpected network request in production email fixture');
  };
}
syncBuiltinESMExports();
let calls = 0;
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  assert.equal(request.url, 'https://api.postmarkapp.com/email');
  const body = await request.json() as { HtmlBody: string; TextBody: string };
  assert.ok(body.HtmlBody.includes('726495'));
  assert.ok(body.TextBody.includes('726495'));
  calls++;
  return Response.json({ ErrorCode: 0, Message: 'OK', MessageID: 'fixture-only',
    SubmittedAt: '2026-10-27T15:30:00Z', To: 'recipient@example.test' });
};
const { sendLoginCode } = await import('../../../server/email.js');
await sendLoginCode('recipient@example.test', '726495');
assert.equal(calls, 1);
process.stdout.write('SECURITY_EMAIL_DELIVERED\n');
