// MCP input/output schemas and tool annotations. Keep the public contracts here.

import { z } from 'zod';
import {
  isLocalDate, MIN_ENTRY_AMOUNT, parseEntryGroupName, MAX_PRODUCT_BARCODE_LENGTH,
  MAX_PRODUCT_BRAND_LENGTH, MAX_PRODUCT_KCAL_PER100, MAX_PRODUCT_MACRO_GRAMS_PER100,
  MAX_PRODUCT_NAME_LENGTH, MAX_ENTRY_AMOUNT, isLocalTime,
} from '../../shared/constraints.js';
import { parseProductBrand, parseProductName } from '../../shared/productText.js';
import { DATE_RE, TIME_RE } from '../guards.js';
import type {
  McpEntry, McpEntryWriteResult, McpEntryDeleteResult, McpProductWriteResult, McpProductDeleteResult,
  McpEntryGroupResult, McpUngroupResult, McpEntryGroupDeleteResult,
  McpCreationReceipt, McpEntriesCreateResult, McpProductCreateResult, McpEntryGroupCreateResult,
} from '../types.js';

export const dateString = z.string().regex(DATE_RE);
export const localDate = dateString.refine(isLocalDate, 'Use a valid YYYY-MM-DD calendar date');
export const localTime = z.string().refine(isLocalTime, 'Use a valid HH:MM time');
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
export const productTemplateSchema = productSchema.omit({ id: true, is_temp: true });
export const entryGroupSchema = z.object({
  id: z.number().int(), name: z.string(), local_date: dateString,
});
export const entrySchema = z.object({
  id: z.number().int(),
  product: productSchema,
  grams: z.number(),
  local_date: dateString,
  local_time: z.string().regex(TIME_RE),
  macros: macrosSchema,
  group: z.object({ id: z.number().int(), name: z.string() }).nullable(),
}) satisfies z.ZodType<McpEntry>;
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
  readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false,
};
export const changeAnnotations = {
  readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false,
};
export const positiveId = z.number().int().positive();
// Keep SQLite's grams * per100 arithmetic finite as well as entry serialization.
export const amount = z.number().min(MIN_ENTRY_AMOUNT).max(MAX_ENTRY_AMOUNT);
export const idempotencyKey = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/)
  .describe('Unique operation key for this account; a UUID is recommended. Reuse the same key and arguments only when retrying this operation.');
export const receiptSchema = z.object({
  idempotency_key: idempotencyKey,
  applied_at: z.iso.datetime(),
  replayed: z.boolean(),
}) satisfies z.ZodType<McpCreationReceipt>;
export const entryGroupName = z.string()
  .refine((name) => parseEntryGroupName(name) !== null, 'Use a group name of 1–64 characters after whitespace normalization')
  .describe('Group name; trim and collapse whitespace, preserve casing, 1–64 characters after normalization');
export const per100Input = z.strictObject({
  kcal: z.number().min(0).max(MAX_PRODUCT_KCAL_PER100),
  protein: z.number().min(0).max(MAX_PRODUCT_MACRO_GRAMS_PER100),
  carbs: z.number().min(0).max(MAX_PRODUCT_MACRO_GRAMS_PER100),
  fat: z.number().min(0).max(MAX_PRODUCT_MACRO_GRAMS_PER100),
});
export const productFields = {
  name: z.string().max(MAX_PRODUCT_NAME_LENGTH).refine((name) => parseProductName(name) !== null,
    'Use a nonblank name within the normalized length limit'),
  brand: z.string().max(MAX_PRODUCT_BRAND_LENGTH).nullable()
    .refine((brand) => parseProductBrand(brand) !== null, 'Brand exceeds the normalized length limit'),
  unit: z.enum(['g', 'ml']),
  barcode: z.string().max(MAX_PRODUCT_BARCODE_LENGTH).nullable(),
};
export const entryWriteSchema = z.object({ user_id: z.number().int(), entry: entrySchema }) satisfies z.ZodType<McpEntryWriteResult>;
export const productWriteSchema = z.object({ user_id: z.number().int(), product: productSchema }) satisfies z.ZodType<McpProductWriteResult>;
export const productCreateSchema = productWriteSchema.extend({ receipt: receiptSchema }) satisfies z.ZodType<McpProductCreateResult>;
export const entriesCreateSchema = z.object({
  user_id: z.number().int(), entries: z.array(entrySchema), group: entryGroupSchema.nullable(),
  totals: macrosSchema, receipt: receiptSchema,
}) satisfies z.ZodType<McpEntriesCreateResult>;
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
export const entryGroupCreateSchema = entryGroupResultSchema.extend({ receipt: receiptSchema }) satisfies z.ZodType<McpEntryGroupCreateResult>;
export const ungroupResultSchema = z.object({
  user_id: z.number().int(), ok: z.literal(true), group_id: z.number().int(), entries: z.array(entrySchema),
}) satisfies z.ZodType<McpUngroupResult>;
export const entryGroupDeleteSchema = z.object({
  user_id: z.number().int(), ok: z.literal(true), group_id: z.number().int(), deleted_entry_ids: z.array(z.number().int()),
}) satisfies z.ZodType<McpEntryGroupDeleteResult>;
