import { test as setup, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

// Second user — used exclusively by adopt.spec.ts to test the cross-user
// barcode-catalog flow. Mirrors auth.setup.ts exactly except for the email
// and storageState file, so both users can coexist in a single test run.

const email = 'e2e2@test.local';
const authFile = 'tests/e2e/.auth/user2.json';

setup('[J-001] sign in user 2', async ({ page, request }) => {
  mkdirSync('tests/e2e/.auth', { recursive: true });

  await page.goto('/');

  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByRole('button', { name: 'Send sign-in code' }).click();
  await expect(page.getByText(/CODE SENT/)).toBeVisible();

  const res = await request.get(`/auth/test/last-code/${email}`);
  expect(res.ok()).toBeTruthy();
  const { code } = (await res.json()) as { code: string };

  await page.getByLabel('6-digit sign-in code').fill(code);

  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();

  await page.context().storageState({ path: authFile });
});
