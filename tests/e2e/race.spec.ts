import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fillNutField } from './helpers';

// Modal-hijack guard via App.tsx:163 `flowGenRef`. Three async handlers
// (`onPick`, `onBarcodeDetect`, `onProductSave`) capture the generation
// counter before awaiting and bail in BOTH branches (post-await setModal,
// post-await reportError) if the modal transitioned during the await.
// Without these gates a slow network response would yank the user back into
// a flow they cancelled, or fire a stale error toast for one they aborted.
//
// onBarcodeDetect's gate is the only one not covered here — driving it
// requires camera input, which TEST_MODE doesn't stub. See log.txt MISSING.

// `await waitForResponse(...)` is the throttle's natural completion signal —
// much tighter than waitForTimeout and not flake-prone. After it resolves we
// flush two paint frames so any post-await `setModal` / `reportError` has
// settled before asserting NO modal pop / NO toast: a single rAF would commit
// the state update, the second commits the resulting DOM mutation.
async function flushPaint(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => r())),
      ),
  );
}

// Helpers for cross-user adopt setup, inlined here rather than imported from
// adopt.spec.ts to keep specs decoupled (helpers.ts is intentionally read-only
// for this pass; if a third spec needs the same primitives, promote them).
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

async function seedBarcodedAsUserA(
  request: APIRequestContext,
  name: string,
  barcode: string,
): Promise<{ id: number }> {
  const token = tokenFrom('tests/e2e/.auth/user.json');
  const res = await request.post('/products', {
    headers: { Authorization: `Bearer ${token}` },
    // isProductBaseBody requires brand and is_temp explicitly.
    data: {
      name,
      brand: null,
      barcode,
      unit: 'g',
      is_temp: false,
      per100: { kcal: 200, protein: 10, carbs: 10, fat: 2 },
    },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as { id: number };
}

// ===== onProductSave path (default user A — no cross-user setup) =====

test('[J-047] dismiss mid-save: post-resolution setModal is suppressed', async ({
  page,
}) => {
  await page.goto('/');

  // Throttle the products POST so we have a clear window to dismiss before
  // the server responds. The body still flows through to the real server.
  await page.route('**/products', async (route) => {
    if (route.request().method() === 'POST') {
      await new Promise((r) => setTimeout(r, 1500));
    }
    await route.continue();
  });

  await page.getByRole('button', { name: 'ADD FOOD' }).tap();
  await page.getByRole('button', { name: 'Add New' }).tap();
  await page
    .getByPlaceholder('e.g. Peanut Butter')
    .fill(`E2E Race Save ${Date.now()}`);
  await fillNutField(page, 'Kcal', '100');
  await fillNutField(page, 'Protein', '10');
  await fillNutField(page, 'Carbs', '10');
  await fillNutField(page, 'Fat', '2');

  // Tap Save → POST is in-flight, server held for ~1500ms.
  await page.getByRole('button', { name: /Save & Continue/ }).tap();

  // Backdrop dismiss while POST pends. closeModal flips modal=none and bumps
  // flowGenRef. dispatchEvent bypasses pointer-event interception by the
  // sheet that visually covers most of the overlay on the mobile viewport.
  await page.locator('.overlay').first().dispatchEvent('click');

  // Wait for the throttled POST to actually complete — the buggy code path
  // (no flowGenRef gate) would synchronously setModal(grams-picker) on the
  // microtask after this returns.
  await page.waitForResponse(
    (res) =>
      new URL(res.url()).pathname === '/products' &&
      res.request().method() === 'POST',
  );
  await flushPaint(page);

  // GramsPicker would render 'How much?' on hijack. With the fix, the sheet
  // stack is fully empty: NewProductForm dismissed, GramsPicker bailed.
  await expect(page.locator('.sheet')).toHaveCount(0);
  await expect(page.getByText('How much?')).toHaveCount(0);
});

test('[J-113] no dismissal: slow product save still opens GramsPicker (positive control)', async ({
  page,
}) => {
  // Pins the comparator direction at App.tsx:399 (`if (myGen !== ...) return`).
  // Without this anchor a mutation flipping `!==` to `===` would silently bail
  // on the happy path too — and J-047 would still pass (false security).
  await page.goto('/');

  await page.route('**/products', async (route) => {
    if (route.request().method() === 'POST') {
      await new Promise((r) => setTimeout(r, 800));
    }
    await route.continue();
  });

  await page.getByRole('button', { name: 'ADD FOOD' }).tap();
  await page.getByRole('button', { name: 'Add New' }).tap();
  await page
    .getByPlaceholder('e.g. Peanut Butter')
    .fill(`E2E Race Happy ${Date.now()}`);
  await fillNutField(page, 'Kcal', '120');
  await fillNutField(page, 'Protein', '8');
  await fillNutField(page, 'Carbs', '14');
  await fillNutField(page, 'Fat', '3');
  await page.getByRole('button', { name: /Save & Continue/ }).tap();

  // No dismissal: when POST resolves, modal is still NewProductForm.
  // flowGenRef unchanged → gen check passes → setModal(grams-picker) fires.
  await page.waitForResponse(
    (res) =>
      new URL(res.url()).pathname === '/products' &&
      res.request().method() === 'POST',
  );
  await page.getByText('How much?').waitFor({ state: 'visible' });
});

test('[J-114] dismiss mid-save + server 500: error toast is suppressed', async ({
  page,
}) => {
  // Pins App.tsx:402 catch-branch gate. Throttle to give the dismiss window,
  // then 500 with a known body — App.tsx:507 renders transientError verbatim
  // so we can assert that exact string never lands on screen.
  await page.goto('/');

  await page.route('**/products', async (route) => {
    if (route.request().method() === 'POST') {
      await new Promise((r) => setTimeout(r, 1200));
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'race-toast-suppressed' }),
      });
      return;
    }
    await route.continue();
  });

  await page.getByRole('button', { name: 'ADD FOOD' }).tap();
  await page.getByRole('button', { name: 'Add New' }).tap();
  await page
    .getByPlaceholder('e.g. Peanut Butter')
    .fill(`E2E Race Err ${Date.now()}`);
  await fillNutField(page, 'Kcal', '110');
  await fillNutField(page, 'Protein', '9');
  await fillNutField(page, 'Carbs', '11');
  await fillNutField(page, 'Fat', '2');
  await page.getByRole('button', { name: /Save & Continue/ }).tap();

  // Dismiss while pending.
  await page.locator('.overlay').first().dispatchEvent('click');

  await page.waitForResponse(
    (res) =>
      new URL(res.url()).pathname === '/products' &&
      res.request().method() === 'POST' &&
      res.status() === 500,
  );
  await flushPaint(page);

  // Without the catch-branch gate the toast would render the error body. The
  // unique sentinel ensures we're matching THIS toast and not stray text.
  await expect(page.getByText('race-toast-suppressed')).toHaveCount(0);
  // Stack also empty — modal was dismissed and never reopened by the catch.
  await expect(page.locator('.sheet')).toHaveCount(0);
});

