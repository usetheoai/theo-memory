---
slug: production-runtime-hardening
created_at: 2026-06-22
goal: Make M1 skill-execution reachable in the production runtime via an opt-in env (default OFF), measured by the GOAL integration test (env on → execute returns output; env off → 501) against real isolated-vm.
---

# Plan: production-runtime-hardening

> **Version 1.1** — edge-case MUST-FIX absorbed 2026-06-22 (`production-runtime-hardening-edge-cases-2026-06-22.md`): EC-1 (enabling the env when isolated-vm is absent MUST NOT crash server boot — constructor addon-free / degrade to 503) → T1.1. SHOULD-TEST folded into TDD: EC-2 (env accepts ONLY exact `'true'`), EC-3 (one flag = server+MCP+CLI blast radius) → T1.1. DOCUMENT: EC-4 (static import of SandboxedSkillExecutor is sufficient — barrel does not pull isolated-vm at module-load), EC-5 (build retry wraps the whole pnpm install; transient-only, fail-loud after cap), EC-6 (T2.2 needs the env set on the container).

> Surfaced by the M2 Theo-Cloud live-test. The deployed `themory server` returns `501 SKILL_EXECUTION_NOT_CONFIGURED` on every skill execute because `wireMemoryFromPool` never wires a `SkillExecutor`. This cycle adds an OPT-IN, default-OFF env path to enable M1 skill execution in the production runtime (server + MCP + CLI share the same wiring site), verifies `isolated-vm` actually loads in the distroless runtime when enabled, brings the already-committed Docker build fixes (isolated-vm pin + node-gyp toolchain) under `/review`, and hardens the build against the sharp/libvips CDN flakiness. The gateway episodes proxy is a SEPARATE theo-cloud repo cycle (deferred — ADR D5).

## Goal

> "Make M1 skill-execution reachable in the production runtime via an opt-in env (`THEOMEM_SKILL_EXECUTION`, default OFF), measured by `tests/integration/skill-execution-server-wiring.test.ts` passing both cases (env set → REST execute returns the captured output via real `isolated-vm`; env unset → 501) against real `ankane/pgvector:v0.5.1`."

## Context

The M2 live-test probed the deployed Theo-Cloud themory: `POST /v1/scopes/skill/:repoId/skills/:id/execute` returned **501 SKILL_EXECUTION_NOT_CONFIGURED**. Root cause (live evidence): `wireMemoryFromPool(pool)` (`packages/agent-core/src/agent-tools-memory.ts:166`) — the SINGLE Memory construction site shared by `run-server.ts`, `run-mcp-server.ts`, and `createAgentToolsMemory()` — calls `createLocalMemory({vectorStore,embedder,llm,embeddingDim})` WITHOUT `skillExecutor`. M1 shipped `SandboxedSkillExecutor` + the REST endpoint + the SDK opt-in (`createLocalMemory({ skillExecutor })`) but no runtime path to enable it. The user's hypothesis ("isolated-vm not loading in distroless") is secondary — it is never wired. Two related Docker build fixes already landed on `develop` unreviewed (isolated-vm `^7.0.0`→`^6.1.2` Node-22 compat `3344f2d`; node-gyp toolchain `22c3ad8`); they need this cycle's `/review`. Build flakiness: `sharp`→libvips CDN (transitive via `@xenova/transformers`).

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit | Why it exists today | Invariant to preserve |
|---|---|---|---|---|
| `packages/agent-core/src/agent-tools-memory.ts` | 216 | `be6c0cd` (2026-06-18) | shared Memory factory; `wireMemoryFromPool` (`:153`) + `resolveEmbedderKind` env pattern (`:73`) | additive: opt-in skillExecutor wire; default path (env unset) byte-unchanged |
| `packages/agent-core/src/__tests__/agent-tools-memory.test.ts` | (exists) | — | unit tests for the factory | add cases for the new env gate |
| `packages/core/src/infrastructure/db/config.ts` | 144 | `70e2083` (2026-06-21) | `LocalMemoryConfig.skillExecutor?` (`:79`) DIP slot | unchanged (already supports skillExecutor) |
| `Dockerfile` | 129 | `22c3ad8` (2026-06-22) | multi-stage; builder+production-deps toolchain (just added) | sharp/libvips resilience addition; toolchain unchanged |
| `packages/core/package.json` | 95 | `3344f2d` (2026-06-22) | isolated-vm `^6.1.2` (just pinned) | unchanged (pin already correct) |
| `tests/integration/skill-execution-server-wiring.test.ts` (NEW) | 0 | — | GOAL: env-gated wiring end-to-end vs real pg + real isolated-vm | — |

