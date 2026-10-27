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

## Verification

Security regressions use the existing serial Playwright harness and bounded,
typed child fixtures with disposable databases. Email delivery is mocked and
external networking is blocked in authentication fixtures. Malformed decoder
regressions run only against ephemeral loopback processes, never production.
Normal discovery, OAuth, receipts, legacy metadata and stored-group operations
remain covered alongside the added boundaries.
