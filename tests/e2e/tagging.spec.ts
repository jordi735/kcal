import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { seedProductAndLog } from './helpers';

// FoodRow's dot button toggles the entry's `tagged` boolean (migration
// 002_add_entries_tagged.sql). aria-pressed reflects the state and the
// aria-label flips between 'Mark as eaten' and 'Mark as not eaten' per
// src/components/FoodRow.tsx:35-36. The flow is:
//   FoodRow.onClick → Home.onToggleTagged → App.onMarkTagged([en], !en.tagged)
//   → useEntries.update(id, { tagged }) → PATCH /entries/:id → setState
// UI mirrors the SERVER response (not optimistic) — the server is the source
// of truth for the displayed state. Bulk tag/untag through SelectionBar lives
// in selection.spec.ts (J-024..J-029, J-128, J-133).
//
// Each test uses a unique product name — the test DB isn't wiped between
// tests (only at globalSetup), so a shared name would accumulate rows and
// break strict-mode locators.

const MACROS = { kcal: '100', protein: '10', carbs: '10', fat: '2' };

type StorageState = {
  origins: Array<{ localStorage: Array<{ name: string; value: string }> }>;
};

function tokenFrom(path: string): string {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as StorageState;
  const entry = parsed.origins[0]?.localStorage.find(
    (e) => e.name === 'kcal_session_token',
  );
  if (entry === undefined) throw new Error(`no session token in ${path}`);
  return entry.value;
}

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

  // Anchor on the PATCH itself rather than networkidle — this proves the tap
  // reached the server (which is what `tagged` persistence depends on) and
  // catches a regression where the `update` call is dropped client-side.
  const [patch] = await Promise.all([
    page.waitForResponse(
      (r) => /\/entries\/\d+$/.test(new URL(r.url()).pathname) && r.request().method() === 'PATCH',
    ),
    dot().tap(),
  ]);
  expect(patch.status()).toBe(200);
  expect(patch.request().postDataJSON()).toEqual({ tagged: true });
  await expect(dot()).toHaveAttribute('aria-pressed', 'true');

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

test('[J-149] PATCH /entries/:id rejects non-boolean tagged with 400 invalid_entry', async ({ request }) => {
  // entries.ts:63-69 isUpdateEntryBody — the `'tagged' in v` branch requires
  // typeof v.tagged === 'boolean'. The peer test J-073 covers the grams half;
  // this test pins the tagged half so a `typeof !== 'boolean'` removal lands
  // on a red test. Three flavors: stringly-true (the most common UI bug
  // shape), a number, and null — none of which should slip through.
  const token = tokenFrom('tests/e2e/.auth/user.json');
  const cases: Array<unknown> = ['true', 1, null];
  for (const tagged of cases) {
    const res = await request.patch('/entries/1', {
      headers: { Authorization: `Bearer ${token}` },
      data: { tagged },
    });
    expect(res.status(), `tagged=${JSON.stringify(tagged)}`).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_entry' });
  }
});

