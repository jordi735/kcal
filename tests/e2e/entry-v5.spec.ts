import { E2E_DATABASE_PATH, E2E_ORIGIN } from './test-config';
import { expect, type APIRequestContext } from '@playwright/test';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import type {
  EntryWithMacros, Macros, McpDayResult, McpEntriesCreateResult, McpEntryWriteResult,
  McpMealsResult, McpSummaryResult, McpWeekResult, Product, SettingsSnapshot,
} from '../../shared/types';
import { call, createMcpTest, freshUser, mcpEntry, reject, rest } from './mcp-helpers';

const test = createMcpTest({ emailPrefix: 'entry-v5', scope: 'kcal:read kcal:write' });
test.use({ storageState: { cookies: [], origins: [] } });
const DATE = '2024-02-29';
const NUTRITION = { kcal: 100, protein: 10, carbs: 20, fat: 5 };
const MIGRATION = '009_amount_and_mcp_v5_notice.sql';

function withTestDb<T>(work: (db: Database.Database) => T): T {
  const db = new Database(E2E_DATABASE_PATH);
  try { return work(db); } finally { db.close(); }
}

function entryRow(userId: number, id: number): Record<string, unknown> {
  return withTestDb((db) => db.prepare('SELECT * FROM entries WHERE user_id = ? AND id = ?').get(userId, id)) as Record<string, unknown>;
}

function foodState() {
  return withTestDb((db) => ['entries', 'entry_groups', 'products', 'mcp_creation_receipts']
    .map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()));
}

function saveProduct(request: APIRequestContext, token: string, name: string,
  fields: Partial<Pick<Product, 'unit' | 'is_temp' | 'per100'>> = {}) {
  return rest<Product>(request, token, 'post', '/products', {
    name, brand: null, barcode: null, unit: 'g', is_temp: false, per100: NUTRITION, ...fields,
  });
}

function saveEntry(request: APIRequestContext, token: string, productId: number, amount = 100) {
  return rest<EntryWithMacros>(request, token, 'post', '/entries', {
    product_id: productId, amount, local_date: DATE, local_time: '12:00',
  });
}

function upgradedThroughV4(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const file of readdirSync('server/migrations').filter((file) => file.endsWith('.sql') && file < '009').sort()) {
    db.exec(readFileSync(`server/migrations/${file}`, 'utf8'));
  }
  return db;
}

test('[J-480] REST and MCP use amount for g and ml and reject legacy grams inputs', async ({ request, mcp, account }) => {
  const solid = await saveProduct(request, account.token, 'Solid amount');
  const liquid = await saveProduct(request, account.token, 'Liquid amount', { unit: 'ml' });
  const result = await call<McpEntriesCreateResult>(mcp, 'create_entries', {
    entries: [{ product_id: solid.id, amount: 28.5 }, { product_id: liquid.id, amount: 125.25 }],
    local_date: DATE, local_time: '10:15',
  });
  expect(result.entries.map((entry) => [entry.amount, entry.product.unit])).toEqual([[28.5, 'g'], [125.25, 'ml']]);
  const viaRest = await saveEntry(request, account.token, solid.id, 50.5);
  expect(viaRest).toMatchObject({ amount: 50.5, product: { unit: 'g' } });
  const day = await call<McpDayResult>(mcp, 'get_day', { date: DATE });
  expect(day.entries).toEqual([...result.entries, mcpEntry(viaRest)]);
  const meals = await call<McpMealsResult>(mcp, 'get_meals', { start_date: DATE, end_date: DATE });
  expect(meals.days[DATE]!.entries).toEqual(day.entries);
  const entries = await rest<EntryWithMacros[]>(request, account.token, 'get', `/entries?date=${DATE}`);
  expect(JSON.stringify({ result, viaRest, day, meals, entries })).not.toContain('"grams":');
  const recent = await rest<{ amounts: number[] }>(request, account.token, 'get', `/entries/recent-amounts?product_id=${solid.id}`);
  expect(Object.keys(recent)).toEqual(['amounts']);
  expect([...recent.amounts].sort((a, b) => a - b)).toEqual([28.5, 50.5]);
  expect(await rest(request, account.token, 'get', `/entries/recent-amounts?product_id=${liquid.id}`)).toEqual({ amounts: [125.25] });
  expect((await request.get(`/entries/recent-grams?product_id=${solid.id}`, {
    headers: { Authorization: `Bearer ${account.token}` },
  })).status()).toBe(404);
  const before = foodState();
  for (const legacy of [{ grams: 50 }, { amount: 50, grams: 50 }]) {
    const headers = { Authorization: `Bearer ${account.token}` };
    expect((await request.post('/entries', { headers, data: {
      product_id: solid.id, local_date: DATE, local_time: '12:00', ...legacy,
    } })).status()).toBe(400);
    expect((await request.patch(`/entries/${viaRest.id}`, { headers, data: legacy })).status()).toBe(400);
    await reject(mcp, 'create_entries', {
      entries: [{ product_id: solid.id, ...legacy }], local_date: DATE, local_time: '12:00',
    });
    await reject(mcp, 'update_entry', { entry_id: viaRest.id, ...legacy });
  }
  expect(foodState()).toEqual(before);
});

