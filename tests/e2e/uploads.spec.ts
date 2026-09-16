import { expect, type APIRequestContext } from '@playwright/test';
import { createHash } from 'node:crypto';
import { EXTRACTED_LABEL, multipart, test, UPLOAD_LIMIT } from './upload-helpers';
import type { UploadPart, UploadServer } from './upload-helpers';

test.use({ storageState: { cookies: [], origins: [] } });

const image = (body: Buffer | string = 'fixture image'): UploadPart => ({
  name: 'image', filename: 'label.png', mimetype: 'image/png', body,
});

async function upload(request: APIRequestContext, server: UploadServer, parts: readonly UploadPart[], token: string | null = server.token) {
  const body = multipart(parts);
  return request.post(`${server.origin}/products/from-image`, {
    data: body.data,
    headers: { ...body.headers, ...(token === null ? {} : { Authorization: `Bearer ${token}` }) },
  });
}

test('[J-250] Image uploads preserve bytes and accept the exact 8 MiB limit', async ({ request, uploadServer }) => {
  const small = Buffer.from('fixture image');
  const inputs = [small, Buffer.alloc(UPLOAD_LIMIT, 1)];
  for (const bytes of inputs) {
    const response = await upload(request, uploadServer, [image(bytes)]);
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual(EXTRACTED_LABEL);
  }
  await expect.poll(() => uploadServer.extractions).toEqual(inputs.map((bytes) => ({
    size: bytes.length, mimetype: 'image/png', sha256: createHash('sha256').update(bytes).digest('hex'),
  })));
});

test('[J-251] Malformed image uploads reject files and fields before extraction', async ({ request, uploadServer }) => {
  const cases: Array<{ name: string; parts: UploadPart[]; status: number; error: string | RegExp }> = [
    { name: 'missing image', parts: [], status: 400, error: 'missing_image' },
    { name: 'non-image', parts: [{ ...image(), mimetype: 'text/plain' }], status: 400, error: 'missing_image' },
    { name: 'oversize', parts: [image(Buffer.alloc(UPLOAD_LIMIT + 1))], status: 500, error: 'File too large' },
    { name: 'wrong file field', parts: [{ ...image(), name: 'other' }], status: 500, error: 'Unexpected file field' },
    { name: 'multiple images', parts: [image(), image()], status: 500, error: /^Too many (?:files|parts)$/ },
    { name: 'non-image then image', parts: [{ ...image(), mimetype: 'text/plain' }, image()], status: 500, error: /^Too many (?:files|parts)$/ },
    { name: 'text field', parts: [{ name: 'note', body: 'ignored' }], status: 500, error: 'Too many fields' },
    { name: 'nested field', parts: [{ name: 'a[b][c]', body: 'ignored' }], status: 500, error: 'Too many fields' },
    { name: 'large array index', parts: [{ name: 'items[4294967294]', body: 'ignored' }], status: 500, error: 'Too many fields' },
    { name: 'image plus text', parts: [image(), { name: 'note', body: 'ignored' }], status: 500, error: /^Too many (?:fields|parts)$/ },
  ];
  for (const entry of cases) {
    await test.step(entry.name, async () => {
      const response = await upload(request, uploadServer, entry.parts);
      expect(response.status()).toBe(entry.status);
      const expected = typeof entry.error === 'string' ? entry.error : expect.stringMatching(entry.error);
      expect(await response.json()).toEqual({ error: expected });
    });
  }
  const malformed = await request.post(`${uploadServer.origin}/products/from-image`, {
    headers: { Authorization: `Bearer ${uploadServer.token}`, 'Content-Type': 'multipart/form-data; boundary=unfinished' },
    data: Buffer.from('--unfinished\r\nContent-Disposition: form-data; name="image"; filename="label.png"\r\n'),
  });
  expect(malformed.status()).toBe(500);
  expect(await malformed.json()).toEqual({ error: 'Unexpected end of form' });
  expect(uploadServer.extractions).toEqual([]);
  // A parser error must leave the process able to handle a subsequent upload.
  const valid = await upload(request, uploadServer, [image()]);
  expect(valid.status()).toBe(200);
  expect(await valid.json()).toEqual(EXTRACTED_LABEL);
});

test('[J-252] Image upload authentication runs before multipart parsing', async ({ request, uploadServer }) => {
  for (const token of [null, 'invalid-session']) {
    const response = await request.post(`${uploadServer.origin}/products/from-image`, {
      headers: { 'Content-Type': 'multipart/form-data', ...(token === null ? {} : { Authorization: `Bearer ${token}` }) },
      data: Buffer.from('not a multipart body'),
    });
    expect(response.status()).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
  }
  expect(uploadServer.extractions).toEqual([]);
  const response = await upload(request, uploadServer, [image()]);
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual(EXTRACTED_LABEL);
});

test('[J-253] Image extraction failures retain controlled and general error responses', async ({ request, uploadServer }) => {
  for (const entry of [
    { marker: 'controlled', status: 422, error: 'invalid_extraction' },
    { marker: 'unexpected', status: 500, error: 'fixture extraction failed' },
  ]) {
    const response = await upload(request, uploadServer, [image(entry.marker)]);
    expect(response.status()).toBe(entry.status);
    expect(await response.json()).toEqual({ error: entry.error });
  }
  const response = await upload(request, uploadServer, [image()]);
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual(EXTRACTED_LABEL);
  await expect.poll(() => uploadServer.extractions.length).toBe(3);
});
