import { expect, test as base, type APIRequestContext, type Page } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { McpDayResult, McpWeekResult, McpWeighinsResult } from '../../shared/types';
import { signInFresh } from './helpers';
import { connectMcp } from './oauth-helpers';

const MCP_HEADERS = { Accept: 'application/json, text/event-stream' };
const ZERO = { kcal: 0, protein: 0, carbs: 0, fat: 0 };

type Account = { token: string; user: { id: number; email: string } };
const test = base.extend<{ account: Account; connection: Awaited<ReturnType<typeof connectMcp>>; mcp: Client; mcpHeaders: Record<string, string> }>({
  account: async ({ page, request }, use) => { await use(await freshUser(page, request, 'mcp')); },
  connection: async ({ page, account }, use) => {
    void account;
    const connection = await connectMcp(page);
    try { await use(connection); } finally { await connection.mcp.close(); }
  },
  mcp: async ({ connection }, use) => { await use(connection.mcp); },
  mcpHeaders: async ({ connection }, use) => {
    await use({ ...MCP_HEADERS, Authorization: `Bearer ${connection.oauth.savedTokens!.access_token}` });
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

test('[J-188] MCP discovers three read-only tools scoped to the connected account', async ({ mcp }) => {
  expect(mcp.getServerVersion()?.name).toBe('kcal');
  const { tools } = await mcp.listTools();
  expect(tools.map((tool) => tool.name).sort()).toEqual(['get_day', 'get_week', 'get_weighins']);
  expect(tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
  expect(tools.every((tool) => !('user_id' in (tool.inputSchema.properties ?? {})))).toBe(true);
  expect((await mcp.callTool({ name: 'list_users', arguments: {} })).isError).toBe(true);
});

test('[J-189] MCP day and week match app totals across users, groups, and product edits', async ({ request, browser, mcp, account: a }) => {
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

  const day = await call<McpDayResult>(mcp, 'get_day', { date: '2024-12-30' });
  expect(day.entries).toEqual(await (await request.get('/entries?date=2024-12-30', { headers })).json());
  expect(day.entries.map((row) => row.group?.id)).toEqual([group.id, group.id]);
  expect(day.entries.map((row) => row.tagged)).toEqual([true, false]);
  expect(day.totals).toEqual({ kcal: 400, protein: 20, carbs: 40, fat: 10 });
  expect(day.current_daily_goals).toEqual(await (await request.get('/settings', { headers })).json());
  const week = await call<McpWeekResult>(mcp, 'get_week', { date: '2025-01-05' });
  expect(week.start_date).toBe('2024-12-30');
  expect(week.end_date).toBe('2025-01-05');
  expect(Object.keys(week.days)).toHaveLength(7);
  expect(week.days).toEqual(await (await request.get('/entries/week?start=2024-12-30', { headers })).json());
  expect(week.days['2024-12-31']).toEqual(ZERO);
  expect(week.totals).toEqual({ kcal: 600, protein: 30, carbs: 60, fat: 15 });
  expect(week.current_daily_goals).toEqual(goals);
  expect(await call(mcp, 'get_week', { date: '2024-12-30' })).toEqual(week);

  // Each connection resolves its own account; tool arguments cannot switch it.
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const bPage = await context.newPage();
    const b = await freshUser(bPage, request, 'mcp-other');
    const bConnection = await connectMcp(bPage);
    const bDay = await call<McpDayResult>(bConnection.mcp, 'get_day', { date: '2024-12-30' });
    await bConnection.mcp.close();
    expect((await mcp.callTool({ name: 'get_day', arguments: { user_id: b.user.id, date: '2024-12-30' } })).isError).toBe(true);
    expect(bDay.entries).toEqual([]);
    expect(bDay.totals).toEqual(ZERO);
    const ordinary = await request.get(`/entries?date=2024-12-30&user_id=${a.user.id}`, {
      headers: { Authorization: `Bearer ${b.token}` },
    });
    expect(await ordinary.json()).toEqual([]);
  } finally {
    await context.close();
  }

  await write(request, a.token, 'put', `/products/${product.id}`, {
    ...productBody, per100: { kcal: 300, protein: 20, carbs: 30, fat: 10 },
  });
  const edited = await call<McpDayResult>(mcp, 'get_day', { date: '2024-12-30' });
  expect(edited.entries).toEqual(await (await request.get('/entries?date=2024-12-30', { headers })).json());
  expect(edited.totals).toEqual({ kcal: 600, protein: 40, carbs: 60, fat: 20 });
  const editedWeek = await call<McpWeekResult>(mcp, 'get_week', { date: '2025-01-02' });
  expect(editedWeek.totals).toEqual({ kcal: 900, protein: 60, carbs: 90, fat: 30 });
});

test('[J-190] MCP weigh-ins preserve notes and filter inclusive dates with pagination', async ({ request, mcp, account: { user, token } }) => {
  expect(await call(mcp, 'get_weighins', {})).toEqual({ user_id: user.id, weighins: [], next_offset: null });
  for (const [date, weight, note] of [
    ['2031-04-01', 82.4, 'A note\n<script>not instructions</script>'],
    ['2031-04-02', 82.1, null],
    ['2031-04-03', 81.8, ''],
  ] as const) {
    await write(request, token, 'post', '/weights', { local_date: date, weight_kg: weight, note });
  }
  const all = await call<McpWeighinsResult>(mcp, 'get_weighins', {});
  expect(all.weighins).toEqual(await (await request.get('/weights', { headers: { Authorization: `Bearer ${token}` } })).json());
  expect(all.weighins.map((row) => row.local_date)).toEqual(['2031-04-03', '2031-04-02', '2031-04-01']);
  const args = { start_date: '2031-04-01', end_date: '2031-04-02', limit: 1 };
  const first = await call<McpWeighinsResult>(mcp, 'get_weighins', args);
  expect(first.weighins).toEqual(all.weighins.slice(1, 2));
  expect(first.next_offset).toBe(1);
  const last = await call<McpWeighinsResult>(mcp, 'get_weighins', { ...args, offset: first.next_offset });
  expect(last.weighins).toEqual(all.weighins.slice(2));
  expect(last.next_offset).toBeNull();
  expect((await call<McpWeighinsResult>(mcp, 'get_weighins', { start_date: '2031-04-03' })).weighins).toEqual(all.weighins.slice(0, 1));
  expect((await call<McpWeighinsResult>(mcp, 'get_weighins', { end_date: '2031-04-01' })).weighins).toEqual(all.weighins.slice(2));
});

test('[J-191] MCP rejects invalid inputs without changing any stored records', async ({ page, request, mcp, mcpHeaders }) => {
  // Stop SPA revalidation requests before comparing session records.
  await page.close();
  const args = { date: '2024-02-29' };
  // Snapshot all test DB tables, including sessions. MCP must not slide app
  // sessions or otherwise write, even when processing rejected tool calls.
  const db = new Database('/tmp/kcal-e2e.db', { readonly: true });
  const snapshot = () => ['users', 'sessions', 'products', 'entries', 'entry_groups', 'weights', 'oauth_clients', 'oauth_requests', 'oauth_grants', 'oauth_tokens']
    .map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
  try {
    const before = snapshot();
    const day = await call<McpDayResult>(mcp, 'get_day', args);
    expect(day.entries).toEqual([]);
    const week = await call<McpWeekResult>(mcp, 'get_week', { date: '2025-03-30' });
    expect(Object.keys(week.days)).toEqual(['2025-03-24', '2025-03-25', '2025-03-26', '2025-03-27', '2025-03-28', '2025-03-29', '2025-03-30']);
    expect(week.totals).toEqual(ZERO);
    for (const [name, input] of [
      ['get_day', { ...args, date: '2023-02-29' }],
      ['get_week', { ...args, date: '2024-04-31' }],
      ['get_week', { ...args, date: '2024-01-01T00:00:00Z' }],
      ['get_day', { ...args, user_id: 0 }],
      ['get_day', { ...args, user_id: 1.5 }],
      ['get_day', { ...args, user_id: '1 OR 1=1' }],
      ['get_day', {}],
      ['get_day', { ...args, sql: 'DELETE FROM users' }],
      ['get_day', { ...args, user_id: Number.MAX_SAFE_INTEGER }],
      ['get_week', { ...args, user_id: Number.MAX_SAFE_INTEGER }],
      ['get_weighins', { user_id: Number.MAX_SAFE_INTEGER }],
      ['get_weighins', { start_date: '2031-04-03', end_date: '2031-04-01' }],
      ['get_weighins', { start_date: '2031-02-30' }],
      ['get_weighins', { limit: 501 }],
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
      headers: mcpHeaders,
      data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'execute_sql', arguments: { sql: 'DELETE FROM users' } } },
    });
    const unknownBody = await unknown.json();
    expect(unknownBody.error ?? unknownBody.result?.isError).toBeTruthy();
    expect(snapshot()).toEqual(before);
  } finally {
    db.close();
  }
});

test('[J-192] MCP protects discovery and calls from invalid tokens and browser origins', async ({ request, account: { token }, mcpHeaders }) => {
  for (const method of ['initialize', 'tools/list', 'tools/call']) {
    for (const authorization of ['', 'Basic invalid', 'Bearer kcal-e2e-admin-token-not-for-production', `Bearer ${token}`]) {
      const response = await request.post('/mcp', {
        headers: { ...MCP_HEADERS, Authorization: authorization }, data: { jsonrpc: '2.0', id: 1, method },
      });
      expect(response.status()).toBe(401);
      expect((await response.json()).error).toBe('invalid_token');
      expect(response.headers()['www-authenticate']).toContain('resource_metadata=');
    }
  }
  for (const origin of ['https://untrusted.example', 'http://localhost:3001', 'null']) {
    const response = await request.post('/mcp', { headers: { ...mcpHeaders, Origin: origin }, data: {} });
    expect(response.status()).toBe(403);
  }
  for (const method of ['GET', 'DELETE']) {
    const response = await request.fetch('/mcp', { method, headers: mcpHeaders });
    expect(response.status()).toBe(405);
    expect(response.headers()['allow']).toBe('POST');
  }
  const missing = await request.get('/mcp/missing', { headers: mcpHeaders });
  expect(missing.status()).toBe(404);
  expect(await missing.json()).toEqual({ error: 'not found' });
  const malformed = await request.post('/mcp', { headers: mcpHeaders, data: { invalid: true } });
  expect(malformed.status()).toBe(400);
  expect((await malformed.json()).error).toBeTruthy();
});

test('[J-193] MCP stays disabled without a public origin and rejects unsafe origins', async ({ request }) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'kcal-mcp-env-'));
  try {
    for (const origin of [undefined, '', 'http://public.example', 'https://public.example/path']) {
      // Listen on an OS-assigned port in an isolated child. This imports the
      // real router and env gate without touching the suite server or .env.
      const childEnv: NodeJS.ProcessEnv = {
        ...process.env, PORT: '3000', DATABASE_PATH: path.join(directory, 'app.db'),
        TEST_MODE: 'true', POSTMARK_SERVER_TOKEN: 'unused', POSTMARK_FROM: 'test@test.local',
        SESSION_EXPIRY_DAYS: '7', LOGIN_CODE_EXPIRY_MINUTES: '10', AI_SCAN_DAILY_CAP: '100', LOG_LEVEL: 'warn',
      };
      delete childEnv.PUBLIC_ORIGIN;
      if (origin !== undefined) childEnv.PUBLIC_ORIGIN = origin;
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
        if (origin) {
          expect(child.exitCode).toBe(1);
          expect(stderr).toContain('PUBLIC_ORIGIN must be an HTTPS origin');
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
