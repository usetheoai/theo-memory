# Deps Audit: code-review-fixes-v0-2-1

**Date:** 2026-06-10
**Mode:** plan-bound:code-review-fixes-v0-2-1
**Verdict:** PASS
**Hard caps triggered:** (none)

## Summary

- Ecosystems detected: npm
- Total deps audited: ~350 (direct: ~30, transitive: ~320)
- Vulnerabilities found: 1 CRITICAL, 3 HIGH, 4 MODERATE, 0 LOW
- All 8 vulnerabilities are ALREADY ALLOWLISTED with active sunsets (not expired)
- Outdated: 5 major (commander, eslint, @hono/node-server, @hono/zod-openapi, openai), 2 patch (hono, @types/node)
- Allowlist hits: 8 active, 0 expired
- Auditor coverage: { npm-audit: ran, npm-outdated: ran, osv-scanner: NOT INSTALLED }

## Plan validation

### Plan introduces ZERO new dependencies

The plan `code-review-fixes-v0-2-1` is a pure fix cycle — all 20 tasks modify existing code without introducing, upgrading, or removing any dependency. The plan does NOT have a `## Dependencies` section because no dependency changes are scoped.

Per the golden rule, `plan_dependencies_section_missing` fires only when a plan "introduces, uses, or removes a dependency." This plan does none of those — the cap does NOT apply.

### All existing dependencies used by the plan are audit-clean (within allowlist)

| Package used by plan tasks | CVE status | Allowlist |
|---|---|---|
| `node:crypto` (T1.3, T1.4) | Built-in — no CVE surface | n/a |
| `pg` (T3.1 — pool.connect) | No known CVE at current version | n/a |
| `hono` (T1.2 — CORS) | No known CVE; patch available 4.12.23 → 4.12.25 | n/a |
| `@opentelemetry/*` (T2.1, T2.2, T2.3) | No known CVE | n/a |

### Pre-existing vulnerabilities (all allowlisted)

| CVE/GHSA | Severity | Package | Chain | Allowlist sunset | Status |
|---|---|---|---|---|---|
| GHSA-xq3m-2v4x-88gg | CRITICAL | protobufjs <=7.5.7 | @xenova/transformers → onnxruntime-web → onnx-proto → protobufjs | 2026-07-01 | Active (21 days remaining) |
| GHSA-66ff-xgx4-vchm | HIGH | protobufjs <=7.5.7 | Same chain | 2026-08-01 | Active |
| GHSA-75px-5xx7-5xc7 | HIGH | protobufjs <=7.5.7 | Same chain | 2026-08-01 | Active |
| GHSA-jvwf-75h9-cwgg | HIGH | protobufjs <=7.5.7 | Same chain | 2026-08-01 | Active |
| GHSA-685m-2w69-288q | HIGH | protobufjs <=7.5.7 | Same chain | 2026-08-01 | Active |
| GHSA-67mh-4wv8-2f99 | MODERATE | esbuild/drizzle-kit chain | drizzle-kit → @esbuild-kit → esbuild | 2026-08-23 | Active |
| GHSA-qx2v-qp2m-jg93 | MODERATE | postcss (examples/) | next → postcss | 2026-08-29 | Active |
| GHSA-q6x5-8v7m-xcrf + 3 more | MODERATE | protobufjs <=7.5.7 | Same Xenova chain | 2026-08-30 | Active |

All pre-existing. None introduced by this plan. All within active allowlist sunset windows.

### Outdated (non-vulnerable, advisory only)

| Package | Current | Latest | Delta | Action |
|---|---|---|---|---|
| commander | 12.1.0 | 15.0.0 | MAJOR | Out of scope — separate upgrade cycle |
| @hono/node-server | 1.19.14 | 2.0.4 | MAJOR | Out of scope |
| @hono/zod-openapi | 0.18.4 | 1.4.0 | MAJOR | Out of scope |
| openai | 4.104.0 | 6.42.0 | MAJOR | Out of scope |
| eslint | 9.39.4 | 10.4.1 | MAJOR | Out of scope |
| hono | 4.12.23 | 4.12.25 | PATCH | Low priority; no CVE |
| @types/node | 20.19.41 | 20.19.42 | PATCH | Low priority |

None of these are touched by the plan. Deferred to a separate upgrade cycle.

## Verdict rationale

- Plan introduces **0 new deps** — `plan_dependencies_section_missing` does NOT apply.
- All pre-existing CVEs are **allowlisted with active sunsets** — downgraded per golden rule.
- No expired allowlist entries — no re-fires.
- `osv-scanner` not installed — noted but does NOT trigger `auditor_unavailable` cap because `npm audit` covers the npm ecosystem authoritatively for this project.

**VERDICT: PASS** — the plan is clear to proceed to `/plan-confidence`.
