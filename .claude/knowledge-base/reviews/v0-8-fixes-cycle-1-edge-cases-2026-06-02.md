# Edge Case Review — v0-8-fixes-cycle-1

Data: 2026-06-02
Plano analisado: `.claude/knowledge-base/plans/v0-8-fixes-cycle-1-plan.md` v1.0
Tasks analisadas: 9 (T0.1, T1.1, T1.2, T1.3, T2.1, T2.2, T3.1, T3.2, T4.1) + Phase 5 Integration Validation
Edge cases encontrados: 13 (MUST FIX: 5, SHOULD TEST: 5, DOCUMENT: 3)

**Empirical pre-flight finding (drives EC-1):** `find node_modules/natural -name '*bleu*' -o -name '*Bleu*'` returned **zero matches**. The `natural@8.1.1` library does NOT contain BLEU anywhere — not at top level, not in `util/`, not in any sub-module under `lib/`. The plan's premise that "we just lost the API name during the v0.8 cycle" is empirically WRONG — `natural` v8 dropped BLEU entirely. This invalidates ADR D1 Option A (repair) and forces the plan toward Option B (vendor inline) or Option C (defer with marker) BEFORE `/implement` starts.

## MUST FIX

### EC-1: ADR D1 Option A is empirically infeasible — `natural` v8.1.1 has zero BLEU exports

- **Task afetada:** T0.1
- **Família:** Boundary (third-party library API surface)
- **Cenário:** Pre-flight probe confirms `node_modules/natural@8.1.1` contains NO `Bleu*` file, no `bleu*` file, no top-level export, no sub-module export. The plan declares ADR D1 Option A as preferred and Option C as fallback IF probe fails — but probe HAS ALREADY failed. Running `/implement` on this plan would: (a) waste iteration 1 on the empirical probe, (b) discover Option A is impossible, (c) trigger ADR D1's "bump plan to v1.1 + re-run /edge-case-plan + /plan-confidence" recursive step mid-`/implement` — explicitly forbidden by cycle-implement.md § Anti-pattern #3 ("NEVER edit the implementation plan during `/implement`").
- **Impacto:** /implement halts at Stop Condition #4 (plan defect) on iter 1. Wasted cycle. Worse, if the agent silently switches to Option B or C without bumping the plan, plan drift fires on /review.
- **Fix sugerido:** Bump plan to v1.1 BEFORE invoking `/implement`. Replace ADR D1 with a CONFIRMED choice between Option B (vendor inline BLEU-1, ~30 LoC per `intl-bleu-score` or hand-rolled — Rule 9 evaluation needed) OR Option C (defer with `Drift-T1.1-1` marker, remove BLEU column from smoke matrix, replace with F1+EM). Recommended: Option C for v0.8-fixes-cycle-1 scope (smaller blast radius, honest residual), Option B as separate `v0-8-bleu-vendor-cycle` if v0.8 audience cares about BLEU.

### EC-2: Source plan v1.2 → v1.3 revision in T4.1 trips `/review` re-run pre-conditions

- **Task afetada:** T4.1
- **Família:** Cycle integration (cycle-plan ↔ cycle-review)
- **Cenário:** T4.1 declares "bump plan version 1.2 → 1.3 with leading paragraph + 3 new drift markers" for the `v0-8-independent-benchmark-reproduction-plan.md` SOURCE plan. But cycle-review.md § Trigger conditions explicitly REFUSES to start when "The plan has been revised post-implementation (the plan must be the ground truth for review)". The re-`/review` (which is the Goal exit gate of this fix-up cycle per Phase 5 DoD) would refuse to start if the source plan has been touched.
- **Impacto:** Goal exit gate (re-`/review` returns READY_TO_MERGE) unreachable. /review skill's pre-condition gate fires; cycle stalls indefinitely.
- **Fix sugerido:** Move the 3 honesty drift markers to a NEW file `.claude/knowledge-base/plans/v0-8-independent-benchmark-reproduction-drift-trail.md` (sibling of the plan, NOT a revision of it). Source plan stays at v1.2 (immutable ground truth for `/review`). Drift trail file is referenced from `docs/benchmarks/v0.8.md` § Honest residuals.

### EC-3: T3.1 promotes Tokenizer to PUBLIC API surface but `package.json#exports` update missing

- **Task afetada:** T3.1
- **Família:** Public API boundary
- **Cenário:** `package.json#exports` declares `"./contract": { "types": "./src/core/index.ts" }`. T3.1 re-exports `Tokenizer` from `src/core/index.ts`, which transitively re-exports from `src/index.ts` (the `.` entry point). This makes `Tokenizer` part of the PUBLIC API — consumers can `import { Tokenizer } from '@usetheo/memory'` AND `from '@usetheo/memory/contract'`. Per `architecture.md § 9 Public API surface`, adding a new public export requires updating `package.json#exports` (if a new subpath is needed) AND a unit test that imports through the public path. The plan misses this.
- **Impacto:** Public API expanded silently without test coverage. Future deprecation path unclear (no test = no contract = no semver signal on accidental removal).
- **Fix sugerido:** Add to T3.1 Files to edit: (a) unit test `src/__tests__/public-paths.test.ts` (NEW or extending existing) asserting `import { Tokenizer } from '@usetheo/memory/contract'` typecheck-passes; (b) NO `package.json#exports` change needed since `./contract` already maps to `src/core/index.ts` — but confirm explicitly in T3.1 Acceptance Criteria.

