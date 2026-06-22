---
slug: agentic-skill-execution-sandbox
milestone_id: M1
created_at: 2026-06-21
goal: Execute a stored TS/JS skill inside a hardened isolated-vm sandbox so a malicious skill is denied + audited with zero host escape, measured by the GOAL integration test.
---

# Plan: Agentic skill execution + hardened isolated-vm sandbox (M1 / gap G2 / Item 21)

> **Version 1.1** (edge-case MUST-FIX absorbed 2026-06-21: EC-1 strip `export` + append invocation expression + `copy:true` result extraction → T1.3; EC-2 `code === null` guard → typed denial → T1.2 reason `empty-code` + T1.3/T2.1; EC-3 missing-addon → dedicated `SkillExecutorUnavailableError` → T1.2/T1.3. SHOULD-TEST EC-4 async, EC-5 opts-bounds, EC-6 non-cloneable-result absorbed into T1.3 reason union + tests. EC-7 gating clarified register-always+501. See `agentic-skill-execution-sandbox-edge-cases-2026-06-21.md`.)

> **Version 1.0** — Closes the open Voyager loop: TheMemory STORES code-as-skill (`SkillLanguage = 'typescript' | 'javascript'`, `packages/core/src/domain/skill.ts:20`) but never executes it. This plan adds a `SkillExecutor` DIP + a default `SandboxedSkillExecutor` (in-process V8 isolate via `isolated-vm`, D3-locked) with security-by-design shipping WITH execution (Slice 1, sandbox-first, NO executor wired), then wires `ScopedSkillMemory.execute()` + a gated REST `POST .../skills/:skillId/execute` + an opt-in MCP `execute_skill` tool (Slice 2). STORE-only stays the default; execution is opt-in. Grounded in blueprint `agentic-skill-execution-sandbox-blueprint.md` (SHIPPABLE_WITH_CAVEATS 89, D3 owner-locked 2026-06-21).

## Goal

> "Enable an agent to execute a stored TS/JS skill inside a hardened isolated-vm sandbox so that a benign skill returns its captured output AND a malicious skill is denied with a typed error + audit event and ZERO host escape, measured by `tests/integration/skill-execution-sandbox.test.ts` passing all 6 cases (1 benign + 5 per-guard malicious) against real `isolated-vm`."

## Context

CLAUDE.md Roadmap Item 21 (G2) was UNFROZEN 2026-06-21 (PRIORITY 0 full unfreeze). The `/loop-cross-validation` vs Letta (3.58/5) flagged procedural EXECUTION as TheMemory's highest-value gap: Letta executes agent-authored tools (`tool_execution_sandbox.py`), TheMemory only stores them. The discovery cycle produced the blueprint + the owner D3 decision (`isolated-vm` default, e2b/modal as opt-in DIP seam). Security is the whole point: the 6 guards + typed error + OTel event ship WITH execution, never after (Princípio 3 auditability; memory `themory-agentic-tool-use-planned`). Scope guardrail (owner, repeated across CLAUDE.md amendments): STORE-only stays default; execution is opt-in + gated; the human curates, the agent authors+executes.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/core/src/domain/dip/skill-executor.ts` (NEW) | 0 | — | (to be created) the `SkillExecutor` DIP port + result/option types | — |
| `packages/core/src/domain/skill.ts` | 198 | `skill.ts:185` (ScopedSkillMemory iface; SkillLanguage :20) | Skill row + `ScopedSkillMemory` contract (add/recall/getAll/consolidate/forget) | additive: append `execute()` to the interface; existing 5 verbs unchanged |
| `packages/core/src/domain/errors.ts` | 400+ | `errors.ts:344` (InvalidSkillError) | typed domain error hierarchy (21 classes) | additive: append `ToolInvocationDeniedError` + `SkillExecutionNotConfiguredError` + `SkillExecutorUnavailableError` (EC-3); existing classes unchanged |
| `packages/core/src/domain/memory-event.ts` | 109 | `memory-event.ts:16` (MEMORY_EVENTS union) | typed OTel event union | additive: append `tool_invocation_denied` + `skill_executed` literals; existing unchanged |
| `packages/core/src/infrastructure/db/sandboxed-skill-executor.ts` (NEW) | 0 | — | (to be created) `SandboxedSkillExecutor` — isolated-vm impl + 6 guards | — |
| `packages/core/src/infrastructure/db/scoped-skill-memory.ts` | 266 | `scoped-skill-memory.ts:86` (LocalScopedSkillMemory) | scope-bound skill façade delegating to primitives | additive: add `execute()`; existing methods unchanged; STORE-only default preserved when no executor injected |
| `packages/core/src/infrastructure/db/factory.ts` | 267 | entity/graph wiring :185-189 | `createLocalMemory`; wires ports gated | wire `skillExecutor` opt-in (default undefined → execute throws `SkillExecutionNotConfiguredError`); existing wiring unchanged |
| `packages/core/src/index.ts` | 172 | `a80a4e6` (2026-06-20) | core public barrel | additive: export `SkillExecutor` type + `SandboxedSkillExecutor` + new errors |
| `packages/core/src/domain/index.ts` | 177+ | `a80a4e6` (2026-06-20) | domain barrel | additive: re-export port + types |
| `packages/core/package.json` | 90+ | optionalDependencies :81 | core manifest | additive: add `isolated-vm` to `optionalDependencies` (mirror `@xenova/transformers` :82) |
| `packages/api/src/server/handlers/skills.ts` | 60+ | postSkillHandler (`skills.ts:27`) | REST skill handlers (list/post/delete) | additive: add `executeSkillHandler`; existing handlers unchanged |
| `packages/api/src/server/app.ts` | 355+ | skill routes :352-355 | `createServer`; route table | additive: register `POST .../skills/:skillId/execute`; existing routes unchanged |
| `packages/api/src/server/openapi-registration.ts` | 412 | skill reg | OpenAPI 3.1 registry | additive: register the execute path |
| `packages/mcp/src/tools/execute-skill-handler.ts` (NEW) | 0 | — | (to be created) MCP `execute_skill` handler | — |
| `packages/mcp/src/tools/execute-skill-schema.ts` (NEW) | 0 | — | (to be created) zod input schema | — |
| `packages/mcp/src/tools/constants.ts` | — | tool-name constants | MCP tool names | additive: `EXECUTE_SKILL_NAME` |
| `packages/mcp/src/tools/list-handler.ts` | 90+ | tools/list :63-92 | MCP tools/list registration | additive: register `execute_skill` (opt-in/gated); existing 6 unchanged |
| `packages/mcp/src/tools/dispatch.ts` | — | tool dispatch | MCP call dispatch | additive: dispatch `execute_skill` |
| `tests/integration/skill-execution-sandbox.test.ts` (NEW) | 0 | — | (to be created) GOAL test (real isolated-vm) | — |

### Current callers / dependents

- **Symbol:** `ScopedSkillMemory` interface (`packages/core/src/domain/skill.ts:185`)
  - **Callers (production):** `packages/core/src/infrastructure/db/scoped-skill-memory.ts:86` (`LocalScopedSkillMemory implements`), `packages/api/src/server/handlers/skills.ts` (consumes `memory.skills(repoId)`), `packages/mcp/src/tools/add-skill-handler.ts` + `forget-skill-handler.ts`.
  - **Callers (tests):** skill contract/integration tests under `tests/` + `src/__tests__`.
  - **External (public API consumed by other repos):** YES — `@usetheo/memory` barrel; theo-cloud gateway consumes the REST surface, not the TS interface directly. Adding a method is additive (non-breaking) since impls are first-party.
