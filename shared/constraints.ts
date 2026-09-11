// Data rules shared by UI controls, REST guards, and MCP tools. Interface
// conveniences may differ, but cannot bypass these stored-data constraints.
import { normalizeEntryGroupName } from './normalize.js';

export const MIN_ENTRY_AMOUNT = 1;
export const MAX_ENTRY_GROUP_NAME_LENGTH = 64;
export const MAX_PRODUCT_KCAL_PER100 = 2000;
export const MAX_PRODUCT_MACRO_GRAMS_PER100 = 200;
export const MAX_PRODUCT_NAME_LENGTH = 200;
export const MAX_PRODUCT_BRAND_LENGTH = 120;
export const MAX_PRODUCT_BARCODE_LENGTH = 64;
export const MIN_WEIGHT_KG = 0.1;
export const MAX_WEIGHT_KG = 1000;
export const WEIGHT_STEP_KG = 0.1;
export const MAX_WEIGHT_NOTE_LENGTH = 500;

export function isEntryAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= MIN_ENTRY_AMOUNT;
}

export function isWeightAmount(value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)
    || value < MIN_WEIGHT_KG || value > MAX_WEIGHT_KG) return false;
  const tenths = value * 10;
  return Math.abs(tenths - Math.round(tenths)) < 1e-9;
}

export function parseEntryGroupName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = normalizeEntryGroupName(value);
  return name.length > 0 && name.length <= MAX_ENTRY_GROUP_NAME_LENGTH ? name : null;
}

export function isLocalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
