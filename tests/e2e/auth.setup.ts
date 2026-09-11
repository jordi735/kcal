import { test as setup, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { startSignIn, submitSignInCode } from './auth-helpers';

// Signs in once per full test run and persists the resulting storageState.
// The `mobile` project in playwright.config.ts depends on this setup and
// reuses the state, so individual specs start already signed in.

const email = 'e2e@test.local';
const authFile = 'tests/e2e/.auth/user.json';

setup('[J-001] sign in once', async ({ page, request }) => {
  mkdirSync('tests/e2e/.auth', { recursive: true });

  await startSignIn(page, email, 'click');
  await expect(page.getByText(/CODE SENT/)).toBeVisible();
  await submitSignInCode(page, request, email);

  // Home renders on success; the Settings button is always present in MacroSummary.
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();

  await page.context().storageState({ path: authFile });
});
