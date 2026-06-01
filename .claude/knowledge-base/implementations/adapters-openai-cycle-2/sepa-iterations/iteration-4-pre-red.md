# SEPA — Iteration 4 / Task T2.1 / Phase pre-RED

**Date:** 2026-06-01
**Mode:** TIGHT (extended inline)
**Subagent:** general-purpose (fallback)

## Plan recap
T2.1: barrel re-exports + `package.json#exports` + EC-3 root-no-reexport regression guard.

## Findings
- **6 files touched** (not 4 — plan undercount):
  1. `src/embedders/index.ts` — add `export { OpenAIEmbedder } from './openai.js';`
  2. `src/llms/index.ts` — add `export { OpenAILLM } from './openai.js';`
  3. `package.json` — 2 new `#exports` entries (`./embedders/openai` + `./llms/openai`) with `.ts` source paths matching Cycle 1 shape
  4. `src/__tests__/no-root-reexport.test.ts` — 2 EC-3 assertions (regression guard; passes immediately)
  5. `src/embedders/__tests__/exports.test.ts` — 2 new `it()` blocks (GREEN-driving — initially RED)
  6. `src/llms/__tests__/exports.test.ts` — 2 new `it()` blocks (GREEN-driving — initially RED)
- Import specifier MUST use `.js` extension (NodeNext ESM): `'./openai.js'`.
- Root `src/index.ts` UNCHANGED — ADR D4 of Cycle 1 + EC-3 regression guard lock this.
- JSDoc on new test blocks should cite this cycle's plan (T2.1) + EC-3 + ADR D4 distinctly.

## RED plan
- Step 1 (regression guard, passes immediately): extend `no-root-reexport.test.ts`
- Step 2 (GREEN-driving, fails): extend BOTH `exports.test.ts` files asserting `barrel.OpenAIEmbedder` / `barrel.OpenAILLM` defined + identity to direct import

## Recommended action
Proceed RED → GREEN. Iteration log records 6 files. No CRITICAL. T2.1 is pure plumbing.
