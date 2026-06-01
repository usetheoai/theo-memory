# Review: adapters-stub-embedder-llm-cycle-1-fixes

**Date:** 2026-06-01
**Branch:** develop @ `98f0b19`
**Plan:** v1.1 (SHIPPABLE_WITH_CAVEATS 84.4)
**Diff base:** `dc4ce2a` (preamble commit) → 10 commits (T0.1 → T4.1)
**Reviewers (spawned agents):** 5 — architecture, tests, wiring, cross-validation, domain-memory-layer

## Verdict

**READY_TO_MERGE** — Zero BLOCKER / zero CRITICAL / zero MAJOR / zero MINOR / 17 INFO across all 5 agents. The CRITICAL F-wire-1 hard-gate from the upstream source-cycle review is **DEFINITIVELY RESOLVED** via the EC-4 mandatory regex gate (`check_wiring.py` returns `verdict=PASS pillar_b=DEFER` for BOTH `DeterministicStubEmbedder` AND `DeterministicStubLLM`).

| Severity | Count |
|---|---|
| BLOCKER | 0 |
| CRITICAL | 0 |
| MAJOR | 0 |
| MINOR | 0 |
| INFO | 17 |
| **Total** | **17** |

| Agent | Verdict | Findings |
|---|---|---|
| wiring | READY_TO_MERGE | 0 findings (all 6 critical-surface checks PASS) |
| tests | TESTS_READY_TO_MERGE | 6 INFO (no padding; all verifications honest) |
| architecture | READY_TO_MERGE | 10 INFO (all 8 focus areas PASS via direct evidence) |
| domain-memory-layer | READY_TO_MERGE | 0 defects (7 domain checks PASS) |
| cross-validation | READY_TO_MERGE | 1 INFO (sub-cosmetic commit format note; not contract violation) |

## Critical surface verification (load-bearing for merge decision)

### F-wire-1 CRITICAL — RESOLVED via EC-4 mandatory regex gate

Both stubs return `verdict=PASS pillar_b=DEFER` via real `check_wiring.py` invocation:

```bash
python3 .claude/skills/implement/scripts/check_wiring.py \
  --symbol DeterministicStubEmbedder \
  --deferral-path $(realpath .claude/knowledge-base/implementations/adapters-stub-embedder-llm-cycle-1-implementation.md)
# → exit 0, verdict=PASS, pillar_b=DEFER, deferred_via=<impl-contract>
```

Same for `DeterministicStubLLM`. The regex at `check_wiring.py:165` requires LITERAL `:` separator between `<symbol>` and `<reason>` — em-dash would silently grep-pass but regex-fail. The fix-up cycle's T0.1 used literal colon per the EC-1 absorption, validated empirically.

### F-wire-2 MAJOR — RESOLVED

Validation report L46 amended: fabricated `testing.md § Determinism` substitution claim REMOVED, replaced with honest citation of ADR-DEFER markers + F-T4.1-2 debug cycle landing site.

### F-arch-1 + F-arch-2 + F-arch-3 + F-xval-1 MAJORs — ALL RESOLVED

- F-arch-1: `tsconfig.build.json` widened to mirror contract include; `npm run build` emits `dist/embedders/{stub,index}.{js,d.ts,*.map}` + `dist/llms/{stub,index}.{js,d.ts,*.map}`.
- F-arch-2: LCG range JSDoc honest claim `[-1, 1+~2e-9]`; `LCG_HALF_MODULUS_F64` constant LINE UNCHANGED.
- F-arch-3: Collision math corrected lockstep in src JSDoc + source plan v1.2 ADR D2 Deep Dive (`~46k birthday` at `~2^31 effective`).
- F-xval-1: CHANGELOG `[Unreleased] § Added` entry placed per EC-5 convention.

### 8 MINORs — ALL RESOLVED

F-wire-3, F-tests-1, F-tests-2 / F-dom-memory-1, F-tests-3, F-dom-memory-2, F-arch-4, F-arch-6, F-arch-8 — all per Coverage Matrix v1.1.

### 11 ECs — ALL ABSORBED

EC-1 through EC-11 absorbed inline per plan v1.1 + commit bodies + JSDoc warnings + Followups entries.

## Critical-surface checks (cross-agent consensus)

| Check | wiring | architecture | tests | domain | cross-val |
|---|---|---|---|---|---|
| EC-1 marker format colon-separator | ✓ | ✓ | n/a | n/a | ✓ |
| EC-4 mandatory regex gate (check_wiring.py exit 0) | ✓ | ✓ | n/a | n/a | n/a |
| EC-6 source plan edit `ffd37f7` commit body invariant | n/a | ✓ | n/a | ✓ | ✓ |
| EC-7 audit-trail edit `c729d52` commit body invariant | ✓ | ✓ | n/a | n/a | ✓ |
| EC-8 `v[i]!` retained (NOT `.at(i) ?? 0`) | n/a | ✓ | n/a | n/a | n/a |
| F-arch-2 constant LINE UNCHANGED | n/a | ✓ | n/a | ✓ | ✓ |
| F-dom-memory-2 strip-prefix schema-safe | ✓ | n/a | ✓ | ✓ | ✓ |
| DIP boundary preserved | ✓ | ✓ | n/a | ✓ | n/a |
| AdditiveExtractionSchema invariant held | ✓ | n/a | ✓ | ✓ | n/a |
| no-paper-names-in-code rule | n/a | ✓ | n/a | ✓ | n/a |
| Vocabulary lock (no production-ready claim in NEW code) | n/a | ✓ | n/a | ✓ | n/a |

