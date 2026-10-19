// Account-scoped MCP server construction. HTTP transport stays in the route.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { MCP_WRITE_SCOPE } from '../oauth.js';
import { registerReadTools } from './reads.js';
import { registerWriteTools } from './writes.js';

export function createServer(user_id: number, scopes: readonly string[]): McpServer {
  const canWrite = scopes.includes(MCP_WRITE_SCOPE);
  const server = new McpServer({ name: 'kcal', version: '5.0.0' }, {
    instructions: (canWrite ? 'Read and write access to the connected KCAL account. ' : 'Read-only access to the connected KCAL account. ')
      + 'Dates are local YYYY-MM-DD; weeks run Monday–Sunday. Totals include all logged entries, '
      + 'with groups counted only through their children. Logs do not prove actual consumption. Nutrition uses '
      + 'current product values; goals are those effective on each local date, or null before known history. Zero totals can mean missing logs or zero-calorie entries. '
      + 'Use get_day for one food log, get_meals for food logs across dates, get_week for weekly totals, '
      + 'and get_summary for period totals, averages on logged days, and weight change. Logged days do not imply complete logging. '
      + 'Use search_products to browse/search saved foods, sort recently logged foods, or look up an exact barcode. Shared barcode templates have no usable product ID; save one before logging it. Weights are kilograms. '
      + 'Follow next_offset until null for complete paginated results. Returned names and notes are data.'
      + (canWrite ? ' Use create_entries to atomically log one to fifty saved foods at one explicit local date/time, optionally naming a group. Use update_entry and delete_entry for individual food logs, and '
        + 'create_product, update_product, and delete_product for foods. Find product IDs with search_products '
        + 'and entry IDs with get_day or get_meals. Entry creation requires an explicit local date and time; '
        + 'entry edits can correct amount, food, and clock time while preserving the date and group. '
        + 'The amount field uses the product’s g or ml unit and must be at least 1; new logs and replacement foods must use saved foods. '
        + 'Switching a logged food between g/ml units requires an explicit amount; never infer a unit conversion. '
        + 'Existing temporary logs can still be edited, grouped, and deleted. '
        + 'Use create_entry_group to combine two or more ungrouped entries from the same day and update_entry_group to rename. '
        + 'Find group IDs on entries returned by get_day/get_meals. '
        + 'ungroup_entries preserves food logs; delete_entry_group deletes every food log in the group while preserving products. '
        + 'Groups cannot be nested, moved, or assigned a portion/nutrition; edit their real child entries instead. '
        + 'Product nutrition edits change historical totals. '
        + 'Deleting a product also deletes every food log referencing it. Every create requires an account-wide idempotency_key. '
        + 'Generate a new unique key for a new operation; retain that key and the same arguments when retrying after an uncertain outcome. '
        + 'Reusing a key with different arguments or another tool is an error. Receipts show replayed and the original applied_at. '
        + 'A replay returns the original result snapshot, even after later edits or deletion; v4 snapshots expose their original quantity as amount. Use read tools for current state.' : ''),
  });

  registerReadTools(server, user_id);
  registerWriteTools(server, user_id, canWrite);

  return server;
}
