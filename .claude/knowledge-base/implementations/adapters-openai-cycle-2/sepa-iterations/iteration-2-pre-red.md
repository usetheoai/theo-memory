# SEPA — Iteration 2 / Task T1.1 / Phase pre-RED

**Date:** 2026-06-01
**Mode:** TIGHT (escalated to VERBOSE inline due to CRITICAL finding)
**Subagent:** general-purpose (fallback)

## Plan recap
T1.1: MOVE `OpenAIEmbedder` (lines 1-47 of `examples/chat-with-memory/lib/openai-adapters.ts`) verbatim into NEW `src/embedders/openai.ts` + write smoke test at `src/embedders/__tests__/openai.test.ts` asserting DIP shape WITHOUT calling `.embed()` / `.embedBatch()` (EC-2).

## Findings

- **[CRITICAL] — Singleton sharing is SCOPE CREEP + DIP violation.** Do NOT create a new shared module (`src/core/openai-client.ts` would inverte DIP — core CANNOT depend on adapter SDK; `src/embedders/openai-client.ts` would be a new file not in demo — violates ADR D3 MOVE-only). DUPLICATE the `_openai` + `client()` pair in each file (`src/embedders/openai.ts` AND T1.2's `src/llms/openai.ts`).

- **[MAJOR] — EC-8 JSDoc note needs correction:** original plan text says "ONE client per process". After duplication, the truth is "ONE client per module per process (2 total)". Update wording in both files.

- **[MAJOR] — Import path:** use `'../core/dip/embedder.js'` (matches Cycle 1 stub precedent `src/embedders/stub.ts:56`), NOT `@usetheo/memory/contract` (demo-only path).

- **[MAJOR] — EC-5 absorption:** NO `MAX_EMBEDDING_DIM` import — 1536 is model-implicit via `text-embedding-3-small`.

- **[MAJOR] — Drop T1.2 territory:** no `LLM`/`LLMResponse`/`Message` imports; no `CHAT_MODEL` constant.

- **[MAJOR] — EC-2 test discipline:** JSDoc comment above `describe` block warning against `.embed()`/`.embedBatch()` calls; assert only class definition + method types.

- **[MAJOR] — Required JSDoc absorption (EC-5/6/7/8/9):** all 5 absorption notes ABOVE the class. Missing any = MAJOR finding at post-GREEN.

- **[MAJOR] — TDD shape:** `describe('OpenAIEmbedder')` + `it('exposes the Embedder DIP shape', ...)` per testing.md BDD. RED = file not found.

## Recommended action

1. DUPLICATE singleton per file; do NOT create shared module.
2. EC-8 JSDoc: `lazy singleton: ONE OpenAI client instance per module per process (two total: one in embedders/openai.ts, one in llms/openai.ts). Acceptable trade-off vs ADR D3 MOVE-only.`
3. RED first: write smoke test asserting class + method shape; confirm file-not-found failure.
4. GREEN: create file with lift + 5-EC JSDoc + corrected EC-8.
5. Import `Embedder` from `'../core/dip/embedder.js'`.
