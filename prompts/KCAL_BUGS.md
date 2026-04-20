# Bug Audit — kcal

Perform a two-phase bug hunt on this project: per-file discovery, then per-domain
validation and cross-file discovery. The goal is real bugs that misbehave on
realistic inputs — not theoretical weaknesses.

Stack: Preact 10 + Vite 8 + TypeScript 6 (strict, noUncheckedIndexedAccess,
exactOptionalPropertyTypes, verbatimModuleSyntax) on the client; Express 5 +
better-sqlite3 + tsx on the server; Postmark for email; @anthropic-ai/claude-agent-sdk
for AI features. No test suite exists — do not propose adding one.

================================================================================
PRAGMATISM GATE — APPLIES TO EVERY FINDING IN EVERY PHASE
================================================================================

Before recording a finding, it MUST pass all four checks. If any check fails,
drop it silently — do not include it with a caveat.

  1. REACHABLE. A realistic code path reaches the buggy line with inputs the
     system actually produces or accepts. Trace the path from a caller/entry
     point to the bug. If you cannot, drop it.

  2. OBSERVABLE IMPACT. The bug produces a concrete outcome: wrong data
     written, wrong data returned, a crash on a real input, a UI that shows
     wrong information, an auth check that can be bypassed, a request that
     hangs or fails where it should succeed. "This could theoretically be
     wrong" is not enough.

  3. NOT A WHAT-IF. Do not flag:
       - "what if two requests race" unless you can show the interleaving
         happens on a realistic workload AND corrupts state
       - "what if this throws" where the type system or the surrounding
         code guarantees it cannot
       - missing null checks for values the types already narrow
       - input sizes / malformed payloads that no real client would send
       - defensive hypotheticals around already-parameterized SQL, already-
         typed JSON, already-validated tokens
       - "possible memory leak" / "possible performance issue" unless you
         can point to a concrete pathology

  4. FIX IS KNOWN AND MINIMAL. You can describe the exact change — file,
     lines, replacement — and it is small and local. If the only fix is a
     rewrite or a new abstraction, drop it (that belongs in a clean-code
     pass, not a bug hunt).

A short report of real bugs beats a long report of possibilities.

================================================================================
PHASE 1 — PER-FILE BUG HUNT (one Opus subagent per file, run in parallel batches)
================================================================================

Files in scope (spawn exactly one Opus subagent for each; skip nothing):

  CLIENT — core
    src/main.tsx
    src/App.tsx
    src/api.ts
    src/types.ts
    src/dates.ts
    src/mocks.ts
    src/vite-env.d.ts

  CLIENT — screens
    src/screens/Home.tsx
    src/screens/Login.tsx
    src/screens/Verify.tsx
    src/screens/Settings.tsx

  CLIENT — components
    src/components/Sheet.tsx
    src/components/FoodRow.tsx
    src/components/MacroBar.tsx
    src/components/MacroSummary.tsx
    src/components/WeekStrip.tsx

  CLIENT — modals
    src/modals/GramsPicker.tsx
    src/modals/NewProductForm.tsx
    src/modals/AddPicker.tsx
    src/modals/BarcodeScanner.tsx
    src/modals/AILabelScanner.tsx

  CLIENT — hooks
    src/hooks/useEntries.ts

  SERVER — core
    server/index.ts
    server/env.ts
    server/db.ts
    server/auth.ts
    server/email.ts
    server/claude.ts
    server/log.ts
    server/util.ts
    server/guards.ts
    server/types.ts
    server/statements.ts
    server/asyncHandler.ts

  SERVER — routes
    server/routes/auth.ts
    server/routes/settings.ts
    server/routes/entries.ts
    server/routes/products.ts

  SERVER — data
    server/seed.ts

  SHARED
    shared/seedProducts.ts

