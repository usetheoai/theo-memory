# SEPA Initial Brief — dashboard-memories-tab-standardization (2026-06-08)

## Plan recap
Cross-repo cycle closing two coupled defects surfaced in 2026-06-08 E2E session: (a) backend temporal fidelity bug at `src/local/index.ts:807-810` where `LocalScopedMemory.getAll` constructs `MemoryItem.{createdAt, updatedAt, tValid}` via `new Date()` (now) instead of consuming DB row truth — fixed via additive `VectorStoreResult.createdAt?: Date` (ADR D1) + PgvectorStore.list SELECT projection (T2.1) + InMemoryVectorStore parity (T2.2) with D2 fallback emitting `getall_temporal_fallback` OTel event; and (b) frontend Dashboard Memories tab missing the 4-scope-tabs + standardized columns pattern shipped by sibling `entities.tsx` — fixed via in-place edit (ADR D3) at `cloud/dashboard/src/pages/memory/memories.tsx`. 10 tasks across 5 phases, 11/11 Coverage Matrix, 6 ADRs D1-D6, 13 ECs absorbed (5 MUST FIX inline + 5 SHOULD TEST in TDD blocks + 3 DOCUMENT in ADRs), zero new npm packages, follow-up DRAFT file via T6.1 closes EC-5 sub-goal-7 orphan for the 5 OTHER deferred createdAt instances (per ADR D5).

## Risk surface (top 5 across the 10 tasks, severity-ordered)

1. **[CRITICAL] Cross-repo merge-order corruption window** — T3.0 SHA pin in `theo-cloud/cloud/dashboard/package.json` MUST land in theo-cloud BEFORE T3.2/T3.3 frontend tasks commit, OR Dashboard scope-tabs reference fields that the unpinned npm `@usetheo/memory` doesn't expose → runtime crash on tab render for any consumer pulling between the two repo merges (1-24h window per EC-4). Recommendation: enforce strict serialization — Phase 2 commits to theo-memory `develop` first → T2.2 SHA captured → T3.0 commits to theo-cloud pinning that SHA → only THEN T3.2/T3.3 commits land in theo-cloud. SEPA Pre-COMMIT VERBOSE for T3.0 must verify the pinned SHA matches the actual T2.2 commit (not HEAD-1 or HEAD+1).

2. **[CRITICAL] Path C composition discipline at T3.1** — Affected: T3.1 only. The plan v1.2 EXPLICITLY rejects `wireMemoryFromPool(pool)` because it hard-wires `LocalTransformerEmbedder` which pulls `@xenova/transformers → onnxruntime-web → protobufjs <7.5.5` (CVSS 9.8 RCE, pre-existing repo-wide chain). T3.1 MUST compose via `createLocalMemory({ vectorStore: new PgvectorStore(pool, ...), embedder: new DeterministicStubEmbedder({ dim: 384 }), llm: stubLLM([]), embeddingDim: 384 })`. Recommendation: SEPA Pre-RED for T3.1 (MODE=VERBOSE override) must grep the test file for `wireMemoryFromPool` and HALT-recommend if found; verify import of `DeterministicStubEmbedder` from `@usetheo/memory/embedders/stub` subpath.

3. **[CRITICAL] ADR D5 scope creep into 5 DEFERRED createdAt instances** — Affected: any task touching `src/local/index.ts`. The plan EXCLUDES `src/local/index.ts:643` (recall), `src/local/index.ts:756` (reflection 1), `src/local/index.ts:957` (consolidation), `src/local/scoped-skill-memory.ts:104` (skill scope getAll), `src/local/skills/payload.ts:78` (skill payload). T2.2 will edit `src/local/index.ts:807-810` — the ONLY authorized site. If any diff touches the other 4 file:line guards in `src/local/index.ts` OR the 2 other files, FLAG [CRITICAL] scope-creep + recommend HALT. Escalation: log to T6.1 DRAFT file, do NOT expand current cycle scope.

4. **[MAJOR] EC-7 fallback event aggregation correctness** — Affected: T2.2 (InMemoryVectorStore + getAll). The `getall_temporal_fallback` OTel event MUST be emitted AT MOST ONCE per getAll() request with `{count: N}` metadata. The plan pseudo-code at index.ts:807 line `emitEvent(this.config.tracer, 'getall_temporal_fallback', { id: r.id })` placed INSIDE the .map() loop is the PER-ROW shape and contradicts EC-7. Recommendation: SEPA Pre-RED for T2.2 must verify the implementation pattern is "count fallback rows in one pass, then emit once after the map" — NOT per-row emission. The plan's pseudo-code at line 533-535 is misleading; the TDD test `test_getall_fallback_event_emitted_at_most_once_per_scope_per_request` is the load-bearing constraint.

