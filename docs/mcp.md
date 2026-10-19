# Connect KCAL to ChatGPT or Codex

KCAL exposes six read tools and ten optional write tools at `/mcp`. Connect using
OAuth, sign in with KCAL's existing email code, and approve access to your own
account. `kcal:read` permits reads; `kcal:read kcal:write` also permits creating,
editing, and deleting food logs, combined items, and library foods. Write-only
access is unsupported.

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

The in-app **Connect to ChatGPT** guide is available from New Product, Add Temp,
and Settings. To connect:

1. Sign in to ChatGPT in a web browser on a PC or Mac.
2. Open **Plugins**, select **+**, and choose **Add custom MCP server**. If that
   option is missing, look in ChatGPT’s **Settings** for **Developer mode**.
   Enable it if available, then return to Plugins.
3. Name it **KCAL**, set the server URL to `https://usekcal.com/mcp`, and choose
   **OAuth** with dynamic client registration (DCR). Leave the client ID and
   client secret blank so ChatGPT registers them automatically. To save foods from
   photos and log meals, ChatGPT needs **read and write** access. Request
   `kcal:read kcal:write`; if a **Scopes** field is shown, enter that full value.
4. Connect and sign in with your KCAL email code. Confirm the consent page includes
   **read and write** access before approving. If it only offers read access,
   cancel and update the connection to request both scopes.
5. Install/select KCAL in a new conversation (or mention `@KCAL`) and ask:
   “Use KCAL to show my totals for today.”
6. Try sharing a photo of a product, including its front packaging. Ask ChatGPT
   to identify it, look up its EAN barcode and nutrition per 100 g/ml, show you
   the result for review, and save the confirmed food to KCAL. Check that the
   product, pack variant, and nutrition match before saving.

If **Add custom MCP server** is still missing, check your account and workspace
permissions. Use ChatGPT on the web; in a managed workspace, check with your
administrator. If KCAL can read but cannot add or edit foods, reconnect and
request both scopes: `kcal:read kcal:write`.
Approve only when the consent page includes read and write access. Existing
read-only connections do not gain write permissions automatically.