- **Symbol:** `MEMORY_EVENTS` (`packages/core/src/domain/memory-event.ts:16`) — consumed by `emitEvent`; appending literals is additive.
- **Symbol:** `createLocalMemory` (`factory.ts`) — the wiring locus; adding an optional `skillExecutor` option is additive (default off).

### Domain glossary

- **Skill** — a persisted `MemoryItem` row carrying executable `code` + `codeLanguage` + `description` (`skill.ts:34`); Repo-tier (`Memory.skills(repoId)`).
- **SkillExecutor** — (NEW) the DIP port that takes a `Skill` + args and returns a captured result, run inside a sandbox.
- **isolated-vm** — native Node addon exposing real V8 isolates (separate heap, no `require`/`process`/`fs`); D3-locked sandbox tech.
- **Guard** — one of the 6 security checks re-expressed for isolated-vm (no Node bindings / structured args / capability whitelist / no fs / timeout+dispose / output-cap+memoryLimit) + a per-execute tool-call cap.
- **ToolInvocationDeniedError** — (NEW) typed error thrown when a guard denies an execution; carries a `reason` discriminant + emits `tool_invocation_denied`.
- **distroless-no-shell (EC-47)** — the runtime image (`./Dockerfile`) has no shell; the sandbox MUST be a shell-free in-process boundary.

### Architecture boundaries affected

Per `rules/architecture.md § 3` (DIP direction `src/core/ ← contracts/pure logic, no I/O`): the `SkillExecutor` PORT lives in `domain/dip/` (pure contract, no I/O); the `SandboxedSkillExecutor` IMPL lives in `infrastructure/db/` (loads the native addon). High-level `ScopedSkillMemory` depends on the port abstraction, never the impl — same DIP shape as `UsageCounterStore` / `EvictionPolicy` / `Embedder`. The native addon is an optional dependency loaded lazily in the infrastructure layer ONLY (mirrors `@xenova/transformers`), so the domain layer + default barrel stay addon-free (bundle isolation).

## Prior Art & Related Work

- **Internal blueprint:** `knowledge-base/discoveries/blueprints/agentic-skill-execution-sandbox-blueprint.md` § ADR D3 (isolated-vm decision) + § "Coverage Corner 4 — Techniques" (the 6-guard TARGET table EC-5; Letta dispatch/codegen/timeout).
- **Reference project (Letta):** `knowledge-base/references/letta/letta/services/tool_sandbox/base.py:24/108` (async DIP shape), `tool_sandbox/local_sandbox.py:183-205` (timeout terminate→kill — re-expressed as `runSync(timeout)`+`dispose`), `tool_sandbox/typescript_generator.py:92-110` (args-as-structured-values; no host-state injection), `tests/integration_test_typescript_tool_execution_sandbox.py:60-302` (GOAL-test shape).
- **External literature:** `isolated-vm` README (`Isolate({memoryLimit})`, `compileScriptSync`→`runSync({timeout})`, `dispose()`, clean V8 context) — https://github.com/laverdet/isolated-vm ; vm2 CVE-2026-22709 (CVSS 9.8) https://www.endorlabs.com/learn/cve-2026-22709-critical-sandbox-escape-in-vm2-enables-arbitrary-code-execution (rejection rationale, ADR D2).
- **Existing in-repo pattern:** `packages/core/src/domain/dip/usage-counter-store.ts` (recent ISP-clean DIP port shape), `packages/core/src/domain/errors.ts:344` (`InvalidSkillError` — reason-discriminant + `Object.setPrototypeOf` template for the new error).

## Objective

- [ ] `SkillExecutor` DIP port declared in `domain/dip/` with `execute(skill, args, opts?)` + `SkillExecutionResult` + `SkillExecutionOptions` types.
- [ ] `ToolInvocationDeniedError` (reason discriminant) + `SkillExecutionNotConfiguredError` typed errors; `tool_invocation_denied` + `skill_executed` OTel events.
- [ ] `SandboxedSkillExecutor` (isolated-vm, lazy/optional) implements all 6 guards + per-execute tool-call cap; benign skill → captured output; each malicious case → `ToolInvocationDeniedError` + event.
- [ ] `isolated-vm` is an OPTIONAL dependency; the default barrel does NOT force-pull it (bundle-isolation gate green; distroless-no-shell EC-47 not regressed).
- [ ] `ScopedSkillMemory.execute()` wired through the injected executor; STORE-only default preserved (no executor → `SkillExecutionNotConfiguredError`).
- [ ] REST `POST /v1/scopes/skill/:repoId/skills/:skillId/execute` (gated) + MCP `execute_skill` tool (opt-in).
- [ ] GOAL integration test (6 cases) green against real isolated-vm.

## ADRs

### D1 — `SkillExecutor` is a DIP port in `domain/dip/`, default impl in `infrastructure/`
- **Decision:** declare `SkillExecutor` as a pure contract in `packages/core/src/domain/dip/skill-executor.ts`; ship `SandboxedSkillExecutor` in `infrastructure/db/`. `ScopedSkillMemory` depends on the port.
- **Rationale:** matches `rules/architecture.md § 3` DIP direction and the existing 13-DIP precedent (ADR-0008 method-count discipline); keeps the native addon out of the domain layer; leaves a seam for an opt-in out-of-process impl (e2b/modal) without touching callers (OCP).
- **Alternatives considered:** (a) concrete executor inlined in `scoped-skill-memory.ts` — REJECTED: couples the façade to isolated-vm, blocks the e2b seam, pulls a native addon into a high-traffic file; (b) executor as a method on `Memory` — REJECTED: execution is Repo-tier-specific (skills), not a global verb.
- **Consequences:** enables the defense-in-depth out-of-process seam later; constrains all impls to one ISP-clean port.

### D2 — Sandbox technology = `isolated-vm` in-process (V8 isolate), e2b/modal as opt-in seam
- **Decision:** default `SandboxedSkillExecutor` uses `isolated-vm`; out-of-process backends are a DIP seam NOT implemented this cycle.
- **Rationale:** owner-locked D3 (blueprint). Fits distroless-no-shell (native addon like the shipped `onnxruntime-node`); offline + zero per-exec cost; real isolation (no `require`/`process`/`fs`); native `memoryLimit` + `timeout`.
- **Alternatives considered:** `vm2` REJECTED (CVE-2026-22709 CVSS 9.8 + maintainer warns of inevitable bypasses); `node:vm` REJECTED (documented non-boundary — prototype-chain escape); `worker_threads` REJECTED (shares process, can `require('child_process')`); e2b/modal-as-default REJECTED (network + cost + contradicts offline posture — KEPT as opt-in seam); QuickJS-WASM noted as heavier alternative.
- **Consequences:** ships a native optional dep (`node-gyp`/prebuilt) → must be optional/lazy so the default barrel stays addon-free; isolated-vm is in maintenance mode → the 6 guards + the out-of-process seam are the defense-in-depth backstop against a V8 0-day (non-negotiable).

### D3 — Execution is opt-in + gated; STORE-only stays the default
- **Decision:** `createLocalMemory` accepts an optional `skillExecutor`; when absent, `ScopedSkillMemory.execute()` throws `SkillExecutionNotConfiguredError`. REST + MCP surfaces only register the execute path when an executor is wired.
- **Rationale:** owner scope guardrail (CLAUDE.md skills-write-surface amendment); RCE surface must be deliberately enabled, never on-by-default; mirrors the `entityBoost`/`recallCache` gated-wiring precedent (`factory.ts:185-189`).
- **Alternatives considered:** execution on-by-default — REJECTED: turns every deployment into an RCE surface, violates security-by-design + KISS for the common STORE-only consumer.
- **Consequences:** existing consumers are unaffected (additive); the gateway/MCP must explicitly opt in.

