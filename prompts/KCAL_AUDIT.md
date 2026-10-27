# Clean Code Audit — kcal

Perform a two-phase clean code audit of this project. The goal is to find real
DRY, KISS, and YAGNI violations — issues a staff engineer would fix in a PR
today, not theoretical concerns.

Stack: Preact 10 + Vite 8 + TypeScript (see package.json; strict, noUncheckedIndexedAccess,
exactOptionalPropertyTypes, verbatimModuleSyntax) on the client; Express 5 +
better-sqlite3 + tsx on the server; Postmark for email; MCP for ChatGPT and
Codex connections. The @openai/codex development dependency powers the E2E
review script only. A Playwright E2E suite exists; no unit-test or lint command
exists, so do not invent one.

================================================================================
PRAGMATISM GATE — APPLIES TO EVERY FINDING IN BOTH PHASES
================================================================================

Before recording a finding, it MUST pass all four checks. If any check fails,
drop it silently — do not include it with a caveat.

  1. CONCRETE IMPACT. The finding fixes a problem that exists today: real
     duplication a human would genuinely consolidate, real complexity that
     makes reading harder right now, real dead code that can be deleted.
     "Could be a problem if X" is not enough.

  2. FIX IS OBVIOUS AND NET-POSITIVE. The suggested fix is straightforward and
     leaves the code clearly better. If the fix requires inventing a new
     abstraction, adding a layer, or trading one smell for another, drop it.

  3. NOT A WHAT-IF. Do not flag:
       - race conditions, atomicity, or concurrency without a concrete
         reachable interleaving that demonstrates observable impact
       - "what if this fails mid-write", "what if the network drops", "what
         if someone passes null"
       - hypothetical future duplication when only one instance exists today
       - missing defensive checks for scenarios the types already preclude
       - performance concerns unless the hot path is obvious and painful

  4. NOT STYLE OR TASTE. Do not flag naming, formatting, comment style,
     import ordering, or "I would have written it differently."

Call this the pragmatism gate. Apply it ruthlessly. A short report of real
issues is the goal; a long report of speculation is a failure.

================================================================================
PHASE 1 — PER-FILE REVIEW (one Codex subagent per file, run in parallel batches)
================================================================================

Discover the current tracked inventory instead of maintaining a filename list:

  git ls-files -- src server shared public index.html vite.config.ts package.json

Read AGENTS.md for current module ownership and project invariants. Review all
tracked TypeScript/TSX modules and their CSS, plus applicable JavaScript, SQL,
HTML, and configuration files. Follow references to tests and tooling for
behavioral evidence. Inspect references to generated/binary assets rather than
assigning binary files a code-review task. Do not read ignored runtime state or
real credentials. Record the discovered inventory so omissions are visible.

Assign bounded file tasks within the active concurrency limit; skip no source
module merely because it was added after this prompt was written.