test('[J-481] food and clock corrections preserve grouped entry identity and update all nutrition reads', async ({ request, mcp, account }) => {
  const original = await saveProduct(request, account.token, 'Original food');
  const replacement = await saveProduct(request, account.token, 'Replacement food', {
    per100: { kcal: 200, protein: 20, carbs: 40, fat: 10 },
  });
  const batch = await call<McpEntriesCreateResult>(mcp, 'create_entries', {
    entries: [{ product_id: original.id, amount: 100 }, { product_id: original.id, amount: 50 }],
    local_date: DATE, local_time: '12:00', group_name: 'Unchanged group',
  });
  const first = batch.entries[0]!;
  const second = batch.entries[1]!;
  await rest(request, account.token, 'patch', `/entries/${first.id}`, { tagged: true });
  const before = [first, second].map((entry) => entryRow(account.user.id, entry.id));
  const groupBefore = withTestDb((db) => db.prepare('SELECT * FROM entry_groups WHERE user_id = ? AND id = ?')
    .get(account.user.id, batch.group!.id));
  const corrected = await rest<EntryWithMacros>(request, account.token, 'patch', `/entries/${first.id}`, {
    product_id: replacement.id, local_time: '23:59',
  });
  expect(corrected).toMatchObject({ id: first.id, amount: 100, local_date: DATE, local_time: '23:59', tagged: true, group: first.group });
  const amountOnly = await call<McpEntryWriteResult>(mcp, 'update_entry', { entry_id: first.id, amount: 62.5 });
  expect(amountOnly.entry).toMatchObject({ amount: 62.5, local_time: '23:59', product: replacement });
  const clockOnly = await call<McpEntryWriteResult>(mcp, 'update_entry', { entry_id: first.id, local_time: '00:00' });
  expect(clockOnly.entry).toMatchObject({ amount: 62.5, local_time: '00:00', product: replacement });
  const secondCorrected = await call<McpEntryWriteResult>(mcp, 'update_entry', {
    entry_id: second.id, product_id: replacement.id, local_time: '06:30',
  });
  expect(secondCorrected.entry).toMatchObject({ id: second.id, amount: 50, local_date: DATE, local_time: '06:30', group: second.group });
  for (const [index, entry] of [first, second].entries()) {
    const row = entryRow(account.user.id, entry.id);
    for (const key of ['id', 'user_id', 'local_date', 'created_at', 'group_id', 'tagged']) expect(row[key], key).toEqual(before[index]![key]);
  }
  expect(withTestDb((db) => db.prepare('SELECT * FROM entry_groups WHERE user_id = ? AND id = ?')
    .get(account.user.id, batch.group!.id))).toEqual(groupBefore);
  const totals: Macros = { kcal: 225, protein: 22.5, carbs: 45, fat: 11.25 };
  const day = await call<McpDayResult>(mcp, 'get_day', { date: DATE });
  expect(day.entries).toEqual([clockOnly.entry, secondCorrected.entry]);
  expect(day.totals).toEqual(totals);
  const app = await rest<EntryWithMacros[]>(request, account.token, 'get', `/entries?date=${DATE}`);
  expect(app.map(mcpEntry)).toEqual(day.entries);
  expect(app.map((entry) => entry.tagged)).toEqual([true, false]);
  expect((await call<McpMealsResult>(mcp, 'get_meals', { start_date: DATE, end_date: DATE })).days[DATE]!.totals).toEqual(totals);
  expect((await call<McpWeekResult>(mcp, 'get_week', { date: DATE })).totals).toEqual(totals);
  expect((await call<McpSummaryResult>(mcp, 'get_summary', { start_date: DATE, end_date: DATE })).totals).toEqual(totals);
  const week = await rest<Record<string, Macros>>(request, account.token, 'get', '/entries/week?start=2024-02-26');
  expect(week[DATE]).toEqual(totals);
});

