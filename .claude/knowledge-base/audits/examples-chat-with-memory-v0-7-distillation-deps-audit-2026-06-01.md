# Deps Audit: examples-chat-with-memory-v0-7-distillation

**Date:** 2026-06-01
**Mode:** plan-bound:examples-chat-with-memory-v0-7-distillation
**Verdict:** **PASS_WITH_CAVEATS**
**Hard caps triggered:** (none) — soft cap `soft_floor_pre_existing_allowlisted_moderate` (carry-forward unchanged from 6 prior cycles)
**Plan deps delta:** **ZERO NEW** — per plan ADR D6-equivalent (zero new npm deps; all needs covered by existing demo surface + just-shipped `@usetheo/memory` workspace at `0.0.0-rc.2`)

## Summary

- **Ecosystems detected:** npm (root SDK + `examples/chat-with-memory/` workspace) — no Python/Rust/Go
- **Plan dep delta: 0 NEW + 5 EXISTING reused** — `@usetheo/memory` (workspace), `@usetheo/ui`, `lucide-react`, `next`, `react`
- **Vulnerabilities found:**
  - Root SDK: 0 CRITICAL, 0 HIGH, 4 MODERATE (pre-existing — drizzle-kit esbuild chain; allowlisted sunset 2026-08-23), 0 LOW
  - Demo workspace: 0 CRITICAL, 0 HIGH, 2 MODERATE (pre-existing — next/postcss XSS chain; allowlisted sunset 2026-08-29), 0 LOW
- **Outdated state:** 7 non-vulnerable outdated (`@types/node`, `eslint`, `openai`, `typescript`, `typescript-eslint`, `vitest`, `zod`) — all out-of-scope for THIS cycle (carry-forward from prior 6 cycles)
- **Allowlist hits:** 6 ACTIVE (pre-existing, sunsets 2026-08-23 + 2026-08-29); 0 EXPIRED
- **Auditor coverage:** `{ npm-audit-root: ran, npm-audit-demo: ran, npm-outdated: ran, osv-scanner: SKIPPED (binary not installed; npm-audit authoritative for npm) }`

## Vulnerabilities (sorted by severity)

### Plan-declared deps (5 — all EXISTING reuses)

**Status:**

| Plan dep | Pin (manifest) | Manifest match | CVE at pin? | Allowlist hit | Verdict |
|---|---|---|---|---|---|
| `@usetheo/memory` | workspace `0.0.0-rc.2` (root `package.json:name+version`) | yes | NONE on the workspace package itself | n/a | OK |
| `@usetheo/ui` | `0.12.0` (`examples/chat-with-memory/package.json`) | yes | NONE | n/a | OK |
| `lucide-react` | `^0.469.0` (`examples/chat-with-memory/package.json`) | yes | NONE | n/a | OK |
| `next` | `^15.5.18` (`examples/chat-with-memory/package.json`) | yes | GHSA-qx2v-qp2m-jg93 (postcss XSS via transitive) | YES (sunset 2026-08-29; downgrades MODERATE → LOW per golden rule) | OK |
| `react` | `^19.0.0` (`examples/chat-with-memory/package.json`) | yes | NONE | n/a | OK |

### Pre-existing 6 MODERATE (carry-forward unchanged from 6 prior cycles)

Identical to v0.7 SDK audit + voyager-skill-library + F-T4.1-2 + Cycle 2 + adapters-cycle-1-fixes audits:

**Root SDK chain (drizzle-kit esbuild):**
- `esbuild <=0.24.2` (GHSA-67mh-4wv8-2f99) — transitive via `drizzle-kit ^0.31.0` (devDep). Allowlisted, sunset 2026-08-23.
- `@esbuild-kit/core-utils` (GHSA-67mh-4wv8-2f99) — sunset 2026-08-23
- `@esbuild-kit/esm-loader` (GHSA-67mh-4wv8-2f99) — sunset 2026-08-23
- `drizzle-kit ^0.31.0` (GHSA-67mh-4wv8-2f99) — sunset 2026-08-23

**Demo workspace chain (next + postcss XSS):**
- `postcss <8.5.10` (GHSA-qx2v-qp2m-jg93) — transitive via `next ^15.5.18`. Allowlisted, sunset 2026-08-29.
- `next ^15.5.18` (GHSA-qx2v-qp2m-jg93) — surface manifestation of the postcss chain. Sunset 2026-08-29.