ChatGPT registers its exact callback automatically. KCAL uses the SDK's standard
callback flow and does not advertise the optional issuer-identification extension.
See [OpenAI's connection guide](https://developers.openai.com/api/docs/guides/custom-mcp-server)
for current setup instructions and availability.

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
| `get_day` | `date` | Food entries, daily totals, and the goals effective on that date |
| `get_meals` | `start_date`, `end_date` | Food entries, totals, and effective goals for each date in an inclusive range of up to 31 days |
| `get_week` | `date` | Seven Monday–Sunday daily totals and effective goals, plus weekly totals |
| `get_weighins` | Optional `start_date`, `end_date`, `limit`, `offset` | Weight history with notes and bathroom flags, plus `next_offset` |
| `get_summary` | `start_date`, `end_date` | Period totals, averages on logged days, logging coverage, goal periods and comparisons, and weight change for up to 366 days |
| `search_products` | Optional `query`, `sort`, `limit`, `offset`; alternatively `barcode` alone | Paginated saved foods, or an exact barcode match / safe shared template |

The account comes from the OAuth token. Tools do not accept a user ID, list other
accounts, or execute arbitrary SQL. Responses include the connected account's ID.
Read-only connections discover only the six tools above and cannot invoke writes.

`get_weighins` returns `peed` and `pooped` booleans indicating whether each
occurred before the weigh-in. Existing records were backfilled with `peed: true`
and `pooped: false`; these are defaults, not interpretations of their notes.
Notes remain available separately.

Use `get_meals` to inspect food recorded across several days. Both dates are required.
Its response contains `user_id`, `start_date`, `end_date`, and `days` keyed by
`YYYY-MM-DD`, oldest first. Each day has `entries` (the same food-entry shape as
`get_day`), `totals`, and nullable `daily_goals`. Empty dates have `entries: []`
and zero totals, but still include their effective goals when known. Named
groups remain attached to their food entries; the tool does not infer meal times
or count meals. Longer periods can be requested in separate ranges.

Use `get_summary` for questions such as “How did my last month look?” Both dates
are required and inclusive, with at most 366 days. The response includes:

- `user_id`, `start_date`, and `end_date` for the connected account and period.
- `days_total`, `days_logged`, and `days_without_entries`. A logged day has at
  least one entry, including zero-calorie foods; it does not imply complete logging.
- `totals` and `average_on_logged_days`. Averages divide
  the recorded totals by logged days, excluding missing days. With no logged
  days, totals are zero and averages are `null`.
- `goal_periods`: contiguous inclusive `{ start_date, end_date, daily_goals }`
  ranges. Unknown historical targets are represented by `daily_goals: null`.
- `goal_comparison`: `days_compared`, `logged_totals`, and `goal_totals`, using
  only dates with both a food entry and known goals. Both totals cover exactly
  the same dates and are `null` when none qualify. This does not establish
  complete logging, actual consumption, or dietary adherence.
- `weight`: `weighin_count`, `first`, `last`, and `change_kg`. Endpoints contain
  `local_date` and `weight_kg` for the earliest/latest measurements inside the
  range. Change is latest minus earliest, rounded to one decimal. With no
  measurements, endpoints and change are `null`; with one, both endpoints
  describe that measurement and change is `null`. No outside-range baseline or
  interpolation is used. Impossible stored dates are excluded from summaries.

Use `search_products` to browse a library, find a usual food, or look up a barcode.
Every result has `{ user_id, products, template, next_offset }`:

- Omit `query` to browse; supply nonblank `query` for literal name/brand matching.
  Every distinct whitespace-separated word must occur in either the name or brand,
  in any order. For example, `Fage yoghurt` finds `Greek yoghurt` by `Fage`.
  There is no fuzzy matching, relevance ranking, alias or serving-size system.
  Surrounding whitespace is trimmed. Matching shares the app's Unicode lowercase
  and NFC normalization, preserves accents, and treats `%`, `_`, and backslashes
  literally rather than as wildcard syntax.
- `sort` defaults to `name`; `recent` includes only saved foods with surviving
  food logs, ordered by the most recent log's creation timestamp, not its local
  date. A query can narrow either ordering. Name and recency ties use product IDs.
- Library pagination defaults to `limit: 50`, `offset: 0`; limit allows 1–100.
  Follow `next_offset` until `null`. Pages are live: intervening changes can shift
  offsets. Unlogged saved foods appear in normal browsing/search; temporary foods
  and other accounts' products do not. `template` is always `null` in this mode.
- Alternatively, supply only `barcode`, a trimmed 1–64-character string whose
  leading zeros are preserved. It cannot be combined with the library arguments.
  Lookup prefers the newest owned saved copy, then the newest saved shared
  template. Creation-time ties use the newest product ID. An owned match appears
  as one `products` item; a shared match appears as `template` with no source ID,
  ownership, or temporary flag. No match means `products: []`, `template: null`.
  Barcode results always have `next_offset: null` and never create/adopt a food.

Nutrition is per 100 of the product's `g` or `ml` unit. Save a shared template
using `create_product` before logging its returned owned product ID.

### Dated goals in the app and MCP

`daily_goals` applies to the requested local date. The resolver uses the most
recent goal-history record on or before that date, and returns `null` before
the first known record. `get_week.days[date]` contains `{ totals, daily_goals }`.
Current targets are never projected backward into historical MCP responses.

The app uses the same sparse history for day progress and week indicators.
Settings edits apply to the user's current local day: the browser supplies its
IANA timezone and the server derives the date from its clock. Repeated changes
on one date overwrite that date's record; unchanged saves do not add rows.
Changing goals affects the whole effective day. The current release does not
offer backdating, future scheduling, or MCP goal writes. A save whose local date
precedes the newest history record is rejected rather than rewriting history.

Migration does not invent historical goals. Existing user values remain editable
defaults until the authenticated app initializes a dated baseline. Initialization
is an idempotent POST that uses the current local date; MCP and ordinary GETs
never initialize history. Earlier dates remain unknown. App settings snapshots
contain the editable goals, `goal_history`, and `mcp_notice_version`; old clients
that save without `time_zone` receive `app_refresh_required`.

Dates are timezone-free `YYYY-MM-DD` calendar dates. `get_week` accepts any date
in the requested week. Weigh-in bounds are inclusive; omitted bounds include all
dates. Pagination defaults to 100 records, allows 1–500, and returns newest first.
Follow `next_offset` until null for a complete history; concurrent edits can shift
live offsets. Weigh-ins include kilograms and notes.

Food entries include product details, computed macros, and group references,
in entry ID order. All recorded food counts toward totals; groups count only through
their children. A food record proves neither complete logging nor actual consumption.
Historical totals use current product nutrition, matching the app. Historical
goals use effective dates. Zero totals can mean missing logs or logged zero-calorie foods.
All tools advertise output schemas and return matching structured JSON and
equivalent text.

## Write tools

Request both `kcal:read` and `kcal:write` during OAuth authorization. The consent
screen lists write permissions before approval. Existing read-only connections
stay read-only: reconnect with both scopes and approve the new request to enable
writes. Reauthorization creates new credentials; it does not upgrade old tokens.
Combined-item tools use the same write permission; existing write-authorized
connections can discover them without a new scope or additional consent.

| Tool | Arguments | Result (in addition to `user_id`) |
| --- | --- | --- |
| `create_entries` | `idempotency_key`, `entries`, `local_date`, `local_time`; optional `group_name` | New `entries`, nullable `group`, their `totals`, and `receipt` |
| `update_entry` | `entry_id`; at least one of `amount`, `product_id`, `local_time` | Updated `entry` |
| `delete_entry` | `entry_id` | `ok: true`, `entry_id`, nullable `dissolved_group_id` |
| `create_product` | `idempotency_key`, `name`, `unit`, complete `per100`; optional nullable `brand`, `barcode` | Saved `product` and `receipt` |
| `update_product` | `product_id`, supplied changes to `name`, `brand`, `unit`, `barcode`, or individual `per100` values | Updated `product` |
| `delete_product` | `product_id` | `ok: true`, `product_id`, `deleted_entry_count` |
| `create_entry_group` | `idempotency_key`, `name`, `entry_ids` | `group`, grouped `entries`, and `receipt` |
| `update_entry_group` | `group_id`, `name` | Renamed `group`, `entries` |
| `ungroup_entries` | `group_id` | `ok: true`, `group_id`, ungrouped `entries` |
| `delete_entry_group` | `group_id` | `ok: true`, `group_id`, `deleted_entry_ids` |

Find food IDs with `search_products`; find entry IDs with `get_day` or `get_meals`.
All referenced entries and products must belong to the connected account. Creating
a product does not log it: call `create_entries` with the returned product ID to log
an amount. Newly created products are saved foods, never temporary foods. Brand
and barcode default to `null`; product names and brands use the app's normalization.
Barcoded products can appear in the app's shared catalog; unbarcoded foods are private.
MCP can log only saved foods; temporary foods cannot be reused for new logs.
Existing temporary entries remain readable, editable, groupable, and
deletable. The app's workflow for creating a new temporary food and its first log
is unchanged.

`create_entries` accepts 1–50 `{ product_id, amount }` items at one explicit date
and time. Duplicate products create separate entries in input order. Optional
`group_name` groups all new entries and requires at least two items; omitted
group names leave the entries ungrouped. Creation, optional grouping, receipt,
and output validation succeed or roll back together. Its totals cover only the
new entries, not the entire day. This replaces the old `create_entry` tool;
use a one-item array for a single food.

Entry creation requires an actual calendar date (`YYYY-MM-DD`), a valid local
`HH:MM` time, and a finite amount of at least **1 g/ml**, no greater than `Number.MAX_SAFE_INTEGER`
(9,007,199,254,740,991), keeping nutrition arithmetic within finite bounds.
The `amount` field represents
the amount in the product's `g` or `ml` unit.
Decimals such as `1.5` are allowed. The same minimum applies to amount edits in
REST and MCP. Existing smaller entries are not rewritten and can still be read,
grouped, or deleted without changing their amount. Their checkmarks remain editable
through the app and REST without changing their amount.
`update_entry` requires `entry_id` and at least one replacement: `amount`,
`product_id`, or `local_time`. Omitted fields are preserved. Replacement foods
must be owned saved foods; changing from a g product to an ml product, or vice
versa, also requires an explicit amount. No unit conversion is inferred.
Corrections preserve entry ID, date, creation timestamp, checkmark and group.
Time-only changes do not affect totals. Invalid changes roll back together.
Unsupported fields such as `tagged`, `local_date`, and `group_id` are rejected.
The app offers the same corrections through Edit entry, with Change food and a
time input; editing the library product is a separate action. Product edits
preserve omitted fields and macros exactly, including legacy metadata; explicit
`null` clears brand or barcode. Supplied names/brands use idempotent Unicode
normalization, and both raw and normalized length limits are enforced. Empty
updates are rejected. Nutrition is per 100 units: kcal must be between 0 and 2000,
and protein/carbs/fat between 0 and 200, with all four required on product creation.

**Product nutrition edits change historical totals. Deleting a product permanently
deletes every food log referencing it across all dates.** Entry deletion preserves
the library product. Either kind of deletion dissolves groups below two remaining
members while preserving surviving entries. Other users' adopted copies are untouched.

### Combined items

Find group IDs on entries returned by `get_day` or `get_meals`. A group combines
at least two unique, caller-owned, ungrouped entries from one valid calendar date;
its date is derived from those children. Names are trimmed, internal whitespace
is collapsed, casing is preserved, and the normalized name must be 1–64 characters.
Entries may reference saved or temporary foods.

`update_entry_group` changes only the name. Use `update_entry` to correct an
individual child's amount, food, or clock time. Each child keeps its own time:
250 ml of milk in the morning and 250 ml in the evening can stay grouped as
"Two glasses of milk". Groups cannot be nested or silently regrouped,
and their membership, date, portions, and nutrition cannot be edited as group fields.
Totals always derive from the children.

**Ungroup preserves all food logs. Delete group deletes all of its food logs.**
`ungroup_entries` preserves each child's amount, date, time, and nutrition,
so totals stay unchanged. `delete_entry_group` preserves library products and
unrelated logs. Both remove the group metadata. Create and rename results
contain `group: { id, name, local_date }` and real children in entry-ID order;
ungroup returns those children with `group: null`. Day responses remain flat.

### Retry-safe creation

Every create tool requires an `idempotency_key`: 1–128 ASCII letters, digits,
periods, underscores, colons, or hyphens. A fresh UUID is recommended for each new
operation. Reuse the same key and arguments when retrying an uncertain result.
Keys belong to the authenticated account and span all create tools; reusing a
key for a different tool or different normalized arguments returns
`idempotency_key_conflict` without changes. Batch `entries` remain order-sensitive;
existing group membership IDs are sorted before comparison, so reordering the
same `entry_ids` does not create a conflict.

Successful results include `receipt: { idempotency_key, applied_at, replayed }`,
where `applied_at` is the original UTC ISO timestamp. A replay returns the saved
result with `replayed: true`, even after its entities were edited or deleted.
Use read tools for current state; a replay never restores deleted records.
The receipt and business mutation commit atomically, and failed attempts do not
consume keys. Receipts survive restarts and are retained for the account lifetime.
An unreadable saved receipt returns `idempotency_replay_unavailable` without
executing the create again. Logging occurs only after commit; replay is not a new
business mutation. Caller permissions are checked before replay or creation.

Updates and deletes are idempotent in their effects; deleting an already absent ID
returns `not_found`. Controlled write failures return MCP tool errors without
partial mutations. There are no weight, goal, adoption, or arbitrary bulk-edit tools.

### UI rules

MCP follows the app's data and action restrictions, including ownership, editable
fields, normalization, nutrition limits, and deletion consequences. Shared
validation and mutations keep these rules aligned across REST and MCP. MCP may
offer a more convenient interface, but cannot enable an otherwise forbidden
action or stored value. Explicit creation dates/times, partial edits, read
summaries and pagination, and single-call deletion remain available; UI gestures
and confirmation steps are not protocol requirements.

### Version 5.0.0 compatibility and rollout

Version `5.0.0` replaces `grams` with `amount` in entry inputs and outputs,
including nested entries in group and creation results. The numeric value is
unchanged and uses `product.unit` (`g` or `ml`). Old `grams` inputs are rejected;
refresh the connection's tool definitions before using the updated tools.
`update_entry` adds food and clock-time corrections, and searches match words
across name and brand. Tool names, search sorting and response shapes otherwise
remain unchanged.

The app and REST use the same amount naming. Recent portions now use
`GET /entries/recent-amounts?product_id=...` with `{ amounts: number[] }`.
The forward migration renames the stored quantity column without altering values.
New creation receipts use schema version 5. Existing v4 receipts remain stored
unchanged: retry with the same key and equivalent `amount` arguments to receive
the original snapshot with its quantity field renamed. Original timestamps and
macro values remain intact, even after resources are edited or deleted.

Migration 009 seeds reminder version 5 for eligible existing connections,
including users who dismissed version 4. It appears only at the top of the main
app. Dismissal persists across devices, and a stale version-4 dismissal cannot
clear version 5. Deploy app and server together; existing app tabs must reload
to use the new entry contract. Never run an older server against the renamed
database column.

### Earlier v4 changes

Version `4.0.0` requires fresh tool definitions: `create_entries` replaces
`create_entry`; all creates require keys and return receipts; date reads use
nullable effective goals; weekly day values and summary goal fields change;
and `search_products` gains browsing, recents, pagination and barcode mode with
a uniform result shape. There is no legacy `create_entry` alias.

Deploy the app and server together. Server startup applies the forward-only
migration before serving requests; do not run an older server against the upgraded
database. Existing open app tabs must refresh before saving goals because the new
endpoint requires a timezone. Goal history begins when the app initializes it;
the migration does not infer any earlier targets from current settings.

Forward migrations add goal history and durable receipts. They also flag existing
accounts with an unrevoked, unexpired OAuth grant and a usable access or unused
refresh token for an informational reminder to refresh the connection's tools. Dismissal persists
for the account across devices and does not revoke credentials, change scopes,
or gate app/MCP access. New connections are not flagged, and reauthorization
does not automatically dismiss the reminder. Refresh tools in the client and use
fresh tool results when assessing the new schemas; the reminder does not require
reauthorization or starting a new chat.

Checkmarks remain available in the app and REST. MCP amount edits and group
operations preserve existing checkmarks internally. Checkmarks have been absent
from MCP since v3: `tagged` edits and `set_entry_group_tagged` remain unsupported.
No OAuth scope change is needed, and existing authorized connections remain valid.

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
