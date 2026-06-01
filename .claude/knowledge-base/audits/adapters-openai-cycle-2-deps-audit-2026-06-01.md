# Deps Audit: adapters-openai-cycle-2

**Date:** 2026-06-01
**Mode:** plan-bound:adapters-openai-cycle-2
**Verdict:** **PASS_WITH_CAVEATS**
**Hard caps triggered:** (none) — but ONE actionable recommendation: align plan pin `^4.50.0` with demo pin `^4.77.0` BEFORE /implement
**Soft caps:** 1 (`soft_floor_pre_existing_allowlisted_moderate` — same as prior 2 cycles; carry-forward unchanged)

## Summary

- **Ecosystems detected:** npm (root SDK + `examples/chat-with-memory/` demo workspace)
- **Plan dep delta: 1 NEW** — `openai: ^4.50.0` as `optionalDependencies` on root SDK (per ADR D2)
- **Vulnerabilities found:** 0 CRITICAL, 0 HIGH, 4 MODERATE (pre-existing — drizzle-kit esbuild chain; allowlisted sunset 2026-08-23, unchanged), 0 LOW
- **`openai` CVE status:** **ZERO known CVE entries** in `npm audit` for the `openai` package at any 4.x version
- **Outdated state:** `openai` latest is `6.39.1`; plan's pin `^4.50.0` resolves to `4.104.0` (last 4.x). v5 + v6 exist BUT scope is MOVE-only (ADR D3 explicitly defers major bumps to Cycle 2.X)
- **Allowlist hits:** 4 ACTIVE (pre-existing); 0 EXPIRED
- **Auditor coverage:** `{ npm-audit: ran, npm-outdated: ran, osv-scanner: SKIPPED (binary not installed; npm-audit authoritative for npm) }`

## Vulnerabilities (sorted by severity)

### `openai` (NEW dep at `^4.50.0`)

**Status: ZERO CVE entries.** `npm audit --json` returns no `openai` entry in vulnerabilities object. The package is clean at all 4.x versions per current GitHub Advisory data.

### Pre-existing 4 MODERATE (carry-forward unchanged)

Same set as prior 2 cycles (adapters-stub Cycle 1 + F-T4.1-2 debug):
- `esbuild <=0.24.2` (GHSA-67mh-4wv8-2f99) — transitive via `drizzle-kit ^0.31.0` (devDep). Allowlisted line 37, sunset 2026-08-23.
- `@esbuild-kit/core-utils` (GHSA-67mh-4wv8-2f99) — line 38, sunset 2026-08-23
- `@esbuild-kit/esm-loader` (GHSA-67mh-4wv8-2f99) — line 39, sunset 2026-08-23
- `drizzle-kit ^0.31.0` (GHSA-67mh-4wv8-2f99) — line 40, sunset 2026-08-23

**Risk envelope for THIS plan:** ZERO. Plan does NOT modify drizzle-kit, esbuild, or any related dep. CVE surface is byte-identical to prior cycles. Allowlist downgrades MODERATE → LOW per golden rule.

## Outdated (non-vulnerable)

### npm: `openai@^4.50.0` → latest `6.39.1` (MAJOR ×2 — v4 → v5 → v6)

- **Plan pin:** `openai: ^4.50.0` (proposed by ADR D2)
- **Demo's actual pin** (in `examples/chat-with-memory/package.json`): **`openai: ^4.77.0`** (currently installed at `4.104.0`)
- **Latest 4.x:** `4.104.0` (per `npm view openai@^4.50.0 version`)
- **Latest overall:** `6.39.1` (v5 + v6 are newer majors)
- **Semver delta:** TWO MAJOR versions behind latest
- **ADR pinning:** **ADR D3 (MOVE-only) explicitly defers major bumps to Cycle 2.X**. This satisfies the "ADR pinning" requirement of the `soft_floor_plan_dep_major_outdated_unpinned` soft cap — does NOT fire.

