# SEPA — Iteration 5 / Task T3.1 / Phase pre-RED

**Date:** 2026-06-01
**Mode:** TIGHT
**Subagent:** general-purpose (fallback)

## Plan recap
T3.1 redirects demo `lib/memory.ts:49` from `./openai-adapters` to SDK subpaths.

## EC-1 pre-flight (BLOCKING gate) — PASS
`find examples/chat-with-memory -name '*.ts' -o -name '*.tsx' | xargs grep -lE 'from .*openai-adapters'` returns exactly 1 path (`examples/chat-with-memory/lib/memory.ts`).

## Findings
- INFO — Plan claim "ONLY lib/memory.ts imports" verified.
- INFO — Import-block convention: alphabetical-within-tier. Cycle 1 stubs at lines 46-47; pg at 48; relative at 49.
- MAJOR — Recommended placement: insert `embedders/openai` BEFORE `embedders/stub` (alphabetical `openai < stub`), `llms/openai` BEFORE `llms/stub` (same rule), delete old `./openai-adapters` import. Symmetric with Cycle 1 layout (ADR D1).
- INFO — TDD shape: RED = pre-flight grep returns 1 + demo build PASS baseline. GREEN = post-redirect grep returns 0 + demo build PASS.
- INFO — T3.1/T3.2 separate commits is correct per plan. Intermediate state safe (file becomes dead unimported; demo build still PASSes).
- INFO — Files: 1 file (`lib/memory.ts`). No JSDoc changes.

## Recommended action
Apply 4-line replacement at lines 46-49.
