// Shared MCP read results and account validation used by tool handlers.

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { log } from '../log.js';
import { readGoals } from '../reads.js';
import type {
  Macros, McpDayResult, McpMealsResult, McpProductSearchResult,
  McpSummaryResult, McpWeekResult, McpWeighinsResult,
} from '../types.js';

export class ReadInputError extends Error {}

export function requireGoals(user: number): Macros {
  const goals = readGoals(user);
  if (goals === null) throw new ReadInputError('user_not_found');
  return goals;
}

export function readResult(
  read: () => McpDayResult | McpMealsResult | McpWeekResult | McpWeighinsResult | McpSummaryResult | McpProductSearchResult,
): CallToolResult {
  try {
    const result = read();
    return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
  } catch (error) {
    if (!(error instanceof ReadInputError)) {
      log.error('MCP read failed', { message: error instanceof Error ? error.message : String(error) });
    }
    return {
      isError: true,
      content: [{ type: 'text', text: error instanceof ReadInputError ? error.message : 'read_failed' }],
    };
  }
}
