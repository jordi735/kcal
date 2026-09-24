// Project app entries onto the MCP contract before serializing any result.

import type { EntryWithMacros, McpEntry } from '../types.js';

export function toMcpEntry(entry: EntryWithMacros): McpEntry {
  return {
    id: entry.id,
    product: entry.product,
    grams: entry.grams,
    local_date: entry.local_date,
    local_time: entry.local_time,
    macros: entry.macros,
    group: entry.group,
  };
}
