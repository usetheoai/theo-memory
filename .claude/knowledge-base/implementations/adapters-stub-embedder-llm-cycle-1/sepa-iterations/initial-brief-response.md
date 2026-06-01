# SEPA — Initial Brief / adapters-stub-embedder-llm-cycle-1

**Date:** 2026-06-01
**Mode:** VERBOSE
**Verdict:** proceed-to-halt-loop with T1.2 pre-RED lock

## Plan recap
- Ship deterministic `DeterministicStubEmbedder` + `DeterministicStubLLM` at NEW subpath exports `@usetheo/memory/embedders/stub` + `@usetheo/memory/llms/stub`; unblock F-T4.1-2 debug with offline-reproducible adapters; 6 atomic commits.

## Findings

### Pre-RED locks (BEFORE halt-loop starts)

- **[MAJOR] T1.2 extraction JSON shape drift** — Plan stated `{ facts: [{text}] }` but actual Zod schema at `src/core/extraction/prompt.ts:89` is `AdditiveExtractionSchema = { memory: [{ id: string, text: string, attributed_to?: string, linked_memory_ids?: string[] }] }`. T1.2 RED test MUST assert via `AdditiveExtractionSchema.safeParse(response).success === true`. LLM stub generates sequential id `"1"`, `"2"`, `"3"` (1-indexed per `prompt.ts:39`).
- **[MAJOR] vitest.contract.config.ts existing include adds `src/local`** — current is `{core,local,theokit,agent-tools}`. T0.1 implementer must ADD `embedders` + `llms` to make `{core,local,theokit,agent-tools,embedders,llms}`. Plan acceptance criterion still holds.
- **[MAJOR] LLM.generateResponse has 3rd `tools?` param** — `src/core/dip/llm.ts:22-26`. `DeterministicStubLLM` signature must include `_tools?: readonly unknown[]` with `void _tools;` per existing stub pattern at `src/local/stubs.ts:82-93`.

### Confirmations
- [MINOR] EC-1 NaN guard properly absorbed in plan v1.1
- [INFO] All 6 tasks aligned; implementation contract task-list matches
- [INFO] `src/embedders/` + `src/llms/` dirs do NOT exist on disk → clean RED state for T0.1
- [INFO] `package.json#exports` pattern (`{types, default}` → `.ts` source) matches existing convention
- [INFO] Deps audit PASS (zero new deps); Rule 9 satisfied vacuously
- [INFO] No `Co-Authored-By` policy + no-paper-names policy active; SEPA will scan every pre-COMMIT

## Recommended action

**proceed-to-halt-loop** with the following locks injected at T1.2 pre-RED:

1. RED test uses `AdditiveExtractionSchema.safeParse()` as contract assertion
2. LLM stub generates `{ memory: [{ id: "1", text: "..." }, { id: "2", text: "..." }, { id: "3", text: "..." }] }` shape (up to 3 entries; `attributed_to` + `linked_memory_ids` omitted)
3. `generateResponse` signature includes `_tools?: readonly unknown[]` with `void _tools;` pattern

These convert plan EC-8 (DOCUMENT) from "TDD will catch" → "pre-RED locked", saving an expected GREEN-retry cycle.