**100% consensus across applicable agents on every check.** Zero contradictions.

## Quality gates summary (Step 5 — re-validated)

| Gate | Status | Evidence |
|---|---|---|
| `npm test` | PASS | 573 PASS + 2 skipped + 0 type errors (was baseline 570 + 3 net new from T1.1 EC-2 + T2.2 cross-run + T2.1 publish-readiness) |
| `npm run typecheck` | PASS | exit 0 |
| `npm run lint` | PASS | exit 0; covers `src/{embedders,llms}/**/*.ts` + `src/__tests__/**/*.ts` |
| `npm run build` | PASS | 4 new dist outputs emitted |
| `npm pack --dry-run` | PASS | 4 new subpath sources packed |
| Coverage on critical paths | PASS | unit + contract suite cover all 11 EC absorption surfaces |
| Wiring triad re-validation | PASS | (a) PASS 3 callers each; (b) DEFER via markers verified by real regex; (c) N/A |

## Edge-case coverage (Step 6)

Source: `/edge-case-plan` review `adapters-stub-embedder-llm-cycle-1-fixes-edge-cases-2026-06-01.md` — 11 ECs (1 MUST FIX + 4 SHOULD TEST + 6 DOCUMENT).

| EC | Severity | Status |
|---|---|---|
| EC-1 | MUST FIX | COVERED — marker format colon-separator locked + EC-4 regex gate verified |
| EC-2 | SHOULD TEST | COVERED — T1.1 multi-line composition test |
| EC-3 | SHOULD TEST | COVERED — T2.3 STUB_CONTENT_RE on text-type path line 128 |
| EC-4 | SHOULD TEST mandatory | COVERED — T0.1 GREEN gate test passes via real `check_wiring.py` |
| EC-5 | SHOULD TEST | COVERED — T0.3 CHANGELOG placement convention + T2.1 explicit publish-readiness |
| EC-6 | DOCUMENT | ABSORBED — T1.2 commit body literal "HONESTY correction NOT scope drift" + Goal/Objectives/Tasks/Matrix UNCHANGED verified |
| EC-7 | DOCUMENT | ABSORBED — T0.1 commit body "ONE-OFF honesty fix; NOT precedent" + Followups F2 reference |
| EC-8 | DOCUMENT (locked) | ABSORBED — T3.1 retains `v[i]!` with 8-line explanatory comment block |
| EC-9 | DOCUMENT | ABSORBED — T1.1 JSDoc strip-prefix best-effort warning |
| EC-10 | DOCUMENT | ABSORBED — T2.1 Followups F1 cumulative-runtime note |
| EC-11 | DOCUMENT | ABSORBED — T4.1 "block on exit 0 + zero new failures vs baseline 570" honored |

**Coverage: 11/11 = 100%.**

## Cross-validation summary (Step 7a)

- **Plan tasks:** 10 (T0.1, T0.2, T0.3, T1.1, T1.2, T2.1, T2.2, T2.3, T3.1, T4.1)
- **Fully implemented:** 10
- **Partial:** 0
- **Missing:** 0
- **Diverged:** 0 (all 6 ADRs D1-D6 respected — verified via grep on canonical artifacts)
- **Plan drift:** **none** for fix-up plan (v1.1 untouched since `dc4ce2a`); source-plan v1.1 → v1.2 edit is the documented EC-6 honesty-correction exception explicitly declared in fix-up ADR D3

## Architecture compliance summary

- **DIP boundary:** PASS — `src/embedders/`, `src/llms/` import ONLY from `../core/` + `node:crypto`
- **SOLID:** PASS — no SOLID-affecting changes in this doc/JSDoc/test fix-up
- **Naming + module hygiene:** PASS
- **File-size budgets:** PASS — `src/embedders/stub.ts` 124/150; `src/embedders/index.ts` 17/30; `src/llms/stub.ts` 116/200; `src/llms/index.ts` 17/30
- **Vocabulary lock:** PASS — zero `production-ready`/`production-grade`/`v1.0 ready` actual claims (3 hits all in negation/gate context, verified by architecture + domain agents)
- **No paper names rule:** PASS — grep returns ZERO hits across `src/embedders/`, `src/llms/`, and their `__tests__/`
- **Conventional commits:** PASS — all 10 commits follow `type(scope)(slug): subject (T-id / F-id [+ EC-id])` (1 INFO finding from cross-val agent re: T3.1 inner-scope omission — non-violation per plan declaration)
- **Inquebrável Rule 4:** PASS — develop only; zero `git checkout`/`git revert`/`git push --force`/`git reset --hard`; no `--no-verify`
- **Inquebrável Rule 9:** PASS — zero new npm deps

## Spawned agents (audit trail)

