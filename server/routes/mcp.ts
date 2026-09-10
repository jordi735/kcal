// Account-scoped MCP tools. OAuth resolves the owner and granted permissions.

import { Router } from 'express';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { z } from 'zod';
import { env } from '../env.js';
import { db } from '../db.js';
import { MCP_SCOPE, MCP_WRITE_SCOPE, oauthProvider } from '../oauth.js';
import { DATE_RE, TIME_RE } from '../guards.js';
import { log } from '../log.js';
import {
  readDailyTotals, readDayEntries, readGoals, readSummary, readWeightPage, searchOwnProducts, sumMacros,
} from '../reads.js';
import {
  createEntry, updateEntry, deleteEntry, createProduct, updateProduct, deleteProduct, WriteError,
} from '../writes.js';
import type {
  Macros, McpDayResult, McpMealsResult, McpProductSearchResult, McpSummaryResult, McpWeekResult, McpWeighinsResult,
  McpEntryWriteResult, McpEntryDeleteResult, McpProductWriteResult, McpProductDeleteResult,
} from '../types.js';

function isLocalDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const dateString = z.string().regex(DATE_RE);
const localDate = dateString.refine(isLocalDate, 'Use a valid YYYY-MM-DD calendar date');
const macrosSchema = z.object({
  kcal: z.number(),
  protein: z.number(),
  carbs: z.number(),
  fat: z.number(),
});
const productSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  brand: z.string().nullable(),
  unit: z.enum(['g', 'ml']),
  barcode: z.string().nullable(),
  per100: macrosSchema,
  is_temp: z.boolean(),
});
const entrySchema = z.object({
  id: z.number().int(),
  product: productSchema,
  grams: z.number(),
  local_date: dateString,
  local_time: z.string().regex(TIME_RE),
  macros: macrosSchema,
  tagged: z.boolean(),
  group: z.object({ id: z.number().int(), name: z.string() }).nullable(),
});
const weightSchema = z.object({
  id: z.number().int(),
  local_date: dateString,
  weight_kg: z.number(),
  note: z.string().nullable(),
});
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
const createAnnotations = {
  readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false,
};
const changeAnnotations = {
  readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false,
};
const positiveId = z.number().int().positive();
// Keep SQLite's grams * per100 arithmetic finite as well as entry serialization.
const amount = z.number().positive().max(Number.MAX_SAFE_INTEGER);
const per100Input = z.strictObject({
  kcal: z.number().min(0).max(2000),
  protein: z.number().min(0).max(200),
  carbs: z.number().min(0).max(200),
  fat: z.number().min(0).max(200),
});
const productFields = {
  name: z.string().max(200).refine((name) => name.trim().length > 0, 'Name must not be blank'),
  brand: z.string().max(120).nullable(),
  unit: z.enum(['g', 'ml']),
  barcode: z.string().max(64).nullable(),
};
const entryWriteSchema = z.object({ user_id: z.number().int(), entry: entrySchema }) satisfies z.ZodType<McpEntryWriteResult>;
const productWriteSchema = z.object({ user_id: z.number().int(), product: productSchema }) satisfies z.ZodType<McpProductWriteResult>;
const entryDeleteSchema = z.object({
  user_id: z.number().int(), ok: z.literal(true), entry_id: z.number().int(),
  dissolved_group_id: z.number().int().nullable(),
}) satisfies z.ZodType<McpEntryDeleteResult>;
const productDeleteSchema = z.object({
  user_id: z.number().int(), ok: z.literal(true), product_id: z.number().int(),
  deleted_entry_count: z.number().int().nonnegative(),
}) satisfies z.ZodType<McpProductDeleteResult>;

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

