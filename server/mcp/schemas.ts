// MCP input/output schemas and tool annotations. Keep the public contracts here.

import { z } from 'zod';
import { isLocalDate, MIN_ENTRY_AMOUNT, parseEntryGroupName } from '../../shared/constraints.js';
import { DATE_RE, TIME_RE } from '../guards.js';
import type {
  McpEntryWriteResult, McpEntryDeleteResult, McpProductWriteResult, McpProductDeleteResult,
  McpEntryGroupResult, McpUngroupResult, McpEntryGroupDeleteResult,
} from '../types.js';

export const dateString = z.string().regex(DATE_RE);
export const localDate = dateString.refine(isLocalDate, 'Use a valid YYYY-MM-DD calendar date');
export const macrosSchema = z.object({
  kcal: z.number(),
  protein: z.number(),
  carbs: z.number(),
  fat: z.number(),
});
export const productSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  brand: z.string().nullable(),
  unit: z.enum(['g', 'ml']),
  barcode: z.string().nullable(),
  per100: macrosSchema,
  is_temp: z.boolean(),
});
const entryGroupSchema = z.object({
  id: z.number().int(), name: z.string(), local_date: dateString,
});
export const entrySchema = z.object({
  id: z.number().int(),
  product: productSchema,
  grams: z.number(),
  local_date: dateString,
  local_time: z.string().regex(TIME_RE),
  macros: macrosSchema,
  tagged: z.boolean(),
  group: z.object({ id: z.number().int(), name: z.string() }).nullable(),
});
export const weightSchema = z.object({
  id: z.number().int(),
  local_date: dateString,
  weight_kg: z.number(),
  note: z.string().nullable(),
  peed: z.boolean().describe('Whether the user peed before this weigh-in'),
  pooped: z.boolean().describe('Whether the user pooped before this weigh-in'),
});
export const pagination = {
  limit: z.number().int().min(1).max(500).default(100).describe('Maximum records to return, from 1 to 500'),
  offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 500).default(0)
    .describe('Offset returned as next_offset by the previous page'),
};
export const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
export const createAnnotations = {
  readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false,
};
export const changeAnnotations = {
  readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false,
};
export const positiveId = z.number().int().positive();
// Keep SQLite's grams * per100 arithmetic finite as well as entry serialization.
export const amount = z.number().min(MIN_ENTRY_AMOUNT).max(Number.MAX_SAFE_INTEGER);
export const entryGroupName = z.string()
  .refine((name) => parseEntryGroupName(name) !== null, 'Use a group name of 1–64 characters after whitespace normalization')
  .describe('Group name; trim and collapse whitespace, preserve casing, 1–64 characters after normalization');
export const per100Input = z.strictObject({
  kcal: z.number().min(0).max(2000),
  protein: z.number().min(0).max(200),
  carbs: z.number().min(0).max(200),
  fat: z.number().min(0).max(200),
});
export const productFields = {
  name: z.string().max(200).refine((name) => name.trim().length > 0, 'Name must not be blank'),
  brand: z.string().max(120).nullable(),
  unit: z.enum(['g', 'ml']),
  barcode: z.string().max(64).nullable(),
};
export const entryWriteSchema = z.object({ user_id: z.number().int(), entry: entrySchema }) satisfies z.ZodType<McpEntryWriteResult>;
export const productWriteSchema = z.object({ user_id: z.number().int(), product: productSchema }) satisfies z.ZodType<McpProductWriteResult>;
export const entryDeleteSchema = z.object({
  user_id: z.number().int(), ok: z.literal(true), entry_id: z.number().int(),
  dissolved_group_id: z.number().int().nullable(),
}) satisfies z.ZodType<McpEntryDeleteResult>;
export const productDeleteSchema = z.object({
  user_id: z.number().int(), ok: z.literal(true), product_id: z.number().int(),
  deleted_entry_count: z.number().int().nonnegative(),
}) satisfies z.ZodType<McpProductDeleteResult>;
export const entryGroupResultSchema = z.object({
  user_id: z.number().int(), group: entryGroupSchema, entries: z.array(entrySchema),
}) satisfies z.ZodType<McpEntryGroupResult>;
export const ungroupResultSchema = z.object({
  user_id: z.number().int(), ok: z.literal(true), group_id: z.number().int(), entries: z.array(entrySchema),
}) satisfies z.ZodType<McpUngroupResult>;
export const entryGroupDeleteSchema = z.object({
  user_id: z.number().int(), ok: z.literal(true), group_id: z.number().int(), deleted_entry_ids: z.array(z.number().int()),
}) satisfies z.ZodType<McpEntryGroupDeleteResult>;
