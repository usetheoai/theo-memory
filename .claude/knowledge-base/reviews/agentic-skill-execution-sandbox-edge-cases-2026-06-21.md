# Edge Case Review — agentic-skill-execution-sandbox

Date: 2026-06-21
Tasks analyzed: 8 (T1.1–T1.4, T2.1–T2.4) + Integration phase
Edge cases found: 8 (MUST FIX: 3, SHOULD TEST: 3, DOCUMENT: 2)

## MUST FIX

### EC-1: `export function` / ESM syntax is not runnable via `compileScript`
- **Affected task:** T1.3 (executor), Phase 3 (GOAL benign case #1)
- **Family:** Format
- **Scenario:** The benign fixture is `export function add(x,y){return x+y}`. isolated-vm's `compileScript`/`compileScriptSync` compiles a CLASSIC script — top-level `export` is a `SyntaxError`. Worse, even a bare `function add(){}` declaration evaluates to `undefined` (a declaration is not an expression), so nothing is returned across the membrane. The benign case (and every real skill) would fail.
- **Impact:** the whole GOAL test fails; the executor never returns a skill's output.
- **Suggested fix:** in T1.3, the wrapper MUST (a) strip the leading `export ` from `export (async )?function NAME` (mirror Letta `typescript_generator.py` import/export handling), and (b) append an invocation expression `NAME(...injectedArgs); ` as the last statement, returning its value via `script.run(ctx, { timeout, copy: true })` (or `new ivm.Reference(...).copy()`). Add to Deep Dives + a RED test asserting `add(2,3)` returns `5`.

### EC-2: derived skills have `code === null` → NPE / undefined run
- **Affected task:** T1.3 (executor) + T2.1 (façade pre-read)
- **Family:** Input / State
- **Scenario:** `Skill.code` is `string | null` (`packages/core/src/domain/skill.ts:34` — consolidate-derived skills carry `code=null`). Executing a derived skill passes `null` into `compileScript` → throws a raw error, not a typed denial.
- **Impact:** raw crash / uninformative 500 instead of a typed, auditable denial.
- **Suggested fix:** guard at the top of `execute()` (façade T2.1 OR executor T1.3): `if (skill.code === null) throw new ToolInvocationDeniedError('empty-code', ...)`. Add `'empty-code'` to the reason union (T1.2) + a RED test.

### EC-3: missing optional addon must surface a distinct typed error, not raw MODULE_NOT_FOUND
- **Affected task:** T1.3 (lazy `await import('isolated-vm')`)
- **Family:** Resource / Integration
- **Scenario:** `isolated-vm` is an OPTIONAL dependency. In a deployment that did not install it, `await import('isolated-vm')` throws `ERR_MODULE_NOT_FOUND`. The plan says "surfaces a clear error" but does not type it — a raw module error leaking to the REST/MCP boundary is unmapped (becomes a generic 500).
- **Impact:** un-actionable 500; consumer cannot distinguish "addon not installed" from "skill denied" or "skill crashed".
- **Suggested fix:** wrap the dynamic import; on failure throw a dedicated typed error (e.g. `SkillExecutorUnavailableError` with an install hint, mapped to 503/501 at REST) — distinct from `ToolInvocationDeniedError` (denial) and `SkillExecutionNotConfiguredError` (no executor wired). Add the class to T1.2 + a RED test stubbing the import to throw.

## SHOULD TEST

### EC-4: async skill (`export async function`) returns a Promise across the membrane
- **Affected task:** T1.3, Phase 3
- **Suggested test:** `test_execute_async_skill` — an `async function` skill must either be awaited via `script.run(ctx, { timeout, promise: true, copy: true })` (Letta detects async via AST, `typescript_generator.py:68` `is_async_typescript_function`) OR be denied with a typed `'unsupported-async'` reason in v1. Decide + assert; add `'unsupported-async'` to the reason union if rejecting. Without this, an async skill silently returns a Promise Reference instead of its value.

### EC-5: `memoryLimitMb` below isolated-vm's 8MB minimum / non-positive `timeoutMs`
- **Affected task:** T1.3 (SkillExecutionOptions handling)
- **Suggested test:** `test_execute_opts_bounds` — `new ivm.Isolate({ memoryLimit })` requires ≥ 8 (MB); a value < 8 throws inside isolated-vm. Clamp/validate `memoryLimitMb` to ≥ 8 and `timeoutMs` to > 0 (reject ≤ 0 with `InvalidScope`-style validation) before constructing the isolate. Assert both bounds.

### EC-6: non-copyable RETURN value (function/symbol/circular) cannot cross the membrane
- **Affected task:** T1.3 (output extraction, guard #6)
- **Suggested test:** `test_execute_noncopyable_result` — a skill returning a function or a circular object cannot be `copy:true`-extracted; isolated-vm throws. Map to `ToolInvocationDeniedError('non-cloneable-result')` (sibling of D4's `'non-cloneable-args'`). Add the reason + assert.

## DOCUMENT

### EC-7: REST/MCP gating — register-always + 501-when-not-configured (KISS) vs conditional registration
- **Affected task:** T2.3 (says map not-configured→501) vs T2.4 (says "register only when enabled")
- **Accepted risk / clarification:** pick ONE gating model and state it. Recommendation (KISS): register the route/tool ALWAYS; when no executor is wired, `execute()` throws `SkillExecutionNotConfiguredError` → REST 501 / MCP error result. This matches the prior honest `501 SKILL_LISTING_NOT_IMPLEMENTED` precedent and avoids conditional route tables. Update T2.3/T2.4 wording to the same model.

### EC-8: each `execute()` uses its own isolate → no cross-call shared state
- **Affected task:** T1.3
- **Accepted risk:** concurrency safety is by construction — every `execute()` creates + disposes its own `ivm.Isolate`, so concurrent executions share no V8 heap/global. No locking needed. Documented so a reviewer does not ask for cross-call synchronization. The only concurrency test that matters is the per-call timeout/dispose (already in T1.3 Concurrency tests).

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 0 | 0 | 0 | 0 |
| T1.2 | 0 | 0 | 0 | 0 |
| T1.3 | 6 | 2 (EC-1, EC-3) | 3 (EC-4, EC-5, EC-6) | 1 (EC-8) |
| T1.4 | 0 | 0 | 0 | 0 |
| T2.1 | 1 | 1 (EC-2) | 0 | 0 |
| T2.3/T2.4 | 1 | 0 | 0 | 1 (EC-7) |

**Verdict:** PLAN NEEDS ADJUSTMENT (3 MUST FIX — all in the executor core: EC-1 code-invocation/export-strip, EC-2 null-code guard, EC-3 missing-addon typed error. Absorb into v1.1 — they grow the reason union + add `SkillExecutorUnavailableError` + the wrapper invocation logic — then re-run `/deps-audit` + `/plan-confidence`.)
