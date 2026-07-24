# Review: entity-boost-recall-contribution (M15 / theo-memory#122)

**Date:** 2026-07-24
**Reviewers (spawned agents):** 5 — architecture, tests, wiring, cross-validation, domain-database
**Findings:** 56 total (BLOCKER: 1, HIGH: 5, MEDIUM: 15, LOW: 12, INFO: 23)
**Verdict:** READY_TO_MERGE

The consolidator script was not used. It has a known failure mode in this repo — it can emit a
`READY_TO_MERGE` with zero findings when it fails to parse the agent YAML, which would have
turned the most valuable review of this cycle into a rubber stamp. This report is written from
the agents' own findings files under
`.claude/agents/review-entity-boost-recall-contribution-2026-07-24/findings/`.

## BLOCKER — resolved before merge

### F-sec-1 — two live API keys tracked in git

`.claude/tmp/live-tokens.json` carried two `theo_live_*` keys, added by M14 commit `5a5bcda`
and never released, so they were one release cut away from entering `main`'s history.

Found by the wiring agent, which was briefed to hunt exactly this. It had passed a full
`/review` in M14 unnoticed.

**Resolution** (`a9e815e`): file deleted, all of `.claude/tmp/` untracked and gitignored.
The keys remain in `develop`'s history — `git-safety.md` § 2 forbids force-push there, so
rewriting history is not an available remedy. Rotation is, and it is tracked in **#126**.
Until rotation the keys must be treated as compromised even though the harness targeted
`127.0.0.1`.

## HIGH — all five closed in `328e43c`

### F-dom-db-1 — a superseded entity could boost the ranking

The implicit defence, that supersede moves the links so a superseded entity owns none, is
false: `entities_scope_type_key_uq` does not include `superseded_by`, so the retired row keeps
its unique slot and a later `upsertAndLink` resolves `ON CONFLICT` straight back to it. The
ranking would be boosted by an alias that `list`, the dashboard and the graph view all hide —
invisible to every audit surface.

Closed with `AND e.superseded_by IS NULL`, matching what `list` already did.

### F-tests-1 / F-wire-1 — the production path had zero coverage

Every M15 test hand-injected `entityBoostStore` into `runRetrievalPipeline`, one layer below
`entityBoostDeps` — the only link between `Memory.recall()` and the boost. Deleting that line
left all 36 tests green with the feature dead for every consumer. The implementation log named
this exact risk in prose and never asserted it.

Closed with `tests/integration/entity-boost/production-path.test.ts`, which goes through
`memory.user(id).recall(query)` and nothing else, plus a second case covering ADR-0023's
`entityBoost: false` read-path guard — shipped in a `fix(recall)` commit that carried no test.

### F-tests-2 — the anti-dead-boost guard did not guard

`boostedCandidateCount > 0` was a rank delta between two runs. The baseline ordering is
unstable between runs (tied candidates, resolved by Postgres row order), so a completely dead
boost could produce a non-zero count from tie-break noise. The instrument meant to prove the
signal alive was itself statistical.

Now structural: the benchmark asks the stage directly how many candidates it boosted. A dead
boost returns an empty map, always.

### F-xval-2 — the churn instrument could not fail

ADR D1 accepted a renormalization risk explicitly on the promise that D2 would measure it. Both
churn artifacts ran at `threshold: 0.1` with candidates at semantic ≈ 1.0, where an unlinked
candidate lands at `1.0/1.5 = 0.667` — 6.7× above the gate. `churn = 0` was an arithmetic
certainty carrying no information about the risk it was designed to watch.

A second measurement now runs at 0.8, inside the band where renormalization can actually evict,
and it is reported rather than pinned to zero.

### F-xval-3 — no way to see the boost die

`computeEntityBoost` emitted only from its `catch`. An empty graph, a normalization drift or a
scope mismatch all produce an empty map with no exception — byte-identical to the pre-M15 dead
path. The milestone that exists because a signal died silently shipped no way to see it die
again.

Closed with `entity_boost_applied` carrying `candidates` and `boosted`. A scope where `boosted`
stays 0 across every recall is the alarm.

## MEDIUM — closed

| Finding | Resolution |
|---|---|
| F-arch-1 — duplicated tenant anchor; two carriers could disagree and zero the boost silently | Pipeline reads the `filters` it already receives |
| F-arch-2 — port contract restated structurally in 3 places | `Pick<MemoryEntityStore, 'linkedKeysForMemories'>` |
| F-dom-db-2 — query filtered workspace only, not the scope quadruple | COALESCE idiom, byte-identical to `list` |
| F-dom-db-3 — `pgvector-store.ts` comment whose trigger fired in this diff | Updated to describe where the lookup lives and why it needs no `attributed_to` clause |
| F-dom-db-4 — documented bound of "~120" was wrong | Corrected: 800 via REST, unbounded via SDK |
| F-tests-3 — tie control seeded the linked memory first, favouring the hypothesis | Unlinked seeded first, so insertion bias runs against it |
| F-tests-4 — a mutant survived: deleting the trailing boundary check left 12 tests green | Added the case that kills it |
| F-tests-6 — latency assertion systematically biased by run order | Latency reported, not asserted; the bounded-cost claim is proven structurally instead |
| F-xval-5 — the plan's Failure-scenarios timeout row was never built | 750 ms ceiling; a hung lookup degrades instead of blocking recall |
| F-xval-7 — `grep -c '(#122)'`, a mechanized DoD criterion, returned 0 | CHANGELOG entries now satisfy it literally |
| F-xval-8 — implementation log still published retracted benchmark numbers | Aligned with the corrected range |

## Open, tracked, not blocking

| Issue | What |
|---|---|
| #123 | 13 transitive dependency advisories (3 HIGH), none introduced by M15 |
| #124 | `pipeline.ts` at 732 lines against a 300 ceiling — blocks any edit to the recall path; needs its own cycle, not a rushed refactor inside a feature task |
| #125 | `entityBoost()` is monotonically decreasing in `numLinked`; ADR D1 forbids touching `scoring.ts` this cycle |
| #126 | Rotate the two exposed keys |

Also recorded, not filed: `spawn_reviewers.py` emitted paired knowledge skills with literal
`{PLAN_GOAL_VERBATIM}` placeholders unsubstituted, affecting every agent in this run — the
agents grounded themselves in files read from disk instead. And `CLAUDE.md` cites ADR-0008
twice as the DIP method-count contract, but the file does not exist, so the architecture agent
could not verify whether a 5-method port breaches a declared cap and declined to fabricate a
finding either way.

## Quality gates

| Gate | Result |
|---|---|
| `run_validation.py` | 0 FAIL, 0 WARN, 8 PASS |
| `/code-quality` | PASS, score cap 100, zero hard caps |
| Wiring triad | PASS on all 5 new symbols |
| `npm test` (contract) | green, 0 type errors |
| `npm run lint` | 0 errors, 0 warnings |

## Handoff

READY_TO_MERGE. The BLOCKER is resolved and its residue is tracked in #126; all five HIGH are
closed with tests that fail without the fix. The four open issues are either pre-existing debt
or explicitly deferred by a plan ADR, and none of them gate this merge.