test('[J-482] cross-unit food replacements require an explicit amount and reject atomically', async ({ request, mcp, account }) => {
  const solid = await saveProduct(request, account.token, 'Solid replacement');
  const liquid = await saveProduct(request, account.token, 'Liquid replacement', { unit: 'ml' });
  const entry = await saveEntry(request, account.token, solid.id);
  const before = foodState();
  const response = await request.patch(`/entries/${entry.id}`, {
    headers: { Authorization: `Bearer ${account.token}` }, data: { product_id: liquid.id, local_time: '14:00', tagged: true },
  });
  expect(response.status()).toBe(400);
  expect(await response.json()).toEqual({ error: 'amount_required_for_unit_change' });
  await reject(mcp, 'update_entry', { entry_id: entry.id, product_id: liquid.id, local_time: '14:00' }, 'amount_required_for_unit_change');
  expect(foodState()).toEqual(before);
  const changed = await call<McpEntryWriteResult>(mcp, 'update_entry', {
    entry_id: entry.id, product_id: liquid.id, amount: 250.5, local_time: '14:00',
  });
  expect(changed.entry).toMatchObject({ id: entry.id, amount: 250.5, product: { id: liquid.id, unit: 'ml' }, local_time: '14:00', macros: { kcal: 250.5 } });
  const returned = await rest<EntryWithMacros>(request, account.token, 'patch', `/entries/${entry.id}`, {
    product_id: solid.id, amount: 50, local_time: '08:00',
  });
  expect(returned).toMatchObject({ id: entry.id, amount: 50, product: { id: solid.id, unit: 'g' }, local_time: '08:00', tagged: false, macros: { kcal: 50 } });
});

test('[J-483] invalid or unauthorized entry corrections reject without changing food state', async ({ request, browser, mcp, account }) => {
  const food = await saveProduct(request, account.token, 'Owned validation food');
  const temporary = await saveProduct(request, account.token, 'Temporary replacement', { is_temp: true });
  const entry = await saveEntry(request, account.token, food.id);
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const other = await freshUser(await context.newPage(), request, 'entry-v5-foreign');
    const foreign = await saveProduct(request, other.token, 'Foreign replacement');
    const foreignEntry = await saveEntry(request, other.token, foreign.id);
    const before = foodState();
    const invalid: Record<string, unknown>[] = [
      {}, { amount: 0 }, { amount: -1 }, { amount: Number.MAX_SAFE_INTEGER + 1 }, { amount: null },
      { product_id: 0 }, { product_id: 1.5 }, { product_id: null }, { product_id: '1' },
      { product_id: foreign.id, amount: 20 }, { product_id: temporary.id, local_time: '08:00' },
      { product_id: 999999999 }, { local_time: '24:00' }, { local_time: '12:60' },
      { local_time: '1:00' }, { local_time: '12:00:00' }, { local_time: '' }, { local_time: null },
      { amount: 20, local_time: '99:99' }, { local_date: '2024-03-01' }, { group_id: null },
      { entry_ids: [entry.id] }, { amount: 20, local_date: DATE }, { amount: 20, group_id: 1 },
    ];
    for (const patch of invalid) {
      const response = await request.patch(`/entries/${entry.id}`, { headers: { Authorization: `Bearer ${account.token}` }, data: patch });
      expect([400, 404], JSON.stringify(patch)).toContain(response.status());
      await reject(mcp, 'update_entry', { entry_id: entry.id, ...patch });
      expect(foodState(), JSON.stringify(patch)).toEqual(before);
    }
    await reject(mcp, 'update_entry', { entry_id: entry.id, tagged: true });
    const response = await request.patch(`/entries/${foreignEntry.id}`, {
      headers: { Authorization: `Bearer ${account.token}` }, data: { amount: 20 },
    });
    expect(response.status()).toBe(404);
    await reject(mcp, 'update_entry', { entry_id: foreignEntry.id, amount: 20 }, 'not_found');
    expect(foodState()).toEqual(before);
  } finally { await context.close(); }
});

