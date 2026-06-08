---
slug: themory-mcp-bearer-by-env-faang
created_at: 2026-06-08
priority_classification: PRIORITY 0 hardening of sub-goal 3 (MCP available + reliable)
goal: Make themory mcp auto-select streamable-http+api-keys when THEMEMORY_API_KEY env is present
---

# Plan: themory mcp bearer-by-env (FAANG Mem0-DX uniformity)

> **Version 1.1** (2026-06-08) — Absorbed 2 MUST FIX from `/edge-case-plan` review at `knowledge-base/reviews/themory-mcp-bearer-by-env-faang-edge-cases-2026-06-08.md`: EC-1 (whitespace-only API key auto-flip) + EC-2 (`@internal`-annotation-only on exports leaks boundary). Plan v1.1 changes: (a) all env-presence checks now `.trim() !== ''` instead of `!== ''`; (b) replaced "export 2 helpers" with "export single `resolveMcpModes` wrapper" for cleaner private boundary.
>
> **Version 1.0** — Promote the already-shipped Item 20 streamable-http + `--auth=api-keys` path to be the default when `THEMEMORY_API_KEY` env is present, achieving Mem0-DX uniformity (one `theo_live_*` token across REST + MCP HTTP + Dashboard BFF) WITHOUT breaking the stdio-default path used by Claude Code's `.mcp.json` today. Pattern reference: env-presence-as-config-switch (industry pattern from major SDK vendors). Classified as PRIORITY 0 hardening of sub-goal 3 — no new feature; reorganization of shipped surface.

## Goal

> "Enable `themory mcp` operators to authenticate uniformly with a single `theo_live_*` bearer token across REST + MCP HTTP surfaces so that consumer DX matches industry-standard SDK auth pattern, measured by `tests/integration/agent-tools/env-driven-transport-selection.test.ts` PASS asserting `THEMEMORY_API_KEY` present + no `--transport` flag → `transport=streamable-http` + `auth=api-keys` selected, AND `tests/integration/agent-tools/env-driven-transport-selection.test.ts` PASS asserting env absent → stdio still wins (zero-regression on the 14/14 GREEN handlers suite)."

## Context

User session 2026-06-08 (Inquebrável Rule 1 directive): "Quero que voce corrija em nivel FAANG com a melhor experiencia para o USUARIO" → "Faça o que for mais FAANG, depois continuamos os tests, pense no sistema". The DX inconsistency surfaced during E2E testing of the data-loss fix (committed `f37aa44` earlier this session): consumer expected `theo_live_*` token to work uniformly the way a single API key works across most cloud-services SDKs, but TheMemory has 3 auth surfaces (REST=Bearer, MCP-stdio=scope-via-_meta, MCP-HTTP=Bearer-when-flagged) and only REST + MCP-HTTP-with-explicit-flag accept the token.

The architectural plumbing was already shipped 2026-06-07 by `theo-memory-faang-auth-lifecycle` (Item 20 of `ROADMAP.md`): `themory mcp --transport=streamable-http --auth=api-keys` works end-to-end against the `theo_api_keys` migration `0012` SHA-256 hash store. This plan does NOT add new capability — it makes that canonical FAANG path the **default-when-env-present**, leaving the stdio default intact for the embedded subprocess use case (Claude Code via `.mcp.json`).

After AskUserQuestion-style delegation in the session, the user picked Opção E (env-driven hybrid) over Opção C (breaking default change) and Opção D (additive subcommand). This plan implements Opção E.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `src/agent-tools/run-mcp-server.ts` | 225 | `f5cfcba` (2026-06-07) | MCP server composition root; holds `resolveTransport` + `resolveBearerAuth` precedence helpers extracted from `cli.ts` at T2.1 of `theo-memory-standalone-p0` | `RunMcpServerOptions` interface SHALL remain backward-compatible (the `auth`/`issuer`/`clientId` optional fields are public API consumed by Item 20 tests); existing stdio happy-path MUST stay no-op when `THEMEMORY_API_KEY` absent |
| `src/agent-tools/cli.ts` | 454 | `f5cfcba` (2026-06-07) | Commander entrypoint defining `themory mcp` flags + `themory keys` subcommands; LoC budget ≤ 500 per `architecture.md § Naming/file-size budget` | `--transport`, `--auth`, `--port`, `--host`, `--issuer`, `--client-id` flags MUST keep their current parser semantics; CHANGE intercepts flag absence only |
| `src/agent-tools/__tests__/run-mcp-server.test.ts` | 117 | (existing) | Vitest unit suite for `resolveTransport` precedence + composition root invariants | Existing 3+ tests stay GREEN; new tests append, not replace |
| `tests/integration/agent-tools/env-driven-transport-selection.test.ts` (NEW) | 0 | — | Integration test asserting the env-driven precedence matrix end-to-end | — |
| `README.md` | (large) | (varies) | Public consumer documentation; § Quickstart + § Configuration | `theo_live_*` Mem0-DX path documented as the recommended approach for external consumers; stdio path documented as embedded-only |
| `CHANGELOG.md` | (large) | `f37aa44` (2026-06-08) | Inquebrável Rule 6 contract | `[Unreleased] § Changed` gains the hardening entry |

### Current callers / dependents

For every public symbol modified:

- **Symbol:** `resolveTransport` (private to `run-mcp-server.ts`)
- **Callers (production):** `src/agent-tools/run-mcp-server.ts:121` (only callsite)
- **Callers (tests):** `src/agent-tools/__tests__/run-mcp-server.test.ts` (existing precedence tests)
- **External:** none (private function)

- **Symbol:** `RunMcpServerOptions.auth` (exported type field)
- **Callers (production):** `src/agent-tools/cli.ts:187` (commander action callback feeds it)
- **Callers (tests):** `src/agent-tools/__tests__/run-mcp-server.test.ts`, integration tests
- **External:** type is re-exported by `src/agent-tools/index.ts` → public surface; MUST stay backward-compatible (no field removal, only behavior change in the resolution)

- **Symbol:** `THEMEMORY_API_KEY` env var
- **Current reads (production):** `src/agent-tools/cli.ts:232` (read by `themory keys` admin commands for Bearer); `src/agent-tools/run-server.ts:190` (admin REST sub-app opt-in trigger)
- **Current writes (tests):** various test setups
- **External:** publicly-documented env; users may set it expecting REST behavior only — plan MUST be additive (presence enables HTTP MCP; absence preserves stdio)

### Domain glossary

- **streamable-http** — MCP transport over HTTP, supporting `Authorization: Bearer …` header; specified in MCP §6. Distinct from stdio (subprocess pipe).
- **theo_live_*** — Stripe-shape API key token format minted by `themory keys create`; SHA-256-hashed in `theo_api_keys` table; validated by `ApiKeyAuthVerifier` (12th DIP impl, shipped Item 20).
- **Camada 2 / Camada 3** — Stripe-shape multi-tenant lifecycle (Camada 2 = ApiKey) vs OIDC bridge (Camada 3); see ADR-0013/0014/0015.
- **Env-driven precedence** — flag > scoped env > general env presence > default. Industry pattern (env presence shifts behavior when explicit flag absent).
- **Princípio 3 (auditability)** — every IGNORE / silent-pivot decision MUST emit observable signal (stderr log here; OTel event when tracer wired).

### Architecture boundaries affected

Per `rules/architecture.md § 3 (Dependency direction — DIP)`:

- `src/agent-tools/` (composition root for the MCP CLI) imports from `src/core/` (contracts) and `src/local/` (default impls of MemoryStore/Embedder/LLM) — allowed by `rules/architecture.md § 3 (Dependency direction)` (agent-tools is the wiring locus per the upstream `theo-memory-standalone-p0-plan.md § ADRs D8`). This plan does NOT change that boundary; new helper `resolveAuthMode` lives in `src/agent-tools/run-mcp-server.ts` next to `resolveTransport`, both private to the composition root.
- No new public export. The behavioral shift is contained inside two private resolver helpers + one stderr log; the `RunMcpServerOptions` type stays additive (no new fields needed — semantics of existing fields when undefined become smarter).

