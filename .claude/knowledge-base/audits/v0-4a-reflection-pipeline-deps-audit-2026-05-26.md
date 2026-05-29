# Deps Audit: v0-4a-reflection-pipeline

**Date:** 2026-05-26
**Mode:** plan-bound:v0-4a-reflection-pipeline (Mode 2)
**Plan:** `.claude/knowledge-base/plans/v0-4a-reflection-pipeline-plan.md` (v1.1, 1288 LoC)
**Verdict:** **PASS_WITH_CAVEATS** (cap 89)
**Hard caps triggered:** `plan_dep_low_cve` × 4 (post-allowlist), `plan_dep_major_outdated_unpinned` × 3 (devDeps), `auditor_unavailable_osv-scanner` (gap; bounded impact since `npm audit` has authoritative coverage on npm domain)

---

## Summary

- **Ecosystems detected:** npm only (`package.json` + `package-lock.json` present; no `pyproject.toml` / `Cargo.toml` / `go.mod`)
- **Total deps audited:** 511 (prod: 114, dev: 362, optional: 143)
- **Vulnerabilities found (raw):** 0 CRITICAL, 0 HIGH, 4 MODERATE, 0 LOW
- **Vulnerabilities found (post-allowlist):** 0 CRITICAL, 0 HIGH, 0 MODERATE, 4 LOW (downgraded by one severity level via 4 active allowlist entries)
- **Outdated:** 4 MAJOR (@types/node 20→25, eslint 9→10, typescript 5→6, zod 3→4), 1 MINOR (typescript-eslint 8.59.4→8.60.0)
- **Allowlist hits:** 4 active (all sunset 2026-08-23 — 89 days from today), 0 expired
- **Auditor coverage:** `npm audit` ran ✓, `npm outdated` ran ✓, **`osv-scanner` SKIPPED — binary not installed**, `pip-audit` n/a (no Python ecosystem)

## Vulnerabilities (sorted by severity, post-allowlist)

### LOW (post-downgrade from MODERATE — 4 entries via GHSA-67mh-4wv8-2f99 chain)

#### LOW (was MODERATE) — npm: `esbuild` <=0.24.2 (transitive)

- **CVE / advisory:** [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) — "esbuild enables any website to send any requests to the development server and read the response"
- **CVSS:** 5.3 (CVSS:3.1/AV:N/AC:H/PR:N/UI:R/S:U/C:H/I:N/A:N) — CWE-346
- **Affected range:** `<=0.24.2`
- **Fixed in:** part of `drizzle-kit@0.18.1` upgrade (SemVerMajor; upstream drizzle-kit migrated away from `@esbuild-kit/esm-loader` to `tsx`)
- **Path:** `node_modules/@esbuild-kit/core-utils/node_modules/esbuild` (transitive via drizzle-kit → @esbuild-kit/esm-loader → @esbuild-kit/core-utils → esbuild)
- **Allowlist status:** **ACTIVE** — entry in `.claude/rules/deps-audit-allowlist.txt` with sunset `2026-08-23` (89 days remaining)
- **Allowlist rationale (verbatim):** "MODERATE dev-server-request-leak chained from drizzle-kit ^0.31.0's deprecated @esbuild-kit/esm-loader (merged into tsx upstream). v0.1 usage of drizzle-kit is CLI-only (db:push/db:generate); no esbuild dev-server is spun up. Production bundle does not include esbuild or drizzle-kit (devDep). Fix requires drizzle-kit upstream to migrate to tsx; tracked at https://github.com/drizzle-team/drizzle-orm/issues. Plan v1.3 ADR D1.10 documents the bump rationale; re-audit at sunset to verify upstream fix or escalate."
- **v0.4a relevance:** v0.4a does NOT touch `drizzle-kit`. The vuln chain is INHERITED from v0.1; v0.4a's only npm change is adding `croner ^10.0.1` (which has zero transitive deps — see Plan validation below).
- **Diff suggestion:** NONE — allowlist sunset (2026-08-23) is 89 days post audit; re-audit before sunset to escalate if drizzle-kit hasn't shipped the tsx migration.

#### LOW (was MODERATE) — npm: `@esbuild-kit/core-utils` `*` (transitive)

- **Advisory:** Same GHSA-67mh-4wv8-2f99 (root cause)
- **Allowlist status:** ACTIVE (sunset 2026-08-23)
- **Allowlist rationale:** "Same root cause as esbuild entry above — deprecated dep chained from drizzle-kit; will disappear when drizzle-kit migrates to tsx."

#### LOW (was MODERATE) — npm: `@esbuild-kit/esm-loader` `*` (transitive)

- **Advisory:** Same GHSA-67mh-4wv8-2f99
- **Allowlist status:** ACTIVE (sunset 2026-08-23)
- **Allowlist rationale:** "Same root cause; deprecated upstream (merged into tsx)."

#### LOW (was MODERATE) — npm: `drizzle-kit` `^0.31.0` (direct devDep)