### Current callers / dependents

- **Symbol:** `wireMemoryFromPool` (`agent-tools-memory.ts:153`) — called by `run-server.ts:157`, `run-mcp-server.ts:278`, `createAgentToolsMemory()`. Wiring the opt-in skillExecutor here reaches all three production entrypoints (DRY single site).
- **Symbol:** `SandboxedSkillExecutor` (`@usetheo/memory`, `core/src/index.ts:82`) — M1 default impl; constructed lazily (optional `isolated-vm`).
- **Symbol:** `LocalMemoryConfig.skillExecutor?` (`config.ts:79`) — the DIP slot the wire fills; `ScopedSkillMemory.execute()` gates on it (501 when absent).
- **Symbol:** `resolveEmbedderKind` (`agent-tools-memory.ts:73`) — the canonical `process.env[...]` resolution pattern the new flag mirrors.

### Domain glossary
- **Skill execution** — running a stored code-as-skill payload inside the M1 `SandboxedSkillExecutor` (isolated-vm). STORE-only is the default; execution is opt-in/gated (M1 security line).
- **wireMemoryFromPool** — the single shared `createLocalMemory(...)` construction site for server/MCP/CLI.
- **distroless runtime** — `gcr.io/distroless/nodejs22-debian12` (no shell); the published image's stage 3.

### Architecture boundaries affected
Per `architecture.md`: the wire lives in `agent-core` (composition layer), depends on the `@usetheo/memory` public surface (`SandboxedSkillExecutor` + `createLocalMemory`) — no new boundary. The opt-in is composition wiring, not a domain change.

## Prior Art & Related Work
- **M1 cycle:** `agentic-skill-execution-sandbox` (SandboxedSkillExecutor + REST execute + `ScopedSkillMemory.execute()` 501-when-unwired) — the SDK opt-in this cycle exposes at runtime.
- **Live-test report:** `.claude/knowledge-base/reviews/m2-theo-cloud-live-test-2026-06-22.md` (the 501 probe + the isolated-vm@7/Node22 + Docker toolchain findings).
- **Env pattern:** `resolveEmbedderKind` (`THEOMEM_EMBEDDER`) is the canonical opt-in env precedent mirrored here.

## Objective
- [ ] `THEOMEM_SKILL_EXECUTION` env resolver (default OFF) + opt-in `SandboxedSkillExecutor` wire in `wireMemoryFromPool` (lazy import; barrel-clean).
- [ ] Unit test: env set → config carries skillExecutor; env unset → undefined (default).
- [ ] GOAL integration test: env set → REST execute returns output via real isolated-vm; env unset → 501.
- [ ] Distroless verification: isolated-vm loads + a skill executes in the rebuilt distroless image when enabled.
- [ ] `/review` covers the already-committed isolated-vm pin (`3344f2d`) + Docker toolchain (`22c3ad8`).
- [ ] Build resilience for the sharp/libvips CDN flakiness (retry/backoff OR ADR-documented tradeoff).

## ADRs

### D1 — Opt-in env `THEOMEM_SKILL_EXECUTION`, default OFF
- **Decision:** a new env `THEOMEM_SKILL_EXECUTION` (`'true'` → enable; unset/anything-else → disabled). When enabled, `wireMemoryFromPool` wires `new SandboxedSkillExecutor()`. Default OFF: the secure STORE-only default + the existing `501` are byte-unchanged when unset.
- **Rationale:** M1's locked security line is "STORE-only default; execution opt-in/gated". A default-preserving opt-in adds NO new attack surface unless an operator deliberately enables it — so it needs no new owner sign-off (it completes M1's intended opt-in at the runtime layer). Prefix `THEOMEM_` matches the runtime-config family (`THEOMEM_EMBEDDER`, `THEOMEM_PG_URI`).
- **Alternatives:** (a) enable by default — REJECTED (changes the secure default; RCE-capable surface on by default; needs owner sign-off); (b) `THEMEMORY_` prefix — REJECTED (that prefix is the auth family `THEMEMORY_API_KEY`; the runtime-config family is `THEOMEM_`); (c) a CLI flag instead of env — REJECTED (the Docker/server path is env-driven; MCP + server must share one mechanism).

