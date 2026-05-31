# SEPA — Iteration 3 / Task T2.1 / Phase Pre-COMMIT / Mode VERBOSE

Date: 2026-05-31
Agent ID: ab648fab5477bd55f
Verdict: HOLD on 1 CRITICAL DoD gap (architecture.md § 10.3 update) + 1 MAJOR (wiring rationale) → both absorbed → commit landed.

## Key findings

- **[CRITICAL]** Plan T2.1 DoD line 365 requires `architecture.md § 10.2 updated with the dev-push trigger-apply pattern`. Initial staged diff omitted this — silent DoD violation that T13.1 cross-validation would catch. **Fix:** added new § 10.3 "Trigger-bearing migrations require a psql side-channel in `db:push`" sub-section to `.claude/rules/architecture.md` documenting the Drizzle trigger-model gap, the helper, the regex glob, the YAGNI revisit trigger, and the "CREATE OR REPLACE for idempotency" rule for future trigger-bearing migrations. Sub-section number incremented to 10.3 (10.2 already covers drizzle-kit push vs runMigrations conflict — different concern, kept separate).
- **[MAJOR]** Wiring footer pillar (a) rationale needed to call out the npm-script production caller explicitly. `check_wiring.py` counted the .mjs CLI entrypoint block as the structural caller (self-reference), but the FUNCTIONAL production caller is `package.json#scripts.db:push`. **Fix:** wiring footer expanded to state both — `a=pass — production caller is package.json#scripts.db:push npm script chain; check_wiring.py cannot AST-see npm scripts; CLI entrypoint satisfies structural count; functional caller exercised by 2 integration tests via dynamic import`.

## INFO findings noted

- Conventional-commit format `fix(migrations)(v0-4b-fixes): description (T2.1)` ✓
- NO `Co-Authored-By:` trailer ✓
- No paper names ✓
- File-size budget ≤ 500 LoC (helper 136 / trigger-applied 112 / missing-psql 36) ✓
- EC-9 placement under `## Quickstart` honors public-copy.md BODY-tier ✓ (`psql` is a tool, not an internal data store)
- PATH mutation in missing-psql.test.ts safe via `fileParallelism: false` + try/finally ✓
- Dynamic-import cache-bust ensures helper re-evaluates psqlOnPath under mutated PATH ✓
- F3 followup placement honest + recommended-owner-tagged ✓

## Outcome

T2.1 CRITICAL F-dom-db-2 + EC-9 closed. Architecture.md § 10.3 codifies the dev-push trigger-apply pattern for future trigger-bearing migrations. Helper + 4 integration tests + README prerequisites + npm script update all atomic in a single commit (`6855f2b`).

Empirical gates post-commit:
- npm test: 526 passing / 528 total (no regressions)
- npm run test:integration -- tests/integration/db-push: 4/4 PASS (3 trigger-applied + 1 missing-psql)
- npm run typecheck: exit 0
- npm run lint: exit 0
- Manual smoke: runMigrations → helper → trigger registered (1 row in info_schema.triggers)
- No Co-Authored-By trailer

Next iteration: T3.1 (CRITICAL F-dom-1 + F-dom-pg-3 + MAJOR F-arch-4 + F-dom-4 per ADR D3 — scope-tier generalization for triggers + multiplier + partial index; new migration 0005). HIGH-risk surface: EC-5 (`getNeighborScopeId` must honor scope.kind authoritatively).
