# SEPA — Initial Brief / Plan adapters-openai-cycle-2

**Date:** 2026-06-01
**Invocation mode:** general-purpose fallback (per cycle-implement.md v1.5 — agent registry loaded at session start; mid-session-written SEPA file requires fallback).
**Agent file path passed to fallback:** `.claude/agents/implement-adapters-openai-cycle-2-2026-06-01/sepa.md`

## 1. Role acceptance

I accept the SEPA role as read-only, advisory observer for the `/implement` halt-loop on plan `adapters-openai-cycle-2`. My authority is bounded: `Read`/`Glob`/`Grep` only — never `Edit`/`Write`/`Bash`/git. My top priority is enforcing **MOVE-only scope discipline (ADR D3)**: zero behavioral change from the demo file's existing `OpenAIEmbedder`/`OpenAILLM`, accepting ONLY the `_tools?: readonly unknown[]` 3rd-param addition on `generateResponse` (per Cycle 1 DIP) and the EC-6/7/8/9/10 JSDoc absorption notes. Anything else = scope creep = CRITICAL flag. I consult 3× per iteration (pre-RED TIGHT, post-GREEN TIGHT, pre-COMMIT VERBOSE), honor TIGHT vs VERBOSE budgets, and emit `## Findings\n- INFO — clean.` rather than fabricate findings. The implementer holds commit authority; I am the second pair of eyes.

## 2. IMMEDIATE flags

INFO — initial brief clean; no IMMEDIATE flags.

Plan is v1.1 SHIPPABLE 90.8, Coverage Matrix 100% (8/8), EC absorption 100% (10/10), 6 ADRs D1-D6 with alternatives, deps audit PASS_WITH_CAVEATS with the demo-pin alignment (`^4.50.0` → `^4.77.0`) already absorbed into v1.1 ADR D2. Zero MUST FIX edge cases. Dependency graph clean (T1.1 ‖ T1.2; T3.1 → T3.2 sequential). No structural defects detected pre-halt-loop.

## 3. Pre-RED gotchas across all 7 tasks

- **EC-4 pre-flight gate (T1.2 BLOCKING):** before T1.2 GREEN run `grep -A6 "generateResponse" src/core/dip/llm.ts | head -10` and confirm `tools?: readonly unknown[]` 3rd param exists in the DIP; if absent → ESCALATE [CRITICAL] HALT (the `_tools` addition would otherwise deviate from current DIP, violating ADR D3 MOVE-only).
- **EC-1 pre-flight gate (T3.1 BLOCKING):** before T3.1 GREEN run `find examples/chat-with-memory -name '*.ts' -o -name '*.tsx' | xargs grep -lE 'from .*openai-adapters'` — MUST return exactly 1 (`lib/memory.ts`); >1 → atomic update all importers in same task; 0 → ABORT (plan claim wrong).
- **EC-2 (T1.1 + T1.2 RED):** smoke tests MUST NOT call `.embed()`/`.embedBatch()`/`.generateChat()`/`.generateResponse()` (would hit live OpenAI API → CI cost + 401 + flakiness). Assert ONLY class-defined + `typeof method === 'function'`. Explicit JSDoc warning above each test block.
- **EC-3 (T2.1):** extend `src/__tests__/no-root-reexport.test.ts` with `expect(root.OpenAIEmbedder).toBeUndefined()` + `expect(root.OpenAILLM).toBeUndefined()` — regression guard that root barrel stays opt-in subpath only (ADR D4 Cycle 1).
- **EC-6/7/8/9 JSDoc on T1.1 + EC-6/7/8/9/10 on T1.2:** class-level JSDoc must cite `optionalDependencies` + `--no-optional` guidance, `@todo Cycle 2.X model parameterization`, `@remarks` lazy singleton = ONE client per process, `OPENAI_API_KEY` env-timing hazard; T1.2 adds opaque `{error:'non_json_response', raw}` shape note per ADR D3. Missing absorption notes on T1.x = MAJOR flag.
- **MOVE-only ADR D3 (T1.1 + T1.2 post-GREEN):** verify behavioral diff vs `examples/chat-with-memory/lib/openai-adapters.ts` is ONLY (a) import paths, (b) header/JSDoc additions, (c) `_tools` 3rd param. ANY other change (retry, structured errors, model param, console.log, refactor) = CRITICAL scope creep flag → halt + defer to Cycle 2.X.
- **Pre-COMMIT discipline (all tasks):** conventional-commits format matches plan's declared message per task; commit body cites T-id + ADR ref; NEVER `Co-Authored-By` trailer (project policy); NEVER `--no-verify`; NEVER work on `main`; no `production-ready`/`production-grade`/`v1.0 ready` vocab-lock violations; no paper names (Voyager/Mem0/Letta/MemGPT/etc.) in src or tests per `no-paper-names-in-code.md`.
