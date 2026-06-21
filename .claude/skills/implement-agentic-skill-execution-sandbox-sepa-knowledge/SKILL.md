---
name: implement-agentic-skill-execution-sandbox-sepa-knowledge
description: |
  Domain knowledge skill paired with the SEPA agent for plan agentic-skill-execution-sandbox (M1 isolated-vm skill sandbox). Consult during /implement when reasoning about untrusted-JS sandboxing, isolated-vm API, TDD, SOLID, Clean Code, DRY, or wiring triad — hydrates community best practices via WebSearch on top of plan-specific context (D3 isolated-vm decision + EC-1..EC-8 + project rules). Triggering phrases: "canonical isolated-vm pattern", "is this sandbox escape-safe", "best practice for untrusted JS execution", "is this idiomatic", "review against community standards".
allowed-tools: Read Glob Grep WebSearch WebFetch
model: opus
disable-model-invocation: false
---

# SEPA knowledge skill — agentic-skill-execution-sandbox

You are the knowledge layer for the SEPA auditing the `/implement` halt-loop on plan `agentic-skill-execution-sandbox` (M1). SEPA is your consumer — give it accurate, current, plan-specific community knowledge so its findings cite canonical sources, not training recall.

## Plan goal (verbatim)

"Enable an agent to execute a stored TS/JS skill inside a hardened isolated-vm sandbox so that a benign skill returns its captured output AND a malicious skill is denied with a typed error + audit event and ZERO host escape, measured by `tests/integration/skill-execution-sandbox.test.ts` passing all 6 cases against real `isolated-vm`."

## ADR summary

- **D1** — SkillExecutor DIP port in `domain/dip/`, impl in `infrastructure/db/` (DIP, OCP seam for out-of-process).
- **D2/D3** — sandbox tech = `isolated-vm` (V8 isolate) default; vm2/node:vm/worker_threads REJECTED; e2b/modal = opt-in seam not built this cycle.
- **D4** — args via `context.global.set` structured copy, NEVER string-concatenated into source (injection vector closed).

## Edge cases absorbed (must hold)

EC-1 export-strip + invocation wrapper + copy:true (else benign returns undefined); EC-2 null-code → `empty-code` denial; EC-3 missing addon → `SkillExecutorUnavailableError`; EC-4 async (promise:true or deny); EC-5 memoryLimit≥8 + timeout>0; EC-6 non-cloneable-result denial; EC-7 gating register-always+501; EC-8 each execute owns its isolate (no cross-call shared state).

## isolated-vm canonical knowledge (refresh via WebSearch/WebFetch when SEPA asks)

- `new ivm.Isolate({ memoryLimit })` (MB, min 8); `isolate.createContext()`; `isolate.compileScript(code)` runs a CLASSIC script (top-level `export` = SyntaxError; a declaration evaluates to undefined — the script's completion value is the LAST expression); `script.run(ctx, { timeout, copy: true, promise })`; `isolate.dispose()` ALWAYS in finally.
- Isolation guarantee: clean V8 context — no `require`/`process`/`fs` by default. Args cross the membrane via `ExternalCopy`/`Reference`; non-cloneable values throw.
- Maintenance mode → defense-in-depth: in-process isolate is NOT bulletproof vs a V8 0-day; the 6 guards + the out-of-process DIP seam are the backstop. Canonical sources: github.com/laverdet/isolated-vm; node:vm "not a security mechanism"; vm2 CVE-2026-22709.

## Project rules relevant

`architecture.md` (DIP src/core ← contracts no-I/O), `testing.md` (TDD pyramid; integration vs unit), `no-paper-names-in-code.md` (no Voyager/Mem0/Letta in src/**), `code-quality-golden-rule.md` (no symbol fabrication, no dead exports).

When SEPA asks for current best practice on untrusted-JS execution, defense-in-depth, or the isolated-vm API, run a focused WebSearch/WebFetch and return the canonical citation + the 1-line takeaway. Otherwise answer from the plan/blueprint context above.
