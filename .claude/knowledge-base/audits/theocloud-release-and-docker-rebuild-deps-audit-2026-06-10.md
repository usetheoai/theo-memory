# Deps Audit: theocloud-release-and-docker-rebuild

**Date:** 2026-06-10
**Mode:** plan-bound:theocloud-release-and-docker-rebuild
**Verdict:** PASS
**Hard caps triggered:** []

## Summary
- Ecosystems detected: npm (package.json + package-lock.json)
- Total deps audited: 1,033 (direct: 46, transitive: 987)
- Vulnerabilities found: 1 CRITICAL, 3 HIGH, 4 MODERATE, 0 LOW
- Outdated: not evaluated (no deps introduced by plan)
- Allowlist hits: 10 active, 0 expired
- Auditor coverage: { npm-audit: ran, osv-scanner: SKIPPED (not installed) }

## Plan dependency surface analysis

**This plan introduces ZERO new npm packages, ZERO new Go modules, ZERO new pg extensions, and ZERO new dependencies of any kind.**

Work scope:
- T1.1: `gh pr create` (CLI tool, not a project dep)
- T2.1: 1-line edit to `docker-compose.prod.yaml` (YAML version string)
- T2.2: ~30-line addition to `.github/workflows/docker-publish.yml` (GitHub Actions YAML using existing `docker/login-action@v3`, `docker/metadata-action@v5`, `docker/build-push-action@v6` — already in the workflow)
- T3.1: README markdown edit (~15-20 lines)
- T3.2: README markdown edit (~10 lines)

External tools consumed (all pre-existing in the CI/operator environment):
- `gh` CLI (GitHub), `docker` CLI, `docker compose`, `actionlint` (optional)
- GitHub Actions: `actions/checkout@v4`, `docker/setup-buildx-action@v3`, `docker/login-action@v3`, `docker/metadata-action@v5`, `docker/build-push-action@v6`, `aquasecurity/trivy-action@0.24.0` — all already pinned in the existing workflow

**`## Dependencies` section correctly absent** — the plan does not introduce, use, or remove any project dependency. Per `deps-audit-golden-rule.md` § Rule 1 qualifier ("Every plan **that introduces, uses, or removes** a dependency"), the section is not required.

## Pre-existing vulnerabilities (all allowlisted)

| Package | Severity | CVE/GHSA | Allowlist status | Sunset |
|---|---|---|---|---|
| protobufjs <=7.5.7 | CRITICAL | GHSA-xq3m-2v4x-88gg | active | 2026-07-01 |
| protobufjs <=7.5.7 | HIGH | GHSA-66ff-xgx4-vchm | active | 2026-08-01 |
| protobufjs <=7.5.7 | HIGH | GHSA-75px-5xx7-5xc7 | active | 2026-08-01 |
| protobufjs <=7.5.7 | HIGH | GHSA-jvwf-75h9-cwgg | active | 2026-08-01 |
| protobufjs <=7.5.7 | HIGH | GHSA-685m-2w69-288q | active | 2026-08-01 |
| esbuild <=0.24.2 | MODERATE | GHSA-67mh-4wv8-2f99 | active | 2026-08-23 |
| @esbuild-kit/* | MODERATE | GHSA-67mh-4wv8-2f99 | active | 2026-08-23 |
| drizzle-kit | MODERATE | GHSA-67mh-4wv8-2f99 | active | 2026-08-23 |

All findings are pre-existing, transitive, and already documented in `deps-audit-allowlist.txt` with specific risk-envelope analysis. None are introduced or affected by this plan's changes.

## Recommended next steps

1. No action required — proceed with `/plan-confidence`.
2. Task #87 (`deps-upgrade-xenova-transformers-v2-protobufjs-cve`) remains the tracked path for the CRITICAL protobufjs chain (sunset 2026-07-01).
