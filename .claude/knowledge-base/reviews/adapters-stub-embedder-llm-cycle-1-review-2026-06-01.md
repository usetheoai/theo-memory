# Review: adapters-stub-embedder-llm-cycle-1

**Date:** 2026-06-01
**Branch:** develop @ `6c50ea5`
**Plan:** v1.1 (SHIPPABLE 96.8)
**Reviewers (spawned agents):** 5 — architecture, tests, wiring, cross-validation, domain-memory-layer

## Verdict

**NEEDS_FIXES** — 1 CRITICAL hard-gate violation (wiring pillar b) + 5 MAJOR. Merge MUST NOT proceed until the CRITICAL is resolved per `cycle-implement.md § Hard gates #5`. The CRITICAL has a low-cost remediation (1-2 ADR-DEFER markers in implementation contract) and does NOT require code revert; the rest are surgical fixes that fit in a single follow-up commit.

| Severity | Count |
|---|---|
| BLOCKER | 0 |
| CRITICAL | 1 |
| MAJOR | 5 |
| MINOR | 8 |
| INFO | 14 |
| **Total** | **28** |

## Quality gates summary (Step 5 — re-validated by /review)

| Gate | Status | Evidence |
|---|---|---|
| `npm test` | PASS | 74 files passed + 1 skipped; **570 tests passed** + 2 skipped + 0 type errors |
| `npm run typecheck` | PASS | exit 0 (`tsc --noEmit -p tsconfig.contract.json`) |
| `npm run lint` | PASS | exit 0; covers `src/{embedders,llms}/**/*.ts` + `src/__tests__/**/*.ts` |
| Coverage on critical paths | PASS | unit suite covers all 6 EC-mapped tests (5 / 6 SHOULD TEST absorbed; EC-5 gap is F-tests-1) |
| Wiring triad re-validation | **FAIL pillar (b)** | F-wire-1 (CRITICAL) — see Findings |

Deterministic gates from `/implement` ALL hold on re-run. The wiring triad re-validation FAILED on the deep check despite the /implement validation report claiming PASS via a fabricated rationale (F-wire-2 MAJOR).

## CRITICAL findings (HARD GATE — must resolve before merge)

### F-wire-1: Wiring triad pillar (b) FAIL on both new exports
- **Severity:** CRITICAL
- **Found by:** wiring agent
- **Files:** `src/embedders/stub.ts`, `src/llms/stub.ts`
- **Plan ref:** `cycle-implement.md § Hard gates #5` — "Wiring triad pillar (b) FAIL without ADR-DEFER — Halt; either add integration test OR add explicit `<!-- ADR-DEFER-WIRING-B: <reason> -->` marker"
- **Evidence:**
  - Re-run of `check_wiring.py --symbol DeterministicStubEmbedder|DeterministicStubLLM` returns verdict `HALT` for both
  - Zero files under `tests/integration/**` reference either class
  - Zero symbol-scoped `ADR-DEFER-WIRING-B` markers in plan, progress JSON, or implementation contract
- **Recommended action (lowest cost):** option (B) — add two one-liner ADR-DEFER markers + landing-site declaration to `.claude/knowledge-base/implementations/adapters-stub-embedder-llm-cycle-1-implementation.md`:
  ```
  <!-- ADR-DEFER-WIRING-B: DeterministicStubEmbedder — pillar (b) deferred to F-T4.1-2 debug cycle (next), which will land tests/integration/forgetting/f-t4-1-2-stub-reproduction.test.ts exercising the demo singleton path with THEOMEM_USE_STUB_ADAPTERS=1 + eviction enabled. -->
  <!-- ADR-DEFER-WIRING-B: DeterministicStubLLM — same as above; both adapters land in the same integration test. -->
  ```
  AND amend the /implement validation report at `.claude/knowledge-base/reviews/adapters-stub-embedder-llm-cycle-1-implement-validate-2026-06-01.md:46` to remove the fabricated rationale and cite the ADR-DEFER markers instead.

## MAJOR findings (surface; accept WITH_CAVEATS in PR description OR fix)

