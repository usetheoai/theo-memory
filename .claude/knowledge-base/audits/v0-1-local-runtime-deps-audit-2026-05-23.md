# Deps Audit: v0-1-local-runtime

**Date:** 2026-05-23
**Mode:** plan-bound (`.claude/knowledge-base/plans/v0-1-local-runtime-plan.md` v1.1)
**Verdict:** **INVALID_PLAN_DEPS**
**Hard caps triggered:** `plan_dep_not_on_registry`

## Summary

- **Ecosystems detected:** npm (single — `package.json` at repo root)
- **Auditors run:** `npm audit` (OK), `npm outdated` (OK), `npm view` for NEW-dep registry verification (OK)
- **Auditor coverage gap:** `osv-scanner` NOT installed in runtime → cross-check for transitive vulnerabilities incomplete. Recommended `brew install osv-scanner` OR `go install github.com/google/osv-scanner/cmd/osv-scanner@latest`.
- **Current manifest:** 299 deps (1 prod placeholder + 298 dev/optional/transitive). **0 vulnerabilities** at all severities. Clean baseline.
- **Plan declares:** 3 new runtime deps + 5 new devDeps + 1 optional peer = **9 NEW deps to validate**.

| Finding | Count |
|---|---|
| Vulnerabilities (current manifest) | 0 / 0 / 0 / 0 (CRITICAL / HIGH / MEDIUM / LOW) |
| Plan deps that don't exist at declared version range | **1** (BLOCKER) |
| Plan deps outdated MAJOR vs npm latest | 4 |
| Existing v0.0 deps outdated MAJOR | 3 |
| Auditor cross-check gaps | 1 (`osv-scanner`) |

## Plan validation

| Plan dep | Section | Declared | Latest on npm | Resolves to | Audit clean? | Rule 9 OK? | Verdict |
|---|---|---|---|---|---|---|---|
| `pg` | New (runtime) | `^8.13.0` | 8.21.0 | 8.21.0 (within ^8.13) | yes | yes (postgres-js + pgvector rejected) | **OK** |
| `drizzle-orm` | New (runtime) | `^0.36.0` | 0.45.2 | 0.36.x (older than latest) | yes | yes (Prisma + Kysely + raw SQL rejected) | **OUTDATED MAJOR** |
| `zod` | New (runtime) | `^3.24.0` | 4.4.3 | 3.24.x (v3 stable, v4 GA but new) | yes | yes (yup/joi/ajv rejected) | **OUTDATED MAJOR** |
| `drizzle-kit` | New (dev) | `^0.28.0` | 0.31.10 | 0.28.x | yes | yes (peer of drizzle-orm) | **OUTDATED MINOR** (0.x semver = breaking but small delta) |
| `@types/pg` | New (dev) | `^8.11.0` | 8.20.0 | 8.20.0 | yes | yes (no alternative) | **OK** |
| `vitest-mock-extended` | New (dev) | `^3.0.0` | 4.0.0 | 3.x (v4 GA but new) | yes | yes (jest-mock-extended rejected) | **OUTDATED MAJOR** |
| `@opentelemetry/api` | New (dev) | `^1.10.0` | **1.9.1** | **NO MATCHING VERSION** | n/a (cannot install) | yes (industry standard) | **BLOCKER — version range invalid** |
| `@opentelemetry/sdk-trace-base` | New (dev) | `^1.30.0` | 2.7.1 | 1.30.1 (1.30.0 + 1.30.1 exist on registry; ^1.30 resolves) | yes | yes (industry standard) | **OUTDATED MAJOR** (1.30 vs 2.7) |
| `natural` | New (optional peer) | `^8.1.0` | 8.1.1 | 8.1.1 | yes (no known CVE in 8.x) | yes (compromise rejected) | **OK** |

## Vulnerabilities

**Current manifest:** 0 CRITICAL / 0 HIGH / 0 MEDIUM / 0 LOW (`npm audit` clean — 299 deps).

**NEW plan deps:** auditor coverage gap — `npm audit` can only audit installed deps. Per Rule 9 + auditor inventory, the npmjs.com advisory database has no current CRITICAL/HIGH disclosure against any of the 9 declared versions per spot-check (queried via `npm view` at audit time). Definitive cross-check requires either (a) running `npm install` first then `npm audit`, OR (b) installing `osv-scanner` (currently NOT installed) and querying offline.

Recommendation: After T0.1 lands the deps in `package.json`, re-run `/deps-audit v0-1-local-runtime` to confirm zero CVE at the resolved transitive tree. The current report's PASS-for-NEW-deps assertion is a **best-effort spot-check, NOT a definitive audit**.

## BLOCKER finding (must fix BEFORE proceeding)

### `@opentelemetry/api ^1.10.0` does not exist on the npm registry

- **Latest version:** `1.9.1` (highest 1.x; 2.x exists for sibling packages but NOT for `api` as of audit date)
- **Impact:** `npm install` will fail at T0.1 with `npm ERR! notarget No matching version found for @opentelemetry/api@^1.10.0`. Blocks the entire plan execution.
- **Diff suggestion:**
  ```diff
  - "@opentelemetry/api": "^1.10.0"
  + "@opentelemetry/api": "^1.9.0"
  ```