### D2 — Wire in `wireMemoryFromPool` (single shared site), not per-entrypoint
- **Decision:** add the opt-in wire inside `wireMemoryFromPool` so server + MCP + CLI all honor it from one place.
- **Rationale:** DRY — it is the single `createLocalMemory(...)` construction site (`run-server.ts:157`, `run-mcp-server.ts:278`, `createAgentToolsMemory`). Per-entrypoint wiring would triplicate + drift.
- **Alternatives:** wire in each entrypoint — REJECTED (3× duplication, drift risk).

### D3 — Distroless isolated-vm verification via the rebuilt image (live), documented in the report
- **Decision:** verify `isolated-vm` loads + a skill executes inside the distroless runtime by rebuilding the image (toolchain compiles isolated-vm@6.1.2 into production-deps → copied to distroless) and executing a skill against it with the env enabled. Record the result in the implementation/review report.
- **Rationale:** the distroless-load concern is the user's stated worry; the only honest proof is running it in the distroless image. The unit/integration tests run on the host (real isolated-vm); the distroless proof is a live verification step.
- **Alternatives:** a Dockerized vitest stage — REJECTED for v1 (heavy CI surface; a live verification + documented evidence is sufficient and matches the M2 live-test precedent).

### D4 — sharp/libvips build resilience via install retry, NOT removing @xenova
- **Decision:** wrap the optional-native install with a bounded retry/backoff (or, if retry is infeasible in the Dockerfile, an ADR documenting the `INCLUDE_OPTIONAL` tradeoff) so a transient libvips CDN failure does not abort the image build.
- **Rationale:** `sharp` is a transitive optional dep of `@xenova/transformers`, which backs the DEFAULT local embedder — removing it would break `THEOMEM_EMBEDDER=local`. The flakiness is network-transient; a retry is the proportionate fix (KISS).
- **Alternatives:** (a) remove `@xenova`/sharp — REJECTED (breaks the default local embedder); (b) vendor libvips — REJECTED (heavy, image bloat); (c) do nothing — REJECTED (release risk the user flagged).

### D5 — Gateway episodes proxy DEFERRED to the theo-cloud repo (out of scope)
- **Decision:** the "gateway has no episodes proxy" item is NOT in this plan; it is a `theo-cloud` repo cycle (BFF proxy + dashboard surface for `GET /v1/scopes/:type/:id/episodes`).
- **Rationale:** cross-repo — the gateway code lives in `theo-cloud`, not `theo-memory`; this repo's cycle cannot land it. Honest scope disclosure (Inquebrável Rule 3).
- **Alternatives:** include it here — REJECTED (different repo; would split the PR across repos).

## Drawbacks & Risks

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Enabling skill execution is an RCE-capable surface | High | Default OFF (D1); operator must explicitly opt in; M1's 6-guard sandbox + typed denials remain the boundary | impl |
| isolated-vm fails to load in distroless (glibc/abi) | Medium | D3 live verification before claiming it works; if it fails, the honest path is a documented 503 + a follow-up (do NOT claim success) | impl |
| sharp retry masks a real persistent failure | Low | Bounded retry (N attempts) then fail loud; never infinite | impl |
| Opt-in wire accidentally changes the default path | Medium | Unit test asserts env-unset → skillExecutor undefined (default byte-unchanged); GOAL test asserts 501 when unset | impl |

## Unresolved Questions
- Q1 — should the server log a one-line stderr disclosure when skill execution is ENABLED (parity with the embedder disclosure)? (Lean: yes — a single honest "skill execution ENABLED (opt-in)" line; resolve at edge-case-plan.)

## Dependencies

| Dependency | Version | New/Existing | Rule 9 | CVE |
|---|---|---|---|---|
| `isolated-vm` | `^6.1.2` | Existing (version pin, already committed `3344f2d`) | M1 already selected isolated-vm; this is a Node-22-compat version change, not a new dep | `/deps-audit` confirms |

> No NEW dependency. `/deps-audit` validates the isolated-vm pin + confirms no CVE.

## Dependency Graph
```
Phase 1 (opt-in wire + unit) ──▶ Phase 2 (GOAL integration + distroless verify) ──▶ Phase 3 (build resilience + review committed Docker fixes) ──▶ Phase 4 (integration validation)
```

---

## Phase 1: Opt-in skill-executor wiring