### F-wire-2: Validation report fabricated rationale for pillar (b)
- **Severity:** MAJOR
- **Found by:** wiring agent
- **File:** `.claude/knowledge-base/reviews/adapters-stub-embedder-llm-cycle-1-implement-validate-2026-06-01.md:46`
- **Evidence:** Report claims "contract tests assert all determinism invariants via Zod roundtrip + L2 norm + collision checks. Per `testing.md § Determinism`, these ARE the integration evidence for pure-function adapters." But `testing.md § Determinism` (lines 95-100) describes determinism as a PROPERTY of tests, NOT a substitution rule for the integration tier. `testing.md § Pyramid` locks the distinction explicitly.
- **Recommended action:** Amend the validation report line 46 to either (a) cite the ADR-DEFER markers added per F-wire-1 remediation, OR (b) flip pillar (b) state to DEFERRED in the report verdict table.

### F-arch-1: `tsconfig.build.json` NOT widened — asymmetric configs
- **Severity:** MAJOR
- **Found by:** architecture agent
- **File:** `tsconfig.build.json`
- **Plan ref:** Same defect family as F-T7.1-3 cited in `architecture.md § 10.1`
- **Evidence:** T0.1 widened `tsconfig.contract.json` to include `src/embedders/**/*.ts` + `src/llms/**/*.ts`, but `tsconfig.build.json` was not widened. Build emit will silently exclude the new dirs.
- **Recommended action:** Mirror the include in `tsconfig.build.json` (1-line change).

### F-arch-2: LCG output range is asymmetric `[-0.999…, 1.0]` not `[-1, 1]`
- **Severity:** MAJOR
- **Found by:** architecture agent
- **File:** `src/embedders/stub.ts` (LCG_HALF_MODULUS_F64 constant)
- **Evidence:** `LCG_HALF_MODULUS_F64 = Number(LCG_MODULUS / 2n)` floors via BigInt division → loses 0.5. JSDoc claims range `[-1, 1]` but actual range is asymmetric.
- **Recommended action:** Replace with `Number(LCG_MODULUS - 1n) / 2` OR update JSDoc to match actual range. Absorbed by L2-norm so no behavioral impact; honesty fix only.

### F-arch-3: Collision claim in JSDoc / ADR D2 wrong (2^32 vs 2^31)
- **Severity:** MAJOR
- **Found by:** architecture agent
- **File:** `src/embedders/stub.ts` JSDoc + plan ADR D2 Deep Dive
- **Evidence:** JSDoc claims `~2^32 birthday`; effective seed space after `seed % LCG_MODULUS` (prime modulus `2^31 - 1`) is ~2^31 → birthday at ~46k inputs, NOT ~65k. Plan inherited the same incorrect math.
- **Recommended action:** Correct the JSDoc and plan ADR D2 Deep Dive to cite ~46k birthday at 50% collision (still vastly exceeds debug needs, but math must be accurate).

### F-xval-1: `CHANGELOG.md [Unreleased] § Added` entry missing
- **Severity:** MAJOR
- **Found by:** cross-validation agent
- **File:** `CHANGELOG.md`
- **Plan ref:** Plan Global DoD line 493 + implementation contract checkbox both require it
- **Evidence:** `grep -E 'DeterministicStub|embedders/stub|llms/stub|THEOMEM_USE_STUB|adapters-cycle-1' CHANGELOG.md` returns empty.
- **Recommended action:** Add `[Unreleased] § Added` entry: `Deterministic stub adapters (debug-only, @experimental) at @usetheo/memory/embedders/stub + @usetheo/memory/llms/stub; opt-in via THEOMEM_USE_STUB_ADAPTERS=1 in the chat-with-memory demo (#adapters-cycle-1)` per Inquebrável Rule 6.

## MINOR findings (8) — surface; non-blocking

| ID | Source | File | Summary |
|---|---|---|---|
| F-wire-3 | wiring | `src/embedders/index.ts`, `src/llms/index.ts` | Barrel files have no runtime callers (only smoke tests). Acceptable per ADR D4 portfolio scaffolding but should carry `@remarks Phase A` JSDoc to avoid future dead-code misclassification. |
| F-tests-1 | tests | `tests/integration/publish-readiness.test.ts` | EC-5 not absorbed: existing test was not extended to grep `npm pack` for the 4 new files. ~6 LoC fix. |
| F-tests-2 / F-dom-memory-1 | tests + domain | `src/embedders/__tests__/stub.test.ts:61` | `Math.random()` in EC-1 stress test violates `testing.md § Determinism`. Replace with seeded LCG counter. |
| F-tests-3 | tests | `src/llms/__tests__/stub.test.ts:40,47` | `expect(typeof r.content).toBe('string')` is tautological. Replace with `/^stub-response:[0-9a-f]{4}$/` per ADR D3 contract. |
| F-dom-memory-2 | domain | `src/llms/stub.ts:39-44` | `concatUserContent` filters `role==='user'` but production call site (`pipeline.ts:230`) inlines `"role: content"` lines. Sentence-split produces facts with literal `"user: ..."` / `"assistant: ..."` prefix → polluted dedup hashes when stub is used. Add strip-prefix regex OR JSDoc warning. |
| F-arch-4 | architecture | `src/embedders/stub.ts` | Indexed-access non-null assertion (cosmetic). |
| F-arch-6 | architecture | `src/llms/stub.ts` | `generateResponse({type:'text'})` shape diverges from `generateChat` shape (ambiguity in contract). |
| F-arch-8 | architecture | `src/llms/stub.ts` | Sentence-split regex i18n-brittle (no non-Latin period handling). |

