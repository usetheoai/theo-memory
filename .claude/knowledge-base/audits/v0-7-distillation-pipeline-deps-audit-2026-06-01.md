# Deps Audit: v0-7-distillation-pipeline

**Date:** 2026-06-01
**Mode:** plan-bound:v0-7-distillation-pipeline
**Verdict:** **PASS_WITH_CAVEATS**
**Hard caps triggered:** (none) — soft cap `soft_floor_pre_existing_allowlisted_moderate` (carry-forward unchanged from prior 5 cycles)
**Plan deps delta:** **ZERO NEW** — per plan ADR D6 (zero new npm deps; all needs covered by existing surface)

## Summary

- **Ecosystems detected:** npm (root SDK only — no Python/Rust/Go)
- **Plan dep delta: 0 NEW + 5 EXISTING reused** — `pg`, `drizzle-orm`, `@opentelemetry/api`, `openai` (optional via Cycle 2), `natural` (optional via v0.6.1 — relevant for EC-10 BLEU)
- **Vulnerabilities found:** 0 CRITICAL, 0 HIGH, 4 MODERATE (pre-existing — drizzle-kit esbuild chain; allowlisted sunset 2026-08-23, unchanged), 0 LOW
- **Outdated state:** 7 non-vulnerable outdated (`@types/node`, `eslint`, `openai`, `typescript`, `typescript-eslint`, `vitest`, `zod`) — all out-of-scope for THIS cycle
- **Allowlist hits:** 4 ACTIVE (pre-existing, sunset 2026-08-23); 0 EXPIRED
- **Auditor coverage:** `{ npm-audit: ran, npm-outdated: ran, osv-scanner: SKIPPED (binary not installed; npm-audit authoritative for npm) }`

## Vulnerabilities (sorted by severity)

### Plan-declared deps (5 — all EXISTING reuses)

**Status: ZERO CVE entries** at the declared versions for any of the 5 plan-cited deps:

| Plan dep | Pin | Manifest match | CVE at pin? | Verdict |
|---|---|---|---|---|
| `pg` | `^8.13.0` | yes (`dependencies`) | NONE | OK |
| `drizzle-orm` | `^0.45.0` | yes (`dependencies`) | NONE | OK |
| `@opentelemetry/api` | `^1.9.0` | yes (`devDependencies`) | NONE | OK |
| `openai` | `^4.77.0` (resolves 4.104.0) | yes (`optionalDependencies`, shipped Cycle 2) | NONE at any 4.x | OK |
| `natural` | `^8.1.0` (relevant for EC-10 BLEU per edge-case review) | yes (`optionalDependencies`, shipped v0.6.1) | NONE | OK |

### Pre-existing 4 MODERATE (carry-forward unchanged from 5 prior cycles)

Identical to Cycle 2 + F-T4.1-2 + voyager-skill-library audits:
- `esbuild <=0.24.2` (GHSA-67mh-4wv8-2f99) — transitive via `drizzle-kit ^0.31.0` (devDep). Allowlisted line 37, sunset 2026-08-23.
- `@esbuild-kit/core-utils` (GHSA-67mh-4wv8-2f99) — line 38, sunset 2026-08-23
- `@esbuild-kit/esm-loader` (GHSA-67mh-4wv8-2f99) — line 39, sunset 2026-08-23
- `drizzle-kit ^0.31.0` (GHSA-67mh-4wv8-2f99) — line 40, sunset 2026-08-23

**Risk envelope for THIS plan:** ZERO. v0.7 does NOT modify drizzle-kit, esbuild, or any related dep. CVE surface is byte-identical to prior 5 cycles. Allowlist downgrades MODERATE → LOW per golden rule.

## Outdated (non-vulnerable)

### Out-of-scope outdated (all carry-forward — unchanged from Cycle 2 audit)

| Package | Current | Latest | Semver delta | Status |
|---|---|---|---|---|
| `@types/node` | 20.19.41 | 25.9.1 | MAJOR ×5 | Pinned to Node 20 engine; bump deferred to v0.5+ |
| `eslint` | 9.39.4 | 10.4.1 | MAJOR | Out of scope for v0.7 cycle |
| `openai` | 4.104.0 | 6.39.1 | MAJOR ×2 | Plan implicitly defers (Cycle 2 ADR D3 MOVE-only locked v4.x); revisit at Cycle 2.X harden per adapters-portfolio-roadmap |
| `typescript` | 5.9.3 | 6.0.3 | MAJOR | Out of scope for v0.7 |
| `typescript-eslint` | 8.59.4 | 8.60.0 | PATCH | Cosmetic; out of scope |
| `vitest` | 4.1.7 | 4.1.8 | PATCH | Cosmetic; out of scope |
| `zod` | 3.25.76 | 4.4.3 | MAJOR | zod v4 has breaking changes; out of scope |

**Diff suggestions for these:** NONE — out of scope for v0.7; each tracked at its own future cycle.

## Plan validation (Mode 2)

| Plan dep | Section | Manifest match | Audit clean? | Rule 9 OK? | Verdict |
|---|---|---|---|---|---|
| `@usetheo/memory/contract` | Existing | yes (workspace) | yes | n/a | OK |
| `@usetheo/memory/llms/openai` | Existing | yes (workspace; Cycle 2 PR #27) | yes | n/a | OK |
| `pg` | Existing | yes (^8.13.0 — v0.1) | yes | n/a | OK |
| `drizzle-orm` | Existing | yes (^0.45.0 — v0.1) | yes | n/a | OK |
| `@opentelemetry/api` | Existing | yes (^1.9.0 — v0.1) | yes | n/a | OK |
| **NEW deps** | none declared per ADR D6 | n/a | n/a | TRIVIALLY OK (zero new) | OK |

**Validation result:** OK — zero blockers, zero advisory recommendations. ADR D6 (zero new deps) is verified.

## Soft cap rationale

`soft_floor_pre_existing_allowlisted_moderate` — same 4 pre-existing MODERATE findings carry forward (drizzle-kit esbuild chain). Identical posture to Cycle 2 PR #27 / F-T4.1-2 PR #26 / voyager v0.6.1. Composite verdict caps at PASS_WITH_CAVEATS (89) because the allowlist downgrade applies (CVE-level severity now LOW); we're neither regressing NOR improving the supply-chain hygiene.

## Recommended next steps

1. **No actions required** — zero plan deps changes. ADR D6 (zero new deps) verified empirically: plan-cited deps already present in manifest with matching pins.
2. **Proceed to `/plan-confidence v0-7-distillation-pipeline`.**
3. **Re-audit before sunset 2026-08-23** — verify drizzle-kit upstream migrated to tsx OR extend allowlist.
4. **No `openai` major bump consideration for v0.7** — Cycle 2 ADR D3 MOVE-only locked v4.x; v5/v6 major bump is Cycle 2.X harden scope, NOT v0.7 distillation scope. ADR pinning satisfies `soft_floor_plan_dep_major_outdated_unpinned` — does NOT fire.

## Verdict statement

**PASS_WITH_CAVEATS.** Plan introduces **ZERO new dependencies** per ADR D6 (verified by Mode 2 cross-reference). All 5 cited deps already present in manifest at matching pins (3 in `dependencies`, 1 in `devDependencies`, 2 in `optionalDependencies`). No CVE on any plan-declared dep. The 4 pre-existing MODERATE findings (drizzle-kit esbuild chain) carry forward byte-identical from 5 prior cycles. `/plan-confidence` will not cap below 89 due to deps. Rule 9 trivially satisfied (no new deps to evaluate).

Stable identifier of soft cap (audit trail): `soft_floor_pre_existing_allowlisted_moderate`.