test('[J-117] no dismissal: server 500 DOES surface the error toast (positive control)', async ({
  page,
}) => {
  // Counterpart to J-114. Pins that the catch-branch IS reached on a normal
  // error — without this anchor a mutation that always bails (e.g. `if (true)
  // return`) would still pass J-114 silently. Also asserts the App.tsx
  // promise that the form stays mounted for retry on save failure.
  await page.goto('/');

  await page.route('**/products', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'race-toast-surfaced' }),
      });
      return;
    }
    await route.continue();
  });

  await page.getByRole('button', { name: 'ADD FOOD' }).tap();
  await page.getByRole('button', { name: 'Add New' }).tap();
  await page
    .getByPlaceholder('e.g. Peanut Butter')
    .fill(`E2E Race ErrShow ${Date.now()}`);
  await fillNutField(page, 'Kcal', '100');
  await fillNutField(page, 'Protein', '5');
  await fillNutField(page, 'Carbs', '12');
  await fillNutField(page, 'Fat', '3');
  await page.getByRole('button', { name: /Save & Continue/ }).tap();

  // No dismissal — the toast text is the body.error string verbatim.
  await expect(page.getByText('race-toast-surfaced')).toBeVisible();
  // Modal stays mounted per the App.tsx promise: "Leave the modal open so
  // the user can retry; 401 is handled by api.ts." Confirms the catch
  // returned without closing — important for the retry UX guarantee.
  await expect(page.getByPlaceholder('e.g. Peanut Butter')).toBeVisible();
});

