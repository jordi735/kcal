// Data rules shared by UI controls, REST guards, and MCP tools. Interface
// conveniences may differ, but cannot bypass these stored-data constraints.
import { normalizeEntryGroupName } from './normalize.js';

export const MIN_ENTRY_AMOUNT = 1;
export const MAX_ENTRY_GROUP_NAME_LENGTH = 64;

export function isEntryAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= MIN_ENTRY_AMOUNT;
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