--------------------------------------------------------------------------------
Subagent brief (identical for every file agent) — use the available collaboration
tooling, give each agent one bounded file task, and run batches within the
active concurrency limit. Do not request a provider-specific model:
--------------------------------------------------------------------------------

  You are reviewing ONE file for DRY, KISS, and YAGNI violations. Every finding
  must pass the PRAGMATISM GATE (see below). Reporting zero findings for a
  clean file is the correct answer — do not pad.

  Target file: <ABSOLUTE PATH>

  PRAGMATISM GATE (repeat for the subagent):
    1. Concrete impact — fixes a real problem today, not a hypothetical.
    2. Fix is obvious and net-positive — no new abstractions, no trading
       one smell for another.
    3. Not a what-if — no concurrency/atomicity/network/failure-mode
       speculation, no defending against type-precluded inputs.
    4. Not style — no naming/formatting/taste calls.
    If a finding fails any check, drop it.

  MANDATORY CONTEXT WALK — do this before flagging anything:
    1. Read the target file in full.
    2. For every `import` in the target file, Read the imported module and note
       the signature, return type, and side effects of each imported symbol.
       For bare specifiers from node_modules, rely on the package's public
       types; do not walk internals.
    3. For every `export` in the target file, Grep the repo for consumers and
       note how each export is actually used — arguments, return handling,
       edge cases triggered.
    4. Mentally trace at least one end-to-end execution path through this file
       as if running it by hand. Write down the path you traced.
    5. If the target is a client `.tsx` file with a companion `.module.css`,
       also read that CSS module. If the target references `useFadeClose` or
       a keyframe by name, also read `src/hooks/useFadeClose.ts` and the
       module where the keyframe is defined (often `src/styles.css`).
       Animation plumbing is in scope.

  WHAT TO FLAG (only when the pragmatism gate passes):

    DRY — logic duplicated in two or more places right now where both copies
    would be updated together if one changed. Parallel branches differing only
    in a constant. Shape-transforms repeated verbatim. Types that restate an
    existing shared type. Do NOT flag coincidental similarity or single-use
    patterns that might be repeated "someday."

    KISS — indirection that saves nothing in practice: single-use helpers that
    inline cleanly without loss, config objects with one or two options,
    wrapper functions that only re-call their argument, generics with one
    instantiation, state machines where a boolean works, clever expressions
    that obscure the obvious. Do NOT flag something just because a different
    design is conceivable.

    YAGNI — dead code that is demonstrably unreachable, unused exports with
    zero consumers, parameters always called with the same value, options
    no caller uses, error branches for states the types forbid, fallbacks
    for paths that never fire, "for future use" scaffolding. The test is
    "can I delete this today without a user noticing?" If yes, flag it.

    ANIMATIONS (client files only — file findings under DRY/KISS/YAGNI, but
    look explicitly). Inspect the companion `.module.css`, `src/styles.css`,
    and any use of `useFadeClose`. Flag:
      - DRY: the same `@keyframes` (or effectively identical ones) defined
        in two modules; the same transition duration/easing triplet
        repeated for the same interaction class (modal enter, sheet slide,
        row press, bar fade).
      - KISS: JS-driven motion (manual `setTimeout` + class toggling,
        imperative style writes, rAF counters) where a plain CSS
        transition or `animation` declaration gives the same result;
        `useFadeClose` attached to a component that never conditionally
        unmounts.
      - YAGNI: keyframes or transition rules with no matching class user;
        `animationend`/`transitionend` handlers whose cleanup targets an
        already-unmounted node.
      - Stacking: z-index / stacking-context mistakes that hide the
        animated element behind a sibling mid-transition (SelectionBar
        has a history of this).
      - Reduced motion: non-decorative motion that ignores
        `@media (prefers-reduced-motion: reduce)` — this is a real bug
        for users who disabled motion, not a style nit.

  OUTPUT — produce a single JSON object and nothing else:

    {
      "file": "<absolute path>",
      "context_walk": {
        "imports_examined": ["<path>", ...],
        "consumers_found":  [{"symbol": "...", "used_at": ["<path:line>", ...]}],
        "execution_path_traced": "<one-paragraph prose>"
      },
      "findings": [
        {
          "category": "DRY" | "KISS" | "YAGNI",
          "severity": "high" | "medium" | "low",
          "location": "<path>:<start_line>-<end_line>",
          "symbol": "<function/const/type name if applicable>",
          "description": "<the issue, stated plainly>",
          "evidence": "<quoted offending code + related code elsewhere>",
          "concrete_impact": "<what specifically improves when this is fixed>",
          "suggested_fix": "<one or two sentences, no new abstractions>",
          "cross_file_refs": ["<other paths this issue touches, if any>"]
        }
      ],
      "notes_for_domain_pass": "<anything that only makes sense at the domain level>"
    }

  Findings prose ≤ 60 words each. Evidence quotes ≤ 10 lines. If no finding
  passes the pragmatism gate, return `"findings": []`. Do not invent issues.