**ACTIONABLE RECOMMENDATION (1):** bump plan's pin `^4.50.0` → `^4.77.0` to match the demo's existing pin. Currently INCONSISTENT — plan is OLDER than demo, which would silently REGRESS demo behavior post-Cycle 2.

- **Diff suggestion to plan ADR D2 + Dependencies table:**
  ```diff
  - | `openai` (NEW; `optionalDependencies`) | `^4.50.0` | npm | ...
  + | `openai` (NEW; `optionalDependencies`) | `^4.77.0` | npm | ...
  ```
  Rationale to add to ADR D2: "matches demo's existing pin at `examples/chat-with-memory/package.json` — prevents silent demo regression on `npm install` resolution".

### Other outdated (unchanged from prior cycles)

| Package | Current | Latest | Status |
|---|---|---|---|
| `@types/node` | 20.19.41 | 25.9.1 | Pinned to Node 20 engine; bump deferred to v0.5+ |
| `eslint` | 9.39.4 | 10.4.1 | Out of scope for this cycle |
| `typescript` | 5.9.3 | 6.0.3 | Out of scope for this cycle |
| `typescript-eslint` | 8.59.4 | 8.60.0 | PATCH; cosmetic |
| `vitest` | 4.1.7 | 4.1.8 | PATCH; cosmetic |
| `zod` | 3.25.76 | 4.4.3 | MAJOR; zod v4 has breaking changes; out of scope |

**Diff suggestions for these:** NONE — out of scope for Cycle 2; tracked at their own future cycles.

## Plan validation (Mode 2)

| Plan dep | Section | Manifest match | Audit clean? | Rule 9 OK? | Verdict |
|---|---|---|---|---|---|
| `@usetheo/memory/contract` | Existing | yes (workspace) | yes | n/a | OK |
| `openai` | NEW (`^4.50.0`) | n/a (to-be-added) | yes (zero CVE at ^4.x) | yes (plan ADR D2 documents rejected: `@anthropic-ai/sdk` wrong vendor; raw fetch reinvents wheel) | **OK** — but recommend `^4.77.0` bump for demo-consistency |

**Validation result:** OK with 1 advisory recommendation (see § Outdated above).

## Soft cap rationale

`soft_floor_pre_existing_allowlisted_moderate` — 4 pre-existing MODERATE findings carry forward unchanged. Identical posture to PR #25 + PR #26 cycles. Composite verdict caps at PASS_WITH_CAVEATS (89) because the allowlist downgrade applies (CVE-level severity now LOW); we're not regressing OR improving the supply-chain hygiene.

## Recommended next steps

1. **Optional but recommended:** apply the diff suggestion in § Outdated — bump plan's `openai` pin from `^4.50.0` → `^4.77.0` to match the demo. Cost: 1-line edit to ADR D2 + Dependencies table. Benefit: prevents silent demo regression.
2. **No other manifest changes required.** Proceed to `/plan-confidence adapters-openai-cycle-2`.
3. **DO NOT bump openai to v5/v6** — MOVE-only ADR D3 explicitly defers major bumps to Cycle 2.X. The cap doesn't fire because the ADR exists.
4. **Re-audit before sunset 2026-08-23** — verify drizzle-kit upstream migrated to tsx OR extend allowlist.

## Verdict statement

**PASS_WITH_CAVEATS.** Plan introduces `openai` SDK as `optionalDependencies` per Inquebrável Rule 9 with explicit Rule 9 evaluation in ADR D2 (rejected alternatives documented). Package has ZERO CVE entries at any 4.x version. The proposed pin `^4.50.0` is INCONSISTENT with the demo's existing `^4.77.0` pin — recommend alignment before /implement to prevent silent regression. The 4 pre-existing MODERATE findings (drizzle-kit esbuild chain) carry forward unchanged. ADR D3 MOVE-only correctly defers major bumps to Cycle 2.X (prevents `soft_floor_plan_dep_major_outdated_unpinned` from firing). `/plan-confidence` will not cap below 89 due to deps.

Stable identifier of soft cap (audit trail): `soft_floor_pre_existing_allowlisted_moderate`.
