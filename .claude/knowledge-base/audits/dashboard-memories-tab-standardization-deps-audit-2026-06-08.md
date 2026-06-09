# Deps Audit: dashboard-memories-tab-standardization

**Date:** 2026-06-08
**Mode:** plan-bound:dashboard-memories-tab-standardization
**Plan path:** `.claude/knowledge-base/plans/dashboard-memories-tab-standardization-plan.md` (v1.1 — 5 MUST FIX absorbed `453e2be`)
**Verdict:** `INVALID_PLAN_DEPS` (structural — missing section) + 1 pre-existing CRITICAL surfaced separately
**Hard caps triggered:** `plan_dependencies_section_missing`

## Summary

- Ecosystems detected: **npm only** (no `pyproject.toml`, `go.mod`, `Cargo.toml` in theo-memory repo root; theo-cloud sibling has its own Go module + dashboard `package.json` audited separately)
- Total deps audited: 12 outdated direct + transitive tree via `npm audit`
- **Vulnerabilities found in resolved tree:** 1 CRITICAL, 3 HIGH, 4 MEDIUM, 0 LOW = **8 total**
- Outdated direct: 12 (mostly minor/patch; see § Outdated)
- Allowlist hits: 0 active / 0 expired
- Auditor coverage:
  - `npm audit`: RAN
  - `npm outdated`: RAN
  - `osv-scanner`: SKIPPED — binary not installed (`which osv-scanner` → not found)
  - `pip-audit`: SKIPPED — no python manifest
  - `govulncheck`: SKIPPED — no go.mod in theo-memory repo (theo-cloud BFF audited separately)

## Hard cap detail

### `plan_dependencies_section_missing` (cap 49)

**Per `rules/deps-audit-golden-rule.md § Severity rubric`:** every plan that introduces, uses, or removes a dependency MUST declare it explicitly in a `## Dependencies` section. The plan v1.1 has no such section.

**The plan implicitly uses:**
- `pg` (Postgres driver) — backend SELECT projection extension in T2.1
- `pgvector` extension — schema-level `created_at` column read
- `vitest` — test runner for new T1.1/T2.1/T2.2/T3.1 tests
- `@usetheo/ui` (theo-cloud repo) — DataTable + Tabs + Badge + Timestamp primitives in T3.2/T3.3
- `@usetheo/memory` (theo-cloud repo) — SHA-pinned consumer side per NEW T3.0

**No new packages introduced. Zero `npm install` of new pkgs.**

**Remediation:** add a `## Dependencies` section to plan v1.2 declaring the above as `Existing — use as-is` rows with version + ecosystem + why. Then re-run `/deps-audit dashboard-memories-tab-standardization`.

## Pre-existing vulnerabilities surfaced (separate from this plan)

These are CVEs in the resolved npm tree that EXIST today regardless of this cycle. They surface here for honest disclosure (Inquebrável Rule 3) but do NOT block THIS plan because the plan's modified files (`src/local/pgvector-store.ts`, `src/local/in-memory-store.ts`, `src/core/dip/vector-store.ts`) do NOT directly import the vulnerable chain.

### CVE chain — CRITICAL on `protobufjs <7.5.5` via `@xenova/transformers`

- **CVSS:** 9.8 (CWE-94 — Arbitrary code execution)
- **Path:** root → `@xenova/transformers@^1.x.x` → `onnxruntime-web` → `onnx-proto` → `protobufjs`
- **Additional CVEs in same chain:**
  - `protobufjs`: 1118641 (CWE-94 code injection through bytes field defaults)
  - `protobufjs`: 1118924 (CWE-20 DoS via crafted field names, CVSS 5.3)
  - `protobufjs`: 1118926 (CWE-1321 prototype injection, CVSS 5.3)
  - `protobufjs`: 1118928 (CWE-94 + CWE-1321 prototype-pollution code-gen gadget, CVSS 8.1)
  - 4 MEDIUM additional in `protobufjs` chain
- **Fix available:** `@xenova/transformers@2.0.1` (semver-major upgrade — breaking API change for the LocalTransformerEmbedder subpath)
- **Diff suggestion:**
  ```diff
  - "@xenova/transformers": "^1.x.x"
  + "@xenova/transformers": "^2.0.1"
  ```
  **OMITTED for production application** — semver-major upgrade requires verifying that `LocalTransformerEmbedder` (`src/local/embedders/local-transformer-embedder.ts`) still works against the v2 API.