### D4 — Args passed as structured values, never string-concatenated into source
- **Decision:** skill args are injected via `context.global.set(...)` (structured copy), NEVER interpolated into the code string.
- **Rationale:** closes the injection vector at construction (the Letta TS codegen lesson, `typescript_generator.py:108-110`); guard #2 (shlex-split) becomes "no string concat" for an isolate.
- **Alternatives considered:** template-string injection — REJECTED: reintroduces the exact injection class the sandbox exists to prevent.
- **Consequences:** the executor serializes args via isolated-vm `ExternalCopy`/`Reference`; complex non-cloneable args are rejected with a typed error (documented edge case).

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| `isolated-vm` is a native addon (node-gyp/prebuilt) → CI/distroless must build/load it | High | optional dep + lazy load; CI installs it for the integration job; distroless already builds glibc native addons (onnxruntime-node precedent); `/deps-audit` mandatory | impl |
| `isolated-vm` is in maintenance mode + in-process V8 isolate is not bulletproof vs a V8 0-day | High | the 6 guards + per-call cap + the out-of-process DIP seam (defense-in-depth); a dedicated security review is a merge gate | owner+impl |
| RCE surface if execution is enabled carelessly | High | D3 opt-in/gated; default barrel addon-free; never on-by-default; security review | owner |
| Native addon could leak into the default barrel and break distroless/bundle | Medium | bundle-isolation gate (default barrel import does NOT pull isolated-vm); dynamic `await import('isolated-vm')` in infra only | impl |
| Output-cap / memoryLimit tuning too tight or too loose | Low | defaults documented + configurable via `SkillExecutionOptions`; tested at both bounds | impl |

## Unresolved Questions

- Q1 — RESOLVED (`/deps-audit` 2026-06-21): pin `isolated-vm ^7.0.0` (latest; npm registry confirms 7.0.0 is latest of 88 versions; OSV returned 0 vulns at 7.0.0 and 5.0.4).
- Q2 — should JS skills (`codeLanguage: 'javascript'`) run as-is and TS skills be transpiled, or do we require pre-transpiled JS at execute time? (Lean: execute JS directly; reject `typescript` at execute with a typed "transpile-first" error in v1 — TS-transpile is a follow-up. Confirm at edge-case-plan.)
- Q3 — host-callback bridge (allowing a skill to call back a whitelisted host fn) — DEFERRED to a follow-up; v1 executes pure compute only (no host bridge), which simplifies guards #3/#4 to "default-deny everything". Confirm at edge-case-plan.

## Dependencies

| Dependency | Version | New/Existing | Rule 9 evaluation | CVE status |
|---|---|---|---|---|
| `isolated-vm` | `^7.0.0` (latest; OSV-clean — confirmed `/deps-audit` 2026-06-21) | NEW (optionalDependency in `packages/core`) | Evaluated: `vm2` (rejected — CVE-2026-22709 CVSS 9.8 + inevitable-bypass warning), `node:vm` (rejected — not a security boundary per Node docs), `worker_threads` (rejected — shares process), QuickJS-WASM (rejected — heavier, less mature for TS/JS-only). `isolated-vm` selected: real V8 isolate, distroless-fit, offline, native limits. | `/deps-audit` 2026-06-21: OSV query returned **0 vulns** at 7.0.0 AND 5.0.4 — CVE-clean. Pinned to latest `^7.0.0`. |
| `@opentelemetry/api` | existing | Existing | reused for `tool_invocation_denied` / `skill_executed` events | n/a |

> Per `deps-audit-golden-rule.md`: this section is mandatory; `/deps-audit` runs before `/plan-confidence` and BLOCKS on a CRITICAL/HIGH CVE in `isolated-vm` at the pinned version (no allowlist without owner sign-off).

## Dependency Graph

```
Phase 1 (Slice 1 — sandbox-first) ──▶ Phase 2 (Slice 2 — wire + surface) ──▶ Phase 3 (Integration Validation)
  T1.1 port ─▶ T1.2 errors+events ─▶ T1.3 impl+guards ─▶ T1.4 unit+bundle gate
                                                              │
                                                              ▼
                                         T2.1 iface+façade ─▶ T2.2 factory gate ─▶ T2.3 REST ─▶ T2.4 MCP
```

Phase 1 is a hard blocker for Phase 2 (no wiring before the guarded executor exists — security-by-design). Within Phase 1, T1.1→T1.2→T1.3→T1.4 are sequential. Phase 3 runs last.

---

## Phase 1: Slice 1 — hardened executor (sandbox-first, NO executor wired)

**Objective:** ship the `SkillExecutor` port + `SandboxedSkillExecutor` impl + 6 guards + typed error + OTel event, fully unit-tested, WITHOUT wiring it into any consumer.

### T1.1 — `SkillExecutor` DIP port + result/option types

#### Objective
Declare the pure contract the rest of the cycle builds against.

#### Why this step (action + reasoning)
1. **What:** create `packages/core/src/domain/dip/skill-executor.ts` with `interface SkillExecutor { execute(skill, args, opts?): Promise<SkillExecutionResult> }` + `SkillExecutionResult` + `SkillExecutionOptions`.
2. **Why now:** per D1 the port is the seam every later task depends on; declaring it first lets T1.3 + T2.1 code against a stable contract (DIP). Mirrors `usage-counter-store.ts` ISP discipline.

#### Evidence
`packages/core/src/domain/dip/usage-counter-store.ts` (recent ISP-clean port template); `packages/core/src/domain/skill.ts:34` (`Skill` shape the port consumes).

#### Files to edit
```
packages/core/src/domain/dip/skill-executor.ts — NEW: port + types
packages/core/src/domain/dip/skill-executor.test-d.ts — NEW: type-level contract test (RED first)
packages/core/src/domain/index.ts — re-export the port + types
packages/core/src/index.ts — export from core barrel
```

#### Deep file dependency analysis
- `skill-executor.ts` (NEW) imports only `Skill` (type) from `../skill.js` + `Filters` if scope is needed — no I/O. Downstream: T1.3 impl, T2.1 façade.
- barrels (`domain/index.ts`, `index.ts`) — additive re-export; consumed by api/mcp packages.

#### Deep Dives
- `SkillExecutionResult = { output: unknown; truncated: boolean; elapsedMs: number }`.
- `SkillExecutionOptions = { timeoutMs?: number; memoryLimitMb?: number; maxOutputBytes?: number; maxToolCalls?: number }` (all optional → impl defaults).
- Invariant: the port is I/O-free + addon-free (DIP, `rules/architecture.md § 3`).

#### Pseudo-code / Signatures
```pseudocode
interface SkillExecutor {
  execute(skill: Skill, args: Readonly<Record<string, unknown>>, opts?: SkillExecutionOptions): Promise<SkillExecutionResult>
}
```

#### Tasks
1. Write `skill-executor.test-d.ts` asserting the port shape (RED — type error: module absent).
2. Create `skill-executor.ts` with the interface + types (GREEN).
3. Re-export from both barrels.

#### TDD
```
RED:     test_skill_executor_port_shape() -> expectTypeOf<SkillExecutor['execute']> equals (skill,args,opts?)=>Promise<SkillExecutionResult> (fails: module missing)
GREEN:   create the port file
REFACTOR: None expected
VERIFY:  npm run typecheck
```

#### Concurrency tests
(none — single-threaded)
Pure type/contract declaration; no shared state.

#### Acceptance Criteria
- [ ] `npm run typecheck` green; port + types exported from `@usetheo/memory`.
- [ ] the port file is ≤ 500 lines (`wc -l` verifies)
- [ ] `npm run lint` exits 0 with zero warnings on the changed files

