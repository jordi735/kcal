import { expect } from '@playwright/test';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { McpEntriesCreateResult, Product } from '../../shared/types';
import { call, createMcpTest, rest, storedRecords } from './mcp-helpers';

const test = createMcpTest({ emailPrefix: 'security-budget', scope: 'kcal:read kcal:write' });
test.use({ storageState: { cookies: [], origins: [] } });

test('[J-522] MCP rejects excessive validation work before mutation and still accepts a maximum batch', async ({ page, request, account, mcp }) => {
  const product = await rest<Product>(request, account.token, 'post', '/products', {
    name: 'Budget boundary', brand: null, barcode: null, unit: 'g', is_temp: false,
    per100: { kcal: 100, protein: 10, carbs: 10, fat: 2 },
  });
  await page.close();
  const before = storedRecords();
  const result = await mcp.callTool({ name: 'create_entries', arguments: {
    idempotency_key: 'security-budget-rejected', local_date: '2026-10-27', local_time: '12:00',
    entries: Array.from({ length: 700 }, () => ({ product_id: product.id, amount: 1 })),
  } }) as CallToolResult;
  expect(result.isError).toBe(true);
  expect(result.content).toEqual([{ type: 'text', text: expect.stringContaining('maximum of 2048 elements') }]);
  expect(result.structuredContent).toBeUndefined();
  expect(storedRecords()).toEqual(before);
  const created = await call<McpEntriesCreateResult>(mcp, 'create_entries', {
    idempotency_key: 'security-budget-valid', local_date: '2026-10-27', local_time: '12:00',
    entries: Array.from({ length: 50 }, () => ({ product_id: product.id, amount: 1 })),
  });
  expect(created.entries).toHaveLength(50);
  expect(created.receipt.replayed).toBe(false);
});
