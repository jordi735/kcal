import { E2E_DATABASE_PATH, E2E_ORIGIN } from './test-config';
import { expect, test, type APIRequestContext } from '@playwright/test';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runServerFixture } from './server-fixture';
import { AuthThrottle } from '../../server/auth-limits';
import { resolveGoals, goalPeriods } from '../../shared/goals';
import { rangeDates, weekDates } from '../../shared/dates';
import type { SettingsSnapshot } from '../../shared/types';

const defaults = { kcal: 2400, protein: 180, carbs: 240, fat: 80 };
const changed = { kcal: 3000, protein: 190, carbs: 340, fat: 90 };

async function account(request: APIRequestContext) {
  const email = `backend-v4-${randomUUID()}@test.local`;
  expect((await request.post('/auth/request-code', { data: { email } })).ok()).toBe(true);
  const { code } = await (await request.get(`/auth/test/last-code/${email}`)).json() as { code: string };
  const result = await (await request.post('/auth/verify-code', { data: { email, code } })).json() as {
    session_token: string; user: { id: number; email: string };
  };
  return { ...result, headers: { Authorization: `Bearer ${result.session_token}` } };
}

function withTestDb<T>(work: (db: Database.Database) => T): T {
  const db = new Database(E2E_DATABASE_PATH);
  try { return work(db); } finally { db.close(); }
}

test('[J-380] goal history initializes once from server values and same-day saves replace the full vector', async ({ request }) => {
  const user = await account(request);
  const initial = await (await request.get('/settings', { headers: user.headers })).json() as SettingsSnapshot;
  expect(initial).toEqual({ ...defaults, goal_history: [], mcp_notice_version: null });
  const responses = await Promise.all(Array.from({ length: 3 }, () => request.post('/settings/goal-history/initialize', {
    headers: user.headers, data: { time_zone: 'UTC', kcal: 9999 },
  })));
  for (const response of responses) expect(response.ok()).toBe(true);
  const baseline = await responses[0]!.json() as SettingsSnapshot;
  expect(baseline.goal_history).toEqual([{ effective_date: new Date().toISOString().slice(0, 10), goals: defaults }]);
  for (const kcal of [2600, 2700, 2800, 2900, 3000]) {
    const response = await request.put('/settings', { headers: user.headers, data: { ...changed, kcal, time_zone: 'UTC' } });
    expect(response.ok(), await response.text()).toBe(true);
  }
  const final = await (await request.get('/settings', { headers: user.headers })).json() as SettingsSnapshot;
  expect(final.goal_history).toEqual([{ effective_date: baseline.goal_history[0]!.effective_date, goals: changed }]);
  expect(final).toMatchObject(changed);
  const noop = await request.put('/settings', { headers: user.headers, data: { ...changed, time_zone: 'UTC' } });
  expect((await noop.json()).goal_history).toEqual(final.goal_history);
  expect(withTestDb((db) => db.prepare('SELECT goal_kcal FROM users WHERE id = ?').get(user.user.id)))
    .toEqual({ goal_kcal: defaults.kcal });
  expect((await request.post('/settings/goal-history/initialize', { headers: user.headers, data: { time_zone: 'UTC' } })).ok()).toBe(true);
  expect((await (await request.get('/settings', { headers: user.headers })).json()).goal_history).toEqual(final.goal_history);
});

