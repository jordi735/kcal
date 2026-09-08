# Read-only MCP access

KCAL exposes four tools for Codex at `/mcp` on the existing backend. A single
static token grants administrative read access to every user's food logs,
nutrition goals, and weight history. There is no OAuth or additional login flow.

## Setup

1. Generate a token:

   ```bash
   node --input-type=module -e 'import { randomBytes } from "node:crypto"; console.log(randomBytes(32).toString("base64url"))'
   ```

2. Put that token in the backend's root `.env`:

   ```dotenv
   MCP_ADMIN_TOKEN=your-generated-token
   ```

   Tokens must contain at least 32 characters. An unset or blank value disables
   `/mcp` with HTTP 404. Restart the backend after setting or changing the token.
   The root `.env` is ignored by Git.

3. Start the backend normally, for example with `npm run server:dev`.

4. Add this to your Codex `~/.codex/config.toml`:

   ```toml
   [mcp_servers.kcal]
   url = "http://localhost:3000/mcp"
   bearer_token_env_var = "MCP_ADMIN_TOKEN"
   ```

5. Make the same token available in the environment that launches Codex:

   ```bash
   export MCP_ADMIN_TOKEN='your-generated-token'
   codex
   ```

   Codex does not automatically load the app's `.env`. Its configured environment
   variable supplies the `Authorization: Bearer ...` header. In Codex, `/mcp`
   shows the connection. For remote access, use your deployed **HTTPS** origin
   followed by `/mcp` and forward the Authorization header through your proxy.

See the [official Codex MCP documentation](https://developers.openai.com/codex/mcp/)
for configuration options. Native Codex clients are supported in this version;
ChatGPT web connection setup is deferred. Browser Origin headers are rejected.

## Tools

| Tool | Arguments | Result |
| --- | --- | --- |
| `list_users` | Optional `limit`, `offset` | `users` with IDs and emails, plus `next_offset` |
| `get_day` | `user_id`, `date` | `entries`, `totals`, `current_daily_goals`, user ID and date |
| `get_week` | `user_id`, `date` | Monday–Sunday `days`, weekly `totals`, `current_daily_goals`, user ID and week bounds |
| `get_weighins` | `user_id`; optional `start_date`, `end_date`, `limit`, `offset` | `weighins`, user ID, and `next_offset` |

Use `list_users` to select a user, then pass that ID explicitly. App session
tokens do not grant MCP access. For example, ask Codex:

> Use KCAL to find my user ID by email, show my nutrition totals for the week
> containing 2026-09-08, and show my weigh-ins since 2026-09-01.

Dates are timezone-free `YYYY-MM-DD` calendar dates. `get_week` accepts any date
in the requested week and returns all seven days, Monday first. Weigh-in date
bounds are inclusive; omitted bounds include all dates. Invalid dates, reversed
ranges, and nonexistent users produce tool errors.

Food entries include product details, computed macros, tags, and group references,
in entry ID order. Both tagged and untagged entries count toward totals; grouping
does not add calories. Historical totals use **current** product nutrition values,
matching the app. Goals are current daily settings, not historical goal snapshots.
Zero totals mean zero recorded intake and do not establish whether logging was complete.

Weigh-ins include kilograms and notes, newest first. Paginated tools default to
100 records and allow 1–500. Follow `next_offset` until it is null for a complete
history. Pages read live data; concurrent additions or deletions can shift offsets.

All tools return structured JSON and equivalent text and are marked read-only.
They expose no credentials, SQL execution, or write operations. To revoke or rotate
access, clear or replace `MCP_ADMIN_TOKEN` in `.env`, restart the backend, and
update the Codex environment if applicable.
