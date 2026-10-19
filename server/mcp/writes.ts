// MCP mutations share application writes and validate output before committing.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { db } from '../db.js';
import { WriteError } from '../errors.js';
import { log } from '../log.js';
import { createWithReceipt } from '../idempotency.js';
import { normalizeEntryGroupName } from '../../shared/normalize.js';
import { parseProductText } from '../../shared/productText.js';
import {
  createEntries, updateEntry, deleteEntry, createProduct, updateProduct, deleteProduct,
  createEntryGroup, updateEntryGroup, ungroupEntries, deleteEntryGroup,
} from '../writes.js';
import type {
  McpEntryWriteResult, McpEntryDeleteResult, McpProductWriteResult, McpProductDeleteResult,
  McpEntryGroupResult, McpUngroupResult, McpEntryGroupDeleteResult,
  McpCreationReceipt,
} from '../types.js';
import { ReadInputError, requireAccount } from './results.js';
import { toMcpEntry } from './entries.js';
import {
  localDate, localTime, createAnnotations, changeAnnotations, positiveId, amount, idempotencyKey,
  entryGroupName, per100Input, productFields, entryWriteSchema, productWriteSchema,
  entryDeleteSchema, productDeleteSchema, entryGroupResultSchema, ungroupResultSchema,
  entryGroupDeleteSchema, entriesCreateSchema, productCreateSchema, entryGroupCreateSchema,
} from './schemas.js';

