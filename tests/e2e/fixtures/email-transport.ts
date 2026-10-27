import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';

for (const transport of [http, https]) {
  transport.request = transport.get = () => {
    throw new Error('Unexpected network request in email transport test');
  };
}
syncBuiltinESMExports();

const requests: Array<{ url: string; method: string; headers: Record<string, string>; body: unknown }> = [];
let outcome: 'success' | 'api' | 'network' = 'success';
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  requests.push({
    url: request.url,
    method: request.method,
    headers: Object.fromEntries(request.headers),
    body: await request.json(),
  });
  if (outcome === 'network') throw new TypeError('Email transport unavailable');
  return Response.json(outcome === 'api'
    ? { ErrorCode: 300, Message: 'Invalid email request' }
    : { ErrorCode: 0, Message: 'OK', MessageID: 'test-message',
        SubmittedAt: '2026-09-15T12:00:00Z', To: 'recipient@example.test' },
    { status: outcome === 'api' ? 422 : 200 });
};

// Install every network guard before importing the sender and Postmark client.
const { sendLoginCode } = await import('../../../server/email.js');
await sendLoginCode('recipient@example.test', '482731');

const failures: Array<{ message: unknown; code: unknown; statusCode: unknown } | null> = [];
for (outcome of ['api', 'network'] as const) {
  try {
    await sendLoginCode('recipient@example.test', '482731');
    failures.push(null);
  } catch (error) {
    const failure = error as { message: unknown; code: unknown; statusCode: unknown };
    failures.push({ message: failure.message, code: failure.code, statusCode: failure.statusCode });
  }
}
process.stdout.write(JSON.stringify({ requests, failures }));