### EC-4: `_runner-scaffold.ts` at `benchmarks/scripts/` lives OUTSIDE eslint + typecheck globs

- **Task afetada:** T3.2
- **Família:** Toolchain reachability
- **Cenário:** `eslint.config.ts` files glob is `'src/{core,local,theokit,agent-tools,embedders,llms,benchmarks}/**/*.ts'` — note `src/benchmarks/` is included but `benchmarks/scripts/` (repo-root) is NOT. The 3 existing run-*.ts scripts at `benchmarks/scripts/` already escape lint coverage today (consistent state with the new scaffold). But the plan claims F-arch-2 fix improves code quality — extracting duplication to an UNLINTED file just shifts the problem, doesn't fix it. Plus: tests for the scaffold (T3.2 `benchmarks/scripts/__tests__/runner-scaffold.test.ts`) require vitest.contract.config.ts include glob update — but the test FILE lives outside eslint scope so any lint regression slips through.
- **Impacto:** F-arch-2 "fix" produces an unlinted file with ~150 LoC of helper code. The original problem (duplication) is solved but the bigger problem (zero lint enforcement on benchmark scripts) persists silently.
- **Fix sugerido:** Extend `eslint.config.ts` files glob to include `'benchmarks/scripts/**/*.ts'` (sub-task added to T3.2). Same for tsconfig.contract.json if not already included. This makes the lint enforcement consistent and surfaces F-arch-2's value AND retroactively lints the 3 existing run-*.ts scripts. NOTE: this may surface pre-existing lint warnings in the 3 run-*.ts — those become same-task cleanup.

### EC-5: T1.3 vitest.contract.config.ts include glob change may break config-parity sentinel

- **Task afetada:** T1.3
- **Família:** Toolchain configuration
- **Cenário:** Per testing.md § Typecheck scope: `tests/integration/config-parity.test.ts` (sentinel) asserts every tsconfig include dir is also linted. T1.3 adds `'benchmarks/**/__tests__/**/*.test.ts'` to vitest.contract.config.ts include — but if the corresponding tsconfig include isn't ALSO updated, the parity sentinel may fail. Plan doesn't acknowledge this coupling.
- **Impacto:** Hidden F-T6.1-1-style failure when sentinel runs in Phase 5 Integration Validation. Misdiagnosed as v0.8-fixes-cycle-1 regression; actually a coupling defect.
- **Fix sugerido:** Add to T1.3 Files to edit: review `tests/integration/config-parity.test.ts` for any expansion needed. Likely a no-op (benchmarks tests go in source tree); but explicit confirmation in T1.3 Acceptance Criteria.

## SHOULD TEST

### EC-6: T1.2 — `buildSmokeJudgePanel(stubResponses)` with length < question count

- **Task afetada:** T1.2
- **Teste sugerido:** `test_smoke_judge_panel_cycles_responses_when_array_shorter_than_question_count` — assert that `buildSmokeJudgePanel(['CORRECT'])` invoked across 3 questions either (a) cycles modulo length, OR (b) reuses the last element, OR (c) throws. Pick a deterministic behavior; today undefined behavior would silently flake the WRONG-path assertion.

### EC-7: T1.3 — `globalThis.fetch` mock not cleaned up between tests

- **Task afetada:** T1.3
- **Teste sugerido:** `test_fetch_mock_restored_after_each` — assert `afterEach(() => { delete global.fetch /* or restore original */ })` runs; subsequent tests in the suite (and other test files) observe pristine `globalThis.fetch`. Vitest's `vi.stubGlobal('fetch', mockFn)` + `vi.unstubAllGlobals()` in afterEach is canonical. Without this, downstream tests that depend on real fetch (or stub it differently) silently corrupt.

### EC-8: T2.2 — OTel `setAttribute('latencyMs', undefined)` semantics

- **Task afetada:** T2.2
- **Teste sugerido:** `test_span_attribute_when_adapter_returns_undefined_latency` — assert span emission behavior when `SearchResult.latencyMs === undefined`. OTel API typically REJECTS undefined attribute values (per OpenTelemetry spec; some SDKs throw, others silently drop). Today no adapter returns undefined, but the typed contract permits it. Test catches the regression when a future adapter does.

### EC-9: T3.1 — Tokenizer accessible via PUBLIC path `@usetheo/memory`