**Risk envelope for THIS plan:** ZERO net change. This cycle does NOT modify `drizzle-kit`, `esbuild`, `next`, or `postcss`. CVE surface is byte-identical to prior 6 cycles. Allowlist downgrades MODERATE → LOW per golden rule.

## Outdated (non-vulnerable)

### Out-of-scope outdated (all carry-forward — unchanged from v0.7 SDK audit)

| Package | Current | Latest | Semver delta | Status |
|---|---|---|---|---|
| `@types/node` | 20.19.41 | 25.9.1 | MAJOR ×5 | Pinned to Node 20 engine; bump deferred to v0.5+ |
| `eslint` | 9.39.4 | 10.4.1 | MAJOR | Out of scope for this cycle |
| `openai` | 4.104.0 | 6.40.0 | MAJOR ×2 | ADR D3 of Cycle 2 MOVE-only locked v4.x; revisit at Cycle 2.X harden per adapters-portfolio-roadmap |
| `typescript` | 5.9.3 | 6.0.3 | MAJOR | Out of scope |
| `typescript-eslint` | 8.59.4 | 8.60.1 | PATCH | Cosmetic; out of scope |
| `vitest` | 4.1.7 | 4.1.8 | PATCH | Cosmetic; out of scope |
| `zod` | 3.25.76 | 4.4.3 | MAJOR | zod v4 has breaking changes; out of scope |

**Diff suggestions for these:** NONE — out of scope for this consumer-side cycle; each tracked at its own future cycle.

## Plan validation (Mode 2)

| Plan dep | Section | Manifest match | Audit clean? | Rule 9 OK? | Verdict |
|---|---|---|---|---|---|
| `@usetheo/memory` | Existing | yes (workspace `0.0.0-rc.2`; just shipped commit `7dc06f9`) | yes | n/a | OK |
| `@usetheo/ui` | Existing | yes (`0.12.0`) | yes | n/a | OK |
| `lucide-react` | Existing | yes (`^0.469.0`) | yes | n/a | OK |
| `next` | Existing | yes (`^15.5.18`) | allowlisted MODERATE → LOW | n/a | OK (carry-forward) |
| `react` | Existing | yes (`^19.0.0`) | yes | n/a | OK |
| **NEW deps** | (none declared) | n/a | n/a | TRIVIALLY OK (zero new) | OK |

**Validation result:** OK — zero blockers, zero advisory recommendations. The zero-new-deps stance is verified empirically: 5 plan-cited deps already present in `examples/chat-with-memory/package.json` (or root `package.json` for the workspace dep) at matching pins.

## Soft cap rationale

`soft_floor_pre_existing_allowlisted_moderate` — same 4+2 = 6 pre-existing MODERATE findings carry forward unchanged from prior cycles. Identical posture to v0.7 SDK cycle (just-shipped `7dc06f9`), v0.4b-fixes, voyager-skill-library v0.6, voyager-skill-library-fixes v0.6.1, Cycle 1 + Cycle 2 adapters, F-T4.1-2. Composite verdict caps at PASS_WITH_CAVEATS (89) because the allowlist downgrade applies (CVE-level severity now LOW); neither regressing NOR improving supply-chain hygiene.

## Recommended next steps

1. **No actions required** — zero plan deps changes. Plan's "zero-new-deps" stance verified empirically: all 5 plan-cited deps already present in manifest with matching pins.
2. **Proceed to `/plan-confidence examples-chat-with-memory-v0-7-distillation`.**
3. **Re-audit before sunset 2026-08-23** — verify drizzle-kit upstream migrated to tsx OR extend allowlist.
4. **Re-audit before sunset 2026-08-29** — verify next bundles postcss>=8.5.10 OR extend allowlist.

## Verdict statement

**PASS_WITH_CAVEATS.** Plan introduces **ZERO new dependencies** (verified by Mode 2 cross-reference against the demo's `package.json` + root workspace `@usetheo/memory@0.0.0-rc.2`). All 5 cited deps already present in the appropriate manifest at matching pins. No new CVE introduced. The 6 pre-existing MODERATE findings (drizzle-kit esbuild chain at root + next/postcss XSS at demo) carry forward byte-identical from 6 prior cycles. `/plan-confidence` will not cap below 89 due to deps. Rule 9 trivially satisfied (no new deps to evaluate).

Stable identifier of soft cap (audit trail): `soft_floor_pre_existing_allowlisted_moderate`.