## INFO (14) — for the audit trail

| ID | Source | Summary |
|---|---|---|
| F-wire-4 | wiring | Demo `THEOMEM_USE_STUB_ADAPTERS=1` branch has zero CI coverage (manual smoke only). Track for F-T4.1-2 debug cycle. |
| F-tests-4 | tests | `toBeDefined()` in `exports.test.ts` is fine in context (paired with identity check). |
| F-tests-5 | tests | Demo wiring T3.1 has no automated coverage by plan ADR D5 exemption; doesn't scale across the 52-adapter roadmap. |
| F-tests-6 | tests | L2 norm OR-branched assertion literally satisfies AC but weakens regression guard against silent EC-1-fallback regressions. |
| F-dom-memory-3 | domain | LCG output range tiny float overshoot (`~[-1, 1+2e-9]`); absorbed by L2-norm. |
| F-dom-memory-4 | domain | `generateChat` is `async` but body is sync; eslint-disable used. Optional `Promise.resolve(...)` refactor. |
| F-arch-5 | architecture | `void _tools;` pattern note (cosmetic). |
| F-arch-7 | architecture | Pre-existing `src/local/stubs.ts` misplacement (forward-flagged, NOT in this cycle's scope). |
| F-arch INFO×7 | architecture | Barrel pattern correctness; ADR D4 enforcement test; DIP boundary clean; `package.json#exports` shape; demo resolver pattern parity; test runner config gate; ADR D3 hex tag wording note. |
| F-xval-2 | cross-validation | Demo `lib/memory.ts` at 198/200 LoC (99% of budget). 2 LoC headroom for next demo change. |
| F-xval-3 | cross-validation | Implementation contract "Halt-loop audit trail" table is empty (header only). Non-blocking documentation gap. |

## Edge-case coverage report (Step 6)

Source: `.claude/knowledge-base/reviews/adapters-stub-embedder-llm-cycle-1-edge-cases-2026-06-01.md` — 11 edge cases (1 MUST FIX + 6 SHOULD TEST + 4 DOCUMENT).

| EC | Family | Status |
|---|---|---|
| EC-1 (NaN guard) | MUST FIX | **COVERED** — `l2Normalize` 1e-30 threshold + zeros fallback + 1000-input stress test |
| EC-2 (empty string embedder) | SHOULD TEST | **COVERED** — `stub.test.ts` empty-string assertion |
| EC-3 (empty messages LLM) | SHOULD TEST | **COVERED** — `stub.test.ts` empty-messages assertion |
| EC-4 (no sentence terminators) | SHOULD TEST | **COVERED** — `stub.test.ts` no-terminator assertion |
| EC-5 (subpath exports + npm pack) | SHOULD TEST | **MISSING** — F-tests-1 (MINOR) |
| EC-6 (root no-reexport ADR D4) | SHOULD TEST | **COVERED** — `src/__tests__/no-root-reexport.test.ts` (3 assertions) |
| EC-7 (tsconfig widening baseline) | SHOULD TEST | **IMPLICITLY COVERED** — baseline 544→570 verified by cross-validation agent |
| EC-8 to EC-11 | DOCUMENT | N/A (risk accepted upfront) |

**Coverage:** 5 / 6 SHOULD TEST absorbed + 1 MUST FIX absorbed = **85.7%** (F-tests-1 closes the gap).

## Cross-validation summary (Step 7a)

- **Plan tasks:** 6 (T0.1, T1.1, T1.2, T2.1, T3.1, T4.1)
- **Fully implemented:** 6
- **Partial:** 0
- **Missing:** 0
- **Diverged (with HONEST IMPROVEMENT):** 1 — T1.2 SEPA pre-RED locked `{ memory: [...] }` over plan v1.0's `{ facts: [...] }`; ADR D3 explicitly references this absorption in the plan v1.1
- **ADR compliance:** 6 / 6 (D1-D6 respected; D3 evolved with documented evidence)
- **Plan drift:** none (plan written at commit `1d0a373` v1.1, never modified during `/implement`)

## Spawned agents (audit trail)

- `.claude/agents/review-adapters-stub-embedder-llm-cycle-1-2026-06-01/architecture.md` → findings/architecture.yml
- `.claude/agents/review-adapters-stub-embedder-llm-cycle-1-2026-06-01/tests.md` → findings/tests.yml
- `.claude/agents/review-adapters-stub-embedder-llm-cycle-1-2026-06-01/wiring.md` → findings/wiring.yml
- `.claude/agents/review-adapters-stub-embedder-llm-cycle-1-2026-06-01/cross-validation.md` → findings/cross-validation.yml
- `.claude/agents/review-adapters-stub-embedder-llm-cycle-1-2026-06-01/domain-memory-layer.md` → findings/domain-memory-layer.yml

## Architecture compliance summary

- **DIP boundary:** PASS — `src/embedders/`, `src/llms/` import ONLY from `src/core/` + `node:crypto`
- **SOLID:** PASS — SRP/OCP/LSP/ISP respected
- **Naming + module hygiene:** PASS — kebab-case files, PascalCase classes, no `any`, no `console.log` outside stubs (ADR D8 exception with eslint-disable)
- **File-size budgets:** PASS — stub.ts 94/150, llms/stub.ts 86/200, barrels ~10/30, demo lib/memory.ts 198/200
- **Vocabulary lock:** PASS — zero `production-ready` / `production-grade` / `v1.0 ready` tokens
- **No paper names rule:** PASS — Park-Miller / Lehmer LCG are algorithm citations (not memory-system paper names per `no-paper-names-in-code.md` scope)
- **Conventional commits:** PASS — all 5 commits follow `type(scope)(slug): subject (T-id)`
- **Inquebrável Rule 4 (git safety):** PASS — develop only; zero `git checkout` / `git revert` / `git push --force` / `git reset --hard`; no `--no-verify`
- **Inquebrável Rule 9 (Não Reinvente):** PASS — zero new npm dep (Node built-in `crypto` + textbook LCG)

## Handoff decision

**NEEDS_FIXES** — loop back to a single fix commit (NOT a full `/implement` re-cycle):

1. **CRITICAL (mandatory before merge):** F-wire-1 — add 2 ADR-DEFER-WIRING-B markers to implementation contract + amend validation report line 46
2. **MAJOR (mandatory before merge):** F-arch-1 (`tsconfig.build.json` widen) + F-xval-1 (`CHANGELOG.md` Added entry)
3. **MAJOR (HONESTY fix; mandatory before merge):** F-wire-2 (validation-report rationale), F-arch-2 (LCG range JSDoc), F-arch-3 (collision math)
4. **MINOR (recommended, can defer to next cycle):** F-tests-1 (EC-5), F-tests-2 / F-dom-memory-1 (`Math.random()`), F-tests-3 (LLM tautological), F-dom-memory-2 (`concatUserContent` prefix bug), F-arch-4 / F-arch-6 / F-arch-8 (cosmetic / contract ambiguity / i18n)

Estimated fix cost: 1 commit, ~30 LoC across 5 files (config + docs + 2 source files), 15-30 minutes of work. After the fix commit lands, re-run `/review` is OPTIONAL — the BLOCKER count was 0 and no architectural change is in the remediation set; a manual verification of the 6 mandatory items is sufficient.

## What this review proves

The implementation is architecturally sound (0 BLOCKER, 0 design-level CRITICAL), DIP boundaries are clean, ADR compliance is high (6/6 with one HONEST IMPROVEMENT), and the deterministic gates re-validate GREEN. The CRITICAL hard-gate violation is a process/honesty gap (pillar b claimed PASS via fabricated rationale) rather than a code defect — the stubs ARE pure functions whose contract suite IS load-bearing, but the contract suite is NOT a substitute for the integration tier per `testing.md § Pyramid`. The right move is to defer pillar (b) honestly via ADR-DEFER-WIRING-B markers + land the real integration test in the next cycle (F-T4.1-2 debug, which consumes these stubs by design).

The 3 MAJOR honesty fixes (F-wire-2, F-arch-2, F-arch-3) are exactly the kind of defects this gate exists to catch: claims in docs/JSDoc that don't hold up under careful re-reading. The gate worked.