export function registerWriteTools(server: McpServer, user_id: number, canWrite: boolean): void {
  function mutationResult<T extends Record<string, unknown>>(toolName: string, write: () => T): CallToolResult {
    try {
      // Check here as well as at registration so every mutation has a scope gate.
      if (!canWrite) return { isError: true, content: [{ type: 'text', text: 'insufficient_scope' }] };
      requireAccount(user_id);
      const result = write();
      const replayed = (result as { receipt?: McpCreationReceipt }).receipt?.replayed === true;
      // Shared writes may run under a batch/receipt transaction. Emit success
      // only after that outer transaction has committed, never for its savepoints.
      log.info(replayed ? 'MCP creation replayed' : 'MCP mutation committed', { userId: user_id, toolName });
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    } catch (error) {
      const controlled = error instanceof WriteError || error instanceof ReadInputError;
      if (!controlled) log.error('MCP write failed', { message: error instanceof Error ? error.message : String(error) });
      return { isError: true, content: [{ type: 'text', text: controlled ? error.message : 'write_failed' }] };
    }
  }

  function writeResult<T extends McpEntryWriteResult | McpEntryDeleteResult | McpProductWriteResult | McpProductDeleteResult
    | McpEntryGroupResult | McpUngroupResult | McpEntryGroupDeleteResult>(
    toolName: string, schema: z.ZodType<T>, write: () => T,
  ): CallToolResult {
    return mutationResult(toolName, () => db.transaction(() => schema.parse(write()))());
  }

  function createResult<T extends Record<string, unknown> & { receipt: McpCreationReceipt }>(
    toolName: string, key: string, normalizedInput: unknown, schema: z.ZodType<T>,
    write: (receipt: McpCreationReceipt) => T,
  ): CallToolResult {
    return mutationResult(toolName, () => createWithReceipt(user_id, toolName, key, normalizedInput, schema, write));
  }

  if (canWrite) {
    server.registerTool('create_entries', {
      description: 'Atomically log 1–50 saved foods from the connected account’s library at one explicit local date and time. Each item supplies an owned, non-temporary product_id and amount (the amount in its g or ml unit, at least 1; decimals allowed). Duplicate foods create distinct entries in input order. Optional group_name groups all new entries and requires at least two items. Either every entry and group is saved or none is. Reuse idempotency_key and the same arguments to retry; a new key creates new logs. Totals describe only the new entries.',
      inputSchema: z.strictObject({
        idempotency_key: idempotencyKey,
        entries: z.array(z.strictObject({ product_id: positiveId, amount: amount })).min(1).max(50),
        local_date: localDate,
        local_time: localTime,
        group_name: entryGroupName.optional(),
      }).refine((input) => input.group_name === undefined || input.entries.length >= 2, 'A group requires at least two entries'),
      outputSchema: entriesCreateSchema,
      annotations: createAnnotations,
    }, ({ idempotency_key, group_name, ...input }) => {
      const normalized = { ...input, ...(group_name === undefined ? {} : { group_name: normalizeEntryGroupName(group_name) }) };
      return createResult('create_entries', idempotency_key, normalized, entriesCreateSchema, (receipt) => {
        const result = createEntries(user_id, normalized);
        return { user_id, ...result, entries: result.entries.map(toMcpEntry), receipt };
      });
    });

    server.registerTool('update_entry', {
      description: 'Correct one owned food log without recreating it, including an existing temporary log. Supply entry_id and at least one of amount, product_id, or local_time (HH:MM). Amount uses the food’s g or ml unit, at least 1; decimals are allowed. A replacement product must be an owned saved food. Replacing food across g/ml units requires an explicit amount; there is no automatic conversion. Omitted fields are preserved. Amount or food changes recalculate nutrition. Entry ID, local date, creation time, and group membership remain unchanged; morning and evening entries can stay grouped.',
      inputSchema: z.strictObject({
        entry_id: positiveId, amount: amount.optional(), product_id: positiveId.optional(), local_time: localTime.optional(),
      }).refine(({ entry_id: _id, ...patch }) => Object.values(patch).some((value) => value !== undefined), 'Supply at least one entry change'),
      outputSchema: entryWriteSchema,
      annotations: changeAnnotations,
    }, ({ entry_id, amount, product_id, local_time }) => writeResult('update_entry', entryWriteSchema, () => ({
      user_id,
      entry: toMcpEntry(updateEntry(user_id, entry_id, {
        ...(amount === undefined ? {} : { amount }),
        ...(product_id === undefined ? {} : { product_id }),
        ...(local_time === undefined ? {} : { local_time }),
      })),
    })));

    server.registerTool('delete_entry', {
      description: 'Permanently delete one owned food log and remove its macros from day/week totals. The library food is preserved. A group with fewer than two remaining entries is dissolved, preserving the remaining entry.',
      inputSchema: z.strictObject({ entry_id: positiveId }),
      outputSchema: entryDeleteSchema,
      annotations: changeAnnotations,
    }, ({ entry_id }) => writeResult('delete_entry', entryDeleteSchema, () => ({ user_id, ...deleteEntry(user_id, entry_id) })));

    server.registerTool('create_product', {
      description: 'Create one saved food in the connected account’s library. Specify its name, g or ml unit, and all four nutrition values per 100 units. Brand and barcode default to null. Names/brands are normalized like the app. Barcoded foods can appear in the app’s shared catalog; foods without barcodes are private. Reuse idempotency_key with the same arguments to retry; a new key creates a new food.',
      inputSchema: z.strictObject({
        idempotency_key: idempotencyKey,
        ...productFields,
        brand: productFields.brand.default(null), barcode: productFields.barcode.default(null),
        per100: per100Input,
      }),
      outputSchema: productCreateSchema,
      annotations: createAnnotations,
    }, ({ idempotency_key, ...input }) => {
      // The input schema has already validated every field through this policy.
      const normalized = { ...input, ...parseProductText(input)! };
      return createResult('create_product', idempotency_key, normalized, productCreateSchema, (receipt) => ({
        user_id, product: createProduct(user_id, { ...normalized, is_temp: false }), receipt,
      }));
    });

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
    }, ({ product_id, name, brand, unit, barcode, per100 }) => writeResult('update_product', productWriteSchema, () => ({
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
    }, ({ product_id }) => writeResult('delete_product', productDeleteSchema, () => ({ user_id, ...deleteProduct(user_id, product_id) })));

    server.registerTool('create_entry_group', {
      description: 'Combine at least two existing food logs into one named group, matching Group items in the app. Supply unique, owned, currently ungrouped entry IDs from one valid local date; the date is derived from the entries. Saved and temporary food logs can be grouped. Nesting and silent regrouping are rejected. Entries, amounts, and day/week totals are preserved; group nutrition derives from its children. Reuse idempotency_key and the same membership/name to retry.',
      inputSchema: z.strictObject({
        idempotency_key: idempotencyKey,
        name: entryGroupName,
        entry_ids: z.array(positiveId).min(2).refine((ids) => new Set(ids).size === ids.length, 'Entry IDs must be unique'),
      }),
      outputSchema: entryGroupCreateSchema,
      annotations: createAnnotations,
    }, ({ idempotency_key, name, entry_ids }) => {
      const normalized = { name: normalizeEntryGroupName(name), entry_ids: [...entry_ids].sort((a, b) => a - b) };
      return createResult('create_entry_group', idempotency_key, normalized, entryGroupCreateSchema, (receipt) => {
        const result = createEntryGroup(user_id, normalized.name, normalized.entry_ids);
        return { user_id, ...result, entries: result.entries.map(toMcpEntry), receipt };
      });
    });

    server.registerTool('update_entry_group', {
      description: 'Rename one owned entry group, matching Edit group in the app. This changes only its name; children, amounts, date, and totals are preserved. Membership, date, group portions, and group nutrition cannot be edited.',
      inputSchema: z.strictObject({ group_id: positiveId, name: entryGroupName }),
      outputSchema: entryGroupResultSchema,
      annotations: changeAnnotations,
    }, ({ group_id, name }) => writeResult('update_entry_group', entryGroupResultSchema, () => {
      const result = updateEntryGroup(user_id, group_id, name);
      return { user_id, ...result, entries: result.entries.map(toMcpEntry) };
    }));

    server.registerTool('ungroup_entries', {
      description: 'Remove one owned entry group while preserving every food log, matching Ungroup in the app. Only group metadata is removed; children keep their IDs, products, amounts, dates, and times. Totals do not change. Returns the former children with group=null. To remove the food logs instead, use delete_entry_group.',
      inputSchema: z.strictObject({ group_id: positiveId }),
      outputSchema: ungroupResultSchema,
      annotations: changeAnnotations,
    }, ({ group_id }) => writeResult('ungroup_entries', ungroupResultSchema, () => {
      const result = ungroupEntries(user_id, group_id);
      return { user_id, ...result, entries: result.entries.map(toMcpEntry) };
    }));

    server.registerTool('delete_entry_group', {
      description: 'Permanently delete an owned entry group AND every food log in that group, matching selecting the group parent and pressing Delete in the app. Removes those logs from day/week totals, preserves library products and unrelated logs, and returns the deleted entry IDs. Use ungroup_entries to preserve the food logs instead.',
      inputSchema: z.strictObject({ group_id: positiveId }),
      outputSchema: entryGroupDeleteSchema,
      annotations: changeAnnotations,
    }, ({ group_id }) => writeResult('delete_entry_group', entryGroupDeleteSchema, () => ({ user_id, ...deleteEntryGroup(user_id, group_id) })));
  }
}
