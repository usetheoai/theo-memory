# Edge Case Review — skills-write-surface

Date: 2026-06-19
Tasks analyzed: 10 (T1.1–T5.1)
Edge cases found: 4 (MUST FIX: 1, SHOULD TEST: 2, DOCUMENT: 1)

The plan inherits the read cycle's hardened plumbing (EC-1 workspace parity, EC-2 path chars, D3 namespacing, D5/D6 documented) — those carry over. The write-specific edges below are new.

## MUST FIX

### EC-W1: collision catch must not mask a non-hash unique-violation
- **Affected task:** T1.1
- **Family:** State / Format
- **Scenario:** `add()` catches PG `code === '23505'` → throws `SkillAlreadyExists`. If any OTHER unique constraint ever fires on the skill insert path, a 23505 would be mis-mapped to 409 (hiding a real bug).
- **Impact:** a future schema change adding a second unique index would silently mis-report.
- **Suggested fix:** guard the catch on the hash constraint specifically — `e.code === '23505' && (e.constraint?.includes('hash') ?? true)` — and re-throw otherwise (the plan T1.1 already says "optionally the constraint name"; promote to REQUIRED). Today `memories_hash_scope_unique_idx` is the only unique index hit on a skill insert, so behavior is correct now; the guard future-proofs it.

## SHOULD TEST

### EC-W2: two concurrent identical POSTs → exactly one 201, one 409
- **Affected task:** T2.4 (integration)
- **Suggested test:** `test_concurrent_duplicate_post_one_201_one_409` — fire 2 parallel POSTs with the same description; assert exactly one 201 and one 409 (the DB `UNIQUE(hash)` is the arbiter; proves no lost-update / no double-insert).

### EC-W3: DELETE of a memory-id (not a skill) under a repo → 404
- **Affected task:** T2.2 / T2.4
- **Suggested test:** `test_delete_non_skill_id_returns_404` — `forget` on an id that is a user-memory (kind≠skill) or another repo's skill → `MemoryNotFound` → 404 (the scoped-forget guard already enforces kind+scope; assert the REST 404 mapping).

## DOCUMENT

### EC-W4: code size cap value is provisional
- **Accepted risk:** `MAX_SKILL_CODE_BYTES` = 64 KiB is a starting guard (DOS); a legitimate large skill could exceed it. Documented as Unresolved Q1; adjustable without contract change. The cap returns 413 (honest) rather than truncating.

## Summary

| Task | Edges | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------|----------|-------------|----------|
| T1.1 | 1 | 1 (EC-W1) | 0 | 0 |
| T2.2/T2.4 | 2 | 0 | 2 (EC-W2, EC-W3) | 0 |
| T2.1 | 1 | 0 | 0 | 1 (EC-W4) |

**Verdict:** PLAN OK (minor) — absorb EC-W1 into T1.1 (promote constraint-name guard to REQUIRED); fold EC-W2/EC-W3 into T2.4 TDD; EC-W4 already in Unresolved Q1. No new modules, no scope creep.