- `.claude/agents/review-adapters-stub-embedder-llm-cycle-1-fixes-2026-06-01/architecture.md` → `findings/architecture.yml`
- `.claude/agents/review-adapters-stub-embedder-llm-cycle-1-fixes-2026-06-01/tests.md` → `findings/tests.yml`
- `.claude/agents/review-adapters-stub-embedder-llm-cycle-1-fixes-2026-06-01/wiring.md` → `findings/wiring.yml`
- `.claude/agents/review-adapters-stub-embedder-llm-cycle-1-fixes-2026-06-01/cross-validation.md` → `findings/cross-validation.yml`
- `.claude/agents/review-adapters-stub-embedder-llm-cycle-1-fixes-2026-06-01/domain-memory-layer.md` → `findings/domain-memory-layer.yml`

Plus 5 paired knowledge skills per cycle-review v1.1 conventions.

## Followups (carried forward from /implement)

| # | Description | Owner |
|---|---|---|
| F1 | 52-adapter portfolio cumulative test runtime (~150s); revisit when test count > 20 via `beforeAll`-shared `npm pack --dry-run` output | Next adapter cycle when test count > 20 |
| F2 | Update `.claude/rules/audit-trail-rotation.md` to define policy for retrospective audit edits (triggered by T0.1 amend) | Maintainer |
| F3 (NEW from this review) | `check_wiring.py` crashes on relative `--deferral-path` with `ValueError` (Python pathlib strictness). Workaround: pass absolute path via `realpath`. Pre-existing script issue, NOT introduced by this cycle. | Skills maintainer |

## INFO findings (17 — for audit trail only)

Per-agent INFO findings (non-blocking, no padding):

- **architecture (10 INFO):** Verified EC-1 marker regex match; EC-6 commit body invariant present; EC-7 commit body invariant present + Followups F2; EC-8 v[i]! retention with comment block; F-arch-2 constant invariant line 63; DIP boundary clean; LoC budgets all under cap; vocabulary lock clean; no paper names in src/tests; minor out-of-scope note re: `check_wiring.py` relative-path script bug.
- **tests (6 INFO):** EC-2 behavior-level assertions verified; EC-5 named-file matchers verified; F1 followup preserved intact; LCG inline no cross-config import; STUB_CONTENT_RE on all 3 surfaces; pyramid balance 3 unit + 1 integration + 0 e2e appropriate; zero skipped/only.
- **wiring (0 findings):** all 6 critical-surface checks PASS — no padding emitted.
- **domain-memory-layer (0 defects):** all 7 domain checks PASS — no padding.
- **cross-validation (1 INFO):** sub-cosmetic commit format deviations (T3.1 inner-scope omission, T2.2 trailer naming); neither is a contract violation. Plan declaration permits this format.

## Handoff decision

**READY_TO_MERGE.**

This fix-up cycle closes the upstream source-cycle `/review adapters-stub-embedder-llm-cycle-1` verdict NEEDS_FIXES (1 CRITICAL + 5 MAJOR + 8 MINOR) plus 11 edge cases. All findings are now CLOSED with audit trail.

The source cycle (`adapters-stub-embedder-llm-cycle-1`) is also merge-ready. Both cycles can be merged together (already on develop; no cross-branch merge required).

### Next-step recommendations

1. **Open PR** `develop → main` covering both cycles (source `adapters-stub-embedder-llm-cycle-1` + fix-up `adapters-stub-embedder-llm-cycle-1-fixes`).
2. **F-T4.1-2 debug cycle** becomes the natural next: declared landing site `tests/integration/forgetting/f-t4-1-2-stub-reproduction.test.ts` will land the real integration test that resolves the pillar (b) defer + finally exercises the deterministic stubs against the eviction race condition.
3. **Address Followups F1 + F2 + F3** at their declared owners' next available cycle (none are blocking).

## What this review proves

The fix-up cycle is a textbook low-risk doc/JSDoc/test cleanup with one small behavioral fix (T1.1 `concatUserContent` strip-prefix). The HONESTY corrections (F-wire-2, F-arch-2, F-arch-3) are exactly the kind of "claims that don't hold up under careful re-reading" that the review gate exists to catch — and they were caught + closed honestly across 2 cycles (the original /review + this fix-up).

The CRITICAL F-wire-1 was resolved via the lowest-cost path (ADR-DEFER markers) rather than landing a premature integration test that would tangle with the F-T4.1-2 debug cycle's scope. The EC-4 absorption ensured the real regex gate was verified (not just grep approximation) — this is what catches em-dash regression. The honesty discipline held: marker format was locked at plan v1.1 absorption; the implementer used literal colon; the regex matched.

The plan-drift risk (EC-6 source plan edit) was acknowledged upfront, mitigated via commit body invariant, and verified by cross-validation agent. The audit-trail edit precedent (EC-7) was similarly acknowledged, mitigated, and tracked via Followups F2 for the policy update.

**Net cycle outcome:** 14 findings closed + 11 ECs absorbed + 10 commits + 0 new defects introduced + 100% review consensus on READY_TO_MERGE across 5 agents and all critical surfaces.
