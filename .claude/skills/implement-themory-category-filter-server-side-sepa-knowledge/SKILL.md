---
name: implement-themory-category-filter-server-side-sepa-knowledge
description: Knowledge layer for the SEPA agent tracking the /implement halt-loop on plan themory-category-filter-server-side. Provides quick access to plan v1.2, edge-case absorption (EC-1 through EC-12), deps-audit verdict, ADR D6 UPSERT discipline, ADR D4 cross-repo merge order, and per-task implementation contract. Auto-trigger phrases: themory-category-filter, RememberOptions.category, MemoryItem.category, Filters.category, category column, payload hoist, ADR D6, EC-1 UPSERT, EC-2 length cap, EC-3 empty-string normalization. Generated 2026-06-09.
---

# Knowledge: themory-category-filter-server-side

Paired with `.claude/agents/implement-themory-category-filter-server-side-2026-06-09/sepa.md`. When the SEPA agent OR the main halt-loop encounters a question about this plan's contract, refer here.

## Quick references

- **Plan (1156 LoC)**: `.claude/knowledge-base/plans/themory-category-filter-server-side-plan.md`
- **Edge-case review (12 ECs)**: `.claude/knowledge-base/reviews/themory-category-filter-server-side-edge-cases-2026-06-09.md`
- **Deps audit**: `.claude/knowledge-base/audits/themory-category-filter-server-side-deps-audit-2026-06-09.md`
- **Implementation contract**: `.claude/knowledge-base/implementations/themory-category-filter-server-side-implementation.md`
- **RED TEAM trigger**: `theo-cloud/theo/.claude/knowledge-base/reviews/red-team-results-dashboard-memories-2026-06-09.md` § F3

## Core invariants (memorize)

| Rule | Source | Owner |
|---|---|---|
| `RememberOptions.category` is OPTIONAL (`?:`) | T1.1 + ADR D1 | core types |
| Category is operator-supplied; NOT LLM-inferred | ADR D1 | extraction pipeline |
| Top-level column + btree index (NOT JSONB path) | ADR D2 | schema + adapter |
| Length cap 1-64 chars | ADR D3 + EC-2 | REST + SDK boundary |
| Cross-repo merge order: TheMemory FIRST | ADR D4 | release sequencing |
| In-memory adapter mirrors pgvector NULL semantics | ADR D5 | both stores |
| UPSERT does NOT overwrite category (first-write wins) | ADR D6 + EC-1 | pgvector adapter |
| Empty-string filter ≡ undefined (no-filter) | EC-3 | 3 layers: in-mem, pgvec, getAll |
| Case-sensitive (byte equality; no NFC/NFD norm) | EC-4 + EC-5 | filter predicate |
| SQL injection guarded by parameterized binding | EC-6 | composeFilters |
| Cursor+changed-filter is consumer error (graceful) | EC-7 | REST handler |
| BFF reads from `payload.category` projection | EC-8 + EC-12 | Go BFF client |
| Legacy `category=NULL` rows NOT findable via filter | EC-9 + ADR D1 | docs in JSDoc |
| `db:push` + `runMigrations()` both apply cleanly | EC-11 + arch §10.2 | migration 0014 (column-only) |
| Top-level field + payload projection both present | EC-12 (mirrors v1.1 attributed_to) | architectural symmetry |

## Per-task quick-reference

| Task | Key files | Key tests | Critical absorption |
|---|---|---|---|
| T1.1 | src/core/{options,memory-item,scope}.ts | 4 type-shape tests | EC-9 + EC-12 JSDoc |
| T2.1 | src/local/schema.ts + migration 0014 | 3 idempotency tests | EC-11 (column-only safe) |
| T3.1 | src/local/in-memory-store.ts | 6 tests | EC-3, EC-4 |
| T3.2 | src/local/pgvector-store.ts | 10 tests | **EC-1 ADR D6**, EC-3, EC-4, EC-5, EC-6, EC-12 |
| T3.3 | src/core/extraction/pipeline.ts | 5 tests | **EC-2** boundary throw |
| T4.1 | src/server/handlers/scopes.ts + src/local/index.ts | 8 tests | EC-3 SDK boundary, EC-7 cursor, EC-9 JSDoc |
| T4.2 | tests/integration/server/category-filter-public-api-smoke.test.ts | 2 tests | full-chain sentinel |
| T5.1 (cross-repo) | theo-cloud client.go + tests | 3 Go tests | EC-8 dual-pathway |
| T5.2 (cross-repo) | theo-cloud dashboard memories.test.tsx | 1 test | empty-state UX |

## Anti-patterns specific to this plan

- Adding `category` to ON CONFLICT SET list (violates ADR D6 first-write-wins)
- Treating `filters.category === ''` as "filter for empty string" (violates EC-3)
- Adding `category` to extraction LLM prompt (violates ADR D1)
- Back-filling pre-existing rows with `category='general'` (violates ADR D1 honest NULL)
- Implementing case-insensitive filter (violates EC-4)
- Implementing Unicode NFC normalization (violates EC-5)
- Committing T5.1/T5.2 before T1.1-T4.2 deploy + restart (violates ADR D4)
- Using `payload->>'category'` JSONB path predicate (violates ADR D2 column promotion)
- Skipping the EC-2 boundary check because "REST already validates" (violates defense-in-depth; SDK callers bypass REST)
- Removing the `category` field from the projected payload at SELECT time (breaks BFF's existing reader per EC-12)
