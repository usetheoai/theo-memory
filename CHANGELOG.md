# Changelog

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **v0.1 — Core + local runtime (Roadmap Item 2)**: 8-phase write pipeline + 9-step search pipeline + MD5 hash dedup + Porter/simpleStem lemmatization + additive scoring + per-row I/O fallback at every boundary + OpenTelemetry spans per phase + bi-temporal Drizzle schema (memories + entities + history) + HNSW pgvector index (1536-dim cap per ADR D1.7) + two `VectorStore` adapters (in-memory + pgvector raw SQL via `pg`) + `DrizzleHistoryManager` for audit trail + `createMemory` factory wiring all 5 DIPs + public barrel at `src/index.ts` + canonical end-to-end integration test (`memory.user('alice').remember('Paulo likes coffee') + recall('beverages')` returns the memory in top-3 against real `ankane/pgvector:v0.5.1`). Closes Roadmap Item 2. (#PR-8, plan `v0-1-local-runtime-plan.md` v1.3)
- Implementation plan `memory-contract-v0-0-plan.md` v1.3 for Roadmap Item 1 (v0.0 Contract design). Five phases, 14 tasks, 9 ADRs (D1-D9 ratifying CLAUDE.md locked decisions + resolving Open questions Q2-Q6). Coverage Matrix 31/31. Verdict via `/plan-confidence`: SHIPPABLE 100/100.
- Audit trail for cycle-plan v1.1 run: edge-case review (11 edges absorbed v1.0 → v1.1), `/deps-audit` report (FAIL_MEDIUM → 2 bumps absorbed v1.1 → v1.2 → re-audit PASS), `/plan-confidence` report.
- `docker-compose.yaml` at repo root with single `ankane/pgvector:v0.5.1` service (convergent Mem0+Letta blueprint Q7); env-driven port override per EC-15 (#PR-8 T0.3)
- Two `vitest` configs: `vitest.contract.config.ts` (unit + type tests under `src/{core,local}/**/__tests__/**`) + new `vitest.integration.config.ts` (real-Postgres tests under `tests/integration/**`, gated by `THEOMEM_PG_URI`, `fileParallelism: false` to avoid cross-file FK races) (#PR-8 T0.2 + T6.1)
- `drizzle.config.ts` at repo root + `tsconfig.local.json` extending the v0.0 contract project (#PR-8 T0.4)
- README Quickstart section covering local-runtime setup + minimum TypeScript usage + v0.1 constraints (1536-dim cap, `MemoryNotFound` on `forget(unknown)`, `InvalidScope` on `reset({})`, `BiTemporalNotSupportedLocally` on `recall({asOf})`, `ReflectionNotConfigured` on `reflect()`) (#PR-8 T8.2)
- ADR-0001 § Implementation note (v0.1 runtime) acknowledging the 8-phase code reality (folds to 6-phase narrative for marketing brevity); `architecture.md § 4` Adopt bullet updated in the same PR (#PR-8 T7.3)

### Changed

- `package.json` version bumped to `0.0.0-rc.2`; `_v0_0_exports_preview_only` flag removed; `exports` map gains the `"."` entry (default subpath now resolves to `src/index.ts`) while preserving the `"./contract"` subpath for backward compatibility with v0.0 consumers (#PR-8 T0.1 + T7.2)
- Runtime dependencies added: `pg ^8.13.0`, `drizzle-orm ^0.45.0` (per ADR D1.10 forced bump for HIGH CVE — supersedes the earlier ADR D1.9 pin at ^0.36), `zod ^3.24.0` (pinned per ADR D1.8 — v4 migration deferred to v0.2 ecosystem readiness) (#PR-8 T0.1)
- Dev dependencies added: `drizzle-kit ^0.31.0` (per ADR D1.10 — peer of drizzle-orm 0.45 + brings patched esbuild ^0.25.4), `@types/pg ^8.11.0`, `vitest-mock-extended ^4.0.0`, `@opentelemetry/api ^1.9.0`, `@opentelemetry/sdk-trace-base ^2.0.0` (#PR-8 T0.1)
- Optional peer dependency added: `natural ^8.1.0` (Porter stemmer for BM25 lemmatization; in-house `simpleStem` fallback when not installed) (#PR-8 T0.1)
- ESLint config widened from `src/core/**/*.ts` to `src/{core,local}/**/*.ts`; `parserOptions.project` bumped to dual `[tsconfig.contract.json, tsconfig.local.json]` to type-check the new local-runtime files (#PR-8 T2.1)
- Plan v1.2 → v1.3: corrected file-location rule violation. Documents (ADRs) relocated from `docs/adrs/` to `.claude/knowledge-base/adrs/` (canonical knowledge-base root per project convention); TypeScript types relocated from `docs/contract/` to `src/core/` (aligns with `architecture.md § 3 Dependency direction` — `src/core/` ← contracts, types, pure logic).

### Security

- `drizzle-orm` bumped from the v1.2-plan-pinned `^0.36.0` to `^0.45.0` (SemVer-major) to clear a HIGH CVE on SQL injection via improperly escaped SQL identifiers (affects all `drizzle-orm < 0.45.2`); discovered during the first real-tree `npm audit` run at /implement T0.1 iteration 1, fixed via plan v1.2 → v1.3 + ADR D1.10. The forced bump retires the earlier ADR D1.9 pinning rationale (API stability cannot override security imperative). (#PR-8 plan v1.3)
- Four MODERATE CVEs on the dev-only `esbuild` chain (chained via drizzle-kit's deprecated `@esbuild-kit/esm-loader`) allowlisted with 90-day sunset (2026-08-23) in `.claude/rules/deps-audit-allowlist.txt`; drizzle-kit is a devDep + dev-server is never spun up in our usage, so the dev-server-leak CVE has no production-runtime impact. Re-audit at sunset to verify either upstream drizzle-kit migration to `tsx` or escalation. (#PR-8 plan v1.3 + audit v3)

### Status

Pre-release. v0.0 contract (Roadmap Item 1) shipped via PR #4. v0.1 core + local runtime (Roadmap Item 2) implementation in PR #8 — 23/23 tasks committed; 226 contract tests + 28 integration tests pass against real `ankane/pgvector:v0.5.1`; zero CRITICAL/HIGH CVE; canonical write→search end-to-end loop validates Roadmap Item 2 acceptance.

### Known issues

- Drizzle-kit's `history_timestamp_idx` re-applies on every `db:push` due to SQL-expression-based introspection roundtripping limitation. Cosmetic only; production uses `db:generate` + Drizzle migrator at app boot.
- `drizzle-kit push` requires `--force` flag in non-TTY contexts (CI). The `npm run db:push` script does NOT include `--force` by default; documented in README Quickstart.
- v0.1 readiness gate: verify `npm view @usetheo/memory` returns 404 or is owned by the `@usetheo` npm org, and that the publish auth token is provisioned. Not a v0.1 task; flagged for v0.1 publication kickoff.
