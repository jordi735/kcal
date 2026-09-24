// MCP mutations share application writes and validate output before committing.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { db } from '../db.js';
import { log } from '../log.js';
import {
  createEntry, updateEntry, deleteEntry, createProduct, updateProduct, deleteProduct, WriteError,
  createEntryGroup, updateEntryGroup, ungroupEntries, deleteEntryGroup,
} from '../writes.js';
import type {
  McpEntryWriteResult, McpEntryDeleteResult, McpProductWriteResult, McpProductDeleteResult,
  McpEntryGroupResult, McpUngroupResult, McpEntryGroupDeleteResult,
} from '../types.js';
import { ReadInputError, requireGoals } from './results.js';
import { toMcpEntry } from './entries.js';
import {
  localDate, createAnnotations, changeAnnotations, positiveId, amount,
  entryGroupName, per100Input, productFields, entryWriteSchema, productWriteSchema,
  entryDeleteSchema, productDeleteSchema, entryGroupResultSchema, ungroupResultSchema,
  entryGroupDeleteSchema,
} from './schemas.js';

export function registerWriteTools(server: McpServer, user_id: number, canWrite: boolean): void {
  function writeResult<T extends McpEntryWriteResult | McpEntryDeleteResult | McpProductWriteResult | McpProductDeleteResult
    | McpEntryGroupResult | McpUngroupResult | McpEntryGroupDeleteResult>(
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

  if (canWrite) {
    server.registerTool('create_entry', {
      description: 'Log one saved food from the connected account’s library on an explicit local date and time. Supply an owned, non-temporary product_id and an amount of at least 1 in the product’s g or ml unit using the grams field; decimals are allowed. The new entry starts ungrouped. Existing temporary foods cannot be reused. Repeating this call creates another entry.',
      inputSchema: z.strictObject({
        product_id: positiveId,
        grams: amount,
        local_date: localDate,
        local_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a valid HH:MM time'),
      }),
      outputSchema: entryWriteSchema,
      annotations: createAnnotations,
    }, (input) => writeResult(entryWriteSchema, () => ({ user_id, entry: toMcpEntry(createEntry(user_id, input, true)) })));

    server.registerTool('update_entry', {
      description: 'Edit one owned food log’s amount, including existing temporary logs. Supply entry_id and grams. New amounts must be at least 1 g/ml; decimals are allowed. Food, date, time, and group cannot be changed through this tool. Amount changes recalculate macros and totals.',
      inputSchema: z.strictObject({ entry_id: positiveId, grams: amount }),
      outputSchema: entryWriteSchema,
      annotations: changeAnnotations,
    }, ({ entry_id, grams }) => writeResult(entryWriteSchema, () => ({
      user_id,
      entry: toMcpEntry(updateEntry(user_id, entry_id, { grams })),
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

    server.registerTool('create_entry_group', {
      description: 'Combine at least two existing food logs into one named group, matching Group items in the app. Supply unique, owned, currently ungrouped entry IDs from one valid local date; the date is derived from the entries. Saved and temporary food logs can be grouped. Nesting and silent regrouping are rejected. Entries, amounts, and day/week totals are preserved; group nutrition derives from its children.',
      inputSchema: z.strictObject({
        name: entryGroupName,
        entry_ids: z.array(positiveId).min(2).refine((ids) => new Set(ids).size === ids.length, 'Entry IDs must be unique'),
      }),
      outputSchema: entryGroupResultSchema,
      annotations: createAnnotations,
    }, ({ name, entry_ids }) => writeResult(entryGroupResultSchema, () => {
      const result = createEntryGroup(user_id, name, entry_ids);
      return { user_id, ...result, entries: result.entries.map(toMcpEntry) };
    }));

    server.registerTool('update_entry_group', {
      description: 'Rename one owned entry group, matching Edit group in the app. This changes only its name; children, amounts, date, and totals are preserved. Membership, date, group portions, and group nutrition cannot be edited.',
      inputSchema: z.strictObject({ group_id: positiveId, name: entryGroupName }),
      outputSchema: entryGroupResultSchema,
      annotations: changeAnnotations,
    }, ({ group_id, name }) => writeResult(entryGroupResultSchema, () => {
      const result = updateEntryGroup(user_id, group_id, name);
      return { user_id, ...result, entries: result.entries.map(toMcpEntry) };
    }));

    server.registerTool('ungroup_entries', {
      description: 'Remove one owned entry group while preserving every food log, matching Ungroup in the app. Only group metadata is removed; children keep their IDs, products, amounts, dates, and times. Totals do not change. Returns the former children with group=null. To remove the food logs instead, use delete_entry_group.',
      inputSchema: z.strictObject({ group_id: positiveId }),
      outputSchema: ungroupResultSchema,
      annotations: changeAnnotations,
    }, ({ group_id }) => writeResult(ungroupResultSchema, () => {
      const result = ungroupEntries(user_id, group_id);
      return { user_id, ...result, entries: result.entries.map(toMcpEntry) };
    }));

    server.registerTool('delete_entry_group', {
      description: 'Permanently delete an owned entry group AND every food log in that group, matching selecting the group parent and pressing Delete in the app. Removes those logs from day/week totals, preserves library products and unrelated logs, and returns the deleted entry IDs. Use ungroup_entries to preserve the food logs instead.',
      inputSchema: z.strictObject({ group_id: positiveId }),
      outputSchema: entryGroupDeleteSchema,
      annotations: changeAnnotations,
    }, ({ group_id }) => writeResult(entryGroupDeleteSchema, () => ({ user_id, ...deleteEntryGroup(user_id, group_id) })));
  }
}