test('[J-381] goal saves reject old clients, invalid timezones and backdating without changing history', async ({ request }) => {
  const user = await account(request);
  const old = await request.put('/settings', { headers: user.headers, data: changed });
  expect(old.status()).toBe(400);
  expect(await old.json()).toEqual({ error: 'app_refresh_required' });
  for (const time_zone of ['Not/AZone', '+02:00', '']) {
    const response = await request.put('/settings', { headers: user.headers, data: { ...changed, time_zone } });
    expect(response.status()).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_time_zone' });
  }
  withTestDb((db) => db.prepare('INSERT INTO goal_history VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(user.user.id, '9999-12-31', 2000, 100, 200, 50, Date.now()));
  const backward = await request.put('/settings', { headers: user.headers, data: { ...changed, time_zone: 'UTC' } });
  expect(backward.status()).toBe(409);
  expect(await backward.json()).toEqual({ error: 'goal_date_before_latest' });
  const final = await (await request.get('/settings', { headers: user.headers })).json() as SettingsSnapshot;
  expect(final.goal_history).toEqual([{ effective_date: '9999-12-31', goals: { kcal: 2000, protein: 100, carbs: 200, fat: 50 } }]);
});

test('[J-382] sparse goals resolve unknown periods and civil dates across leap years and DST', () => {
  const history = [
    { effective_date: '2024-02-29', goals: defaults },
    { effective_date: '2024-03-02', goals: changed },
    { effective_date: '2024-03-03', goals: changed },
    { effective_date: '2024-03-04', goals: { kcal: 0, protein: 0, carbs: 0, fat: 0 } },
  ];
  expect(resolveGoals(history, '2024-02-28')).toBeNull();
  expect(resolveGoals(history, '2024-03-01')).toEqual(defaults);
  expect(resolveGoals(history, '2024-03-30')?.kcal).toBe(0);
  expect(goalPeriods(history, rangeDates('2024-02-28', '2024-03-05', 31))).toEqual([
    { start_date: '2024-02-28', end_date: '2024-02-28', daily_goals: null },
    { start_date: '2024-02-29', end_date: '2024-03-01', daily_goals: defaults },
    { start_date: '2024-03-02', end_date: '2024-03-03', daily_goals: changed },
    { start_date: '2024-03-04', end_date: '2024-03-05', daily_goals: { kcal: 0, protein: 0, carbs: 0, fat: 0 } },
  ]);
  expect(weekDates('2024-03-31')).toEqual(rangeDates('2024-03-25', '2024-03-31', 7));
  expect(weekDates('0099-01-01').every((date) => date.startsWith('0098') || date.startsWith('0099'))).toBe(true);
  expect(() => rangeDates('2024-02-30', '2024-03-01', 31)).toThrow();
});

test('[J-383] v4 migration flags only usable existing OAuth connections and leaves goal history unknown', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  try {
    const migrations = readdirSync('server/migrations').filter((file) => file.endsWith('.sql')).sort();
    for (const file of migrations.filter((file) => file < '008')) db.exec(readFileSync(`server/migrations/${file}`, 'utf8'));
    db.prepare('INSERT INTO oauth_clients VALUES (?, ?)').run('client', '{}');
    const now = Date.now();
    const cases = [
      { kind: 'access', used: 0, revoked: 0, grant: 60_000, token: 60_000, expected: 4 },
      { kind: 'refresh', used: 0, revoked: 0, grant: 60_000, token: 60_000, expected: 4 },
      { kind: 'refresh', used: 1, revoked: 0, grant: 60_000, token: 60_000, expected: null },
      { kind: 'access', used: 0, revoked: 1, grant: 60_000, token: 60_000, expected: null },
      { kind: 'access', used: 0, revoked: 0, grant: -60_000, token: 60_000, expected: null },
      { kind: 'access', used: 0, revoked: 0, grant: 60_000, token: -60_000, expected: null },
    ];
    for (const [index, value] of cases.entries()) {
      const id = index + 1;
      db.prepare('INSERT INTO users (id,email,created_at) VALUES (?,?,?)').run(id, `u${id}@test.local`, now);
      db.prepare('INSERT INTO oauth_grants (id,user_id,client_id,resource,expires_at,revoked) VALUES (?,?,?,?,?,?)')
        .run(`g${id}`, id, 'client', `${E2E_ORIGIN}/mcp`, now + value.grant, value.revoked);
      db.prepare('INSERT INTO oauth_tokens (hash,grant_id,kind,expires_at,used) VALUES (?,?,?,?,?)')
        .run(`t${id}`, `g${id}`, value.kind, now + value.token, value.used);
    }
    db.exec(readFileSync('server/migrations/008_add_goal_history_and_mcp_receipts.sql', 'utf8'));
    expect(db.prepare('SELECT mcp_notice_version FROM users ORDER BY id').all())
      .toEqual(cases.map((value) => ({ mcp_notice_version: value.expected })));
    expect(db.prepare('SELECT * FROM goal_history').all()).toEqual([]);
    db.prepare('INSERT INTO users (email,created_at) VALUES (?,?)').run('new@test.local', now);
    expect(db.prepare('SELECT mcp_notice_version FROM users WHERE email = ?').get('new@test.local')).toEqual({ mcp_notice_version: null });
  } finally { db.close(); }
});

test('[J-384] reminder dismissal is account-scoped, version-specific and persistent', async ({ request }) => {
  const a = await account(request);
  const b = await account(request);
  withTestDb((db) => db.prepare('UPDATE users SET mcp_notice_version = 4 WHERE id IN (?,?)').run(a.user.id, b.user.id));
  expect((await request.post('/settings/mcp-notice/dismiss', { headers: a.headers, data: { version: 3 } })).status()).toBe(400);
  for (let i = 0; i < 2; i++) {
    const response = await request.post('/settings/mcp-notice/dismiss', { headers: a.headers, data: { version: 4 } });
    expect(response.ok()).toBe(true);
    expect(await response.json()).toEqual({ mcp_notice_version: null });
  }
  expect((await (await request.get('/settings', { headers: a.headers })).json()).mcp_notice_version).toBeNull();
  expect((await (await request.get('/settings', { headers: b.headers })).json()).mcp_notice_version).toBe(4);
});

test('[J-385] auth limits enforce cooldown and independent email/IP budgets with expiry', () => {
  let now = 1_000_000;
  const clock = () => now;
  const issue = new AuthThrottle({ now: clock });
  expect(issue.check('issue', 'a@test.local', 'ip')).toBe(0);
  expect(issue.check('issue', 'a@test.local', 'ip')).toBe(30);
  now += 29_000;
  expect(issue.check('issue', 'a@test.local', 'ip')).toBe(1);
  now += 1000;
  for (let i = 0; i < 4; i++) {
    expect(issue.check('issue', 'a@test.local', 'ip')).toBe(0);
    now += 30_000;
  }
  expect(issue.check('issue', 'a@test.local', 'another-ip')).toBeGreaterThan(3000);
  now += 3_600_000;
  expect(issue.check('issue', 'a@test.local', 'ip')).toBe(0);
  const verify = new AuthThrottle({ now: clock });
  for (let i = 0; i < 20; i++) expect(verify.check('verify', 'a@test.local', 'ip')).toBe(0);
  expect(verify.check('verify', 'a@test.local', 'another-ip')).toBe(900);
  expect(verify.check('issue', 'a@test.local', 'ip')).toBe(0);
  expect(verify.check('verify', 'a@test.local', 'ip')).toBe(900);
  now += 900_000;
  expect(verify.check('verify', 'a@test.local', 'ip')).toBe(0);
  const ips = new AuthThrottle({ now: clock });
  for (let i = 0; i < 30; i++) expect(ips.check('issue', `${i}@test.local`, 'ip')).toBe(0);
  expect(ips.check('issue', 'new@test.local', 'ip')).toBe(3600);
  for (let i = 0; i < 100; i++) expect(ips.check('verify', `${i}@test.local`, 'ip')).toBe(0);
  expect(ips.check('verify', 'new@test.local', 'ip')).toBe(900);
});

test('[J-386] REST rejects overflowing amounts and impossible new food and weight dates', async ({ request }) => {
  const user = await account(request);
  const product = await (await request.post('/products', { headers: user.headers, data: {
    name: 'Bounded', brand: null, barcode: null, unit: 'g', is_temp: false,
    per100: { kcal: 2000, protein: 1, carbs: 1, fat: 1 },
  } })).json() as { id: number };
  const input = { product_id: product.id, amount: 100, local_date: '2024-02-29', local_time: '12:00' };
  for (const patch of [{ amount: 1e306 }, { local_date: '2024-02-30' }, { local_time: '99:99' }]) {
    expect((await request.post('/entries', { headers: user.headers, data: { ...input, ...patch } })).status()).toBe(400);
  }
  expect((await request.post('/entries', { headers: user.headers, data: input })).ok()).toBe(true);
  expect((await request.post('/weights', { headers: user.headers, data: { local_date: '2024-02-30', weight_kg: 75, note: null } })).status()).toBe(400);
});

test('[J-387] initialization racing a save preserves new goals and login compatibility reads history', async ({ request }) => {
  const user = await account(request);
  const responses = await Promise.all([
    request.put('/settings', { headers: user.headers, data: { ...changed, time_zone: 'UTC', effective_date: '2000-01-01' } }),
    request.post('/settings/goal-history/initialize', { headers: user.headers, data: { time_zone: 'UTC' } }),
  ]);
  for (const response of responses) expect(response.ok()).toBe(true);
  const settings = await (await request.get('/settings', { headers: user.headers })).json() as SettingsSnapshot;
  expect(settings.goal_history).toEqual([{ effective_date: new Date().toISOString().slice(0, 10), goals: changed }]);
  await request.post('/auth/request-code', { data: { email: user.user.email } });
  const { code } = await (await request.get(`/auth/test/last-code/${user.user.email}`)).json() as { code: string };
  const login = await (await request.post('/auth/verify-code', { data: { email: user.user.email, code } })).json();
  expect(login.user).toMatchObject({ goal_kcal: changed.kcal, goal_protein: changed.protein, goal_carbs: changed.carbs, goal_fat: changed.fat });
});

test('[J-388] server-clock goal dates honor timezone boundaries, no-op saves and backward travel', () => {
  const directory = mkdtempSync(join(tmpdir(), 'kcal-goal-clock-'));
  try {
    const child = runServerFixture(new URL('./fixtures/goal-clock.ts', import.meta.url), join(directory, 'app.db'));
    expect(child.status, child.stderr).toBe(0);
    expect(child.stdout).toContain('goal-clock-ok');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
