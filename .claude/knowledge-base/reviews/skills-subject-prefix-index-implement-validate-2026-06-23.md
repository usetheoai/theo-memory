# Implement-Validate — skills-subject-prefix-index (M2 / SEC-1)

**Date:** 2026-06-23
**Branch:** develop
**Commit:** c394831
**Verdict:** PASS

## Cycle-implement discipline (executed directly — single-phase, 1 migration; per token-budget.md "manual TDD when plan simple + tests trivial")

| Phase | Result |
|---|---|
| RED | `tests/integration/skills-subject-prefix-index.test.ts` written → 2 failed before the index (behavioral EXPLAIN showed `agent_id ~~ 'alice:%'` as a post-scan **Filter** on `memories_hash_scope_unique_idx` — the live SEC-1 defect) |
| GREEN | index declared in `schema.ts`; `npm run db:generate` → `0021_shallow_fenris.sql` + `0021_snapshot.json` + journal append; `IF NOT EXISTS` added (idempotency, 0005/0008/0009 precedent); `npm run build` (migrations copied to dist) → 2/2 GREEN |
| REFACTOR | none needed (additive index + isolated test) |
| WIRING | caller = the UNCHANGED `PgvectorStore.listSkillsBySubject` query (production path already exercises the index via the planner); integration test = the new GOAL; runtime metric = N/A (an index is a transparent accelerator of an existing path, not a new feature surface — the existing recall/list path metrics cover usage) |
| COMMIT | `c394831` (atomic, references SEC-1/M2) |

## Validation gates

| Gate | Result |
|---|---|
| `npm run typecheck` (tsc -p tsconfig.contract.json) | PASS (0 errors) |
| `npm run lint` (packages/*/src) | PASS (0 warnings; schema.ts covered) |
| `npm run build` | PASS (migrations copied to dist) |
| New GOAL test vs real pgvector | 2/2 PASS |
| Cross-repo GOAL (`skills-cross-repo-flat-list.test.ts`) | 5/5 PASS (results byte-unchanged) |
| `schema-snapshot-parity.test.ts` | PASS (table parity intact) |
| `publish-readiness.test.ts` | PASS (pack manifest ships `0021_*.sql` + snapshot) |
| `/code-quality` | PASS (score_cap 100, zero caps) |

## Evidence — the captured plan (proof SEC-1 is closed)

```
Bitmap Heap Scan on memories
  Recheck Cond: ((workspace_id = 'default') AND (kind = 'skill') AND (t_invalid IS NULL))
  Filter: (agent_id ~~ 'alice:%')
  ->  Bitmap Index Scan on idx_memories_skill_subject_prefix
        Index Cond: ((workspace_id = 'default') AND (agent_id ~>=~ 'alice:') AND (agent_id ~<~ 'alice;'))
```

The prefix is now a **range Index Cond** (`~>=~` / `~<~`) on the new index — before the fix it was a post-scan `Filter` over a Seq/unique-index scan of the whole shared partition.

## Coverage Matrix — 9/9 delivered (all plan claims mapped + verified)

| Goal claim / requirement | Task | Verified by |
|---|---|---|
| New `(workspace_id, agent_id text_pattern_ops)` partial index ships | T1.2 | `0021_shallow_fenris.sql` (single `CREATE INDEX`, opclass + partial WHERE) |
| Index declared in schema.ts (parity, no `db:push` drift) | T1.2 | `schema.ts` index decl; `db:generate` no-op (no drift) |
| Migration idempotent (`CREATE INDEX IF NOT EXISTS`) + journal + snapshot | T1.2 | SQL `IF NOT EXISTS`; `_journal.json` idx 21; `0021_snapshot.json` |
| Pack manifest ships the new `.sql` + snapshot | Final | `publish-readiness.test.ts` PASS |
| Structural proof: index uses `text_pattern_ops` opclass on `agent_id` | T1.1/T1.3 | structural test asserts `pg_indexes.indexdef` |
| Behavioral proof: EXPLAIN shows Index Cond range scan, not Seq Scan | T1.1/T1.3 | behavioral test (captured Bitmap Index Scan + `Index Cond` range) |
| `listSkillsBySubject` results byte-unchanged (no query change) | T1.3 | cross-repo GOAL 5/5 PASS; `pgvector-store.ts` untouched |
| No public-API change | D2/D3 | barrel surface unchanged; no new export |
| CHANGELOG updated | Final | `[Unreleased] § Fixed` entry (SEC-1, M2) |
```
