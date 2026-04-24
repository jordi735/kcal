import { test as setup, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

// Signs in once per full test run and persists the resulting storageState.
// The `mobile` project in playwright.config.ts depends on this setup and
// reuses the state, so individual specs start already signed in.

const email = 'e2e@test.local';
const authFile = 'tests/e2e/.auth/user.json';

setup('sign in once', async ({ page, request }) => {
  mkdirSync('tests/e2e/.auth', { recursive: true });

  await page.goto('/');

  // Email step. ClearableField has no htmlFor binding on its label, so
  // placeholder is the most reliable selector here.
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByRole('button', { name: 'Send sign-in code' }).click();
  await expect(page.getByText(/CODE SENT/)).toBeVisible();

  // Read the code back via the TEST_MODE-gated backdoor.
  const res = await request.get(`/auth/test/last-code/${email}`);
  expect(res.ok()).toBeTruthy();
  const { code } = (await res.json()) as { code: string };

  // Fill the 6-digit code — Login.tsx:114 auto-submits on 6 digits.
  await page.getByLabel('6-digit sign-in code').fill(code);

  // Home renders on success; the Settings button is always present in MacroSummary.
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();

  await page.context().storageState({ path: authFile });
});
