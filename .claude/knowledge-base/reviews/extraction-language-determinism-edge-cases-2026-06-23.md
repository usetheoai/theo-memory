# Edge Case Review — extraction-language-determinism (EG-4)

Date: 2026-06-23
Tasks analyzed: 2 (T1.1, T2.1)
Edge cases found: 4 (MUST FIX: 0, SHOULD TEST: 1, DOCUMENT: 3)

A one-clause prompt change + a real-LLM GOAL. Low blast radius (additive prompt text; no code/type/schema change). No MUST FIX. One SHOULD TEST hardens the real-LLM GOAL against flakiness; three DOCUMENT accept inherent LLM/translation limits.

## SHOULD TEST

### EC-1: the GOAL's language assertion must be robust to LLM phrasing variance (anti-flake)
- **Affected task:** T2.1
- **Family:** Format / Timing
- **Scenario:** a real LLM rephrases the fact ("Eu trabalho como engenheiro de software" → could persist "O usuário trabalha como engenheiro de software" OR "trabalha como engenheiro"). A brittle exact-string assertion would flake.
- **Suggested test:** assert on a STEM/substring that survives rephrasing (`trabalh` covers trabalho/trabalha; `engenheiro`) AND assert the obvious English translation token is ABSENT (case-insensitive `\bworks?\b`, `\bengineer\b`). Use word-boundary regexes, lowercase-normalized, over the CONCATENATED fact texts (the LLM may split into >1 fact). Pick inputs whose PT and EN forms differ unambiguously (avoid cognates like "software"/"social").

## DOCUMENT

### EC-2: cognate/loanword inputs can't prove translation direction
- **Accepted risk:** words identical across PT/EN ("software", "design", "marketing", proper nouns) carry no language signal. The GOAL deliberately uses inputs with a discriminating verb ("trabalho"→"work", "trabalha" stays PT) so the assertion is meaningful. Documented so a future edit doesn't swap in a cognate-only input that would pass vacuously.

### EC-3: mixed-language input picks the dominant language (not asserted)
- **Accepted risk:** an input mixing PT+EN ("I love café com leite") leaves the output language to the LLM's discretion. Out of scope — the dogfood issue was single-language inputs being translated; mixed-language is rare and has no single correct answer. Not asserted (KISS).

### EC-4: historical pre-EG-4 facts stay mixed-language (ADD-only, no backfill)
- **Accepted risk:** per Q1, rows persisted before EG-4 are immutable; the fix is go-forward only. Consistent with the v1.1 EC-1 no-backfill precedent. The dashboard may show old mixed-language facts until they age out via forgetting — acceptable, documented.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 0 | 0 | 0 | 0 |
| T2.1 | 4 | 0 | 1 | 3 |

**Verdict:** PLAN OK (no MUST FIX). Absorb EC-1 (robust stem + word-boundary absent-translation assertion) into T2.1's TDD; EC-2/EC-3/EC-4 are accepted/documented trade-offs.
