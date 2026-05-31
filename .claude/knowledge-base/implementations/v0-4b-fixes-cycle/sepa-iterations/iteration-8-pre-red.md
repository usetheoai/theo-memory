# SEPA — Iteration 8 / Task T7.1 / Phase Pre-RED / Mode VERBOSE

Date: 2026-05-31
Agent ID: ab7e53e3668e07040

## Plan recap

T7.1 changes `LocalMemory.forget(id)` (line 484, NOT 430; top-level Memory, NOT ScopedMemory — plan citation drifted post T4.1/T5.1/T6.1) from hard `vectorStore.delete()` to soft-delete via `PgEvictor.evict([id])` for PgvectorStore. Closes F-dom-3 + F-wire-1 MAJOR; declares PUBLIC API BREAKING per ADR D7; aligns runtime with pre-existing documented `ForgetOptions.hard?: false` default.

## CRITICAL findings absorbed

1. **`forget()` on top-level Memory, not ScopedMemory** — plan citation `LocalScopedMemory.forget()` is wrong. Target is `LocalMemory.forget()` at line 484.
2. **ForgetOptions.hard already documents soft-delete as default** — v0.1 shipped impl violated docs. T7.1 fix-to-match. BREAKING from observed-runtime perspective.
3. **options.hard === true → hard-delete** (GDPR contract). Plan TDD missing this — adding 4th RED test.
4. **InMemoryVectorStore — Option A**: branch on `instanceof PgvectorStoreClass`; PgvectorStore → PgEvictor; non-Pg → fallback hard delete. JSDoc documents.
5. **EC-12 preserved** — keep `vectorStore.get()` pre-check at top of forget().
6. **History event still fires** post-soft-delete with silent-swallow.
7. **ScopedSkillMemory.forget() cascade** — v0.6 skill consumers ALSO break (via forgetDelegate at line 564). CHANGELOG + JSDoc mention this.
8. **Test path** — `tests/integration/forgetting/forget-soft-delete.test.ts` (NOT `src/local/__tests__/`) per testing.md pyramid; matches verify command.
9. **reset() stays hard-delete** — administrative wipe semantics. Note in commit body.

## Verified at audit

- `PgvectorStore.get()` does NOT filter on `t_invalid` (line 322 = `WHERE id = $1`). Idempotency test works: get() returns the soft-deleted row → pre-check passes → PgEvictor.evict() sees `t_invalid IS NOT NULL` → returns `alreadyInvalid: [id]` (no throw).

## Recommended action

5 RED tests at `tests/integration/forgetting/forget-soft-delete.test.ts`:
1. `forget() soft-deletes via t_invalid` (raw SELECT shows t_invalid IS NOT NULL)
2. `forget() is idempotent for already-evicted row` (2nd call → no throw)
3. EC-3 PUBLIC API BREAKING: raw SELECT post-forget returns 1 row with t_invalid set (NOT 0 rows as v0.1)
4. SEPA-added: `forget(id, { hard: true })` physically deletes (raw SELECT returns 0 rows — GDPR contract)
5. EC-12 preserved: `forget(unknownId)` throws MemoryNotFound

GREEN: branch on `instanceof PgvectorStoreClass`; preserve get() pre-check + history event; honor options.hard.

CHANGELOG `**BREAKING**:` entry + EC-3 verbatim text + ScopedSkillMemory cascade addendum.

JSDoc contrast block on `Memory.forget` (memory-store.ts:94) AND `LocalMemory.forget` (local/index.ts:484).
