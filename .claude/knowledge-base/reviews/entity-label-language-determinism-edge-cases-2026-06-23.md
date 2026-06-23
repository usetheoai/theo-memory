# Edge Case Review — entity-label-language-determinism (EG-5)

Date: 2026-06-23
Tasks analyzed: 3 (T1.1–T3.1)
Edge cases found: 5 (MUST FIX: 0, SHOULD TEST: 2 absorbed, DOCUMENT: 3)

## MUST FIX

(none)

## SHOULD TEST

### EC-1: referential integrity — relation endpoint renamed to match its entity
- **Affected task:** T1.1
- **Family:** State
- **Scenario:** an entity `surfar` is translated to `surfing` but the relation `{user, gosta de, surfar}` destination still says `surfar` → orphan edge (points at a node that no longer exists).
- **Resolution:** ABSORBED — D2 applies ONE distinct-surface→translation map to entity names AND relation source/relationship/destination. T1.1 RED test asserts the relation destination is renamed identically (`surfar`→`surfing`).

### EC-2: partial / extra-key translation map
- **Affected task:** T1.1
- **Family:** Format
- **Scenario:** the LLM map omits a label or returns extra keys.
- **Resolution:** ABSORBED — defensive apply `map[label] ?? label`; extra keys ignored. T1.1 RED test with a partial map.

## DOCUMENT

### EC-3: proper-name mistranslation (e.g. "Acme")
- **Accepted risk:** the prompt pins "preserve proper names"; bounded to the one label + observable via `corrected`. Captured in Drawbacks (Medium).

### EC-4: renamed entity collides with an existing target-language node
- **Accepted risk:** this is the DESIRED dedup convergence (Princípio 2) — two language variants resolving to one node is correct. Captured in Drawbacks (Low).

### EC-5: LLM map call timeout/5xx/non-JSON
- **Accepted risk:** fail-soft — own try/catch keeps originals; event fires `corrected=0`; `remember()` resolves. Captured in `## Failure scenarios`. T1.1/T2.1 stub-throw tests.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 4 | 0 | 2 (absorbed) | 2 |
| T2.1 | 1 | 0 | 0 | 1 |
| T3.1 | 0 | 0 | 0 | 0 |

**Verdict:** PLAN OK (2 SHOULD-TEST absorbed into T1.1; 3 risks documented). deps-audit: NO new dependency (reuses eld@^1.0.1, already CLEAN per EG-4) → no-op delta.
