# Discovery Plan: Agentic skill execution + injection/command sandbox (M1 / Item 21)

> **Version 1.1** (edge-case MUST-FIX absorbed 2026-06-21: EC-1 Q5 target → root `./Dockerfile` (not `packages/*/Dockerfile`); EC-2 Q3 TS targets → `tool_sandbox/typescript_generator.py` + `e2b_sandbox.py` (Letta `local_sandbox.py` is Python-only). See `agentic-skill-execution-sandbox-edge-cases-2026-06-21.md`.)

> **Version 1.0** — Investigate how to EXECUTE a stored TS/JS skill (`SkillLanguage = 'typescript' | 'javascript'`) inside a hardened sandbox, so TheMemory closes gap G2 (procedural execution) from the Letta cross-validation. Primary reference is **Letta's local tool-execution sandbox** (`.claude/knowledge-base/references/letta/letta/services/tool_sandbox/` — local/e2b/modal backends + a TypeScript sandbox integration test), supplemented by allowlisted web research (npm `isolated-vm` / `@e2b/code-interpreter`) for the in-process option Letta does not use. Output: a blueprint that lets the owner pick the sandbox technology + the executor DIP shape, with the 6 security guards mapped, BEFORE any `/to-plan`.

**Slug:** `agentic-skill-execution-sandbox`
**Owner:** project-owner
**Created:** 2026-06-21
**Time budget:** 4h (Letta 2.5h, web 1.5h — breakdown in ADR D1)

## Context

`/loop-cross-validation` vs Letta (2026-06-21, `.claude/knowledge-base/reviews/themory-vs-letta-cross-validation-2026-06-21.md`) scored **Procedural memory 2.0/5** — gap **G2**: `ScopedSkillMemory` (`packages/core/src/infrastructure/db/scoped-skill-memory.ts`) STORES code-as-skill but never executes it, while Letta executes tools (incl. TS) in a sandbox. P0 freeze was LIFTED 2026-06-21 (CLAUDE.md § PRIORITY 0 Amendment 2026-06-21); this is **M1** of `.claude/knowledge-base/roadmaps/memory-gaps-roadmap.md`, Roadmap Item 21. The locked rule (session memory `themory-agentic-tool-use-planned`): **the injection/command sandbox MUST ship WITH execution, never after** — security-by-design. Skills are TS/JS (`packages/core/src/domain/skill.ts:20`).

## Objective

Decide **which sandbox technology** + **which executor DIP shape** TheMemory should adopt to run untrusted stored TS/JS skills safely, with the 6 guards mapped to concrete mechanisms.

- [ ] All research questions answered with citations to `.claude/knowledge-base/references/letta/` (+ allowlisted web)
- [ ] Cross-cutting comparison: in-process (isolated-vm) vs out-of-process (subprocess/e2b/modal) — isolation, deps, Docker/distroless fit, threat model
- [ ] Recommendations: one concrete sandbox-tech proposal + executor DIP sketch + the 6-guard → mechanism mapping
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `.claude/knowledge-base/references/letta/` | `letta/services/tool_sandbox/` (local/e2b/modal), `letta/services/tool_executor/{tool_execution_sandbox.py,sandbox_tool_executor.py,core_tool_executor.py}`, `tests/integration_test_tool_execution_sandbox.py`, `tests/integration_test_typescript_tool_execution_sandbox.py` | Letta is the SOTA local exemplar: multi-backend sandbox + a TS execution path + sandbox tests |
| Allowlisted web (`npmjs.com`, `github.com`, `raw.githubusercontent.com`) | `isolated-vm`, `vm2` (deprecated advisories), `@e2b/code-interpreter`, Node `node:vm` docs note | The in-process V8-isolate option Letta does NOT use — needed to weigh in-process vs out-of-process |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| `.claude/knowledge-base/references/letta/` everything outside `tool_sandbox`/`tool_executor`/sandbox tests | Letta's agent loop / LLM providers / ORM are not the sandbox question |
| `.claude/knowledge-base/references/mem0/` | Mem0 has no code executor — not relevant to G2 |
| G1 (working-memory) + G4 (context-window) | Deferred to TheoKit (project-owner 2026-06-21); not this discovery |
| The UI/MCP execute surface design | Belongs to `/to-plan` Slice 2, not the sandbox-tech discovery |

## ADRs

### D1 — Time budget + stop conditions

**Decision:** Letta 2.5h (primary exemplar), allowlisted web 1.5h (isolated-vm/e2b npm + GitHub).