#### DoD
- [ ] `npm run typecheck` green; `npm run lint` clean; barrels updated.

### T1.2 — Typed errors + OTel events

#### Objective
`ToolInvocationDeniedError` (reason discriminant) + `SkillExecutionNotConfiguredError` + `SkillExecutorUnavailableError` (EC-3); `tool_invocation_denied` + `skill_executed` events.

#### Why this step (action + reasoning)
1. **What:** append three error classes to `errors.ts` + two literals to `MEMORY_EVENTS`.
2. **Why now:** T1.3's guards throw the errors + emit the event; they must exist first (Princípio 3 auditability — every denial is observable). EC-3: the missing-optional-addon path needs a DISTINCT typed error (not a raw `ERR_MODULE_NOT_FOUND`, not a denial).

#### Evidence
`packages/core/src/domain/errors.ts:344` (`InvalidSkillError` reason-discriminant + `Object.setPrototypeOf` template); `packages/core/src/domain/memory-event.ts:16` (`MEMORY_EVENTS` union + `emitEvent`).

#### Files to edit
```
packages/core/src/domain/errors.ts — append ToolInvocationDeniedError + SkillExecutionNotConfiguredError
packages/core/src/domain/errors.test.ts — RED tests for both (name, reason, instanceof)
packages/core/src/domain/memory-event.ts — append 'tool_invocation_denied' + 'skill_executed'
packages/core/src/index.ts / domain/index.ts — export new errors
```

#### Deep file dependency analysis
- `errors.ts` — additive classes; `Object.setPrototypeOf` per existing pattern; downstream: T1.3, T2.x handlers map `ToolInvocationDeniedError`→403, `SkillExecutionNotConfiguredError`→501/404.
- `memory-event.ts` — additive literals; consumed by `emitEvent(tracer,...)`.

#### Deep Dives
- `ToolInvocationDeniedError.reason: 'node-binding-attempt' | 'fs-access-attempt' | 'timeout' | 'output-cap' | 'tool-call-cap' | 'non-cloneable-args' | 'non-cloneable-result' | 'unsupported-language' | 'unsupported-async' | 'empty-code'` (EC-2 `empty-code`, EC-4 `unsupported-async`, EC-6 `non-cloneable-result`).
- `SkillExecutorUnavailableError` (EC-3) — thrown when the optional `isolated-vm` addon is not installed; carries an install hint; maps to REST 503 (distinct from 501 not-configured + 403 denied).
- Invariant: error names are stable strings (contract test); reason union is exhaustive over the 6 guards + D4 + Q2 + EC-2/4/6.

#### Tasks
1. RED: `errors.test.ts` asserts `new ToolInvocationDeniedError('timeout','...').name === 'ToolInvocationDeniedError'` + `instanceof Error`; `SkillExecutorUnavailableError` name/instanceof.
2. GREEN: add the three classes following the `InvalidSkillError` template.
3. Append event literals; export all three errors.

