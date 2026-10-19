import { test, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runServerFixture } from './server-fixture';

test('[J-440] v4 receipts replay through the amount rename after edits deletion and process restart', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'kcal-v5-receipts-'));
  try {
    for (const phase of ['create', 'replay']) {
      const child = runServerFixture(new URL('./fixtures/v5-receipt-replay.ts', import.meta.url), path.join(directory, 'app.db'), {
        RECEIPT_TEST_PHASE: phase,
      });
      expect(child.status, child.stderr || child.stdout).toBe(0);
      expect(child.stdout).toContain('v5-replay-ok');
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