**Rationale:** Letta has the richest local prior art (3 backends + TS test); the in-process option (isolated-vm) is web-only. Bias depth to Letta.

**Stop condition — per question (mandatory):** Fase A empty after 3 query-variant retries → mark BLOCKED ("Fase A exhausted"), continue. Never pad from another question's scope.

**Stop condition — per project (mandatory):** budget exhausted → remaining questions BLOCKED ("budget exhausted"); if all remaining are done/blocked, emit `<promise>BLUEPRINT_BLOCKED</promise>` (never `BLUEPRINT_COMPLETE` from a blocked state).

**Anti-pattern:** NEVER fabricate Fase B answers (Unbreakable Rule 3).

### D2 — Investigation depth

**Decision:** Read Letta's sandbox backends + the TS test END-TO-END (they encode the real isolation mechanics + the threat model). For web, read npm package READMEs + security advisories + the GitHub issue tracker headlines only (not full source).

**Rationale:** the isolation guarantees live in implementation detail (subprocess flags, e2b API, resource limits) — skimming misses the threat model. Web is for the decision matrix, not deep reading.

**Consequences:** deeper Letta read, shallower web — the blueprint's in-process column is decision-grade, not implementation-grade (acceptable; if isolated-vm is chosen, a follow-up discovery reads it deeply).

### D3 — Sandbox-technology decision is a RESEARCH QUESTION, not pre-decided

**Decision:** Q2+Q3 produce the comparison; the blueprint's ADR proposes a recommendation but the FINAL sandbox-tech pick is escalated to the project owner (it carries a heavy dep + threat-model weight).

**Rationale:** in-process (isolated-vm, native build, strong-but-shared-process) vs out-of-process (subprocess/e2b/modal, heavier dep / network, stronger isolation) is a security + ops trade-off the owner must sign. Pre-deciding violates the 95% gate.

**Consequences:** the discovery ENDS with a recommendation + open owner-decision, not a locked choice. `/to-plan` waits on that decision.

## Research Questions

