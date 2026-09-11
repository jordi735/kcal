import { expect, test, type APIRequestContext } from '@playwright/test';
import Database from 'better-sqlite3';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { WeightEntry } from '../../shared/types';
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
  data: {
    local_date: string;
    weight_kg: number;
    note: string | null;
    peed?: boolean;
    pooped?: boolean;
  },
) {
  const response = await request.post('/weights', {
    headers: { Authorization: `Bearer ${token}` },
    data,
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()) as WeightEntry;
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

test('[J-182] add defaults to today and peed only, preserving a full safe note without time', async ({
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
  const beforeWeighIn = page.locator('.sheet').getByRole('group', { name: 'Before weigh-in', exact: true });
  await expect(beforeWeighIn).toBeVisible();
  await expect(beforeWeighIn.getByRole('checkbox', { name: 'Peed', exact: true })).toBeChecked();
  await expect(beforeWeighIn.getByRole('checkbox', { name: 'Pooped', exact: true })).not.toBeChecked();

  const note = 'I did poop before the weigh-in\n<script>alert(1)</script> end of note';
  await page.getByRole('spinbutton', { name: 'Weight', exact: true }).fill('82.4');
  await page.getByLabel('Note').fill(note);
  await page.getByRole('button', { name: 'Add weigh-in', exact: true }).tap();

  const row = page.locator('.weight-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('82.4 kg');
  await expect(row).toContainText('06 MAY 2031');
  await expect(row).toContainText('Peed: Yes · Pooped: No');
  await expect(row).toContainText('I did poop before the weigh-in');
  await expect(row).toContainText('<script>alert(1)</script> end of note');
  await expect(row).not.toContainText(/\d{2}:\d{2}/);

  await page.reload();
  await openWeights(page);
  await expect(page.locator('.weight-row')).toContainText('82.4 kg');
  await expect(page.locator('.weight-row')).toContainText('Peed: Yes · Pooped: No');
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
  await page.locator('.sheet').getByRole('checkbox', { name: 'Peed', exact: true }).tap();
  await page.locator('.sheet').getByRole('checkbox', { name: 'Pooped', exact: true }).tap();
  await page.getByRole('button', { name: 'Add weigh-in', exact: true }).tap();

  const rows = page.locator('.weight-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('10 MAY 2031');
  await expect(rows.nth(0)).toContainText('81.0 kg');
  await expect(rows.nth(1)).toContainText('06 MAY 2031');
  await expect(rows.nth(1)).toContainText('82.1 kg');
  await expect(rows.nth(1)).toContainText('Peed: No · Pooped: Yes');

  // Today's unique record exists now, so Add routes to it instead of create.
  await page.getByRole('button', { name: 'Add weight', exact: true }).tap();
  await expect(page.getByText('Edit weight', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Date')).toHaveValue(TODAY);
  await expect(page.getByRole('spinbutton', { name: 'Weight', exact: true })).toHaveValue('82.1');
  await expect(page.locator('.sheet').getByRole('checkbox', { name: 'Peed', exact: true })).not.toBeChecked();
  await expect(page.locator('.sheet').getByRole('checkbox', { name: 'Pooped', exact: true })).toBeChecked();
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
    peed: false,
    pooped: true,
  });
  await createWeight(request, token, {
    local_date: '2031-05-03',
    weight_kg: 83.5,
    note: null,
  });

  await openWeights(page);
  await page.getByRole('button', { name: 'Edit weigh-in for 2031-05-01' }).tap();
  const peed = page.locator('.sheet').getByRole('checkbox', { name: 'Peed', exact: true });
  const pooped = page.locator('.sheet').getByRole('checkbox', { name: 'Pooped', exact: true });
  await expect(peed).not.toBeChecked();
  await expect(pooped).toBeChecked();
  await peed.tap();
  await pooped.tap();
  await page.getByLabel('Date').fill('2031-05-05');
  await page.getByRole('spinbutton', { name: 'Weight', exact: true }).fill('82.9');
  await page.getByLabel('Note').fill('');
  await page.getByRole('button', { name: 'Save', exact: true }).tap();

  let rows = page.locator('.weight-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('05 MAY 2031');
  await expect(rows.nth(0)).toContainText('82.9 kg');
  await expect(rows.nth(0)).toContainText('Peed: Yes · Pooped: No');
  await expect(rows.nth(0)).not.toContainText('clear me');
  await expect(page.getByText('01 MAY 2031', { exact: true })).toHaveCount(0);

  await page.reload();
  await openWeights(page);
  rows = page.locator('.weight-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('05 MAY 2031');
  await expect(rows.nth(0)).toContainText('82.9 kg');
  await expect(rows.nth(0)).toContainText('Peed: Yes · Pooped: No');
  await rows.nth(0).tap();
  await expect(peed).toBeChecked();
  await expect(pooped).not.toBeChecked();
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

  const sheet = page.locator('.sheet');
  const weight = sheet.getByRole('spinbutton', { name: 'Weight', exact: true });
  const note = sheet.getByLabel('Note', { exact: true });
  const weightError = sheet.getByText('Use 0.1–1000.0 kg with one decimal at most.', { exact: true });
  const submit = sheet.getByRole('button', { name: 'Add weigh-in', exact: true });
  await expect(weight).toBeEmpty();
  await expect(submit).toBeDisabled();
  await expect(weightError).toHaveCount(0);

  // Bounds are inclusive; precision applies to the numeric value, so an
  // extra trailing zero is accepted without rounding a more precise value.
  for (const value of ['0.1', '1000', '82.40']) {
    await weight.fill(value);
    await expect(submit, value).toBeEnabled();
    await expect(weightError).toHaveCount(0);
  }
  for (const value of ['0', '1000.1', '82.45']) {
    await weight.fill(value);
    await expect(weightError, value).toBeVisible();
    await expect(submit, value).toBeDisabled();
  }
  await weight.fill('');
  await expect(weight).toBeEmpty();
  await expect(submit).toBeDisabled();
  await expect(weightError).toHaveCount(0);

  await weight.fill('82.4');
  const maxNote = 'x'.repeat(500);
  await expect(note).toHaveAttribute('maxlength', '500');
  await note.fill(maxNote);
  await expect(note).toHaveValue(maxNote);
  await expect(sheet.getByText('500/500', { exact: true })).toBeVisible();
  await expect(submit).toBeEnabled();

  // Reach the form guard past the browser's maxlength protection. The UI
  // counts raw characters; REST accepts this note after trimming its spaces.
  const paddedNote = ` ${maxNote} `;
  await note.evaluate((element, value) => {
    (element as HTMLTextAreaElement).value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }, paddedNote);
  await expect(note).toHaveValue(paddedNote);
  await expect(sheet.getByText('502/500', { exact: true })).toBeVisible();
  await expect(submit).toBeDisabled();

  await note.fill('cancelled draft');
  await expect(submit).toBeEnabled();
  const peed = page.locator('.sheet').getByRole('checkbox', { name: 'Peed', exact: true });
  const pooped = page.locator('.sheet').getByRole('checkbox', { name: 'Pooped', exact: true });
  await peed.tap();
  await pooped.tap();
  await page.getByRole('button', { name: 'Cancel', exact: true }).tap();
  await expect(page.locator('.weight-row')).toHaveCount(0);
  const cancelledHistory = await request.get('/weights', {
    headers: { Authorization: `Bearer ${await bearerFromPage(page)}` },
  });
  expect(cancelledHistory.ok()).toBeTruthy();
  expect(await cancelledHistory.json()).toEqual([]);

  await page.getByRole('button', { name: 'Add weight', exact: true }).tap();
  await expect(peed).toBeChecked();
  await expect(pooped).not.toBeChecked();
  await expect(page.getByLabel('Note')).toBeEmpty();
  await page.getByLabel('Date').fill('2031-06-01');
  await page.getByRole('spinbutton', { name: 'Weight', exact: true }).fill('80.3');
  await page.getByLabel('Note').fill('keep this draft');
  await peed.tap();
  await pooped.tap();
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
  await expect(peed).not.toBeChecked();
  await expect(pooped).toBeChecked();

  await page.unroute('**/weights');
  await submit.tap();
  await expect(page.locator('.weight-row')).toHaveCount(1);
  await expect(page.locator('.weight-row')).toContainText('Peed: No · Pooped: Yes');
  await expect(page.locator('.weight-row')).toContainText('keep this draft');
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
  const minimum = await createWeight(request, ownerToken, {
    local_date: '2031-05-08',
    weight_kg: 0.1,
    note: ' \n\t ',
  });
  expect(minimum).toMatchObject({ weight_kg: 0.1, note: null });
  const maxNote = 'x'.repeat(500);
  const maximum = await createWeight(request, ownerToken, {
    local_date: '2031-05-09',
    weight_kg: 1000,
    note: ` ${maxNote} `,
  });
  expect(maximum).toMatchObject({ weight_kg: 1000, note: maxNote });

  const duplicate = await request.post('/weights', {
    headers: auth,
    data: { local_date: TODAY, weight_kg: 81.9, note: null },
  });
  expect(duplicate.status()).toBe(409);
  expect(await duplicate.json()).toEqual({ error: 'weight_exists' });

  const beforeInvalid = await request.get('/weights', { headers: auth });
  expect(beforeInvalid.ok()).toBeTruthy();
  const beforeInvalidRows = await beforeInvalid.json();
  for (const data of [
    { local_date: TODAY, weight_kg: 0, note: null },
    { local_date: TODAY, weight_kg: 0.09, note: null },
    { local_date: TODAY, weight_kg: 1000.1, note: null },
    { local_date: TODAY, weight_kg: 82.45, note: null },
    { local_date: TODAY, weight_kg: '', note: null },
    { local_date: TODAY, weight_kg: ' ', note: null },
    { local_date: TODAY, weight_kg: '82.4', note: null },
    { local_date: TODAY, weight_kg: null, note: null },
    { local_date: 'not-a-date', weight_kg: 82.4, note: null },
    { local_date: '2031-05-07', weight_kg: 82.4, note: 'x'.repeat(501) },
    { local_date: '2031-05-07', weight_kg: 82.4, note: ` ${'x'.repeat(501)} ` },
    { local_date: '2031-05-07', weight_kg: 82.4 },
  ]) {
    for (const method of ['post', 'put'] as const) {
      const response = await request[method](method === 'post' ? '/weights' : `/weights/${first.id}`, {
        headers: auth, data,
      });
      expect(response.status(), `${method} ${JSON.stringify(data)}`).toBe(400);
      expect(await response.json()).toEqual({ error: 'invalid_weight' });
    }
  }
  const afterInvalid = await request.get('/weights', { headers: auth });
  expect(afterInvalid.ok()).toBeTruthy();
  expect(await afterInvalid.json()).toEqual(beforeInvalidRows);

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
    data: { local_date: TODAY, weight_kg: 60, note: null, peed: false, pooped: true },
  });
  expect(foreignUpdate.status()).toBe(404);
  expect(await foreignUpdate.json()).toEqual({ error: 'not_found' });
  const foreignDelete = await request.delete(`/weights/${first.id}`, { headers: otherAuth });
  expect(foreignDelete.status()).toBe(404);
  expect(await foreignDelete.json()).toEqual({ error: 'not_found' });

  const ownerList = await request.get('/weights', { headers: auth });
  expect(ownerList.ok()).toBeTruthy();
  const ownerRows = (await ownerList.json()) as WeightEntry[];
  expect(ownerRows).toHaveLength(4);
  expect(ownerRows.find((row) => row.id === minimum.id)).toEqual(minimum);
  expect(ownerRows.find((row) => row.id === maximum.id)).toEqual(maximum);
  expect(ownerRows.find((row) => row.id === first.id)).toEqual({
    id: first.id,
    local_date: TODAY,
    weight_kg: 82.4,
    note: 'normalized note',
    peed: true,
    pooped: false,
  });
});

test('[J-215] weigh-in checkboxes toggle independently, persist all combinations, and reset for new dates', async ({
  page,
  request,
}) => {
  await page.clock.setFixedTime(FIXED_NOW);
  await signInFresh(page, request, 'weight-checkboxes');
  await openWeights(page);

  const sheet = page.locator('.sheet');
  const peed = sheet.getByRole('checkbox', { name: 'Peed', exact: true });
  const pooped = sheet.getByRole('checkbox', { name: 'Pooped', exact: true });
  const records = [
    { local_date: '2031-05-08', peed: true, pooped: true },
    { local_date: '2031-05-09', peed: false, pooped: false },
    { local_date: '2031-05-03', peed: false, pooped: true },
    { local_date: '2031-05-02', peed: true, pooped: false },
  ];
  const description = (record: { peed: boolean; pooped: boolean }) =>
    `Peed: ${record.peed ? 'Yes' : 'No'} · Pooped: ${record.pooped ? 'Yes' : 'No'}`;

  for (const record of records) {
    await sheet.getByRole('button', { name: 'Add weight', exact: true }).tap();
    await expect(sheet.getByLabel('Date')).toHaveValue(TODAY);
    await expect(peed).toBeChecked();
    await expect(pooped).not.toBeChecked();
    await sheet.getByLabel('Date').fill(record.local_date);
    await sheet.getByRole('spinbutton', { name: 'Weight', exact: true }).fill('82.4');
    await expect(peed).toBeChecked();
    await expect(pooped).not.toBeChecked();

    if (!record.peed) {
      await peed.tap();
      await expect(peed).not.toBeChecked();
      await expect(pooped).not.toBeChecked();
    }
    if (record.pooped) {
      await pooped.tap();
      await expect(pooped).toBeChecked();
      await expect(peed).toBeChecked({ checked: record.peed });
    }

    const [saved] = await Promise.all([
      page.waitForResponse((response) =>
        response.request().method() === 'POST' && new URL(response.url()).pathname === '/weights'),
      sheet.getByRole('button', { name: 'Add weigh-in', exact: true }).tap(),
    ]);
    expect(saved.status()).toBe(201);
    expect(saved.request().postDataJSON()).toEqual({ ...record, weight_kg: 82.4, note: null });
    await expect(sheet.getByRole('button', { name: `Edit weigh-in for ${record.local_date}`, exact: true }))
      .toContainText(description(record));
  }

  await page.reload();
  await openWeights(page);
  await expect(page.locator('.weight-row')).toHaveCount(4);
  for (const record of records) {
    const row = sheet.getByRole('button', { name: `Edit weigh-in for ${record.local_date}`, exact: true });
    await expect(row).toContainText(description(record));
    await row.tap();
    await expect(peed).toBeChecked({ checked: record.peed });
    await expect(pooped).toBeChecked({ checked: record.pooped });
    await peed.tap();
    await pooped.tap();
    await sheet.getByRole('button', { name: 'Cancel', exact: true }).tap();
    await expect(row).toContainText(description(record));
    await row.tap();
    await expect(peed).toBeChecked({ checked: record.peed });
    await expect(pooped).toBeChecked({ checked: record.pooped });
    await sheet.getByRole('button', { name: 'Cancel', exact: true }).tap();
  }
});

test('[J-216] weight API defaults omitted checkboxes, preserves omitted edits, and rejects non-booleans atomically', async ({ request }) => {
  const token = await createApiUser(request, 'weight-checkbox-api');
  const headers = { Authorization: `Bearer ${token}` };
  const legacy = await createWeight(request, token, {
    local_date: '2031-05-01', weight_kg: 82.4, note: 'legacy client',
  });
  expect(legacy).toMatchObject({ peed: true, pooped: false });
  const explicit = await createWeight(request, token, {
    local_date: '2031-05-02', weight_kg: 82.1, note: null, peed: false, pooped: true,
  });
  expect(explicit).toMatchObject({ peed: false, pooped: true });
  expect(await createWeight(request, token, {
    local_date: '2031-05-03', weight_kg: 82, note: null, peed: false,
  })).toMatchObject({ peed: false, pooped: false });
  expect(await createWeight(request, token, {
    local_date: '2031-05-04', weight_kg: 81.9, note: null, pooped: true,
  })).toMatchObject({ peed: true, pooped: true });

  const edit = { local_date: '2031-05-10', weight_kg: 81.8, note: 'changed by older client' };
  const legacyUpdate = await request.put(`/weights/${explicit.id}`, { headers, data: edit });
  expect(legacyUpdate.ok(), await legacyUpdate.text()).toBeTruthy();
  expect(await legacyUpdate.json()).toEqual({ id: explicit.id, ...edit, peed: false, pooped: true });

  const peedUpdate = await request.put(`/weights/${explicit.id}`, { headers, data: { ...edit, peed: true } });
  expect(peedUpdate.ok(), await peedUpdate.text()).toBeTruthy();
  expect(await peedUpdate.json()).toEqual({ id: explicit.id, ...edit, peed: true, pooped: true });
  const poopedUpdate = await request.put(`/weights/${explicit.id}`, { headers, data: { ...edit, pooped: false } });
  expect(poopedUpdate.ok(), await poopedUpdate.text()).toBeTruthy();
  expect(await poopedUpdate.json()).toEqual({ id: explicit.id, ...edit, peed: true, pooped: false });

  const beforeInvalid = await (await request.get('/weights', { headers })).json();
  for (const field of ['peed', 'pooped']) {
    for (const value of [0, 1, 'true', 'false', null, [], {}]) {
      const data = { local_date: '2031-05-20', weight_kg: 70, note: 'must not be saved', [field]: value };
      for (const method of ['post', 'put'] as const) {
        const response = await request[method](method === 'post' ? '/weights' : `/weights/${explicit.id}`, { headers, data });
        expect(response.status(), `${method} ${JSON.stringify(data)}`).toBe(400);
        expect(await response.json()).toEqual({ error: 'invalid_weight' });
      }
    }
  }
  const afterInvalid = await request.get('/weights', { headers });
  expect(afterInvalid.ok()).toBeTruthy();
  expect(await afterInvalid.json()).toEqual(beforeInvalid);
});

test('[J-217] weight checkbox migration backfills all owners while preserving legacy records and constraints', async () => {
  const db = new Database(':memory:');
  const migration = '007_add_weight_bathroom_flags.sql';
  try {
    db.pragma('foreign_keys = ON');
    const previous = (await readdir('server/migrations'))
      .filter((filename) => filename.endsWith('.sql') && filename < migration).sort();
    for (const filename of previous) {
      db.exec(await readFile(path.join('server/migrations', filename), 'utf8'));
    }
    db.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').run(1, 'weight-a@test.local', 111);
    db.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').run(2, 'weight-b@test.local', 222);
    const insert = db.prepare('INSERT INTO weights (id, user_id, local_date, weight_kg, note, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    insert.run(11, 1, '2031-05-01', 82.4, 'Did not pee; did poop.\nKeep this exact note.', 333);
    insert.run(12, 1, '2031-05-02', 82.1, null, 444);
    insert.run(13, 2, '2031-05-01', 65.7, 'Other owner', 555);
    const before = db.prepare('SELECT * FROM weights ORDER BY id').all() as Record<string, unknown>[];

    db.exec(await readFile(path.join('server/migrations', migration), 'utf8'));
    expect(db.prepare('SELECT * FROM weights ORDER BY id').all()).toEqual(
      before.map((record) => ({ ...record, peed: 1, pooped: 0 })),
    );
    db.prepare('INSERT INTO weights (user_id, local_date, weight_kg, note, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(1, '2031-05-03', 81.9, null, 666);
    expect(db.prepare('SELECT peed, pooped FROM weights WHERE user_id = ? AND local_date = ?').get(1, '2031-05-03'))
      .toEqual({ peed: 1, pooped: 0 });

    for (const field of ['peed', 'pooped']) {
      const update = db.prepare(`UPDATE weights SET ${field} = ? WHERE id = ?`);
      for (const value of [-1, 2, 0.5, 'true', null]) {
        expect(() => update.run(value, 11), `${field}: ${String(value)}`).toThrow(/constraint/i);
      }
    }
    expect(() => db.prepare('INSERT INTO weights (user_id, local_date, weight_kg, note, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(1, '2031-05-01', 80, null, 777)).toThrow(/UNIQUE constraint failed/i);
    expect(db.prepare('SELECT * FROM weights WHERE id <= 13 ORDER BY id').all()).toEqual(
      before.map((record) => ({ ...record, peed: 1, pooped: 0 })),
    );
  } finally {
    db.close();
  }
});
