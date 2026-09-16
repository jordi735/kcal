import { test as base } from '@playwright/test';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ExtractedLabel } from '../../shared/types';

export const UPLOAD_LIMIT = 8 * 1024 * 1024;
export const EXTRACTED_LABEL: ExtractedLabel = {
  name: 'Upload fixture', brand: null, unit: 'g',
  per100: { kcal: 125, protein: 5, carbs: 15, fat: 4 },
};

type ExtractionCall = { size: number; mimetype: string; sha256: string };
export type UploadServer = {
  origin: string;
  token: string;
  extractions: ExtractionCall[];
  close: () => Promise<void>;
};

export type UploadPart = {
  name: string;
  body: Buffer | string;
  filename?: string;
  mimetype?: string;
};

// Raw multipart also lets the tests send duplicate file fields and malformed
// field names, which a Record-based multipart helper cannot represent.
export function multipart(parts: readonly UploadPart[]) {
  const boundary = `kcal-upload-${randomUUID()}`;
  const chunks: Buffer[] = [];
  for (const part of parts) {
    const filename = part.filename === undefined ? '' : `; filename="${part.filename}"`;
    const type = part.mimetype === undefined ? '' : `Content-Type: ${part.mimetype}\r\n`;
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"${filename}\r\n${type}\r\n`));
    chunks.push(Buffer.isBuffer(part.body) ? part.body : Buffer.from(part.body));
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { data: Buffer.concat(chunks), headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` } };
}

export async function startUploadServer(): Promise<UploadServer> {
  const directory = await mkdtemp(path.join(tmpdir(), 'kcal-uploads-'));
  const extractions: ExtractionCall[] = [];
  const extractor = `
    import { createHash } from 'node:crypto';
    export class InvalidExtractionError extends Error {}
    export async function extractNutrition(buffer, mimetype) {
      const sha256 = createHash('sha256').update(buffer).digest('hex');
      process.stdout.write(JSON.stringify({ kind: 'extraction', size: buffer.length, mimetype, sha256 }) + '\\n');
      const marker = buffer.subarray(0, 10).toString();
      if (marker === 'controlled') throw new InvalidExtractionError('fixture invalid extraction');
      if (marker === 'unexpected') throw new Error('fixture extraction failed');
      return ${JSON.stringify(EXTRACTED_LABEL)};
    }
    export function probeCodex() { throw new Error('upload tests must not probe Codex'); }
  `;
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    import { registerHooks } from 'node:module';
    import express from 'express';
    // Replace only the extraction boundary before loading the production app.
    // TEST_MODE itself does not stub inference; this hook prevents live AI.
    registerHooks({ resolve(specifier, context, nextResolve) {
      const parent = context.parentURL ? new URL(context.parentURL).pathname : '';
      if (specifier.includes('codex-runner')) throw new Error('live Codex runner forbidden in upload tests');
      if ((parent.endsWith('/server/routes/products.ts') && specifier === '../codex.js') ||
          (parent.endsWith('/server/index.ts') && specifier === './codex.js')) {
        return { url: ${JSON.stringify(`data:text/javascript,${encodeURIComponent(extractor)}`)}, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    } });
    const { statements } = await import('./server/statements.ts');
    const { createSession } = await import('./server/auth.ts');
    statements.users.upsert.run('upload-fixture@test.local', Date.now());
    const user = statements.users.selectByEmail.get('upload-fixture@test.local');
    const { token } = createSession(user.id);
    // Keep the real app, middleware ordering and error handler, while binding
    // an OS-assigned loopback port rather than the shared Playwright server.
    const listen = express.application.listen;
    express.application.listen = function (_port, callback) {
      const server = listen.call(this, 0, '127.0.0.1', callback);
      server.once('listening', () => process.stdout.write(JSON.stringify({
        kind: 'ready', port: server.address().port, token,
      }) + '\\n'));
      return server;
    };
    await import('./server/index.ts');
  `], {
    cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      PATH: process.env.PATH, PORT: '3000', DATABASE_PATH: path.join(directory, 'app.db'),
      TEST_MODE: 'true', POSTMARK_SERVER_TOKEN: 'unused', POSTMARK_FROM: 'test@test.local',
      SESSION_EXPIRY_DAYS: '7', LOGIN_CODE_EXPIRY_MINUTES: '10', AI_SCAN_DAILY_CAP: '100',
      LOG_LEVEL: 'error', PUBLIC_ORIGIN: '', DEBUG_ALLOW_IPS: '', TRUST_PROXY: 'loopback',
    },
  });
  let stderr = '';
  child.stderr.on('data', (data: Buffer) => { stderr = (stderr + data.toString()).slice(-16_384); });
  const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
  async function close() {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    const force = setTimeout(() => child.kill('SIGKILL'), 5000);
    try { await closed; } finally { clearTimeout(force); await rm(directory, { recursive: true, force: true }); }
  }
  try {
    const ready = await new Promise<{ port: number; token: string }>((resolve, reject) => {
      let pending = '';
      const timeout = setTimeout(() => reject(new Error(`upload server did not start: ${stderr}`)), 10_000);
      child.once('error', (error) => { clearTimeout(timeout); reject(error); });
      child.once('exit', (code) => {
        clearTimeout(timeout);
        reject(new Error(`upload server exited (${code}): ${stderr}`));
      });
      child.stdout.on('data', (data: Buffer) => {
        pending += data.toString();
        let newline: number;
        while ((newline = pending.indexOf('\n')) !== -1) {
          const line = pending.slice(0, newline);
          pending = pending.slice(newline + 1);
          try {
            const event = JSON.parse(line) as { kind: string; port: number; token: string; size: number; mimetype: string; sha256: string };
            if (event.kind === 'ready') { clearTimeout(timeout); resolve(event); }
            if (event.kind === 'extraction') extractions.push({ size: event.size, mimetype: event.mimetype, sha256: event.sha256 });
          } catch { clearTimeout(timeout); reject(new Error(`unexpected upload server output: ${line}`)); }
        }
      });
    });
    return { origin: `http://127.0.0.1:${ready.port}`, token: ready.token, extractions, close };
  } catch (error) { await close(); throw error; }
}

export const test = base.extend<{ uploadServer: UploadServer }>({
  uploadServer: async ({}, use) => {
    const server = await startUploadServer();
    try { await use(server); } finally { await server.close(); }
  },
});
