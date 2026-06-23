# Review: extraction-language-determinism (EG-4)

**Date:** 2026-06-23
**Reviewers (spawned agents):** 4 — architecture, tests, wiring+cross-validation, domain(memory-layer/LLM-extraction)
**Findings:** 0 BLOCKER, 0 HIGH, 0 MEDIUM, 2 LOW (advisory, accepted) + INFO
**Verdict:** READY_TO_MERGE

## Summary

EG-4 extends the extraction prompt's source-language rule to the `memory[].text` fact (it previously pinned only entity names + relation labels), so the LLM stops translating facts non-deterministically. All 4 agents returned CLEAN/no-issues:

- **Architecture:** purely-additive prompt-string edit (4 added / 2 removed array elements); `AdditiveExtractionSchema` + `generateAdditiveExtractionPrompt` untouched; no DIP/type/contract change (ADR-0008), no new export (export grep identical); consistent with the shipped option-b source-language rule (not force-EN). No findings.
- **Tests:** real-LLM GOAL justified (LLM-behavioral property), `skipIf`-gated so keyless CI is safe; the deterministic prompt unit test is the always-on guard (30/30, re-run green by the agent); EC-1 anti-flake faithfully implemented (stems + word-boundary absent-translation, non-cognate inputs); non-vacuous (positive stem assertions guard the empty-string case). 2 LOW advisory.
- **Wiring+cross-validation:** SYSTEM_PROMPT provably consumed in the production `remember()` path (`pipeline.ts:369→377-380`); T1.1/T2.1 map 1:1; all zero-change claims git-verified; D1 + D2 conform; fix targets the documented root cause exactly. No findings.
- **Domain:** "user" speaker exception preserved + widened correctly; consistent with entity/relation + diacritic rules; dedup-stability reasoning verified against `hashFact` (MD5 over raw fact text, no normalization → same-fact-same-language dedups, translated variant would not); `memory[].text` field reference matches the JSON format + schema; no paper names. No findings.

## LOW findings (advisory — accepted, no change)

- **F-test-5 (LOW):** the EN negative regex `/caminha|trilha/` lacks a `\b` and is slightly asymmetric vs the PT case; the reviewer noted `/\btrilh/` would be marginally more rephrase-robust but "no real flake risk" and "none required". Accepted as-is to avoid an unnecessary real-OpenAI GOAL re-run (cost) for a strictly-cosmetic robustness delta; the current form correctly distinguishes EN from PT on the chosen input.
- **F-test-6 (LOW):** the GOAL cases are AAA-shaped but lack explicit `// Given/When/Then` comments, and there is one input per language (a deliberate KISS trade-off to minimize real-LLM variance per the plan's Drawbacks). Reviewer: "no additional scenario is mandatory". Accepted.

## Cross-validation summary

| Task | Status |
|---|---|
| T1.1 prompt clause + deterministic unit test | fully |
| T2.1 real-LLM GOAL (PT→PT, EN→EN) | fully |

ADRs D1 (preserve source language, not force-EN) + D2 (real-LLM GOAL) honored. ZERO new dependency, no schema change, no migration, no DIP widening, no new public export — all git-verified.

## Quality gates

- `npm run typecheck`: PASS (0 errors).
- `npm run lint` on changed files: PASS (0 warnings).
- Extraction unit suite: 80 passed (prompt unit 30/30).
- GOAL integration vs REAL OpenAI + real pgvector: 2/2 (PT input → PT fact; EN input → EN fact; 9.7s real-LLM latency).
- `/code-quality`: PASS (score_cap 100, 0 caps).

## Pre-existing (NOT introduced; disclosed per Inquebrável Rule 3)

Lint debt in v0.18/v0.19 cycle files — not in this diff. Dedup remains exact-byte (rephrasing within a language still won't dedup) — by design (ADR D3), not overclaimed.

## Spawned agents (audit trail)

architecture (aba002be), tests (a5943f95), wiring+cross-validation (a5821f3c), domain (acd45204).

## Handoff decision

READY_TO_MERGE — 0 BLOCKER/HIGH/MEDIUM; 2 LOW advisory accepted (reviewers explicitly marked "none required"). Proceed to `/release` (patch bump → v0.20.3, a `### Fixed`-only release).