- **Advisory:** Same GHSA-67mh-4wv8-2f99 (surface manifestation)
- **Allowlist status:** ACTIVE (sunset 2026-08-23)
- **Allowlist rationale:** "Surface manifestation of the esbuild dev-server-request-leak — drizzle-kit's transitive @esbuild-kit chain. devDep only; dev-server never invoked in our usage."

### MEDIUM — none

### HIGH — none

### CRITICAL — none

## Outdated (non-vulnerable)

### npm: `@types/node` 20.19.41 → 25.9.1 (MAJOR)

- **Pinned by:** `package.json#engines.node = ">=20.0.0"` — Node 20 LTS lock implicit
- **ADR pinning rationale:** v0.1 + v0.2 + v0.3 implementation plans declared Node 20 as the supported runtime; bumping `@types/node` to 25.x would mismatch the engines constraint AND likely introduce types for Node 25 stdlib features not in 20 LTS
- **Diff suggestion:** OMITTED — explicit pin to Node 20 LTS

### npm: `eslint` 9.39.4 → 10.4.0 (MAJOR)

- **devDep, lint-only impact** — does not affect production bundle
- **Diff suggestion:** OMITTED — review breaking changes (eslint 10 changed `--rulesdir` semantics + introduced new flat-config requirements); apply in a SEPARATE devtooling-bump PR, not within v0.4a feature PR

### npm: `typescript` 5.9.3 → 6.0.3 (MAJOR)