- **Scope isolation:** `@xenova/transformers` is consumed ONLY via the optional subpath `@usetheo/memory/embedders/local`. Consumers NOT importing this subpath do NOT pull the vulnerable chain (bundle-isolation gate per EC-26 precedent). The default barrel `@usetheo/memory` is unaffected.
- **Plan relevance:** the plan does NOT touch the embedder. Integration test T3.1 uses `wireMemoryFromPool(pool)` which may default to a stub embedder OR the local one — implementer MUST verify which embedder the canonical write path uses in test mode, and if it's local-transformer, the CRITICAL is in the test runtime.
- **Recommended action:** open a SEPARATE dependency-upgrade cycle (`/to-plan deps-upgrade-xenova-transformers-v2-protobufjs-cve`) to handle the v2 semver-major migration. This plan can ship if either (a) test path uses stub embedder, OR (b) operator allowlists `protobufjs` with sunset ≤ 30 days per golden rule.

## Outdated (non-vulnerable) — top 12 direct deps

| Package | Current | Latest | Semver delta |
|---|---|---|---|
| `@apidevtools/swagger-parser` | 10.1.1 | 12.1.0 | MAJOR |
| `@hono/node-server` | 1.19.14 | 2.0.4 | MAJOR |
| `@hono/zod-openapi` | 0.18.4 | 1.4.0 | MAJOR |
| `@types/node` | 20.19.41 | 25.9.2 | MAJOR |
| `commander` | 12.1.0 | 14.0.3 | MAJOR |
| (7 more — see `npm outdated --json`) | — | — | — |

All MAJOR bumps OMITTED from diff suggestion per skill anti-pattern #7 (NEVER auto-upgrade). MAJOR review is its own cycle.

## Plan validation table

| Plan dep | Section in plan | Manifest match | Audit clean? | Rule 9 OK? | Verdict |
|---|---|---|---|---|---|
| `pg` | NOT DECLARED | `^8.x` resolved | YES | n/a (existing) | NEEDS DECLARATION |
| `pgvector` (PG extension) | NOT DECLARED | DB-side schema | n/a | n/a | NEEDS DECLARATION (informational — DB extension, not npm) |
| `vitest` | NOT DECLARED | `^x.y` resolved | YES | n/a (existing) | NEEDS DECLARATION |
| `@usetheo/ui` (cross-repo) | NOT DECLARED | resolved in theo-cloud sibling | YES (theo-cloud audit) | n/a (existing) | NEEDS DECLARATION |
| `@usetheo/memory` (consumer side, T3.0 SHA pin) | NOT DECLARED in plan; T3.0 pins SHA in theo-cloud | n/a (the plan IS `@usetheo/memory` from producer side) | YES | n/a | NEEDS DECLARATION |

## Recommended next steps

Per Inquebrável Rule 1 (95% confidence) — the operator decides between three remediation paths:

### Path A — Add `## Dependencies` section + allowlist `protobufjs` for 30 days (fastest, ships THIS cycle)

1. Add a `## Dependencies` section to `dashboard-memories-tab-standardization-plan.md` v1.2 with all 5 existing deps declared.
2. Add allowlist entry to `rules/deps-audit-allowlist.txt`:
   ```
   npm|protobufjs|<7.5.5|GHSA-1117571|Transitive via @xenova/transformers v1.x; v2 semver-major upgrade scheduled as separate dependency-upgrade cycle|2026-07-08
   ```
3. Re-run `/deps-audit` → expected `PASS_WITH_CAVEATS` (cap 89) due to allowlisted CRITICAL.
4. Proceed with `/plan-confidence` for the dashboard cycle.
5. In parallel, open `/to-plan deps-upgrade-xenova-transformers-v2-protobufjs-cve`.

### Path B — Block THIS plan until `@xenova/transformers` v2 upgrade lands (purest)

1. Halt `dashboard-memories-tab-standardization`.
2. Open `/to-plan deps-upgrade-xenova-transformers-v2-protobufjs-cve` first.
3. Ship the v2 upgrade.
4. Resume `dashboard-memories-tab-standardization`.

### Path C — Verify test embedder is stub (NOT local-transformer) + add Dependencies section only (no allowlist needed)

1. Grep `tests/integration/server/scopes-list-temporal-fidelity.test.ts` test setup to confirm it uses `StubEmbedder` or equivalent, NOT `LocalTransformerEmbedder`.
2. If stub: the test path doesn't pull the vulnerable chain → add Dependencies section only, no allowlist required → `PASS`.
3. If local-transformer: fall back to Path A or B.

**Recommendation:** Path C first (verify scope isolation), fall back to Path A if positive, fall back to Path B if the CRITICAL is operationally unacceptable.

## Cross-references

- Plan: `.claude/knowledge-base/plans/dashboard-memories-tab-standardization-plan.md` (v1.1)
- Edge-case review: `.claude/knowledge-base/reviews/dashboard-memories-tab-standardization-edge-cases-2026-06-08.md`
- Golden rule: `.claude/rules/deps-audit-golden-rule.md`
- Allowlist: `.claude/rules/deps-audit-allowlist.txt`
- Related: `.claude/knowledge-base/plans/adapters-openrouter-local-embedder-plan.md` (ships `@xenova/transformers` for LocalTransformerEmbedder)