#### TDD
```
RED:     test_tool_invocation_denied_error_name() -> expect(new ToolInvocationDeniedError('timeout','x').name).toBe('ToolInvocationDeniedError'); test_skill_execution_not_configured_error_name(); test_skill_executor_unavailable_error_name() (fails: classes missing)
GREEN:   add three classes + event literals
REFACTOR: None expected
VERIFY:  npm test -- errors
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] `npm run typecheck` exits 0 with all three error classes + the reason union + the two event literals exported from `@usetheo/memory`
- [ ] `npm run lint` exits 0 with zero warnings on changed files
- [ ] `npm test -- errors` reports coverage ≥ 90% on the changed file

#### DoD
- [ ] `npm test -- errors` green; `npm run typecheck` green.

### T1.3 — `SandboxedSkillExecutor` (isolated-vm) + 6 guards + per-call cap + OTel

#### Objective
The default executor: run skill code in a V8 isolate with all guards enforced.

#### Why this step (action + reasoning)
1. **What:** create `sandboxed-skill-executor.ts` implementing `SkillExecutor` via lazy `await import('isolated-vm')`; enforce the 6 guards + per-call cap; emit `tool_invocation_denied` on denial + `skill_executed` on success.
2. **Why now:** this is the security core; per D2/D3 it must exist + be fully tested BEFORE any wiring (Slice-1 sandbox-first). Add `isolated-vm` to `optionalDependencies`.

#### Evidence
Blueprint § "Technique 4 — 6 guards re-expressed" + § ADR D3; `isolated-vm` README (`Isolate({memoryLimit})`, `compileScriptSync`, `runSync({timeout})`, `dispose()`); `letta/.../local_sandbox.py:183-205` (timeout escalation → re-expressed as runSync timeout + dispose); `packages/core/package.json:81` (optionalDependencies pattern).

#### Files to edit
```
packages/core/src/infrastructure/db/sandboxed-skill-executor.ts — NEW: impl + guards
packages/core/src/infrastructure/db/__tests__/sandboxed-skill-executor.test.ts — NEW: RED guard tests
packages/core/package.json — add isolated-vm to optionalDependencies
packages/core/src/index.ts — export SandboxedSkillExecutor
```

#### Deep file dependency analysis
- `sandboxed-skill-executor.ts` (NEW) implements `SkillExecutor` (T1.1); throws `ToolInvocationDeniedError` (T1.2); emits events (T1.2); lazy-loads `isolated-vm` (optional). No other module imports it except the barrel + (later) the factory.
- `package.json` optionalDependencies — keeps the addon out of the default install path (bundle isolation).

#### Deep Dives

> **LOCKED design decisions (SEPA pre-RED 2026-06-21, iteration 3):**
> - **DEC-1 sync isolated-vm API** — use `createContextSync` / `compileScriptSync` / `runSync` / `setSync` / `dispose` (empirically smoke-verified; v1 is pure-compute, no host bridge → no async benefit). `execute()` stays `async` (Promise per port) but the isolated-vm calls are sync. Supersedes the async calls in the pseudo-code below.
> - **DEC-2 node/fs denial = source PRE-SCAN (defense-in-depth)** — the isolate is the PRIMARY guarantee (no `process`/`require`/`fs` exist → referencing `process` yields `undefined`, no throw). To make `node-binding-attempt` / `fs-access-attempt` REACHABLE, auditable, and deterministic (Princípio 3 — audit the ATTEMPT), pre-scan `skill.code` for forbidden tokens (`\brequire\b`, `\bprocess\b`, `child_process`, `\bfs\b`, dynamic `import(`) BEFORE creating the isolate → deny (no dispose). Documented as the AUDIT/DEFENSE layer on top of the already-secure isolate, NOT the security mechanism itself.
> - **DEC-3 output-cap = deny-only v1** — over `maxOutputBytes` (measured `Buffer.byteLength(JSON.stringify(value),'utf8')`) → `ToolInvocationDeniedError('output-cap')`. `SkillExecutionResult.truncated` is reserved and returns `false` in v1 (no soft-truncate branch — YAGNI).
> - **DEC-4 arg-key identifier guard (D4 injection surface)** — `Object.keys(args)` land in the appended invocation `;fn(k1,k2)`; reject any key not matching `/^[A-Za-z_$][\w$]*$/` → `ToolInvocationDeniedError('non-cloneable-args', 'invalid arg key')` (closes a source-injection vector even though VALUES are structured).
> - **DEC-5 no named function → deny** — if the (post-export-strip) code has no `function NAME`, deny `'unsupported-language'` (least-bad reused literal; detail explains "skill must declare a named function").
> - **Pre-isolate denials (NO dispose):** empty-code, unsupported-language (incl. no-named-fn), unsupported-async, node-binding-attempt, fs-access-attempt, invalid-arg-key, EC-5 timeout<=0 reject. **Post-isolate denials (dispose REQUIRED):** non-cloneable-args (ExternalCopy throw at injection), timeout, non-cloneable-result, output-cap. Tests assert the dispose asymmetry.
> - **DEC-6 constructor seam** — `constructor(deps?: { tracer?: Tracer; loadIsolatedVm?: () => Promise<typeof import('isolated-vm')> })`; default `() => import('isolated-vm')`. `typeof import(...)` is a TYPE query (erased — barrel stays addon-free, T1.4). Tests inject `loadIsolatedVm` (EC-3 throw `ERR_MODULE_NOT_FOUND`) + `vi.spyOn(ivm.Isolate.prototype,'dispose')` + a fake recording tracer.
> - **DEC-7 `#deny(isolate, reason, detail)` private helper** — emits `tool_invocation_denied` + disposes if isolate present + throws; DRYs the denial triad so no path forgets dispose/event. **`tool-call-cap`** is the Q3 host-bridge seam (structurally unreachable in v1, no host callback); covered by a DIRECT unit test of the private cap helper to avoid dead branch.

- **EC-1 — code invocation wrapper (CRITICAL):** isolated-vm `compileScript` runs a CLASSIC script, so top-level `export` is a SyntaxError and a bare `function` declaration evaluates to `undefined`. The wrapper MUST: (a) strip the leading `export ` from `export (async )?function NAME` (mirror Letta `typescript_generator.py` handling), (b) append an invocation expression `;NAME(...injectedArgNames)` as the LAST statement so the script's completion value IS the function's return, (c) extract that value across the membrane via `script.run(ctx, { timeout, copy: true })` (or `result: { reference: true }` then `.copy()`). Without this the benign case returns `undefined`.
- **EC-3 — missing addon:** wrap `await import('isolated-vm')` in try/catch; on `ERR_MODULE_NOT_FOUND` throw `SkillExecutorUnavailableError` (install hint), NEVER let the raw module error escape.
- **EC-2 — null code:** if `skill.code === null` (derived skills, `skill.ts:34`) → `ToolInvocationDeniedError('empty-code')` BEFORE touching the isolate.
- **EC-4 — async (LOCKED v1, SEPA initial brief 2026-06-21):** detect `async function` (regex `/async\s+function/`) → DENY with `ToolInvocationDeniedError('unsupported-async')`. Awaiting via `script.run(ctx,{ promise: true, copy: true })` is DEFERRED to a follow-up (matches the no-host-bridge / pure-compute v1 posture; avoids membrane Promise edge cases on a security path). The RED test asserts the denial, not an awaited value.
- **EC-5 — opts bounds:** clamp `memoryLimitMb` to ≥ 8 (isolated-vm minimum) and reject `timeoutMs <= 0` before constructing the isolate.
- **EC-6 — non-cloneable result:** a function/symbol/circular return cannot `copy:true`-cross the membrane → `ToolInvocationDeniedError('non-cloneable-result')`.
- Guard mapping (EC-5 of the blueprint):
  1. **no Node bindings** — fresh `isolate.createContext()`; never expose `process`/`require`/`child_process` (isolate has none by default — assert by attempting `typeof process` → `undefined` inside).
  2. **structured args (D4)** — inject via `context.global.set(name, new ivm.ExternalCopy(value).copyInto())`; non-cloneable → `ToolInvocationDeniedError('non-cloneable-args')`.
  3. **capability whitelist** — default-deny; v1 exposes ZERO host capabilities (Q3 — no host bridge).
  4. **no fs** — isolate has no `fs`; assert `require`/`import('fs')` is unavailable.
  5. **timeout** — `script.run(context,{ timeout: opts.timeoutMs ?? 1000 })`; on `RangeError`/timeout → `isolate.dispose()` + `ToolInvocationDeniedError('timeout')`.
  6. **output-cap + memoryLimit** — `new ivm.Isolate({ memoryLimit: opts.memoryLimitMb ?? 16 })`; serialize result, if bytes > `opts.maxOutputBytes ?? 65536` → `truncated:true` OR `ToolInvocationDeniedError('output-cap')` (cap the flood).
  7. **per-execute tool-call cap** — count host-callback invocations (0 allowed in v1 since no bridge; the cap is the seam for Q3); exceeding → `ToolInvocationDeniedError('tool-call-cap')`.
- `finally`: `isolate.dispose()` ALWAYS (no leak).
- Q2: `codeLanguage === 'typescript'` → `ToolInvocationDeniedError('unsupported-language')` in v1 (JS executes directly; TS-transpile is a follow-up).

#### Pseudo-code / Signatures
```pseudocode
class SandboxedSkillExecutor implements SkillExecutor:
  async execute(skill, args, opts):
    if skill.code == null: throw ToolInvocationDeniedError('empty-code')                  # EC-2
    if skill.codeLanguage == 'typescript': throw ToolInvocationDeniedError('unsupported-language')  # Q2
    memMb = max(8, opts.memoryLimitMb ?? 16); if (opts.timeoutMs ?? 1000) <= 0: reject   # EC-5
    try: ivm = await import('isolated-vm')                                                # lazy, optional
    catch ERR_MODULE_NOT_FOUND: throw SkillExecutorUnavailableError(install-hint)         # EC-3
    isolate = new ivm.Isolate({ memoryLimit: memMb })
    try:
      ctx = await isolate.createContext()
      for (k,v) of args: ctx.global.setSync(k, copyOrDeny(v))   # guard #2/#4 (ExternalCopy)
      if /async\s+function/.test(skill.code): throw ToolInvocationDeniedError('unsupported-async')  # EC-4 LOCKED v1: deny
      script = await isolate.compileScript(wrapInvocation(skill.code, argNames))  # EC-1: strip export + append NAME(args)
      raw = await script.run(ctx, { timeout: opts.timeoutMs ?? 1000, copy: true })  # guard #5 + EC-1/EC-6
      out = capOutput(raw, opts.maxOutputBytes ?? 65536)        # guard #6
      emitEvent(tracer,'skill_executed',{skillId:skill.id})
      return { output: out.value, truncated: out.truncated, elapsedMs }
    catch timeout/range: emit('tool_invocation_denied',{reason:'timeout'}); throw ToolInvocationDeniedError('timeout')
    catch non-copyable: throw ToolInvocationDeniedError('non-cloneable-result')           # EC-6
    finally: isolate.dispose()

  # wrapInvocation(code, argNames): code.replace(/^export\s+/m,'') + `;${fnName}(${argNames.join(',')})`  # EC-1

# Example
input:  skill.code="export function add(x,y){return x+y}", args={x:2,y:3}
output: { output: 5, truncated: false, elapsedMs: <n> }
```

#### Tasks
1. RED: guard tests (one per reason) + benign-exec test (all fail — impl missing).
2. GREEN: implement impl + guards + lazy import + events.
3. Add `isolated-vm` to optionalDependencies; export from barrel.
4. REFACTOR: extract `copyOrDeny` + `capOutput` helpers (SRP); keep file ≤ 500 LoC.

#### TDD
```
RED:     test_benign_add_returns_5() -> expect(out).toBe(5) (EC-1 export-strip+invocation)
RED:     test_null_code_denied_empty_code() (EC-2); test_missing_addon_throws_unavailable() stub import throw (EC-3)
RED:     test_async_skill_denied_unsupported_async() (EC-4 LOCKED v1: deny); test_memory_limit_clamped_and_timeout_rejected() (EC-5); test_noncloneable_result_denied() (EC-6)
RED:     test_child_process_reach_denied_node_binding(); test_fs_require_denied_fs_access(); test_infinite_loop_denied_timeout_and_disposed(); test_output_flood_denied_output_cap(); test_noncloneable_arg_denied(); test_typescript_skill_denied_unsupported_language()
GREEN:   implement SandboxedSkillExecutor (wrapInvocation + lazy import + guards)
REFACTOR: extract wrapInvocation/copyOrDeny/capOutput helpers (SRP)
VERIFY:  npm test -- sandboxed-skill-executor
```

#### Concurrency tests
- **Timeout / cancellation propagation:** infinite-loop skill under `timeout: 50ms` → `run` aborts, `isolate.dispose()` reclaims the heap, `ToolInvocationDeniedError('timeout')` thrown; assert the isolate is disposed (no dangling). This is the cancellation propagation case (isolated-vm is the concurrency boundary; each execute owns its own isolate so there is no cross-call shared state to race).

#### Acceptance Criteria
- [ ] `npm test -- sandboxed-skill-executor` exits 0 with all reason cases + the benign case passing against real isolated-vm
- [ ] each test asserts `isolate.dispose()` ran (a spy verifies no leak on every path)
- [ ] `npm test` reports 100% coverage on `sandboxed-skill-executor.ts` (critical path)
- [ ] `npm run lint` exits 0 with zero warnings and every function has cyclomatic complexity ≤ 10
- [ ] the file is ≤ 500 lines (`wc -l` verifies)

#### DoD
- [ ] `npm test -- sandboxed-skill-executor` green; `isolated-vm` in optionalDependencies; barrel export added.

### T1.4 — Bundle-isolation gate (default barrel addon-free; EC-47 preserved)

#### Objective
Prove the default `@usetheo/memory` import does NOT pull `isolated-vm`.

#### Why this step (action + reasoning)
1. **What:** add a bundle-isolation test asserting importing the default barrel does not require `isolated-vm` (only the explicit `SandboxedSkillExecutor` construction does, via lazy import).
2. **Why now:** D2 consequence — the native addon must stay optional so distroless/no-shell + addon-free consumers are unaffected; mirrors the EC-26 bundle-isolation precedent.

#### Evidence
`packages/core/package.json:81` optionalDependencies; CLAUDE.md EC-26 bundle-isolation precedent (default barrel does NOT pull subpath impls); `./Dockerfile` EC-47 distroless-no-shell.

#### Files to edit
```
packages/core/src/__tests__/skill-executor-bundle-isolation.test.ts — NEW: assert default barrel import without isolated-vm installed/loaded
```

#### Deep file dependency analysis
- Test imports the default barrel + asserts `require.cache`/module graph does not include `isolated-vm` unless `SandboxedSkillExecutor.execute()` is called. Uses the existing bundle-isolation test idiom.

#### Deep Dives
- Assert lazy: constructing `new SandboxedSkillExecutor()` does NOT import the addon; only `execute()` triggers `await import('isolated-vm')`.

#### Tasks
1. RED: bundle-isolation test (fails if barrel statically imports isolated-vm).
2. GREEN: ensure the impl uses dynamic `await import` (adjust if static).

#### TDD
```
RED:     test_default_barrel_excludes_isolated_vm() -> expect(moduleGraph).not.toContain('isolated-vm')
GREEN:   confirm/convert to lazy dynamic import in the executor
REFACTOR: None expected
VERIFY:  npm test -- bundle-isolation
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] `npm test -- bundle-isolation` exits 0 asserting the default barrel import graph excludes `isolated-vm` (only `execute()` triggers the dynamic import)
- [ ] `npm run lint` exits 0 with zero warnings and the test file is ≤ 500 lines (`wc -l`)

#### DoD
- [ ] `npm test -- bundle-isolation` green.

---

## Phase 2: Slice 2 — wire + surface (opt-in / gated)

**Objective:** wire the executor through `ScopedSkillMemory.execute()` + expose gated REST + opt-in MCP, STORE-only staying the default.

### T2.1 — `ScopedSkillMemory.execute()` interface + façade delegation

#### Objective
Add `execute()` to the contract + `LocalScopedSkillMemory`.

#### Why this step (action + reasoning)
1. **What:** append `execute(skillId, args, opts?)` to `ScopedSkillMemory` (`skill.ts:185`) + implement in `LocalScopedSkillMemory` (`scoped-skill-memory.ts:86`): read the skill row (workspace-isolated, 404 if absent/foreign), then delegate to the injected `SkillExecutor`; if none injected → `SkillExecutionNotConfiguredError`.
2. **Why now:** the executor (Phase 1) exists; the façade is the consumer-facing seam REST/MCP call. Reuses the existing read+workspace-guard path (parity with `forget`'s EC-2 row-read guard).

#### Evidence
`scoped-skill-memory.ts:233` (`forget` reads the row + workspace-guards — same pattern for execute's pre-read); `skill.ts:185` (interface).

#### Files to edit
```
packages/core/src/domain/skill.ts — add execute() to ScopedSkillMemory
packages/core/src/infrastructure/db/scoped-skill-memory.ts — implement execute() + inject SkillExecutor
packages/core/src/infrastructure/db/__tests__/scoped-skill-memory.test.ts — RED: execute delegates / not-configured throws / 404 on foreign id
```

#### Deep file dependency analysis
- `skill.ts` interface — additive method; impl `LocalScopedSkillMemory` must implement it (compile-enforced).
- `scoped-skill-memory.ts` — add optional `skillExecutor` to deps; `execute()` reads via existing primitive + delegates. Downstream: REST/MCP handlers.

#### Deep Dives
- `execute(skillId, args, opts?)`: read skill (workspace+scope filter) → not found/foreign → `MemoryNotFound` (404, no existence leak); no executor → `SkillExecutionNotConfiguredError`; `skill.code === null` (derived skill) → `ToolInvocationDeniedError('empty-code')` (EC-2, may also be enforced in the executor — defense in depth); else `executor.execute(skill, args, opts)`.
- Invariant: STORE-only default — when `skillExecutor` is undefined, the 5 existing verbs work unchanged; only `execute()` throws not-configured.

#### Tasks
1. RED: tests (delegates to a stub executor; throws not-configured when absent; 404 on foreign/missing id).
2. GREEN: implement.

#### TDD
```
RED:     test_execute_delegates_to_injected_executor() -> expect(stub.calledWith(skill,args)).toBe(true); test_execute_throws_not_configured_when_none(); test_execute_throws_memory_not_found_on_foreign_id()
GREEN:   implement execute() in LocalScopedSkillMemory + add to interface
REFACTOR: None expected
VERIFY:  npm test -- scoped-skill-memory
```

#### Concurrency tests
(none — single-threaded)
Façade only; the executor owns the concurrency boundary (tested in T1.3).

#### Acceptance Criteria
- [ ] `npm run typecheck` exits 0 with `execute()` on the interface + impl; `npm test -- scoped-skill-memory` asserts STORE-only default (no executor → `SkillExecutionNotConfiguredError`) + 404 on foreign/missing id (no existence leak)
- [ ] `npm run lint` exits 0 with zero warnings on changed files
- [ ] `npm test` reports coverage ≥ 90% on changed files (critical paths 100%)
- [ ] every changed file is ≤ 500 lines (`wc -l` verifies)

#### DoD
- [ ] `npm test -- scoped-skill-memory` green; typecheck green.

### T2.2 — Factory gated wiring

#### Objective
`createLocalMemory({ skillExecutor })` opt-in.

#### Why this step (action + reasoning)
1. **What:** thread an optional `skillExecutor` through `createLocalMemory` into `LocalScopedSkillMemory`; default undefined.
2. **Why now:** D3 — execution is opt-in; mirrors the gated `entityBoost`/`recallCache` wiring (`factory.ts:185-189`).

#### Evidence
`factory.ts:185-189` (gated port wiring precedent).

#### Files to edit
```
packages/core/src/infrastructure/db/factory.ts — accept + thread optional skillExecutor
packages/core/src/infrastructure/db/__tests__/factory.test.ts — RED: wired executor reaches skills().execute; default off
```

#### Deep file dependency analysis
- `factory.ts` — additive option; when provided, passed into `LocalScopedSkillMemory` deps. No existing wiring changes.

#### Deep Dives
- Default off: `createLocalMemory(pool)` → `skills(repoId).execute()` throws not-configured. `createLocalMemory(pool,{ skillExecutor: new SandboxedSkillExecutor() })` → execute works.

#### Tasks
1. RED: factory test (opt-in reaches execute; default throws not-configured).
2. GREEN: thread the option.

#### TDD
```
RED:     test_factory_optin_skill_executor_reaches_execute() -> expect(result).toBe(<benign output>); test_factory_default_off_execute_throws_not_configured()
GREEN:   thread the optional dep
REFACTOR: None expected
VERIFY:  npm test -- factory
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] `npm test -- factory` asserts `createLocalMemory(pool,{skillExecutor})` reaches `skills().execute` AND `createLocalMemory(pool)` leaves execute throwing `SkillExecutionNotConfiguredError` (default off preserved)
- [ ] `npm run lint` exits 0 with zero warnings on changed files
- [ ] `npm test` reports coverage ≥ 90% on changed files (critical paths 100%)
- [ ] every changed file is ≤ 500 lines (`wc -l` verifies)

