# Deps Audit: memory-contract-v0-0

**Date:** 2026-05-22
**Mode:** plan-bound:memory-contract-v0-0
**Verdict:** **FAIL_MEDIUM**
**Hard caps triggered:** `plan_dep_medium_cve` (×4, all rooted at declared `vitest@^1.5.0`), `plan_dep_peer_conflict` (custom rubric extension: declared `typescript-eslint@^7.0.0` is peer-incompatible with declared `eslint@^9.0.0`)
**Plan-confidence cap:** 70 (SHIPPABLE_WITH_CAVEATS at most)

## Summary

- **Ecosystems detected:** npm (declared by plan; no manifests exist yet — plan T0.1 creates `package.json`).
- **Auditor coverage:**
  - `npm audit` — ran (against sandbox lockfile generated at `/tmp/themory-deps-audit-2026-05-22/`, `npm install --package-lock-only`)
  - `npm view {pkg}@{range}` — ran for all 6 declared NEW deps (registry existence verification)
  - `osv-scanner` — **SKIPPED** (binary not installed; npm audit covers the npm ecosystem). Cap effect: NONE for this run since no other ecosystem is in scope; flagged for future installation if Python/Rust/Go ever enter the plan.
  - `pip-audit`, `cargo audit`, `govulncheck` — N/A (no Python/Rust/Go in plan).
- **Total deps audited:** 6 direct (declared NEW) + 132 transitive (resolved tree once corrections applied).
- **Vulnerabilities found (against plan-as-declared):** 0 CRITICAL, 0 HIGH, **4 MEDIUM (moderate)**, 0 LOW.
- **Vulnerabilities (with corrected versions — see § Diff suggestions):** **0** at every severity.
- **Outdated:** N/A for v0.0 since no current manifest exists; deps will be fresh on T0.1 install.
- **Allowlist hits:** none (allowlist file is empty as of 2026-05-22).
- **Peer-dep conflict (manifest coherence, NOT CVE):** 1 (`typescript-eslint@^7.0.0` requires `eslint@^8.56.0`; plan declares `eslint@^9.0.0`).

## Vulnerabilities (sorted by severity)

### Finding F1 — GHSA-67mh-4wv8-2f99 — MEDIUM (transitive: vitest → vite → esbuild)

- **Title:** esbuild enables any website to send any requests to the development server and read the response
- **CVSS:** 5.3 (`CVSS:3.1/AV:N/AC:H/PR:N/UI:R/S:U/C:H/I:N/A:N`)
- **CWE:** CWE-346 (Origin Validation Error)
- **Affected:** `esbuild <= 0.24.2` (transitive via `vitest@^1.5.0` → `vite` → `esbuild`)
- **Plan reference:** declared `vitest@^1.5.0` resolves to `vitest@1.6.1` which pulls vulnerable esbuild.
- **Fix path:** upstream — bump `vitest` to `^4.0.0+`. Resolves to `vitest@4.1.7` → `vite@7.x` → `esbuild@0.25.x` (clean).
- **Dev-only impact:** esbuild here is consumed by Vite's dev server (test runner). Production runtime is NOT exposed. Severity rubric does NOT discount for dev-only, so cap 70 stands.

### Finding F2 — GHSA-4w7w-66w2-5vf9 — MEDIUM (transitive: vitest → vite)

- **Title:** Vite Vulnerable to Path Traversal in Optimized Deps `.map` Handling
- **CVSS:** 0 (not scored publicly; advisory severity is MEDIUM)
- **CWE:** CWE-22 (Path Traversal), CWE-200 (Information Exposure)
- **Affected:** `vite <= 6.4.1` (transitive via `vitest@^1.5.0`)
- **Plan reference:** declared `vitest@^1.5.0` resolves to `vitest@1.6.1` → `vite@5.x` (vulnerable).
- **Fix path:** same as F1 — bump `vitest` to `^4.0.0+`.

### Finding F3 — chained — MEDIUM (transitive: vitest → vite-node)

- **Title:** Chained from F2 (vite-node depends on vulnerable vite).
- **Affected:** `vite-node <= 2.2.0-beta.2`
- **Fix path:** same — bump vitest.

### Finding F4 — chained — MEDIUM (vitest itself)

- **Title:** vitest@^1.5.0 falls in vulnerable range due to F1+F2 chain.
- **Affected:** `vitest 0.0.1 - 0.0.12 || 0.0.29 - 0.0.122 || 0.3.3 - 2.2.0-beta.2`
- **Plan reference:** declared `vitest@^1.5.0` is INSIDE the vulnerable range.
- **Fix path:** bump to `vitest@^4.0.0` (MAJOR bump; resolves all 4 findings simultaneously).

