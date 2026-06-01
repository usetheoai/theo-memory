# Plan: adapters-stub-embedder-llm-cycle-1 — review fixes (CRITICAL + 5 MAJOR + 8 MINOR)

> **Version 1.1** (2026-06-01) — Absorbs ALL 11 edge cases from `/edge-case-plan` review at `.claude/knowledge-base/reviews/adapters-stub-embedder-llm-cycle-1-fixes-edge-cases-2026-06-01.md`: **EC-1 MUST FIX** marker format mismatch (em-dash `—` vs colon `:` — `check_wiring.py:165` regex requires literal `:` between `<symbol>` and `<reason>`; fixed in 3 occurrences); **EC-4 SHOULD TEST mandatory** — T0.1 GREEN phase now invokes `check_wiring.py` and asserts exit 0 + `"status": "DEFER"` (not just `grep`); **EC-2** T1.1 augmented with multi-line pipeline-shape test; **EC-3** T2.3 extended to cover `generateResponse({type:'text'})`; **EC-5** T0.3 CHANGELOG placement convention locked; **EC-6-11** DOCUMENT items recorded inline as accepted-risks.
>
> **Version 1.0** (2026-06-01) — Absorbs ALL findings from the `/review adapters-stub-embedder-llm-cycle-1` report at `.claude/knowledge-base/reviews/adapters-stub-embedder-llm-cycle-1-review-2026-06-01.md`. Single fix-up cycle to flip review verdict from `NEEDS_FIXES` → `READY_TO_MERGE` without a full `/implement` re-cycle. Source plan: `.claude/knowledge-base/plans/adapters-stub-embedder-llm-cycle-1-plan.md` v1.1 (SHIPPABLE 96.8). Source review verdict: 0 BLOCKER / **1 CRITICAL** / 5 MAJOR / 8 MINOR / 14 INFO.

## Goal

Resolve the 1 CRITICAL hard-gate violation (F-wire-1 — wiring pillar b for both new exports) + 5 MAJOR + 8 MINOR findings from the `/review` report in a single fix-up cycle, measured by `npm test === 570 + new-tests-count PASS AND grep 'ADR-DEFER-WIRING-B: DeterministicStub' .claude/knowledge-base/implementations/adapters-stub-embedder-llm-cycle-1-implementation.md === 2 matches AND grep 'embedders/stub' CHANGELOG.md === 1+ match AND wiring pillar (b) re-check passes via the ADR-DEFER markers`.

The action verb is **resolve**; the named observable metric is the re-run of `python3 .claude/skills/implement/scripts/check_wiring.py --symbol DeterministicStubEmbedder|DeterministicStubLLM` returning verdict `PASS` (via ADR-DEFER acknowledgment) AND `npm test` exiting 0 with the augmented test count.

## Context

### What exists today

Source: read `/review` report `.claude/knowledge-base/reviews/adapters-stub-embedder-llm-cycle-1-review-2026-06-01.md` AND each spawned-agent YAML at `.claude/agents/review-adapters-stub-embedder-llm-cycle-1-2026-06-01/findings/`.

**Findings to absorb (15 total — 1 CRITICAL + 5 MAJOR + 8 MINOR + 1 implicit JSDoc cleanup from F-wire-3):**

| ID | Severity | File / target | Fix nature |
|---|---|---|---|
| **F-wire-1** | CRITICAL | implementation contract + validation report | Audit-trail (2 markers + L46 amend) |
| F-wire-2 | MAJOR | validation report L46 | Honesty fix (cited via F-wire-1 remediation) |
| F-arch-1 | MAJOR | `tsconfig.build.json` | 1-line config widening |
| F-arch-2 | MAJOR | `src/embedders/stub.ts` + plan ADR D2 | Constant fix (`Number(LCG_MODULUS / 2n)` → `(Number(LCG_MODULUS) - 1) / 2`) |
| F-arch-3 | MAJOR | `src/embedders/stub.ts` JSDoc + plan ADR D2 | Honesty fix (collision math `~2^32` → `~2^31` → `~46k` birthday) |
| F-xval-1 | MAJOR | `CHANGELOG.md` | Add `[Unreleased] § Added` entry |
| F-wire-3 | MINOR | `src/embedders/index.ts` + `src/llms/index.ts` | `@remarks Phase A` JSDoc on barrels |
| F-tests-1 | MINOR | `tests/integration/publish-readiness.test.ts` | Explicit assertions on 4 new subpath files |
| F-tests-2 / F-dom-memory-1 | MINOR | `src/embedders/__tests__/stub.test.ts:61` | Replace `Math.random()` with seeded LCG counter |
| F-tests-3 | MINOR | `src/llms/__tests__/stub.test.ts:40,47` | Tautological `typeof === string` → `/^stub-response:[0-9a-f]{4}$/` regex |
| F-dom-memory-2 | MINOR | `src/llms/stub.ts:39-44` | `concatUserContent` strip-prefix regex OR JSDoc warning |
| F-arch-4 | MINOR | `src/embedders/stub.ts` | Cosmetic — indexed-access non-null assertion |
| F-arch-6 | MINOR | `src/llms/stub.ts` | JSDoc clarification — `generateResponse({type:'text'})` shape divergence |
| F-arch-8 | MINOR | `src/llms/stub.ts` | JSDoc note — sentence-split regex is i18n-brittle (Latin-only) |

**Current branch:** `develop` @ `6c50ea5` (after `b88105c` T4.1 commit landed).

**Existing infrastructure relevant to this plan:**

- `tsconfig.contract.json` (line 26) already widened to `src/embedders/**/*.ts` + `src/llms/**/*.ts` + `src/__tests__/**/*.ts`. `tsconfig.local.json` excludes these (not affected). **`tsconfig.build.json` (line 10) still lists only `src/core/**/*.ts`, `src/theokit/**/*.ts`, `src/agent-tools/**/*.ts`** — this is F-arch-1.
- `vitest.contract.config.ts` already widened to include `src/{core,local,theokit,agent-tools,embedders,llms}/**/__tests__/**/*.test.ts` + `src/__tests__/**/*.ts` (T0.1 of source plan).
- `tests/integration/publish-readiness.test.ts § F1 followup` (lines 90-118) ALREADY iterates `pkg.exports` and asserts each `conditions.default` target exists in `npm pack --dry-run` output. Since `package.json` now declares 4 new exports (`./embedders`, `./embedders/stub`, `./llms`, `./llms/stub`, all pointing to `./src/*.ts`), the F1 followup IS exercising EC-5 transitively. F-tests-1 remediation makes the assertion explicit (named-file matchers) — a regression guard for the next 52 adapters per the portfolio roadmap.
- `src/llms/stub.ts:39-44 concatUserContent` filters `role==='user'` only and joins content with `' '`. The production call site at `src/core/extraction/pipeline.ts:230` passes a SYNTHETIC user message whose `content` field is `messages.map((m) => \`${m.role}: ${m.content}\`).join('\n')` — meaning the stub's `role==='user'` filter receives a SINGLE synthetic message that internally inlines `"user: ..."` / `"assistant: ..."` strings. The sentence-split then produces facts with literal `"user: ..."` prefixes when stub is consumed via the pipeline (F-dom-memory-2 documented impact: dedup hash pollution when stubs are wired through pipeline.ts paths).
- `LCG_HALF_MODULUS_F64 = Number(LCG_MODULUS / 2n)` at `src/embedders/stub.ts:41`. `LCG_MODULUS = 2147483647n` (Mersenne prime 2^31-1, odd). BigInt floor div: `2147483647n / 2n === 1073741823n` (NOT 1073741823.5). The mapping `(Number(state) - LCG_HALF_MODULUS_F64) / LCG_HALF_MODULUS_F64` produces range `[-1, 1+2e-9]` (state range `[1, m-1]` → output range `[(1 - 1073741823) / 1073741823, (m-1 - 1073741823) / 1073741823]` = `[-0.999..., 1.0000000009...]`).
- Source plan `adapters-stub-embedder-llm-cycle-1-plan.md` § ADR D2 Deep Dive contains the inherited collision-math claim ~2^32 — would need correction in lockstep with `src/embedders/stub.ts` JSDoc per F-arch-3.