================================================================================
PHASE 2 — PER-DOMAIN REVIEW (one Codex subagent per domain, after Phase 1)
================================================================================

After all Phase-1 JSON reports are collected, spawn one Codex subagent per domain.
Domains and their file sets:

  D1 — server-core: direct server modules and migrations
  D2 — server-adapters: routes, middleware, and MCP modules
  D3 — shared: all shared modules
  D4 — client-core: direct src modules and global styles
  D5 — client-screens: screens and their styles
  D6 — client-components: components and their styles
  D7 — client-modals: modals and their styles
  D8 — client-hooks: all hooks and cache helpers

Derive each domain's actual file set from the recorded inventory. Assign any
remaining production/configuration files explicitly; do not silently drop them.

--------------------------------------------------------------------------------
Domain subagent brief — use one bounded Codex subagent per domain:
--------------------------------------------------------------------------------

  You are the DOMAIN-LEVEL reviewer for: <domain id + file set>. Every finding
  you confirm or add must pass the PRAGMATISM GATE above. Drop speculation.

  Inputs:
    - Phase-1 JSON reports for every file in your domain.
    - Phase-1 JSON reports for every file outside your domain (reference only,
      so you can detect cross-domain duplication).

  Your job:

    1. CROSS-FILE DRY: find duplication spanning files in your domain (and
       occasionally across domains) that Phase-1 missed. Only flag when both
       copies would realistically be updated together. "Two similar-looking
       functions that do different things" is not a finding.

    2. VALIDATE PHASE-1 FINDINGS: for each finding in your domain, confirm,
       reject, or revise using full domain context. If a Phase-1 "dead export"
       has a consumer another agent missed, reject it. If a Phase-1 KISS flag
       is actually load-bearing once you see the callers, reject it.

    3. ARCHITECTURAL KISS / YAGNI: at the domain level, flag folders or layers
       that don't earn their keep TODAY — e.g. a routes file that is one
       function wrapping another file's function and could be merged. Do not
       propose reorganizations for hypothetical scale.

    4. ANIMATION CONSISTENCY (client domains D5/D6/D7/D8 only): compare the
       companion CSS modules across files in your domain. Flag keyframes
       duplicated across two modules, drift in transition duration/easing
       for the same interaction class, sibling components using JS-driven
       motion in one place and pure CSS in another for the same pattern,
       and missing `prefers-reduced-motion` guards that appear in some
       modules but not others doing the same kind of animation.

  OUTPUT — a single JSON object and nothing else:

    {
      "domain": "<domain id>",
      "phase1_validation": [
        { "finding_ref": "<file>:<symbol or line>",
          "status": "confirmed" | "rejected" | "revised",
          "reason": "..." }
      ],
      "new_cross_file_findings": [
        { "category": "DRY" | "KISS" | "YAGNI",
          "severity": "high" | "medium" | "low",
          "files": ["<path>", ...],
          "description": "...",
          "evidence": "...",
          "concrete_impact": "...",
          "suggested_fix": "..." }
      ],
      "architectural_notes": [ "..." ]
    }

================================================================================
FINAL DELIVERABLE
================================================================================

After Phase 2 completes, produce one consolidated markdown report, written to
`/tmp/kcal-audit-report.md`, with:

  1. Executive summary — total findings by category and severity, top 5
     highest-impact fixes ranked by effort-to-benefit.
  2. Findings table — one row per confirmed/new finding, columns:
     severity | category | location | concrete_impact | suggested_fix
     Sort by severity desc, then category.
  3. Architectural notes — bulleted, grouped by domain.
  4. Rejected findings — short list with reason (for audit trail).

Rules:
  - Do not write code changes. This is a review-only pass.
  - Do not create any files other than the final report.
  - Do not propose adding tests, CI, docs, or new abstractions "just in case".
  - A short report of real issues beats a long report of speculation.
  - Preserve exact file:line references so findings are actionable.
