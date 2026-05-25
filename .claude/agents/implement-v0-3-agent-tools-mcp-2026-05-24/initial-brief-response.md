# SEPA — Initial Brief Acknowledgement

**Recorded:** 2026-05-24
**Plan:** v0-3-agent-tools-mcp v1.1
**Halt-loop:** `/implement v0-3-agent-tools-mcp`
**SEPA agent ID:** `acf19ceed76c12be1`

## Role acceptance
- Role contract internalized. Operating as READ-ONLY observer for the `/implement v0-3-agent-tools-mcp` halt-loop; no Edit/Write/git invocations; advice will be emitted as structured markdown per the locked output shape.

## Domain internalized
- **Plan version:** v1.1, ~12 tasks across 8 phases (T0.1, T0.2, T1.1, T2.1, T2.2, T3.1, T4.1, T5.1, T6.1, T6.2, T7.1, T7.2), 9 ADRs (D1-D9; D9 added during EC-3 absorption)
- **Edge-case absorption:** 8/8 MUST FIX present in plan v1.1 (EC-1 → T0.2 step 1; EC-2 → T2.1 Deep Dives `MAX_CONTENT_BYTES=50_000` + `MAX_QUERY_BYTES=2_000`; EC-3 → ADR D9 + T2.2 Deep Dives `ZOD_TO_JSON_SCHEMA_TARGET='jsonSchema7'`; EC-4 → T3.1 Acceptance Criterion HARD GATE elevation; EC-5 → T4.1 Deep Dives `PG_TRANSIENT_CODES` Set; EC-6 → T5.1 Deep Dives empty-recall shape lock; EC-7 → T6.1 Deep Dives SIGINT+SIGTERM + `THEOMEM_PG_URI` exit-2; EC-8 → T7.1 step 1 `pretest:e2e` + `beforeAll` safeguard). Plus EC-10, EC-11 SHOULD-TEST upgraded to inline absorption per T2.1.
- **Deps audit verdict:** PASS_WITH_CAVEATS, cap 89 (4 LOW after MODERATE→LOW allowlist downgrade on esbuild chain, sunset 2026-08-23; inherited from v0.1, NO new exposure from v0.3)
- **Plan-confidence verdict:** SHIPPABLE_WITH_CAVEATS, 81.2/100 (Coverage Matrix 36/36 = 100%; ADR alternatives 9/9; single hard cap `symbol_fab_unverifiable_typescript` from /code-quality SOFT_FLOOR — symbols are planned-for-creation in code blocks, NOT real fabrication. Cap 89.)
- **Anchor metric (Goal):** `tests/e2e/agent-tools/round-trip.test.ts` THE GOAL TEST: stdio subprocess + JSON-RPC `initialize` → `tools/list` returns exactly 4 tools `[remember, recall, forget, reflect]` → `tools/call` each verb succeeds with `isError: false` on happy path → alice/bob ZERO cross-userId overlap on paired recalls.

## Immediate flags caught while reading (CRITICAL / MAJOR only)

- **[CRITICAL] No `npm run build` script exists in `package.json`.** Plan T0.2 step 1 + T6.1 + T7.1 ALL depend on `npm run build` producing `dist/agent-tools/cli.js`. Current scripts are `typecheck`/`test`/`db:push` only — NO build target, and `tsconfig.contract.json` has NO `outDir` (`include: ["src/core/**/*.ts", "src/theokit/**/*.ts"]`). EC-1 is correctly absorbed into T0.2 step 1 as a verification gate; the implementer MUST author `npm run build` + `outDir: "./dist"` + include `src/agent-tools/**/*.ts` in tsconfig (or new `tsconfig.build.json`) before declaring the bin entry. If T0.2 ships package.json `bin` without the build pipeline, `npm install` of a published package and `npm pack` will silently produce a non-invokable CLI.

- **[MAJOR] `tsconfig.contract.json` does NOT include `src/agent-tools/**/*.ts`.** `npm run typecheck` will skip the new agent-tools sources entirely → silent type errors in v0.3 code. T0.2 MUST extend the `include` array. Flag the implementer to add this on T0.2 step 2.