## Manifest coherence — peer-dep conflict (not a CVE, but blocks plan execution)

### Finding F5 — typescript-eslint@7 vs eslint@9 peer conflict (stable id: `plan_dep_peer_conflict`)

- **Detected via:** `npm install --package-lock-only` on the declared set returns `ERESOLVE` error:
  ```
  Found: eslint@9.39.4
  Could not resolve dependency:
  peer eslint@"^8.56.0" from typescript-eslint@7.18.0
  Fix the upstream dependency conflict, or retry this command with --force or --legacy-peer-deps...
  ```
- **Root cause:** `typescript-eslint@7.x` declares peer `eslint: ^8.56.0`. `typescript-eslint@8.x` added support for `eslint: ^8.57.0 || ^9.0.0 || ^10.0.0`.
- **Plan reference:** declared `eslint@^9.0.0` (T0.3 Dependencies section) + declared `typescript-eslint@^7.0.0` (same section). The two are mutually unresolvable.
- **Fix path:** bump declared range to `typescript-eslint@^8.0.0`. Verified: `npm install --package-lock-only` succeeds with that combination, resolving to `typescript-eslint@8.59.4`.
- **Severity classification:** custom extension of the rubric. Stable identifier `plan_dep_peer_conflict`. Closest existing rubric row is `plan_dep_not_on_registry` (49 cap), but the version IS on the registry — it just doesn't compose with the rest of the plan. Honest cap is 70: the plan cannot be implemented as-written (would require `--legacy-peer-deps`, which violates strict deps hygiene per `architecture.md § 7`).

## Diff suggestions (apply manually to the plan, NOT to any manifest — manifests don't exist yet)

### Suggestion 1 — bump `vitest` (resolves F1-F4)

```diff
- | `vitest` | `^1.5.0` | devDep | ... |
+ | `vitest` | `^4.0.0` | devDep | ... |
```

**Rule 9 column update required:** the v1.x → v4.x bump deserves a refreshed rationale. Vitest 2.x → 3.x → 4.x changes include API surface evolution (e.g., browser mode redesign, ES2024 target). Verify `expectTypeOf` API surface still works at v4 (it does — type-testing is stable since 1.x). Add note in Rule 9: "Bumped from ^1.5.0 to ^4.0.0 on 2026-05-22 to resolve GHSA-67mh-4wv8-2f99 + GHSA-4w7w-66w2-5vf9 + chained vite/vite-node advisories. v4.x preserves the `expectTypeOf` + `typecheck` config surface this plan relies on."

### Suggestion 2 — bump `typescript-eslint` (resolves F5)

```diff
- | `typescript-eslint` | `^7.0.0` | devDep | ... |
+ | `typescript-eslint` | `^8.0.0` | devDep | ... |
```

**Rule 9 column update required:** add "Bumped from ^7.0.0 to ^8.0.0 on 2026-05-22 to resolve peer-dep conflict with eslint@^9.0.0. v8.x added support for ESLint 9 + 10 (peer `^8.57.0 || ^9.0.0 || ^10.0.0`); same unified-package shape preserved."

### Suggestion 3 — note in `## Dependencies` opening preamble

```diff
> Mandatory section per `cycle-plan.md` v1.1 + `deps-audit-golden-rule.md`. Every entry pinned with version range; every NEW entry carries Rule-9 evaluation.
+ > **Audit status (2026-05-22):** verified via sandbox `npm install --package-lock-only` + `npm audit` against the declared set. Two corrections applied post-audit: vitest ^1.5.0 → ^4.0.0 (F1-F4 medium CVEs) and typescript-eslint ^7.0.0 → ^8.0.0 (F5 peer conflict). See `.claude/knowledge-base/audits/memory-contract-v0-0-deps-audit-2026-05-22.md`.
```

## Plan validation table (Mode 2)

