# Blueprint: Agentic skill execution + hardened TS/JS sandbox (M1 / gap G2 / Roadmap Item 21)

Version: 1.0
Slug: agentic-skill-execution-sandbox
Owner: project-owner
Date: 2026-06-21
Source plan: `.claude/knowledge-base/discoveries/plans/agentic-skill-execution-sandbox-plan.md` (v1.1, SHIPPABLE_WITH_CAVEATS 99.2)
Edge-case review: `.claude/knowledge-base/reviews/agentic-skill-execution-sandbox-edge-cases-2026-06-21.md` (EC-1..EC-5 absorbed)

## Context

TheMemory's `ScopedSkillMemory` STORES code-as-skill (`SkillLanguage = 'typescript' | 'javascript'`, `packages/core/src/domain/skill.ts:20`) but NEVER executes it — the Voyager loop is open: the agent can author a skill, but cannot run it. M1 closes G2: execute a stored TS/JS skill inside a HARDENED sandbox, with security-by-design shipping WITH execution (never after). The central decision is the sandbox technology for untrusted TS/JS.

Reference study: **Letta** is the only local clone that actually executes agent-authored tools; **mem0** does NOT execute (confirmed: zero `sandbox|exec_code|run_code|subprocess|child_process|isolated-vm` hits under `mem0/mem0-ts/src`). Letta is Python-shaped (subprocess venv + e2b/modal cloud), so it is a TARGET-mapping reference for the out-of-process design, NOT a 1:1 JS-sandbox exemplar (EC-4, EC-5). The in-process JS-isolate option has no local exemplar and is therefore decision-grade from allowlisted web research (EC-3 honored: npm 403'd once; the comparative answer came from web search + the isolated-vm GitHub README).

## Objective

Answer the 6 research questions and surface the **D3 sandbox-technology recommendation** (decision-grade, for owner sign-off) so `/to-plan` can build the `SkillExecutor` DIP + `SandboxedSkillExecutor` impl + 6 guards + typed error + OTel event with confidence.

---

## Coverage Corner 1 — Integration Tests

### Letta

Letta ships dedicated integration suites that execute real agent-authored tools against the real sandbox boundary — the exact shape our GOAL test must mirror:

- `.claude/knowledge-base/references/letta/tests/integration_test_tool_execution_sandbox.py` — Python tool execution (subprocess/e2b).
- `.claude/knowledge-base/references/letta/tests/integration_test_typescript_tool_execution_sandbox.py` — **the TS path** (e2b-backed). Fixtures create a tool with `source_code` (`export function add_numbers(x: number, y: number): number { return x + y; }`), `source_type="typescript"`, and a `json_schema` declaring typed params (`tests/integration_test_typescript_tool_execution_sandbox.py:60-100`).
- Assertions of note: `test_typescript_tool_requires_json_schema` (`:257`) — a TS tool without schema is rejected; `test_typescript_tool_with_schema_is_valid` (`:266`); `test_typescript_tool_does_not_inject_agent_state` (`:290`) — the TS path deliberately does NOT inject host state (capability-minimization by construction).
- DB-state isolation per test: fixtures `delete(SandboxConfig)` + `delete(SandboxEnvironmentVariable)` between runs (`:40-44`).
- Other suites present: `tests/integration_test_async_tool_sandbox.py`, `tests/integration_test_modal_sandbox_v2.py`, `tests/test_modal_sandbox_v2.py`, `tests/managers/test_sandbox_manager.py`.

**Borrowed test shape for our GOAL test (`tests/integration/skill-execution-sandbox.test.ts`):**
1. benign stored skill (`export function add(x,y){return x+y}`) → execute → captured typed output `=== expected`.
2. malicious stored skill, one case per guard → `ToolInvocationDeniedError` + OTel `tool_invocation_denied` event + ZERO host-shell escape:
   - shell-metachar / `child_process` reach attempt
   - path escape (`fs`/`require('fs')` attempt)
   - infinite loop → timeout (isolate disposed)
   - output flood → output-cap trip
3. per-execute tool-call cap exceeded → denied.

### mem0

DEFER-CORNER not needed — answered as negative evidence: mem0 has NO execution and NO execution tests (zero matches for execution primitives under `mem0/mem0-ts/src`). mem0 contributes the storage/recall shape we already ship, not execution-test prior art. This is why Letta is the sole test-shape reference.

---

## Coverage Corner 2 — Dependencies

### Letta (out-of-process / cloud backends — declared optional extras)

`.claude/knowledge-base/references/letta/pyproject.toml`:
- `cloud-tool-sandbox = ["e2b-code-interpreter>=1.0.3"]` (`:132`) — the e2b cloud interpreter (runs both Python and TS via `language="ts"`).
- `modal = ["modal>=1.1.0"]` (`:133`) — Modal serverless backend.
- `docker>=7.1.0` (`:135`, `:146`) — Docker SDK for the container path.

All three are **out-of-process** (cloud or container). None is an in-process JS isolate. They are declared as OPTIONAL extras, not core deps — the same lazy/optional posture we want for any heavy sandbox dep.

### Candidate deps for OUR TS/JS sandbox (web research — Q4 in-process option)

| Option | Type | Isolation guarantee | Fit verdict |
|---|---|---|---|
| **`isolated-vm`** | in-process **native C++ addon** (V8 isolate) | Separate V8 heap; **no `require`/`process`/`fs`** by default (clean context); `memoryLimit` (MB) + per-run `timeout` (ms) via `isolate.compileScriptSync()` → `script.runSync(context,{timeout})`; `isolate.dispose()` on overrun | **RECOMMENDED default** — real boundary, offline, distroless-compatible (see D3). CAVEAT: **maintenance mode** + native build (`node-gyp`/prebuilt). |
| `vm2` | in-process proxy sandbox | REJECTED — **CVE-2026-22709 CVSS 9.8** (Promise-handler escape, all ≤3.10.0); maintainer warns "new bypasses will likely be discovered" even post-resurrection (Oct 2025) | REJECTED |
| `node:vm` | in-process scoping | NOT a security boundary — `this.constructor.constructor('return process')()` escapes via shared prototype chain (Node docs: "not a security mechanism") | REJECTED |
| `worker_threads` + limits | in-process thread | Shares the process; can `require('child_process')`; resource limits are not a capability boundary | REJECTED as the boundary |
| `e2b` / `modal` (`@e2b/code-interpreter`) | out-of-process cloud | Strong (separate VM) but adds NETWORK dep + per-exec cost + latency; contradicts offline/local-OSS posture | KEEP as **opt-in DIP impl** (defense-in-depth for attacker-controlled-at-scale), NOT default |
| QuickJS-WASM | in-process WASM interpreter | V8 host bugs don't translate to escapes; slower; extra dep | Noted alternative; heavier than isolated-vm for the TS/JS-only scope |

Sources (web): node:vm security ([offensive360](https://offensive360.com/blog/nodejs-vm-module-security-risks/), [dev.to](https://dev.to/dendrite_soup/nodevm-is-not-a-sandbox-stop-using-it-like-one-2f74)); vm2 CVE-2026-22709 ([endorlabs](https://www.endorlabs.com/learn/cve-2026-22709-critical-sandbox-escape-in-vm2-enables-arbitrary-code-execution), [thehackernews](https://thehackernews.com/2026/01/critical-vm2-nodejs-flaw-allows-sandbox.html)); isolated-vm API + maintenance mode ([github laverdet/isolated-vm](https://github.com/laverdet/isolated-vm)).

---

## Coverage Corner 3 — Tools

### Our distroless runtime (the decisive constraint — Q5, EC-1)

`./Dockerfile` (repo root, NOT `packages/*/Dockerfile`):
- Stage 3 runtime = `gcr.io/distroless/nodejs22-debian12:nonroot` — **NO SHELL present (EC-47 hard requirement)**; entrypoint invokes the `node` binary directly per ADR D13 (`Dockerfile:14-22`).
- Debian 12 **glibc** base chosen so native addons (the shipped `@xenova/transformers` ONNX runtime / `onnxruntime-node`) compile + load (`Dockerfile` EC-38 note; `production-deps` stage `INCLUDE_OPTIONAL=true` keeps `onnxruntime-node`).

**Consequences for sandbox-tech choice:**
- Any approach that spawns a **shell** or needs an extra **OS binary** (firejail, bubblewrap, a `sh -c` wrapper) does **NOT** fit distroless-no-shell. Letta's `asyncio.create_subprocess_exec(python_executable, …)` subprocess model is viable only because Letta ships a full base image — it is NOT portable to our distroless runtime without re-adding a shell/runtime (regression of EC-47).
- A **native Node addon** (`isolated-vm`) DOES fit: it's the same class as the already-shipped glibc native addon `onnxruntime-node` — no shell, no extra binary, loads in-process.
- **e2b/modal** fit trivially (pure network calls, no local binary) but add a network dependency + cost.

### Letta tooling (out-of-process orchestration)

Letta dispatches in `ToolExecutionSandbox.run()` (`.claude/knowledge-base/references/letta/letta/services/tool_executor/tool_execution_sandbox.py:80`): `if tool_settings.e2b_api_key and not self.privileged_tools` → e2b (`:95-97`), else local subprocess (`:99-100`). `SandboxType` enum = `E2B` / `MODAL` / `LOCAL` (`letta/schemas/enums.py:262-265`). This 3-backend Strategy-behind-a-DIP is the orchestration shape we borrow (our DIP: `SkillExecutor` with a default in-process impl + optional out-of-process impls).

---

## Coverage Corner 4 — Techniques

### Technique 1 — Backend dispatch behind an async DIP (Letta `AsyncToolSandboxBase`)

Letta's `AsyncToolSandboxBase` (`.claude/knowledge-base/references/letta/letta/services/tool_sandbox/base.py:24`) is an ABC with `@abstractmethod async def run(...)` (`:108`) + `generate_execution_script(...)` (`:126`). Concrete impls: `AsyncToolSandboxLocal` (`tool_sandbox/local_sandbox.py:31`) and `AsyncToolSandboxE2B` (`tool_sandbox/e2b_sandbox.py:27`). **Borrow:** a `SkillExecutor` port + `SandboxedSkillExecutor` (default, isolated-vm) + room for `E2bSkillExecutor` (opt-in) — Strategy pattern, same as Letta's `SandboxType` dispatch.

### Technique 2 — Timeout with terminate→kill escalation (Letta local subprocess)

Letta `_execute_tool_subprocess` (`tool_sandbox/local_sandbox.py:183-205`): `asyncio.wait_for(process.communicate(), timeout=tool_settings.tool_sandbox_timeout)`; on `TimeoutError` → `process.terminate()` → `wait(timeout=5)` → `process.kill()`. **Re-expressed for isolated-vm (EC-5):** `script.runSync(context, { timeout: <ms> })` throws on overrun → `isolate.dispose()` (no kill-escalation needed; disposing the isolate reclaims the V8 heap synchronously).

### Technique 3 — Capability minimization by construction (Letta TS codegen)

Letta `generate_typescript_execution_script` (`tool_sandbox/typescript_generator.py:92`): extracts user `import` statements to the ESM top, wraps the function, injects args as typed constants, and **deliberately does NOT inject agent_state** into TS tools (only `process.env.LETTA_AGENT_ID`) (`:108-110`). e2b runs it via `run_code(code, envs, language="ts")` (`tool_sandbox/e2b_sandbox.py:102`); result parsed by `parse_typescript_result` (`:118`). **Borrow:** pass skill args as structured values via `context.global.set(...)` (NEVER string-concatenated into code — closes the injection vector), and inject ZERO host capabilities by default.

### Technique 4 — The 6 guards, re-expressed for an isolated-vm executor (EC-5 TARGET mapping)

Letta's local sandbox does NOT implement the 6 guards (no shell-metachar reject, no whitelist, no path-confinement, no output-cap) — it relies on subprocess+venv+e2b isolation (`tool_sandbox/local_sandbox.py` env scrub `:129-135`: `PYTHONWARNINGS/NO_COLOR/TERM/PYTHONUNBUFFERED`; temp-file cleanup in `finally`). So our guard table is a TARGET design, not a transcription:

| # | Original guard (subprocess-shaped) | Re-expressed for isolated-vm |
|---|---|---|
| 1 | reject shell metacharacters | N/A — isolate has **no shell**; enforce "no `child_process`/`process` binding exposed" (default-deny — isolate has no Node APIs) |
| 2 | `shlex`-style arg split | args passed as structured values via `context.global.set`, never concatenated into source |
| 3 | command whitelist | capability whitelist — only explicitly-injected refs live in the context; everything else default-deny |
| 4 | path-confinement to allowed roots | no `fs` binding by default; if a host bridge is ever added, confine to allowed roots |
| 5 | subprocess timeout | `script.runSync(context,{timeout})` + `isolate.dispose()` on overrun |
| 6 | output-cap | cap serialized-result byte size + `new ivm.Isolate({ memoryLimit })` (MB) |
| (7) | per-task tool-call cap | executor enforces a max host-callback/invocation count per `execute()` call |

Plus (non-negotiable, Princípio 3): typed `ToolInvocationDeniedError` + OTel `tool_invocation_denied` event per denied call (auditability).

---

## Cross-cutting Comparison

| Dimension | Letta (reference) | TheMemory (target M1) |
|---|---|---|
| Executes agent code? | Yes (subprocess + e2b/modal) | NEW — in-process isolated-vm default + opt-in out-of-process |
| Language | Python tools; TS via e2b only | TS/JS only (`SkillLanguage`) |
| Boundary | OS process / cloud VM | V8 isolate (default) + cloud VM (opt-in) |
| Distroless-no-shell fit | N/A (full base image) | isolated-vm fits; subprocess/firejail do NOT |
| Offline / no network | local subprocess yes; e2b/modal no | isolated-vm yes (key advantage) |
| Guards | none (relies on isolation) | 6 guards + typed error + OTel (security-by-design) |

---

## ADRs

### D1 — Time budget + stop conditions (from discovery plan)
Letta-only deep-read (mem0 confirmed non-executing in one grep); web capped at the in-process comparison. Budget respected; no question blocked. EC-3 honored (npm 403 → web search fallback succeeded; in-process column fully answered).

### D2 — Investigation depth
Read dispatch + local subprocess + TS codegen + e2b + deps + the TS integration test + our root Dockerfile. Did NOT read modal_sandbox internals (out-of-scope; modal is opt-in-only and the e2b path already evidences the cloud shape).

### D3 — Sandbox technology (DECISION-GRADE — owner sign-off required before /to-plan)

**Recommendation: `isolated-vm` (in-process V8 isolate) as the DEFAULT `SandboxedSkillExecutor`, with the `SkillExecutor` DIP leaving a seam for an opt-in out-of-process impl (e2b/modal) as defense-in-depth.**

Rationale:
1. **Fits distroless-no-shell (EC-47).** Native Node addon — same class as the already-shipped glibc `onnxruntime-node`; no shell, no extra OS binary. Subprocess/firejail/bubblewrap would regress EC-47.
2. **Offline + zero per-exec cost.** No network dep — preserves the local-OSS posture + air-gapped CI. e2b/modal add network + cost.
3. **Real isolation** (separate V8 heap, no `require`/`process`/`fs` by default) — unlike `node:vm` (not a boundary) / `worker_threads` (shares process) / `vm2` (CVE-2026-22709 9.8).
4. **Native `memoryLimit` + per-run `timeout`** map directly onto guards 5 + 6.

Rejected alternatives:
- **vm2** — CVE-2026-22709 (CVSS 9.8) + maintainer warns of inevitable future bypasses. REJECTED.
- **node:vm** — documented non-boundary (prototype-chain escape). REJECTED.
- **worker_threads** — shares the process; can `require('child_process')`. REJECTED as the boundary.
- **e2b/modal as DEFAULT** — network + cost + contradicts offline posture. KEPT as opt-in DIP impl only.

Honest caveats the owner must weigh:
- isolated-vm is in **maintenance mode** + requires a native build (`node-gyp`/prebuilt) → add as an **optional/lazy dep** (mirror the `@xenova/transformers` optional posture) so the default barrel never force-pulls it; `/deps-audit` mandatory.
- In-process V8-isolate is not bulletproof against a V8 0-day → the 6 guards + the out-of-process DIP seam (for attacker-controlled-at-scale) are non-negotiable defense-in-depth, not optional polish.

**OWNER DECISION GATE:** accept isolated-vm-default (Option A), or mandate out-of-process-only e2b/modal (Option B, heavier + network), or QuickJS-WASM (Option C) — before `/to-plan` runs.

---

## Recommendations for TheMemory

1. New `SkillExecutor` DIP port (domain) — `execute(skill, args, opts): Promise<SkillExecutionResult>`; default impl `SandboxedSkillExecutor` (isolated-vm), optional `OutOfProcessSkillExecutor` seam.
2. Ship the 6 guards + per-call cap + typed `ToolInvocationDeniedError` + OTel `tool_invocation_denied` event IN Slice 1 (sandbox-first; never wire execution before the guards exist).
3. Slice 2 wires `ScopedSkillMemory.execute(skillId, args)` → REST `POST /v1/scopes/skill/:repoId/skills/:id/execute` + MCP `execute_skill` (opt-in, gated). STORE-only stays the default; execution is opt-in.
4. GOAL test mirrors Letta's TS suite shape: benign → captured output; one malicious case per guard → denied + audited + zero escape, against the real boundary.
5. `isolated-vm` as optional/lazy dep; `/deps-audit` + a dedicated security review before merge.

## Blocked questions (if any)

None. All 6 questions answered (Q4 in-process column answered from web after npm 403, per EC-3).

## Halt-loop progress (audit trail)

| Q | Corner | Status | Key citation |
|---|---|---|---|
| Q1 dispatch | techniques | done | `tool_execution_sandbox.py:80-100`, `enums.py:262-265`, `base.py:24/108` |
| Q2 guards/limits | techniques | done | `local_sandbox.py:129-205` |
| Q3 TS execution | techniques | done | `typescript_generator.py:92-110`, `e2b_sandbox.py:102-118` |
| Q4 sandbox tech | deps | done | `pyproject.toml:132-146` + web (isolated-vm/vm2/node:vm) |
| Q5 distroless fit | tools | done | `./Dockerfile:14-22` (EC-47) |
| Q6 integration tests | tests | done | `integration_test_typescript_tool_execution_sandbox.py:60-302` |

## Related

- Roadmap: `.claude/knowledge-base/roadmaps/memory-gaps-roadmap.md` § M1
- Memory: `themory-agentic-tool-use-planned`, `themory-active-focus-m1-m2-memory-gaps`
- Next: `/discover-confidence agentic-skill-execution-sandbox` → owner D3 sign-off → `/to-plan`
