/**
 * T7.1 deterministic seed fixture for THE GOAL TEST.
 *
 * Produces a topology of 950 dense-cluster memories + 50 rare-isolated targets:
 *
 *  - 5 dense clusters, each with 190 members. Cluster i has its center at
 *    one-hot index `i * 100`, and members carry small perturbations at
 *    nearby indices so within-cluster cosine distance ≈ 0.005 (very close
 *    siblings).
 *  - 50 rare targets placed at orthogonal one-hot indices `500 + k * 20`
 *    (k = 0..49) — pairwise orthogonal AND orthogonal to all cluster
 *    centers. NN cosine distance for a rare target ≈ 1.0 (max isolation).
 *
 * All memories share `llm_importance_score = 0.5`, `access_count = 0`,
 * `lastAccessedAt = NULL` so triadic BASE score is identical (0.2) across
 * the seed. The long-tail multiplier (T4.2 / D9) is the sole discriminator
 * during selectVictims:
 *
 *   - Cluster member multiplier ≈ 0.005 / mean ≈ 0.1 (clamp floor)
 *     → final score ≈ 0.02
 *   - Rare target multiplier ≈ 1.0 / mean ≈ clamp 1.0
 *     → final score ≈ 0.2
 *
 * Bottom 30% by score (300 victims) = 300 cluster members. All 50 rare
 * targets survive → recall@10 on rare queries = 1.0 ≥ the 0.70 threshold.
 *
 * @see CLAUDE.md § Macro roadmap Item 6 acceptance verbatim
 */
import type { Pool } from 'pg';

import { MAX_EMBEDDING_DIM } from '@usetheo/memory';

export const CLUSTER_COUNT = 5;
export const MEMBERS_PER_CLUSTER = 190;
export const RARE_TARGET_COUNT = 50;
export const TOTAL_SEED_COUNT = CLUSTER_COUNT * MEMBERS_PER_CLUSTER + RARE_TARGET_COUNT;
export const RARE_BASE_INDEX = 500;
export const RARE_INDEX_STRIDE = 20;
export const CLUSTER_CENTER_STRIDE = 100;

export interface SeededSeed {
  readonly clusterMemberIds: readonly string[];
  readonly rareTargetIds: readonly string[];
  readonly rareQueries: readonly (readonly number[])[];
}

function makeZeroVector(): number[] {
  return Array.from({ length: MAX_EMBEDDING_DIM }, () => 0);
}

function clusterMemberVector(clusterIndex: number, memberIndex: number): readonly number[] {
  const v = makeZeroVector();
  const center = clusterIndex * CLUSTER_CENTER_STRIDE;
  v[center] = 1;
  // Small perturbation deterministic per member; spreads across 30 nearby dims.
  v[center + 1 + (memberIndex % 30)] = 0.1;
  return v;
}

function rareTargetVector(rareIndex: number): readonly number[] {
  const v = makeZeroVector();
  v[RARE_BASE_INDEX + rareIndex * RARE_INDEX_STRIDE] = 1;
  return v;
}

function vectorLiteral(vector: readonly number[]): string {
  return `[${vector.join(',')}]`;
}

export async function seedRareTargetTopology(
  pool: Pool,
  agentId: string,
): Promise<SeededSeed> {
  const clusterMemberIds: string[] = [];
  const rareTargetIds: string[] = [];

  for (let c = 0; c < CLUSTER_COUNT; c++) {
    for (let m = 0; m < MEMBERS_PER_CLUSTER; m++) {
      const result = await pool.query<{ id: string }>(
        `INSERT INTO memories (
            text, hash, embedding, payload, agent_id,
            llm_importance_score, access_count, last_accessed_at
         ) VALUES ($1, $2, $3::vector, $4, $5, 0.5, 0, NULL)
         RETURNING id`,
        [
          `cluster-${c}-member-${m}`,
          `h-t7-1-cluster-${c}-${m}`,
          vectorLiteral(clusterMemberVector(c, m)),
          {},
          agentId,
        ],
      );
      const id = result.rows[0]?.id;
      if (id !== undefined) clusterMemberIds.push(id);
    }
  }

  for (let r = 0; r < RARE_TARGET_COUNT; r++) {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO memories (
          text, hash, embedding, payload, agent_id,
          llm_importance_score, access_count, last_accessed_at
       ) VALUES ($1, $2, $3::vector, $4, $5, 0.5, 0, NULL)
       RETURNING id`,
      [
        `rare-target-${r}`,
        `h-t7-1-rare-${r}`,
        vectorLiteral(rareTargetVector(r)),
        {},
        agentId,
      ],
    );
    const id = result.rows[0]?.id;
    if (id !== undefined) rareTargetIds.push(id);
  }

  const rareQueries: readonly number[][] = Array.from(
    { length: RARE_TARGET_COUNT },
    (_, r) => rareTargetVector(r) as number[],
  );

  return { clusterMemberIds, rareTargetIds, rareQueries };
}
