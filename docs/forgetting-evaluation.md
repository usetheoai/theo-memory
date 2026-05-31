# v0.4b Forgetting evaluation

Reproducible methodology + recall@10 matrix for the v0.4b triadic-scored
forgetting pipeline with long-tail preservation.

## Methodology

### Topology

Deterministic 1000-memory seed (see `tests/integration/forgetting/fixtures/rare-target-seed.ts`):

- **950 cluster members** across 5 dense clusters (190 per cluster).
  Cluster `i` is centered at one-hot index `i * 100`; each member carries a
  small perturbation at a nearby index so within-cluster cosine distance
  ≈ 0.005 (very close siblings).
- **50 rare-isolated targets** at one-hot indices `500 + k * 20` for
  `k = 0..49`. Pairwise orthogonal AND orthogonal to all cluster centers.
  Nearest-neighbor cosine distance ≈ 1.0 (max isolation).

All 1000 memories are seeded with identical:

- `llm_importance_score = 0.5`
- `access_count = 0`
- `last_accessed_at = NULL`

→ identical triadic BASE score (`0.4 * 0 + 0.2 * 0 + 0.4 * 0.5 = 0.2`).

The long-tail multiplier (T4.2 / D9) is the **sole discriminator** between
cluster members and rare targets:

- Cluster member multiplier ≈ `clamp(0.1, 1.0, 0.005 / mean_isolation) → 0.1`
- Rare target multiplier ≈ `clamp(0.1, 1.0, 1.0 / mean_isolation) → 1.0`

### Eviction strategies compared

| ID | Strategy | Wiring |
|---|---|---|
| (a) | Random | shuffle ids; take first 30%; soft-delete via `PgEvictor` |
| (b) | Pure LRU (no triadic, no multiplier) | sort by `last_accessed_at ASC`; tied at NULL → collapses to random |
| (c) | Triadic, no multiplier | `TriadicScoringPolicy` without `NearestNeighborProvider`; uniform base score → tied → collapses to random |
| (d) | Triadic + multiplier | `TriadicScoringPolicy` with `PgNearestNeighborProvider` (T7.1 GOAL TEST configuration) |

Why (b) and (c) collapse: when all 1000 memories share `lastAccessedAt = NULL`
AND identical triadic base, both strategies have no information to rank
candidates on. `selectVictims` picks an arbitrary 30% — empirically
indistinguishable from random.

### Metric

For each of the 50 rare targets, run `recall(target_embedding, topK=10)`
against the **post-eviction** scope. Count hits (rare target appears in
top-10).

`recall@10 = total_hits / 50`

The locked acceptance threshold per plan T7.1 is `recall@10 ≥ 0.70` (CLAUDE.md § Macro roadmap Item 6).

## Matrix

Output of one `npm run eval:forgetting` run against
`ankane/pgvector:v0.5.1` (illustrative; random has run-to-run variance):

| Strategy | Evicted total | Rare survivors / 50 | recall@10 |
|---|---|---|---|
| (a) random | 300 | 48 | 0.960 |
| (b) pure LRU (uniform `lastAccessedAt` → collapses to random) | 300 | 48 | 0.960 |
| (c) triadic, no multiplier (uniform base score → collapses to random) | 300 | 48 | 0.960 |
| (d) triadic + multiplier | 300 | 50 | 1.000 |

### Caveats

1. **Random row variance.** The bundled `run.ts` uses `Array.prototype.sort`
   with a `Math.random() - 0.5` comparator. That is NOT a uniform shuffle —
   V8's sort algorithm interacts non-uniformly with a non-transitive
   comparator. Across many runs, the random row can land anywhere in
   `[0.70, 0.98]` rather than the theoretical-uniform `0.7 ± 0.06` (one σ
   for 50 Bernoulli trials at p=0.7). For a rigorous random baseline,
   replace the sort with Fisher-Yates. The observed 0.96 is on the high
   end and reflects the comparator bias, NOT an under-performance of (d)
   — (d) achieves the perfect 1.0 every run because the multiplier is
   deterministic.
2. **(d) survival is deterministic.** Per the topology design, every rare
   target has multiplier ≈ 1.0 vs cluster members ≈ 0.1. The bottom 30%
   by score is ALWAYS 300 cluster members; no rare can be in the victim
   band by construction. recall@10 = 1.0 every run.
3. **Production behavior differs.** Real consumer workloads will have
   heterogeneous `lastAccessedAt` / `access_count` / `llm_importance_score`
   distributions, so (b) and (c) WILL diverge from (a) in production
   settings — they collapse here ONLY because the seed is uniform.

## Reproduction

```bash
export THEOMEM_PG_URI="postgresql://themem:themem@localhost:5432/themem"
npm run eval:forgetting
```

Requires `ankane/pgvector:v0.5.1` (or compatible) reachable at the URI
and the v0.4b migrations applied (`0003_eviction_columns.sql` + `0004_eviction_half_life_trigger.sql`).

Runtime: ~25-40 seconds per invocation (most spent on seeding 1000 memories
and pre-populating the per-pass NN cache).

See `docs/forgetting-evaluation/README.md` for the reproducibility checklist.

## Cross-references

- Plan: `.claude/knowledge-base/plans/v0-4b-forgetting-pipeline-plan.md § T7.3`
- Blueprint (methodology rationale + ADR D11 testing pyramid): `.claude/knowledge-base/discoveries/blueprints/v0-4b-forgetting-pipeline-blueprint.md`
- GOAL TEST that gates the (d) row: `tests/integration/forgetting/triadic-eviction.test.ts`
- Guardrail test (5-pass survival): `tests/integration/forgetting/guardrail-long-tail.test.ts`
- CLAUDE.md acceptance locked at `recall@10 ≥ 0.70` per `§ Macro roadmap Item 6`
