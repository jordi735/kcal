# Connect KCAL to ChatGPT or Codex

KCAL exposes six read tools and six optional write tools at `/mcp`. Connect using
OAuth, sign in with KCAL's existing email code, and approve access to your own
account. `kcal:read` permits reads; `kcal:read kcal:write` also permits creating,
editing, and deleting food logs and library foods. Write-only access is unsupported.

## Server setup

Set the public origin in the backend's root `.env`, then restart the backend:

```dotenv
PUBLIC_ORIGIN=https://usekcal.com
```

Use your actual deployment origin if different. It must use HTTPS and have no
path. Keep the existing email settings working so users can sign in. An unset
or blank value disables OAuth/MCP; the ordinary KCAL app still works.
`MCP_ADMIN_TOKEN` is no longer used. Existing token-based clients must reconnect.

The reverse proxy must forward the Authorization header and these routes to
Express: `/mcp`, `/authorize`, `/token`, `/register`, `/revoke`, `/oauth`, and
`/.well-known`. Configure `TRUST_PROXY` with the actual trusted proxy addresses
or subnets so rate limiting identifies clients correctly.

For local development, run Vite and Express normally and set
`PUBLIC_ORIGIN=http://localhost:5173`. Connect local clients to
`http://localhost:5173/mcp`; Vite proxies the OAuth routes too. ChatGPT needs a
public HTTPS deployment or HTTPS tunnel, with `PUBLIC_ORIGIN` matching it.

## ChatGPT

1. Enable developer mode where available in ChatGPT's app/connector settings.
2. Create a custom app/connector with the URL `https://usekcal.com/mcp` and OAuth
   authentication. Use dynamic client registration (DCR); leave client ID and
   secret blank so ChatGPT registers them automatically.
3. Connect, sign into KCAL if prompted, and select **Allow access**.
4. Ask: “Use KCAL to show my totals for this week and my recent weigh-ins.”

