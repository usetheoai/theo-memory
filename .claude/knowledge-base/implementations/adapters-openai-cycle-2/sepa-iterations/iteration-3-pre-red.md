# SEPA — Iteration 3 / Task T1.2 / Phase pre-RED

**Date:** 2026-06-01
**Mode:** TIGHT
**Subagent:** general-purpose (fallback)

## Plan recap
Lift `OpenAILLM` + `toOpenAIMessages` from `examples/chat-with-memory/lib/openai-adapters.ts:49-92` into NEW `src/llms/openai.ts` (MOVE-only per ADR D3) + NEW smoke test `src/llms/__tests__/openai.test.ts`.

## EC-4 pre-flight (BLOCKING gate) — PASS
`src/core/dip/llm.ts:LLM.generateResponse` has `tools?: readonly unknown[]` as 3rd param. The plan's `_tools` addition is valid per ADR D3.

## Findings
- **[CRITICAL]** — Underscore-prefix convention required: `_tools?: readonly unknown[]` + `void _tools;` discard at top of method body. Verified in `src/llms/stub.ts:106-108`. Matches TypeScript's `noUnusedParameters` lint with `argsIgnorePattern: '^_'`.
- **[MAJOR]** — Lift BOTH `generateResponse` + `generateChat` methods + the `toOpenAIMessages` helper.
- **[MAJOR]** — JSDoc absorbs 5 ECs: EC-6 (optionalDeps + --no-optional), EC-7 (`@todo Cycle 2.X` model param), EC-8 (lazy singleton ONE per module per process), EC-9 (env timing), EC-10 (opaque `{error:'non_json_response', raw}` shape preserved per ADR D3).
- **[MINOR]** — `process.env['OPENAI_API_KEY']` bracket notation (same as T1.1).
- **[MINOR]** — Files: exactly 2 NEW files. No barrel touch (T2.1 territory).

## Recommended action
RED first: smoke test asserts `OpenAILLM` defined + `generateResponse` + `generateChat` methods of type `function`; EC-2 JSDoc warning. Then GREEN: lift with the 6 adjustments (imports, duplicated singleton, bracket-notation env, `_tools` 3rd param + `void _tools;` discard, internal `toOpenAIMessages`, 5-EC JSDoc).