| Plan dep | Section | On registry? | Range resolves? | Audit clean (as declared)? | Rule 9 OK? | Verdict |
|---|---|---|---|---|---|---|
| `typescript` | NEW | yes (5.4.0–5.9.3+ exist) | yes (resolves to 5.9.3) | **yes (0 CVE)** | yes (nothing rejected — declared as project compile target, mandatory) | OK |
| `vitest` | NEW | yes | yes (resolves to 1.6.1) | **NO — 4 MEDIUM CVEs** | yes (rejected: jest / node:test / tsc-only) | **FAIL_MEDIUM — bump to ^4.0.0** |
| `@types/node` | NEW | yes | yes (resolves to 20.19.41) | yes (type defs, no runtime) | yes (declared mandatory; no alternative) | OK |
| `eslint` | NEW | yes | yes (resolves to 9.39.4) | yes (0 CVE) | yes (rejected: biome / oxlint / tslint) | OK |
| `typescript-eslint` | NEW | yes | **NO — peer conflict with eslint@^9** | n/a (resolution fails) | yes (rejected: stale `@typescript-eslint/*` packages) | **FAIL_PEER — bump to ^8.0.0** |
| `eslint-plugin-import` | NEW | yes | yes (resolves to 2.32.0) | yes (0 CVE) | yes (rejected: eslint-plugin-import-x / oxlint built-in) | OK |

## Allowlist consideration

`.claude/rules/deps-audit-allowlist.txt` is currently empty (project just stood up). **Do NOT allowlist these findings** — the fix (MAJOR bump on vitest, MINOR bump on typescript-eslint) is cheap and clean. Allowlist exists for "bumping requires Q3 regression suite rerun, scheduled" scenarios, not for "we haven't bothered yet". Per `deps-audit-golden-rule.md § Allowlist mechanism`: rationale must be SPECIFIC; "WIP / TODO / later" not accepted.

## Auditor coverage gap (informational)

`osv-scanner` is NOT installed on this machine. The cross-ecosystem unified-pass step in the skill is skipped. For this audit's scope (npm-only), it makes no difference — `npm audit` provides GitHub Advisory data that osv-scanner's npm dataset can lag. Flagged for future installation: when Python or Rust ecosystems enter a plan, install `osv-scanner` first to ensure `auditor_unavailable_osv-scanner` doesn't cap a future audit at 70.

## Recommended next steps

1. **Apply Diff Suggestion 1** to the plan's `## Dependencies` table: bump `vitest@^1.5.0 → ^4.0.0` with refreshed Rule 9 rationale.
2. **Apply Diff Suggestion 2** to the plan's `## Dependencies` table: bump `typescript-eslint@^7.0.0 → ^8.0.0` with refreshed Rule 9 rationale.
3. **Apply Diff Suggestion 3** preamble note documenting the audit and corrections.
4. **Re-run `/deps-audit memory-contract-v0-0`** to confirm verdict moves to **PASS**.
5. **Proceed with `/plan-confidence`** once verdict is PASS or PASS_WITH_CAVEATS.

## Verdict summary (final)

| Aspect | Value |
|---|---|
| Verdict | **FAIL_MEDIUM** |
| Plan-confidence cap (if not corrected) | **70** |
| Hard caps triggered | `plan_dep_medium_cve` (×4), `plan_dep_peer_conflict` (×1) |
| Path to PASS | Apply Diff Suggestions 1+2; re-run audit |
| Estimated effort to fix | 2 cell edits in the `## Dependencies` table (one row per suggestion) + ~3 lines of refreshed Rule 9 rationale per row |

**Audit produced 2026-05-22 by `/deps-audit` skill. Sandbox lockfile preserved at `/tmp/themory-deps-audit-2026-05-22/` for reproducibility (NOT committed; will be cleaned up on `/tmp` rotation).**

---

## Re-audit confirmation (2026-05-22, after corrections applied to plan v1.1 → v1.2)

After Suggestions 1 + 2 + 3 absorbed into the plan (bump vitest → ^4.0.0; bump typescript-eslint → ^8.0.0; audit preamble added to `## Dependencies`), the sandbox re-audit returns:

```json
{
  "vulnerabilities": {
    "info": 0,
    "low": 0,
    "moderate": 0,
    "high": 0,
    "critical": 0,
    "total": 0
  }
}
```

- **Resolution:** clean. 132 packages resolved without peer-warnings or ERESOLVE errors.
- **Direct resolved versions on corrected set:**
  - `@types/node` @ 20.19.41
  - `eslint` @ 9.39.4
  - `eslint-plugin-import` @ 2.32.0
  - `typescript` @ 5.9.3
  - `typescript-eslint` @ 8.59.4
  - `vitest` @ 4.1.7

**Final verdict: PASS.** Plan-confidence cap: NONE (no caps active from `/deps-audit`). Plan is cleared to advance to `/plan-confidence`.

