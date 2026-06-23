# Review: extraction-language-determinism-fixes-cycle-1 (EG-4)

**Date:** 2026-06-23
**Reviewers (spawned agents):** 4 — architecture, tests, wiring+cross-validation, domain(memory-layer)
**Findings:** 0 BLOCKER, 0 HIGH, 0 MEDIUM, 5 LOW, several INFO — all closed inline OR accepted
**Verdict:** READY_TO_MERGE

## Summary

Fixes-cycle-1 for EG-4: the v0.20.3 prompt-only language fix was disproven by the integrated live-test (real gpt-4o-mini stored English inputs as Portuguese facts). This cycle adds deterministic input-language detection + explicit target-language injection + a fail-soft post-extraction correction guard. All 4 review agents converged READY (0 BLOCKER/HIGH/MEDIUM). During review + real-LLM stability testing, THREE additional defects were found and fixed inline (see § Review-driven fixes). The hardened real-LLM GOAL is stable **6/6** vs real OpenAI + pgvector, and the **live dev-stack re-verify is 3/3 English** (DoD Row 12 satisfied).

## Review-driven fixes (closed inline)

### RF-1 (from real-LLM stability): `franc-min` mis-detection → switched to `eld`
- `franc-min` classified the PT input "Eu trabalho como engenheiro mecânico" as **Spanish** (so the explicit injection FORCED Spanish output) and English facts as Indonesian/Sundanese. Root-caused via direct detector probes.
- **Fix:** switched to `eld` (efficient-language-detector, Apache-2.0, pure-JS, zero deps), which classifies the dogfood EN/PT inputs correctly. ISO scheme 639-3 → 639-1. franc-min removed; `eld.d.ts` ambient decl added (eld ships no types). `/deps-audit`: OSV `{}` (CLEAN), pinned `^1.0.1`.

### RF-2 (from real-LLM stability): per-fact detection unreliable → AGGREGATE detection
- Any detector mis-classifies a single short fact ("Sarah ama escalada." → Catalan/Somali). The original per-fact `factLanguageMatches` let PT facts escape correction.
- **Fix:** the guard detects the language of the JOINED fact text (long enough to be reliable) and, on a confident mapped mismatch vs the input, rewrites each fact. `factLanguageMatches` removed (not dead-coded).

### RF-3 (from real-LLM stability): correction silently dropped (`{text}` shape)
- `OpenAILLM.generateResponse` text-mode returns a `{ text }` OBJECT, not a bare string; the guard's `typeof === 'string'` check discarded every correction → PT persisted.
- **Fix:** `extractResponseText` helper handles `string | { text }`; the correction call passes `{ type: 'text' }`. A unit test now uses the real `{text}` shape to lock the contract.

### F-dom-6 (LOW, from domain agent): residual not observable when correction returns empty
- **Fix:** the event now emits on DETECTION (not only on successful correction), with `{input_language, facts_language, fact_count, corrected}` — a residual (`corrected < fact_count`) is observable (Princípio 3). Fail-soft test asserts the event fires with `corrected=0` when the correction throws.

### F-xval-9 (INFO): ADR D3 prose said "OBSERVABILITY ONLY"
- **Fix:** ADR D3 + the event JSDoc updated to reflect detect-AND-correct (the in-cycle escalation recorded in Unresolved Questions).

### F-xval-8 (LOW): live re-verify (DoD Row 12) not machine-verified at review time
- **Closed:** themory image rebuilt with the fix; dev-stack container recreated; `POST /v1/remember` of the canonical EN sentence under fresh scopes returned **3/3 English** ("User works as a data scientist", "loves climbing") — no PT. The dashboard now reflects the fix.

## Findings accepted (no change)

- **F-arch-6 (LOW):** inline fact-tuple type duplication — pre-existing debt (F-arch-2 family), cosmetic.
- **F-test-8 (LOW):** no multi-fact partial-correction unit case — branches covered by the single-fact + no-op + aggregate tests; the real-LLM GOAL exercises multi-fact. Optional.
- **F-test-9 (LOW):** correction tests rely on real `eld` (deterministic, no-IO) as a collaborator — acceptable.

## Cross-validation summary

All 12 Coverage Matrix rows implemented (Row 12 live re-verify now closed). Wiring triad complete: (a) caller `remember()→runExtractionPipeline` detect+inject+guard; (b) integration GOAL (real LLM + pgvector) + 5 pipeline unit tests; (c) `extraction_language_mismatch` OTel event. Honest-disclosure consistent: the plan's § Implementation deviations + Unresolved Questions record the franc→eld switch, aggregate detection, D3 escalation, and the `{text}` extraction.

## Quality gates

- `npm run typecheck` clean; `npm run lint` clean (changed files).
- Core domain suite **488 pass**; affected EG-4 suites green (language + prompt + pipeline + memory-event sentinel 36).
- Hardened real-LLM GOAL **6/6** stable (EN→EN, PT→PT) vs real gpt-4o-mini + `ankane/pgvector:v0.5.1`.
- Live dev-stack EN remember **3/3 English** via themory REST :18081 (rebuilt image).
- `/plan-confidence` SHIPPABLE 95.6 (0 hard caps); `/deps-audit` eld CLEAN; `/code-quality` PASS (0 caps).

## Spawned agents (audit trail)

architecture (a205b0047edf5bec1), tests (afb1d3104388a5b44), wiring+cross-validation (a0812393a0a0925a2), domain-memory-layer (a76efb831758590db).

## Handoff decision

READY_TO_MERGE — 0 BLOCKER/HIGH/MEDIUM; all LOW/INFO closed inline or accepted with rationale. The fix is empirically proven against the real LLM (GOAL 6/6) and the running dev stack (3/3 EN). Proceed to `/release`.