--------------------------------------------------------------------------------
Subagent brief (identical for every file agent) — use subagent_type="general-purpose",
model="opus", run_in_background=false, and batch 6–8 per message for parallelism:
--------------------------------------------------------------------------------

  You are hunting for REAL bugs in ONE file. Every finding must pass the
  PRAGMATISM GATE. Reporting zero findings for a correct file is the right
  answer — do not invent bugs.

  Target file: <ABSOLUTE PATH>

  PRAGMATISM GATE (repeat for the subagent):
    1. Reachable — trace a real path to the bug from an entry point.
    2. Observable impact — wrong data, crash, bad UI, auth bypass, etc.
    3. Not a what-if — no race speculation, no guarding type-precluded
       inputs, no "possible" issues without evidence.
    4. Fix is known and minimal — you can state the exact lines to change.

  MANDATORY CONTEXT WALK — do this before flagging anything:
    1. Read the target file in full.
    2. For every `import`, Read the imported module and note each symbol's
       signature, return type, thrown errors, and side effects.
    3. For every `export`, Grep the repo for consumers. Note the inputs
       real callers pass and how they handle the output.
    4. Identify every entry point that exercises this file (HTTP route,
       effect, event handler, CLI entry, module init). For each, trace one
       end-to-end path. Write down the traced paths.
    5. Identify trust boundaries crossed (HTTP body → server, DB → server,
       server → client, user event → client state). Bugs at boundaries
       usually matter; bugs in purely internal plumbing often don't.

  BUG CLASSES TO LOOK FOR (non-exhaustive — only flag real instances):

    LOGIC
      - wrong operator (<, <=, ===, ||, &&), swapped arguments, inverted
        conditions, off-by-one in slices/ranges/indices
      - incorrect arithmetic (grams ↔ kcal conversions, macro math)
      - branches that do nothing useful or fall through incorrectly
      - early returns that skip required work

    STATE & EFFECTS (Preact)
      - stale closure in an effect or callback (missing dep, wrong dep)
      - state update based on stale value instead of updater function
      - effect that runs on wrong inputs or never runs
      - key collisions in list rendering that cause wrong identity
      - uncontrolled ↔ controlled input switch
      - async setState after unmount when it actually matters (not just
        "possible")

    ASYNC / PROMISES
      - missing `await` where the return value is used
      - unhandled rejection on a path that matters
      - fire-and-forget in a handler that should await
      - Promise.all vs Promise.allSettled misuse
      - inconsistent error handling between asyncHandler and direct routes

    DATA & TYPES
      - TS assertion (`as`, `!`) that lies about runtime shape
      - JSON shape mismatch between server response and client expectation
      - Date handling: local vs UTC, ISO parsing, timezone bugs, DST edges
        that realistically occur
      - number/string coercion producing wrong values
      - noUncheckedIndexedAccess lookups used as if non-undefined

    SQL & DB (better-sqlite3)
      - wrong JOIN type or missing JOIN condition
      - missing WHERE or overly broad WHERE
      - aggregation over the wrong grouping
      - prepared statement reused across incompatible schemas
      - transaction boundary wrong or missing where atomicity is actually
        required by the business logic (not defensive)
      - parameter binding order wrong
      - reading integer as boolean or vice versa

    AUTH & INPUT
      - auth check missing on a route that exposes data or mutates state
      - token comparison by string equality in a way that accepts wrong
        inputs
      - guards that allow through what they claim to block
      - trusting req.body fields without the check the route assumes
        exists upstream

    EXTERNAL APIs
      - Postmark call arguments wrong (from/to swapped, template id wrong)
      - multer config that doesn't match what the route consumes
      - claude-agent-sdk call shaped wrong (wrong message role, missing
        required field, model id mistyped)
      - environment variable read but never defined in .env.example, OR
        defined but never read

  WHAT NOT TO FLAG:
    - Style, naming, DRY/KISS/YAGNI (separate pass handles that)
    - Security hardening without a concrete exploit path
    - Performance without a concrete pathology
    - "Could fail in the future if X changes"

  OUTPUT — produce a single JSON object and nothing else:

    {
      "file": "<absolute path>",
      "context_walk": {
        "imports_examined": ["<path>", ...],
        "consumers_found":  [{"symbol": "...", "used_at": ["<path:line>", ...]}],
        "entry_points_traced": ["<describe each path>"],
        "trust_boundaries":   ["<boundary: direction>"]
      },
      "findings": [
        {
          "class": "LOGIC" | "STATE" | "ASYNC" | "DATA" | "SQL" | "AUTH" | "EXTERNAL",
          "severity": "critical" | "high" | "medium" | "low",
          "location": "<path>:<start_line>-<end_line>",
          "symbol": "<function/const/route name if applicable>",
          "description": "<what is wrong, stated plainly>",
          "repro": "<exact input or sequence that triggers the bug>",
          "observable_impact": "<what the user/system sees when this fires>",
          "evidence": "<quoted buggy code + relevant surrounding code>",
          "fix": {
            "strategy": "<one sentence>",
            "edits": [
              { "file": "<path>",
                "lines": "<start-end>",
                "before": "<exact current code>",
                "after":  "<exact replacement>" }
            ]
          },
          "cross_file_refs": ["<other paths this touches, if any>"]
        }
      ],
      "notes_for_domain_pass": "<anything that only makes sense at the domain level>"
    }

  Severity rubric:
    critical — data loss, corruption, auth bypass, crash on common input
    high     — wrong result shown/stored for a realistic input path
    medium   — wrong result only on uncommon but reachable inputs
    low      — cosmetic UI bug or log-only wrongness

  Findings prose ≤ 80 words. Evidence quotes ≤ 12 lines. If no finding
  passes the gate, return `"findings": []`. Do not invent bugs.