ChatGPT registers its exact callback automatically. KCAL uses the SDK's standard
callback flow and does not advertise the optional issuer-identification extension.
Availability of custom connectors depends on your ChatGPT account/workspace.
See [OpenAI's connection guide](https://developers.openai.com/plugins/deploy/connect-chatgpt)
and [OAuth guide](https://developers.openai.com/plugins/build/auth).

## Codex

```bash
codex mcp add kcal --url https://usekcal.com/mcp
codex mcp login kcal
```

If an older `kcal` entry uses `bearer_token_env_var`, remove that entry before
adding the OAuth connection. Sign in and approve access in the browser. Use
`/mcp` in Codex to inspect the connection. See the
[Codex MCP documentation](https://developers.openai.com/codex/mcp/).

## Tools

| Tool | Arguments | Result |
| --- | --- | --- |
| `get_day` | `date` | Food entries, daily totals, and current daily goals |
| `get_meals` | `start_date`, `end_date` | Food entries and macro totals for each date in an inclusive range of up to 31 days |
| `get_week` | `date` | Seven Monday–Sunday daily totals, weekly totals, and current goals |
| `get_weighins` | Optional `start_date`, `end_date`, `limit`, `offset` | Weight history and `next_offset` |
| `get_summary` | `start_date`, `end_date` | Period totals, averages on logged days, logging coverage, current goals, and weight change for up to 366 days |
| `search_products` | `query` | Up to 50 saved foods from your own library, with product details and per-100 nutrition |

The account comes from the OAuth token. Tools do not accept a user ID, list other
accounts, or execute arbitrary SQL. Responses include the connected account's ID.
Read-only connections discover only the six tools above and cannot invoke writes.

Use `get_meals` to ask what you ate across several days. Both dates are required.
Its response contains `user_id`, `start_date`, `end_date`, and `days` keyed by
`YYYY-MM-DD`, oldest first. Each day has `entries` (the same food-entry shape as
`get_day`) and `totals`. Empty dates have `entries: []` and zero totals. Named
groups remain attached to their food entries; the tool does not infer meal times
or count meals. Longer periods can be requested in separate ranges.

Use `get_summary` for questions such as “How did my last month look?” Both dates
are required and inclusive, with at most 366 days. The response includes:

- `user_id`, `start_date`, and `end_date` for the connected account and period.
- `days_total`, `days_logged`, and `days_without_entries`. A logged day has at
  least one entry, including zero-calorie foods; it does not imply complete logging.
- `totals`, `average_on_logged_days`, and `current_daily_goals`. Averages divide
  the recorded totals by logged days, excluding missing days. With no logged
  days, totals are zero and averages are `null`. Goals are the current settings.
- `weight`: `weighin_count`, `first`, `last`, and `change_kg`. Endpoints contain
  `local_date` and `weight_kg` for the earliest/latest measurements inside the
  range. Change is latest minus earliest, rounded to one decimal. With no
  measurements, endpoints and change are `null`; with one, both endpoints
  describe that measurement and change is `null`. No outside-range baseline or
  interpolation is used. Impossible stored dates are excluded from summaries.

Use `search_products` for questions such as “What are the macros for 250g of my
usual yoghurt?” Supply a nonblank `query`; surrounding whitespace is removed.
The response is `{ user_id, query, products }`, with the same product objects used
in food logs. Matching uses the app's name/brand search and alphabetical
ordering, capped at 50 results. Narrow the query when 50 are returned. Saved
foods are searchable even if never logged; temporary foods and other accounts'
products are excluded. Nutrition is per 100 of the product's `g` or `ml` unit.

Dates are timezone-free `YYYY-MM-DD` calendar dates. `get_week` accepts any date
in the requested week. Weigh-in bounds are inclusive; omitted bounds include all
dates. Pagination defaults to 100 records, allows 1–500, and returns newest first.
Follow `next_offset` until null for a complete history; concurrent edits can shift
live offsets. Weigh-ins include kilograms and notes.

Food entries include product details, computed macros, tags, and group references,
in entry ID order. Tagged entries count toward totals; groups count only through
their children. Historical totals use current product nutrition, matching the app.
Goals describe current settings. Zero totals can mean missing logs or logged
zero-calorie foods. All tools advertise output schemas and return matching
structured JSON and equivalent text.

## Write tools

Request both `kcal:read` and `kcal:write` during OAuth authorization. The consent
screen lists write permissions before approval. Existing read-only connections
stay read-only: reconnect with both scopes and approve the new request to enable
writes. Reauthorization creates new credentials; it does not upgrade old tokens.

| Tool | Arguments | Result (in addition to `user_id`) |
| --- | --- | --- |
| `create_entry` | `product_id`, `grams`, `local_date`, `local_time` | `entry` with computed macros |
| `update_entry` | `entry_id`, optional `grams` and `tagged` (at least one) | Updated `entry` |
| `delete_entry` | `entry_id` | `ok: true`, `entry_id`, nullable `dissolved_group_id` |
| `create_product` | `name`, `unit`, complete `per100`; optional nullable `brand`, `barcode` | Saved `product` |
| `update_product` | `product_id`, supplied changes to `name`, `brand`, `unit`, `barcode`, or individual `per100` values | Updated `product` |
| `delete_product` | `product_id` | `ok: true`, `product_id`, `deleted_entry_count` |

Find food IDs with `search_products`; find entry IDs with `get_day` or `get_meals`.
All referenced entries and products must belong to the connected account. Creating
a product does not log it: call `create_entry` with the returned product ID to log
an amount. Newly created products are saved foods, never temporary foods. Brand
and barcode default to `null`; product names and brands use the app's normalization.
Barcoded products can appear in the app's shared catalog; unbarcoded foods are private.

Entry creation requires an actual calendar date (`YYYY-MM-DD`), a valid local
`HH:MM` time, and a positive finite amount no greater than `Number.MAX_SAFE_INTEGER`
(9,007,199,254,740,991), keeping nutrition arithmetic within finite bounds.
The existing `grams` field represents
the amount in the product's `g` or `ml` unit. New entries are untagged and ungrouped.
Entry edits accept only amount and tagged status, matching the app. Product edits
preserve omitted fields and macros; explicit `null` clears brand or barcode. Empty
updates are rejected. Nutrition is per 100 units: kcal must be between 0 and 2000,
and protein/carbs/fat between 0 and 200, with all four required on product creation.

**Product nutrition edits change historical totals. Deleting a product permanently
deletes every food log referencing it across all dates.** Entry deletion preserves
the library product. Either kind of deletion dissolves groups below two remaining
members while preserving surviving entries. Other users' adopted copies are untouched.

Create tools are non-idempotent: repeating a request creates another record. If a
creation's response is lost, inspect the current logs or library before retrying.
Updates and deletes are idempotent in their effects; deleting an already absent ID
returns `not_found`. Controlled write failures return MCP tool errors without
partial mutations. There are no bulk, group-management, weight, goal, or adoption
write tools.

## Connection lifecycle

OAuth uses authorization codes with S256 PKCE and the `kcal:read` and `kcal:write` scopes.
Discovery is at `/.well-known/oauth-authorization-server` and
`/.well-known/oauth-protected-resource/mcp`. Clients register explicitly with
`none` or `client_secret_post`; other or omitted authentication methods are
rejected. HTTP Basic client authentication is not supported.

An omitted authorization scope defaults to `kcal:read`. Client registration scope
metadata does not grant user permissions: an existing client may explicitly request
both scopes through new consent. Requests, grants, and individual token scopes are
stored in SQLite; the scope migration preserves existing credentials as read-only.
Refreshing without a scope preserves the presented refresh token's permissions.
Refreshing with `kcal:read` can narrow a write connection; escalation and write-only
requests are rejected before consuming a valid refresh token. Narrowed refresh
descendants cannot recover write access. Previously issued access tokens retain
their own scopes until expiration or revocation.

Client registrations persist in SQLite. Connection requests expire after ten
minutes, authorization codes after five minutes, and access tokens after one
hour. Refresh tokens rotate and expire 90 days after approval; reconnect then.
Reuse of a consumed refresh token revokes that connection. The client can revoke
access or refresh tokens through `/revoke`, invalidating the whole connection.
Remove/disconnect KCAL in the client; there is no KCAL connection-management screen.
Clients that only discard credentials instead of calling `/revoke` leave the
server grant valid until it expires.

App sessions and connector tokens are separate. Signing out of KCAL does not
revoke connectors. OAuth codes and access/refresh tokens are stored as hashes;
the SDK stores confidential-client registration secrets in the protected SQLite
client metadata. Credentials are never returned by MCP tools. Browser Origin
headers are rejected at `/mcp`; browser login and consent use the OAuth routes.