| # | Question | Corner | Reference project(s) | Fase A (broad map) | Fase B (deep Read) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | How does Letta's sandbox abstraction dispatch to local vs e2b vs modal backends, and what is the executor→sandbox boundary (the DIP we'd mirror)? | techniques | `.claude/knowledge-base/references/letta/letta/services/tool_executor/tool_execution_sandbox.py`, `letta/services/tool_sandbox/__init__.py` | `ast-grep run --pattern 'class $NAME($$$): $$$' --lang python letta/services/tool_sandbox/` to list backend classes | Read `tool_execution_sandbox.py` + each backend's class header to map the dispatch + the common interface | Class/interface diagram: executor → SandboxBackend (local/e2b/modal) + the method contract, with path:line |
| Q2 | How does Letta's LOCAL sandbox (`local_sandbox.py`) isolate execution + bound resources (timeout, output cap, FS confinement, env)? | techniques | `.claude/knowledge-base/references/letta/letta/services/tool_sandbox/local_sandbox.py` | `ast-grep run --pattern 'def $F($$$): $$$' --lang python letta/services/tool_sandbox/local_sandbox.py` | Read each method: capture subprocess flags, timeout, output handling, FS/env restriction | Table: guard → Letta mechanism (subprocess/venv/timeout/...) → path:line; gaps where Letta does NOT guard |
| Q3 | How does Letta run a TYPESCRIPT tool end-to-end (the TS execution path) + what does the TS sandbox integration test assert? **(EC-2: Letta's `local_sandbox.py` is Python-only; TS lives in `typescript_generator.py` + e2b.)** | techniques | `.claude/knowledge-base/references/letta/letta/services/tool_sandbox/typescript_generator.py`, `letta/services/tool_sandbox/e2b_sandbox.py`, `tests/integration_test_typescript_tool_execution_sandbox.py` | SKIP Fase A (test file is the entry); grep `typescript`/`node`/`deno` in `tool_sandbox/typescript_generator.py` + `e2b_sandbox.py` | Read `typescript_generator.py` (codegen) + `e2b_sandbox.py` (the backend that runs the generated TS) + the TS test | Step-by-step TS execution flow + which backend runs TS (note: e2b-cloud, NOT local subprocess) + assertions, with path:line |
| Q4 | What deps + license + maintenance health do the sandbox options carry — Letta's e2b/modal SDKs (local) vs the JS in-process `isolated-vm` + out-of-process `@e2b/code-interpreter` (web)? | deps | `.claude/knowledge-base/references/letta/` (pyproject + tool_sandbox imports) + web `npmjs.com/package/isolated-vm`, `npmjs.com/package/@e2b/code-interpreter`, `github.com/patriksimek/vm2` (advisories) | Grep `e2b`/`modal` in letta deps (text-shape); WebFetch npm pages for isolated-vm + @e2b | Read dep versions + last-release + license + open-CVE/advisory notes | Decision table: option → dep weight → license → maintenance → native-build? → security advisories |
| Q5 | Which option fits TheMemory's Node 22 distroless Docker + offline/air-gapped CI — in-process (no network, native build) vs out-of-process subprocess (node present) vs e2b/modal (network/cloud)? | tools | `.claude/knowledge-base/references/letta/letta/services/tool_sandbox/` (config/env) + target root `./Dockerfile` (EC-1: distroless Node 22, NOT `packages/*/Dockerfile`) | SKIP Fase A — config/text-shape. Grep env/config in letta sandbox backends; read our distroless constraint from `./Dockerfile` | Read each backend's runtime requirement (network? extra binary? native compile?) | Fit matrix: option → distroless-compatible? → needs-network? → CI-offline-able? → verdict for us |
| Q6 | How does Letta TEST the sandbox — which denied/malicious/escape paths are asserted (timeout, FS escape, error capture)? | tests | `.claude/knowledge-base/references/letta/tests/integration_test_tool_execution_sandbox.py`, `tests/integration_test_typescript_tool_execution_sandbox.py` | `ast-grep run --pattern 'def test_$F($$$): $$$' --lang python letta/tests/integration_test_tool_execution_sandbox.py` | Read each test: capture what malicious/limit scenario it asserts + the expected outcome | Table: scenario (timeout/FS-escape/error/output) → assertion → path:line; maps to OUR 6-guard test plan |

## Coverage Matrix

| Corner | Questions mapped | Status |
|---|---|---|
| Integration tests | Q6 | Covered |
| Dependencies | Q4 | Covered |
| Tools | Q5 | Covered |
| Techniques | Q1, Q2, Q3 | Covered (at the 3-per-corner cap) |

**Coverage: 4/4 corners covered (100%)**

## Halt-loop Checkpoints

| Checkpoint | Assertion | Action if fails |
|---|---|---|
| Before answering Qx | the cited `.claude/knowledge-base/references/letta/{path}` exists | Mark Qx BLOCKED ("path not found"), continue |
| Per-question Fase A budget | Fase A returned ≥1 hotspot OR 3 retries done | After 3 retries empty → BLOCKED ("Fase A exhausted") |
| Web question (Q4) | WebFetch target is on `discover-web-allowlist.txt` | If not allowlisted, BLOCKED ("domain not allowlisted"); do NOT fetch off-allowlist |
| After answering Qx | blueprint section has ≥1 citation (letta path OR allowlisted URL) | Re-iterate Qx (1 retry max) |
| Before promising complete | all 4 corners populated + D3 sandbox-tech recommendation present | Refuse promise, continue |

## Acceptance Criteria

- [ ] All 6 questions answered OR explicitly BLOCKED with reason
- [ ] All 4 coverage corners populated in the blueprint
- [ ] Every citation points to a real `.claude/knowledge-base/references/letta/{...}` path OR an allowlisted URL
- [ ] Blueprint has an ADR synthesizing the sandbox-tech recommendation (D3) + the 6-guard→mechanism mapping
- [ ] Time budget respected
- [ ] `/discover-confidence` ≥ SHIPPABLE_WITH_CAVEATS
- [ ] Blueprint saved at `.claude/knowledge-base/discoveries/blueprints/agentic-skill-execution-sandbox-blueprint.md`

## Global Definition of Done

- [ ] All phases (plan → edge-cases → execute → confidence → improve if needed → re-score)
- [ ] Final `/discover-confidence` verdict in the blueprint header
- [ ] No fabricated citations
- [ ] Coverage Matrix 100%
- [ ] ADRs cite a project rule/principle: `architecture.md` (DIP for the `SkillExecutor` port), Inquebrável Rule 8 (fail-fast on denied invocation), Princípio 3 (OTel `tool_invocation_denied` auditability), `no-paper-names-in-code.md` (no "Voyager" in src), `deps-audit-golden-rule.md` (the sandbox dep MUST pass CVE audit).