test('[J-484] existing temporary and legacy entries preserve invalid fields unless replaced', async ({ request, mcp, account }) => {
  const temporary = await saveProduct(request, account.token, 'Existing temporary', { is_temp: true });
  const saved = await saveProduct(request, account.token, 'Saved legacy replacement');
  const [tempId, savedId] = withTestDb((db) => {
    const insert = db.prepare(`INSERT INTO entries (user_id,product_id,amount,local_date,local_time,created_at,tagged)
      VALUES (?,?,0.25,'2024-02-30','99:99',42,1)`);
    return [temporary, saved].map((product) => Number(insert.run(account.user.id, product.id).lastInsertRowid));
  });
  const tempTime = await rest<EntryWithMacros>(request, account.token, 'patch', `/entries/${tempId!}`, { local_time: '07:15' });
  expect(tempTime).toMatchObject({ amount: 0.25, local_date: '2024-02-30', local_time: '07:15', tagged: true, product: temporary });
  const tempAmount = await call<McpEntryWriteResult>(mcp, 'update_entry', { entry_id: tempId!, amount: 2.5 });
  expect(tempAmount.entry).toMatchObject({ amount: 2.5, local_date: '2024-02-30', local_time: '07:15', product: temporary });
  const legacyAmount = await call<McpEntryWriteResult>(mcp, 'update_entry', { entry_id: savedId!, amount: 3.5 });
  expect(legacyAmount.entry).toMatchObject({ amount: 3.5, local_date: '2024-02-30', local_time: '99:99' });
  const replacement = await call<McpEntryWriteResult>(mcp, 'update_entry', { entry_id: tempId!, product_id: saved.id });
  expect(replacement.entry).toMatchObject({ amount: 2.5, local_date: '2024-02-30', local_time: '07:15', product: saved });
  for (const id of [tempId!, savedId!]) expect(entryRow(account.user.id, id)).toMatchObject({ created_at: 42, tagged: 1, group_id: null });
  const before = foodState();
  for (const patch of [{ amount: 0.25 }, { local_time: '99:99' }]) {
    expect((await request.patch(`/entries/${savedId!}`, { headers: { Authorization: `Bearer ${account.token}` }, data: patch })).status()).toBe(400);
    await reject(mcp, 'update_entry', { entry_id: savedId!, ...patch });
  }
  expect(foodState()).toEqual(before);
});

test('[J-485] amount migration preserves existing values groups metadata and raw receipt bytes', () => {
  const db = upgradedThroughV4();
  try {
    db.prepare('INSERT INTO users (id,email,created_at) VALUES (1,?,?)').run('migration@test.local', 100);
    const insertProduct = db.prepare(`INSERT INTO products
      (id,name,unit,kcal_per100,protein_per100,carbs_per100,fat_per100,created_by,created_at)
      VALUES (?,? ,?,100,10,20,5,1,100)`);
    insertProduct.run(1, 'Solid', 'g');
    insertProduct.run(2, 'Liquid', 'ml');
    db.prepare('INSERT INTO entry_groups (id,user_id,local_date,name,created_at) VALUES (1,1,?,?,100)').run(DATE, 'Meal');
    const insertEntry = db.prepare(`INSERT INTO entries
      (id,user_id,product_id,grams,local_date,local_time,created_at,tagged,group_id)
      VALUES (?,1,?,?,?,'12:00',123,?,1)`);
    insertEntry.run(7, 1, 29.5, DATE, 1);
    insertEntry.run(8, 2, 0.25, DATE, 0);
    const raw = '{\n  "entries": [{ "id": 7, "grams": 29.5 }], "unrelated": "grams"\n}\n';
    db.prepare(`INSERT INTO mcp_creation_receipts
      (user_id,idempotency_key,tool_name,request_hash,result_json,applied_at,schema_version)
      VALUES (1,'old-key','create_entries','original-hash',?,123,4)`).run(raw);
    const before = db.prepare('SELECT * FROM entries ORDER BY id').all() as Array<Record<string, unknown>>;
    const groups = db.prepare('SELECT * FROM entry_groups').all();
    const receipts = db.prepare('SELECT * FROM mcp_creation_receipts').all();
    db.exec(readFileSync(`server/migrations/${MIGRATION}`, 'utf8'));
    expect(db.prepare('SELECT * FROM entries ORDER BY id').all()).toEqual(before.map(({ grams, ...entry }) => ({ ...entry, amount: grams })));
    expect(db.prepare('SELECT * FROM entry_groups').all()).toEqual(groups);
    expect(db.prepare('SELECT * FROM mcp_creation_receipts').all()).toEqual(receipts);
    const stored = db.prepare('SELECT result_json FROM mcp_creation_receipts').get() as { result_json: string };
    expect(Buffer.from(stored.result_json)).toEqual(Buffer.from(raw));
    const columns = db.pragma('table_info(entries)') as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toContain('amount');
    expect(columns.map((column) => column.name)).not.toContain('grams');
    expect(db.pragma('foreign_key_check')).toEqual([]);
  } finally { db.close(); }
});

