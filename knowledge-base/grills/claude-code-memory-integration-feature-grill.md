---
slug: claude-code-memory-integration
generated_by: roadmap-feature
milestone_id: M6
date: 2026-07-20
status: completed
out_of_scope_overlap: none (3 out-of-scope items are all memory-layer internals, orthogonal)
blueprint: knowledge-base/discoveries/blueprints/claude-code-theo-memory-integration-blueprint.md
---

# Grill — M6 claude-code-memory-integration

## Q1 — What & why NOW

Make **Claude Code (all instances, globally) use theo-memory (hosted) as its persistent memory**,
via a **hooks-first hybrid** (deterministic `SessionStart` auto-recall + `Stop` auto-remember;
remote MCP as an explicit complement), PLUS a **one-shot migration** of Claude Code's native
file-memory (487 `*/memory/*.md` files across 77 projects) into theo-memory.

**Why now:** (1) theo-memory is now deployed + reachable (M5 CD pipeline is live); (2) this IS the
product's own dogfood thesis — CLAUDE.md's anchor scenario is literally "Claude Code auto-memory
backed by TheMemory", so every Claude Code session becomes real dogfood evidence; (3) the deep
research (blueprint, 3 cited frames) settled the effective architecture — **hooks beat MCP tools**
for reliable auto-capture (the model forgets to call MCP `remember`; hooks fire deterministically).

## Q2 — Dependencies

- **Soft: M5** (the deployed, reachable theo-memory endpoint) — the kit talks to the hosted REST;
  M5's deploy makes it reachable. The M6 **server-side batch endpoint** ships in the theo-memory
  repo independently of M5's checkbox.
- **Owner-provided (blocks go-live, not the build):** the PRODUCTION edge host/path that accepts a
  `theo_live_*` key for `/v1/memory/*` — `app-dev.usetheo.dev` is the dashboard SPA (Caddy), NOT
  the authenticated memory edge; the `theo_live_*` + Traefik `/v1/memory/*` flow was only confirmed
  on local dev (`:8090`). Resolve with the team before pointing the kit at prod.
- No hard dependency on M0–M4.

## Q3 — Definition of Done

1. **Server-side batch import (theo-memory repo — gates the milestone).** `POST /v1/remember/batch`
   accepts an array `[{ text, infer:false, attributedTo, metadata, category, <scope> }, …]` in one
   request, `memory:write`-scoped, with a batch-aware rate-limit (the 30-writes/60s per-token limiter
   makes one-request-per-fact infeasible for thousands). Integration test vs real pgvector: a batch
   inserts N facts, `metadata:{source}` round-trips on recall, and a re-run is idempotent
   (`confirmation_count` bumps, no double-insert).
2. **Migration tool.** Parses Claude Code memory nodes (BOTH frontmatter variants: nested
   `metadata.type` + flat `type`; `[[wikilinks]]` → entity edges), runs a **mandatory secret/PII
   scrub**, defaults to **dry-run + review report** (nothing persists without approval), then
   batch-imports via `infer:false` with provenance metadata. Test: a fixture set containing a
   PLANTED secret proves the secret is scrubbed (never persisted) and re-import dedups.
3. **Global Claude Code kit.** `SessionStart` (auto-recall → inject via `additionalContext`) +
   `Stop` (auto-remember, `async`) hooks (+ `UserPromptSubmit`/`PreCompact`) MERGED into
   `~/.claude/settings.json` (never clobbering the existing 3 hooks) + remote MCP registered
   `--scope user`. Recall is **project-namespaced** (no cross-project context pollution).
4. **Live proof.** A fact written in one Claude Code session is auto-recalled (injected) in a fresh
   session on the same project — end-to-end against the hosted (or local-dev) theo-memory.
5. **Auth documented** — the `theo_live_*` dashboard-mint → Bearer → memory edge flow, and the kit
   points at the resolved prod edge host.

## Q4 — Top 2 NEW risks

1. **Production edge host unconfirmed (HIGH).** `app-dev.usetheo.dev` is the SPA; the authenticated
   `/v1/memory/*` edge for a `theo_live_*` key is only verified on local dev. If the kit points at
   the wrong host it silently 404s. Mitigate: resolve the prod edge with the team (owner task);
   validate the whole flow on local dev (`:8090`) first; make the kit's endpoint a single config knob.
2. **Secret / PII leakage in the migration (HIGH).** Claude Code memory files are a known secret
   vector (they can contain keys/tokens/PII). A naive import embeds them into the shared store.
   Mitigate: the scrub stage is MANDATORY + fail-closed (a node that can't be safely scrubbed is
   skipped, not imported); dry-run review shows exactly what was redacted before any write.