**Pre-flight path validation (per `/to-plan` Step 0):**
- Unit test paths under `src/{embedders,llms}/__tests__/**/*.test.ts` already reachable via `vitest.contract.config.ts` include glob.
- Integration test paths under `tests/integration/**/*.test.ts` reachable via `vitest.integration.config.ts`.
- No new test paths needed; all fix tests EXTEND existing test files OR live at the existing reachable paths.

### Why this matters NOW

1. **The `/review` verdict gates merge per `cycle-review.md § Hard gates #1`.** Merge cannot proceed until the CRITICAL F-wire-1 is resolved — either via integration test OR via explicit `<!-- ADR-DEFER-WIRING-B: <reason> -->` markers. The lowest-cost path is the ADR-DEFER markers, since the source plan ADR D5 already declared "no demo unit-test infra" (acknowledging the deferral) and the next cycle (F-T4.1-2 debug) will consume both stubs in a real integration test.

2. **F-wire-2 fabricated rationale undermines `testing.md § Pyramid` ecosystem-wide.** The validation report at line 46 claims "contract tests ARE the integration evidence per `testing.md § Determinism`". This claim does not survive a careful re-read of `testing.md`: § Determinism describes a PROPERTY of tests (no flakiness, no live LLM calls); § Pyramid LOCKS the distinction between Unit / Integration / E2E tiers (table at line 16). If accepted as precedent, every future "pure-function adapter" cycle would weaken pillar (b). Fix the report's rationale now.

3. **F-arch-1 prevents a future `F-T7.1-3`-class build defect.** Same defect family as the documented `architecture.md § 10.1` precedent. If a future consumer changes `package.json#exports` from `./src/*.ts` to `./dist/*.js`, the build will silently exclude `dist/embedders/` + `dist/llms/`. Defensive 1-line fix.

4. **F-arch-2 + F-arch-3 are honesty fixes** — the kind of "claims in docs/JSDoc that don't hold up under careful re-reading" that the review gate exists to catch. Documented math is wrong; behavior is unaffected (L2-norm absorbs the asymmetry; collision space still vastly exceeds debug needs). But Inquebrável Rule 3 (extreme honesty) requires that documented invariants match real behavior. Fix the JSDoc + plan ADR D2 in lockstep.

5. **F-xval-1 missing CHANGELOG entry violates Inquebrável Rule 6.** Every code change updates `CHANGELOG.md`; the source plan's Global DoD checkbox at line 168 is unchecked. Single entry fixes it.

6. **F-dom-memory-2 has runtime impact** when stubs are wired through `pipeline.ts` (which is exactly what `THEOMEM_USE_STUB_ADAPTERS=1` will trigger in the F-T4.1-2 debug cycle). The role-prefix pollution corrupts dedup hashes — exactly the kind of effect that makes the F-T4.1-2 race-condition isolation HARDER, not easier. Fix in the same cycle that ships the stubs so F-T4.1-2 debug doesn't trip over a stub-side artifact.

7. **F-tests-2 violates `testing.md § Determinism` directly** — flaky test contract. Same agent (tests + domain-memory-layer) flagged it independently. Replace `Math.random()` with seeded counter is 1-line.

### Accepted risks (declared upfront)

