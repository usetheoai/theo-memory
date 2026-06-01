# SEPA — Iteration 6 / Task T3.2 / Phase pre-RED (bundled into single brief)

**Date:** 2026-06-01
**Mode:** TIGHT (bundled pre-RED + post-GREEN + pre-COMMIT for trivial `rm` task)

## Plan recap
T3.2 deletes `examples/chat-with-memory/lib/openai-adapters.ts`. Atomic `git rm` followed by demo `npm run build` PASS verification.

## Pre-delete verification
- File exists at expected path ✓
- Zero importers (post-T3.1 grep returns 0) ✓
- SDK has the full implementations at `src/embedders/openai.ts` + `src/llms/openai.ts` (T1.1 + T1.2 committed)

## Anti-pattern caught
- Initial `rm` attempt was non-interactive but ALIAS `rm -i` (verified via Portuguese-language prompt "remover arquivo comum?"). The interactive prompt was NOT confirmed in non-tty Bash invocation, so file remained. Used `git rm` instead — registers deletion in git index AND removes from filesystem in one atomic op.

## Post-delete verification
- `git status --short` shows `D examples/chat-with-memory/lib/openai-adapters.ts` ✓
- Demo `npm run build` PASS post-deletion (Next.js 15.5.18 compiles all routes — file was correctly dead post-T3.1) ✓

## Wiring triad
- (a) static caller: N/A — this task REMOVES code, no new symbol
- (b) integration test: demo build IS the integration validation per ADR D5
- (c) runtime metric: N/A

## Recommended action
Commit with plan-declared subject + body citing ADR D4 (Cycle 2 — demo file deleted, not kept as re-export) + EC-1 verification + demo build PASS.
