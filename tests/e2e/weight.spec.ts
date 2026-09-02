import { expect, test, type APIRequestContext } from '@playwright/test';
import { signInFresh } from './helpers';

test.use({ storageState: { cookies: [], origins: [] } });

const FIXED_NOW = new Date(2031, 4, 6, 9, 30);
const TODAY = '2031-05-06';

async function bearerFromPage(page: import('@playwright/test').Page): Promise<string> {
  const token = await page.evaluate(() => localStorage.getItem('kcal_session_token'));
  expect(token).not.toBeNull();
  return token!;
}

async function createApiUser(request: APIRequestContext, prefix: string): Promise<string> {
  const email = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;
  const requested = await request.post('/auth/request-code', { data: { email } });
  expect(requested.ok(), await requested.text()).toBeTruthy();
  const codeResponse = await request.get(`/auth/test/last-code/${email}`);
  expect(codeResponse.ok(), await codeResponse.text()).toBeTruthy();
  const { code } = (await codeResponse.json()) as { code: string };
  const verified = await request.post('/auth/verify-code', { data: { email, code } });
  expect(verified.ok(), await verified.text()).toBeTruthy();
  const data = (await verified.json()) as { session_token: string };
  return data.session_token;
}

async function createWeight(
  request: APIRequestContext,
  token: string,
  data: { local_date: string; weight_kg: number; note: string | null },
) {
  const response = await request.post('/weights', {
    headers: { Authorization: `Bearer ${token}` },
    data,
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()) as {
    id: number;
    local_date: string;
    weight_kg: number;
    note: string | null;
  };
}

async function openWeights(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Weights', exact: true }).tap();
  await expect(page.getByText('Weight history', { exact: true })).toBeVisible();
}

test('[J-181] bottom-dock Weights action opens the empty history', async ({ page, request }) => {
  await signInFresh(page, request, 'weight-empty');

  const weightsButton = page.getByRole('button', { name: 'Weights', exact: true });
  await expect(weightsButton).toBeVisible();
  await openWeights(page);

  await expect(page.getByText('No weigh-ins yet', { exact: true })).toBeVisible();
  await expect(page.locator('.weight-row')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add weight', exact: true })).toBeEnabled();
});

test('[J-182] add defaults to today and persists a full safe note without time', async ({
  page,
  request,
}) => {
  await page.clock.setFixedTime(FIXED_NOW);
  await signInFresh(page, request, 'weight-add');
  page.on('dialog', async (dialog) => {
    await dialog.dismiss();
    throw new Error(`unexpected dialog: ${dialog.message()}`);
  });

  await openWeights(page);
  await page.getByRole('button', { name: 'Add weight', exact: true }).tap();
  await expect(page.getByText('Add weight', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Date')).toHaveValue(TODAY);

  const note = 'I did poop before the weigh-in\n<script>alert(1)</script> end of note';
  await page.getByRole('spinbutton', { name: 'Weight', exact: true }).fill('82.4');
  await page.getByLabel('Note').fill(note);
  await page.getByRole('button', { name: 'Add weigh-in', exact: true }).tap();

  const row = page.locator('.weight-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('82.4 kg');
  await expect(row).toContainText('06 MAY 2031');
  await expect(row).toContainText('I did poop before the weigh-in');
  await expect(row).toContainText('<script>alert(1)</script> end of note');
  await expect(row).not.toContainText(/\d{2}:\d{2}/);

  await page.reload();
  await openWeights(page);
  await expect(page.locator('.weight-row')).toContainText('82.4 kg');
  await expect(page.locator('.weight-row')).toContainText('end of note');
});

test('[J-183] future and note-free records sort first; Add edits today once occupied', async ({
  page,
  request,
}) => {
  await page.clock.setFixedTime(FIXED_NOW);
  await signInFresh(page, request, 'weight-order');
  await openWeights(page);

  // Add a future record first. Future dates are deliberately accepted.
  await page.getByRole('button', { name: 'Add weight', exact: true }).tap();
  await page.getByLabel('Date').fill('2031-05-10');
  await page.getByRole('spinbutton', { name: 'Weight', exact: true }).fill('81');
  await page.getByRole('button', { name: 'Add weigh-in', exact: true }).tap();

  // Add again: today is still empty, so the form defaults back to today.
  await page.getByRole('button', { name: 'Add weight', exact: true }).tap();
  await expect(page.getByLabel('Date')).toHaveValue(TODAY);
  await page.getByRole('spinbutton', { name: 'Weight', exact: true }).fill('82.1');
  await page.getByRole('button', { name: 'Add weigh-in', exact: true }).tap();

  const rows = page.locator('.weight-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('10 MAY 2031');
  await expect(rows.nth(0)).toContainText('81.0 kg');
  await expect(rows.nth(1)).toContainText('06 MAY 2031');
  await expect(rows.nth(1)).toContainText('82.1 kg');

  // Today's unique record exists now, so Add routes to it instead of create.
  await page.getByRole('button', { name: 'Add weight', exact: true }).tap();
  await expect(page.getByText('Edit weight', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Date')).toHaveValue(TODAY);
  await expect(page.getByRole('spinbutton', { name: 'Weight', exact: true })).toHaveValue('82.1');
});

test('[J-184] editing all fields updates one row, reorders, and persists', async ({
  page,
  request,
}) => {
  await page.clock.setFixedTime(FIXED_NOW);
  await signInFresh(page, request, 'weight-edit');
  const token = await bearerFromPage(page);
  await createWeight(request, token, {
    local_date: '2031-05-01',
    weight_kg: 84.2,
    note: 'clear me',
  });
  await createWeight(request, token, {
    local_date: '2031-05-03',
    weight_kg: 83.5,
    note: null,
  });

  await openWeights(page);
  await page.getByRole('button', { name: 'Edit weigh-in for 2031-05-01' }).tap();
  await page.getByLabel('Date').fill('2031-05-05');
  await page.getByRole('spinbutton', { name: 'Weight', exact: true }).fill('82.9');
  await page.getByLabel('Note').fill('');
  await page.getByRole('button', { name: 'Save', exact: true }).tap();

  let rows = page.locator('.weight-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('05 MAY 2031');
  await expect(rows.nth(0)).toContainText('82.9 kg');
  await expect(rows.nth(0)).not.toContainText('clear me');
  await expect(page.getByText('01 MAY 2031', { exact: true })).toHaveCount(0);

  await page.reload();
  await openWeights(page);
  rows = page.locator('.weight-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('05 MAY 2031');
  await expect(rows.nth(0)).toContainText('82.9 kg');
});

test('[J-185] one delete tap removes only its record and persists', async ({ page, request }) => {
  await signInFresh(page, request, 'weight-delete');
  const token = await bearerFromPage(page);
  await createWeight(request, token, {
    local_date: '2031-04-01',
    weight_kg: 85,
    note: 'delete me',
  });
  await createWeight(request, token, {
    local_date: '2031-04-02',
    weight_kg: 84.8,
    note: 'keep me',
  });

  await openWeights(page);
  await page.getByRole('button', { name: 'Edit weigh-in for 2031-04-01' }).tap();
  const [deleted] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === 'DELETE' && new URL(response.url()).pathname.startsWith('/weights/'),
    ),
    page.getByRole('button', { name: 'Delete weigh-in', exact: true }).tap(),
  ]);
  expect(deleted.ok()).toBeTruthy();

  await expect(page.getByText('Weight history', { exact: true })).toBeVisible();
  await expect(page.locator('.weight-row')).toHaveCount(1);
  await expect(page.locator('.weight-row')).toContainText('keep me');
  await expect(page.getByText('delete me', { exact: true })).toHaveCount(0);

  await page.reload();
  await openWeights(page);
  await expect(page.locator('.weight-row')).toHaveCount(1);
  await expect(page.locator('.weight-row')).toContainText('keep me');
});

test('[J-186] validation and Cancel prevent writes; a failed save keeps the draft', async ({
  page,
  request,
}) => {
  await page.clock.setFixedTime(FIXED_NOW);
  await signInFresh(page, request, 'weight-validation');
  await openWeights(page);
  await page.getByRole('button', { name: 'Add weight', exact: true }).tap();

  const submit = page.getByRole('button', { name: 'Add weigh-in', exact: true });
  await expect(submit).toBeDisabled();
  await page.getByRole('spinbutton', { name: 'Weight', exact: true }).fill('82.45');
  await expect(page.getByText(/one decimal at most/)).toBeVisible();
  await expect(submit).toBeDisabled();

  await page.getByRole('spinbutton', { name: 'Weight', exact: true }).fill('82.4');
  await page.getByLabel('Note').fill('cancelled draft');
  await page.getByRole('button', { name: 'Cancel', exact: true }).tap();
  await expect(page.locator('.weight-row')).toHaveCount(0);

  await page.getByRole('button', { name: 'Add weight', exact: true }).tap();
  await page.getByLabel('Date').fill('2031-06-01');
  await page.getByRole('spinbutton', { name: 'Weight', exact: true }).fill('80.3');
  await page.getByLabel('Note').fill('keep this draft');
  await page.route('**/weights', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' });
      return;
    }
    await route.continue();
  });
  await submit.tap();

  await expect(page.getByText("Couldn't save this weigh-in. Try again.")).toBeVisible();
  await expect(page.getByLabel('Date')).toHaveValue('2031-06-01');
  await expect(page.getByRole('spinbutton', { name: 'Weight', exact: true })).toHaveValue('80.3');
  await expect(page.getByLabel('Note')).toHaveValue('keep this draft');
});

test('[J-187] API validates, rejects collisions, and isolates users', async ({ page, request }) => {
  await signInFresh(page, request, 'weight-api-owner');
  const ownerToken = await bearerFromPage(page);
  const auth = { Authorization: `Bearer ${ownerToken}` };
  const first = await createWeight(request, ownerToken, {
    local_date: TODAY,
    weight_kg: 82.4,
    note: '  normalized note  ',
  });

  const duplicate = await request.post('/weights', {
    headers: auth,
    data: { local_date: TODAY, weight_kg: 81.9, note: null },
  });
  expect(duplicate.status()).toBe(409);
  expect(await duplicate.json()).toEqual({ error: 'weight_exists' });

  for (const data of [
    { local_date: TODAY, weight_kg: 0, note: null },
    { local_date: TODAY, weight_kg: 1000.1, note: null },
    { local_date: TODAY, weight_kg: 82.45, note: null },
    { local_date: 'not-a-date', weight_kg: 82.4, note: null },
    { local_date: '2031-05-07', weight_kg: 82.4, note: 'x'.repeat(501) },
    { local_date: '2031-05-07', weight_kg: 82.4 },
  ]) {
    const response = await request.post('/weights', { headers: auth, data });
    expect(response.status(), JSON.stringify(data)).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_weight' });
  }

  for (const bad of ['0', '-1', 'abc']) {
    const response = await request.delete(`/weights/${bad}`, { headers: auth });
    expect(response.status(), bad).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_id' });
  }

  const second = await createWeight(request, ownerToken, {
    local_date: '2031-05-07',
    weight_kg: 82,
    note: null,
  });
  const moveOntoFirst = await request.put(`/weights/${second.id}`, {
    headers: auth,
    data: { local_date: TODAY, weight_kg: 81.8, note: null },
  });
  expect(moveOntoFirst.status()).toBe(409);
  expect(await moveOntoFirst.json()).toEqual({ error: 'weight_exists' });

  const otherToken = await createApiUser(request, 'weight-api-other');
  const otherAuth = { Authorization: `Bearer ${otherToken}` };
  const otherList = await request.get('/weights', { headers: otherAuth });
  expect(await otherList.json()).toEqual([]);

  const foreignUpdate = await request.put(`/weights/${first.id}`, {
    headers: otherAuth,
    data: { local_date: TODAY, weight_kg: 60, note: null },
  });
  expect(foreignUpdate.status()).toBe(404);
  expect(await foreignUpdate.json()).toEqual({ error: 'not_found' });
  const foreignDelete = await request.delete(`/weights/${first.id}`, { headers: otherAuth });
  expect(foreignDelete.status()).toBe(404);
  expect(await foreignDelete.json()).toEqual({ error: 'not_found' });

  const ownerList = await request.get('/weights', { headers: auth });
  expect(ownerList.ok()).toBeTruthy();
  const ownerRows = (await ownerList.json()) as Array<{
    id: number;
    local_date: string;
    weight_kg: number;
    note: string | null;
  }>;
  expect(ownerRows).toHaveLength(2);
  expect(ownerRows.find((row) => row.id === first.id)).toEqual({
    id: first.id,
    local_date: TODAY,
    weight_kg: 82.4,
    note: 'normalized note',
  });
});