test('[J-486] v5 reminder migration flags only live connections and does not flag later connections', () => {
  const db = upgradedThroughV4();
  try {
    const now = 2_000_000;
    db.function('unixepoch', { varargs: true }, () => now / 1000);
    db.prepare('INSERT INTO oauth_clients VALUES (?,?)').run('client', '{}');
    const cases = [
      { kind: 'access', used: 0, revoked: 0, grant: 1, token: 1, before: 4, expected: 5 },
      { kind: 'refresh', used: 0, revoked: 0, grant: 1, token: 1, before: null, expected: 5 },
      { kind: 'refresh', used: 1, revoked: 0, grant: 1, token: 1, before: null, expected: null },
      { kind: 'access', used: 0, revoked: 1, grant: 1, token: 1, before: 4, expected: 4 },
      { kind: 'access', used: 0, revoked: 0, grant: 0, token: 1, before: null, expected: null },
      { kind: 'access', used: 0, revoked: 0, grant: 1, token: 0, before: 4, expected: 4 },
    ];
    for (const [index, value] of cases.entries()) {
      const id = index + 1;
      db.prepare('INSERT INTO users (id,email,created_at,mcp_notice_version) VALUES (?,?,?,?)')
        .run(id, `notice${id}@test.local`, now, value.before);
      db.prepare('INSERT INTO oauth_grants (id,user_id,client_id,resource,expires_at,revoked) VALUES (?,?,?,?,?,?)')
        .run(`g${id}`, id, 'client', `${E2E_ORIGIN}/mcp`, now + value.grant, value.revoked);
      db.prepare('INSERT INTO oauth_tokens (hash,grant_id,kind,expires_at,used) VALUES (?,?,?,?,?)')
        .run(`t${id}`, `g${id}`, value.kind, now + value.token, value.used);
    }
    db.exec(readFileSync(`server/migrations/${MIGRATION}`, 'utf8'));
    expect(db.prepare('SELECT mcp_notice_version FROM users ORDER BY id').all())
      .toEqual(cases.map((value) => ({ mcp_notice_version: value.expected })));
    const id = Number(db.prepare('INSERT INTO users (email,created_at) VALUES (?,?)').run('later@test.local', now).lastInsertRowid);
    db.prepare('INSERT INTO oauth_grants (id,user_id,client_id,resource,expires_at) VALUES (?,?,?,?,?)')
      .run('later', id, 'client', `${E2E_ORIGIN}/mcp`, now + 1000);
    db.prepare('INSERT INTO oauth_tokens (hash,grant_id,kind,expires_at) VALUES (?,?,?,?)')
      .run('later-token', 'later', 'access', now + 1000);
    expect(db.prepare('SELECT mcp_notice_version FROM users WHERE id = ?').get(id)).toEqual({ mcp_notice_version: null });
  } finally { db.close(); }
});

test('[J-487] stale v4 dismissal preserves the v5 reminder and v5 dismissal survives a new session', async ({ request, account }) => {
  expect((await rest<SettingsSnapshot>(request, account.token, 'get', '/settings')).mcp_notice_version).toBeNull();
  withTestDb((db) => db.prepare('UPDATE users SET mcp_notice_version = 5 WHERE id = ?').run(account.user.id));
  expect(await rest(request, account.token, 'post', '/settings/mcp-notice/dismiss', { version: 4 })).toEqual({ mcp_notice_version: 5 });
  expect((await rest<SettingsSnapshot>(request, account.token, 'get', '/settings')).mcp_notice_version).toBe(5);
  for (let index = 0; index < 2; index++) {
    expect(await rest(request, account.token, 'post', '/settings/mcp-notice/dismiss', { version: 5 })).toEqual({ mcp_notice_version: null });
  }
  expect(await rest(request, account.token, 'post', '/settings/mcp-notice/dismiss', { version: 4 })).toEqual({ mcp_notice_version: null });
  expect((await request.post('/auth/request-code', { data: { email: account.user.email } })).ok()).toBe(true);
  const { code } = await (await request.get(`/auth/test/last-code/${account.user.email}`)).json() as { code: string };
  const response = await request.post('/auth/verify-code', { data: { email: account.user.email, code } });
  expect(response.ok()).toBe(true);
  const next = await response.json() as { session_token: string };
  expect((await rest<SettingsSnapshot>(request, next.session_token, 'get', '/settings')).mcp_notice_version).toBeNull();
});
