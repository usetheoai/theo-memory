---
slug: themory-import-cli
generated_by: roadmap-feature
date: 2026-07-22
status: completed
milestone_id: M12
---

# Feature grill — themory-import-cli

## Q1 — What is this feature and why now?

Productize the M6 T2.1 migration script (`scripts/migrate-claude-code-memory.mjs`) as a first-class
shipped surface: a `themory import claude-code` CLI subcommand (dry-run default, `--commit`,
`--source`, env `THEOMEM_*` with `~/.claude/theo-memory.env` fallback) + a thin `/migrate-theo-memory`
kit skill that ORCHESTRATES the CLI (dry-run → report → confirm → commit → recall verification),
never re-implementing the migration in LLM-space. **Why now:** the 2026-07-22 live test proved the
demand (432 nodes across local projects, 292 carrying secrets that the fail-closed scrub redacted) and
the script is repo-internal today — kit adopters have no safe, zero-config path. Decision rationale
(owner + assistant, this session): an LLM-driven migration was REJECTED — the deterministic scrub is a
security control (fail-closed), verbatim fidelity matters, 432 single-item MCP calls vs 1 batch
request, and idempotency/reporting must be deterministic. The skill is UX; the CLI is the engine.

## Q2 — Dependencies

**M6** (the migration script + kit hooks + canonical scrub exist) + **M7** (the MCP-gateway path the
skill's recall-verification uses). Both `[x]` → M12 is immediately eligible.

## Q3 — Definition of Done

1. `themory import claude-code` shipped: dry-run default, `--commit`, `--source <dir>`, endpoint/token
   via `THEOMEM_*` env with `~/.claude/theo-memory.env` fallback; existing unit tests ported and green.
2. Scrub canonical in the shipped package — single source of truth with the kit hooks (M6-SEC-01) —
   with a sentinel test asserting kit and CLI consume the same deny-list.
3. Kit skill `/migrate-theo-memory` (dry-run → report → confirm → `--commit` → recall verification) +
   docs (kit README + RUNBOOK).
4. Integration test on real pgvector: import round-trip is idempotent (re-run → deduped, zero dupes).
5. `themory` CLI locked-names list amended in CLAUDE.md (+ CHANGELOG) — `import` verb added.

## Q4 — Top 2 NEW risks

1. **Diverged scrub copy in the CLI leaks secrets (HIGH).** Mitigation: ONE canonical scrub module in
   the shipped package; kit copies from it; a sentinel parity test on the deny-list.
2. **`import` namespace invites scope creep (MEDIUM)** (openmemory/mem0/... importers). Mitigation:
   ship ONLY `import claude-code`; the namespace is documented as future-extensible (YAGNI on other
   sources until requested).

## Step 3 — out-of-scope cross-check

No overlap. The import reads Claude Code's OWN file memory into theo-memory — it is data interop, not
the cut vendor data-adapter ("wrapping a vendor SDK as a backend"), same classification precedent as
Item 26 (OpenMemory MCP-shape compat).

## Step 5 — SOTA delta

**No** — internal productization of shipped M6 code; existing references sufficient. No new peers.
