# SEPA log — iteration 1 / T0.1 / pre-RED

**Mode:** TIGHT
**Date:** 2026-06-01

**Plan recap:** T0.1 ships migration 0007_distillation_columns.sql adding `consolidation_history` table (EC-3: kept_memory_id ON DELETE SET NULL; EC-9: NO schema change to memories.derived_from — already JSONB v0.4a). Idempotent via IF NOT EXISTS.

**Findings:**
1. [NONE-CRIT] Plan declares 5 files (line 217-220 + 231). ✓
2. [NONE-CRIT] ADR D3 SQL + Acceptance criteria consistent: `kept_memory_id uuid REFERENCES memories(id) ON DELETE SET NULL` + NULLABLE. ✓
3. [NONE-CRIT] EC-9 honesty: derived_from already JSONB v0.4a (src/local/pgvector-store.ts:34 + :71 round-trip). NO schema change to memories. ✓
4. [MAJOR-RED] RED test should ADD assertion (d): rejected_memory_ids JSONB array unchanged after hard-delete (since value-stored, no FK). Locks "survives by construction" claim.
5. [MAJOR-Journal] _journal.json at idx=6 (v="7"). T0.1 appends idx=7 `{idx:7, version:"7", when:<ms>, tag:"0007_distillation_columns", breakpoints:true}`. 0007_snapshot.json must mirror 0006 shape (top-level {id, prevId:"<0006.id>", version:"7", dialect:"postgresql", tables:{...}}).
6. [NONE-DEPS] v0.4b deps shipped: ForgetOptions.hard at src/core/options.ts:61; hard-delete at src/local/index.ts:517-520; withTransactionFn at src/local/pgvector-skill-store.ts:67,163; OTel lazy-init at src/local/eviction/pg-evictor.ts:50-75. ✓

**Recommended action:** Proceed to RED. Write tests/integration/distillation/forget-hard-survives-audit.test.ts with 4 assertions (a)+(b)+(c)+(d). Expect FAIL (table missing). Then GREEN: SQL + snapshot + journal append. Idempotency: runMigrations() twice → 2nd no-op via IF NOT EXISTS.

No CRITICAL blockers.
