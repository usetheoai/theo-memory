---
slug: fix-lint-brace-expansion
created_at: 2026-07-25
goal: Unbreak `npm run lint` (broken by the blanket brace-expansion>=5.0.8 override) via a scoped minimatch@3 override, keeping production CVE mitigation.
issue: 138
kind: hotfix
---

# Plan: Unbreak `npm run lint` — scoped brace-expansion override (#138)

> **Hotfix (ad-hoc, no roadmap milestone — ROADMAP M0–M22 already complete).** `npm run lint` throws `TypeError: expand is not a function` at ESLint config-array construction because #123's blanket `pnpm.overrides["brace-expansion"]=">=5.0.8"` forces eslint's `minimatch@3.1.5` (needs CJS `brace-expansion@^1.1.7` function export) onto ESM `brace-expansion@5.x`. Fix = scoped override `"minimatch@3>brace-expansion": "1.1.16"` (eslint dev path only) while keeping `">=5.0.8"` for production; accept the residual dev-only advisory via the deps-audit allowlist (ADR-0024).

## Goal

> "Restore `npm run lint` to exit 0 (config loads, 0 violations) so the repo-wide lint gate works again, measured by `npm run lint` exiting 0 AND production brace-expansion staying `>=5.0.8` AND the full contract suite staying green."

## Context

Root cause (DISCOVER, cited): `minimatch@3.1.5` (`npm view minimatch@3.1.5 dependencies` → `brace-expansion: ^1.1.7`) consumes brace-expansion as a CJS default function; `brace-expansion@5.0.8` is ESM (`"type":"module"`, named export). The advisory GHSA-mh99-v99m-4gvg patches only `>=5.0.8`, and no released `minimatch` uses 5.x — a genuine conflict. See ADR-0024 + `.claude/knowledge-base/discoveries/blueprints/` (folded into ADR-0024).

## ADRs

See **ADR-0024** (scoped override + accepted dev-only residual). Alternatives (blanket keep / per-major global pins / eslint upgrade) weighed and rejected there.

## Drawbacks & Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Residual GHSA-mh99-v99m-4gvg on the eslint dev path | Low (dev-only, trusted-glob input) | Allowlisted with 90-day sunset (ADR-0024); production stays 5.0.8 |
| `pnpm install` shifts other resolutions | Low | Full contract suite re-run green (1377); lockfile diff reviewed |

## Unresolved Questions

- Q1 — When will eslint/minimatch adopt brace-expansion 5.x? (Unknown; sunset 2026-10-23 forces a revisit.)

## Tasks

### T1 — Scoped override + reinstall (the fix)

- Replace blanket `"brace-expansion": ">=5.0.8"` → keep it AND add `"minimatch@3>brace-expansion": "1.1.16"`.
- `pnpm install`.
- **Acceptance:** `npm run lint` exit 0; `grep brace-expansion pnpm-lock.yaml` shows 5.0.8 on production paths + 1.1.16 only via minimatch@3; the residual advisory path is exactly `.>eslint>minimatch>brace-expansion`.

### T2 — Accept residual + document

- deps-audit-allowlist.txt entry (GHSA-mh99-v99m-4gvg, dev-only, sunset 2026-10-23) + ADR-0024 + CHANGELOG.
- **Acceptance:** allowlist entry present; ADR-0024 written; CHANGELOG Fixed (#138) + Changed (allowlist) updated.

## Coverage Matrix

| Requirement | Task |
|---|---|
| lint exit 0 | T1 |
| production brace-expansion >=5.0.8 | T1 |
| residual dev-only, accepted | T2 |
| full suite green | Final |

## Global Definition of Done

- [ ] `npm run lint` exit 0 (0 violations).
- [ ] Production brace-expansion `>=5.0.8`; only minimatch@3 (eslint dev) on 1.1.16.
- [ ] Residual advisory allowlisted (sunset ≤ 90d) + ADR-0024 + CHANGELOG.
- [ ] `npm test` full suite green; `npm run typecheck` clean.

## Final Phase: Integration Validation

- [ ] `pnpm install` clean; `npm run lint` exit 0; `npm test` 1377 green; `npm run typecheck` exit 0.
- [ ] `pnpm audit` residual = only the dev-only eslint/minimatch brace-expansion path (accepted).
