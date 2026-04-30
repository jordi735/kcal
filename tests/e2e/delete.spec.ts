import { expect, test } from '@playwright/test';
import { longPress, seedProductAndLog } from './helpers';

// Delete flows. Three independent delete UIs in the app:
//   1. SelectionBar — multi-select, frictionless single-tap (no confirm step)
//   2. GramsPicker  — single entry, frictionless single-tap (covered by J-017
//                     in edit.spec.ts; not duplicated here)
//   3. NewProductForm in edit mode — two-tap "armed" pattern. First tap flips
//                     aria-label "Delete product" → "Confirm delete"; second
//                     tap fires onDelete. There is NO timer revert: the only
//                     way to disarm is to close & reopen the form.
//
// Server contract (products.ts:334-351, entries.ts:208-221):
//   - 400 invalid_id for zero / negative / non-numeric :id
//   - 404 not_found when nothing the caller owns matches the id
//   - Product delete is transactional: deleteForProduct(user_id, product_id)
//     runs first to satisfy the ON DELETE RESTRICT FK on entries.product_id
//     (migrations/001_init.sql:38-46). UI proof in J-060.

const MACROS = { kcal: '100', protein: '10', carbs: '10', fat: '2' };

test('[J-057] multi-delete leaves unselected rows untouched', async ({ page }) => {
  // Falsifies a bug where bulk delete accidentally drops every entry on the
  // day instead of only the selected subset. Three rows seeded; long-press
  // arms selection on row A; tap row B adds it; row C is never selected.
  // After "Delete 2 selected" only C must survive — and the row count for
  // A and B must be exactly 0 (not 1, not 2; toHaveCount is strict).
  const a = 'E2E Del Multi A';
  const b = 'E2E Del Multi B';
  const c = 'E2E Del Multi C';
  await page.goto('/');
  await seedProductAndLog(page, a, MACROS, '100');
  await seedProductAndLog(page, b, MACROS, '100');
  await seedProductAndLog(page, c, MACROS, '100');

  const rowA = page.locator('.food-row').filter({ hasText: a });
  const rowB = page.locator('.food-row').filter({ hasText: b });
  const rowC = page.locator('.food-row').filter({ hasText: c });

  await longPress(rowA.locator('button').nth(1));
  await rowB.locator('button').nth(1).tap();
  await expect(page.getByText('2 selected')).toBeVisible();

  await page.getByRole('button', { name: 'Delete 2 selected', exact: true }).tap();

  await expect(rowA).toHaveCount(0);
  await expect(rowB).toHaveCount(0);
  await expect(rowC).toHaveCount(1);
});

