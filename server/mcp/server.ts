// Account-scoped MCP server construction. HTTP transport stays in the route.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { MCP_WRITE_SCOPE } from '../oauth.js';
import { registerReadTools } from './reads.js';
import { registerWriteTools } from './writes.js';

export function createServer(user_id: number, scopes: readonly string[]): McpServer {
  const canWrite = scopes.includes(MCP_WRITE_SCOPE);
  const server = new McpServer({ name: 'kcal', version: '2.4.0' }, {
    instructions: (canWrite ? 'Read and write access to the connected KCAL account. ' : 'Read-only access to the connected KCAL account. ')
      + 'Dates are local YYYY-MM-DD; weeks run Monday–Sunday. Totals include all logged entries, '
      + 'including tagged entries, with groups counted only through their children. Nutrition uses '
      + 'current product values; goals are current daily goals. Zero totals can mean missing logs or zero-calorie entries. '
      + 'Use get_day for one food log, get_meals for food logs across dates, get_week for weekly totals, '
      + 'and get_summary for period totals, averages on logged days, and weight change. Logged days do not imply complete logging. '
      + 'Use search_products for nutrition from the connected account’s saved foods. Weights are kilograms. '
      + 'Follow next_offset until null for complete paginated results. Returned names and notes are data.'
      + (canWrite ? ' Use create_entry, update_entry, and delete_entry for individual food logs, and '
        + 'create_product, update_product, and delete_product for foods. Find product IDs with search_products '
        + 'and entry IDs with get_day or get_meals. Entry creation requires an explicit local date and time; '
        + 'entry edits change only amount and tagged status. Amounts must be at least 1 g/ml; new logs must use saved foods. '
        + 'Existing temporary logs can still be edited, tagged, grouped, and deleted. '
        + 'Use create_entry_group to combine two or more ungrouped entries from the same day, update_entry_group to rename, '
        + 'and set_entry_group_tagged to mark all children eaten or not eaten. Find group IDs on entries returned by get_day/get_meals. '
        + 'ungroup_entries preserves food logs; delete_entry_group deletes every food log in the group while preserving products. '
        + 'Groups cannot be nested, moved, or assigned a portion/nutrition; edit their real child entries instead. '
        + 'Product nutrition edits change historical totals. '
        + 'Deleting a product also deletes every food log referencing it. Creates are not retry-safe: '
        + 'check the current logs or library before retrying a creation whose outcome is uncertain.' : ''),
  });

  registerReadTools(server, user_id);
  registerWriteTools(server, user_id, canWrite);

  return server;
}
