# SEPA — Iteration 7 / Task T4.5 / Phase pre-RED

## Critical findings
- LLM DIP shape correction: actual methods are `generateResponse(messages, responseFormat?, tools?) → unknown` + `generateChat(messages) → LLMResponse`. Plan's `extract(prompt)` was wrong; DIP wins per cycle-implement anti-pattern #3.
- Embedder DIP: `embed(text) → number[]` + `embedBatch(texts) → number[][]`.
- Single warn-flag per stub class (simpler than per-method).
- Export `PROBE_TEXT` from `src/local/index.ts` and import in stubs (DRY both probe sites).
- `console.warn` + per-call `eslint-disable-next-line no-console` is acceptable for stubs (demo/fallback paths, not regular production loggers); document rationale inline citing arch.md § 7 + ADR D8.
- F1 followup (publish-readiness positive inclusion of new exports) — fold INTO T4.5 (single assertion added to existing test).

## Revised RED test plan (7 tests, was 6)
1. test_stub_embedder_probe_returns_correct_dim_zeros (embed(PROBE_TEXT) → MAX_EMBEDDING_DIM zeros)
2. test_stub_embedder_embed_batch_returns_zeros_per_input (embedBatch preserves order, returns zero vectors)
3. test_stub_embedder_warns_once_on_first_non_probe_call (warn fires once, then silent)
4. test_stub_llm_generate_response_returns_safe_empty (generateResponse returns {} OR empty obj)
5. test_stub_llm_generate_chat_returns_safe_response (generateChat returns LLMResponse with empty content)
6. test_stub_llm_warns_once_on_first_real_call (single shared warn-flag; first call any method warns)
7. test_createLocalMemory_with_stubs_passes_probe (integration: probe succeeds, factory resolves)
8. test_stubs_exported_from_top_level_barrel (import from '@usetheo/memory' works)
9. test_publish_readiness_positive_inclusion_of_stubs (F1 absorption: stubs.js in npm pack output)

## Wiring triad for T4.5
- (a) DEFER-TO-PR-B per ADR D7 (scaffolded singleton consumes stubs)
- (b) stubs.test.ts unit-tier + ADR-DEFER-WIRING-B note "stubs exercised via createLocalMemory probe in T3.1; standalone integration redundant"
- (c) n/a — no metric