#### DoD
- [ ] `npm test -- factory` green; typecheck green.

### T2.3 — REST `POST /v1/scopes/skill/:repoId/skills/:skillId/execute` (gated)

#### Objective
HTTP surface for execute, registered only when an executor is wired.

#### Why this step (action + reasoning)
1. **What:** add `executeSkillHandler` + register the route (gated on executor presence); map `ToolInvocationDeniedError`→403, `MemoryNotFound`→404, `SkillExecutionNotConfiguredError`→501; body = `{ args, opts? }`.
2. **Why now:** the façade (T2.1) + gate (T2.2) exist; this exposes them to the gateway/agents. Mirrors `postSkillHandler` (`skills.ts:27`).

#### Evidence
`packages/api/src/server/app.ts:352-355` (skill routes); `packages/api/src/server/handlers/skills.ts:27` (handler error-mapping pattern: `InvalidSkillError`/`MemoryNotFound`/`SkillAlreadyExists`).

#### Files to edit
```
packages/api/src/server/handlers/skills.ts — add executeSkillHandler
packages/api/src/server/app.ts — register POST .../skills/:skillId/execute (gated)
packages/api/src/server/openapi-registration.ts — register the path
packages/api/src/__tests__/... — RED: 200 benign, 403 denied, 404 foreign, 501 not-configured
```