- **Task afetada:** T3.1
- **Teste sugerido:** `test_tokenizer_accessible_from_public_root_export` — assert `import type { Tokenizer } from '@usetheo/memory'` typechecks. Extends existing `tests/integration/public-paths.test.ts`. Catches accidental removal from `src/index.ts` re-export chain.

### EC-10: EC-5 (plan v1.1 EC) — Speaker `null` vs `'unknown'` collision

- **Task afetada:** T3.1 (indirect — Tokenizer DIP MOVE preserves the scopedUserId pattern from plan v1.2 EC-5)
- **Teste sugerido:** `test_scoped_user_id_when_speaker_explicitly_null_vs_unknown` — assert that `${conversationId}::${null || 'unknown'}` equals `${conversationId}::${undefined || 'unknown'}` equals `${conversationId}::${'unknown'}`. Today the `||` coalesce handles both null and undefined as falsy → 'unknown'. But if any future change accidentally distinguishes them, the scope collapses silently. Trivial test, prevents subtle scope-bleed regression.

## DOCUMENT

### EC-11: `natural` library BLEU drop is a vendor-stability symptom

- **Risco aceito:** Even after EC-1 absorption (Option B or Option C), `natural`'s BLEU drop in v8 signals the library may continue shedding metrics. Note in plan that the BLEU choice (vendor inline OR defer) should be revisited if `natural` drops more metric primitives we depend on (F1 / exact-match are currently hand-rolled, not from natural — verified). Document: this is a one-time vendor surprise, not an ongoing risk for the current TheMemory metric stack.

### EC-12: CLI scripts and process.exit() interaction with unhandled promise rejections

- **Risco aceito:** After T2.1, the 3 CLI run-*.ts scripts call `process.exit(1)` in `.then((report) => ...)`. Node's natural exit behavior on unhandled rejections is to set exitCode=1 and log; our explicit exit overrides this. Acceptable per the contract: report.aborted is the only signal we care about. Document: any future top-level error handling in the CLI scripts should NOT swallow promise rejections (let them bubble to Node's default UnhandledPromiseRejection handler).

### EC-13: Deferred MINORs (F-dom-mem-2, F-dom-obs-3, F-dom-obs-4) accumulate

- **Risco aceito:** Coverage Matrix explicitly defers 3 MINOR findings (F-dom-mem-2 coerceMetadata undefined edge, F-dom-obs-3 tokenizer fallback test coverage, F-dom-obs-4 tokenizer.free() not in try/finally) to a future cycle. Document: track in `.claude/knowledge-base/plans/v0-8-deferred-minors-trail.md` (NEW) so they don't fall off the radar. The trail is the single accumulator across all v0.8.x fix-up cycles.

## Resumo

| Task | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------------|----------|-------------|----------|
| T0.1 | 2 | 1 (EC-1) | 0 | 1 (EC-11) |
| T1.1 | 0 | 0 | 0 | 0 |
| T1.2 | 1 | 0 | 1 (EC-6) | 0 |
| T1.3 | 2 | 1 (EC-5) | 1 (EC-7) | 0 |
| T2.1 | 1 | 0 | 0 | 1 (EC-12) |
| T2.2 | 1 | 0 | 1 (EC-8) | 0 |
| T3.1 | 3 | 1 (EC-3) | 2 (EC-9, EC-10) | 0 |
| T3.2 | 1 | 1 (EC-4) | 0 | 0 |
| T4.1 | 1 | 1 (EC-2) | 0 | 0 |
| Phase 5 | 1 | 0 | 0 | 1 (EC-13) |

**Total: 13 edge cases (5 MUST FIX + 5 SHOULD TEST + 3 DOCUMENT)**

**Veredicto: PLANO PRECISA DE AJUSTE**

The plan has 5 MUST FIX edge cases that must be absorbed via plan v1.0 → v1.1 BEFORE invoking `/plan-confidence` AND `/implement`:

1. **EC-1** (T0.1) — `natural` v8 has no BLEU at all. Pre-commit to Option B or C; replace ADR D1 Option A with the chosen path.
2. **EC-2** (T4.1) — Source plan revision trips re-`/review` pre-conditions. Move drift markers to a sibling file.
3. **EC-3** (T3.1) — Tokenizer becomes public API; add public-path test to T3.1 acceptance criteria.
4. **EC-4** (T3.2) — `benchmarks/scripts/` is unlinted. Extend eslint glob in T3.2.
5. **EC-5** (T1.3) — vitest config glob change may couple with config-parity sentinel; verify explicitly.

The 5 SHOULD TEST edges should be added to the relevant tasks' TDD blocks (cheap, increase regression-detection sensitivity). The 3 DOCUMENT items get notes in the plan's ADR section or a deferred-minors trail file.

**Recommended next step:** human bumps plan v1.0 → v1.1 absorbing the 5 MUST FIX above, then invokes `/deps-audit v0-8-fixes-cycle-1` → `/plan-confidence v0-8-fixes-cycle-1` per cycle-plan chain.