// ===== onPick path (cross-user adopt; user B drives, user A seeds) =====

test.describe('cross-user adopt race', () => {
  test.use({ storageState: 'tests/e2e/.auth/user2.json' });

  test('[J-115] dismiss mid-adopt: post-resolution setModal is suppressed', async ({
    page,
    request,
  }) => {
    // Cross-user search → tap result → onPick auto-POSTs /products/adopt/:id.
    // App.tsx:308 gates the post-await setModal({grams-picker, ...}).
    const name = `E2E Race Adopt ${Date.now()}`;
    const barcode = `760${Date.now()}`;
    await seedBarcodedAsUserA(request, name, barcode);

    await page.goto('/');

    // Throttle adopt only — the search must resolve fast or the tap target
    // never materializes for user B.
    await page.route('**/products/adopt/*', async (route) => {
      if (route.request().method() === 'POST') {
        await new Promise((r) => setTimeout(r, 1500));
      }
      await route.continue();
    });

    await page.getByRole('button', { name: 'ADD FOOD' }).tap();
    // Cross-user search needs the Global scope toggle (AddPicker.tsx:185) so
    // the request carries ?global=1 and statements.ts surfaces user A's row.
    await page.getByRole('button', { name: 'Global', exact: true }).tap();
    await page.getByPlaceholder('Search products...').fill(name);

    const picker = page
      .locator('.sheet')
      .filter({ has: page.getByPlaceholder('Search products...') });
    // Tap fires onPick → /products/adopt/:id POST in flight (throttled).
    await picker.getByText(name).first().tap();

    // Dismiss while pending — flowGenRef bumps, post-resolution gen check
    // bails before the spurious setModal runs.
    await page.locator('.overlay').first().dispatchEvent('click');

    await page.waitForResponse(
      (res) =>
        new URL(res.url()).pathname.startsWith('/products/adopt/') &&
        res.request().method() === 'POST',
    );
    await flushPaint(page);

    await expect(page.locator('.sheet')).toHaveCount(0);
    await expect(page.getByText('How much?')).toHaveCount(0);
  });

  test('[J-116] dismiss mid-adopt + server 500: error toast is suppressed', async ({
    page,
    request,
  }) => {
    // Pins App.tsx:311 catch-branch gate for onPick. Same throttle+fulfill
    // pattern as J-114 but on the adopt endpoint.
    const name = `E2E Race Adopt Err ${Date.now()}`;
    const barcode = `761${Date.now()}`;
    await seedBarcodedAsUserA(request, name, barcode);

    await page.goto('/');

    await page.route('**/products/adopt/*', async (route) => {
      if (route.request().method() === 'POST') {
        await new Promise((r) => setTimeout(r, 1200));
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'race-adopt-toast-suppressed' }),
        });
        return;
      }
      await route.continue();
    });

    await page.getByRole('button', { name: 'ADD FOOD' }).tap();
    await page.getByRole('button', { name: 'Global', exact: true }).tap();
    await page.getByPlaceholder('Search products...').fill(name);
    const picker = page
      .locator('.sheet')
      .filter({ has: page.getByPlaceholder('Search products...') });
    await picker.getByText(name).first().tap();

    await page.locator('.overlay').first().dispatchEvent('click');

    await page.waitForResponse(
      (res) =>
        new URL(res.url()).pathname.startsWith('/products/adopt/') &&
        res.request().method() === 'POST' &&
        res.status() === 500,
    );
    await flushPaint(page);

    await expect(page.getByText('race-adopt-toast-suppressed')).toHaveCount(0);
    await expect(page.locator('.sheet')).toHaveCount(0);
  });
});
