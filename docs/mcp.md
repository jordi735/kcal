# Connect KCAL to ChatGPT or Codex

KCAL exposes four read-only tools at `/mcp`. Connect using OAuth, sign in with
KCAL's existing email code, and approve access to your own account.

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

The account comes from the OAuth token. Tools do not accept a user ID, list other
accounts, execute SQL, or write data. Responses include the connected account's ID.

Use `get_meals` to ask what you ate across several days. Both dates are required.
Its response contains `user_id`, `start_date`, `end_date`, and `days` keyed by
`YYYY-MM-DD`, oldest first. Each day has `entries` (the same food-entry shape as
`get_day`) and `totals`. Empty dates have `entries: []` and zero totals. Named
groups remain attached to their food entries; the tool does not infer meal times
or count meals. Longer periods can be requested in separate ranges.

Dates are timezone-free `YYYY-MM-DD` calendar dates. `get_week` accepts any date
in the requested week. Weigh-in bounds are inclusive; omitted bounds include all
dates. Pagination defaults to 100 records, allows 1–500, and returns newest first.
Follow `next_offset` until null for a complete history; concurrent edits can shift
live offsets. Weigh-ins include kilograms and notes.

Food entries include product details, computed macros, tags, and group references,
in entry ID order. Tagged entries count toward totals; groups count only through
their children. Historical totals use current product nutrition, matching the app.
Goals describe current settings. Zero totals mean no recorded intake, not proof
that logging was complete. All tools advertise output schemas and return matching
structured JSON and equivalent text.

## Connection lifecycle

OAuth uses authorization codes with S256 PKCE and the single `kcal:read` scope.
Discovery is at `/.well-known/oauth-authorization-server` and
`/.well-known/oauth-protected-resource/mcp`. Clients register explicitly with
`none` or `client_secret_post`; other or omitted authentication methods are
rejected. HTTP Basic client authentication is not supported.

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
