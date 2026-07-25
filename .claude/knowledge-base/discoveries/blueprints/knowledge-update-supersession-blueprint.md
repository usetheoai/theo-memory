---
slug: knowledge-update-supersession
milestone_id: M23
kind: discovery-blueprint
date: 2026-07-25
issue: 144
verdict: SHIPPABLE
references:
  - packages/core/src/domain/conflict-resolution/llm-judged-merge.ts (machinery exists)
  - packages/core/src/infrastructure/db/pgvector-store.ts:523,1177-1236 (t_invalid supersession)
  - .claude/knowledge-base/references/mem0/mem0/memory/main.py (write-time ADD/UPDATE/DELETE)
---

# Blueprint — #144 knowledge-update supersession (the write-time fix, empirically grounded)

Deep EMPIRICAL research. The M22 mistake (unit fixture passes, real case fails) is NOT repeated.

## Feasibility verdict (empirical, headline)

The #144-suggested **read-time entity-gated collapse is a FALSE-FIX** for the real case. Measured with the deterministic `compromise` extractor + real `LocalTransformerEmbedder(384)`:

| Pair | Shared normalized entity keys | Cosine |
|---|---|---|
| Issue-variant: "…personal best time in the charity 5K run is 27:12" vs "My PB is now 25:50" | **0 (none)** — `[personal_best,time,charity,run]` vs `[pb,now]` | **0.5147** |
| Doc-variant: "My PB is 27:12" vs "My PB is now 25:50" | 1 (`pb`) | 0.8451 |
| M22 fixture (near-identical stub) | 2 | 0.9279 |

`normalizeEntityKey` (`entity-linking.ts:49`) is literal lowercase+underscore — no acronym resolution ("PB"→`pb` ≠ "personal best"→`personal_best`). So a read-time entity gate **cannot fire** on `6a1eabeb`, AND it regresses precision (probe: "work at Google as engineer" vs "worked at Google since 2019" share `[google]` but are different attributes → would wrongly collapse; attribute signal is NOT available at recall). **Reject the read-time entity fix** (YAGNI + false-fix, the exact M22 trap).

## The robust fix — write/reflect-time LLM supersession (mem0-shape)

Only LLM semantic judgment bridges "personal best"↔"PB". TheMemory already has ~90%:
- `LlmJudgedMergeConflictPolicy` (`llm-judged-merge.ts`) — LLM picks `kept_id` + `rejected_ids` from a cluster.
- `persistConsolidations` (`pgvector-store.ts:1225,1232`) sets `t_invalid=NOW()` on rejected (soft supersede, auditable, Princípio 3).
- Main recall filters `t_invalid IS NULL` (`pgvector-store.ts:523`) → superseded rows stop surfacing.
- `reflect-orchestrator.ts:150-187` wires it.
- **Decisive:** the consolidation cluster is NOT cosine-gated (`recallConsolidationCandidates`, `pgvector-store.ts:1177-1214` = whole-scope live `extracted` rows) → different-wording values are judged together regardless of embedding distance.

**Why the bench still fails today:** the e2e-qa harness runs `reflectionPolicy: { kind: 'manual' }` (`e2e-qa/run.ts:254`) and never calls `reflect({conflictResolution})` — the machinery never runs.

**Honest scaling gap:** `recallConsolidationCandidates` has NO LIMIT (whole scope → one cluster) and `LlmJudgedMergeConflictPolicy` ABSTAINS when cluster > `clusterCap` (default 20, `llm-judged-merge.ts:95`). A real LongMemEval conversation (>20 extracted rows) would abstain with no LLM call. The faithful mem0 shape is **per-write** (retrieve top-k related on each `remember`, LLM ADD/UPDATE/DELETE) OR a bounded consolidation cluster keyed by semantic-retrieval-around-the-new-fact — NOT whole-scope-single-cluster-cap-20-abstain.

## Recommendation + scope (M23)

1. **Wire `reflect({conflictResolution: LlmJudgedMerge})` into the e2e-qa harness** (remember all → reflect → recall), so the supersession machinery runs. Legitimate "measure TheMemory used well" (mem0 also consolidates).
2. **Fix the scaling shape** so it doesn't abstain on real conversations: bound `recallConsolidationCandidates` to a semantic top-k around each candidate fact (mem0 shape), OR raise/scope the cluster so 6a1eabeb's contradiction pair reaches the judge.
3. **Prove it moves the REAL case** — not just a unit fixture.

## Deterministic evidence plan (keyless, REAL strings)

The M22 fixture's fatal flaw was hand-picked stub vectors (cos≈1). The new fixture uses the REAL two sentences + REAL embeddings (LocalTransformerEmbedder is deterministic/offline; probe reproduced cos 0.5147/0.8451 exactly):
1. **Read-time counter-proof (gap persists):** remember both real sentences → `recall({recencyCollapse:{}})` → assert STILL returns stale `27:12` (locks in that read-time cannot fix the issue-variant — the honest test M22 lacked).
2. **Write/reflect fix proof (stubbed LLM, no key):** remember both → `reflect({conflictResolution})` with a STUBBED LLM returning `{kept_id:<newer>, rejected_ids:[<older>], reason}` (mirror existing `llm-judged-merge` tests) → assert the older row's `t_invalid` is set AND recall returns `25:50`. Proves the mechanism end-to-end on the real strings, keyless.
3. **Precision guard (negative):** "Google role vs tenure" pair → assert NOT superseded (two same-entity/different-attribute facts must survive).

## Bench acceptance (real LLM)

Re-run e2e-qa with reflect wired: assert `6a1eabeb` changes outcome (returns `25:50`) — a CHANGED BENCH OUTCOME, not a green unit fixture. If the real dataset strings + real gpt-4o-mini judge + cluster scale do NOT move it, report honestly (do not paper over) — the real 6a1eabeb strings are in the loaded oracle dataset, so the bench IS the real-case test.

## Reference (mem0 contrast)

mem0 `add()` does per-write LLM ADD/UPDATE/DELETE (`references/mem0/mem0/memory/main.py:1972-2016`), mutating in place — one current value. TheMemory keeps history (ADD-only) + supersedes via `t_invalid` — same effect on recall, richer audit. The M23 gap is orchestration shape (per-write / bounded cluster), not missing machinery.