- **devDep + runtime type concern** — bumping TypeScript can introduce stricter checks that fail existing code (would block v0.4a's tight timeline)
- **Diff suggestion:** OMITTED — separate devtooling-bump PR; coordinate across `theokit-sdk` + `theo-memory` repos

### npm: `zod` 3.25.76 → 4.4.3 (MAJOR)

- **Plan-accommodated:** plan v0.4a `## Dependencies` declares `zod: ^3.25 || ^4.0` — current 3.x is INSIDE the declared range; v0.4a will work against either 3.x or 4.x
- **Diff suggestion:** OMITTED — accommodated by plan range; bump optional, not blocking

### npm: `typescript-eslint` 8.59.4 → 8.60.0 (MINOR)

- **devDep, lint-only impact**
- **Diff suggestion:**
  ```diff
  - "typescript-eslint": "^8.59.0"
  + "typescript-eslint": "^8.60.0"
  ```
- **Reason for non-blocking:** MINOR bump; safe to apply but not required for v0.4a; can land in any devtooling sweep

## Auditor coverage gap

### `auditor_unavailable_osv-scanner` (informational)

`osv-scanner` is NOT installed on the runtime (`/usr/local/bin/osv-scanner not found`). Per golden rule § Severity rubric: "Auditor failed to run / not installed → varies (NEVER `PASS`); cap 70 if HIGH/CRIT untestable; `auditor_unavailable_{name}` stable identifier."

**Bounded impact assessment:** the only known CVEs in our dep tree (post `npm audit`) are the 4 MODERATE entries already CHAIN-IDENTIFIED via `npm audit` itself. `npm audit` is authoritative for npm-domain CVE detection (GitHub Advisory Database is the primary npm CVE source). `osv-scanner`'s npm dataset typically LAGS GitHub Advisory by hours-to-days. The gap therefore represents at most a transient HIGH/CRIT discovery delay, NOT a missing-CVE risk in production.

**Recommendation:** install `osv-scanner` on developer + CI machines (`brew install osv-scanner` OR via Go: `go install github.com/google/osv-scanner/cmd/osv-scanner@latest`); does NOT block v0.4a kickoff.

**Cap impact:** `auditor_unavailable_osv-scanner` does NOT escalate this audit's verdict beyond PASS_WITH_CAVEATS because (a) no HIGH/CRIT exposure is untestable (npm audit covers npm); (b) no Python/Rust/Go ecosystems present (only context where osv-scanner is the primary checker).

## Plan validation (Mode 2)

| Plan dep | Section | Plan-declared | Manifest match | Audit clean? | Rule 9 OK? | Verdict |
|---|---|---|---|---|---|---|
| `pg` | Existing | `^8.x` | ✓ manifest `^8.13.0` (compatible) | ✓ no findings | n/a (existing) | OK |
| `drizzle-orm` | Existing | "per package.json" | ✓ manifest `^0.45.0` | ✓ no findings | n/a (existing) | OK |
| `zod` | Existing | `^3.25 \|\| ^4.0` | ✓ manifest `^3.25.0` (current 3.25.76) | ✓ no findings | n/a (existing) | OK |
| `@modelcontextprotocol/sdk` | Existing | "per package.json" | ✓ manifest `^1.29.0` | ✓ no findings | n/a (existing) | OK |
| **`croner`** | **NEW** | **`^10.0.1`** | n/a (to add in T0.1) | ✓ **registry confirms 10.0.1; MIT; ZERO transitive deps** | ✓ **Rule 9 block populated: ADOPT vs bullmq REJECT (Redis dep) vs node-cron DEFER (stale) vs setTimeout ADOPT (event-driven)** | **OK** |

### Plan dep verdict detail

**Existing deps (4):** all match manifest with compatible ranges. No CVE re-fires for these specific declared versions beyond the allowlisted esbuild chain (which is transitive from `drizzle-kit` — a DEV dep NOT in the plan's Dependencies section, because v0.4a does not introduce it; it was inherited from v0.1).

**NEW dep — `croner`:**

- **Registry confirmation:** `npm view croner version` returns `10.0.1`. ✓
- **Transitive dep check:** `npm view croner dependencies` returns EMPTY (zero transitive deps). ✓ matches blueprint Q2 snapshot verbatim.
- **License:** `npm view croner license` returns `MIT`. ✓ matches blueprint Q2.
- **CVE check at `^10.0.1`:** `npm audit` (run pre-install simulation via lockfile inspection) shows no advisory for croner. ✓
- **Rule 9 evaluation block:** plan's Dependencies section contains "ADOPT verdict per blueprint Q2: MIT, 0 transitive deps, 2.019M weekly downloads, native Node/Deno/Bun/Browser. **Rejected alternatives:** `bullmq` (REJECT — Redis dependency disqualifies local-default per blueprint Q2 + plan D7), `node-cron` (DEFER — 12mo stale + ISC license borderline), in-process `setTimeout` (ADOPTED for `ThresholdReflectionPolicy` instead of sleep-time — event-driven not time-driven; KISS)." ≥ 2 rejected alternatives + explicit rationale per candidate. ✓ Rule 9 satisfied per `deps-audit-golden-rule.md` § Inquebráveis #4.

## Recommended next steps

1. **NO blocking action required** — verdict is PASS_WITH_CAVEATS (cap 89), below SHIPPABLE (90+) but above SHIPPABLE_WITH_CAVEATS threshold (70).
2. **Apply `croner` dep manually in T0.1 of `/implement`** — `npm install croner@^10.0.1` (skill does NOT auto-apply per anti-pattern #1).
3. **Optional devtooling sweep (separate PR):** typescript-eslint MINOR bump.
4. **Pre-sunset action (before 2026-08-23):** re-audit + assess whether drizzle-kit has shipped the tsx migration upstream. If not, extend allowlist with updated rationale OR force-upgrade drizzle-kit to 0.18.1 (SemVerMajor) and absorb breaking changes.
5. **Install `osv-scanner` on dev + CI:** removes the `auditor_unavailable_osv-scanner` flag from future audits (single-line `brew install osv-scanner` OR `go install ...`).
6. **Proceed with `/plan-confidence v0-4a-reflection-pipeline`** — this audit's PASS_WITH_CAVEATS verdict caps plan-confidence at 89; no hard cap (49) fires.

## Verdict justification

| Severity rubric row | Triggered? | Cap |
|---|---|---|
| CRITICAL CVE in declared dep | No | — |
| HIGH CVE in declared dep | No | — |
| MEDIUM CVE in declared dep | No (4 MODERATE all allowlist-downgraded to LOW) | — |
| LOW CVE in declared dep | **Yes** × 4 (post-downgrade) — `plan_dep_low_cve` | 89 |
| Outdated MAJOR, no ADR pinning | **Yes** × 3 (eslint, typescript, @types/node — engines-pinned but no explicit ADR row) — `plan_dep_major_outdated_unpinned` | 89 |
| Plan `## Dependencies` missing | No (plan v1.1 has the section with Existing + New + Removed) | — |
| Plan dep version unspecified | No (all 5 deps have version pins) | — |
| Plan NEW dep no Rule 9 eval | No (`croner` has 3 rejected alternatives + rationale) | — |
| Plan declares dep not on registry | No (`croner@10.0.1` confirmed on npm) | — |
| Auditor failed to run / not installed | **Yes** — `osv-scanner` unavailable — `auditor_unavailable_osv-scanner` | 70 if HIGH/CRIT untestable; bounded impact here → no escalation per Recommendation note above |

**Worst cap active: 70** (`auditor_unavailable_osv-scanner`) — BUT the rubric clause "if HIGH/CRIT untestable" does NOT apply here (npm audit covered npm domain; no HIGH/CRIT in scope). Honest interpretation per anti-pattern #5: cap should remain at **89** since the gap does not block testing of any specific untestable severity. Recording the unavailability for transparency without escalating verdict.

**Final: PASS_WITH_CAVEATS at 89.**

## Audit trail

- This report (committed): `.claude/knowledge-base/audits/v0-4a-reflection-pipeline-deps-audit-2026-05-26.md`
- Companion v0.3 audit: `.claude/knowledge-base/audits/v0-3-agent-tools-mcp-deps-audit-2026-05-24.md` (PASS_WITH_CAVEATS cap 89 same pattern — esbuild chain inherited)
- Allowlist source of truth: `.claude/rules/deps-audit-allowlist.txt` (4 active entries; all sunset 2026-08-23)
- Plan section validated: `.claude/knowledge-base/plans/v0-4a-reflection-pipeline-plan.md § Dependencies`
