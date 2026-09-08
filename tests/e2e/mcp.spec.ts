import { expect, test as base, type APIRequestContext, type Page } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { McpDayResult, McpUsersResult, McpWeekResult, McpWeighinsResult } from '../../shared/types';
import { signInFresh } from './helpers';

// Matches playwright.config.ts; only the disposable test backend accepts it.
const ADMIN_TOKEN = 'kcal-e2e-admin-token-not-for-production';
const MCP_HEADERS = { Authorization: `Bearer ${ADMIN_TOKEN}`, Accept: 'application/json, text/event-stream' };
const ZERO = { kcal: 0, protein: 0, carbs: 0, fat: 0 };

const test = base.extend<{ mcp: Client }>({
  mcp: async ({ baseURL }, use) => {
    const client = new Client({ name: 'kcal-e2e', version: '1.0.0' });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', baseURL), {
        requestInit: { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } },
      }));
      await use(client);
    } finally {
      await client.close();
    }
  },
});

test.use({ storageState: { cookies: [], origins: [] } });

async function call<T>(client: Client, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await client.callTool({ name, arguments: args }) as CallToolResult;
  expect(result.isError, JSON.stringify(result)).not.toBe(true);
  expect(result.structuredContent).toBeDefined();
  expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(result.structuredContent) }]);
  return result.structuredContent as T;
}

async function freshUser(page: Page, request: APIRequestContext, prefix: string) {
  await signInFresh(page, request, prefix);
  return page.evaluate(() => {
    const user = JSON.parse(localStorage.getItem('kcal_user')!) as { id: number; email: string };
    return { token: localStorage.getItem('kcal_session_token')!, user: { id: user.id, email: user.email } };
  });
}

