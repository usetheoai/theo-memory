# Review: distinct-entities-metric-fix (EG-3)

**Date:** 2026-06-23
**Reviewers (spawned agents):** 4 — architecture, tests, wiring+cross-validation, domain(memory-layer/api-design)
**Findings:** 0 BLOCKER, 0 HIGH, 0 MEDIUM, 3 LOW (2 closed inline, 1 pre-existing accepted) + INFO
**Verdict:** READY_TO_MERGE

## Summary

EG-3 aligns the `/metrics` `entity_count` to read `MemoryEntityStore.list()` — the same source the Entities/Graph tab uses — closing the dogfood "1 vs 10" divergence. All 4 agents converged on CLEAN/READY: architecture (READY, DIP correct, no widening, DRY improved via hoisted workspace resolution, fail-soft matches the entities-handler precedent), tests (GOAL non-vacuous via `>= 2` guard; consistency test uses a divergent 1-vs-3 fixture so it would FAIL if metrics still used attributedTo; 1 LOW), wiring+cross-validation (store genuinely threaded into the metrics route; all zero-change claims hold empirically; 1 pre-existing LOW), domain (scope isolation preserved, single-source-of-truth structurally proven — both handlers call the same `list()`, no sort/cap divergence; 1 LOW).

## Findings closed inline (`66e1109`)

### F-test-4 (LOW): EC-2 tested only with the default workspace
- Found by: tests. The shipped EC-2 test asserted `workspaceId: 'default'`; a regression hard-coding `'default'` (dropping the principal lookup) would still pass, leaving the multi-tenant drift path unpinned — exactly what the edge-case report's EC-2 wanted covered.
- **Fix:** added a non-default-principal test — an `authVerifier` resolving `{ workspaceId: 'ws-9', ... }` + a bearer token; asserts metrics' `list()` is called with `workspaceId: 'ws-9'`. Now the principal-resolution path is genuinely pinned. 14/14.

### F-dom-5 (LOW): stale header JSDoc on metrics.ts
- Found by: domain. The top-of-file JSDoc still described `entity_count = distinct attributedTo peers` (the inline comment at the computation was already correct).
- **Fix:** updated the header bullet to document the wired (graph entities, single source of truth) vs no-store-fallback dual meaning — honesty (Princípio 3 + ADR D2 "documented in the JSDoc").

## Finding accepted (no change)

### F-wire-3 (LOW, pre-existing): `filtersFor` triplicated across metrics/entities/graph handlers
- Pre-dates EG-3 (the metrics copy already existed for the recall counter). The plan explicitly scoped extraction out (KISS). Accepted; noted as an optional future consolidation (`handlers/scope-params.ts`) — the one DRY seam that, if it drifts, could re-introduce a divergence class. Not blocking.

## Cross-validation summary

| Task | Status |
|---|---|
| T1.1 handler `entity_count = list().length` (wired) + fallback + route wiring | fully |
| T2.1 GOAL metrics.entity_count == entities.length (>=2) vs real pgvector | fully |

ADRs D1 (align-to-list) + D2 (honest fallback) honored. ZERO new dependency, no DIP widening (`MemoryEntityStore` unchanged), no migration, no new public export (`createServer` `memoryEntityStore` option pre-existed) — all empirically verified via `git diff`.

## Quality gates (post-fix)

- `npm run typecheck`: PASS (0 errors).
- `npm run lint` on changed files: PASS (0 warnings).
- api unit: 14/14 metrics-entities (full api suite 221/221 pre-review-fix; the +1 non-default-principal test keeps it green).
- GOAL integration vs real `ankane/pgvector:v0.5.1`: 1/1 (`entity_count == entities.length >= 2`).
- `/code-quality`: PASS (score_cap 100, 0 caps).

## Pre-existing (NOT introduced; disclosed per Inquebrável Rule 3)

`filtersFor` triplication (F-wire-3). Lint debt in v0.18/v0.19 cycle files — not in this diff.

## Spawned agents (audit trail)

architecture (a4e00e91), tests (a24e1798), wiring+cross-validation (a1233b24), domain (a6c21a06).

## Handoff decision

READY_TO_MERGE — 0 BLOCKER/HIGH/MEDIUM; 2 LOW closed inline at `66e1109`; 1 pre-existing LOW accepted. Proceed to `/release` (patch bump → v0.20.2, a `### Fixed`-only release).