## Prior Art & Related Work

- **Internal blueprint** — `theo-memory-faang-auth-lifecycle` plan + ADR-0013/0014/0015 (shipped 2026-06-07) — establishes `ApiKeyAuthVerifier` + `--auth=api-keys` mode. This plan REUSES that surface as-is.
- **Internal blueprint** — `theo-memory-faang-auth-lifecycle-fixes-cycle-1` plan (shipped 2026-06-07) — closes 2 honest deferrals from the parent cycle; F-arch-2 fix establishes the "only invoke resolveOidcConfig when mode actually selected" precedent — same conditional-evaluation discipline applied here.
- **Internal rule** — `.claude/rules/no-paper-names-in-code.md` (promoted 2026-05-30) — banned tokens MUST NOT appear in `src/**`; pattern references are documented here in the plan, not in code.
- **Project pattern** — `src/agent-tools/run-mcp-server.ts:84-89` `resolveTransport` already implements 2-tier precedence (flag → env → default); this plan extends to 3-tier (flag → scoped env → presence-heuristic env → default).
- **External pattern reference** — env-presence-as-config-switch is a widely-deployed SDK pattern in cloud-infra tooling (vendor SDKs across multiple major cloud services use the same shape). No code copied; only the precedence semantics are mirrored.
- **External standard** — MCP §6 streamable-http transport spec — already implemented at `src/agent-tools/transports/streamable-http.ts`. Not modified by this plan.

## Objective

- [ ] Sub-goal 1 — `themory mcp` with `THEMEMORY_API_KEY` env set + no `--transport` flag selects `streamable-http` transport (verified by RED test T1.1).
- [ ] Sub-goal 2 — `themory mcp` with `THEMEMORY_API_KEY` env set + no `--auth` flag + no `THEOMEM_MCP_AUTH` env auto-selects `api-keys` auth mode (verified by RED test T1.1 second assertion).
- [ ] Sub-goal 3 — `themory mcp` WITHOUT `THEMEMORY_API_KEY` env preserves current stdio default exactly (zero regression — verified by T1.1 env-absent path).
- [ ] Sub-goal 4 — Explicit `--transport=stdio` flag with `THEMEMORY_API_KEY` env set still selects stdio (flag wins; verified by T1.2).
- [ ] Sub-goal 5 — When env-driven path activates, `themory mcp` emits stderr disclosure log (verified by T3.1 stderr-capture assertion).
- [ ] Sub-goal 6 — Documentation (`README.md` + `CHANGELOG.md`) reflects the new default-when-env behavior; consumer guide shows `.mcp.json` template with `THEMEMORY_API_KEY` for Mem0-DX path.

## ADRs

### D1 — Three-tier precedence: flag > scoped env > presence-heuristic env > default

- **Decision** — `resolveTransport` precedence becomes: (1) `--transport` flag if explicitly passed; (2) `THEOMEM_MCP_TRANSPORT` env if set to `stdio`/`streamable-http`; (3) `THEMEMORY_API_KEY` env presence (non-empty) → `streamable-http`; (4) fallback `stdio`.
- **Rationale** — most-specific intent wins. CLI flag is the operator's direct utterance; scoped env (`THEOMEM_MCP_TRANSPORT`) is config; `THEMEMORY_API_KEY` is a heuristic ("you have a token; you probably want HTTP+Bearer"). The order honors KISS and avoids the failure mode where setting an unrelated env silently flips behavior under an explicit operator override. See `.claude/rules/architecture.md` and Inquebrável Rule 1 (operator explicit > heuristic).
- **Alternatives considered**:
  - (B) Flag-only — REJECTED: doesn't achieve the Mem0-DX uniformity the directive asked for; consumers would still need to type `--transport=streamable-http` every time they want Bearer.
  - (C) Env-only (drop flag respect) — REJECTED: breaks Item 20 contract; operators who configured `--transport` explicitly would suddenly be overridden by env presence.
  - (D) Require BOTH `THEMEMORY_API_KEY` AND `THEOMEM_MCP_HTTP_HOST` for env-driven trigger — REJECTED initially but ESCALATED to R4 risk — see Drawbacks; `/edge-case-plan` should re-evaluate.
- **Consequences** — Enables Mem0-DX uniformity by default. Constrains: any future env that hints at HTTP behavior (e.g., `THEMEMORY_REST_PORT`) MUST NOT also flip MCP — heuristic stays narrow.

### D2 — When env-driven HTTP path activates, auth mode auto-selects `api-keys` (NOT `none`)

- **Decision** — When precedence Tier-3 (`THEMEMORY_API_KEY` presence) triggers `streamable-http` AND `--auth` flag is absent AND `THEOMEM_MCP_AUTH` env is absent, auto-set `auth='api-keys'`. Mirror precedence for auth: flag > `THEOMEM_MCP_AUTH` env > `THEMEMORY_API_KEY`-presence heuristic > `none`.
- **Rationale** — Env presence signals operator intent to use Bearer auth; falling back to `none` would be a security regression (token present, ignored, server runs open). Princípio 3 (auditability) requires the decision is observable (ADR D3 covers stderr disclosure).
- **Alternatives considered**:
  - (B) Always `none` regardless of env — REJECTED: silent security downgrade; defeats the purpose of the env presence heuristic.
  - (C) `both` (api-keys + OIDC) — REJECTED: requires `--issuer` config that env-driven path cannot infer; would crash at boot per Item 20 ADR D3 fail-loud contract.
- **Consequences** — Enables uniform Bearer auth automatically. Constrains: operators wanting `--auth=none` on MCP HTTP with `THEMEMORY_API_KEY` set MUST pass `--auth=none` explicitly (flag wins per D1). Documented as the explicit-opt-out path.

### D3 — Stderr disclosure log of selection decision

- **Decision** — `themory mcp` MUST emit ONE of these stderr lines at INFO level immediately after `resolveTransport` + `resolveAuthMode` decide:
  - When env-driven HTTP path activates: `themory mcp: transport auto-selected streamable-http + auth=api-keys (THEMEMORY_API_KEY present; pass --transport=stdio to override).`
  - When stdio default selected: `themory mcp: transport=stdio (default; set THEMEMORY_API_KEY for HTTP+Bearer mode).`
  - When explicit flags win: (no extra line — current behavior unchanged).
- **Rationale** — Inquebrável Rule 3 (extreme honesty) + Princípio 3 (auditability — every IGNORE/pivot decision observable). Without the log, operators have no way to debug "why is my server binding port instead of stdio?".
- **Alternatives considered**:
  - (B) Silent — REJECTED: surprise behavior; consumers can't diagnose without DEBUG flag.
  - (C) OTel-only — REJECTED: local dev typically has no OTel exporter wired (most consumers will run without `OTEL_*` env); stderr is universally observable.
- **Consequences** — Adds 1-2 lines of stderr noise on every startup. Acceptable: stderr already has the "MCP transport: real providers wired" line from Item 20 hardening; one more line is consistent with existing operator-visibility discipline.

### D4 — Default port stays `THEOMEM_MCP_HTTP_PORT` env-or-8080; conflict detection deferred

