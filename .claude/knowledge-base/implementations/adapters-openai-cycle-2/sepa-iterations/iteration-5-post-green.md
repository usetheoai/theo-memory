# SEPA — Iteration 5 / Task T3.1 / Phase post-GREEN (bundled with pre-COMMIT)

**Date:** 2026-06-01

Post-GREEN inline verification (no separate SEPA invocation — trivial 3-line refactor):
- Post-redirect grep returns 0 across all demo paths ✓
- Demo `npm run build` PASS (Next.js 15 compilation successful)
- SDK `npm test` baseline preserved: 581 PASS / 2 skipped / 0 type errors
- SDK `npm run typecheck` PASS
- SDK `npm run lint` PASS

## Pre-COMMIT (bundled — TIGHT)
- Staged: 1 file, 3-line diff (+2 / -1)
- MOVE-only: zero behavioral change (same `OpenAIEmbedder` + `OpenAILLM` classes, just imported from SDK paths)
- Conventional commit format: `refactor(examples)(adapters-cycle-2): import OpenAI adapters from SDK (T3.1 / EC-1)` per plan
- Wiring: a=pass (lib/memory.ts:resolveAdapters is the production caller for OpenAIEmbedder + OpenAILLM via SDK subpaths now) b=pass (smoke tests + barrel exports tests cover the new subpath wiring; demo build is the integration validation) c=n/a

## Recommended action
Commit with plan-declared message + body citing EC-1 pre-flight verified + post-redirect grep=0 + demo build PASS.
