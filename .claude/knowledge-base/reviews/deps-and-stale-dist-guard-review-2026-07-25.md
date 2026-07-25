# Review: deps-and-stale-dist-guard (M20 — #123, #118)

**Date:** 2026-07-25
**Reviewers (spawned agents):** 3 — deps/security, guard code+tests, cross-validation
**Findings:** BLOCKER 0, HIGH 0, MEDIUM 1 (fixed), LOW 4 (3 fixed, 1 documented), INFO/NOTE several
**Verdict:** READY_TO_MERGE

All three agents independently reproduced the evidence and returned READY_TO_MERGE. The CVE
remediation is verified real and complete; the stale-dist guard is correct, fail-open, and wired
first-statement; the one MEDIUM (test-file false-positive) was fixed with a test.

## #123 — deps (deps/security + cross-validation)

| DoD | Status | Evidence |
|---|---|---|
| 4 runtime advisories (hono ×3 + node-server) resolved by upgrade | MET | live `pnpm audit`: 0 rows for hono + node-server; single lockfile instance `@hono/node-server@2.0.11`, no 1.x remnant (mcp transitive upgraded) |
| REST server integration green post-upgrade | MET | 47/47 (`tests/integration/auth/`, reproduced by 2 agents) vs real pgvector; typecheck exit 0 |
| 3 HIGH transitive resolved via overrides | MET | `brace-expansion>=5.0.8` (resolves 5.0.8), `js-yaml>=4.3.0`; 0 audit rows for both |
| pnpm audit before/after recorded | MET | `docs/security/m20-audit.md` before 6h/9m → after 1h/5m, verified live |

## #118 — stale-dist guard (guard code+tests + cross-validation)

| DoD | Status | Evidence |
|---|---|---|
| `themory server` refuses stale dist via typed StaleDistError, wired | MET | `assertDistNotStale()` first statement of `runServer()`; no-op when src absent (ADR D2) + when run from source (path-segment gate) + fail-open on I/O |
| Negative test asserts typed error + message | MET | asserts `instanceof StaleDistError` + `.name` + `.message` contains `pnpm build`; 5/5 pass |

## Findings

- **MEDIUM (guard, FIXED — `20cd6a3`)** — the staleness walk counted `*.test.ts`/`*.d.ts`, so editing
  a test after a build could false-positive. Restricted to production `.ts`; new test proves a newer
  test/decl file does not mark the build stale.
- **LOW F4 (deps, FIXED)** — `m20-audit.md` overstated residuals as "not runtime-reachable"
  (`@opentelemetry/core` is a direct runtime dep). Corrected to "outside #123 scope; tracked
  separately", with the runtime-reachable ones named honestly.
- **LOW F3 (deps, DOCUMENTED)** — `js-yaml>=4.3.0` resolved to major-5 (5.2.2). Dev-only
  (swagger-parser + eslint), NOT in the runtime bundle; `openapi.test.ts` passes green under it.
  Documented as intentional in the audit doc.
- **LOW F5 (deps, FIXED)** — explained the Before→After HIGH delta (6→1): 3 targets + 2 stale
  transitive HIGH dropped on lockfile regen.
- **NOTE F6 (FIXED)** — added a CHANGELOG note that node-server 2.x requires Node ≥20 (Docker is 22;
  published runtime unaffected).
- **INFO (cross-validation)** — two plan/impl divergences (brace-expansion pin `>=5.0.8` stronger than
  the plan's estimated `>=1.1.16`; the added node-server override) are both stronger-than-planned and
  documented; justified.
- **LOW (guard, advisory)** — the `dist`-segment heuristic disables the guard for a custom outDir;
  correct for this repo (ships to `dist/`), documented in the JSDoc.

## Quality gates
- Full contract suite 1362 pass, 0 fail; typecheck 0 errors.
- REST server auth integration 47/47 vs real pgvector.
- `/code-quality`: PASS, cap 100, zero hard caps.
- No existing test assertion silently edited — only the NEW guard test + the EXPECTED
  version-alignment sentinel (node-server ^1→^2, CVE supersedes ADR D14 v2-deferral).

## Handoff decision
READY_TO_MERGE → `/release`. No BLOCKER, no HIGH; the one MEDIUM fixed with a test; LOW/doc-accuracy
findings all resolved or documented. CVE remediation independently verified complete; guard correct
and honestly fail-open.