#### Deep file dependency analysis
- `skills.ts` — new handler calls `memory.skills(repoId).execute(...)`; maps typed errors → HTTP. `app.ts` — additive route. `openapi-registration.ts` — additive path (4-field response shape documented).

#### Deep Dives
- Response: `{ output, truncated, elapsedMs }`. Errors: 403 `ToolInvocationDeniedError` (reason in body), 404 `MemoryNotFound` (no existence leak), 501 `SkillExecutionNotConfiguredError`, 503 `SkillExecutorUnavailableError` (addon not installed, EC-3), 400 invalid body (zod).
- Gate model (EC-7, KISS — locked): register the route ALWAYS; when no executor is wired, `execute()` throws `SkillExecutionNotConfiguredError` → 501 honestly (parity with the prior `501 SKILL_LISTING_NOT_IMPLEMENTED` precedent). No conditional route table. T2.4 MCP uses the same model.

#### Tasks
1. RED: handler tests (200/403/404/501/400).
2. GREEN: implement + register + openapi.

#### TDD
```
RED:     test_post_execute_200_benign() -> expect(res.status).toBe(200); test_post_execute_403_malicious(); test_post_execute_404_foreign_skill(); test_post_execute_501_not_configured(); test_post_execute_503_addon_unavailable() (EC-3); test_post_execute_400_invalid_body()
GREEN:   implement handler + route + openapi
REFACTOR: None expected
VERIFY:  npm test -- skills (api)
```

#### Concurrency tests
(none — single-threaded)
Stateless HTTP handler.

#### Failure scenarios note
The execute path is in-process (isolated-vm). The handler's only external I/O is the pg skill-read (covered: `MemoryNotFound`→404) — see `## Failure scenarios`.

#### Acceptance Criteria
- [ ] `npm test -- skills` asserts POST execute returns 200/403/404/501/503/400 per case; the OpenAPI registry includes the execute path; 404 (not 403) on foreign skill (no existence leak)
- [ ] `npm run lint` exits 0 with zero warnings on changed files
- [ ] `npm test` reports coverage ≥ 90% on changed files (critical paths 100%)
- [ ] every changed file is ≤ 500 lines (`wc -l` verifies)

#### DoD
- [ ] api tests green; typecheck green.

### T2.4 — MCP `execute_skill` tool (opt-in)

#### Objective
Expose execute as an MCP tool, registered only when execution is enabled.

#### Why this step (action + reasoning)
1. **What:** add `execute-skill-schema.ts` (zod input: `repoId`, `skillId`, `args`, `opts?`) + `execute-skill-handler.ts` + `EXECUTE_SKILL_NAME` + register in `list-handler.ts`/`dispatch.ts` (gated).
2. **Why now:** completes the agent-autonomy loop (agent authors via `add_skill`, executes via `execute_skill`). Mirrors `add-skill-handler.ts` + `forget-skill-handler.ts`.

#### Evidence
`packages/mcp/src/tools/list-handler.ts:85-92` (ADD_SKILL/FORGET_SKILL registration); `packages/mcp/src/tools/` (add-skill-handler.ts + add-skill-schema.ts + dispatch.ts + constants.ts).

#### Files to edit
```
packages/mcp/src/tools/execute-skill-schema.ts — NEW zod input
packages/mcp/src/tools/execute-skill-handler.ts — NEW handler
packages/mcp/src/tools/constants.ts — EXECUTE_SKILL_NAME
packages/mcp/src/tools/list-handler.ts — register (gated)
packages/mcp/src/tools/dispatch.ts — dispatch
packages/mcp/src/tools/handlers.test.ts — RED: execute_skill registered + dispatches + denied maps to error result
```

#### Deep file dependency analysis
- New handler calls the same `memory.skills(repoId).execute(...)`; maps `ToolInvocationDeniedError` to an MCP error result. Registration is gated on execution being enabled (parity with the openmemory toolset gating).

#### Deep Dives
- `execute_skill` input: `{ repoId, skillId, args, opts? }`; output: `{ output, truncated, elapsedMs }` or an MCP error with the denial reason.
- Gate model (EC-7, same as REST): `execute_skill` is ALWAYS registered; when no executor is wired it returns an MCP error result derived from `SkillExecutionNotConfiguredError` (no conditional tool list). `SkillExecutorUnavailableError` (addon missing) and `ToolInvocationDeniedError` (denial) map to distinct MCP error results.

#### Tasks
1. RED: tools/list includes `execute_skill` when enabled; dispatch runs benign; denied → error result.
2. GREEN: implement schema + handler + constant + registration + dispatch.

