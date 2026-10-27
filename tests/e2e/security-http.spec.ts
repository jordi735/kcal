import { test, expect } from '@playwright/test';
import { brotliCompressSync, deflateSync, gzipSync } from 'node:zlib';
import { runServerFixture } from './server-fixture';

test('[J-520] HTTP parsers reject compression and oversized requests without losing availability', async ({ request }) => {
  const body = Buffer.from(JSON.stringify({ email: 'parser@example.test', code: '000000' }));
  for (const [encoding, compress] of [
    ['gzip', gzipSync], ['deflate', deflateSync], ['br', brotliCompressSync],
  ] as const) {
    const response = await request.post('/auth/verify-code', {
      headers: { 'Content-Type': 'application/json', 'Content-Encoding': encoding }, data: compress(body),
    });
    expect(response.status(), encoding).toBe(415);
    expect(await response.json()).toEqual({ error: 'unsupported_encoding' });
  }
  for (const [path, padding] of [
    ['/auth/verify-code', 4096], ['/register', 16384], ['/entries', 65536], ['/mcp', 65536],
  ] as const) {
    const response = await request.post(path, { data: { padding: 'a'.repeat(padding) } });
    expect(response.status(), path).toBe(413);
    expect(await response.json()).toEqual({ error: 'request_too_large' });
  }
  const ordinary = await request.post('/auth/verify-code', { data: { email: 'parser@example.test', code: '000000' } });
  expect(ordinary.status()).toBe(400);
  expect(await ordinary.json()).toEqual({ error: 'invalid_or_expired_code' });
  expect((await request.get('/')).status()).toBe(200);
});

test('[J-521] patched compressed-body parsing survives trailing decoder errors in an isolated process', () => {
  const child = runServerFixture(new URL('./fixtures/security-parser.ts', import.meta.url), ':memory:', {}, { timeoutMs: 8000 });
  expect(child.status, child.stderr).toBe(0);
  expect(JSON.parse(child.stdout)).toEqual({ survived: true });
});
