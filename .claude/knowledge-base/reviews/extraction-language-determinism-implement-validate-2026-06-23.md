# Implement Validation — extraction-language-determinism (EG-4)

**Date:** 2026-06-23
**Plan:** `.claude/knowledge-base/plans/extraction-language-determinism-plan.md` (v1.1, SHIPPABLE_WITH_CAVEATS 78)
**Verdict:** PASS

## Gates

| Gate | Result |
|---|---|
| `npm run typecheck` (`tsc -p tsconfig.contract.json`) | PASS — 0 errors |
| `npm run lint` on changed files | PASS — 0 warnings (prompt.ts, extraction-prompt.test.ts) |
| Extraction unit suite | PASS — 80 passed (7 files; incl. the new EG-4 prompt assertion) |
| T1.1 `extraction-prompt.test.ts` | PASS — 30/30 (fact-language clause present + entity/relation rule + "user" exception no-regression) |
| T2.1 GOAL `tests/integration/extraction-language-determinism.test.ts` vs REAL OpenAI + real pgvector | PASS — 2/2 (PT input → PT fact; EN input → EN fact; 9.7s real-LLM latency) |
| `/code-quality extraction-language-determinism` | PASS (score_cap 100, 0 caps) |

## Tasks (TDD per task)

- **T1.1** extended the `LANGUAGE:` clause in `SYSTEM_PROMPT` to pin `memory[].text` to the source language; deterministic prompt unit test. RED (clause absent) → GREEN. A first GREEN attempt failed because "literal token \"user\"" got split across two array lines (→ newline); fixed by keeping the phrase contiguous.
- **T2.1** real-OpenAI GOAL: robust language assertion (PT stems present + EN word-boundary translation absent, and vice-versa) on non-cognate inputs. GREEN against real OpenAI.

## Wiring triad

- **Caller:** write pipeline Phase 2 → `generateAdditiveExtractionPrompt` → `SYSTEM_PROMPT` (now with the fact-language clause) → `deps.llm.generateResponse`. Exercised end-to-end by the GOAL via `remember()`.
- **Integration test:** `tests/integration/extraction-language-determinism.test.ts` (REAL OpenAI + real pgvector).
- **Runtime observability:** the persisted fact text IS the observable (Memories tab / `getAll()`); no new failure path (a prompt string change).

## Edge cases (from edge-case-plan, all absorbed)

- EC-1 robust anti-flake assertion (stems + word-boundary absent-translation, non-cognate inputs) — implemented in the GOAL.
- EC-2 (cognate inputs can't prove direction) — avoided "software"; used "mecânico"/"hiking". DOCUMENT.
- EC-3 (mixed-language input) + EC-4 (no backfill of historical facts) — DOCUMENT, accepted.

## Notes / honest disclosure (Inquebrável Rule 3)

- `packages/core` prompt clause only; ZERO new dependency; no schema/type/DIP change (ADR-0008 untouched); no migration; no new public export.
- The GOAL uses a REAL OpenAI LLM (the correctness is LLM-behavioral; a stub would be theater per D2). It is `skipIf` no `OPENAI_API_KEY` — the deterministic prompt unit test is the always-on CI guard.
- The embedder in the GOAL is a crafted stub: embeddings are irrelevant to the fact-text LANGUAGE under test; the LLM (the thing under test) is real, honoring the "use real LLM" rule where it matters.
- No paper names in `src/**`. Pre-existing lint debt elsewhere is NOT in this diff.
- Composes with EG-2 (v0.20.1) + EG-3 (v0.20.2): same write pipeline; consistent-language facts also dedup correctly with the noise-filtered entity graph.
