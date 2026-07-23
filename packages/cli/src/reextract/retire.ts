/**
 * M13 noise retirement (m13-noise-retirement T1.1, #111 — ADR D1/D2).
 *
 * Retires mechanism-labeled entities (`PROPER|COMPOUND|QUOTED`) the full backfill
 * did NOT re-confirm: unlinks their false `memory_entities` rows, removes edges
 * touching them, and collects the then-orphan rows under the #110 GC contract
 * (typed event + counts — Princípio 3: the forget is observable). Supersede
 * anchors (pointer carriers are excluded by `superseded_by IS NULL`; pointees by
 * the NOT EXISTS guard) are NEVER collected.
 *
 * Destructive by design → `commit: false` (dry-run) is the default at the CLI;
 * lesson theo-cloud#252: no silent bulk deletes.
 */
import { emitEvent } from '@usetheo/memory';
import type { Tracer } from '@opentelemetry/api';

import { MECHANISM_TYPES, type ReextractPool } from './engine.js';

export interface RetireReport {
  candidates: number;
  retired: number;
  linksRemoved: number;
  edgesRemoved: number;
  dryRun: boolean;
  durationMs: number;
}

export interface RetireDeps {
  readonly pool: ReextractPool;
  readonly tracer?: Tracer;
}

const MECHANISM_SQL = MECHANISM_TYPES.map((t) => `'${t}'`).join(',');

/** Target set: live mechanism rows that are not supersede anchors (ADR D2). */
const SELECT_TARGETS = `/* retire:select */
  SELECT e.id FROM entities e
   WHERE e.superseded_by IS NULL
     AND e.type IN (${MECHANISM_SQL})
     AND NOT EXISTS (SELECT 1 FROM entities o WHERE o.superseded_by = e.id)
   ORDER BY e.created_at ASC`;

export async function retireMechanism(
  deps: RetireDeps,
  opts: { commit: boolean; batchSize?: number },
): Promise<RetireReport> {
  const start = Date.now();
  const batchSize = Math.max(1, opts.batchSize ?? 500);
  const report: RetireReport = {
    candidates: 0,
    retired: 0,
    linksRemoved: 0,
    edgesRemoved: 0,
    dryRun: !opts.commit,
    durationMs: 0,
  };

  const { rows: candidates } = await deps.pool.query<{ id: string }>(SELECT_TARGETS);
  report.candidates = candidates.length;

  if (opts.commit) {
    // ONE data-modifying-CTE statement per batch: the three deletes are atomic
    // by construction (single implicit transaction on a single connection) —
    // a pool-level BEGIN/COMMIT pair would NOT be (pg.Pool may serve each query
    // from a different connection). A mid-run failure aborts only the current
    // batch; earlier batches persist and a re-run collects the rest (idempotent).
    for (let i = 0; i < candidates.length; i += batchSize) {
      const ids = candidates.slice(i, i + batchSize).map((r) => r.id);
      const { rows } = await deps.pool.query<{ edges: string; links: string; ents: string }>(
        `/* retire:collect */
         WITH del_edges AS (
           DELETE FROM entity_edges ee
            WHERE ee.source_entity_id = ANY($1::uuid[]) OR ee.target_entity_id = ANY($1::uuid[])
            RETURNING 1),
         del_links AS (
           DELETE FROM memory_entities WHERE entity_id = ANY($1::uuid[]) RETURNING 1),
         del_ents AS (
           DELETE FROM entities WHERE id = ANY($1::uuid[]) RETURNING 1)
         SELECT (SELECT count(*) FROM del_edges) AS edges,
                (SELECT count(*) FROM del_links) AS links,
                (SELECT count(*) FROM del_ents) AS ents`,
        [ids],
      );
      report.edgesRemoved += Number(rows[0]?.edges ?? 0);
      report.linksRemoved += Number(rows[0]?.links ?? 0);
      report.retired += Number(rows[0]?.ents ?? 0);
    }
  }

  report.durationMs = Date.now() - start;
  emitEvent(deps.tracer, 'reextract_noise_retired', {
    dry_run: report.dryRun,
    candidates: report.candidates,
    retired: report.retired,
    links_removed: report.linksRemoved,
    edges_removed: report.edgesRemoved,
  });
  return report;
}