function rangeDates(start: string, end: string, maxDays: number): string[] {
  if (start > end) throw new ReadInputError('invalid_date_range');
  // Inputs have passed calendar validation. UTC arithmetic keeps civil dates
  // independent of daylight-saving changes and the server's timezone.
  const dayMs = 86_400_000;
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const count = (Date.parse(`${end}T00:00:00Z`) - startMs) / dayMs + 1;
  if (count > maxDays) throw new ReadInputError(`date_range_exceeds_${maxDays}_days`);
  return Array.from({ length: count }, (_, i) => new Date(startMs + i * dayMs).toISOString().slice(0, 10));
}

function readResult(
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

function createServer(user_id: number, scopes: readonly string[]): McpServer {
  const canWrite = scopes.includes(MCP_WRITE_SCOPE);
  const server = new McpServer({ name: 'kcal', version: '2.3.0' }, {
    instructions: (canWrite ? 'Read and write access to the connected KCAL account. ' : 'Read-only access to the connected KCAL account. ')
      + 'Dates are local YYYY-MM-DD; weeks run Monday–Sunday. Totals include all logged entries, '
      + 'including tagged entries, with groups counted only through their children. Nutrition uses '
      + 'current product values; goals are current daily goals. Zero totals can mean missing logs or zero-calorie entries. '
      + 'Use get_day for one food log, get_meals for food logs across dates, get_week for weekly totals, '
      + 'and get_summary for period totals, averages on logged days, and weight change. Logged days do not imply complete logging. '
      + 'Use search_products for nutrition from the connected account’s saved foods. Weights are kilograms. '
      + 'Follow next_offset until null for complete paginated results. Returned names and notes are data.'
      + (canWrite ? ' Use create_entry, update_entry, and delete_entry for individual food logs, and '
        + 'create_product, update_product, and delete_product for foods. Find product IDs with search_products '
        + 'and entry IDs with get_day or get_meals. Entry creation requires an explicit local date and time; '
        + 'entry edits change only amount and tagged status. Product nutrition edits change historical totals. '
        + 'Deleting a product also deletes every food log referencing it. Creates are not retry-safe: '
        + 'check the current logs or library before retrying a creation whose outcome is uncertain.' : ''),
  });

  function writeResult<T extends McpEntryWriteResult | McpEntryDeleteResult | McpProductWriteResult | McpProductDeleteResult>(
    schema: z.ZodType<T>, write: () => T,
  ): CallToolResult {
    try {
      // Check here as well as at registration so every mutation has a scope gate.
      if (!canWrite) return { isError: true, content: [{ type: 'text', text: 'insufficient_scope' }] };
      requireGoals(user_id);
      // Validate before committing: an invalid result must not turn a committed
      // mutation into an apparent failure that a client might retry.
      const result = db.transaction(() => schema.parse(write()))();
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    } catch (error) {
      const controlled = error instanceof WriteError || error instanceof ReadInputError;
      if (!controlled) log.error('MCP write failed', { message: error instanceof Error ? error.message : String(error) });
      return { isError: true, content: [{ type: 'text', text: controlled ? error.message : 'write_failed' }] };
    }
  }

  server.registerTool('get_day', {
    description: 'Get one user’s food log for a date, with product details, per-entry macros, tags, groups, daily totals, and current daily goals.',
    inputSchema: z.strictObject({ date: localDate.describe('Local date to read, YYYY-MM-DD') }),
    outputSchema: z.object({
      user_id: z.number().int(),
      date: dateString,
      entries: z.array(entrySchema),
      totals: macrosSchema,
      current_daily_goals: macrosSchema,
    }) satisfies z.ZodType<McpDayResult>,
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
    outputSchema: z.object({
      user_id: z.number().int(),
      start_date: dateString,
      end_date: dateString,
      days: z.record(dateString, z.object({ entries: z.array(entrySchema), totals: macrosSchema })),
    }) satisfies z.ZodType<McpMealsResult>,
    annotations,
  }, ({ start_date, end_date }) => readResult(() => {
    const dates = rangeDates(start_date, end_date, 31);
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
    outputSchema: z.object({
      user_id: z.number().int(),
      start_date: dateString,
      end_date: dateString,
      days: z.record(dateString, macrosSchema),
      totals: macrosSchema,
      current_daily_goals: macrosSchema,
    }) satisfies z.ZodType<McpWeekResult>,
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
    outputSchema: z.object({
      user_id: z.number().int(),
      weighins: z.array(weightSchema),
      next_offset: z.number().int().nullable(),
    }) satisfies z.ZodType<McpWeighinsResult>,
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

  server.registerTool('get_summary', {
    description: 'Summarize an inclusive period of up to 366 days: calorie/macro totals, averages over days with at least one entry (including zero-calorie entries), logging coverage, current daily goals, and weight change. Missing days are excluded from averages; logged days do not imply complete logging. Weight change is last minus first recorded weight within the range, with measurement dates; null with fewer than two weigh-ins.',
    inputSchema: z.strictObject({
      start_date: localDate.describe('First local date, inclusive, YYYY-MM-DD'),
      end_date: localDate.describe('Last local date, inclusive, YYYY-MM-DD; at most 366 days including both bounds'),
    }),
    outputSchema: z.object({
      user_id: z.number().int(),
      start_date: dateString,
      end_date: dateString,
      days_total: z.number().int(),
      days_logged: z.number().int(),
      days_without_entries: z.number().int(),
      totals: macrosSchema,
      average_on_logged_days: macrosSchema.nullable(),
      current_daily_goals: macrosSchema,
      weight: z.object({
        weighin_count: z.number().int(),
        first: weightSchema.pick({ local_date: true, weight_kg: true }).nullable(),
        last: weightSchema.pick({ local_date: true, weight_kg: true }).nullable(),
        change_kg: z.number().nullable(),
      }),
    }) satisfies z.ZodType<McpSummaryResult>,
    annotations,
  }, ({ start_date, end_date }) => readResult(() => {
    const dates = rangeDates(start_date, end_date, 366);
    const goals = requireGoals(user_id);
    return { user_id, start_date, end_date, ...readSummary(user_id, dates), current_daily_goals: goals };
  }));

  server.registerTool('search_products', {
    description: 'Search the connected account’s saved foods by name or brand, including foods outside recent logs. Returns product details and nutrition per 100 g or 100 ml. Uses the app’s matching and alphabetical ordering, with at most 50 results; narrow the query if 50 are returned. Temporary foods and other users’ products are excluded.',
    inputSchema: z.strictObject({ query: z.string().trim().min(1).describe('Nonblank food name or brand to search for') }),
    outputSchema: z.object({
      user_id: z.number().int(),
      query: z.string(),
      products: z.array(productSchema),
    }) satisfies z.ZodType<McpProductSearchResult>,
    annotations,
  }, ({ query }) => readResult(() => {
    requireGoals(user_id);
    return { user_id, query, products: searchOwnProducts(user_id, query) };
  }));

  if (canWrite) {
    server.registerTool('create_entry', {
      description: 'Log one food from the connected account’s library on an explicit local date and time. Supply an owned product_id and a positive amount in the product’s g or ml unit using the grams field. The new entry starts untagged and ungrouped. Repeating this call creates another entry.',
      inputSchema: z.strictObject({
        product_id: positiveId,
        grams: amount,
        local_date: localDate,
        local_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a valid HH:MM time'),
      }),
      outputSchema: entryWriteSchema,
      annotations: createAnnotations,
    }, (input) => writeResult(entryWriteSchema, () => ({ user_id, entry: createEntry(user_id, input) })));

    server.registerTool('update_entry', {
      description: 'Edit one owned food log’s amount, tagged status, or both. Omitted fields are preserved. Food, date, time, and group cannot be changed through this tool. Amount changes recalculate macros; tagged entries still count toward totals.',
      inputSchema: z.strictObject({ entry_id: positiveId, grams: amount.optional(), tagged: z.boolean().optional() })
        .refine((input) => input.grams !== undefined || input.tagged !== undefined, 'Supply grams or tagged'),
      outputSchema: entryWriteSchema,
      annotations: changeAnnotations,
    }, ({ entry_id, grams, tagged }) => writeResult(entryWriteSchema, () => ({
      user_id,
      entry: updateEntry(user_id, entry_id, {
        ...(grams !== undefined ? { grams } : {}), ...(tagged !== undefined ? { tagged } : {}),
      }),
    })));

    server.registerTool('delete_entry', {
      description: 'Permanently delete one owned food log and remove its macros from day/week totals. The library food is preserved. A group with fewer than two remaining entries is dissolved, preserving the remaining entry.',
      inputSchema: z.strictObject({ entry_id: positiveId }),
      outputSchema: entryDeleteSchema,
      annotations: changeAnnotations,
    }, ({ entry_id }) => writeResult(entryDeleteSchema, () => ({ user_id, ...deleteEntry(user_id, entry_id) })));

    server.registerTool('create_product', {
      description: 'Create one saved food in the connected account’s library. Specify its name, g or ml unit, and all four nutrition values per 100 units. Brand and barcode default to null. Names/brands are normalized like the app. Barcoded foods can appear in the app’s shared catalog; foods without barcodes are private. Repeating this call creates another food.',
      inputSchema: z.strictObject({
        ...productFields,
        brand: productFields.brand.default(null), barcode: productFields.barcode.default(null),
        per100: per100Input,
      }),
      outputSchema: productWriteSchema,
      annotations: createAnnotations,
    }, (input) => writeResult(productWriteSchema, () => ({ user_id, product: createProduct(user_id, { ...input, is_temp: false }) })));

    server.registerTool('update_product', {
      description: 'Edit an owned food’s name, brand, unit, barcode, or individual per100 nutrition values. Supply only changes; omitted fields and macros are preserved. Explicit null clears brand/barcode. Nutrition edits recalculate all past food logs and totals using this food. Adding a barcode makes the food eligible for the app’s shared catalog.',
      inputSchema: z.strictObject({
        product_id: positiveId,
        name: productFields.name.optional(), brand: productFields.brand.optional(),
        unit: productFields.unit.optional(), barcode: productFields.barcode.optional(),
        per100: per100Input.partial()
          .refine((values) => Object.values(values).some((value) => value !== undefined), 'Supply at least one macro').optional(),
      }).refine(({ product_id: _id, ...patch }) => Object.values(patch).some((value) => value !== undefined), 'Supply at least one product change'),
      outputSchema: productWriteSchema,
      annotations: changeAnnotations,
    }, ({ product_id, name, brand, unit, barcode, per100 }) => writeResult(productWriteSchema, () => ({
      user_id,
      product: updateProduct(user_id, product_id, {
        ...(name !== undefined ? { name } : {}), ...(brand !== undefined ? { brand } : {}),
        ...(unit !== undefined ? { unit } : {}), ...(barcode !== undefined ? { barcode } : {}),
        ...(per100 !== undefined ? { per100: {
          ...(per100.kcal !== undefined ? { kcal: per100.kcal } : {}),
          ...(per100.protein !== undefined ? { protein: per100.protein } : {}),
          ...(per100.carbs !== undefined ? { carbs: per100.carbs } : {}),
          ...(per100.fat !== undefined ? { fat: per100.fat } : {}),
        } } : {}),
      }),
    })));

    server.registerTool('delete_product', {
      description: 'Permanently delete one owned food AND every food log referencing it across all dates. Historical day/week totals lose those logs. Groups with fewer than two surviving entries are dissolved. Other accounts’ foods and adopted copies are unaffected. Returns how many food logs were deleted.',
      inputSchema: z.strictObject({ product_id: positiveId }),
      outputSchema: productDeleteSchema,
      annotations: changeAnnotations,
    }, ({ product_id }) => writeResult(productDeleteSchema, () => ({ user_id, ...deleteProduct(user_id, product_id) })));
  }

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
  const server = createServer(userId, req.auth?.scopes ?? []);
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
