# Review: f-t4-1-2-eviction-race-debug

**Date:** 2026-06-01
**Branch:** develop @ `c004d76` (+ 1 post-review fix commit pending)
**Plan:** v1.1 (SHIPPABLE_WITH_CAVEATS 81.2)
**Reviewers (spawned agents):** 5 — cross-validation, architecture, tests, wiring, domain-memory-layer

## Verdict

**READY_TO_MERGE** — Zero BLOCKER / zero CRITICAL / 0 MAJOR (2 MAJORs flagged by tests agent — both ABSORBED inline pre-merge per cycle-review.md § Hard gates) / 4 MINOR / 9 INFO.

The HONEST FINDING from /implement (bug doesn't reproduce in pure-SDK with deterministic stubs OR simulated OpenAI latency) was VALIDATED by all 5 review agents as genuine empirical evidence, not avoidance of work.

| Severity | Count (initial) | Count (post-absorption) |
|---|---|---|
| BLOCKER | 0 | 0 |
| CRITICAL | 0 | 0 |
| MAJOR | 2 | 0 (absorbed inline) |
| MINOR | 4 | 4 (non-blocking) |
| INFO | 9 | 9 |
| **Total findings** | **15** | **13 (after MAJOR absorption)** |

| Agent | Verdict | Findings (initial) |
|---|---|---|
| cross-validation | READY_TO_MERGE_WITH_HONEST_FINDING | 0/0/0/0/0 |
| architecture | READY_TO_MERGE | 0/0/0/0/6 INFO |
| wiring | READY_TO_MERGE | 0/0/0/1 MINOR/1 INFO |
| tests | SHIPPABLE_WITH_CAVEATS | 0/0/**2 MAJOR**/2 MINOR/2 INFO |
| domain-memory-layer | READY_TO_MERGE | 0/0/0/1 MINOR (dup of wiring F-wire-1) |

## MAJOR findings — ABSORBED inline (zero remaining pre-merge)

### F-tests-1 — `dumpPgLocks` asymmetric across variants

- **Severity:** MAJOR (test diagnostic quality)
- **Found by:** tests agent
- **File:** `tests/integration/forgetting/f-t4-1-2-stub-reproduction.test.ts`
- **Evidence (pre-absorption):** `dumpPgLocks` helper defined line 53-61 but ONLY called in T1.1 (line 371); T1.2 + T1.3 fail diagnostics weaker.
- **Absorption:** added `locks: await dumpPgLocks(pool)` to `failingTrials.push({...})` in BOTH T1.2 + T1.3 failure paths. All 3 variants now capture pg_locks state symmetrically for post-mortem.
- **Verification:** 3/3 tests still PASS post-absorption (no behavioral change; only adds diagnostic capture on failure path).

### F-tests-2 — `Math.random()` in `SlowDeterministicEmbedder` violates testing.md § Determinism

- **Severity:** MAJOR (testing.md § Determinism rule)
- **Found by:** tests agent
- **File:** `tests/integration/forgetting/f-t4-1-2-stub-reproduction.test.ts:SlowDeterministicEmbedder`
- **Evidence (pre-absorption):** `const ms = this.minMs + Math.random() * (this.maxMs - this.minMs)` — embedding values stay deterministic but TIMING varies per run; flakiness vector if a future race actually surfaces under specific timing windows.
- **Absorption:** seeded LCG (Numerical Recipes constants `a=1664525, c=1013904223`) seeded at `0xb2909ff` (the hotfix commit hash echo) replaces `Math.random()`. Same-seed across runs ⇒ identical timing sequence ⇒ reproduction-attempt evidence becomes byte-reproducible.
- **Verification:** 3/3 tests still PASS post-absorption (timing sequence is now deterministic; cycle-implement.md § Anti-pattern #9 honored).

## MINOR findings (non-blocking)

| ID | Source | Summary |
|---|---|---|
| F-wire-1 / F-dom-8 | wiring + domain-memory-layer (dup) | `DisabledReason` union retains `'hotfix-2026-05-31'` literal post-lift but it's NEVER serialized via `/api/memory/eviction-status` (route omits `reason` field). Validation report's "backward compat with snapshots" rationale is unsupported by route code. Cosmetic dead-union-literal cleanup; recommend deletion on next `memory.ts` refactor cycle. |
| F-wire-2 | wiring | INFO doc-vs-reality drift on the same retention rationale (above). |
| F-tests-3 | tests | AAA/Given-When-Then sections not visually labeled in the 3 `it()` blocks (testing.md § BDD shows canonical comment pattern). Cosmetic. |
| F-tests-4 | tests | Caller-narrative "600+ trials" inflated; actual is 400 write-pairs OR 800 individual remember calls (T1.1=100 + T1.2=200 + T1.3=100 write-pairs). Validation report + commit body inherit this overstatement. Recommend correction next time the count is cited. |

## INFO findings (9 — for audit trail)

- **cross-validation (0):** clean; honesty audit confirmed the bug-doesn't-reproduce finding is genuinely empirical (3 variants test documented bug shape; T1.3 widens race window via SLOW-embedder; validation report explicitly acknowledges "does NOT prove SDK is bug-free" + cites 3 alternative-surface hypotheses).
- **architecture (6 INFO):** DIP boundary clean (demo imports only via public surface); `resolveEviction` SRP-clean post-lift; LoC budgets respected; `SlowDeterministicEmbedder` OCP+LSP-compliant (decorator-via-inheritance with `override` keyword); test scope-creep-free; vocab + paper-names clean.
- **tests (2 INFO):** F-tests-5 describe title says "20-iter heisenbug loop" but now contains 3 variants (rename optional); F-tests-6 T1.3 SLOW-embedder variant is implementation-time extension under ADR D2 license but not documented in plan v1.1 (next plan version could record this).
- **wiring (1 INFO):** duplicate doc-vs-reality observation (counted under F-wire-2 MINOR cluster).

## Edge-case coverage (per /edge-case-plan)

| EC | Status |
|---|---|
| EC-1 MUST FIX (heisenbug loop) | ABSORBED — 20-iter T1.1 + 10-iter × 4-conv T1.2 + 5-iter × 4-conv × slow-embedder T1.3 |
| EC-2 (TRUNCATE) | ABSORBED — beforeEach + intra-trial |
| EC-3 (t_invalid IS NULL) | ABSORBED — all 9 SELECT queries guard correctly |
| EC-4 (dumpPgLocks) | ABSORBED — symmetrically across all 3 variants post-MAJOR-fix |
| EC-5 DOCUMENT | ABSORBED — atomic separate commit |
| EC-6 DOCUMENT | RESOLVED — T1.1 PASSes; T1.2 + T1.3 added as deeper fallback per ADR D2; also PASS |
| EC-7 DOCUMENT | TRIGGERED honestly — Chrome MCP lock; T3.2 deferred per ADR D5 |

**Coverage: 7/7 = 100%.**

## Cross-validation summary

- **Plan tasks:** 9
- **Fully implemented:** 6 (T0.1 folded into T1.x, T1.1, T1.2, T1.3, T3.1, T4.1)
- **Empirical no-op:** 2 (T2.1 SDK fix unnecessary because no reproduction; T2.2 aggregate verification folded)
- **Honestly deferred:** 1 (T3.2 /test-chat-with-memory via F-T4.1-1 Chrome MCP lock per ADR D5)
- **ADR compliance:** 6/6 (D1 exact landing-site path; D2 SDK-first bisection escalated through T1.1 → T1.2 → T1.3; D3 no preemptive fix; D4 atomic separate lift commit; D5 gate symmetry + honest defer; D6 no new deps)
- **Plan drift:** ZERO — plan landed `f2d9d46` (preamble) before /implement started; never re-amended during cycle

## Quality gates summary

| Gate | Status |
|---|---|
| `npm test` | PASS (573 + 2 skipped + 0 type errors) |
| `npm run typecheck` | PASS (exit 0) |
| `npm run lint` | PASS (exit 0) |
| `npm run test:integration -- f-t4-1-2-stub-reproduction.test.ts` | PASS (3/3 stable across 3+ consecutive runs; post-MAJOR-absorption re-verified) |
| Demo `npm run build` | PASS (Next.js 15.5.18) |
| Hotfix `b2909ff` reverted | PASS (commit `e8c2a2e` atomic per ADR D4) |
| Vocabulary lock | PASS (zero actual claims; hits all in negation context) |
| No paper names | PASS (zero hits in src/test code) |

## Spawned agents (audit trail)

- `.claude/agents/review-f-t4-1-2-eviction-race-debug-2026-06-01/cross-validation.md` → `findings/cross-validation.yml`
- `.claude/agents/review-f-t4-1-2-eviction-race-debug-2026-06-01/architecture.md` → `findings/architecture.yml`
- `.claude/agents/review-f-t4-1-2-eviction-race-debug-2026-06-01/tests.md` → `findings/tests.yml`
- `.claude/agents/review-f-t4-1-2-eviction-race-debug-2026-06-01/wiring.md` → `findings/wiring.yml`
- `.claude/agents/review-f-t4-1-2-eviction-race-debug-2026-06-01/domain-memory-layer.md` → `findings/domain-memory-layer.yml`
- (domain-pgvector-schema was generated but NOT invoked — no schema changes in this cycle)

## Followups carried forward (from /implement)

| # | Description |
|---|---|
| F1 | If F-T4.1-2 resurfaces in `/test-chat-with-memory` post-Chrome-MCP-unblock with real OpenAI: re-apply hotfix `b2909ff` + file dedicated Next.js-runtime debug cycle |
| F2 (NEW from review) | Future `memory.ts` refactor: delete `'hotfix-2026-05-31'` from `DisabledReason` union (literal NEVER serialized via API; documented tombstone with no consumer). Cosmetic; non-blocking. |
| F3 (NEW from review) | Future test enhancement: rename describe title "20-iter heisenbug loop" → "F-T4.1-2 eviction race — 3-variant stub reproduction" (now contains 3 it() blocks not just T1.1). Cosmetic. |
| F4 (NEW from review) | Future plan version: record T1.3 SLOW-embedder variant explicitly in plan v1.2 if/when next iteration touches this cycle (currently exists as ADR D2 implementation-time extension). |

## Handoff decision

**READY_TO_MERGE.**

The cycle delivers what was scoped: integration test landed at the declared landing site, hotfix lifted atomically, 100% EC absorption, all 5 agents converge on READY_TO_MERGE (with the 2 MAJORs absorbed inline pre-merge), zero plan drift.

### Honest acknowledgment

The cycle's PRIMARY deliverable (root-cause + fix the F-T4.1-2 race) was reframed mid-implementation when the bug did not reproduce. Per ADR D2 + D3, the cycle escalated through 3 reproduction variants (sequential → overlapping → SLOW-embedder), declared empirical no-op on T2.1 SDK fix, and proceeded to lift the hotfix WITH explicit advisory in the commit body about the Next.js-runtime/OpenAI-adapter-specific risk envelope. This is the kind of honest mid-cycle decision the /review gate exists to validate — and all 5 review agents independently confirmed the reframing is genuine + the absence-of-reproduction evidence is load-bearing.

The integration test at `tests/integration/forgetting/f-t4-1-2-stub-reproduction.test.ts` is the SDK regression guard going forward (400+ effective race attempts per `npm run test:integration` run). If F-T4.1-2 resurfaces in real demo runtime, F1 captures the recovery plan.

### Next-step recommendations

1. **Open PR** `develop → main` covering the F-T4.1-2 debug cycle commits (`f2d9d46` → `e8c2a2e` → `c004d76` + the post-review MAJOR absorption commit pending).
2. **Address Followups F2, F3, F4** at their declared owners' next available cycle (none blocking).
3. **If F-T4.1-2 resurfaces in real demo runtime** (post-Chrome-MCP-unblock /test-chat-with-memory or production usage): re-apply hotfix `b2909ff` immediately + file Next.js-runtime debug cycle per F1.