- **Decision** — When env-driven HTTP path activates, port resolves via existing `resolvePort` (env `THEOMEM_MCP_HTTP_PORT` OR 8080). DO NOT auto-detect REST-server-on-8080 conflict in this cycle.
- **Rationale** — Conflict detection is non-trivial (TCP probe, race conditions, etc.) and adds blast radius beyond hardening. Existing `resolvePort` fails loud on port-in-use via OS-level `EADDRINUSE`, which is sufficient diagnostic for an operator. Documented in T5.1 README guidance to set `THEOMEM_MCP_HTTP_PORT=8081` when running alongside `themory server`.
- **Alternatives considered**:
  - (B) Default to 8081 to dodge REST conflict — REJECTED: breaks Item 20 contract (8080 is the documented default).
  - (C) Probe port before bind, auto-shift +1 if occupied — REJECTED: race condition (port could be occupied between probe and bind); silent port migration violates Princípio 3.
- **Consequences** — Operator must explicitly set `THEOMEM_MCP_HTTP_PORT` when running BOTH `themory server` AND env-driven `themory mcp` on the same host. Documented in README + CHANGELOG. Follow-up cycle may add conflict-detect via `THEOMEM_MCP_HTTP_PORT_PROBE=1` opt-in flag.

### D5 — `.mcp.json` migration: documentation-only; never auto-edit user config

