# Review: post-v0.5.0 hardening

**Date:** 2026-06-18
**Diff base:** `245fb75` (v0.5.0 release prep) → HEAD. Hardening found during full pre-production validation: `THEOMEM_EMBEDDER` selection, `list()` soft-delete fix, build/Docker fixes.
**Reviewers (spawned agents):** 7 — architecture, tests, wiring, cross-validation, domain-memory-layer, domain-database, domain-cli-tooling.
**Findings:** 2 HIGH, ~4 MEDIUM, ~6 LOW/INFO. **All HIGH + the load-bearing MEDIUMs fixed in-cycle.**
**Verdict:** **READY_TO_MERGE** (after fixes below; re-validated green).

---

## HIGH (fixed)

### F-dom-mem-1 — `reset(scope)` regression introduced by the list fix
The `list()` soft-delete fix (live-only) regressed `Memory.reset(scope)` (admin/GDPR full-scope wipe), which enumerates rows via `list()` then hard-deletes — so soft-deleted (forgotten) rows survived the wipe.
**Fix:** `VectorStore.list` gained an opt-in 3rd param `includeSoftDeleted` (default false → getAll stays live-only); `reset()` passes `true` to enumerate + physically delete tombstones. Regression: `pgvector-store-list-temporal` asserts `list(...,true)` returns BOTH live + soft-deleted. (`local-memory.ts`, `pgvector-store.ts`, `vector-store.ts` DIP, `in-memory-store.ts`)

### F-dom-cli-1 / F-arch-1 / F-dom-mem-2 — destructive dim-change footgun (3-agent consensus)
Switching `THEOMEM_EMBEDDER` on a populated DB auto-triggered the destructive dim-change cascade (`DELETE FROM memories` + entities + audit) via migrate-on-startup, with only a WARN — a routine env edit = silent data loss.
**Fix:** fail-closed guard in `migrations-runner.ts` — refuse the dim change when `row_count > 0` unless `THEMEMORY_ALLOW_DESTRUCTIVE_DIM_CHANGE=1`. Fresh DB (0 rows) still migrates silently (normal first-boot). The destructive-cascade test opts in explicitly.

## MEDIUM (fixed / documented)

| ID | Finding | Resolution |
|---|---|---|
| F-wire-1 | `themory migrate` not embedder-aware → left schema at vector(1536) default | `run-migrate.ts` now resolves `embeddingDimForKind(resolveEmbedderKind())` |
| F-tests-2 | dim/migration coupling not unit-tested | Covered by dim-change integration + the in-image OpenAI boot validated manually; noted |
| F-tests-1 | no integration test boots `THEOMEM_EMBEDDER=openai` | Validated manually end-to-end (live + Docker image); automated boot test noted as follow-up |
| F-dom-cli-3 | CLAUDE.md "199.7 MB" image size stale after INCLUDE_OPTIONAL flip | Noted (doc) — image now ships onnxruntime-node |

## LOW / INFO (accepted)
- F-arch-3: 3-site OCP for a 3rd embedder — YAGNI for 2 backends (frozen Item 24 registry).
- F-dom-mem-3 / wiring: in-memory store has no soft-delete state (hard-deletes) — `includeSoftDeleted` is a no-op there; LSP preserved.
- F-dom-db-1: no standalone index on `t_invalid`; production path is always scope-filtered (covered by partial index).
- Princípio 3 preserved: soft-deleted rows still visible via `Memory.history(id)`.

## Cross-validation
6 commits in range; CHANGELOG accurate; no overclaim (the "lean image" was NOT claimed — `@xenova` still shipped; "no @xenova at runtime" correctly scoped to the openai code path). Embedder default stays `local` (back-compat); disclosure string byte-identical on the default path.

## Quality gates
- typecheck PASS · lint PASS (0 warnings) · `/code-quality` PASS (100)
- contract 977 · **integration 542 / 0 failed** · core 704 · all packages green.

## Spawned agents (audit trail)
`.claude/agents/review-post-v050-hardening-2026-06-18/{architecture,tests,wiring,cross-validation,domain-memory-layer,domain-database,domain-cli-tooling}.md`

## Handoff decision
**READY_TO_MERGE.** The list-fix-induced reset regression is closed with a regression test; the destructive dim-change footgun is fail-closed; `themory migrate` is embedder-aware. Remaining items are LOW/doc. Recommend folding into a `v0.5.1` release.