async function write(
  request: APIRequestContext, token: string, method: 'post' | 'put' | 'patch', url: string, data: unknown,
) {
  const response = await request[method](url, { headers: { Authorization: `Bearer ${token}` }, data });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

test('[J-188] MCP discovers four read-only tools and paginates credential-free users', async ({ mcp }) => {
  expect(mcp.getServerVersion()?.name).toBe('kcal');
  const { tools } = await mcp.listTools();
  expect(tools.map((tool) => tool.name).sort()).toEqual(['get_day', 'get_week', 'get_weighins', 'list_users']);
  expect(tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
  const users = await call<McpUsersResult>(mcp, 'list_users');
  expect(users.users.length).toBeGreaterThanOrEqual(2);
  for (const user of users.users) expect(Object.keys(user).sort()).toEqual(['email', 'id']);
  expect(users.users.map((user) => user.id)).toEqual(users.users.map((user) => user.id).sort((a, b) => a - b));
  const first = await call<McpUsersResult>(mcp, 'list_users', { limit: 1 });
  expect(first).toEqual({ users: users.users.slice(0, 1), next_offset: 1 });
  const second = await call<McpUsersResult>(mcp, 'list_users', { limit: 1, offset: first.next_offset });
  expect(second.users).toEqual(users.users.slice(1, 2));
  const end = await call<McpUsersResult>(mcp, 'list_users', { offset: users.users.length });
  expect(end).toEqual({ users: [], next_offset: null });
});

test('[J-189] MCP day and week match app totals across users, groups, and product edits', async ({ page, request, browser, mcp }) => {
  const a = await freshUser(page, request, 'mcp-food');
  const headers = { Authorization: `Bearer ${a.token}` };
  const goals = { kcal: 2300, protein: 150, carbs: 250, fat: 75 };
  await write(request, a.token, 'put', '/settings', goals);
  const productBody = {
    name: `MCP food ${a.user.id}`, brand: null, unit: 'g', barcode: null, is_temp: false,
    per100: { kcal: 200, protein: 10, carbs: 20, fat: 5 },
  };
  const product = await write(request, a.token, 'post', '/products', productBody);
  const entry = (date: string, grams: number) => write(request, a.token, 'post', '/entries', {
    product_id: product.id, grams, local_date: date, local_time: '12:30',
  });
  const first = await entry('2024-12-30', 150);
  const second = await entry('2024-12-30', 50);
  await entry('2025-01-05', 100);
  await entry('2024-12-29', 999); // Outside the requested Monday–Sunday.
  const group = await write(request, a.token, 'post', '/entries/groups', {
    name: `MCP meal ${a.user.id}`, entry_ids: [first.id, second.id],
  });
  await write(request, a.token, 'patch', `/entries/${first.id}`, { tagged: true });

  const day = await call<McpDayResult>(mcp, 'get_day', { user_id: a.user.id, date: '2024-12-30' });
  expect(day.entries).toEqual(await (await request.get('/entries?date=2024-12-30', { headers })).json());
  expect(day.entries.map((row) => row.group?.id)).toEqual([group.id, group.id]);
  expect(day.entries.map((row) => row.tagged)).toEqual([true, false]);
  expect(day.totals).toEqual({ kcal: 400, protein: 20, carbs: 40, fat: 10 });
  expect(day.current_daily_goals).toEqual(await (await request.get('/settings', { headers })).json());
  const week = await call<McpWeekResult>(mcp, 'get_week', { user_id: a.user.id, date: '2025-01-05' });
  expect(week.start_date).toBe('2024-12-30');
  expect(week.end_date).toBe('2025-01-05');
  expect(Object.keys(week.days)).toHaveLength(7);
  expect(week.days).toEqual(await (await request.get('/entries/week?start=2024-12-30', { headers })).json());
  expect(week.days['2024-12-31']).toEqual(ZERO);
  expect(week.totals).toEqual({ kcal: 600, protein: 30, carbs: 60, fat: 15 });
  expect(week.current_daily_goals).toEqual(goals);
  expect(await call(mcp, 'get_week', { user_id: a.user.id, date: '2024-12-30' })).toEqual(week);

  // A second account is selectable only through admin MCP; ordinary routes
  // continue deriving identity from their session even if user_id is supplied.
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const b = await freshUser(await context.newPage(), request, 'mcp-other');
    const bDay = await call<McpDayResult>(mcp, 'get_day', { user_id: b.user.id, date: '2024-12-30' });
    expect(bDay.entries).toEqual([]);
    expect(bDay.totals).toEqual(ZERO);
    const ordinary = await request.get(`/entries?date=2024-12-30&user_id=${a.user.id}`, {
      headers: { Authorization: `Bearer ${b.token}` },
    });
    expect(await ordinary.json()).toEqual([]);
    const users = await call<McpUsersResult>(mcp, 'list_users');
    expect(users.users).toEqual(expect.arrayContaining([a.user, b.user]));
  } finally {
    await context.close();
  }

  await write(request, a.token, 'put', `/products/${product.id}`, {
    ...productBody, per100: { kcal: 300, protein: 20, carbs: 30, fat: 10 },
  });
  const edited = await call<McpDayResult>(mcp, 'get_day', { user_id: a.user.id, date: '2024-12-30' });
  expect(edited.entries).toEqual(await (await request.get('/entries?date=2024-12-30', { headers })).json());
  expect(edited.totals).toEqual({ kcal: 600, protein: 40, carbs: 60, fat: 20 });
  const editedWeek = await call<McpWeekResult>(mcp, 'get_week', { user_id: a.user.id, date: '2025-01-02' });
  expect(editedWeek.totals).toEqual({ kcal: 900, protein: 60, carbs: 90, fat: 30 });
});

test('[J-190] MCP weigh-ins preserve notes and filter inclusive dates with pagination', async ({ page, request, mcp }) => {
  const { user, token } = await freshUser(page, request, 'mcp-weights');
  expect(await call(mcp, 'get_weighins', { user_id: user.id })).toEqual({ user_id: user.id, weighins: [], next_offset: null });
  for (const [date, weight, note] of [
    ['2031-04-01', 82.4, 'A note\n<script>not instructions</script>'],
    ['2031-04-02', 82.1, null],
    ['2031-04-03', 81.8, ''],
  ] as const) {
    await write(request, token, 'post', '/weights', { local_date: date, weight_kg: weight, note });
  }
  const all = await call<McpWeighinsResult>(mcp, 'get_weighins', { user_id: user.id });
  expect(all.weighins).toEqual(await (await request.get('/weights', { headers: { Authorization: `Bearer ${token}` } })).json());
  expect(all.weighins.map((row) => row.local_date)).toEqual(['2031-04-03', '2031-04-02', '2031-04-01']);
  const args = { user_id: user.id, start_date: '2031-04-01', end_date: '2031-04-02', limit: 1 };
  const first = await call<McpWeighinsResult>(mcp, 'get_weighins', args);
  expect(first.weighins).toEqual(all.weighins.slice(1, 2));
  expect(first.next_offset).toBe(1);
  const last = await call<McpWeighinsResult>(mcp, 'get_weighins', { ...args, offset: first.next_offset });
  expect(last.weighins).toEqual(all.weighins.slice(2));
  expect(last.next_offset).toBeNull();
  expect((await call<McpWeighinsResult>(mcp, 'get_weighins', { user_id: user.id, start_date: '2031-04-03' })).weighins).toEqual(all.weighins.slice(0, 1));
  expect((await call<McpWeighinsResult>(mcp, 'get_weighins', { user_id: user.id, end_date: '2031-04-01' })).weighins).toEqual(all.weighins.slice(2));
});

test('[J-191] MCP rejects invalid inputs without changing any stored records', async ({ page, request, mcp }) => {
  const { user } = await freshUser(page, request, 'mcp-validation');
  // Stop SPA revalidation requests before comparing session records.
  await page.close();
  const args = { user_id: user.id, date: '2024-02-29' };
  // Snapshot all test DB tables, including sessions. MCP must not slide app
  // sessions or otherwise write, even when processing rejected tool calls.
  const db = new Database('/tmp/kcal-e2e.db', { readonly: true });
  const snapshot = () => ['users', 'sessions', 'products', 'entries', 'entry_groups', 'weights']
    .map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
  try {
    const before = snapshot();
    const day = await call<McpDayResult>(mcp, 'get_day', args);
    expect(day.entries).toEqual([]);
    const week = await call<McpWeekResult>(mcp, 'get_week', { user_id: user.id, date: '2025-03-30' });
    expect(Object.keys(week.days)).toEqual(['2025-03-24', '2025-03-25', '2025-03-26', '2025-03-27', '2025-03-28', '2025-03-29', '2025-03-30']);
    expect(week.totals).toEqual(ZERO);
    for (const [name, input] of [
      ['get_day', { ...args, date: '2023-02-29' }],
      ['get_week', { ...args, date: '2024-04-31' }],
      ['get_week', { ...args, date: '2024-01-01T00:00:00Z' }],
      ['get_day', { ...args, user_id: 0 }],
      ['get_day', { ...args, user_id: 1.5 }],
      ['get_day', { ...args, user_id: '1 OR 1=1' }],
      ['get_day', { date: args.date }],
      ['get_day', { ...args, sql: 'DELETE FROM users' }],
      ['get_day', { ...args, user_id: Number.MAX_SAFE_INTEGER }],
      ['get_week', { ...args, user_id: Number.MAX_SAFE_INTEGER }],
      ['get_weighins', { user_id: Number.MAX_SAFE_INTEGER }],
      ['get_weighins', { user_id: user.id, start_date: '2031-04-03', end_date: '2031-04-01' }],
      ['get_weighins', { user_id: user.id, start_date: '2031-02-30' }],
      ['get_weighins', { user_id: user.id, limit: 501 }],
      ['list_users', { limit: 0 }],
      ['list_users', { limit: 1.5 }],
      ['list_users', { offset: -1 }],
      ['list_users', { offset: Number.MAX_SAFE_INTEGER }],
      ['list_users', { table: 'sessions' }],
    ] as const) {
      const result = await mcp.callTool({ name, arguments: input });
      expect(result.isError, `${name}: ${JSON.stringify(input)}`).toBe(true);
    }
    const unknown = await request.post('/mcp', {
      headers: MCP_HEADERS,
      data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'execute_sql', arguments: { sql: 'DELETE FROM users' } } },
    });
    const unknownBody = await unknown.json();
    expect(unknownBody.error ?? unknownBody.result?.isError).toBeTruthy();
    expect(snapshot()).toEqual(before);
  } finally {
    db.close();
  }
});