- **Decision** — Plan does NOT auto-edit any `.mcp.json` file in the repo root or anywhere else. T5.1 publishes a recommended `.mcp.json` template in `README.md § Quickstart` for new Mem0-DX consumers; existing consumers keep working unchanged because env-absent path preserves stdio default.
- **Rationale** — Inquebrável Rule 1 (95% confidence + present options) + Rule 4 (never destructive without explicit operator OK). Auto-editing `.mcp.json` would surprise operators who tuned it manually.
- **Alternatives considered**:
  - (B) Auto-patch `.mcp.json` if found at repo root + `THEMEMORY_API_KEY` declared in env block — REJECTED: surprise edits violate Rule 1.
  - (C) Ship a `themory mcp init-config` subcommand that prints the recommended JSON — DEFERRED to follow-up (out of scope for hardening; that's a new feature).
- **Consequences** — Documentation must be excellent. README change in T5.1 is load-bearing.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| **R1 — Port conflict with `themory server` (both default 8080)** | Medium | ADR D4 punts to operator via `THEOMEM_MCP_HTTP_PORT` env; documented in T5.1 README; OS-level `EADDRINUSE` fail-loud guarantees no silent corruption | Implementer |
| **R2 — Operator confusion: setting `THEMEMORY_API_KEY` for REST server also shifts MCP behavior** | Medium | ADR D3 stderr disclosure log makes the auto-selection visible; T5.1 README documents the precedence + escape hatch (`--transport=stdio` flag) | Implementer |
| **R3 — Security: env-driven path with `--auth=api-keys` requires PG to validate; if PG unavailable at MCP boot, server crashes loudly** | Low | Already covered by Item 20 EC absorption (fail-fast on unreachable PG); re-verify in T6.1 smoke (PG-up vs PG-down) | Implementer |
| **R4 — `.mcp.json` of existing Claude Code consumers: if a consumer adds `THEMEMORY_API_KEY` to their env block intending REST-only behavior, MCP stdio AUTO-FLIPS to HTTP and they have no port-forward set up (server tries to bind 8080 which is occupied by their REST server)** | High | T5.1 README has a "DO NOT add `THEMEMORY_API_KEY` to `.mcp.json` env block unless you intend HTTP mode" warning; `/edge-case-plan` MUST add a MUST-FIX: T2.2 SHOULD detect "stdio expected but HTTP triggered" via a SECONDARY env `THEMEMORY_MCP_AUTO_HTTP=0` opt-out for legacy stdio consumers | Implementer + /edge-case-plan |
| **R5 — Test isolation: enabling env-driven path in test suite would auto-trigger HTTP mode in unrelated tests** | Medium | All tests SHALL pass options object EXPLICITLY (do not rely on env) OR use `vi.unstubAllEnvs()` discipline; T4.1 audits and adds `delete process.env.THEMEMORY_API_KEY` in `beforeEach` of MCP-test files where needed | Implementer |
| **R6 — PRIORITY 0 classification challenged at /review** | Low | Commit body MUST cite the 4 rationale points (a)-(d) per CLAUDE.md § PRIORITY 0 § What CONTINUES; rationale already vetted at plan-time | Implementer + reviewer |

## Unresolved Questions

- Q1 — Should the env-driven path require BOTH `THEMEMORY_API_KEY` AND `THEOMEM_MCP_HTTP_HOST` to be present, as a "double-opt-in" safety check against R4? Resolved by `/edge-case-plan` (EC-7): NO — stderr disclosure (ADR D3) + README warning (T5.1) is the right gate; double-opt-in cost > benefit.
- Q2 — Should T5.1 README also publish a `themory mcp doctor` diagnostic subcommand that prints the resolved precedence + selected transport + auth (to help operators see what's happening)? Out of scope for this hardening cycle; tracked as follow-up.
- Q3 — Should the stderr disclosure log (ADR D3) be suppressible via `THEOMEM_MCP_QUIET=1` for embedded use cases where stderr is captured? Resolved by `/edge-case-plan` (EC-6): YES — added to T3.1 with `THEOMEM_MCP_QUIET=1` env opt-out.

## Dependency Graph

```
Phase 1 (TDD RED) ──▶ Phase 2 (GREEN minimal) ──▶ Phase 3 (Observability) ──▶ Phase 4 (Unit matrix)
                                                                                       │
                                                                                       ▼
                                                                              Phase 5 (Docs + CHANGELOG)
                                                                                       │
                                                                                       ▼
                                                                              Phase 6 (Integration validation)
```

Phases 1→2→3→4 are sequential (TDD discipline). Phase 5 docs can start in parallel with Phase 4 unit tests. Phase 6 is the final gate.

---

## Phase 1: TDD RED — failing integration tests for precedence matrix

**Objective:** Lock the env-driven precedence contract via integration tests that fail before any code change.

### T1.1 — RED: env-present → http+api-keys; env-absent → stdio

#### Objective
Assert that `themory mcp` (no flags) selects `streamable-http` + `auth=api-keys` when `THEMEMORY_API_KEY` env is set, AND selects `stdio` when env absent.

#### Why this step (action + reasoning — ReAct discipline)

**What this step does** — Creates the integration test file `tests/integration/agent-tools/env-driven-transport-selection.test.ts` with 4 assertions: (a) env-present + no flags → `transport === 'streamable-http'`; (b) env-present + no flags → `auth === 'api-keys'`; (c) env-absent → `transport === 'stdio'`; (d) env-absent → no `auth` mode is configured (current behavior — `auth` undefined). The test exercises `runMcpServer` with mocked transport connect functions (we don't actually bind a port in unit tests).

**Why it is necessary now** — Per ADR D1 + D2 and Inquebrável Rule 5 (TDD), this contract must be locked in a failing test BEFORE T2.1/T2.2 write the implementation. Without RED-first, the implementation may drift from the stated precedence. The integration test path is necessary because `resolveTransport` + `resolveAuthMode` are private to `run-mcp-server.ts`; observing the effect requires running the composition root with mocked side-effects (no real port bind, no real PG connect — test uses dependency injection of `wireMemoryFromPool` mock).

#### Evidence
- `src/agent-tools/run-mcp-server.ts:84-89` — current 2-tier `resolveTransport` (flag → `THEOMEM_MCP_TRANSPORT` env → default 'stdio'). This is the surface to extend.
- `src/agent-tools/__tests__/run-mcp-server.test.ts:15` — existing pattern: "env normalizes to the `'stdio'` default branch in `resolveTransport`" — provides test scaffolding precedent.
- `src/agent-tools/cli.ts:232` — `process.env['THEMEMORY_API_KEY']` already read by `themory keys` admin commands; this plan reuses the same env key for the new presence-heuristic.

#### Files to edit
```
tests/integration/agent-tools/env-driven-transport-selection.test.ts — RED test (NEW)
```

#### Deep file dependency analysis
- `tests/integration/agent-tools/env-driven-transport-selection.test.ts (NEW)` — new file under existing `tests/integration/agent-tools/` directory; vitest config picks it up via `vitest.contract.config.ts` glob; no config change needed (verified — repo runs all `tests/integration/**/*.test.ts` via `npm test`).

#### Deep Dives

- **Data structures**: assertion shape — capture the resolved options inside `runMcpServer` via spy on `connectStreamableHttp` / `connectStdio` to observe which transport was called.
- **Algorithms**: tests use `vi.stubEnv('THEMEMORY_API_KEY', 'theo_live_dummy')` + `vi.unstubAllEnvs()` discipline. Each `it()` block restores env state.
- **Invariants**: when env absent, `connectStdio` is called exactly once and `connectStreamableHttp` zero times; when env present, the inverse — AND the `bearerAuth.apiKey` field of the options passed to `connectStreamableHttp` is an instance of `ApiKeyAuthVerifier` (or, in mocked-PG mode, an object satisfying its shape).
- **Edge cases**: empty string `THEMEMORY_API_KEY=""` is treated as ABSENT (Princípio 3 honest disclosure — empty token is operator error, not intent). Tested explicitly.

#### Pseudo-code / Signatures

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as transportsStdio from '../../../src/agent-tools/transports/stdio.js';
import * as transportsHttp from '../../../src/agent-tools/transports/streamable-http.js';

describe('themory mcp — env-driven transport selection (T1.1)', () => {
  let connectStdioSpy: any;
  let connectHttpSpy: any;
  beforeEach(() => {
    connectStdioSpy = vi.spyOn(transportsStdio, 'connectStdio').mockResolvedValue(undefined as any);
    connectHttpSpy = vi.spyOn(transportsHttp, 'connectStreamableHttp').mockResolvedValue(undefined as any);
    // Strip env so each test sets exactly what it needs:
    vi.stubEnv('THEMEMORY_API_KEY', '');
    vi.stubEnv('THEOMEM_MCP_TRANSPORT', '');
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it('THEMEMORY_API_KEY set + no flags → streamable-http + auth=api-keys', async () => {
    vi.stubEnv('THEMEMORY_API_KEY', 'theo_live_dummytoken');
    await runMcpServer({});
    expect(connectHttpSpy).toHaveBeenCalledOnce();
    expect(connectStdioSpy).not.toHaveBeenCalled();
    const [, opts] = connectHttpSpy.mock.calls[0];
    expect(opts.bearerAuth?.apiKey).toBeDefined();   // ApiKeyAuthVerifier wired
  });

  it('THEMEMORY_API_KEY absent → stdio (current default preserved)', async () => {
    // env unset by beforeEach
    await runMcpServer({});
    expect(connectStdioSpy).toHaveBeenCalledOnce();
    expect(connectHttpSpy).not.toHaveBeenCalled();
  });

  it('THEMEMORY_API_KEY="" (empty) → treated as absent → stdio', async () => {
    vi.stubEnv('THEMEMORY_API_KEY', '');
    await runMcpServer({});
    expect(connectStdioSpy).toHaveBeenCalledOnce();
  });
});
```

#### Tasks
1. Create `tests/integration/agent-tools/env-driven-transport-selection.test.ts` with the 4 assertions above.
2. Run `npm test -- env-driven-transport-selection` — confirm all 4 FAIL with `connectHttpSpy.not.toHaveBeenCalled()` (because current code always picks stdio when no flag).

#### TDD
```
RED:     test_themory_api_key_set_no_flags_selects_streamable_http_plus_api_keys — asserts http path + ApiKeyAuthVerifier wired
RED:     test_themory_api_key_absent_preserves_stdio_default — asserts stdio path unchanged
RED:     test_themory_api_key_empty_string_treated_as_absent — asserts "" is operator-typo-safe
RED:     test_themory_api_key_set_no_flags_auth_mode_is_api_keys — explicit auth assertion (D2)
GREEN:   (deferred to T2.1 + T2.2)
REFACTOR: None expected in this task
VERIFY:  npm test -- env-driven-transport-selection
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] File `tests/integration/agent-tools/env-driven-transport-selection.test.ts` exists.
- [ ] All 4 tests FAIL when run against `develop` (RED phase contract).
- [ ] No production code change in this task.
- [ ] Pass: lint — `npm run lint` zero warnings on the new file.
- [ ] Pass: size — new file ≤ 200 lines.

#### DoD
- [ ] All 4 RED tests written and validated to FAIL.
- [ ] Commit: `test(mcp): RED — env-driven transport precedence (T1.1)` with PRIORITY 0 classification body.
- [ ] Zero lint warnings on new file.

---

### T1.2 — RED: `--transport=stdio` flag with env set still wins

#### Objective
Lock ADR D1 precedence: explicit `--transport=stdio` flag wins over `THEMEMORY_API_KEY` env presence.

#### Why this step

**What this step does** — Adds a 5th test in `env-driven-transport-selection.test.ts`: `--transport=stdio` passed explicitly + `THEMEMORY_API_KEY` set → `connectStdio` called, `connectStreamableHttp` not called.

**Why it is necessary now** — Without this test, T2.1 could implement env-presence as Tier-1 (winning over flag) and accidentally break operators who relied on `--transport=stdio` to opt out. The test locks the precedence direction.

#### Evidence
- ADR D1 precedence rule: flag > scoped env > presence-heuristic > default.
- `src/agent-tools/run-mcp-server.ts:85` — current behavior: `if (opt !== undefined) return opt;` is Tier-1 and must remain.

#### Files to edit
```
tests/integration/agent-tools/env-driven-transport-selection.test.ts — append 5th test (NEW file from T1.1)
```

#### Deep file dependency analysis
Same as T1.1 — extends the test file with one more `it()` block.

#### Deep Dives
- **Invariant**: flag absence ≠ flag undefined-from-typo. CLI parser (commander) only fills the field when the flag is passed; otherwise `opts.transport` is `undefined`. The test passes `{ transport: 'stdio' }` to `runMcpServer` directly (bypassing commander).

#### Pseudo-code

```typescript
it('explicit --transport=stdio + THEMEMORY_API_KEY set → stdio wins (ADR D1)', async () => {
  vi.stubEnv('THEMEMORY_API_KEY', 'theo_live_dummytoken');
  await runMcpServer({ transport: 'stdio' });
  expect(connectStdioSpy).toHaveBeenCalledOnce();
  expect(connectHttpSpy).not.toHaveBeenCalled();
});
```

#### Tasks
1. Append the 5th test to T1.1's file.
2. Run `npm test -- env-driven-transport-selection` — assert this test PASSES (current `resolveTransport` already honors the flag Tier-1, so it's a regression-guard test).

#### TDD
```
GREEN: This test passes against current code — it locks the existing Tier-1 behavior.
       (It is a "regression-guard" test, not a "fails-then-fixed" test. Documented as such.)
VERIFY: npm test -- env-driven-transport-selection
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] 5th test exists and PASSES on `develop` before T2.1/T2.2 change anything.
- [ ] Comment in test body explains: "regression guard for ADR D1 Tier-1 precedence".

#### DoD
- [ ] Test merged into the same commit as T1.1.

---

## Phase 2: GREEN — extend resolveTransport + introduce resolveAuthMode

### T2.1 — GREEN: extend `resolveTransport` with Tier-3 `THEMEMORY_API_KEY`-presence heuristic

#### Objective
Make T1.1's first + third RED tests GREEN by extending `resolveTransport` to consult `THEMEMORY_API_KEY` env presence as Tier-3 fallback.

#### Why this step

**What this step does** — Modifies `resolveTransport` in `src/agent-tools/run-mcp-server.ts:84-89` from 2-tier to 3-tier precedence: (1) flag; (2) `THEOMEM_MCP_TRANSPORT` env; (3) non-empty `THEMEMORY_API_KEY` env → `streamable-http`; (4) `stdio`.

**Why it is necessary now** — Per ADR D1 + RED tests from T1.1, the resolver must honor env presence as a heuristic. KISS: one extra `if` block; no new abstraction.

#### Evidence
- `src/agent-tools/run-mcp-server.ts:84-89` — current implementation (Tier-1 + Tier-2 + default).
- `src/agent-tools/cli.ts:232` — `process.env['THEMEMORY_API_KEY']` precedent for reading the env.

#### Files to edit
```
src/agent-tools/run-mcp-server.ts — extend resolveTransport
```

#### Deep file dependency analysis
- `src/agent-tools/run-mcp-server.ts` (225 LoC today) — extends `resolveTransport` (≤ 8 LoC added). LoC budget 500 per `architecture.md` § file-size budget: NEW total ~232 LoC, well under.
- `runMcpServer` (line 121 callsite) — no signature change; behavior shift transparent to callers.

#### Deep Dives
- **Invariant preserved**: when `opt` is passed (Tier-1) OR `THEOMEM_MCP_TRANSPORT` is `'stdio'` (Tier-2), the existing behavior is unchanged.
- **New behavior**: when both Tier-1 and Tier-2 are unset, AND `process.env['THEMEMORY_API_KEY']` is non-empty string, return `'streamable-http'`. Otherwise `'stdio'`.
- **Edge case**: empty string `""` is treated as absent (per T1.1 third test). Check: `apiKey !== undefined && apiKey !== ''`.

#### Pseudo-code

```typescript
// v1.1 EC-1 absorption — `.trim()` honors operator-typo discipline.
function resolveTransport(opt?: RunMcpServerOptions['transport']): 'stdio' | 'streamable-http' {
  if (opt !== undefined) return opt;                                    // Tier-1
  const envValue = process.env['THEOMEM_MCP_TRANSPORT'];
  if (envValue === 'streamable-http' || envValue === 'stdio') return envValue;  // Tier-2
  const apiKey = process.env['THEMEMORY_API_KEY'];                      // Tier-3 NEW
  if (apiKey !== undefined && apiKey.trim() !== '') return 'streamable-http';
  return 'stdio';                                                       // Tier-4 default
}
```

#### Tasks
1. Add Tier-3 block to `resolveTransport` (≤ 8 LoC).
2. Run `npm test -- env-driven-transport-selection` — assert tests 1, 2, 3 PASS (test 4 still RED until T2.2 — auth-mode resolution).

#### TDD
```
GREEN: test_themory_api_key_set_no_flags_selects_streamable_http — passes
GREEN: test_themory_api_key_absent_preserves_stdio_default — still passes
GREEN: test_themory_api_key_empty_string_treated_as_absent — passes
RED:   test_themory_api_key_set_no_flags_auth_mode_is_api_keys — still RED (T2.2 handles)
REFACTOR: None expected
VERIFY:  npm test -- env-driven-transport-selection && npm run typecheck
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] T1.1 tests 1/2/3 PASS; test 4 still RED.
- [ ] T1.2 still PASSES (regression guard intact).
- [ ] Pass: typecheck — `npm run typecheck` zero errors.
- [ ] Pass: lint — `npm run lint` zero warnings.
- [ ] Pass: size — `src/agent-tools/run-mcp-server.ts` ≤ 240 LoC.

#### DoD
- [ ] Function modified, tests passing, lint clean.
- [ ] Commit: `feat(mcp): resolveTransport Tier-3 THEMEMORY_API_KEY heuristic (T2.1)` with PRIORITY 0 body.

---

### T2.2 — GREEN: introduce `resolveAuthMode` + plumb through runMcpServer

#### Objective
Make T1.1 test 4 GREEN by introducing a new `resolveAuthMode` helper that mirrors `resolveTransport` precedence and auto-selects `'api-keys'` when env-driven HTTP path activates.

#### Why this step

**What this step does** — Adds `resolveAuthMode(opt, transport)` private helper next to `resolveTransport`. Precedence: (1) explicit `opt.auth` flag; (2) `THEOMEM_MCP_AUTH` env; (3) when `transport === 'streamable-http'` AND `THEMEMORY_API_KEY` env present → `'api-keys'`; (4) default `'none'`. Wires the resolved value into the `auth` parameter of `resolveBearerAuth` (line 163).

**Why it is necessary now** — Per ADR D2, env-driven HTTP path must auto-enable Bearer auth (`api-keys`); otherwise a token sits in env unused (security regression). The helper must be invoked AFTER `resolveTransport` because Tier-3 depends on the resolved transport.

#### Evidence
- `src/agent-tools/run-mcp-server.ts:163` — `resolveBearerAuth(options?.auth, ...)` is the consumer; currently receives raw `options?.auth` which is `undefined` when no flag passed.
- ADR D2 — security-regression rationale.

#### Files to edit
```
src/agent-tools/run-mcp-server.ts — add resolveAuthMode helper + invoke at line 121-122 area
```

#### Deep file dependency analysis
- `src/agent-tools/run-mcp-server.ts` — adds ~15 LoC (`resolveAuthMode` body + one callsite change). New total ~247 LoC, still under budget.
- `resolveBearerAuth` (existing, line 190) — no change to its body; receives the auto-resolved mode through the same parameter.

#### Deep Dives
- **Mirror of `resolveTransport`**: same 4-tier shape for symmetry + readability.
- **Tier-3 condition**: `transport === 'streamable-http' && THEMEMORY_API_KEY non-empty`. We DO check transport because: if operator explicitly set `--transport=stdio` but ALSO set `THEMEMORY_API_KEY` (perhaps for `themory keys` admin commands sharing the same env), we MUST NOT inject `api-keys` auth into a stdio session that doesn't use it.
- **Edge case**: `THEOMEM_MCP_AUTH=none` env wins over Tier-3 heuristic (operator explicit opt-out).

#### Pseudo-code

```typescript
function resolveAuthMode(
  opt: RunMcpServerOptions['auth'],
  transport: 'stdio' | 'streamable-http',
): 'none' | 'api-keys' | 'oidc' | 'both' {
  if (opt !== undefined) return opt;                                          // Tier-1
  const envValue = process.env['THEOMEM_MCP_AUTH'];
  if (envValue === 'none' || envValue === 'api-keys' ||
      envValue === 'oidc' || envValue === 'both') {
    return envValue;                                                          // Tier-2
  }
  if (transport === 'streamable-http') {
    const apiKey = process.env['THEMEMORY_API_KEY'];
    // v1.1 EC-1 absorption — symmetric `.trim()` with resolveTransport.
    if (apiKey !== undefined && apiKey.trim() !== '') return 'api-keys';      // Tier-3
  }
  return 'none';                                                              // Tier-4 default
}

// v1.1 EC-2 absorption — single export instead of two `@internal`-annotated helpers.
// Wraps the two private helpers in one composable export; tests import THIS, not the
// individual resolvers (which stay module-private and can be refactored freely).
/** @internal — for unit testing only; production callers go through runMcpServer. */
export function resolveMcpModes(
  opt: Pick<RunMcpServerOptions, 'transport' | 'auth'>,
): { transport: 'stdio' | 'streamable-http'; auth: 'none' | 'api-keys' | 'oidc' | 'both' } {
  const transport = resolveTransport(opt.transport);
  const auth = resolveAuthMode(opt.auth, transport);
  return { transport, auth };
}

// In runMcpServer:
const transport = resolveTransport(options?.transport);
const authMode = resolveAuthMode(options?.auth, transport);
// ... pass authMode to resolveBearerAuth instead of options?.auth ...
```

#### Tasks
1. Add `resolveAuthMode` helper below `resolveTransport`.
2. Replace `resolveBearerAuth(options?.auth, ...)` call with `resolveBearerAuth(authMode, ...)` at line 163.
3. Run `npm test -- env-driven-transport-selection` — all 5 tests PASS.
4. Run `npm test` — full contract suite (1171 tests) zero regression.

#### TDD
```
GREEN: test_themory_api_key_set_no_flags_auth_mode_is_api_keys — passes
REGRESSION-GUARD: full contract suite stays green (150/150 files)
REFACTOR: None expected
VERIFY:  npm test -- env-driven-transport-selection && npm test && npm run typecheck
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] All 5 tests in `env-driven-transport-selection.test.ts` PASS.
- [ ] Full `npm test` suite 1171/1171 PASS (zero regression on `handlers.test.ts`'s 14/14).
- [ ] Pass: typecheck zero errors; lint zero warnings.
- [ ] Pass: size — `run-mcp-server.ts` ≤ 250 LoC.

#### DoD
- [ ] Function added, callsite updated, all tests pass.
- [ ] Commit: `feat(mcp): resolveAuthMode auto-api-keys when env-driven HTTP (T2.2)` with PRIORITY 0 body.

---

## Phase 3: Observability — stderr disclosure log

### T3.1 — GREEN: emit stderr disclosure of transport + auth decision

#### Objective
Add a one-line `process.stderr.write` immediately after the two resolvers in `runMcpServer`, disclosing the selected transport + auth mode (per ADR D3).

#### Why this step

**What this step does** — Adds 4-6 LoC: one `process.stderr.write(...)` call at line 122 area, distinguishing 3 cases (env-driven HTTP active / stdio default with hint / explicit flags — silent).

**Why it is necessary now** — Princípio 3 (auditability) + Inquebrável Rule 3 (honest disclosure). Without this log, operators encountering "port 8080 already in use" on a stdio-spawned subprocess can't diagnose why MCP tried to bind a port.

#### Evidence
- `src/agent-tools/run-mcp-server.ts:130-132` — existing precedent: `process.stderr.write("themory mcp: real providers wired — LocalTransformerEmbedder ...")` — same stderr-channel discipline.
- ADR D3.

#### Files to edit
```
src/agent-tools/run-mcp-server.ts — add stderr disclosure after resolveAuthMode call
src/agent-tools/__tests__/run-mcp-server.test.ts — add stderr-capture assertion
```

#### Deep file dependency analysis
- `src/agent-tools/run-mcp-server.ts` — adds ~10 LoC of disclosure-emission logic.
- `src/agent-tools/__tests__/run-mcp-server.test.ts` (117 LoC today) — adds 2 tests asserting the stderr line content; pattern matches existing test style.

#### Deep Dives
- **Three messages**:
  - Env-driven HTTP: `themory mcp: transport=streamable-http + auth=api-keys (THEMEMORY_API_KEY present; pass --transport=stdio to override).`
  - Stdio default with hint: `themory mcp: transport=stdio (default; set THEMEMORY_API_KEY for HTTP+Bearer mode).`
  - Explicit flag passed by operator (transport OR auth flag was set explicitly): no extra line.
- **How to detect "explicit flag passed"**: `options?.transport !== undefined || options?.auth !== undefined || process.env['THEOMEM_MCP_TRANSPORT'] !== undefined || process.env['THEOMEM_MCP_AUTH'] !== undefined`. If any of those, operator was explicit — don't add the suggestion line.

#### Pseudo-code

```typescript
const transport = resolveTransport(options?.transport);
const authMode = resolveAuthMode(options?.auth, transport);

const wasExplicit =
  options?.transport !== undefined ||
  options?.auth !== undefined ||
  process.env['THEOMEM_MCP_TRANSPORT'] !== undefined ||
  process.env['THEOMEM_MCP_AUTH'] !== undefined;

// v1.1 EC-6 absorption — operator-opt-out for test ergonomics + embedded use.
const quiet = process.env['THEOMEM_MCP_QUIET'] === '1';

if (!wasExplicit && !quiet) {
  if (transport === 'streamable-http' && authMode === 'api-keys') {
    process.stderr.write(
      'themory mcp: transport=streamable-http + auth=api-keys (THEMEMORY_API_KEY present; pass --transport=stdio to override).\n',
    );
  } else if (transport === 'stdio') {
    process.stderr.write(
      'themory mcp: transport=stdio (default; set THEMEMORY_API_KEY for HTTP+Bearer mode).\n',
    );
  }
}
```

#### Tasks
1. Add disclosure-emission block.
2. Add 2 RED unit tests in `run-mcp-server.test.ts` (existing precedence-test file) — one for each disclosure variant. Use `vi.spyOn(process.stderr, 'write')` to capture.
3. Make GREEN via the implementation above.

#### TDD
```
RED:    test_stderr_discloses_env_driven_http_path_when_no_explicit_flag — captures stderr; asserts string content
RED:    test_stderr_discloses_stdio_default_with_hint — captures stderr; asserts hint message
GREEN:  Implement the disclosure block.
VERIFY: npm test -- run-mcp-server
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] Both stderr-capture tests PASS.
- [ ] No new test fails.
- [ ] Pass: lint + typecheck + size.

#### DoD
- [ ] Disclosure block + 2 tests merged; commit: `feat(mcp): stderr disclosure of env-driven transport selection (T3.1)`.

---

## Phase 4: Unit test matrix — precedence locked

### T4.1 — Unit tests: 12-cell precedence matrix for resolveTransport + resolveAuthMode

#### Objective
Lock the full precedence matrix in unit tests against the two private helpers, so any future change touching them MUST update the matrix (regression guard).

#### Why this step

**What this step does** — Adds a `describe('resolveTransport + resolveAuthMode precedence matrix')` block to `src/agent-tools/__tests__/run-mcp-server.test.ts` with 12 unit test cases (3 flag states × 2 transport-env states × 2 api-key-env states = 12 combinations).

**Why it is necessary now** — Integration tests T1.1/T1.2 cover the high-level effects but not every cell of the precedence matrix. Unit tests on the private helpers catch regressions cheaper than integration tests. Mirror of `verbs-as-cli-fixes-cycle-2 T3.3` precedent (sentinel-style regression locking).

#### Evidence
- ADR D1 + D2 precedence rules.
- Existing test file `src/agent-tools/__tests__/run-mcp-server.test.ts` has the pattern.

#### Files to edit
```
src/agent-tools/__tests__/run-mcp-server.test.ts — append precedence-matrix describe block
src/agent-tools/run-mcp-server.ts — export resolveTransport + resolveAuthMode for test (or use @internal annotation + parameterize)
```

#### Deep file dependency analysis
- Need to make `resolveTransport` + `resolveAuthMode` testable. Two options: (a) export them with `@internal` JSDoc tag (preferred — no public-API surface change because `index.ts` does not re-export them); (b) use a thin wrapper exported just for tests.
- Pick (a): export from `run-mcp-server.ts` but mark `@internal`; `src/agent-tools/index.ts` does NOT re-export. Verified no public API leak.

#### Deep Dives
- **Matrix cells** (table-driven test): vary `opt.transport`, `THEOMEM_MCP_TRANSPORT`, `THEMEMORY_API_KEY`; assert expected `resolveTransport` result + expected `resolveAuthMode` result. Use `it.each([...12 rows...])`.

#### Pseudo-code

```typescript
describe('resolveTransport + resolveAuthMode — precedence matrix (T4.1)', () => {
  beforeEach(() => {
    vi.stubEnv('THEOMEM_MCP_TRANSPORT', '');
    vi.stubEnv('THEMEMORY_API_KEY', '');
    vi.stubEnv('THEOMEM_MCP_AUTH', '');
  });
  afterEach(() => vi.unstubAllEnvs());

  const cases: Array<[
    { flagT?: 'stdio' | 'streamable-http'; envT?: string; apiKey?: string; flagA?: string; envA?: string },
    'stdio' | 'streamable-http',
    'none' | 'api-keys' | 'oidc' | 'both',
  ]> = [
    [{}, 'stdio', 'none'],
    [{ apiKey: 'x' }, 'streamable-http', 'api-keys'],
    [{ flagT: 'stdio', apiKey: 'x' }, 'stdio', 'none'],
    [{ envT: 'stdio', apiKey: 'x' }, 'stdio', 'none'],
    [{ flagT: 'streamable-http' }, 'streamable-http', 'none'],
    [{ flagT: 'streamable-http', apiKey: 'x' }, 'streamable-http', 'api-keys'],
    [{ flagT: 'streamable-http', flagA: 'none', apiKey: 'x' }, 'streamable-http', 'none'],
    [{ apiKey: '' }, 'stdio', 'none'],   // empty string handled
    [{ envT: 'streamable-http' }, 'streamable-http', 'none'],
    [{ envT: 'streamable-http', apiKey: 'x' }, 'streamable-http', 'api-keys'],
    [{ envA: 'oidc', apiKey: 'x' }, 'streamable-http', 'oidc'],
    [{ flagT: 'stdio', envT: 'streamable-http' }, 'stdio', 'none'],  // flag wins over env
  ];

  it.each(cases)('precedence #%# → %j → transport=%s auth=%s', (input, expectedT, expectedA) => {
    if (input.envT) vi.stubEnv('THEOMEM_MCP_TRANSPORT', input.envT);
    if (input.apiKey !== undefined) vi.stubEnv('THEMEMORY_API_KEY', input.apiKey);
    if (input.envA) vi.stubEnv('THEOMEM_MCP_AUTH', input.envA);
    const t = resolveTransport(input.flagT);
    const a = resolveAuthMode(input.flagA as any, t);
    expect(t).toBe(expectedT);
    expect(a).toBe(expectedA);
  });
});
```

#### Tasks
1. (v1.1 EC-2 absorption) DO NOT export `resolveTransport` / `resolveAuthMode` individually. Instead, add a single export `resolveMcpModes(opt)` annotated `@internal` that composes both. `resolveTransport` + `resolveAuthMode` stay module-private (no `export`).
2. Verify `src/agent-tools/index.ts` does not re-export `resolveMcpModes` (grep confirmation — public surface unchanged).
3. Append 12-case `it.each` block to `src/agent-tools/__tests__/run-mcp-server.test.ts` calling `resolveMcpModes` once per row and asserting `{transport, auth}` shape match.
4. Add 2 EC-3 + EC-4 cases (garbage env values) to the matrix → 14 total cells.
5. Run `npm test -- run-mcp-server`.

#### TDD
```
RED → GREEN (table-driven): write the 12 cases; some pass immediately, others fail until T2.1+T2.2 GREEN landed (since T4.1 runs after T2.x). Since T4.1 is later in the chain, the matrix is GREEN-from-start unit-level regression guard.
VERIFY: npm test -- run-mcp-server
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] 12/12 matrix cells PASS.
- [ ] `src/agent-tools/index.ts` confirmed NOT to re-export the helpers (public surface unchanged).
- [ ] Pass: lint + typecheck + size.

#### DoD
- [ ] Matrix tests added; helpers exported as `@internal`; commit: `test(mcp): 12-cell precedence matrix for resolveTransport + resolveAuthMode (T4.1)`.

---

## Phase 5: Documentation + CHANGELOG

### T5.1 — Update README.md § Quickstart + Configuration

#### Objective
Document the env-driven Mem0-DX path as the recommended approach for external consumers, alongside the stdio path for embedded use.

#### Why this step

**What this step does** — Edits `README.md` § Quickstart to add a "Mem0-DX uniform-auth path" subsection showing the `.mcp.json` template with `THEMEMORY_API_KEY` env block; documents the precedence table from ADR D1; warns about R4 (operators who only want REST behavior must NOT add `THEMEMORY_API_KEY` to `.mcp.json` env block).

**Why it is necessary now** — Behavior change without documentation is operator-hostile. R2/R4 mitigation depends on operators reading the README.

#### Evidence
- `README.md` current structure (large file; § Quickstart exists).
- ADR D1 precedence rule + R2/R4 risks.

#### Files to edit
```
README.md — add subsection under § Quickstart + amend § Configuration
```

#### Deep file dependency analysis
- README is large but only one new subsection (~30-50 lines) inside § Quickstart.

#### Deep Dives

- **Content**:
  - "Uniform Bearer auth across REST + MCP HTTP (FAANG-DX)" subsection header.
  - `.mcp.json` template showing `THEMEMORY_API_KEY: theo_live_...` + commentary about auto-selection.
  - Precedence table: flag > scoped env > `THEMEMORY_API_KEY` presence > default.
  - WARNING block: "If you use TheMemory ONLY via REST and `.mcp.json` is not pointing at TheMemory's MCP, do NOT add `THEMEMORY_API_KEY` to the `.mcp.json` env block of your CLAUDE.md MCP servers."

#### Tasks
1. Edit README.md.
2. Verify rendered output by quick visual scan.

#### TDD
```
(no test for docs change; covered by overall integration validation T6.1)
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] § Quickstart contains the new subsection.
- [ ] Precedence table is consistent with ADR D1.
- [ ] R4 warning present.

#### DoD
- [ ] Commit: `docs(mcp): document env-driven Mem0-DX uniform-auth path (T5.1)`.

---

### T5.2 — Update CHANGELOG.md [Unreleased] § Changed

#### Objective
Comply with Inquebrável Rule 6 — every code change ships a CHANGELOG entry.

#### Why this step

**What this step does** — Adds one entry under `[Unreleased] § Changed` summarizing the env-driven default, citing PRIORITY 0 hardening classification.

#### Files to edit
```
CHANGELOG.md
```

#### Tasks
1. Append entry to `[Unreleased] § Changed`.

#### TDD
```
(no test for CHANGELOG entry; covered by integration validation T6.1 grep-asserting [Unreleased] § Changed contains "env-driven")
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] Entry exists, references PRIORITY 0 sub-goal 3 hardening rationale.
- [ ] Entry under `### Changed` (semantically correct — behavior shift, not new feature).

#### DoD
- [ ] Commit: `docs(changelog): env-driven MCP transport default (T5.2)`.

---

## Phase 6: Integration validation

### T6.1 — Full test suite + smoke both transport paths

#### Objective
Validate the implementation works end-to-end in a real workload before merge.

#### Why this step

**What this step does** — Runs full `npm test` + `npm run typecheck` + `npm run lint` + `npm run build` + 2 smoke tests: (a) `THEMEMORY_API_KEY=theo_live_... themory mcp` boots HTTP on default port and emits stderr disclosure; (b) `themory mcp` (no env) boots stdio.

**Why it is necessary now** — Per `architecture.md § Final Phase: Integration Validation` (MANDATORY).

#### Evidence
- Project commands confirmed: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.

#### Files to edit
```
(none — this is the validation gate, not a code change)
```

#### Tasks
1. `npm test` — 1171+ tests PASS (allowing for the new tests added).
2. `npm run typecheck` — zero errors.
3. `npm run lint` — zero warnings.
4. `npm run build` — dist refreshed.
5. Smoke A: `THEMEMORY_API_KEY=theo_live_dummy node dist/agent-tools/cli.js mcp 2>&1 | head -3` — assert stderr line contains "transport=streamable-http + auth=api-keys"; kill process.
6. Smoke B: `node dist/agent-tools/cli.js mcp 2>&1 | head -3 < /dev/null` — assert stderr line contains "transport=stdio (default;".
7. Real-DB smoke (against `ankane/pgvector:v0.5.1` if running locally): boot HTTP, hit `GET /health` with `Authorization: Bearer theo_live_<valid>`, expect 200.

#### TDD
```
(integration validation — no new test code)
VERIFY: all 7 gates pass
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] `npm test` — full suite PASS.
- [ ] `npm run typecheck` zero errors.
- [ ] `npm run lint` zero warnings.
- [ ] `npm run build` succeeds.
- [ ] Smoke A: HTTP boots with stderr disclosure.
- [ ] Smoke B: stdio boots with hint disclosure.
- [ ] Smoke C: HTTP-with-Bearer round-trip 200 OK.

#### DoD
- [ ] All 7 gates PASS.
- [ ] Final commit (if anything from gates needed adjustment) or sign-off ready for `/code-quality` + `/review`.

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Env-driven HTTP+api-keys auto-selection when `THEMEMORY_API_KEY` present + no flags | T1.1, T2.1, T2.2 | RED + GREEN cover the auto-selection path |
| 2 | Stdio default preserved when env absent (backward compat) | T1.1 (3rd test), T2.1 | RED + GREEN guard |
| 3 | Explicit `--transport=stdio` wins over env presence (ADR D1) | T1.2 | Regression-guard test |
| 4 | Empty string `THEMEMORY_API_KEY=""` treated as absent | T1.1 (3rd test) | RED + GREEN guard |
| 5 | Auth mode auto-selects `api-keys` (ADR D2) | T1.1 (4th test), T2.2 | RED + GREEN |
| 6 | `THEOMEM_MCP_AUTH=none` overrides env-driven heuristic | T4.1 (matrix case 7) | Unit test |
| 7 | Stderr disclosure visible (ADR D3 — auditability) | T3.1 | RED stderr-capture + GREEN |
| 8 | Precedence matrix locked at unit level | T4.1 | 12-cell matrix |
| 9 | Documentation reflects new behavior | T5.1 | README edit |
| 10 | CHANGELOG entry per Inquebrável Rule 6 | T5.2 | CHANGELOG edit |
| 11 | R4 mitigation: warning about `.mcp.json` auto-flip | T5.1 (warning block) | README warning |
| 12 | Integration validation end-to-end | T6.1 | Full suite + 3 smoke gates |
| 13 | EC-1 absorption: whitespace-only `THEMEMORY_API_KEY` treated as absent | T2.1, T2.2 (pseudo-code uses `.trim()`); T4.1 matrix cell 8 | `.trim() !== ''` check |
| 14 | EC-2 absorption: `resolveMcpModes` wrapper exports — individual helpers stay private | T4.1 step 1+2 | Single `@internal` wrapper |
| 15 | EC-3/EC-4 SHOULD TEST: garbage env values fall through correctly | T4.1 matrix cells 13+14 | Add typo-env rows to matrix |
| 16 | EC-5 SHOULD TEST: whitespace-trimmed key still works | T2.1 pseudo-code + T4.1 matrix | covered by `.trim()` semantics |
| 17 | EC-6 SHOULD TEST: stderr suppressible via `THEOMEM_MCP_QUIET=1` | T3.1 (extended) | Quiet-env shortcircuits disclosure |
| 18 | EC-7 DOCUMENT: rationale for not requiring double-env opt-in | T5.1 (README precedence table cites D1 rationale) + T5.2 (CHANGELOG entry references) | README + CHANGELOG inline rationale |
| 19 | EC-8 DOCUMENT: PG-unreachable deferred to first request, not boot | T6.1 (failure-scenario smoke C) + T5.1 (README warning) | Smoke validates; README documents |

**Coverage: 19/19 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed.
- [ ] All tests passing — `npm test` green (≥ 1171 tests).
- [ ] Zero type errors — `npm run typecheck`.
- [ ] Zero lint warnings — `npm run lint`.
- [ ] File-size budget respected (per `rules/architecture.md` — 500 LoC default; `run-mcp-server.ts` ≤ 250 after edits).
- [ ] CHANGELOG.md updated under `[Unreleased] § Changed` (Inquebrável Rule 6).
- [ ] Backward compatibility preserved: `RunMcpServerOptions` shape unchanged; default behavior with no env preserved.
- [ ] Commit bodies cite **PRIORITY 0 hardening sub-goal 3** classification with rationale (a)–(d) per CLAUDE.md.
- [ ] Plan-specific:
  - [ ] `themory mcp` with `THEMEMORY_API_KEY=theo_live_<valid>` boots HTTP and emits stderr disclosure.
  - [ ] `themory mcp` without env boots stdio with hint disclosure.
  - [ ] 12-cell precedence matrix locked.
- [ ] **Runtime-metric proof**: the `bearerAuth.apiKey === ApiKeyAuthVerifier instance` invariant observed in Smoke A (T6.1 step 5) — concrete evidence that the wiring fires.
- [ ] **Plan archived**: after `/review` returns `READY_TO_MERGE` AND PR merged, move to `knowledge-base/plans/completed/themory-mcp-bearer-by-env-faang-plan.md`.

## Failure scenarios

The plan touches Postgres-backed `ApiKeyAuthVerifier` (HTTP transport boot path requires a working PG connection to validate the supplied bearer). One external-I/O dependency:

| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| `postgres:theo_api_keys` (PG via `pg.Pool`) | PG unreachable at MCP boot when env-driven HTTP path activates | T6.1 smoke C variant: kill local PG container before booting `themory mcp` with `THEMEMORY_API_KEY` set | `themory mcp` boots WITHOUT auth-verifier construction OR fails-loud with the existing Item 20 EC-absorbed message ("PG connection required for api-keys auth"); MUST NOT silently start with `auth=none` |
| `postgres:theo_api_keys` (PG via `pg.Pool`) | PG reachable but `theo_api_keys` table absent (fresh DB) | Boot MCP before running `themory migrate` | Existing `wireMemoryFromPool` → `runMigrations` already handles this (line 128); inherits Item 20 behavior |

## Final Phase: Integration Validation (MANDATORY)

### Execution

```
npm test                            # unit + integration; ≥ 1171 PASS
npm run typecheck                   # zero errors
npm run lint                        # zero warnings
npm run build                       # dist refreshed
# Smoke A — env-driven HTTP path
THEMEMORY_API_KEY=theo_live_dummy node dist/agent-tools/cli.js mcp 2>&1 | head -3
# Smoke B — stdio default
node dist/agent-tools/cli.js mcp < /dev/null 2>&1 | head -3
# Smoke C — HTTP + Bearer round-trip (against real pgvector)
THEMEMORY_API_KEY=theo_live_<real> node dist/agent-tools/cli.js mcp &
sleep 2
curl -sf -H "Authorization: Bearer theo_live_<real>" http://localhost:8080/health
kill %1
```

### Acceptance Criteria

- [ ] All test suites green.
- [ ] Coverage ≥ 90% on changed files (`run-mcp-server.ts` critical path: 100%).
- [ ] Zero type errors.
- [ ] Zero lint warnings.
- [ ] Smoke A emits stderr disclosure line matching `transport=streamable-http + auth=api-keys`.
- [ ] Smoke B emits stderr disclosure line matching `transport=stdio (default;`.
- [ ] Smoke C returns 200 OK (HTTP+Bearer round-trip).
- [ ] Failure scenario 1 (PG unreachable) observed: server fails loud, NOT silent `auth=none`.

### If Validation Fails

1. Identify whether failure is caused by this plan's changes vs pre-existing.
2. Fix plan-caused failures before declaring complete.
3. Re-run validation chain.
4. Pre-existing issues logged in PR description, do NOT block plan completion.
