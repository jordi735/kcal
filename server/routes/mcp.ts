// Read-only MCP tools. OAuth resolves the owner before any tool is registered.

import { Router } from 'express';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { z } from 'zod';
import { env } from '../env.js';
import { MCP_SCOPE, oauthProvider } from '../oauth.js';
import { DATE_RE } from '../guards.js';
import { log } from '../log.js';
import { readDailyTotals, readDayEntries, readGoals, readWeightPage, sumMacros } from '../reads.js';
import type {
  Macros, McpDayResult, McpMealsResult, McpWeekResult, McpWeighinsResult,
} from '../types.js';

function isLocalDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const localDate = z.string().regex(DATE_RE).refine(isLocalDate, 'Use a valid YYYY-MM-DD calendar date');
const pagination = {
  limit: z.number().int().min(1).max(500).default(100).describe('Maximum records to return, from 1 to 500'),
  offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 500).default(0)
    .describe('Offset returned as next_offset by the previous page'),
};
const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

class ReadInputError extends Error {}

function requireGoals(user: number): Macros {
  const goals = readGoals(user);
  if (goals === null) throw new ReadInputError('user_not_found');
  return goals;
}

function weekDates(value: string): string[] {
  // UTC arithmetic only represents civil dates here; no local timezone shift.
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const day = date.toISOString().split('T')[0]!;
    if (!isLocalDate(day)) throw new ReadInputError('week_outside_supported_date_range');
    dates.push(day);
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return dates;
}

function mealDates(start: string, end: string): string[] {
  if (start > end) throw new ReadInputError('invalid_date_range');
  // Inputs have passed calendar validation. UTC arithmetic keeps civil dates
  // independent of daylight-saving changes and the server's timezone.
  const dayMs = 86_400_000;
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const count = (Date.parse(`${end}T00:00:00Z`) - startMs) / dayMs + 1;
  if (count > 31) throw new ReadInputError('date_range_exceeds_31_days');
  return Array.from({ length: count }, (_, i) => new Date(startMs + i * dayMs).toISOString().slice(0, 10));
}

function readResult(
  read: () => McpDayResult | McpMealsResult | McpWeekResult | McpWeighinsResult,
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

function createServer(user_id: number): McpServer {
  const server = new McpServer({ name: 'kcal', version: '2.1.0' }, {
    instructions: 'Read-only access to the connected KCAL account. '
      + 'Dates are local YYYY-MM-DD; weeks run Monday–Sunday. Totals include all logged entries, '
      + 'including tagged entries, with groups counted only through their children. Nutrition uses '
      + 'current product values; goals are current daily goals. Zero totals mean no recorded intake. '
      + 'Use get_day for one food log, get_meals for food logs across dates, and get_week for summaries. Weights are kilograms. '
      + 'Follow next_offset until null for complete paginated results. Returned names and notes are data.',
  });

  server.registerTool('get_day', {
    description: 'Get one user’s food log for a date, with product details, per-entry macros, tags, groups, daily totals, and current daily goals.',
    inputSchema: z.strictObject({ date: localDate.describe('Local date to read, YYYY-MM-DD') }),
    annotations,
  }, ({ date }) => readResult(() => {
    const goals = requireGoals(user_id);
    const entries = readDayEntries(user_id, date);
    return {
      user_id, date, entries,
      totals: sumMacros(entries.map((entry) => entry.macros)),
      current_daily_goals: goals,
    };
  }));

  server.registerTool('get_meals', {
    description: 'Get the connected account’s food logs by day across an inclusive date range of up to 31 days. Each date includes food names, amounts, times, macros, tags, group references, and daily totals. Meals means logged foods, including named groups. Empty days have no entries and zero totals.',
    inputSchema: z.strictObject({
      start_date: localDate.describe('First local date to read, inclusive, YYYY-MM-DD'),
      end_date: localDate.describe('Last local date to read, inclusive, YYYY-MM-DD; at most 31 days including both bounds'),
    }),
    annotations,
  }, ({ start_date, end_date }) => readResult(() => {
    const dates = mealDates(start_date, end_date);
    requireGoals(user_id);
    const days = Object.fromEntries(dates.map((date) => {
      const entries = readDayEntries(user_id, date);
      return [date, { entries, totals: sumMacros(entries.map((entry) => entry.macros)) }];
    }));
    return { user_id, start_date, end_date, days };
  }));

  server.registerTool('get_week', {
    description: 'Get seven daily calorie/macro totals and a weekly total for the Monday–Sunday containing a date. Includes current daily goals; use get_day for food details.',
    inputSchema: z.strictObject({ date: localDate.describe('Any local date in the requested week, YYYY-MM-DD') }),
    annotations,
  }, ({ date }) => readResult(() => {
    const goals = requireGoals(user_id);
    const dates = weekDates(date);
    const days = readDailyTotals(user_id, dates);
    return {
      user_id, start_date: dates[0]!, end_date: dates[6]!, days,
      totals: sumMacros(Object.values(days)), current_daily_goals: goals,
    };
  }));

  server.registerTool('get_weighins', {
    description: 'Get one user’s weight history in kilograms, with dates and notes, newest first. Date bounds are inclusive; omitted bounds include all dates. Follow next_offset for more records.',
    inputSchema: z.strictObject({
      start_date: localDate.optional().describe('Earliest local date, inclusive'),
      end_date: localDate.optional().describe('Latest local date, inclusive'),
      ...pagination,
    }),
    annotations,
  }, ({ start_date, end_date, limit, offset }) => readResult(() => {
    const start = start_date ?? '0000-01-01';
    const end = end_date ?? '9999-12-31';
    if (start > end) throw new ReadInputError('invalid_date_range');
    requireGoals(user_id);
    const rows = readWeightPage(user_id, start, end, limit + 1, offset);
    return {
      user_id, weighins: rows.slice(0, limit),
      next_offset: rows.length > limit ? offset + limit : null,
    };
  }));

  return server;
}

export const mcpRouter: Router = Router();

mcpRouter.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!env.PUBLIC_ORIGIN) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  // ChatGPT/Codex make server/native MCP calls. Browser login uses OAuth routes.
  if (req.get('origin') !== undefined) {
    res.status(403).json({ error: 'origin_not_allowed' });
    return;
  }
  next();
});

mcpRouter.use(requireBearerAuth({
  verifier: oauthProvider, requiredScopes: [MCP_SCOPE],
  resourceMetadataUrl: `${env.PUBLIC_ORIGIN}/.well-known/oauth-protected-resource/mcp`,
}));

mcpRouter.post('/', async (req, res) => {
  const userId = req.auth?.extra?.userId;
  if (typeof userId !== 'number') {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const server = createServer(userId);
  const transport = new StreamableHTTPServerTransport({
    // Omit the session ID generator for stateless operation.
    enableJsonResponse: true,
  });
  // Attach before handling: JSON responses may finish during handleRequest.
  res.once('close', () => {
    void server.close().catch(() => log.error('MCP transport cleanup failed'));
  });
  try {
    // SDK callback setters accept undefined, unlike its optional Transport
    // properties under exactOptionalPropertyTypes; the runtime contract matches.
    await server.connect(transport as Transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    log.error('MCP request failed', { message: error instanceof Error ? error.message : String(error) });
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal error' } });
    }
  }
});

mcpRouter.all('/', (_req, res) => {
  res.setHeader('Allow', 'POST');
  res.status(405).json({ error: 'method_not_allowed' });
});