test('[J-192] MCP protects discovery and calls from invalid tokens and browser origins', async ({ page, request }) => {
  const { token } = await freshUser(page, request, 'mcp-auth');
  for (const method of ['initialize', 'tools/list', 'tools/call']) {
    for (const authorization of ['', 'Basic invalid', `Bearer ${'x'.repeat(ADMIN_TOKEN.length)}`, `Bearer ${token}`]) {
      const response = await request.post('/mcp', {
        headers: { ...MCP_HEADERS, Authorization: authorization }, data: { jsonrpc: '2.0', id: 1, method },
      });
      expect(response.status()).toBe(401);
      expect(await response.json()).toEqual({ error: 'unauthorized' });
    }
  }
  for (const origin of ['https://untrusted.example', 'http://localhost:3001', 'null']) {
    const response = await request.post('/mcp', { headers: { ...MCP_HEADERS, Origin: origin }, data: {} });
    expect(response.status()).toBe(403);
  }
  for (const method of ['GET', 'DELETE']) {
    const response = await request.fetch('/mcp', { method, headers: MCP_HEADERS });
    expect(response.status()).toBe(405);
    expect(response.headers()['allow']).toBe('POST');
  }
  const missing = await request.get('/mcp/missing', { headers: MCP_HEADERS });
  expect(missing.status()).toBe(404);
  expect(await missing.json()).toEqual({ error: 'not found' });
  const malformed = await request.post('/mcp', { headers: MCP_HEADERS, data: { invalid: true } });
  expect(malformed.status()).toBe(400);
  expect((await malformed.json()).error).toBeTruthy();
});