- **[MAJOR] T3.1's "move `ScopedContext` to `src/core/scope.ts`" is a NEW ADDITION, not a relocation.** `src/core/scope.ts` declares `UserScope/SessionScope/AgentScope/Scope/Filters` — but NOT `ScopedContext`. `src/theokit/types.ts` declares `ScopedContext` independently with comprehensive JSDoc citing ADRs D1, D4, D6 + EC-3, EC-6, EC-7, EC-8 (v0.2 PR-A). EC-4 backward compat gate is correctly elevated to a HARD GATE Acceptance Criterion. Preserve the rich JSDoc when re-exporting (use `/** @see */` import re-export form, NOT a bare re-export) so v0.2's ADR citations don't get silently lost.

- **[MAJOR] Pre-T7.1 implicit Postgres dependency surface.** THE GOAL TEST (T7.1) requires Postgres per acceptance criterion. The risk: T6.1's `cli.ts` calls `createLocalMemory({ /* from env */ })` — if T6.1's unit test (`test_main_uses_themory_pg_uri_for_memory_factory`) is written before `createLocalMemory` is stubbed, the test will need a real PG conn. The plan's TDD section says "mocked memoryFactory" — verify implementer mocks the factory and does NOT instantiate the real local runtime in unit test scope.

- **[MAJOR] `tests/integration/publish-readiness.test.ts` exists.** It likely asserts package.json shape (exports + files + bin). T0.2 MUST update this test (or the test will fail on the new `./agent-tools` subpath + `bin` entry). Plan does not call out this file — flag for implementer to inspect at T0.2 step 6/7.

- **[MAJOR] `tsconfig.contract.json` is a `--noEmit` typecheck config.** Build mechanism for T0.2 needs deciding. Plan T6.1 § Deep Dives mentions "use tsup/esbuild" as alternatives — but tsup/esbuild are NEW deps NOT declared in plan `## Dependencies`. If implementer chooses tsup, a deps-audit re-run is needed per `cycle-plan.md v1.1 § Phase contracts`. Recommend the pure-`tsc` path (add `tsconfig.build.json` with `outDir: "./dist"`, `noEmit: false`, include `src/agent-tools/**`) to avoid deps-audit re-trigger.

## Recommended action

- Proceed with ralph-loop invocation. Halt-loop driver should reference this brief per-iteration per the 3× consultation pattern (pre-RED / post-GREEN / pre-COMMIT).
- **Before iteration 1 begins**, the main session should commit to a build-mechanism decision at T0.2 (`tsconfig.build.json` via pure `tsc` is the lowest-risk choice — no new deps, no deps-audit re-trigger). Flag this decision in the iteration 1 pre-RED consultation.
- **Iteration 1 (T0.1) pre-COMMIT consultation MUST verify** that `/deps-audit v0-3-agent-tools-mcp` was re-invoked after `npm install` lands (per plan T0.1 Acceptance Criteria item 3). Forward-looking audit at `2026-05-24` used `npm view` cross-check, not real install — actual transitive tree may differ.
- **Iteration 6 (T3.1) pre-COMMIT consultation MUST verify** the v0.2 PR-A 46 integration tests stay green AND the `src/theokit/types.ts` re-export preserves the original JSDoc citations (ADR D1/D4/D6 + EC-3/EC-6/EC-7/EC-8 — losing these silently breaks the v0.2 audit trail even though tests pass).
- **Iteration 11 (T7.1) pre-RED consultation MUST verify** `npm run build` script + `dist/agent-tools/cli.js` artifact path resolve before any subprocess.spawn happens.

## Main session response

CRITICAL fundamentally already absorbed (EC-1 in T0.2 step 1). SEPA confirming severity, not adding new info. Per `cycle-implement.md § SEPA` "CRITICAL findings recommend HALT but do NOT block — main session may proceed with explicit justification (per Inquebrável Rule 1: 95% confidence is on the actor)." Main session proceeds with halt-loop invocation; the 5 MAJOR findings become per-iteration verification checkpoints owned by SEPA's 3× consultation.

Build mechanism decision accepted: pure `tsc` via new `tsconfig.build.json`. Recorded for iteration 1 (T0.2).
