import { test as setup, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { startSignIn, submitSignInCode } from './auth-helpers';

// Second shared user for cross-user catalog and ownership checks. Its
// separate storageState lets both users coexist in a single test run.

const email = 'e2e2@test.local';
const authFile = 'tests/e2e/.auth/user2.json';

setup('[J-001] sign in user 2', async ({ page, request }) => {
  mkdirSync('tests/e2e/.auth', { recursive: true });

  await startSignIn(page, email, 'click');
  await expect(page.getByText(/CODE SENT/)).toBeVisible();
  await submitSignInCode(page, request, email);

  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();

  await page.context().storageState({ path: authFile });
});
