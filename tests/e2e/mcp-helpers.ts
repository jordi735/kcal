import { expect, test as base, type APIRequestContext, type Page } from '@playwright/test';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import Database from 'better-sqlite3';
import { signInFresh } from './helpers';
import { BrowserOAuth, connectMcp } from './oauth-helpers';

type Account = { token: string; user: { id: number; email: string } };
type Connection = Awaited<ReturnType<typeof connectMcp>>;
type McpFixtures = {
  account: Account;
  connection: Connection;
  mcp: Client;
  mcpHeaders: Record<string, string>;
};

export const MCP_HEADERS = { Accept: 'application/json, text/event-stream' };

export function createMcpTest(options: {
  emailPrefix: string;
  scope: 'kcal:read' | 'kcal:read kcal:write';
}) {
  return base.extend<McpFixtures>({
    account: async ({ page, request }, use) => {
      await use(await freshUser(page, request, options.emailPrefix));
    },
    connection: async ({ page, account }, use) => {
      // Keep sign-in ahead of OAuth even though only the page is used here.
      void account;
      const connection = await connectMcp(page, new BrowserOAuth('none', options.scope));
      try { await use(connection); } finally { await connection.mcp.close(); }
    },
    mcp: async ({ connection }, use) => { await use(connection.mcp); },
    mcpHeaders: async ({ connection }, use) => {
      await use({ ...MCP_HEADERS, Authorization: `Bearer ${connection.oauth.savedTokens!.access_token}` });
    },
  });
}

export async function freshUser(page: Page, request: APIRequestContext, prefix: string): Promise<Account> {
  await signInFresh(page, request, prefix);
  return page.evaluate(() => {
    const user = JSON.parse(localStorage.getItem('kcal_user')!) as Account['user'];
    return { token: localStorage.getItem('kcal_session_token')!, user: { id: user.id, email: user.email } };
  });
}

export async function call<T>(mcp: Client, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await mcp.callTool({ name, arguments: args }) as CallToolResult;
  expect(result.isError, `${name}: ${JSON.stringify(result)}`).not.toBe(true);
  expect(result.structuredContent).toBeDefined();
  expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(result.structuredContent) }]);
  return result.structuredContent as T;
}

export async function reject(mcp: Client, name: string, args: Record<string, unknown>, error?: string) {
  const result = await mcp.callTool({ name, arguments: args }) as CallToolResult;
  expect(result.isError, `${name}: ${JSON.stringify(args)}`).toBe(true);
  expect(result.structuredContent).toBeUndefined();
  expect(result.content).toEqual([{ type: 'text', text: error ?? expect.any(String) }]);
}

export async function rest<T>(
  request: APIRequestContext, token: string, method: 'get' | 'post' | 'put' | 'patch', url: string,
  data?: unknown,
): Promise<T> {
  const response = await request[method](url, { headers: { Authorization: `Bearer ${token}` }, data });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json() as Promise<T>;
}

// Write checks compare application records. The read-only protocol test keeps
// its broader OAuth-inclusive snapshot local to that journey.
export function storedRecords(options: { ignoreSessionActivity?: boolean } = {}) {
  const db = new Database('/tmp/kcal-e2e.db', { readonly: true });
  try {
    return ['users', 'sessions', 'products', 'entries', 'entry_groups', 'weights']
      .map((table) => {
        const columns = table === 'sessions' && options.ignoreSessionActivity
          ? 'token, user_id, created_at'
          : '*';
        return db.prepare(`SELECT ${columns} FROM ${table} ORDER BY rowid`).all();
      });
  } finally {
    db.close();
  }
}