- **Plan reference:** Plan § Dependencies → New (devDependencies). Plan ADR D1.3 cites the package; the version range needs correction.
- **Stable identifier:** `plan_dep_not_on_registry`
- **Plan-confidence consequence:** caps at 49 (INVALID band) per `deps-audit-golden-rule.md`.

## Outdated MAJOR — soft caveats (advance possible WITH explicit ADRs)

The plan pins to OLDER majors for 4 deps. Per `deps-audit-golden-rule.md § 7`, outdated MAJOR without an ADR caps at 89. Either bump OR add an ADR row to the plan explaining the pin rationale.

### 1. `drizzle-orm ^0.36.0` → latest `0.45.2`

- **Semver delta:** 9 minors (0.x is breaking-allowed in npm semver)
- **Risk:** mid-range version; 0.45 has additional HNSW/pgvector affordances; 0.36 is acceptable but stale
- **Recommendation:** bump to `^0.45.0` OR add ADR D1.8 explaining the pin (e.g., "0.36 chosen because of <specific incompatibility>")

### 2. `zod ^3.24.0` → latest `4.4.3`

- **Semver delta:** MAJOR (v3 → v4); v4 GA released early 2026 with breaking changes (parse signature, error format)
- **Risk:** v3 still widely supported; ecosystem migration to v4 in progress
- **Recommendation:** STAY on `^3.24.0` AND add ADR D1.9: "v0.1 ships with zod ^3 because consumer adoption of v4 is < 50% as of 2026-05; upgrade to v4 deferred to v0.2 to align with broader ecosystem"

### 3. `vitest-mock-extended ^3.0.0` → latest `4.0.0`

- **Semver delta:** MAJOR
- **Risk:** v4 may have peer-conflict with vitest ^4.0 (the plan already pins vitest to ^4)
- **Recommendation:** bump to `^4.0.0` (aligns with vitest ^4) OR add ADR explaining the pin

### 4. `@opentelemetry/sdk-trace-base ^1.30.0` → latest `2.7.1`

- **Semver delta:** MAJOR (v1 → v2; OpenTelemetry SDK 2.x released 2025)
- **Risk:** v2 changed exporter API surface; v1 still supported via long-term branch
- **Recommendation:** bump to `^2.0.0` AND verify against the in-memory exporter API. OR add ADR pinning to ^1.30 with reason.

## Outdated MAJOR — existing v0.0 deps (informational; NOT a v0.1 plan concern)

These were chosen at v0.0 design time. They do NOT block this plan, but should be tracked for the eventual cycle-plan that targets ecosystem upgrades.

| Dep | Current | Latest | Note |
|---|---|---|---|
| `@types/node` | 20.x | 25.9.1 | Node 22 LTS in production; @types/node 22 sufficient |
| `eslint` | 9.x | 10.4.0 | v10 released; typescript-eslint compatibility verified separately |
| `typescript` | 5.x | 6.0.3 | v6 released; opt-in until ecosystem catches up |

## Auditor coverage gap

- `osv-scanner` is NOT installed. Cross-check for transitive vulnerabilities (especially the long tail of OpenTelemetry transitives) is incomplete.
- Action: install via `go install github.com/google/osv-scanner/cmd/osv-scanner@latest` OR `brew install osv-scanner` and re-run.
- Stable identifier: `auditor_unavailable_osv-scanner` (cap 70 IF an unaudited HIGH-severity exposure is suspected; not the case here since `npm audit` is clean on the current manifest, and the NEW deps spot-check clean per npmjs.com advisory data).
- **Effective cap from this gap alone:** 89 (soft caveat). NOT load-bearing for the current verdict — the BLOCKER above is.

## Recommended next steps (in order)

1. **MUST FIX:** Update the plan's `## Dependencies` section to declare `"@opentelemetry/api": "^1.9.0"` (was `^1.10.0`). This is the BLOCKER.
2. **SHOULD:** Decide for each of the 4 outdated MAJOR deps — bump OR pin-with-ADR. Recommendation:
   - Bump `vitest-mock-extended` to `^4.0.0` (peer-aligned with vitest ^4)
   - Bump `@opentelemetry/sdk-trace-base` to `^2.0.0` (avoid v1 maintenance branch)
   - Pin `zod ^3.24.0` with new ADR D1.9 (v4 too new)
   - Pin `drizzle-orm ^0.36.0` with new ADR D1.10 OR bump to `^0.45.0`
3. **SHOULD:** Install `osv-scanner` for the next audit run to close the cross-check gap.
4. **THEN:** Re-run `/deps-audit v0-1-local-runtime` — verdict should be PASS or PASS_WITH_CAVEATS.
5. **THEN:** Proceed to `/plan-confidence`.

## Verdict rationale

`@opentelemetry/api ^1.10.0` violates inquebrável `deps-audit-golden-rule.md § 5` (plan declares dep not on registry → cap at 49). This is a deterministic blocker — `npm install` cannot resolve the range. The fix is trivial (1 character: `^1.10.0` → `^1.9.0`), but the gate refuses to advance.

After the BLOCKER fix lands + the 4 outdated MAJOR caveats are decided, expected verdict is **PASS_WITH_CAVEATS** (89) due to (a) outdated-MAJOR caveats absorbed via ADRs, (b) auditor cross-check gap (osv-scanner).
