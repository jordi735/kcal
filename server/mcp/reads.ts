// Read-only MCP tools. Their account comes from verified OAuth credentials.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { isLocalDate } from '../../shared/constraints.js';
import {
  readDailyTotals, readDayEntries, readSummary, readWeightPage, searchOwnProducts, sumMacros,
} from '../reads.js';
import type {
  McpDayResult, McpMealsResult, McpProductSearchResult, McpSummaryResult, McpWeekResult, McpWeighinsResult,
} from '../types.js';
import { ReadInputError, requireGoals, readResult } from './results.js';
import {
  dateString, localDate, macrosSchema, productSchema, entrySchema, weightSchema,
  pagination, annotations,
} from './schemas.js';

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

export function registerReadTools(server: McpServer, user_id: number): void {
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
}
