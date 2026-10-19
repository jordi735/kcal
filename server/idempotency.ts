// Durable create receipts share the transaction with their business changes.
// These snapshots never participate in current nutrition or goal calculations.

import { createHash } from 'node:crypto';
import type { z } from 'zod';
import { db } from './db.js';
import { statements } from './statements.js';
import { WriteError } from './writes.js';
import type { McpCreationReceipt, McpCreationReceiptRow } from './types.js';

const RECEIPT_SCHEMA_VERSION = 4;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error('Unsupported creation request value');
  return encoded;
}

export function createWithReceipt<T extends { receipt: McpCreationReceipt }>(
  userId: number, toolName: string, key: string, normalizedInput: unknown,
  schema: z.ZodType<T>, create: (receipt: McpCreationReceipt) => T,
): T {
  const requestHash = createHash('sha256').update(canonicalJson({ tool: toolName, input: normalizedInput })).digest('hex');
  return db.transaction(() => {
    const saved = statements.mcpReceipts.select.get(userId, key) as McpCreationReceiptRow | undefined;
    if (saved !== undefined) {
      if (saved.tool_name !== toolName || saved.request_hash !== requestHash) {
        throw new WriteError(409, 'idempotency_key_conflict');
      }
      try {
        if (saved.schema_version !== RECEIPT_SCHEMA_VERSION) throw new Error('Unsupported receipt version');
        const result = schema.parse(JSON.parse(saved.result_json));
        if (result.receipt.idempotency_key !== key
          || result.receipt.applied_at !== new Date(saved.applied_at).toISOString()) {
          throw new Error('Invalid saved receipt metadata');
        }
        return { ...result, receipt: { ...result.receipt, replayed: true } };
      } catch {
        // An unreadable receipt is still proof that the key was consumed.
        throw new WriteError(500, 'idempotency_replay_unavailable');
      }
    }
    const appliedAt = Date.now();
    const receipt = { idempotency_key: key, applied_at: new Date(appliedAt).toISOString(), replayed: false };
    const result = schema.parse(create(receipt));
    const json = JSON.stringify(result);
    statements.mcpReceipts.insert.run(userId, key, toolName, requestHash, json, appliedAt, RECEIPT_SCHEMA_VERSION);
    return result;
  }).immediate();
}