================================================================================
PHASE 2 — PER-DOMAIN VALIDATION & CROSS-FILE HUNT
================================================================================

After all Phase-1 JSON reports are collected, spawn one Opus subagent per domain.
Domains:

  D1 — server-core:     server/{index,env,db,auth,email,claude,log,util,guards,
                        types,statements,asyncHandler}.ts
  D2 — server-routes:   server/routes/*.ts
  D3 — server-data:     server/seed.ts + shared/seedProducts.ts
  D4 — client-core:     src/{main.tsx,App.tsx,api.ts,types.ts,dates.ts,mocks.ts,
                        vite-env.d.ts}
  D5 — client-screens:  src/screens/*.tsx
  D6 — client-components: src/components/*.tsx
  D7 — client-modals:   src/modals/*.tsx
  D8 — client-hooks:    src/hooks/*.ts

--------------------------------------------------------------------------------
Domain subagent brief — subagent_type="general-purpose", model="opus":
--------------------------------------------------------------------------------

  You are the DOMAIN-LEVEL reviewer for: <domain id + file set>. Every finding
  you confirm or add must pass the PRAGMATISM GATE. Drop speculation.

  Inputs:
    - Phase-1 JSON reports for every file in your domain.
    - Phase-1 JSON reports for every file outside your domain (reference only).

  Your job:

    1. VALIDATE PHASE-1 FINDINGS. For each finding in your domain: confirm,
       reject, or revise using full domain context. Specifically check:
         - Is the claimed repro actually reachable from a real caller? If
           no caller exists, reject.
         - Does the claimed impact survive at the next layer (e.g. a
           "wrong value" that the client discards doesn't matter)?
         - Does a fix already exist upstream or downstream that masks this?
         - Is the proposed fix minimal and correct, or does it introduce a
           different bug? Revise if so.

    2. CROSS-FILE BUGS. Find bugs that require seeing more than one file:
         - client type asserts a shape the server doesn't actually send
         - server route assumes middleware ran that is not registered
         - two files share a constant/format and one diverged
         - transaction boundary split across files such that a real failure
           leaves inconsistent state
         - an API contract where client and server disagree on field name,
           type, or nullability
       Only flag when you can write the repro.

  OUTPUT — a single JSON object and nothing else:

    {
      "domain": "<domain id>",
      "phase1_validation": [
        { "finding_ref": "<file>:<symbol or line>",
          "status": "confirmed" | "rejected" | "revised",
          "reason": "...",
          "revised_fix": { ... same shape as Phase-1 fix ... } | null }
      ],
      "new_cross_file_findings": [
        { "class": "...", "severity": "...", "files": ["<path>", ...],
          "description": "...", "repro": "...", "observable_impact": "...",
          "evidence": "...",
          "fix": { "strategy": "...", "edits": [ ... ] } }
      ]
    }

================================================================================
FINAL DELIVERABLE
================================================================================

After Phase 2 completes, produce one consolidated markdown report, written to
`/tmp/kcal-bugs-report.md`, containing:

  1. Executive summary — total bugs by class and severity, top 5 highest-
     impact bugs ranked by observable impact.
  2. Findings table — one row per confirmed/new finding, columns:
     severity | class | location | observable_impact | suggested_fix
     Sort by severity desc, then class.
  3. Cross-file bugs — called out separately, one paragraph each.
  4. Rejected findings — short list with reason (for audit trail).

Rules:
  - Do not write code changes. This is a review-only pass.
  - Do not create any files other than the final report.
  - Do not add tests, CI, docs, or new abstractions.
  - A short report of real bugs beats a long report of speculation.
  - Preserve exact file:line references so findings are actionable.