#### TDD
```
RED:     test_execute_skill_in_tools_list() -> expect(toolNames).toContain('execute_skill'); test_execute_skill_dispatch_benign_returns_output(); test_execute_skill_denial_maps_to_error_result()
GREEN:   implement
REFACTOR: None expected
VERIFY:  npm test -- handlers (mcp)
```

#### Concurrency tests
(none — single-threaded)
Stateless MCP dispatch.

#### Acceptance Criteria
- [ ] `npm test -- handlers` asserts `execute_skill` appears in `tools/list`, dispatches a benign skill to its output, and maps `ToolInvocationDeniedError` / `SkillExecutorUnavailableError` / `SkillExecutionNotConfiguredError` to distinct MCP error results
- [ ] `npm run lint` exits 0 with zero warnings on changed files
- [ ] `npm test` reports coverage ≥ 90% on changed files (critical paths 100%)
- [ ] every changed file is ≤ 500 lines (`wc -l` verifies)

#### DoD
- [ ] mcp tests green; typecheck green.

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | `SkillExecutor` DIP port + types | T1.1 | port in domain/dip |
| 2 | Typed `ToolInvocationDeniedError` + not-configured + OTel events | T1.2 | errors + MEMORY_EVENTS |
| 3 | isolated-vm executor + 6 guards + per-call cap | T1.3 | SandboxedSkillExecutor |
| 4 | optional/lazy dep; default barrel addon-free; EC-47 preserved | T1.3 + T1.4 | optionalDependencies + bundle-isolation gate |
| 5 | `ScopedSkillMemory.execute()` wired; STORE-only default | T2.1 + T2.2 | interface + façade + gated factory |
| 6 | REST `POST .../execute` gated | T2.3 | executeSkillHandler |
| 7 | MCP `execute_skill` opt-in | T2.4 | execute-skill tool |
| 8 | GOAL test (benign + 5 malicious) zero host escape | T3.1 | integration test vs real isolated-vm |
| 9 | deps-audit + security review gates | T3.1 | `/deps-audit` + `/review` run as T3.1 validation gates |
| 10 | EC-1 export-strip + invocation wrapper + copy:true | T1.3 | wrapInvocation; benign test returns value |
| 11 | EC-2 null-code (derived skills) typed denial | T1.2 (`empty-code`) + T1.3 + T2.1 | guard before isolate |
| 12 | EC-3 missing addon → distinct typed error | T1.2 (`SkillExecutorUnavailableError`) + T1.3 + T2.3 (503) | import wrap |
| 13 | EC-4 async / EC-5 opts-bounds / EC-6 non-cloneable-result | T1.3 reason union + tests | promise:true / clamp / typed denial |
| 14 | EC-7 gating model (register-always + 501) | T2.3 + T2.4 | locked KISS model |

**Coverage: 14/14 (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `npm test` + `npm run test:integration` green
- [ ] Zero type errors — `npm run typecheck`
- [ ] Zero lint warnings — `npm run lint`
- [ ] File-size budget respected (≤ 500 LoC per file; `rules/architecture.md`)
- [ ] CHANGELOG.md updated under `[Unreleased]` (Unbreakable Rule 6)
- [ ] Backward compatibility preserved (additive interface method; STORE-only default; existing 5 skill verbs unchanged)
- [ ] No paper names in `src/**` (`rules/no-paper-names-in-code.md`) — neutral wording; cite blueprint/ADR by filesystem coordinate
- [ ] `isolated-vm` in `optionalDependencies`; bundle-isolation gate green; distroless-no-shell (EC-47) not regressed
- [ ] **`/deps-audit` PASS** on `isolated-vm` (no CRITICAL/HIGH CVE at the pinned version) — mandatory gate before merge
- [ ] **Dedicated security review** (RCE surface) — mandatory gate at `/review` (the executor + the 6 guards + the gated surfaces)
- [ ] **Runtime-metric proof** — `tool_invocation_denied` + `skill_executed` observed non-zero in the integration workload
- [ ] Plan archived after `/review` READY_TO_MERGE + PR merged

## Failure scenarios

| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| `postgres:skills` (DB) | skill id absent / foreign scope | integration: execute a non-existent/cross-scope skillId | `MemoryNotFound` → 404 (no existence leak); no execution attempted |
| `isolated-vm` (native addon) | addon not installed in runtime | unit: stub the dynamic import to throw `ERR_MODULE_NOT_FOUND` | `execute()` throws `SkillExecutorUnavailableError` (EC-3, install hint) → REST 503; default barrel + STORE-only paths unaffected |
| skill code (untrusted) | infinite loop / output flood / fs-or-process reach / non-cloneable args | integration: one malicious skill per guard | `ToolInvocationDeniedError(reason)` + `tool_invocation_denied` event + isolate disposed + ZERO host escape |

## Final Phase: Integration Validation (MANDATORY)

**Objective:** prove execution works in a real workload against real `isolated-vm` (+ real pgvector for the skill-read path).

### T3.1 — GOAL integration test + validation gates

This phase is the single task `T3.1` (referenced by Coverage Matrix #8 + #9): author + run `tests/integration/skill-execution-sandbox.test.ts` against real isolated-vm, then run `/deps-audit` (PASS, done 2026-06-21) + the mandatory security review (`/review`) as validation gates.

#### TDD
```
RED:     test_goal_benign_skill_returns_output() -> expect(out.output).toBe(5) against real isolated-vm
RED:     test_goal_malicious_node_binding_denied(); test_goal_malicious_fs_access_denied(); test_goal_infinite_loop_denied_timeout(); test_goal_output_flood_denied(); test_goal_tool_call_cap_denied() -> each expects ToolInvocationDeniedError + tool_invocation_denied event + zero host escape
GREEN:   author the integration test against real isolated-vm + real pgvector (skill read)
REFACTOR: None expected
VERIFY:  npm run test:integration -- skill-execution-sandbox
```

#### Concurrency tests
- **Timeout / cancellation propagation (end-to-end):** the integration test runs an infinite-loop skill under a tight `timeout`; assert it aborts with `ToolInvocationDeniedError('timeout')` and the isolate is disposed (no leak). Each `execute()` owns its own isolate, so concurrent executions share no state — the cancellation propagation case is the only race-relevant path and is asserted here.

### Execution
```
npm run build
npm test                       # unit (contract)
npm run test:integration       # GOAL test: tests/integration/skill-execution-sandbox.test.ts
npm run typecheck
npm run lint
```

The GOAL test `tests/integration/skill-execution-sandbox.test.ts` (mirrors the Letta TS suite shape):
1. benign stored skill `export function add(x,y){return x+y}` → execute({x:2,y:3}) → output 5 + `skill_executed` event.
2. `child_process`/`process` reach → `ToolInvocationDeniedError('node-binding-attempt')` + event.
3. `require('fs')`/fs access → `ToolInvocationDeniedError('fs-access-attempt')` + event.
4. infinite loop under timeout → `ToolInvocationDeniedError('timeout')` + isolate disposed.
5. output flood → `ToolInvocationDeniedError('output-cap')` (or `truncated:true` per config).
6. tool-call-cap / non-cloneable args → denied.
All: ZERO host-shell escape; isolate disposed on every path.

### Acceptance Criteria
- [ ] All suites green (unit + integration)
- [ ] Coverage ≥ 90% on changed files (executor critical path: 100%)
- [ ] Zero type errors; zero lint warnings
- [ ] `tool_invocation_denied` + `skill_executed` observed non-zero in the integration run
- [ ] Failure scenarios green (all 3 rows exercised)
- [ ] `/deps-audit` PASS + security review PASS

### If Validation Fails
1. Separate plan-caused vs pre-existing failures.
2. Fix all plan-caused failures before completion.
3. Re-run the chain.
4. Log pre-existing issues in the PR (do not block).