### T1.1 — `THEOMEM_SKILL_EXECUTION` resolver + opt-in wire in `wireMemoryFromPool`
#### Objective
Wire `SandboxedSkillExecutor` into the shared Memory factory only when the env opts in.
#### Why this step (action + reasoning)
1. **What:** add `resolveSkillExecutionEnabled()` (mirrors `resolveEmbedderKind`) + in `wireMemoryFromPool`, when enabled, lazy-import `SandboxedSkillExecutor` and pass `skillExecutor` to `createLocalMemory`.
2. **Why now:** this is the root-cause fix for the 501 (live evidence); the single site (D2) reaches server+MCP+CLI; default-OFF (D1) preserves the secure default.
#### Evidence
`agent-tools-memory.ts:166` (createLocalMemory without skillExecutor); `:73` (env pattern); `config.ts:79` (skillExecutor slot); live 501 probe in the live-test report.
#### Files to edit
```
packages/agent-core/src/agent-tools-memory.ts — resolveSkillExecutionEnabled() + opt-in wire
packages/agent-core/src/__tests__/agent-tools-memory.test.ts — RED unit cases
```
#### Deep file dependency analysis
- `wireMemoryFromPool` is the single caller site (server/MCP/CLI). Lazy import keeps `isolated-vm` out of module-load (barrel-clean, mirrors the embedder lazy-import note at `:154`).
#### Deep Dives
- `resolveSkillExecutionEnabled(): boolean` → `process.env['THEOMEM_SKILL_EXECUTION'] === 'true'` (**EC-2:** exact `'true'` only — mirrors `resolveEmbedderKind`'s exact-match contract; `'1'`/`'TRUE'`/`'yes'` → disabled).
- **EC-4:** use a STATIC `import { SandboxedSkillExecutor } from '@usetheo/memory'` (the barrel is already statically imported for `createLocalMemory` at `:27`; `SandboxedSkillExecutor`'s constructor is addon-free — `isolated-vm` loads only at `execute()` — so the static import does NOT pull the addon at module-load). In `wireMemoryFromPool`: `const skillExecutor = resolveSkillExecutionEnabled() ? new SandboxedSkillExecutor() : undefined;` then spread `...(skillExecutor ? { skillExecutor } : {})` into `createLocalMemory` (exactOptionalPropertyTypes → conditional spread, never `skillExecutor: undefined`).
- **EC-1 (MUST-FIX — no-crash-on-boot):** constructing `SandboxedSkillExecutor` MUST NOT require `isolated-vm` (verified: M1 lazy-loads at `execute()`). So enabling the env on a runtime without the addon boots fine and degrades to a typed `503 SkillExecutorUnavailable` at execute — NOT a server-boot crash. The unit test asserts `new SandboxedSkillExecutor()` does not throw addon-free.
- **EC-3:** the wire is in the single shared `wireMemoryFromPool` → one env flips server + MCP + CLI together (documented blast radius; D2).
#### Concurrency tests
(none — single-threaded) Construction-time wiring; no shared mutable state.
#### TDD
```
RED:   test_skill_execution_disabled_by_default_no_executor() — env unset → createLocalMemory called WITHOUT skillExecutor
RED:   test_skill_execution_enabled_wires_executor() — THEOMEM_SKILL_EXECUTION=true → config carries a SandboxedSkillExecutor
RED:   test_skill_execution_env_exact_true_only() [EC-2] — '1'/'TRUE'/'yes'/' true ' → DISABLED
RED:   test_sandboxed_executor_constructor_addon_free() [EC-1] — new SandboxedSkillExecutor() does not throw without isolated-vm
GREEN: add resolver + opt-in static-import wire
REFACTOR: none
VERIFY: `npm test -- agent-tools-memory` exit 0
```
#### Acceptance Criteria
- [ ] `npm test -- agent-tools-memory` exit 0 (both env-on / env-off cases)
- [ ] `npm run typecheck` exit 0; `git diff` shows the env-unset path unchanged
- [ ] `npm run lint` exit 0; file `≤ 500` LoC (`wc -l`)
#### DoD
- [ ] `npm test -- agent-tools-memory` exit 0; lazy import keeps `isolated-vm` off module-load (`node -e "require('./packages/agent-core/dist/...')"` does not pull it — verified in Phase 4).

---

## Phase 2: GOAL integration + distroless verification

### T2.1 — GOAL integration test (env-gated execute, real isolated-vm + real pg)
#### Objective
Prove the wire end-to-end: env on → execute returns output; env off → 501.
#### Why this step (action + reasoning)
1. **What:** `tests/integration/skill-execution-server-wiring.test.ts` — build the REST app via the same wiring path with the env toggled; add a skill; execute; assert output (on) / 501 (off).
2. **Why now:** the GOAL contract; uses real isolated-vm + real pgvector (no mock — Inquebrável + the live-test directive).
#### Evidence
M1 `tests/integration/skill-execution-sandbox.test.ts` (SDK-path GOAL); the REST execute handler (501-when-unwired).
#### Files to edit
```
tests/integration/skill-execution-server-wiring.test.ts (NEW)
```
#### Deep file dependency analysis
- Exercises `wireMemoryFromPool`/`createServer` with `THEOMEM_SKILL_EXECUTION` toggled via `process.env` in-test (restore after).
#### Deep Dives
- Case A (enabled): set env → build memory/app → add skill → `execute` → assert `output` + `skill_executed`.
- Case B (disabled): unset env → `execute` → assert 501 `SKILL_EXECUTION_NOT_CONFIGURED`.
#### Concurrency tests
(none — single-threaded) Sequential add→execute.
#### Failure scenarios note
isolated-vm unavailable → 503 `SkillExecutorUnavailable` (M1 typed path); asserted-or-documented.
#### TDD
```
RED:   test_goal_execute_enabled_returns_output(); test_goal_execute_disabled_returns_501() (fail: wire absent)
GREEN: (Phase 1 wire makes case A pass; case B already passes)
REFACTOR: none
VERIFY: `THEOMEM_PG_URI=... npm run test:integration -- skill-execution-server-wiring` exit 0
```
#### Acceptance Criteria
- [ ] `npm run test:integration -- skill-execution-server-wiring` exit 0 (both cases) vs real `ankane/pgvector:v0.5.1` + real `isolated-vm`
- [ ] no mock LLM/executor — real isolated-vm (`grep -L "vi.fn" ` on the executor path)
#### DoD
- [ ] integration green; GOAL both cases pass.

### T2.2 — Distroless isolated-vm live verification (D3)
#### Objective
Empirically confirm isolated-vm loads + a skill executes inside the distroless image with the env enabled.
#### Why this step (action + reasoning)
1. **What:** rebuild the image (HEAD), run it with `THEOMEM_SKILL_EXECUTION=true`, add+execute a skill via REST against the container, capture the result in the report.
2. **Why now:** closes the user's distroless concern with live evidence (D3); the unit/integration prove the wire, this proves the runtime.
#### Evidence
Live-test report (501 probe; isolated-vm@6.1.2 compiles in production-deps with toolchain).
#### Files to edit
```
.claude/knowledge-base/reviews/production-runtime-hardening-distroless-verify-2026-06-22.md (NEW — evidence)
```
#### Concurrency tests
(none — single-threaded)
#### TDD
```
RED:   (manual/live verification — recorded as evidence, not a vitest case)
GREEN: distroless container executes a skill → output captured
VERIFY: `curl ... /execute` returns the captured output (HTTP 200) against the distroless container
```
#### Acceptance Criteria
- [ ] the distroless container with `THEOMEM_SKILL_EXECUTION=true` returns `200` + captured output from `POST .../execute` (evidence recorded); OR, if isolated-vm fails to load, an HONEST `503` + a documented follow-up (no false success)
#### DoD
- [ ] evidence file written with the `curl` output + verdict.

---

## Phase 3: Build resilience + review of committed Docker fixes

### T3.1 — sharp/libvips build resilience (D4)
#### Objective
A transient libvips CDN failure must not abort the image build.
#### Why this step (action + reasoning)
1. **What:** wrap the install step(s) that pull native optionals with a bounded retry/backoff in the Dockerfile (e.g., a small retry loop around `pnpm install`), OR add an ADR documenting the `INCLUDE_OPTIONAL=false` deployment tradeoff if retry proves infeasible.
2. **Why now:** the user flagged it as a release risk; `sharp` is transitive via `@xenova` (the default local embedder) so removal is not an option (D4).
#### Evidence
`pnpm-lock.yaml:8` (`sharp ^0.33.5`), onlyBuiltDependencies; memory `themory-image-build-sharp-cdn`.
#### Files to edit
```
Dockerfile — bounded retry around the native-optional install
```
#### Concurrency tests
(none — single-threaded)
#### Failure scenarios note
libvips CDN 5xx/timeout → retry N times → then fail loud (never infinite); documented in `## Failure scenarios`.
#### TDD
```
RED:   (Dockerfile change — validated by a successful image build, not a vitest case)
GREEN: add the retry wrapper
VERIFY: `docker build -t themory-e2e:hardening -f Dockerfile .` exit 0
```
#### Acceptance Criteria
- [ ] `docker build -f Dockerfile .` exit 0 (image builds from HEAD)
- [ ] the retry is bounded (`grep` shows a finite attempt count, no infinite loop)
#### DoD
- [ ] image builds; retry is bounded + fails loud after the cap.

---

## Coverage Matrix
| # | Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Opt-in env + skillExecutor wire (default OFF) | T1.1 | resolver + lazy wire in wireMemoryFromPool |
| 2 | Default-preserving (env unset → 501 unchanged) | T1.1 + T2.1 | unit env-off + GOAL 501 case |
| 3 | GOAL: env on → execute returns output (real isolated-vm) | T2.1 | integration vs real pg + isolated-vm |
| 4 | Distroless isolated-vm load verified | T2.2 | live container evidence (D3) |
| 5 | Review covers committed isolated-vm pin + Docker toolchain | T3.1 + /review | folded into this cycle's review |
| 6 | sharp/libvips build resilience | T3.1 | bounded retry (D4) |
| 7 | Gateway episodes proxy | ADR D5 | DEFERRED to theo-cloud (cross-repo, documented) |
| 8 | EC-1 no-crash-on-boot when isolated-vm absent | T1.1 | constructor addon-free assertion + degrade to 503 |
| 9 | EC-2 env exact `'true'` only | T1.1 | resolver exact-match test |
| 10 | EC-3 blast radius (server+MCP+CLI) | T1.1 + D2 | single shared wire site |
| 11 | EC-4/5/6 documented behaviors | T1.1 + T3.1 + T2.2 | static import / bounded retry / container env |

**Coverage: 11/11 (100%)**

## Global Definition of Done
- [ ] All phases completed (`git log --oneline` shows T1.1→T3.1 commits)
- [ ] `npm test` (core+mcp) + `npm test -- agent-tools-memory` + agent-core suite exit 0
- [ ] `npm run typecheck` exit 0 (0 errors); `npm run lint` exit 0 (0 warnings)
- [ ] `npm run test:integration -- skill-execution-server-wiring` exit 0 vs real pgvector + real isolated-vm
- [ ] `docker build -f Dockerfile .` exit 0 (HEAD builds)
- [ ] Distroless live verification evidence recorded (T2.2)
- [ ] M1 regression intact — `npm run test:integration -- skill-execution-sandbox` exit 0
- [ ] CHANGELOG `[Unreleased]` updated (Rule 6)
- [ ] Default behavior byte-unchanged when `THEOMEM_SKILL_EXECUTION` unset (`git diff` review)
- [ ] No new dependency (`/deps-audit` PASS); no paper names in `src/**`
- [ ] `/code-quality` PASS (no dead exports; no fabricated symbols)

## Failure scenarios
| Dependency | Failure mode | How reproduced | Expected behavior |
|---|---|---|---|
| `isolated-vm` (native addon) | not loadable in distroless | T2.2 live container | typed `503 SkillExecutorUnavailable` (honest), NOT a crash; documented follow-up if it fires |
| libvips CDN (build) | 5xx/timeout during install | transient network | bounded retry then fail-loud (T3.1) — never infinite, never silent skip of a needed dep |
| `pg` (execute path) | DB error during skill resolve | integration | typed error → REST 5xx via central mapper |

## Final Phase: Integration Validation (MANDATORY)

### T4.1 — Full validation
```
npm test                                  # core+mcp contract
(agent-core) npm test -- agent-tools-memory
npm run typecheck && npm run lint
THEOMEM_PG_URI=... npm run test:integration -- skill-execution-server-wiring skill-execution-sandbox
docker build -f Dockerfile .              # HEAD builds
```
#### Concurrency tests
(none — single-threaded)
### Acceptance Criteria
- [ ] all suites green; M1 regression (`skill-execution-sandbox`) still 8/8
- [ ] `docker build` exit 0; distroless verification evidence present
- [ ] zero type errors; zero lint warnings
### If Validation Fails
1. Separate plan-caused vs pre-existing. 2. Fix plan-caused. 3. Re-run. 4. Log pre-existing in PR.
