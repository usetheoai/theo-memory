# SEPA — Iteration 1 / Task T0.1 / Phase pre-RED

## Plan recap
- T0.1 updates `package.json` to bump `zod ^3.24 → ^3.25` + add 2 NEW deps (`@modelcontextprotocol/sdk ^1.29.0`, `zod-to-json-schema ^3.x`), runs `npm install`, re-runs `/deps-audit`, then commits `package.json` + `package-lock.json`.

## Findings

- **[MAJOR] Chicken-and-egg on TDD test location.** Plan declares `tests/unit/agent-tools/package-deps.test.ts`. `tests/unit/` does NOT exist; project convention is `src/{module}/__tests__/`.
- **[MAJOR] Files-to-edit list incomplete.** Plan declares only `package.json` + `package-lock.json`. The 3 RED tests + test file are part of T0.1's deliverable per the TDD block.
- **[INFO] Deps-audit re-run post-install required** (Acceptance #3). Forward-looking 2026-05-24 audit used `npm view` cross-check; actual install may surface new transitive vulns.
- **[INFO] ADR cross-references:** D1/D2/D7 + Blueprint Q2.
- **[INFO] CHANGELOG.md update** under `[Unreleased]` → `Added` per Inquebrável Rule 6.
- **[INFO] No `Co-Authored-By` trailer** per project policy.

## Main session resolution

Honor project convention over plan literal: place RED test at `src/agent-tools/__tests__/package-deps.test.ts`. Extend `vitest.contract.config.ts` include glob to cover `agent-tools`. This creates `src/agent-tools/__tests__/` dir as part of T0.1 — mild T0.2 overlap (T0.2 will scaffold the rest of `src/agent-tools/`). Justified by `architecture.md § 7` (kebab-case files + colocated tests) and existing project convention. Plan task IDs unchanged.

## Recommended action (followed)

1. RED: create `src/agent-tools/__tests__/package-deps.test.ts` + extend vitest config + assert FAIL against current package.json
2. GREEN: apply 3 package.json edits + `npm install` + confirm PASS
3. POST-INSTALL AUDIT: re-run `/deps-audit` — HALT if regression
4. REFACTOR: minimal
5. WIRING: triad N/A (no new exported symbols)
6. SEPA pre-COMMIT
7. COMMIT with ADR D1/D2/D7 refs + CHANGELOG entry
