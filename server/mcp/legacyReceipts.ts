// Frozen v4 receipt contracts. Decode historical snapshots without consulting
// current products/entries or recomputing their original nutrition arithmetic.
import { z } from 'zod';

const macros = z.object({ kcal: z.number(), protein: z.number(), carbs: z.number(), fat: z.number() });
const product = z.object({
  id: z.number().int(), name: z.string(), brand: z.string().nullable(),
  unit: z.enum(['g', 'ml']), barcode: z.string().nullable(), per100: macros, is_temp: z.boolean(),
});
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const group = z.object({ id: z.number().int(), name: z.string(), local_date: date });
const entry = z.object({
  id: z.number().int(), product, grams: z.number(), local_date: date,
  local_time: z.string().regex(/^\d{2}:\d{2}$/), macros,
  group: z.object({ id: z.number().int(), name: z.string() }).nullable(),
});
const receipt = z.object({
  idempotency_key: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/),
  applied_at: z.iso.datetime(), replayed: z.boolean(),
});
const common = { user_id: z.number().int(), receipt };
const productResult = z.object({ ...common, product });
const entriesResult = z.object({ ...common, entries: z.array(entry), group: group.nullable(), totals: macros });
const groupResult = z.object({ ...common, entries: z.array(entry), group });

function renameEntryAmount({ grams, ...original }: z.infer<typeof entry>) {
  return { ...original, amount: grams };
}

export function decodeV4Receipt(toolName: string, value: unknown): unknown {
  if (toolName === 'create_product') return productResult.parse(value);
  if (toolName === 'create_entries') {
    const original = entriesResult.parse(value);
    return { ...original, entries: original.entries.map(renameEntryAmount) };
  }
  if (toolName === 'create_entry_group') {
    const original = groupResult.parse(value);
    return { ...original, entries: original.entries.map(renameEntryAmount) };
  }
  throw new Error('Unsupported v4 receipt tool');
}

// The v4 hash included the old field name. Derive that exact input shape from
// validated current arguments; never rewrite a durable request hash in storage.
export function v4FingerprintInput(toolName: string, normalizedInput: unknown): unknown {
  if (toolName !== 'create_entries') return normalizedInput;
  const input = normalizedInput as { entries: Array<{ product_id: number; amount: number }> };
  return {
    ...input,
    entries: input.entries.map(({ amount, ...item }) => ({ ...item, grams: amount })),
  };
}
