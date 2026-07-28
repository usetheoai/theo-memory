# v0.4b Forgetting evaluation — reproducibility

This directory ships the reproducible evaluation artifact for the v0.4b
forgetting pipeline per plan T7.3.

## Quick start

```bash
# 1. Boot pgvector (or point at any reachable ankane/pgvector:v0.5.1 instance)
docker compose up -d pgvector

# 2. Apply v0.4b migrations if not already applied
export THEOMEM_PG_URI="postgresql://themem:themem@localhost:5432/themem"
psql "$THEOMEM_PG_URI" -f src/local/migrations/0003_eviction_columns.sql
psql "$THEOMEM_PG_URI" -f src/local/migrations/0004_eviction_half_life_trigger.sql

# 3. Run the evaluation
npm run eval:forgetting
```

The script prints the recall@10 matrix to stdout in Markdown format —
copy/paste into `tests/eval/forgetting.md` if you want to update the
committed matrix.

## What it measures

The script reuses the deterministic seed fixture from
`tests/integration/forgetting/fixtures/rare-target-seed.ts` (the same
fixture THE GOAL TEST T7.1 uses): 950 cluster members + 50 rare-isolated
targets in a single scope. Two eviction strategies are RUN; two are
synthesized (they collapse to random under the uniform-base-score seed —
see methodology in `tests/eval/forgetting.md`).

## What it does NOT measure

- **Production-realistic distributions.** The seed is uniform on
  importance/access_count/lastAccessedAt to ISOLATE the long-tail
  multiplier's contribution. Real consumer workloads will see (b) and (c)
  diverge from (a) because real lastAccessedAt + access_count distributions
  carry information.
- **Latency / throughput.** The script reports correctness only.
- **Adversarial seeds.** An adversary could craft seeds that defeat any
  specific eviction policy. The triadic-multiplier design assumes typical
  consumer workloads where isolation_distance correlates with semantic
  novelty.

## Honesty disclaimers

The bundled random-baseline implementation uses `Array.sort` with a
`Math.random() - 0.5` comparator. This is NOT a uniform shuffle and
produces biased results (see methodology § Caveats). A rigorous baseline
would use Fisher-Yates; we accepted the imperfect shuffle here because
(a) the comparison vs (d) at 1.0 is dominant regardless of (a)'s exact
value, and (b) tightening the random baseline is out of T7.3 scope.

## Cross-references

- Methodology: `tests/eval/forgetting.md`
- Runner: `tests/eval/forgetting/run.ts`
- npm script wiring: `package.json scripts.eval:forgetting`
