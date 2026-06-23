# Edge Case Review — extraction-language-determinism-fixes-cycle-1

Date: 2026-06-23
Tasks analyzed: 4 (T1.1–T4.1)
Edge cases found: 4 (MUST FIX: 0, SHOULD TEST: 1 absorbed, DOCUMENT: 3)

## MUST FIX

(none)

## SHOULD TEST

### EC-1: detected-but-unmapped ISO-639-3 code
- **Affected task:** T1.1
- **Family:** Format
- **Scenario:** franc-min confidently classifies an input (e.g. Mandarin → `cmn`) whose ISO code has NO entry in our ISO-639-3→name map.
- **Impact:** injecting "Write ALL facts in cmn" would be gibberish to the model — worse than no directive.
- **Resolution:** ABSORBED into T1.1 — `detectInputLanguage` returns `null` when the code is unmapped (treated like `und` → no injection → current behavior). New RED test added.

## DOCUMENT

### EC-2: code-switched input (mixed PT + EN in one message)
- **Accepted risk:** franc returns the dominant language; the directive pins that one. Already captured in Drawbacks & Risks (Medium). The D3 guard observes any per-fact mismatch via OTel. Acceptable — single-language pinning is strictly better than today's free translation.

### EC-3: short fact text in the guard
- **Accepted risk:** franc is unreliable on very short facts ("user trabalha"). `factLanguageMatches` is fail-soft (returns true when either side is undetermined) → no false `extraction_language_mismatch` spam. Covered by a T1.1 test.

### EC-4: LLM extraction call timeout / 5xx
- **Accepted risk:** UNCHANGED — the pre-existing `try/catch` returns `[]` (fail-soft). Detection runs before the call (pure-local); the guard runs after a successful parse. No new external failure mode. Captured in `## Failure scenarios`.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 3 | 0 | 1 (absorbed) | 2 |
| T2.1 | 0 | 0 | 0 | 0 |
| T3.1 | 1 | 0 | 0 | 1 |
| T4.1 | 0 | 0 | 0 | 0 |

**Verdict:** PLAN OK (1 SHOULD-TEST absorbed into T1.1; 3 risks documented).
