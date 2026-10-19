// Shared MCP read results and account validation used by tool handlers.

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { log } from '../log.js';
import { statements } from '../statements.js';
import type {
  McpDayResult, McpMealsResult, McpProductSearchResult,
  McpSummaryResult, McpWeekResult, McpWeighinsResult,
} from '../types.js';

export class ReadInputError extends Error {}

export function requireAccount(user: number): void {
  if (statements.users.exists.get(user) === undefined) throw new ReadInputError('user_not_found');
}

export function readResult(
  read: () => McpDayResult | McpMealsResult | McpWeekResult | McpWeighinsResult | McpSummaryResult | McpProductSearchResult,
): CallToolResult {
  try {
    const result = read();
    return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
  } catch (error) {
    const controlled = error instanceof ReadInputError || error instanceof RangeError;
    if (!controlled) {
      log.error('MCP read failed', { message: error instanceof Error ? error.message : String(error) });
    }
    return {
      isError: true,
      content: [{ type: 'text', text: controlled ? error.message : 'read_failed' }],
    };
  }
}