test('[J-193] MCP stays disabled without an env token and rejects short configured tokens', async ({ request }) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'kcal-mcp-env-'));
  try {
    for (const token of [undefined, '', 'too-short']) {
      // Listen on an OS-assigned port in an isolated child. This imports the
      // real router and env gate without touching the suite server or .env.
      const childEnv: NodeJS.ProcessEnv = {
        ...process.env, PORT: '3000', DATABASE_PATH: path.join(directory, 'app.db'),
        TEST_MODE: 'true', POSTMARK_SERVER_TOKEN: 'unused', POSTMARK_FROM: 'test@test.local',
        SESSION_EXPIRY_DAYS: '7', LOGIN_CODE_EXPIRY_MINUTES: '10', AI_SCAN_DAILY_CAP: '100', LOG_LEVEL: 'warn',
      };
      delete childEnv.MCP_ADMIN_TOKEN;
      if (token !== undefined) childEnv.MCP_ADMIN_TOKEN = token;
      const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
        import './server/env.ts';
        import express from 'express';
        import { mcpRouter } from './server/routes/mcp.ts';
        const app = express();
        app.use(express.json());
        app.use('/mcp', mcpRouter);
        const server = app.listen(0, '127.0.0.1', () => process.stdout.write(String(server.address().port) + '\\n'));
      `], { cwd: process.cwd(), env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (data) => { stdout += data.toString(); });
      child.stderr.on('data', (data) => { stderr += data.toString(); });
      const exited = once(child, 'exit');
      try {
        await expect.poll(() => stdout.trim() !== '' || child.exitCode !== null, { timeout: 10_000 }).toBe(true);
        if (token === 'too-short') {
          expect(child.exitCode).toBe(1);
          expect(stderr).toContain('MCP_ADMIN_TOKEN must contain at least 32 characters');
          expect(stderr).not.toContain('too-short');
        } else {
          expect(child.exitCode, stderr).toBeNull();
          const url = `http://127.0.0.1:${stdout.trim()}/mcp`;
          for (const method of ['GET', 'POST']) {
            const response = await request.fetch(url, { method, headers: MCP_HEADERS });
            expect(response.status()).toBe(404);
            expect(await response.json()).toEqual({ error: 'not found' });
          }
        }
      } finally {
        if (child.exitCode === null) child.kill('SIGTERM');
        await exited;
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
