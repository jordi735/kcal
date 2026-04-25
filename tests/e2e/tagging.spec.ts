import { expect, test } from '@playwright/test';
import { seedProductAndLog } from './helpers';

// FoodRow's dot button toggles the entry's `tagged` boolean (migration
// 002_add_entries_tagged.sql). aria-pressed reflects the state and the
// aria-label flips between 'Mark as eaten' and 'Mark as not eaten' per
// src/components/FoodRow.tsx:35-36.
//
// Each test uses a unique product name — the test DB isn't wiped between
// tests (only at globalSetup), so a shared name would accumulate rows and
// break strict-mode locators.

const MACROS = { kcal: '100', protein: '10', carbs: '10', fat: '2' };

test('[J-031] dot toggle flips aria-pressed both ways', async ({ page }) => {
  const name = 'E2E Tag Toggle';
  await page.goto('/');
  await seedProductAndLog(page, name, MACROS, '100');

  const dot = page.locator('.food-row').filter({ hasText: name })
    .getByRole('button', { name: /Mark as (not )?eaten/ });

  await expect(dot).toHaveAttribute('aria-pressed', 'false');
  await dot.tap();
  await expect(dot).toHaveAttribute('aria-pressed', 'true');
  await dot.tap();
  await expect(dot).toHaveAttribute('aria-pressed', 'false');
});

test('[J-032] tagged state persists across reload', async ({ page }) => {
  const name = 'E2E Tag Persist';
  await page.goto('/');
  await seedProductAndLog(page, name, MACROS, '100');

  const row = () => page.locator('.food-row').filter({ hasText: name });
  const dot = () => row().getByRole('button', { name: /Mark as (not )?eaten/ });

  await dot().tap();
  await expect(dot()).toHaveAttribute('aria-pressed', 'true');

  // Entry updates are fire-and-forget from the tap handler — wait for the
  // PATCH to land before reloading, otherwise page.reload() cancels the
  // in-flight request and the tag never reaches the server.
  await page.waitForLoadState('networkidle');

  await page.reload();
  await expect(dot()).toHaveAttribute('aria-pressed', 'true');
});

test('[J-033] aria-label flips with tagged state', async ({ page }) => {
  const name = 'E2E Tag Aria';
  await page.goto('/');
  await seedProductAndLog(page, name, MACROS, '100');

  const dot = page.locator('.food-row').filter({ hasText: name })
    .getByRole('button', { name: /Mark as (not )?eaten/ });

  // Before: Mark as eaten (untagged). After tap: Mark as not eaten (tagged).
  // Assert the exact accessible name rather than getByRole({ name: 'Mark as
  // eaten' }) — Playwright's default name match is substring, so that
  // selector matches both 'Mark as eaten' and 'Mark as not eaten'.
  await expect(dot).toHaveAccessibleName('Mark as eaten');
  await dot.tap();
  await expect(dot).toHaveAccessibleName('Mark as not eaten');
});