test('[J-058] product delete: first tap arms; second tap deletes', async ({
  page,
}) => {
  // Two-tap arming pattern at NewProductForm.tsx:190-202. The first tap MUST
  // NOT delete: this test keeps the assertions falsifiable by checking three
  // independent things after tap 1 — (a) the button's aria-label has flipped
  // to "Confirm delete", (b) the original "Delete product" label is gone (so
  // it's the same button mutating, not a new one), and (c) the row still
  // exists on the home list (would mean the deletion ran prematurely). Only
  // tap 2 is allowed to remove the row.
  const name = 'E2E Del Arm';
  await page.goto('/');
  await seedProductAndLog(page, name, MACROS, '100');

  const row = page.locator('.food-row').filter({ hasText: name });

  // Open edit-product: row → GramsPicker (edit) → pencil → NewProductForm.
  await row.locator('button').nth(1).tap();
  await page.getByText('Edit amount').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Edit product', exact: true }).tap();
  await page.getByRole('button', { name: 'Save changes' }).waitFor({ state: 'visible' });

  // Tap 1 — arm only.
  await page.getByRole('button', { name: 'Delete product', exact: true }).tap();

  // Negative-path: still on the form, button label flipped, row untouched.
  await expect(
    page.getByRole('button', { name: 'Confirm delete', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Delete product', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible();
  await expect(row).toHaveCount(1);

  // Tap 2 — confirm; sheet closes and the row finally goes away.
  await page.getByRole('button', { name: 'Confirm delete', exact: true }).tap();
  await expect(row).toHaveCount(0);
});

test('[J-059] product delete arm state does not persist across close-and-reopen', async ({
  page,
}) => {
  // The arm state is local React useState inside NewProductFormInner
  // (line 113). Closing the form unmounts that component; reopening must
  // start FRESH (unarmed). A bug that hoisted the state into App.tsx or
  // localStorage would let the second tap fire instantly on the next open
  // — this test would catch that immediately.
  const name = 'E2E Del Disarm';
  await page.goto('/');
  await seedProductAndLog(page, name, MACROS, '100');

  const row = page.locator('.food-row').filter({ hasText: name });
  await row.locator('button').nth(1).tap();
  await page.getByText('Edit amount').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Edit product', exact: true }).tap();
  await page.getByRole('button', { name: 'Save changes' }).waitFor({ state: 'visible' });

  // Arm it, then bail without confirming. The Cancel button on
  // NewProductForm.tsx:217-219 routes us back to GramsPicker via App.tsx:586.
  await page.getByRole('button', { name: 'Delete product', exact: true }).tap();
  await expect(
    page.getByRole('button', { name: 'Confirm delete', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).tap();
  await page.getByText('Edit amount').waitFor({ state: 'visible' });

  // Reopen edit-product. The button MUST be back to "Delete product".
  await page.getByRole('button', { name: 'Edit product', exact: true }).tap();
  await page.getByRole('button', { name: 'Save changes' }).waitFor({ state: 'visible' });
  await expect(
    page.getByRole('button', { name: 'Delete product', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Confirm delete', exact: true }),
  ).toHaveCount(0);

  // And the row's still on the home list — nothing was deleted.
  await expect(row).toHaveCount(1);
});

test('[J-060] product delete cascades every entry the user logged for it', async ({
  page,
}) => {
  // Per CLAUDE.md, "Macros are computed, never stored" — the FK is ON DELETE
  // RESTRICT (migrations/001_init.sql:38-46), so the route MUST run
  // entries.deleteForProduct first inside a transaction. UI proof: log the
  // SAME product twice on the same day (creating two entry rows), then delete
  // the product. Both rows must vanish in a single operation. A bug that
  // forgot the transaction wrapper would either 409 (FK violation propagated
  // as 500) or, worse, leave one orphaned row behind.
  const name = 'E2E Del Cascade';
  await page.goto('/');
  await seedProductAndLog(page, name, MACROS, '100');

  // Re-log the same product via AddPicker → existing-product tap → grams.
  // Don't go through Add New again or we'd hit a uniqueness conflict on
  // (created_by, name) and the spec would be testing the wrong thing.
  await page.getByRole('button', { name: 'ADD FOOD' }).tap();
  await page.getByPlaceholder('Search products...').fill(name);
  const picker = page
    .locator('.sheet')
    .filter({ has: page.getByPlaceholder('Search products...') });
  await picker.getByText(name).first().tap();
  await page.getByText('How much?').waitFor({ state: 'visible' });
  await page.getByRole('spinbutton').fill('200');
  await page.getByRole('button', { name: /Add to day/ }).tap();

  const rows = page.locator('.food-row').filter({ hasText: name });
  await expect(rows).toHaveCount(2);

  // Delete the product via either entry's edit-product flow — the route is
  // scoped by created_by + product_id, both rows resolve to the same product.
  await rows.first().locator('button').nth(1).tap();
  await page.getByText('Edit amount').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Edit product', exact: true }).tap();
  await page.getByRole('button', { name: 'Save changes' }).waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Delete product', exact: true }).tap();
  await page.getByRole('button', { name: 'Confirm delete', exact: true }).tap();

  // Both rows gone in one shot — the transactional cascade ran cleanly.
  await expect(rows).toHaveCount(0);
});

test('[J-061] SelectionBar delete button aria-label scales with the count', async ({
  page,
}) => {
  // Mutation-resists the count templating in SelectionBar.tsx:77
  // (`Delete ${n} selected`). J-027 in selection.spec.ts already covers
  // n=2; this test pushes to n=3 to catch a hard-coded "2 selected" or an
  // off-by-one in the n derivation. Asserts both the dynamic label and that
  // n=3 actually deletes three rows.
  const a = 'E2E Del Three A';
  const b = 'E2E Del Three B';
  const c = 'E2E Del Three C';
  await page.goto('/');
  await seedProductAndLog(page, a, MACROS, '100');
  await seedProductAndLog(page, b, MACROS, '100');
  await seedProductAndLog(page, c, MACROS, '100');

  const rowA = page.locator('.food-row').filter({ hasText: a });
  const rowB = page.locator('.food-row').filter({ hasText: b });
  const rowC = page.locator('.food-row').filter({ hasText: c });

  await longPress(rowA.locator('button').nth(1));
  await rowB.locator('button').nth(1).tap();
  await rowC.locator('button').nth(1).tap();
  await expect(page.getByText('3 selected')).toBeVisible();

  // Negative-path: a "Delete 2 selected" button must NOT exist at this point.
  await expect(
    page.getByRole('button', { name: 'Delete 2 selected', exact: true }),
  ).toHaveCount(0);

  await page.getByRole('button', { name: 'Delete 3 selected', exact: true }).tap();

  await expect(rowA).toHaveCount(0);
  await expect(rowB).toHaveCount(0);
  await expect(rowC).toHaveCount(0);
});

test('[J-062] DELETE /entries/:id with malformed id returns 400 invalid_id', async ({
  page,
  request,
}) => {
  // entries.ts:209-212 → parsePositiveInt returns null for "0", "-1", "abc";
  // route returns 400 invalid_id. Cover all three flavors in one test — they
  // all funnel through the same guard, so a regression in any kills the
  // contract for the others too.
  await page.goto('/');
  const token = await page.evaluate(() =>
    localStorage.getItem('kcal_session_token'),
  );
  expect(token).not.toBeNull();

  for (const bad of ['0', '-1', 'abc']) {
    const res = await request.delete(`/entries/${bad}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status(), `id="${bad}"`).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_id' });
  }
});

test('[J-063] DELETE /entries/:id with unknown id returns 404 not_found', async ({
  page,
  request,
}) => {
  // entries.ts:214-217 — when entries.delete.run reports changes=0, the row
  // either does not exist or belongs to another user (the WHERE clause is
  // user_id = ? AND id = ?). Either way the contract is 404 not_found, not
  // a 200 silent no-op or a leaky 403.
  await page.goto('/');
  const token = await page.evaluate(() =>
    localStorage.getItem('kcal_session_token'),
  );
  expect(token).not.toBeNull();

  const res = await request.delete('/entries/9999999', {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status()).toBe(404);
  expect(await res.json()).toEqual({ error: 'not_found' });
});

test('[J-064] DELETE /products/:id with malformed id returns 400 invalid_id', async ({
  page,
  request,
}) => {
  // Same parsePositiveInt guard at products.ts:335-338. Mirror of J-062 on
  // the products router — both must agree on the contract.
  await page.goto('/');
  const token = await page.evaluate(() =>
    localStorage.getItem('kcal_session_token'),
  );
  expect(token).not.toBeNull();

  for (const bad of ['0', '-1', 'abc']) {
    const res = await request.delete(`/products/${bad}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status(), `id="${bad}"`).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_id' });
  }
});

test('[J-065] DELETE /products/:id with unknown id returns 404 not_found', async ({
  page,
  request,
}) => {
  // products.ts:344-348 — transaction returns changes=0 when no row matches
  // (created_by, id). 404 not_found is the contract; do not leak whether the
  // id exists for someone else (which would be an enumeration vector).
  await page.goto('/');
  const token = await page.evaluate(() =>
    localStorage.getItem('kcal_session_token'),
  );
  expect(token).not.toBeNull();

  const res = await request.delete('/products/9999999', {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status()).toBe(404);
  expect(await res.json()).toEqual({ error: 'not_found' });
});