5. **[MAJOR] EC-1 null-safe coerce + EC-2 deterministic ORDER BY are LOAD-BEARING for T2.1** — Affected: T2.1. EC-1: `createdAt: r.created_at !== null ? new Date(r.created_at) : undefined` — bare `new Date(r.created_at)` returns 1970-01-01 silently on NULL legacy rows (epoch lie — different bug, same shape). EC-2: SQL MUST contain literal `ORDER BY created_at DESC, id ASC` — `id ASC` is the load-bearing tiebreaker for Dashboard pagination determinism (pre-fix, all rows had createdAt=now() so any order was meaningless; post-fix, without the id tiebreak the same offset returns flickering rows across refreshes). Recommendation: SEPA Pre-RED for T2.1 must verify both RED tests are written (`test_pgvector_list_maps_null_created_at_to_undefined_not_epoch` AND `test_pgvector_list_orders_by_created_at_desc_then_id_asc`) BEFORE GREEN.

## Cross-cutting concerns (the 3 most-load-bearing)

- **Cross-repo merge order (T3.0 in theo-cloud BEFORE T3.2/T3.3)** — Why it matters: This is the single largest production-risk vector in the cycle. Backend lands in theo-memory `develop` (commit X = T2.2 SHA), then T3.0 in theo-cloud pins `package.json` to commit X via `"@usetheo/memory": "github:usetheo/theo-memory#<X>"`, regenerates `package-lock.json`, and commits. Only THEN T3.2/T3.3 land in theo-cloud referencing the new scope-tabs fields. How to verify: SEPA Pre-COMMIT VERBOSE for T3.0 must Grep the package.json for the literal T2.2 SHA + confirm `node_modules/@usetheo/memory/package.json` (post `npm install`) resolves to the same SHA + confirm theo-cloud PR description CITES the T2.2 SHA explicitly per EC-4 absorption.

- **Path C composition in T3.1 (DeterministicStubEmbedder NOT wireMemoryFromPool)** — Why it matters: Pulling `wireMemoryFromPool(pool)` into the test runtime injects the `@xenova/transformers` chain — protobufjs <7.5.5 CVSS 9.8 RCE in the test runtime. The fidelity assertion is on `created_at`, fully INDEPENDENT of embedder behavior; `DeterministicStubEmbedder` preserves the canonical 8-phase write pipeline + schema NOT NULL constraints (vector(384), payload jsonb, hash UNIQUE per scope). Verification: SEPA Pre-RED T3.1 grep for forbidden token `wireMemoryFromPool`; confirm presence of `DeterministicStubEmbedder` import from `@usetheo/memory/embedders/stub` subpath; confirm `embeddingDim: 384` matches PgvectorStore config. If `wireMemoryFromPool` appears anywhere in the test file, FLAG [CRITICAL] and HALT-recommend.

- **ADR D5 scope discipline — 5 OTHER createdAt instances DEFERRED to themory-temporal-fidelity-full-fix follow-up** — Why it matters: Without strict guard, the implementer (or REFACTOR pass) sees "5 similar bugs in adjacent code" and "fixes them while here" → cycle expands from 10 tasks to ~20 → loses test atomicity, cross-cuts v1.1 bi-temporal `asOf` invariants (CLAUDE.md Roadmap Item 12) that need separate empirical validation, breaks the cycle's scope-bounded plan. File:line guards to monitor in every diff that touches `src/local/`:
  - `src/local/index.ts:643` (recall path) — MUST NOT be modified
  - `src/local/index.ts:756` (reflection path 1) — MUST NOT be modified
  - `src/local/index.ts:957` (consolidation path) — MUST NOT be modified
  - `src/local/scoped-skill-memory.ts:104` (skill scope getAll) — MUST NOT be modified
  - `src/local/skills/payload.ts:78` (skill payload) — MUST NOT be modified

## Pre-implementation flags (anything I'd halt for BEFORE Phase 1 starts)

- **INFO — No CRITICAL pre-implementation flags; halt-loop may proceed to T1.1 RED.**
- Two procedural reminders:
  1. T1.1 → T2.1 → T2.2 sequentially in theo-memory; TAG T2.2 commit SHA explicitly before opening any theo-cloud PR.
  2. T6.1 is independent. Best moment: right after T2.2 (citations fresh in mind).

## SEPA mode for iteration 1 pre-RED
- Recommended MODE: TIGHT (T1.1 is a pure type-change with low risk).

## Loop tradition
- The main session is the implementer. I am the watcher. Both honor the same plan.
- Honest BLOCKED > false completion (Inquebrável Rule 3).
