# Security deployment checklist

This is an operator checklist for usekcal.com. Repository implementation and
local validation do not confirm that these production settings are applied.
The application remains a single Express process behind the configured proxy.

## Prepare a reproducible release

1. Record the deployed commit, Node version, npm version and resolved dependency
   inventory without printing environment variables or secrets. Use a supported
   patched Node 24 release and matching Node 24 types.
2. Build a separate immutable release directory from the reviewed commit. Run
   `npm ci --include=dev`, the checks and the production build there. Development
   dependencies are required by the current build/start workflow, including
   `tsx`; do not substitute `npm ci --omit=dev`.
3. Verify the locked runtime contains patched body-parser/proxy-addr and the
   reviewed SDK/Zod versions. Retain the lockfile and validation record with the
   release. Do not rebuild or replace `dist` underneath a running process: its
   CSP hash must match the exact HTML it serves.
4. Validate `APP_ENV=production`, `TEST_MODE=false`, the intended logging level,
   `PUBLIC_ORIGIN=https://usekcal.com` and the exact `TRUST_PROXY` chain. Do not
   copy test fixture environments into production. The production launcher
   selects production mode; the raw debug route is disabled there.

## Database transition and rollback

Migration 010 changes stored application-session credentials to hashes. Browser
bearers and session timestamps remain valid; no forced login is intended.

1. Drain traffic/writes and stop the old application before applying this
   migration. Do not run old and new binaries concurrently against the database.
2. Take and verify a consistent SQLite backup, including the effects of its WAL
   through SQLite's supported backup mechanism. Record the matching old release.
   Protect the backup: it contains private data and may contain raw credentials.
3. Start the new release so the forward-only migration completes, then perform
   local readiness checks and an authorized existing-session smoke check before
   restoring public traffic. Confirm authentication, normal logging, themes and
   OAuth connection behavior.
4. If validation fails before traffic resumes, stop the new process and restore
   the matching database backup and old release together. Never point the old
   binary at the migrated database. Once new writes are accepted, use a forward
   repair or a separately reviewed recovery procedure; restoring an old backup
   would discard those writes.

Hashing is not credential revocation or forensic erasure. Old backups, WAL files
and previously copied tokens can remain sensitive; apply the normal protected
backup-retention policy. Do not delete or rewrite historical food/goal data.

## Cloudflare and origin transport

- Set minimum visitor TLS to **1.2** and retain TLS 1.3. Verify both usekcal.com
  and www.usekcal.com using clients capable of explicitly testing old versions.
  A local client's refusal to attempt TLS 1.0 is not evidence of edge rejection.
- Retain HTTP-to-HTTPS and www-to-apex redirects.
- Use validated encryption to the origin (Full strict or the equivalent verified
  tunnel arrangement). Inspect the origin certificate and renewal path; a valid
  visitor certificate does not verify this separate connection.
- Restrict direct-origin access to the intended proxy/tunnel path. Inspect
  firewall rules, listening interfaces and administrative access separately.
  Do not treat Cloudflare edge IPs as discovered origin addresses.
- Verify every trusted hop overwrites or appends forwarding information as
  intended. Set `TRUST_PROXY` to actual trusted addresses/subnets, not arbitrary
  clients. Verify canonical visitor IPv4/IPv6 identities reach Express. Do not
  use malformed mapped IPv6 CIDRs or assume the string `"1"` means one hop.

## HSTS, CSP and caching

1. Introduce HSTS on HTTPS responses with `max-age=300`, without
   `includeSubDomains` or `preload`. Verify redirects and HTTPS-only navigation
   across intended hosts. Increase to 86400 after those checks, observe a full
   day, then increase to 31536000 if HTTPS and renewal remain healthy. This
   checklist does not schedule or perform those changes automatically.
2. Exercise the candidate with `CSP_MODE=report-only`, preserving the exact
   built-script hash. Inspect browser violations through login, all themes,
   settings/subviews, forms, scanner states, OAuth consent/callback and installed
   PWA reload. Require no unintended violations before `CSP_MODE=enforce` and
   verify the enforced header on the actual public document and SPA fallbacks.
   Do not solve violations by adding unsafe-inline or unsafe-eval.
3. Ensure edge rules bypass caching for authentication, private REST responses,
   OAuth and MCP, including errors. Preserve immutable versioned-asset caching;
   HTML must revalidate and the service worker must use no-cache. Verify the
   public headers, since an edge rule previously changed the worker's lifetime.
4. Deploy a clean map-free asset directory. Remove old deployed source maps and
   purge known cached map URLs. This cannot retract maps previously downloaded.

## Operations and email

- Verify the process runs with a restricted user, private database/backup file
  permissions, protected secrets and patched OS/runtime packages. Inspect
  restart behavior, memory/disk limits and monitoring for restarts, 5xx/429s,
  email failures, database growth and abnormal traffic.
- Test backup restoration in a disposable environment and record ownership of
  incident response, log retention and secret rotation. Do not publish database
  contents or production configuration values in validation artifacts.
- Inspect real outbound Postmark headers using an authorized test mailbox.
  Confirm aligned DKIM/SPF and all legitimate senders before changing DMARC.
  Move from monitoring to quarantine, review delivery reports, and enforce
  reject only after legitimate traffic remains aligned. The current SPF record
  alone does not establish whether Postmark DKIM alignment is working.

## Explicit remaining limits

The email-and-code protocol still permits contention around active codes and
email issuance. Session lifetimes remain sliding, and logout revokes only the
presented session. Session/connector management UI, absolute expiry, a challenge
protocol redesign, account quotas/pagination, font self-hosting and a new public
security contact are separate follow-ups. No hosting change is implied by a
passing local test suite.