- **EC-A — F-arch-2 fix changes a numeric constant value.** Going from `Number(LCG_MODULUS / 2n) === 1073741823` to `(Number(LCG_MODULUS) - 1) / 2 === 1073741823.0` is a NO-OP in float64 (both round to the same value). The output range `[-1, 1]` symmetry CANNOT be perfectly achieved with `state ∈ [1, m-1]` (odd modulus); the honest fix is updating the JSDoc claim to `[-1+2e-9, 1+2e-9]` and noting "L2-norm absorbs the asymmetry; output unit vectors live on the unit hypersphere". This is a JSDoc-only fix per the review's "Absorbed by L2-norm so no behavioral impact; honesty fix only" guidance. Output of `embed()` is byte-identical pre-fix vs post-fix.
- **EC-B — F-arch-3 collision math correction lands in BOTH `src/embedders/stub.ts` JSDoc AND the source plan v1.1 ADR D2 Deep Dive.** The plan is the historical contract; correcting it post-implementation is unusual (cycle-review.md anti-pattern #5: "NEVER reviews without the plan as ground truth"). Mitigation: the plan correction is a documented-by-ADR amendment to v1.1 → v1.2, recorded in this fix-up plan's CHANGELOG entry as "honesty correction to ADR D2 Deep Dive of the source plan". Source plan version bumps NOT triggered (this is an honesty fix, not a contract change).
- **EC-C — F-dom-memory-2 fix changes the behavior of `concatUserContent`.** Currently filters `role==='user'` only; fix adds strip-prefix regex `/^(user|assistant|system):\s+/gm` to handle the pipeline.ts inline format. Behavior change: facts extracted via pipeline path no longer carry `"user: "` prefix. Existing tests don't exercise the pipeline path (only direct stub calls), so existing tests stay green. NEW test at `src/llms/__tests__/stub.test.ts` exercises the pipeline-shape input.
- **EC-D — F-tests-1 turns an existing implicit assertion into explicit named-file matchers.** The F1 followup test already iterates `pkg.exports` so the 4 new files ARE asserted. Adding explicit assertions is belt-and-suspenders for the 52-adapter roadmap. Risk: minor duplication with F1 followup. Mitigation: extract a shared helper OR add the explicit assertions as a SEPARATE `it()` block citing F-tests-1 absorption.
- **EC-E — File-size budgets stay respected.** No file in scope grows past its declared cap. Detailed checks per task.

### Compliance scope

Honors `architecture.md § 3 DIP` — no DIP-affecting changes (adapters stay outside `src/core/`). Honors `architecture.md § 6 Naming conventions` — kebab-case, PascalCase, camelCase preserved. Honors `architecture.md § 7 Module hygiene` — no `any`, no `console.log` outside the ADR D8 stub exception. Honors `architecture.md § 9 Public API surface` — no new exports declared (existing 4 subpath exports + `package.json#exports` stay as-is). Honors `architecture.md § 10.1` (defect family `F-T7.1-3`) — `tsconfig.build.json` is widened in lockstep with `tsconfig.contract.json` per the documented rule. Honors `testing.md § Pyramid` — fixes flagged by F-wire-1 + F-wire-2 explicitly RESTORE the pyramid integrity (via honest ADR-DEFER markers, not via fabricated rationale). Honors `testing.md § Determinism` — F-tests-2 removes `Math.random()`. Honors `no-paper-names-in-code.md` — no paper names introduced. Honors `dogfood-golden-rule.md` — no `production-ready` claim. Honors Inquebrável Rule 3 (extreme honesty) — F-wire-2 + F-arch-2 + F-arch-3 fixes are the Rule 3 enforcement. Honors Inquebrável Rule 5 (TDD) — every behavior-changing task has RED-GREEN-REFACTOR cycle; doc-only fixes carry explicit "no TDD: doc/comment only, no behavior change" rationale per the testing.md "Every non-trivial logic change needs a test or explicit reason why not" rule. Honors Inquebrável Rule 6 (CHANGELOG discipline) — F-xval-1 closes it.

## ADRs

### D1 — Resolve F-wire-1 CRITICAL via ADR-DEFER-WIRING-B markers (NOT via new integration test in this cycle)

**Decision:** Add two `<!-- ADR-DEFER-WIRING-B: <symbol>: <reason> -->` markers (literal colon between `<symbol>` and `<reason>` — required by `.claude/skills/implement/scripts/check_wiring.py:165` regex `rf"<!--\s*ADR-DEFER-WIRING-B:\s*{re.escape(symbol)}\s*:\s*[^>]+?-->"`. Em-dash `—` does NOT match this regex; the markers MUST use ASCII colon. **EC-1 absorption from `/edge-case-plan` v1.1**) to `.claude/knowledge-base/implementations/adapters-stub-embedder-llm-cycle-1-implementation.md`. The reason cites the F-T4.1-2 debug cycle as the landing site for the real integration test. Do NOT land a new integration test in THIS plan.

**Alternatives considered:**
- (A) Land `tests/integration/forgetting/f-t4-1-2-stub-reproduction.test.ts` in this cycle — exercises both stubs via the demo singleton path. **Rejected** because: (1) the F-T4.1-2 debug is its own cycle with its own race-condition isolation scope; merging the integration test into this fix-up cycle creates scope creep AND tangles two halt-loops; (2) the existing plan ADR D5 already declared pillar (b) defer-D5-cross in the implementation contract — markers are the formalization, not a new precedent; (3) cost: ~200 LoC integration test vs ~5 LoC marker addition.
- (B) Mark pillar (b) as ADR-DEFER and amend validation report line 46 (CHOSEN — option B per review report's "lowest cost remediation"). Single source of truth: the implementation contract. The validation report cites the markers instead of fabricating the `testing.md § Determinism` rationale.
- (C) Flip pillar (b) to DEFERRED in the validation report verdict table without adding markers — **Rejected** because cycle-implement.md § Hard gates #5 requires the marker IN ADDITION TO the verdict change.

**Rationale:** Honors `cycle-implement.md § Hard gates #5` (explicit ADR-DEFER markers required) + Inquebrável Rule 3 (extreme honesty — don't claim integration coverage that doesn't exist).

**Consequences:** Pillar (b) re-check passes via marker grep. Next cycle (F-T4.1-2 debug) MUST land the integration test before its own /review can issue READY_TO_MERGE — the markers are debt with a named owner, not a permanent free pass.

### D2 — F-arch-2 LCG range fix: JSDoc-only correction (NOT numeric constant change)

**Decision:** Correct the JSDoc claim in `src/embedders/stub.ts` to state the actual range `[-1, 1+~2e-9]` AND add a note "L2-norm absorbs the asymmetry; output unit vectors live on the unit hypersphere". Do NOT change the value of `LCG_HALF_MODULUS_F64`.

**Alternatives considered:**
- (A) Change `LCG_HALF_MODULUS_F64 = (Number(LCG_MODULUS) - 1) / 2` to make the range nominally `[-1, 1]` — **Rejected** because Mersenne prime `2^31 - 1` (odd) admits no symmetric integer/2 mapping that produces exact `[-1, 1]` from `state ∈ [1, m-1]`. Best achievable is `[-1, 1-2/(m-1)]` ≈ `[-1, 1-9.3e-10]`. Marginal honesty gain; same float64 rounding behavior; embed() output bit-identical.
- (B) Keep constant, fix JSDoc only (CHOSEN). Zero behavioral impact; honest documentation. Plan ADR D2 Deep Dive corrected in lockstep.
- (C) Change to floating-point centered constant `LCG_HALF_MODULUS_F64 = Number(LCG_MODULUS) / 2 === 1073741823.5` — **Rejected** because state values are BigInt-derived integers `[1, m-1]`; subtracting `m/2` (non-integer) from an integer doesn't normalize cleanly. Float precision is the same; behavior bit-identical.

**Rationale:** Honors Inquebrável Rule 3 (honesty over cosmetics) + Rule 12 (KISS — minimum code change for honest documentation).

**Consequences:** `src/embedders/stub.ts` JSDoc + source plan ADR D2 Deep Dive carry corrected range claim. Behavior unchanged. Future contributors don't read `[-1, 1]` and chase phantom regressions.

### D3 — F-arch-3 collision math correction lands in BOTH src code AND source plan v1.1

**Decision:** Correct the `~2^32` birthday claim in `src/embedders/stub.ts` JSDoc to `~2^31` effective seed space → `~46k inputs at 50% collision probability per birthday paradox`. Apply the same correction to the source plan `adapters-stub-embedder-llm-cycle-1-plan.md § ADR D2 Deep Dive` (the plan inherited the same incorrect math).

**Alternatives considered:**
- (A) Correct only the JSDoc, leave the source plan as historical record — **Rejected** because the plan IS the contract; future archaeology readers will compare plan vs code and re-introduce the wrong math thinking the code is wrong.
- (B) Correct BOTH (CHOSEN). Lockstep update.
- (C) Increase the effective seed space by using all 16 MD5 bytes instead of `digest.readBigUInt64BE(0)` — **Rejected** because the existing 8-byte BigInt cap at `2^64` is fine for debug scale; the bottleneck is `seed % LCG_MODULUS` collapsing to `~2^31`. Going to 16 bytes doesn't help the modulus collapse. Out of scope.

**Rationale:** Honors Inquebrável Rule 3 (honesty) + cycle-review.md anti-pattern #5 (plan must be the ground truth — corrected truth, not historical truth).

**Consequences:** Source plan v1.1 → v1.2 with ADR D2 Deep Dive math corrected. CHANGELOG entry notes "honesty correction to source plan ADR D2 Deep Dive (collision math)". This is the ONLY case in this fix-up plan where the source plan changes.

### D4 — F-dom-memory-2 fix: strip role-prefix regex (NOT JSDoc-only warning)

**Decision:** Fix the runtime behavior in `concatUserContent` by stripping the `(user|assistant|system):\s+` prefix from the joined string before passing to `extractFacts`. Do NOT settle for a JSDoc warning.

**Alternatives considered:**
- (A) JSDoc-only warning ("when called via pipeline.ts, facts will carry role prefix") — **Rejected** because the F-T4.1-2 debug cycle will consume these stubs through pipeline.ts AND the prefix pollution will corrupt dedup hashes during race-condition isolation. The bug surfaces exactly when we MOST need clean signal.
- (B) Strip-prefix regex applied inside `concatUserContent` (CHOSEN). Single-line change, no DIP impact, behavior corrects to "extract from semantic content only".
- (C) Change `pipeline.ts:230` to NOT inline role prefixes — **Rejected** because pipeline.ts is the production extraction path; changing its serialization format affects all real LLMs (OpenAI, etc.). Stub adapter should match the production input format, not force production to match the stub.

**Rationale:** Honors Inquebrável Rule 3 (don't ship a known bug behind a JSDoc) + Inquebrável Rule 8 (Fail-Fast — corrupt dedup hashes are silent corruption).

**Consequences:** `src/llms/stub.ts` behavior changes: when called via pipeline path, extracted facts no longer carry `"user: "` / `"assistant: "` prefix. New test asserts the new behavior. Existing tests unchanged (they exercise the direct stub path, not pipeline-shaped input).

### D5 — F-tests-1 EC-5 absorption: add explicit assertions, NOT replace the F1 followup

**Decision:** Add 1 new `it()` block to `tests/integration/publish-readiness.test.ts` that explicitly asserts each of the 4 new subpath files (`src/embedders/stub.ts`, `src/embedders/index.ts`, `src/llms/stub.ts`, `src/llms/index.ts`) is in the `npm pack --dry-run` output by name. Keep the existing F1 followup intact.

**Alternatives considered:**
- (A) Extend F1 followup loop to print per-file evidence — **Rejected** because F1 is generic (iterates `pkg.exports`); per-file evidence would balloon test runtime and obscure the loop intent.
- (B) Add a sibling `it()` block with explicit assertions per the 52-adapter portfolio discipline (CHOSEN). Belt-and-suspenders; minor duplication is intentional.
- (C) Skip F-tests-1 since F1 already covers it transitively — **Rejected** because the explicit assertion serves as a documentation aid for the next 52 adapters (each subsequent cycle adds 1 line per new subpath); the cumulative effect is a portfolio-wide regression guard.

**Rationale:** Honors Inquebrável Rule 7 (testes não negociáveis — explicit > implicit when the test is portfolio-load-bearing) + Inquebrável Rule 11 (YAGNI tempered: we DO need this for the next 52 adapters).

**Consequences:** 4 new explicit assertions in publish-readiness.test.ts. Each future adapter cycle adds 1 assertion per new subpath. Test runtime impact: negligible (1 extra `npm pack --dry-run` call avoidable via shared output, but the F1 loop already runs one).

### D6 — F-tests-2 / F-dom-memory-1 fix: seeded LCG counter (not const string array)

**Decision:** Replace `Math.random().toString(36)` in `src/embedders/__tests__/stub.test.ts:61` with a seeded counter: `text-${i}-${seededLcg.next().toString(36)}` where `seededLcg` is a small LCG seeded at `0x_t4_2_seed === 0x_e_c_1` (matches the EC-1 absorption context). Reuse the existing `makeSeededRandom` helper at `tests/integration/forgetting/fixtures/deterministic-hash.ts` if it can be imported across config boundaries; otherwise inline a 5-line LCG.

**Alternatives considered:**
- (A) Use a const string array of 1000 pre-baked inputs — **Rejected** because the test purpose is "stress 1000 distinct seeds"; pre-baked array still works but loses the EC-1 stress semantics (any 1000 distinct inputs catch the rare zero-vector case, but the seeded sequence ALSO catches it deterministically without polluting the test source with a 1000-entry literal).
- (B) Inline seeded LCG (CHOSEN). 5 lines; deterministic; honors `testing.md § Determinism`.
- (C) Import `makeSeededRandom` from `tests/integration/forgetting/fixtures/deterministic-hash.ts` — **Deferred** because the contract test config (vitest.contract.config.ts) doesn't cover `tests/integration/`; importing across config boundaries is allowed in TypeScript but creates a moral coupling. Inline is KISS.

**Rationale:** Honors `testing.md § Determinism` + Inquebrável Rule 10 (KISS).

**Consequences:** EC-1 stress test becomes byte-reproducible across runs. Test runtime unchanged.

## Dependency Graph

```
T0.1 (audit-trail: ADR-DEFER markers + validation report amend)     [CRITICAL F-wire-1 + MAJOR F-wire-2]
  ↓ (provides the marker grep that re-establishes pillar b)
T0.2 (config: tsconfig.build.json widen)                            [MAJOR F-arch-1]
  ↓ (parallelizable with T0.1; no dependency)
T0.3 (CHANGELOG: [Unreleased] § Added entry)                        [MAJOR F-xval-1]
  ↓ (parallelizable with T0.1 / T0.2; independent)

  ─── T0.x can run in any order; all are doc/config only ───

T1.1 (source: F-dom-memory-2 concatUserContent strip-prefix)        [MINOR F-dom-memory-2]
T1.2 (source: F-arch-2 + F-arch-3 JSDoc honesty + plan ADR D2 fix)  [MAJOR F-arch-2 + F-arch-3]
  ↓ (T1.1 + T1.2 parallelizable — different files)

T2.1 (tests: F-tests-1 explicit publish-readiness assertions)       [MINOR F-tests-1]
T2.2 (tests: F-tests-2 seeded LCG replaces Math.random)             [MINOR F-tests-2 / F-dom-memory-1]
T2.3 (tests: F-tests-3 regex replaces tautological string check)    [MINOR F-tests-3]
  ↓ (T2.x parallelizable — different files)

T3.1 (cosmetic: F-wire-3 + F-arch-4 + F-arch-6 + F-arch-8 JSDoc)   [4 MINOR doc-only]
  ↓ (independent of all source/test changes)

T4.1 (integration validation gate)                                  [Final phase]
  ↑ blocked by ALL above
```

T0.x are all doc/config; T1.x are source code; T2.x are test code; T3.x are cosmetic JSDoc. T4.1 is the integration validation gate.

## Phases

### T0.1 — F-wire-1 (CRITICAL) + F-wire-2 (MAJOR) — ADR-DEFER markers + validation report amend

**Plan reference:** ADR D1.

**Files to edit:**
- `.claude/knowledge-base/implementations/adapters-stub-embedder-llm-cycle-1-implementation.md` (UPDATE — add 2 ADR-DEFER-WIRING-B markers using literal colon separator `<!-- ADR-DEFER-WIRING-B: DeterministicStubEmbedder: pillar (b) deferred to F-T4.1-2 debug cycle which will land tests/integration/forgetting/f-t4-1-2-stub-reproduction.test.ts -->` + replace the false claim in "Wiring triad scope for this plan" section)
- `.claude/knowledge-base/reviews/adapters-stub-embedder-llm-cycle-1-implement-validate-2026-06-01.md` (UPDATE — amend line 46 to cite ADR-DEFER markers instead of the `testing.md § Determinism` substitution claim. **EC-7 absorption:** the audit-trail edit is a one-off honesty fix to remove fabricated rationale; commit message MUST explicitly note "honesty correction to audit-trail per Inquebrável Rule 3; NOT a precedent for retrospective audit edits". Follow-up: update `audit-trail-rotation.md` to define the policy.)

**Deep file dependency analysis:**
- The implementation contract is a markdown audit file; no compiler dependency.
- The validation report is the trail consumed by `cycle-review.md § Hard gates #4` ("if tests broke between /implement-validate and /review-execute, halt"). Amending line 46 does not break the validation chain because the gates table (lines 14-19) remains unchanged.
- `python3 .claude/skills/implement/scripts/check_wiring.py --symbol DeterministicStubEmbedder --deferral-path .claude/knowledge-base/implementations/adapters-stub-embedder-llm-cycle-1-implementation.md` runs the regex at `check_wiring.py:165` (`rf"<!--\s*ADR-DEFER-WIRING-B:\s*{re.escape(symbol)}\s*:\s*[^>]+?-->"`) against the implementation contract; verifies via REGEX match (NOT verbatim `grep`). **EC-1 absorption:** the literal `:` separator between `<symbol>` and `<reason>` is non-negotiable; markers using em-dash `—` will silently grep-pass but regex-fail (script returns `HALT` with "Found ADR-DEFER-WIRING-B marker(s), but none matched the required `<!-- ADR-DEFER-WIRING-B: {symbol}: <reason> -->` shape").

**TDD:**
- **RED:** `grep -c 'ADR-DEFER-WIRING-B: DeterministicStubEmbedder' .claude/knowledge-base/implementations/adapters-stub-embedder-llm-cycle-1-implementation.md` returns `0`. Re-run of `python3 .claude/skills/implement/scripts/check_wiring.py --symbol DeterministicStubEmbedder --deferral-path .claude/knowledge-base/implementations/adapters-stub-embedder-llm-cycle-1-implementation.md` returns non-zero exit + stdout shows pillar_b `status: FAIL`.
- **GREEN:** Add the 2 markers using `: ` colon separator (1 per symbol) + amend validation report line 46. Same greps return `1` each.
- **EC-4 absorption — REAL GATE TEST (mandatory, not approximate):** Run `python3 .claude/skills/implement/scripts/check_wiring.py --symbol DeterministicStubEmbedder --deferral-path .claude/knowledge-base/implementations/adapters-stub-embedder-llm-cycle-1-implementation.md` and assert (a) exit code `0`, (b) stdout JSON contains `"status": "DEFER"` AND `"deferred_via"` referencing the implementation contract path. Repeat for `DeterministicStubLLM`. ONLY this passes the contract; the grep is approximation and would silently let em-dash markers through (EC-1 failure mode).
- **REFACTOR:** None — text changes only.

**Acceptance criteria:**
- [ ] `grep -c 'ADR-DEFER-WIRING-B: DeterministicStubEmbedder: ' .claude/knowledge-base/implementations/adapters-stub-embedder-llm-cycle-1-implementation.md` returns `1` (note literal `: ` colon+space after symbol — EC-1 absorption)
- [ ] `grep -c 'ADR-DEFER-WIRING-B: DeterministicStubLLM: ' .claude/knowledge-base/implementations/adapters-stub-embedder-llm-cycle-1-implementation.md` returns `1` (same separator)
- [ ] **EC-4 mandatory gate:** `python3 .claude/skills/implement/scripts/check_wiring.py --symbol DeterministicStubEmbedder --deferral-path .claude/knowledge-base/implementations/adapters-stub-embedder-llm-cycle-1-implementation.md` exits 0 AND stdout contains `"status": "DEFER"`. Same for `DeterministicStubLLM`.
- [ ] The implementation contract's "Wiring triad scope" section (lines 47-53) drops the claim "deterministic-invariant tests ARE the integration evidence per `testing.md` § Determinism"; replaces with "deferred via ADR-DEFER-WIRING-B markers; F-T4.1-2 debug cycle lands `tests/integration/forgetting/f-t4-1-2-stub-reproduction.test.ts`"
- [ ] Validation report line 46 dropped; replaced with "Pillar (b) DEFERRED via ADR-DEFER-WIRING-B markers in the implementation contract; landing site declared as F-T4.1-2 debug cycle's `tests/integration/forgetting/f-t4-1-2-stub-reproduction.test.ts`"
- [ ] `cycle-review.md § Hard gates #1` no longer fires for this branch

**Definition of Done:**
- [ ] Files modified, marker greps PASS
- [ ] Pre-commit hooks pass
- [ ] Conventional commit: `docs(implement)(adapters-cycle-1-fixes): ADR-DEFER-WIRING-B markers + amend validation rationale (T0.1 / F-wire-1 + F-wire-2)`

**No new test code; this is a documentation/audit-trail fix. Explicit "no TDD" rationale per `testing.md`: doc-only change with no behavior impact. The TDD discipline IS satisfied by `check_wiring.py` re-run being the test.**

### T0.2 — F-arch-1 (MAJOR) — tsconfig.build.json widen

**Plan reference:** ADR D1 of source plan (config widening) + `architecture.md § 10.1` (`F-T7.1-3` defect family).

**Files to edit:**
- `tsconfig.build.json` (UPDATE line 10 — extend include glob)

**Deep file dependency analysis:**
- `tsconfig.build.json` extends `tsconfig.contract.json`. The include is what tsc emits; widening it makes `tsc -p tsconfig.build.json` emit `dist/embedders/` + `dist/llms/`.
- `tsconfig.contract.json` (line 26) is the typecheck source-of-truth and already includes the new dirs.
- `npm run build` script (package.json line 56) invokes `tsc -p tsconfig.build.json && npm run postbuild:copy-migrations`. Build output expected at `dist/embedders/{stub,index}.js` + `dist/llms/{stub,index}.js` post-fix.
- No runtime path consumes `dist/embedders/` today (`package.json#exports` points to `./src/*.ts`); the widening is defensive per `architecture.md § 10.1`. Future consumers may switch exports to dist; widening prevents the silent-skip.

**TDD:**
- **RED:** Add new integration test `tests/integration/config-parity.test.ts` extension (the existing file already contains the sentinel per `testing.md § Typecheck scope — transitive expansion gotcha`). The new assertion: `tsconfig.build.json#include` covers every directory that `tsconfig.contract.json#include` covers (NOT just src/{core,theokit,agent-tools}). Test fails because build excludes embedders/llms.
- **GREEN:** Widen `tsconfig.build.json` line 10 to add `"src/embedders/**/*.ts"`, `"src/llms/**/*.ts"`. Test passes. `npm run build` emits `dist/embedders/`, `dist/llms/`.
- **REFACTOR:** None.

**Acceptance criteria:**
- [ ] `tsconfig.build.json#include` is a superset of `tsconfig.contract.json#include` (minus test/__tests__ excludes)
- [ ] `npm run build` emits `dist/embedders/stub.js` + `dist/embedders/index.js` + `dist/llms/stub.js` + `dist/llms/index.js`
- [ ] Test `tests/integration/config-parity.test.ts` assertion passes

**Definition of Done:**
- [ ] Config widened, new tsconfig-parity test passes
- [ ] `npm run build` clean (no new errors)
- [ ] `npm test` exit 0
- [ ] Pre-commit hooks pass
- [ ] Conventional commit: `chore(config)(adapters-cycle-1-fixes): widen tsconfig.build.json to mirror contract include (T0.2 / F-arch-1)`

### T0.3 — F-xval-1 (MAJOR) — CHANGELOG.md [Unreleased] § Added entry

**Plan reference:** Inquebrável Rule 6 (Changelogs) + source plan Global DoD line 168.

**Files to edit:**
- `CHANGELOG.md` (UPDATE — add 1 line to the topmost `[Unreleased]` § `Added` section)

**Deep file dependency analysis:**
- `CHANGELOG.md` has a `[Unreleased]` section at the top with multiple `### Added` blocks. The convention (per past entries) is one entry per major addition; entries are bullet points with a bold lead + cite to plan slug.
- **EC-5 absorption — placement convention locked:** the new entry inserts as a NEW `### Added` block IMMEDIATELY after the `## [Unreleased]` header (first child of `[Unreleased]`), NOT into an existing `### Added` block. Existing blocks preserve their chronological order downward (newest at top is the convention). This matches the pattern observed in recent commits (e.g., v0.6 `memory.skills` entry sits at top as its own `### Added` block).
- The pre-commit hook does NOT enforce CHANGELOG presence (verified by past commits — review report flagged this as an oversight, not a hook failure).

**TDD:**
- **RED:** `grep -E '@usetheo/memory/embedders/stub|adapters-cycle-1' CHANGELOG.md` returns empty.
- **GREEN:** Add bullet entry to top `[Unreleased] § Added` section. Same grep returns 1+ match.
- **REFACTOR:** None.

**Acceptance criteria:**
- [ ] `grep -c 'DeterministicStubEmbedder' CHANGELOG.md` ≥ 1
- [ ] `grep -c 'DeterministicStubLLM' CHANGELOG.md` ≥ 1
- [ ] `grep -c 'adapters-cycle-1' CHANGELOG.md` ≥ 1
- [ ] Entry cites: subpath exports (`@usetheo/memory/embedders/stub` + `@usetheo/memory/llms/stub`), `THEOMEM_USE_STUB_ADAPTERS=1` opt-in, plan reference (`adapters-stub-embedder-llm-cycle-1-plan.md` v1.1), `@experimental — debug only` flag

**Definition of Done:**
- [ ] CHANGELOG entry added per Keep a Changelog format
- [ ] Pre-commit hooks pass
- [ ] Conventional commit: `docs(changelog)(adapters-cycle-1-fixes): add Unreleased Added entry for stub adapters (T0.3 / F-xval-1)`

**No new test code; CHANGELOG is doc-only. Explicit "no TDD" rationale per `testing.md`: doc-only change. Grep is the test.**

### T1.1 — F-dom-memory-2 (MINOR) — concatUserContent strip-prefix regex

**Plan reference:** ADR D4.

**Files to edit:**
- `src/llms/stub.ts` (UPDATE lines 39-44 — extend `concatUserContent` with strip-prefix)
- `src/llms/__tests__/stub.test.ts` (UPDATE — add NEW test exercising pipeline-shape input)

**Deep file dependency analysis:**
- `concatUserContent` is called from `generateResponse({type:'json'})` at line 80. The output is fed to `extractFacts` which sentence-splits. Strip-prefix MUST happen before `extractFacts` to prevent prefix pollution.
- Production call site at `src/core/extraction/pipeline.ts:230` passes a SINGLE synthetic message with role `'user'` and content = `messages.map((m) => '${m.role}: ${m.content}').join('\n')`. After `concatUserContent` (which filters role==='user'), we get back the inline-prefixed string. Strip-prefix regex `/^(user|assistant|system):\s+/gm` applied with `m` flag matches each newline-anchored prefix.
- Existing tests exercise direct stub calls with non-prefixed content (line 56: `'I am Paulo. I work at TheoCloud...'`). These stay green.

**TDD:**
- **RED 1 (single-line strip):** New test `it('strips role-prefix when content is in pipeline.ts inline format', ...)` constructs a message matching the production format (`'user: hello\nassistant: hi back\nuser: how are you'`), calls `generateResponse({type:'json'})`, asserts that NONE of the extracted facts' `text` field starts with `/^(user|assistant|system):/`. Fails because current `concatUserContent` doesn't strip.
- **RED 2 (EC-2 absorption — multi-line + sentence-split composition):** New test `it('composes strip + sentence-split correctly on multi-line pipeline-shape input', ...)` constructs `messages = [{role:'user', content:'user: I am Paulo.\nassistant: Nice.\nuser: I work at TheoCloud. My language is TS.'}]`, calls `generateResponse({type:'json'})`. Assertions: (a) `json.memory` non-empty; (b) NO item's `text` starts with `/^(user|assistant|system):/i`; (c) at least one item's `text === 'I am Paulo'` (sentence-split worked after strip). This validates that strip + sentence-split compose correctly, not just that strip in isolation works.
- **GREEN:** Add strip-prefix step in `concatUserContent`:
  ```ts
  function concatUserContent(messages: readonly Message[]): string {
    const joined = messages.filter((m) => m.role === 'user').map((m) => m.content).join(' ');
    return joined.replace(/^(?:user|assistant|system):\s+/gim, '');
  }
  ```
  Note the `m` flag (multiline anchor) + `g` (global) + `i` (case-insensitive). New tests pass; existing tests stay green.
- **REFACTOR:** Consider extracting `stripRolePrefix(s: string): string` if it's used elsewhere; for now inline is KISS.

**Acceptance criteria:**
- [ ] New test asserts no role-prefix in extracted facts when input is pipeline-shape
- [ ] **EC-2 absorption:** New multi-line composition test asserts (a) `json.memory` non-empty, (b) no role-prefix, (c) `'I am Paulo'` appears as a fact (sentence-split survived strip)
- [ ] Existing tests (lines 51-117 of `stub.test.ts`) stay green
- [ ] `src/llms/stub.ts` LoC remains ≤ 200 (currently 86; +1-2 lines)
- [ ] JSDoc above `concatUserContent` documents the strip-prefix behavior with a `@see src/core/extraction/pipeline.ts:230` reference
- [ ] **EC-9 absorption:** JSDoc carries warning: "Best-effort line-anchored strip. Legitimate prose containing `user:`/`assistant:`/`system:` at line-start (e.g., quoting chat logs) WILL be affected. Acceptable because stub is `@experimental — debug only`; the production OpenAI adapter does NOT apply this heuristic."

**Definition of Done:**
- [ ] `npm test -- src/llms/__tests__/stub.test.ts` PASS (current 11 + 1 new = 12 tests)
- [ ] `npm run typecheck` exit 0
- [ ] `npm run lint` exit 0
- [ ] Pre-commit hooks pass
- [ ] Conventional commit: `fix(llms)(adapters-cycle-1-fixes): strip role-prefix in concatUserContent (T1.1 / F-dom-memory-2)`

### T1.2 — F-arch-2 (MAJOR) + F-arch-3 (MAJOR) — JSDoc honesty + source plan ADR D2 correction

**Plan reference:** ADR D2 + ADR D3.

**Files to edit:**
- `src/embedders/stub.ts` (UPDATE JSDoc lines 1-30 — correct LCG range claim + collision math)
- `.claude/knowledge-base/plans/adapters-stub-embedder-llm-cycle-1-plan.md` (UPDATE — source plan v1.1 → v1.2; ADR D2 Deep Dive math corrected)

**Deep file dependency analysis:**
- JSDoc-only changes have no code impact; behavior of `embed()` is byte-identical pre-fix vs post-fix.
- Plan correction is an in-place edit of the source plan file. Plan version bumps to v1.2 with frontmatter note "v1.2 (2026-06-01) — honesty correction to ADR D2 Deep Dive (LCG range + collision math). No behavior change. Triggered by `/review adapters-stub-embedder-llm-cycle-1-review-2026-06-01.md` F-arch-2 + F-arch-3 absorption."

**TDD:**
- **No TDD** — these are doc-only changes (JSDoc in src + markdown in plan). Explicit rationale per `testing.md`: "Every non-trivial logic change needs a test or explicit reason why not". Reason: doc-only fix; behavior unchanged; existing tests (current 8 in embedder + 11 in LLM) keep passing.
- **VERIFY:** `grep -c '~2\^32' src/embedders/stub.ts` returns `0` (old claim removed); `grep -c '~46' src/embedders/stub.ts` returns ≥ 1 (corrected claim present). Same greps against the source plan.

**Acceptance criteria:**
- [ ] `src/embedders/stub.ts` JSDoc states "Output range `[-1, 1+~2e-9]` (asymmetric by 1 ULP; L2-norm absorbs)"
- [ ] `src/embedders/stub.ts` JSDoc states "collision probability bounded by `seed % LCG_MODULUS` collapsing to ~2^31 effective space → ~46k inputs at 50% birthday probability"
- [ ] Source plan `adapters-stub-embedder-llm-cycle-1-plan.md` ADR D2 Deep Dive carries same corrected math
- [ ] Source plan frontmatter notes v1.1 → v1.2 with "honesty correction" rationale
- [ ] `npm test` still 570/2-skip (no behavior change)
- [ ] Existing embedder + LLM tests still PASS

**Definition of Done:**
- [ ] JSDoc + plan corrected; greps verify
- [ ] `npm test` exit 0
- [ ] `npm run typecheck` exit 0
- [ ] `npm run lint` exit 0
- [ ] Pre-commit hooks pass
- [ ] **EC-6 absorption:** Commit message body explicitly notes: "Source plan edit is HONESTY correction to ADR D2 Deep Dive math (collision space + LCG range claims); NOT scope drift per `cycle-review.md § Hard gates #2`. Triggered by F-arch-3 review finding. The source plan's contract (Goal, Objectives, Tasks, Coverage Matrix) is unchanged."
- [ ] Conventional commit: `docs(embedders)(adapters-cycle-1-fixes): honest LCG range + collision math in JSDoc + source plan ADR D2 (T1.2 / F-arch-2 + F-arch-3)`

### T2.1 — F-tests-1 (MINOR) — explicit publish-readiness assertions

**Plan reference:** ADR D5.

**Files to edit:**
- `tests/integration/publish-readiness.test.ts` (UPDATE — add 1 new `it()` block)

**Deep file dependency analysis:**
- The existing F1 followup block (lines 90-118) iterates `pkg.exports` and asserts each `conditions.default` target file is in `npm pack --dry-run` output.
- New explicit block asserts each of the 4 new subpath files (`src/embedders/stub.ts`, `src/embedders/index.ts`, `src/llms/stub.ts`, `src/llms/index.ts`) by exact name.
- Test runtime: `npm pack --dry-run --json` shared with F1 followup pattern; can reuse the call if extracted to a `beforeAll` hook OR run a fresh call (current pattern).

**TDD:**
- **RED:** New `it('EC-5 (F-tests-1): tarball POSITIVELY includes src/embedders/{stub,index}.ts + src/llms/{stub,index}.ts by name', ...)` asserts each path is in the `allPaths` set. Currently passes because the F1 followup already validates equivalent set, but the explicit assertion makes the regression guard auditable for the 52-adapter portfolio. RED via temporarily commenting out the `./embedders/stub` entry from `package.json#exports` — assertion fails because tarball no longer contains the file. Restore exports; GREEN.
- **GREEN:** Test asserts 4 files present. Always passes against current state.
- **REFACTOR:** Consider extracting a helper `assertFilePackedInTarball(path: string)` if test grows beyond 4 entries; for now inline 4 assertions is KISS.

**Acceptance criteria:**
- [ ] New `it()` block exists with 4 explicit assertions
- [ ] All 4 assertions PASS against current tarball
- [ ] F1 followup still PASS (no regression to existing test)
- [ ] **EC-10 absorption (DOCUMENT):** Followups table of this fix-up plan's implementation contract records: "Each future adapter cycle adds 1 `npm pack --dry-run` execution to publish-readiness.test.ts (~3s). Cumulative for 52-adapter portfolio: ~150s in test:integration runtime. Acceptable now (test:integration runs outside hot loop); revisit when test count > 20 by extracting `npm pack --dry-run` output to `beforeAll`-shared state. Per Inquebrável Rule 11 (YAGNI tempered)."

**Definition of Done:**
- [ ] `npm run test:integration -- tests/integration/publish-readiness.test.ts` PASS
- [ ] Pre-commit hooks pass
- [ ] Conventional commit: `test(integration)(adapters-cycle-1-fixes): explicit publish-readiness for 4 new subpath files (T2.1 / F-tests-1 / EC-5)`

### T2.2 — F-tests-2 / F-dom-memory-1 (MINOR) — seeded LCG counter replaces Math.random

**Plan reference:** ADR D6.

**Files to edit:**
- `src/embedders/__tests__/stub.test.ts` (UPDATE line 61 — replace `Math.random()` with seeded counter)

**Deep file dependency analysis:**
- The EC-1 stress test iterates 1000 times, generating distinct inputs to exercise the L2-norm guard. The `Math.random()` makes each run produce a different sequence — that's flakiness even when the test always passes, per `testing.md § Determinism` ("LLM calls in unit tests use stubs ... Embeddings in unit tests use deterministic fixtures").
- Replacement: inline 5-line LCG generates 1000 deterministic distinct strings.

**TDD:**
- **RED:** Add NEW assertion: same 1000 inputs in 2 separate runs must produce byte-identical embedding outputs (cross-run determinism). Currently fails because `Math.random()` changes the input per run.
- **GREEN:** Replace `Math.random().toString(36)` with `seededLcg.next().toString(36)`. Add inline LCG (5 lines). Cross-run determinism assertion passes.
- **REFACTOR:** None (5-line LCG inline is the simpler solution).

**Acceptance criteria:**
- [ ] Test runs twice produce byte-identical assertions (no flake)
- [ ] EC-1 stress still iterates 1000 distinct inputs
- [ ] Test runtime unchanged (< 1s for the 1000 iterations)

**Definition of Done:**
- [ ] `npm test -- src/embedders/__tests__/stub.test.ts` PASS
- [ ] Run twice; outputs deeply equal
- [ ] Pre-commit hooks pass
- [ ] Conventional commit: `test(embedders)(adapters-cycle-1-fixes): seeded LCG replaces Math.random in EC-1 stress (T2.2 / F-tests-2)`

### T2.3 — F-tests-3 (MINOR) — regex replaces tautological string check

**Plan reference:** Source plan ADR D3 (canned-response contract `stub-response:<hex>`).

**Files to edit:**
- `src/llms/__tests__/stub.test.ts` (UPDATE lines 40 + 47 — replace `typeof r.content === string` with regex match; **EC-3 absorption** — ALSO extend lines 119-130 generateResponse text-type block with same regex assertion against `text.text`)

**Deep file dependency analysis:**
- Lines 40 + 47 currently assert `typeof r.content === 'string'`. Per the source plan ADR D3, the chat content shape is `stub-response:<4-hex-chars>`. The regex `/^stub-response:[0-9a-f]{4}$/` matches the contract; the tautological check passes for any string output (including `'undefined'`, `''`, etc.).
- The existing tests at lines 19-34 already exercise determinism + distinctness; adding regex catches contract violations missed by determinism alone (e.g., a bug that returns `'OK'` for all inputs would pass determinism but fail regex).
- **EC-3 absorption:** lines 119-130 (`generateResponse({type:'text'})` block) currently assert `text.text === chat.content` — but if BOTH sides regress to `'OK'`, the equality holds and the contract is silently broken. Adding `expect(text.text).toMatch(STUB_CONTENT_RE)` locks the shape on the text-type path as well.

**TDD:**
- **RED:** Add NEW assertion before line 40: `expect(r.content).toMatch(/^stub-response:[0-9a-f]{4}$/)`. Replace tautological `typeof === string` checks with the regex matcher at lines 40 + 47. **EC-3 absorption:** also add `expect(text.text).toMatch(STUB_CONTENT_RE)` at line 128 (after the existing `expect(text.text).toBe(chat.content)`). Verify current impl already passes (no behavior change needed).
- **GREEN:** No source code change; tests now assert the contract explicitly across all 3 surfaces (chat / chat-empty-messages / generateResponse-text).
- **REFACTOR:** Extract `STUB_CONTENT_RE = /^stub-response:[0-9a-f]{4}$/` constant at top of test file (used 3+ times now).

**Acceptance criteria:**
- [ ] Lines 40 + 47 use regex matcher per ADR D3
- [ ] Empty-messages test (line 47) also asserts regex match (empty messages still produce deterministic tag)
- [ ] **EC-3 absorption:** generateResponse text-type block (line 128) ALSO asserts regex match against `text.text`; contract enforced on all 3 surfaces
- [ ] `STUB_CONTENT_RE` extracted as module-level constant in test file

**Definition of Done:**
- [ ] `npm test -- src/llms/__tests__/stub.test.ts` PASS
- [ ] Pre-commit hooks pass
- [ ] Conventional commit: `test(llms)(adapters-cycle-1-fixes): regex matches ADR D3 chat shape (T2.3 / F-tests-3)`

### T3.1 — F-wire-3 + F-arch-4 + F-arch-6 + F-arch-8 — cosmetic JSDoc cluster (4 MINOR)

**Plan reference:** Various source plan ADRs; this is a doc cleanup batch.

**Files to edit:**
- `src/embedders/index.ts` (UPDATE — add `@remarks Phase A` JSDoc per F-wire-3)
- `src/llms/index.ts` (UPDATE — add `@remarks Phase A` JSDoc per F-wire-3)
- `src/embedders/stub.ts` (UPDATE — F-arch-4 absorption locked to option (B) **EC-8 absorption**: KEEP `v[i]!` non-null assertion AND add explanatory comment `// noUncheckedIndexedAccess: i bounded by [0, v.length) loop invariant` immediately above line 73. Rationale: `.at(i) ?? 0` silently substitutes `0` for out-of-bounds — that's fail-silent which violates Inquebrável Rule 8. The assertion throws if i ever escapes the loop bound, making bugs visible.)
- `src/llms/stub.ts` (UPDATE — JSDoc note that `generateResponse({type:'text'})` returns `{text: string}` shape NOT `{content: string, role: string}` per F-arch-6; JSDoc note that `SENTENCE_SPLIT_RE` is Latin-script-only per F-arch-8)

**Deep file dependency analysis:**
- All 4 changes are doc/cosmetic. F-arch-4 changes `v[i]!` to `v.at(i) ?? 0` OR keeps the assertion with an explanatory comment — depends on lint config.
- The barrel files (`src/embedders/index.ts` + `src/llms/index.ts`) are 1-line re-exports; JSDoc above the re-export documents the Phase A status.

**TDD:**
- **No TDD** — pure doc/cosmetic changes; existing tests stay green. Explicit "no TDD" rationale per `testing.md`: doc-only changes. Greps verify presence.

**Acceptance criteria:**
- [ ] `grep -c '@remarks Phase A' src/embedders/index.ts src/llms/index.ts` returns `2`
- [ ] **EC-8 absorption (locked):** `src/embedders/stub.ts` line 73 RETAINS `v[i]!` AND has explanatory `// noUncheckedIndexedAccess: i bounded by [0, v.length) loop invariant` comment on the previous line. `.at(i) ?? 0` substitution is REJECTED to preserve fail-fast semantics.
- [ ] `src/llms/stub.ts` JSDoc documents the `generateResponse({type:'text'})` shape AND the i18n-Latin-only sentence-split limitation

**Definition of Done:**
- [ ] All 4 JSDoc fixes land
- [ ] `npm test` exit 0 (no behavior change)
- [ ] `npm run typecheck` exit 0
- [ ] `npm run lint` exit 0
- [ ] Pre-commit hooks pass
- [ ] Conventional commit: `docs(adapters-cycle-1-fixes): JSDoc cleanup for barrel @remarks + LLM shape + i18n (T3.1 / F-wire-3 + F-arch-4 + F-arch-6 + F-arch-8)`

### T4.1 — Integration validation gate + push

**Plan reference:** Source plan T4.1 pattern.

**Tasks:**
1. `npm test` exit 0 (total tests 570 + new tests from T1.1 + T2.1 + T2.2 + T2.3 ≈ 573-575). **EC-11 absorption:** the expected count is APPROXIMATE — T1.1 adds 2 new tests (single-line + EC-2 multi-line), T2.1 adds 1, T2.2 adds 1 (cross-run determinism `it()` block), T2.3 modifies existing without count delta, T3.1 doc-only. Empirical adjustment expected at gate; do NOT block on strict count, block on exit code 0 AND zero new failures vs baseline 570.
2. `npm run typecheck` exit 0
3. `npm run lint` exit 0
4. `npm run build` PASS — `dist/embedders/{stub,index}.js` + `dist/llms/{stub,index}.js` present (post F-arch-1 fix)
5. `npm pack --dry-run` lists `src/embedders/{stub,index}.ts` + `src/llms/{stub,index}.ts`
6. `python3 .claude/skills/implement/scripts/check_wiring.py --symbol DeterministicStubEmbedder` returns verdict `PASS` (via ADR-DEFER marker)
7. `python3 .claude/skills/implement/scripts/check_wiring.py --symbol DeterministicStubLLM` returns verdict `PASS` (via ADR-DEFER marker)
8. `grep -E 'DeterministicStubEmbedder|adapters-cycle-1' CHANGELOG.md` returns ≥ 2 matches
9. No `production-ready` / `production-grade` / `v1.0 ready` token introduced
10. Commit + push to `origin/develop`

**Acceptance criteria:**
- [ ] All 10 checks PASS
- [ ] Write validation report at `.claude/knowledge-base/reviews/adapters-stub-embedder-llm-cycle-1-fixes-implement-validate-2026-06-01.md`

**Definition of Done:**
- [ ] All checks PASS
- [ ] Validation report written
- [ ] Pushed to `origin/develop`
- [ ] Conventional commit: `chore(implement)(adapters-cycle-1-fixes): validation gate + push (T4.1)`

## Coverage Matrix

| # | Severity | Resolved by task | Resolution mechanism | Verifiable how |
|---|---|---|---|---|
| F-wire-1 | CRITICAL | T0.1 | ADR-DEFER-WIRING-B markers | `check_wiring.py --symbol DeterministicStub...` PASS |
| F-wire-2 | MAJOR | T0.1 | Validation report L46 amend | Grep absence of "testing.md § Determinism" substitution rationale |
| F-arch-1 | MAJOR | T0.2 | tsconfig.build.json widen | `npm run build` emits dist/embedders/ + dist/llms/ |
| F-arch-2 | MAJOR | T1.2 | JSDoc honesty fix (range) | Grep "[-1, 1+~2e-9]" in src/embedders/stub.ts |
| F-arch-3 | MAJOR | T1.2 | JSDoc honesty fix (collision math) + source plan v1.1→v1.2 | Grep "~46k" in src + plan |
| F-xval-1 | MAJOR | T0.3 | CHANGELOG.md entry | Grep "DeterministicStub" in CHANGELOG |
| F-wire-3 | MINOR | T3.1 | @remarks Phase A JSDoc on barrels | Grep "@remarks Phase A" |
| F-tests-1 | MINOR | T2.1 | Explicit publish-readiness assertions | New it() block with 4 named-file matchers |
| F-tests-2 / F-dom-memory-1 | MINOR | T2.2 | Seeded LCG counter | Cross-run determinism test |
| F-tests-3 | MINOR | T2.3 | Regex matcher per ADR D3 | Grep `/^stub-response:[0-9a-f]{4}$/` in test |
| F-dom-memory-2 | MINOR | T1.1 | concatUserContent strip-prefix | New test asserts no role-prefix in pipeline-shape input |
| F-arch-4 | MINOR | T3.1 | Indexed-access cosmetic | Grep absence of bare `v[i]!` OR explanatory comment |
| F-arch-6 | MINOR | T3.1 | JSDoc clarification | Grep "generateResponse({type:'text'})" shape note |
| F-arch-8 | MINOR | T3.1 | JSDoc Latin-script note | Grep "i18n" or "Latin-only" |

14 / 14 findings mapped. Coverage Matrix: 100%.

### Edge-case absorption matrix (v1.1)

| # | Severity | Resolved by | Mechanism |
|---|---|---|---|
| EC-1 | MUST FIX | T0.1 (ADR D1 + Files to edit + Acceptance Criteria — all 3 places) | Marker uses literal `:` separator, not em-dash `—`; matches `check_wiring.py:165` regex |
| EC-2 | SHOULD TEST | T1.1 RED 2 | Multi-line pipeline-shape composition test (strip + sentence-split assertions) |
| EC-3 | SHOULD TEST | T2.3 | Regex assertion also applies to `generateResponse({type:'text'})` line 128 |
| EC-4 | SHOULD TEST mandatory | T0.1 GREEN gate test | Invokes `check_wiring.py` directly + asserts exit 0 + `"status": "DEFER"` JSON output |
| EC-5 | SHOULD TEST | T0.3 | CHANGELOG entry placement convention locked (new `### Added` block as first child of `[Unreleased]`) |
| EC-6 | DOCUMENT | T1.2 commit body | Notes "honesty correction NOT scope drift per cycle-review.md § Hard gates #2" |
| EC-7 | DOCUMENT | T0.1 commit body + audit-trail-rotation follow-up | One-off honesty fix; precedent risk flagged for policy update |
| EC-8 | DOCUMENT (locked option) | T3.1 | `v[i]!` retained with `// noUncheckedIndexedAccess: i bounded` comment; `.at(i) ?? 0` REJECTED |
| EC-9 | DOCUMENT | T1.1 JSDoc | "Best-effort line-anchored strip; legitimate prose with role-prefix WILL be affected; @experimental" |
| EC-10 | DOCUMENT | T2.1 followups table | 52-adapter portfolio cumulative test runtime ~150s; revisit when test count > 20 |
| EC-11 | DOCUMENT | T4.1 | Test count APPROXIMATE; block on exit 0 + zero new failures vs baseline 570, not strict count |

11 / 11 edge cases absorbed. EC absorption Coverage: 100%.

## Global Definition of Done

- [ ] All 10 tasks (T0.1, T0.2, T0.3, T1.1, T1.2, T2.1, T2.2, T2.3, T3.1, T4.1) committed
- [ ] `npm test` exit 0; test count ≈ 573-575 (EC-11 absorption: APPROXIMATE — block on exit code 0 + zero new failures vs baseline 570, not strict count)
- [ ] **EC-1 + EC-4 mandatory gate:** `check_wiring.py --symbol DeterministicStubEmbedder --deferral-path <impl-contract>` exits 0 AND stdout contains `"status": "DEFER"`. Same for `DeterministicStubLLM`. THIS is the contract test, NOT grep.
- [ ] `npm run typecheck` exit 0
- [ ] `npm run lint` exit 0 (covers `src/{embedders,llms}/**/*.ts` + `src/__tests__/**/*.ts`)
- [ ] `npm run build` PASS — `dist/embedders/{stub,index}.js` + `dist/llms/{stub,index}.js` present
- [ ] `npm pack --dry-run` lists `src/embedders/{stub,index}.ts` + `src/llms/{stub,index}.ts` (no regression to source plan T2.1's exports)
- [ ] `check_wiring.py --symbol DeterministicStubEmbedder` PASS (ADR-DEFER marker path)
- [ ] `check_wiring.py --symbol DeterministicStubLLM` PASS (ADR-DEFER marker path)
- [ ] CHANGELOG.md `[Unreleased] § Added` entry mentions DeterministicStub* + plan slug
- [ ] No `production-ready` / `production-grade` / `v1.0 ready` token introduced
- [ ] No paper names in src/test code
- [ ] File-size budgets respected (`src/embedders/stub.ts` 94/150; `src/llms/stub.ts` 86 → ≤ 90/200 after T1.1; barrels ≤ 30; demo `lib/memory.ts` 198/200)
- [ ] DIP boundaries preserved (no new imports across boundaries)
- [ ] All conventional commits follow `type(scope)(slug): subject (T-id / F-id)` format
- [ ] Inquebrável Rule 4 honored: develop branch only; zero `git checkout` / `git revert` / `git push --force` / `git reset --hard`; no `--no-verify`
- [ ] Inquebrável Rule 9 honored: zero new npm dep
- [ ] Validation report written to `.claude/knowledge-base/reviews/adapters-stub-embedder-llm-cycle-1-fixes-implement-validate-2026-06-01.md`
- [ ] Plan archived to `.claude/knowledge-base/plans/completed/` AFTER `/review` returns READY_TO_MERGE AND PR merged (per audit-trail-rotation.md `active → completed` lifecycle)

## Final Phase: Integration Validation (T4.1)

`npm test && npm run typecheck && npm run lint && npm run build && npm pack --dry-run | grep -E '(embedders|llms)/(stub|index)\.ts' | wc -l` returns exit 0 AND match count ≥ 4.

Re-run of `/review adapters-stub-embedder-llm-cycle-1-fixes` OPTIONAL — if the 14 findings are absorbed per their tasks above AND the integration validation gate passes, manual verification of the Coverage Matrix table is sufficient. The verdict on the SOURCE cycle (`adapters-stub-embedder-llm-cycle-1`) flips to READY_TO_MERGE via this fix-up cycle's audit trail.
