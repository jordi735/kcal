# Security hardening

The public-release hardening preserves normal app behavior, existing food and
goal data, and REST/MCP ownership and receipt boundaries. These are application
controls; a successful local suite does not verify the live hosting settings.

## Dependency and request boundaries

`package-lock.json` is part of the release. Use `npm ci` for repeatable local
installs and `npm ci --include=dev` for the existing production build/start
workflow. `tsx` and the build tools are still required. npm's install-script
allowlist names only the reviewed versions of SQLite and esbuild that need
installation scripts; review this list when those packages change.

| Input | Limit |
| --- | --- |
| Login JSON | 4 KiB |
| OAuth JSON/form body | 16 KiB |
| Ordinary application/MCP JSON | 64 KiB |
| Raw and normalized login email | 254 UTF-8 bytes |
| Raw product search | 512 JavaScript string code units |
| New entry-group membership | 1,000 entries |
| MCP tool argument members/elements | 2,048 |

Request parsers reject compressed bodies instead of inflating them. Email
validation bounds the raw string before normalization or regex evaluation and
also checks normalized bytes. Its accepted-address syntax is otherwise
unchanged. Search length is checked before trimming/tokenization; the UI's
native length bound and programmatic-input guard use the same limit.

Group limits apply to creation only. Existing larger groups remain readable,
renamable, taggable, ungroupable and deletable. Incoming replay requests must
also satisfy the new request limits, but stored receipts and historical
compatibility snapshots are not rewritten.

The MCP element budget is configured on the SDK server, ahead of tool-schema
validation; a Zod collection maximum alone is not a validation-work budget.
Express owns the HTTP body bound because it passes an already-parsed body into
the MCP transport. The SDK's resource check supplements, rather than replaces,
the existing provider check. Disabling OAuth/MCP by leaving PUBLIC_ORIGIN blank
continues to work.

## Login accounting and account creation

The two login POST endpoints reserve source quota once, before body parsing.
Malformed input, an account-level rejection and failed delivery all spend that
source reservation; reservations are never refunded. Only Express's validated
`req.ip` is used, with IPv4-mapped addresses canonicalized and IPv6 addresses
grouped by /56. Missing or invalid addresses share an `unknown` bucket. Trusted
proxy configuration is therefore part of deployment security.

| Budget | Limit |
| --- | --- |
| Code issuance per source | 30/hour |
| Verification per source | 100/15 minutes |
| Code issuance per email | 30-second cooldown and 5/hour |
| Verification per email | 20/15 minutes |
| Incorrect attempts per issued code | 5 |

Verification spends email quota only when an active, unexpired code exists.
The account reservation, timing-safe comparison and single-use consumption run
synchronously. Resending never resets the account's verification budget. This
prevents guesses before issuance from exhausting that email's verification
allowance; contention over active codes or email issuance remains a limitation
of the existing protocol, not a guarantee this implementation can provide.

Requesting a code does not create a permanent account. Successful verification
consumes the code, then creates/selects the user and creates the session in one
database transaction, returning the same projected user and current goals.
Database failure rolls back those writes without reviving the consumed code.
Existing account IDs, default goals and goal history remain intact.

Delivery runs outside database transactions. A failed delivery invalidates only
that exact issuance, even if a later issuance has identical six-digit contents.
It cannot restore an older code, remove a newer one or refund quota. Login codes
and budgets remain process-local; multiple instances require shared state or
affinity as a separately reviewed deployment change.

## Verification

The server defaults to production mode. `APP_ENV=development|test|production`
is explicit in the npm backend launchers and test harness. `TEST_MODE=true`
outside test mode aborts before database initialization; production always
denies `/debug`, including allowlisted callers. Only explicit development mode
can log live sign-in codes at debug level.

Security and privacy headers are installed before login source limits and body
parsers. Credential/private responses and their errors use `no-store`; versioned
assets remain immutable, while HTML and the service worker revalidate. Parser
failures use fixed response codes, and unexpected failures return
`{ "error": "internal_error" }`. Logs use fixed diagnostic categories and API
families instead of arbitrary exception details or supplied path segments.

Operational deployment, staged CSP enforcement, transport, backups and rollback
are covered by [the hosting checklist](security-deployment.md). That checklist is
not an instruction to change the live deployment during local implementation.

Security regressions use the existing serial Playwright harness and bounded,
typed child fixtures with disposable databases. Email delivery is mocked and
external networking is blocked in authentication fixtures. Malformed decoder
regressions run only against ephemeral loopback processes, never production.
Normal discovery, OAuth, receipts, legacy metadata and stored-group operations
remain covered alongside the added boundaries.
