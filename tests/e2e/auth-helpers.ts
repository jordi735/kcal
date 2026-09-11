import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

type StorageState = {
  origins: Array<{ localStorage: Array<{ name: string; value: string }> }>;
};

// Setup persists both shared users for API-only and cross-user fixtures.
export function tokenFrom(path: string): string {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as StorageState;
  const entry = parsed.origins[0]?.localStorage.find(
    (item) => item.name === 'kcal_session_token',
  );
  if (entry === undefined) throw new Error(`no session token in ${path}`);
  return entry.value;
}

export async function startSignIn(
  page: Page,
  email: string,
  interaction: 'click' | 'tap',
): Promise<void> {
  await page.goto('/');
  // ClearableField's label is not htmlFor-bound; use its placeholder.
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByRole('button', { name: 'Send sign-in code' })[interaction]();
}

export async function submitSignInCode(
  page: Page,
  request: APIRequestContext,
  email: string,
): Promise<void> {
  const res = await request.get(`/auth/test/last-code/${email}`);
  expect(res.ok()).toBeTruthy();
  const { code } = (await res.json()) as { code: string };
  // Login automatically submits when the sixth digit is filled.
  await page.getByLabel('6-digit sign-in code').fill(code);
}