test.describe('cross-user tagging contract', () => {
  // User B drives via storageState user2.json; user A's entry id is harvested
  // via direct API as user A. statements.entries.updateTagged is user-scoped
  // (entries.ts:188 takes req.userId!) — a mutation that drops the userId
  // would let user B silently flip user A's tagged flag.
  test.use({ storageState: 'tests/e2e/.auth/user2.json' });

  test('[J-150] PATCH /entries/:id from another user returns 404 not_found', async ({ request }) => {
    const tokenA = tokenFrom('tests/e2e/.auth/user.json');
    const tokenB = tokenFrom('tests/e2e/.auth/user2.json');

    // Seed a product + entry as user A. Use a per-test name so the row is
    // unambiguous and avoids depending on globalSetup ordering.
    const name = `E2E Tag Cross ${Date.now()}`;
    const productRes = await request.post('/products', {
      headers: { Authorization: `Bearer ${tokenA}` },
      data: {
        name,
        brand: null,
        unit: 'g' as const,
        barcode: null,
        per100: { kcal: 100, protein: 10, carbs: 10, fat: 2 },
        is_temp: false,
      },
    });
    expect(productRes.ok(), await productRes.text()).toBeTruthy();
    const product = (await productRes.json()) as { id: number };

    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const local_date = `${yyyy}-${mm}-${dd}`;

    const entryRes = await request.post('/entries', {
      headers: { Authorization: `Bearer ${tokenA}` },
      data: { product_id: product.id, grams: 100, local_date, local_time: '12:00' },
    });
    expect(entryRes.ok(), await entryRes.text()).toBeTruthy();
    const entry = (await entryRes.json()) as { id: number; tagged: boolean };
    expect(entry.tagged).toBe(false);

    // User B attempts to flip user A's tag. Server scopes the UPDATE to
    // req.userId; changes=0 → 404 not_found.
    const tagRes = await request.patch(`/entries/${entry.id}`, {
      headers: { Authorization: `Bearer ${tokenB}` },
      data: { tagged: true },
    });
    expect(tagRes.status()).toBe(404);
    expect(await tagRes.json()).toEqual({ error: 'not_found' });

    // Negative-path: confirm user A's row is still untagged. A regression
    // that dropped the userId scope would leave changes=1 and the PATCH would
    // succeed silently — this re-read pins the actual write-side invariant.
    const reread = await request.get(`/entries?date=${local_date}`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    expect(reread.ok()).toBeTruthy();
    const rows = (await reread.json()) as Array<{ id: number; tagged: boolean }>;
    const same = rows.find((r) => r.id === entry.id);
    expect(same).toBeDefined();
    expect(same!.tagged).toBe(false);
  });
});

test('[J-151] dot tap does not change MacroSummary kcal totals', async ({ page }) => {
  // Macros are computed from `grams × per100/100` — `tagged` is purely a UI
  // marker. Tagging must NOT influence Consumed/Remaining. A mutation that
  // weighted tagged entries differently in sumMacros (or excluded them)
  // would shift these numbers; this test pins the invariant. Other tests in
  // this spec have already seeded entries for today, so we snapshot the
  // MacroSummary's text BEFORE tap and assert it is byte-identical after.
  const name = 'E2E Tag Macros';
  await page.goto('/');
  await seedProductAndLog(page, name, MACROS, '200');

  // Scope to the MacroSummary dock: it owns the "Kcal remaining"/"Over
  // budget" headline and the "Consumed" value. Use the headline label as a
  // stable anchor (renders unconditionally; never collides with FoodRow).
  const dock = page.locator('div').filter({
    has: page.getByText(/^(Kcal remaining|Over budget)$/),
  }).filter({ has: page.getByText('Consumed') }).first();
  await expect(dock).toBeVisible();

  const dockBefore = (await dock.innerText()).trim();
  expect(dockBefore.length).toBeGreaterThan(0);

  const dot = page.locator('.food-row').filter({ hasText: name })
    .getByRole('button', { name: /Mark as (not )?eaten/ });
  await dot.tap();
  await expect(dot).toHaveAttribute('aria-pressed', 'true');

  // The dock text MUST be byte-identical: same Kcal remaining, same
  // Consumed, same goal denominators. Any drift means tagging influenced
  // sumMacros — bug.
  const dockAfter = (await dock.innerText()).trim();
  expect(dockAfter).toBe(dockBefore);
});

test('[J-152] tagged flag survives a grams edit', async ({ page }) => {
  // PATCH /entries/:id has separate updateGrams / updateTagged statements;
  // grams-only PATCH must not touch tagged. selectById then re-reads the row
  // and rowToEntry maps r.tagged === 1 back into the response. A mutation
  // that re-derived `tagged: false` after grams-edit (or that mismapped the
  // column) would land here.
  const name = 'E2E Tag Survives';
  await page.goto('/');
  await seedProductAndLog(page, name, MACROS, '100');

  const row = () => page.locator('.food-row').filter({ hasText: name });
  const dot = () => row().getByRole('button', { name: /Mark as (not )?eaten/ });

  await dot().tap();
  await expect(dot()).toHaveAttribute('aria-pressed', 'true');

  // Open edit-mode GramsPicker via the row body button (FoodRow main btn).
  // Index 1 is the main body — index 0 is the dot.
  await row().locator('button').nth(1).tap();
  await page.getByText('Edit amount').waitFor({ state: 'visible' });
  await page.getByRole('spinbutton').fill('250');
  await page.getByRole('button', { name: /Save/ }).tap();

  // Wait for sheet to leave so the row's final accessible name is stable.
  await expect(page.getByText('Edit amount')).toHaveCount(0);

  // Tagged must still be true after the grams change.
  await expect(dot()).toHaveAttribute('aria-pressed', 'true');
  // Sanity: grams updated (100 → 250).
  await expect(row()).toContainText('250g');
});

test('[J-153] two rows tag/untag independently', async ({ page }) => {
  // Pins per-row state isolation — `useEntries.update` finds the entry by id
  // (`list.map(e => e.id === updated.id ? updated : e)`), and a regression
  // that mass-replaced the list (or applied `updated` to all matching
  // products) would flip both rows together.
  const nameA = 'E2E Tag Iso A';
  const nameB = 'E2E Tag Iso B';
  await page.goto('/');
  await seedProductAndLog(page, nameA, MACROS, '100');
  await seedProductAndLog(page, nameB, MACROS, '110');

  const dotA = page.locator('.food-row').filter({ hasText: nameA })
    .getByRole('button', { name: /Mark as (not )?eaten/ });
  const dotB = page.locator('.food-row').filter({ hasText: nameB })
    .getByRole('button', { name: /Mark as (not )?eaten/ });

  await expect(dotA).toHaveAttribute('aria-pressed', 'false');
  await expect(dotB).toHaveAttribute('aria-pressed', 'false');

  await dotA.tap();
  await expect(dotA).toHaveAttribute('aria-pressed', 'true');
  // The other row MUST stay untagged. A bug that propagated `tagged: true`
  // across the list would fail here.
  await expect(dotB).toHaveAttribute('aria-pressed', 'false');

  await dotB.tap();
  await expect(dotB).toHaveAttribute('aria-pressed', 'true');
  await expect(dotA).toHaveAttribute('aria-pressed', 'true');

  // Untag A only: B unchanged.
  await dotA.tap();
  await expect(dotA).toHaveAttribute('aria-pressed', 'false');
  await expect(dotB).toHaveAttribute('aria-pressed', 'true');
});

test('[J-154] dot tap issues exactly one PATCH per toggle (not two)', async ({ page }) => {
  // App.tsx:288-295 — onMarkTagged loops the list and skips entries whose
  // tagged already matches the target (`if (entry.tagged === tagged)
  // continue`). For a single-element array driven by the dot, the skip
  // shouldn't fire on the first tap (state changes); it MUST fire on a
  // re-tap of the SAME button only after the server response lands. This
  // network-counter test pins that the dot is a one-PATCH-per-tap surface
  // and that a regression doubling the request (or duplicating the loop
  // body) lands red.
  const name = 'E2E Tag Counter';
  await page.goto('/');
  await seedProductAndLog(page, name, MACROS, '100');

  let patchCount = 0;
  page.on('request', (req) => {
    if (req.method() !== 'PATCH') return;
    const path = new URL(req.url()).pathname;
    if (/^\/entries\/\d+$/.test(path)) patchCount++;
  });

  const dot = page.locator('.food-row').filter({ hasText: name })
    .getByRole('button', { name: /Mark as (not )?eaten/ });

  // First tap (untagged → tagged) — anchor on the response so we know the
  // request landed before reading the counter.
  await Promise.all([
    page.waitForResponse(
      (r) => /\/entries\/\d+$/.test(new URL(r.url()).pathname)
        && r.request().method() === 'PATCH',
    ),
    dot.tap(),
  ]);
  await expect(dot).toHaveAttribute('aria-pressed', 'true');
  expect(patchCount).toBe(1);

  // Second tap (tagged → untagged) issues a second PATCH because the value
  // is different. Mutation guard: a `===` flipped to `!==` in the loop would
  // skip BOTH taps and leave patchCount at 0.
  await Promise.all([
    page.waitForResponse(
      (r) => /\/entries\/\d+$/.test(new URL(r.url()).pathname)
        && r.request().method() === 'PATCH',
    ),
    dot.tap(),
  ]);
  await expect(dot).toHaveAttribute('aria-pressed', 'false');
  expect(patchCount).toBe(2);
});
