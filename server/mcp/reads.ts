// Read-only MCP tools. Their account comes from verified OAuth credentials.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { MAX_PRODUCT_BARCODE_LENGTH, MAX_PRODUCT_SEARCH_QUERY_LENGTH } from '../../shared/constraints.js';
import { rangeDates, weekDates } from '../../shared/dates.js';
import { resolveGoals } from '../../shared/goals.js';
import { readGoalHistory } from '../goals.js';
import { lookupBarcode, searchProductPage } from '../products.js';
import {
  readDailyTotals, readDayEntries, readSummary, readWeightPage, sumMacros,
} from '../reads.js';
import type {
  McpDayResult, McpMealsResult, McpProductSearchResult, McpSummaryResult, McpWeekResult, McpWeighinsResult,
} from '../types.js';
import { ReadInputError, requireAccount, readResult } from './results.js';
import { toMcpEntry } from './entries.js';
import {
  dateString, localDate, macrosSchema, productSchema, entrySchema, weightSchema,
  pagination, annotations, productTemplateSchema,
} from './schemas.js';

export function registerReadTools(server: McpServer, user_id: number): void {
  server.registerTool('get_day', {
    description: 'Get the connected account’s food log for a date, with product details, per-entry macros, groups, daily totals, and goals effective on that date. Goals are null before known history. Totals include all logged entries. Logs do not prove actual consumption or complete logging.',
    inputSchema: z.strictObject({ date: localDate.describe('Local date to read, YYYY-MM-DD') }),
    outputSchema: z.object({
      user_id: z.number().int(),
      date: dateString,
      entries: z.array(entrySchema),
      totals: macrosSchema,
      daily_goals: macrosSchema.nullable(),
    }) satisfies z.ZodType<McpDayResult>,
    annotations,
  }, ({ date }) => readResult(() => {
    requireAccount(user_id);
    const entries = readDayEntries(user_id, date).map(toMcpEntry);
    return {
      user_id, date, entries,
      totals: sumMacros(entries.map((entry) => entry.macros)),
      daily_goals: resolveGoals(readGoalHistory(user_id), date),
    };
  }));

  server.registerTool('get_meals', {
    description: 'Get the connected account’s food logs by day across an inclusive date range of up to 31 days. Each date includes food names, amounts, times, macros, group references, daily totals, and goals effective on that date (null before known history). Meals means logged foods, including named groups. Totals include all logged entries. Logs do not prove actual consumption or complete logging. Empty days have no entries and zero totals.',
    inputSchema: z.strictObject({
      start_date: localDate.describe('First local date to read, inclusive, YYYY-MM-DD'),
      end_date: localDate.describe('Last local date to read, inclusive, YYYY-MM-DD; at most 31 days including both bounds'),
    }),
    outputSchema: z.object({
      user_id: z.number().int(),
      start_date: dateString,
      end_date: dateString,
      days: z.record(dateString, z.object({ entries: z.array(entrySchema), totals: macrosSchema, daily_goals: macrosSchema.nullable() })),
    }) satisfies z.ZodType<McpMealsResult>,
    annotations,
  }, ({ start_date, end_date }) => readResult(() => {
    const dates = rangeDates(start_date, end_date, 31);
    requireAccount(user_id);
    const history = readGoalHistory(user_id);
    const days = Object.fromEntries(dates.map((date) => {
      const entries = readDayEntries(user_id, date).map(toMcpEntry);
      return [date, { entries, totals: sumMacros(entries.map((entry) => entry.macros)), daily_goals: resolveGoals(history, date) }];
    }));
    return { user_id, start_date, end_date, days };
  }));

  server.registerTool('get_week', {
    description: 'Get seven daily calorie/macro totals and a weekly total for the Monday–Sunday containing a date. Each day includes its effective goals, or null before known history; use get_day for food details.',
    inputSchema: z.strictObject({ date: localDate.describe('Any local date in the requested week, YYYY-MM-DD') }),
    outputSchema: z.object({
      user_id: z.number().int(),
      start_date: dateString,
      end_date: dateString,
      days: z.record(dateString, z.object({ totals: macrosSchema, daily_goals: macrosSchema.nullable() })),
      totals: macrosSchema,
    }) satisfies z.ZodType<McpWeekResult>,
    annotations,
  }, ({ date }) => readResult(() => {
    requireAccount(user_id);
    const dates = weekDates(date);
    const totals = readDailyTotals(user_id, dates);
    const history = readGoalHistory(user_id);
    const days = Object.fromEntries(dates.map((date) => [date, { totals: totals[date]!, daily_goals: resolveGoals(history, date) }]));
    return {
      user_id, start_date: dates[0]!, end_date: dates[6]!, days,
      totals: sumMacros(Object.values(totals)),
    };
  }));

  server.registerTool('get_weighins', {
    description: 'Get one user’s weight history in kilograms, with dates, notes, and peed/pooped flags for before each weigh-in, newest first. Date bounds are inclusive; omitted bounds include all dates. Follow next_offset for more records.',
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
    requireAccount(user_id);
    const rows = readWeightPage(user_id, start, end, limit + 1, offset);
    return {
      user_id, weighins: rows.slice(0, limit),
      next_offset: rows.length > limit ? offset + limit : null,
    };
  }));

  server.registerTool('get_summary', {
    description: 'Summarize an inclusive period of up to 366 days: calorie/macro totals, averages over logged days (including zero-calorie entries), logging coverage, goal periods, and weight change. Goal comparisons use only dates with both an entry and known goals; comparison totals are null when no dates qualify. Missing-log days are excluded, and logged days do not imply complete logging. Weight change is last minus first in-range measurement, or null with fewer than two weigh-ins.',
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
      goal_periods: z.array(z.object({ start_date: dateString, end_date: dateString, daily_goals: macrosSchema.nullable() })),
      goal_comparison: z.object({
        days_compared: z.number().int().nonnegative(),
        logged_totals: macrosSchema.nullable(),
        goal_totals: macrosSchema.nullable(),
      }),
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
    requireAccount(user_id);
    return {
      user_id, start_date, end_date, ...readSummary(user_id, dates),
    };
  }));

  server.registerTool('search_products', {
    description: 'Browse or search owned saved foods by literal name/brand terms, sorted by name or most recent logging. Every whitespace-separated query term must occur in the name or brand, in any order; punctuation and accents remain literal. Omit query to browse; recent includes only previously logged saved foods. Follow next_offset for more. Alternatively supply only barcode for exact lookup: returns an owned saved food, a safe shared template without an ID, or no match. Barcode lookup never creates or adopts a food. Temporary foods are excluded. Nutrition is per 100 g/ml.',
    inputSchema: z.strictObject({
      query: z.string().max(MAX_PRODUCT_SEARCH_QUERY_LENGTH, { abort: true }).trim().min(1).optional()
        .describe('Literal food name or brand, at most 512 characters before trimming; omit to browse the library'),
      sort: z.enum(['name', 'recent']).optional().describe('Library sort: name (default), or most recently logged saved foods'),
      limit: z.number().int().min(1).max(100).optional().describe('Library page size, 1–100; defaults to 50'),
      offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 100).optional().describe('Library offset; starts at 0, then use next_offset'),
      barcode: z.string().trim().min(1).max(MAX_PRODUCT_BARCODE_LENGTH).optional()
        .describe('Exact barcode, preserving leading zeros; cannot be combined with any other input'),
    }).refine(({ barcode, ...library }) => barcode === undefined || Object.values(library).every((value) => value === undefined), 'Barcode must be the only input'),
    outputSchema: z.object({
      user_id: z.number().int(),
      products: z.array(productSchema),
      template: productTemplateSchema.nullable(),
      next_offset: z.number().int().nullable(),
    }) satisfies z.ZodType<McpProductSearchResult>,
    annotations,
  }, ({ query, sort, limit, offset, barcode }) => readResult(() => {
    requireAccount(user_id);
    if (barcode !== undefined) return { user_id, ...lookupBarcode(user_id, barcode), next_offset: null };
    return {
      user_id, ...searchProductPage(user_id, { ...(query === undefined ? {} : { query }), sort: sort ?? 'name', limit: limit ?? 50, offset: offset ?? 0 }),
      template: null,
    };
  }));
}
