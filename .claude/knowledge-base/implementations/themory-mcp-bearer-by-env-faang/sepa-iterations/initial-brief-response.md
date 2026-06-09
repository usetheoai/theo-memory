# SEPA initial brief — themory-mcp-bearer-by-env-faang

**Date:** 2026-06-08
**SEPA agent file:** `.claude/agents/implement-themory-mcp-bearer-by-env-faang-2026-06-08/sepa.md`
**Mode:** VERBOSE (initial brief only; per-iteration calls follow TIGHT/VERBOSE per-phase)

---

## Plan understanding (3 lines max)

- Promotes the already-shipped Item-20 `streamable-http + --auth=api-keys` path to be auto-selected when `THEMEMORY_API_KEY` env is present and no `--transport`/`--auth` flag overrides it (env-driven precedence: flag > scoped env > `THEMEMORY_API_KEY` presence > default-stdio).
- Does NOT change: `RunMcpServerOptions` interface shape, the stdio default when env absent, `--transport`/`--auth` flag semantics, public exports (only an `@internal` `resolveMcpModes` wrapper is exported for tests; individual resolvers stay module-private).
- Validated upstream: `/to-plan` v1.2 → `/edge-case-plan` (2 MUST FIX absorbed → v1.1 EC-1 trim + EC-2 single wrapper; EC-6 quiet env absorbed into Q3) → `/deps-audit` PASS (zero new deps) → `/plan-confidence` SHIPPABLE_WITH_CAVEATS 70/100; v1.2 rewrote 6 `#### TDD` sections to satisfy `check_tdd_shape.py` `\bRED:\s*test_\w+` regex.

## Risk surface I'm watching

1. **[HIGH — R4 of plan]** Existing Claude Code consumer adds `THEMEMORY_API_KEY` to `.mcp.json` env block intending REST-only → stdio AUTO-FLIPS to HTTP and tries to bind 8080. Natural detection: WIRING (T6.1 smoke + T5.1 README warning).
2. **[MAJOR]** Test isolation: enabling env-driven path with a system-wide `THEMEMORY_API_KEY` leaks into unrelated test files. Natural detection: RED (T1.1 `beforeEach` MUST `vi.stubEnv('THEMEMORY_API_KEY', '')`) + REGRESSION-GUARD in T2.2.
3. **[MAJOR — ADR D2]** Silent security downgrade: if `resolveAuthMode` Tier-3 condition is mis-coded (omits `transport === 'streamable-http'` guard OR returns `'none'` on env present), env-driven HTTP boots open. Natural detection: GREEN (T1.1 test 4 + T2.2 second RED for `--auth=none` flag).
4. **[MAJOR — EC-1 absorption]** `.trim() !== ''` MUST be applied in BOTH `resolveTransport` AND `resolveAuthMode` (symmetric). Natural detection: T4.1 matrix cells 8+9.
5. **[MAJOR — EC-2 absorption]** `resolveMcpModes` is the ONLY new export; `resolveTransport`/`resolveAuthMode` MUST stay non-`export`ed. Natural detection: REFACTOR (grep `^export function resolve(Transport|AuthMode)` → MUST be 0).
6. **[MAJOR]** File-size budget: plan projects 225 → ~247 LoC for `run-mcp-server.ts` (budget 500). T3.1 adds ~10 more (~257). Stays under, but Wiring summary should cite the delta.
7. **[MAJOR — Inquebrável Rule 9]** No vendor SDK names in `src/**`. Plan body cites "Stripe-shape" / "Mem0-DX" LEGITIMATELY in plan/ADR docs; implementer MUST NOT echo into JSDoc/comments/log strings/test names. Natural detection: REFACTOR + COMMIT (grep banned-token regex against staged diff).
8. **[INFO — D3 quiet env]** `THEOMEM_MCP_QUIET=1` MUST short-circuit ONLY the new disclosure line, NOT the existing "real providers wired" line. Natural detection: GREEN of T3.1.

## Pre-flight verification — verified empirically

| Check | Result |
|---|---|
| ADR D1 (3-tier precedence) | CONFIRMED — Decision + Rationale + Alternatives B/C/D REJECTED |
| ADR D2 (auto `api-keys`) | CONFIRMED — silent security downgrade rationale; 2 alternatives REJECTED |
| ADR D3 (stderr disclosure) | CONFIRMED — 3 case lines specified verbatim; 2 alternatives REJECTED |
| ADR D4 (port 8080 deferred) | CONFIRMED — EADDRINUSE fail-loud; 2 alternatives REJECTED |
| ADR D5 (no `.mcp.json` auto-edit) | CONFIRMED — Inquebrável Rule 1+4; 2 alternatives REJECTED |
| EC-1 absorption (trim) | CONFIRMED — symmetric `.trim() !== ''` in pseudo-code lines 380/386/465-466 |
| EC-2 absorption (single wrapper) | CONFIRMED — `resolveMcpModes` is the only export; T4.1 step 1 enforces |
| EC-6 absorption (quiet env) | CONFIRMED — pseudo-code reads `THEOMEM_MCP_QUIET === '1'` |
| Spot-check 1: `run-mcp-server.ts:84-89` 2-tier resolveTransport | CONFIRMED exact 6-line shape; extension target matches |
| Spot-check 2: `src/server/auth/api-key-verifier.ts` exists | CONFIRMED via ls |
| Spot-check 3: `cli.ts:232` reads `THEMEMORY_API_KEY` | CONFIRMED — `bearerToken: process.env['THEMEMORY_API_KEY'] ?? ''` |
| Companion audit-trail files (edge-cases + deps-audit) | CONFIRMED on disk |

## Initial findings

- **[INFO]** All ADRs are well-formed (Decision + Rationale + Alternatives-REJECTED + Consequences) — no `## ADRs` structural blockers.
- **[MAJOR]** Plan Drawback R4 is HIGH-severity. Mitigation says "T5.1 README warning + edge-case-plan should add MUST-FIX `THEMEMORY_MCP_AUTO_HTTP=0` opt-out env". This opt-out env is NOT in T2.1/T2.2 pseudo-code. **Recommend**: at Pre-RED of T2.1, SEPA must re-verify whether the implementer is expected to add the short-circuit. If absent intentionally (relying on stderr + README), the plan's R4 mitigation is weaker than the row claims. Flag for VERBOSE re-review at T2.1.
- **[MAJOR]** T1.1 pseudo-code spies on `connectStdio` / `connectStreamableHttp` from `transports/stdio.js` + `transports/streamable-http.js`. Module paths exist but export shape MUST be verified before asserting RED is "genuine failure".
- **[MINOR]** T2.2 says "Replace call at line 163". Implementer should re-resolve the line number against current HEAD before COMMIT (line numbers drift).
- **[INFO]** No `## Critical paths` section observed; plan does NOT invoke mutation testing — acceptable for 3-helper hardening cycle.

## Recommendation for halt-loop start

**GO** — pre-conditions are met from a Staff Engineer perspective. One open watch-item the cycle-plan chain did not fully close: the R4 `THEMEMORY_MCP_AUTO_HTTP=0` opt-out env mentioned in Drawbacks is NOT visible in any task pseudo-code. SEPA will re-raise this MAJOR at T2.1 Pre-RED (MODE=TIGHT). If implementer/operator deems README warning sufficient, document the explicit rejection in T2.1 commit body (not silent).

Proceed to halt-loop iteration 1 with task T1.1.
