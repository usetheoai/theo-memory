/**
 * /review v0-7-distillation-pipeline F-C2 regression test — verifies the
 * episodic→semantic boundary preserved by the `kind = 'extracted'` filter
 * in `recallConsolidationCandidates`.
 *
 * BEFORE THE FIX:
 *   - reflect({ conflictResolution: LWW }) on an agent_id scope holding
 *     BOTH a memory.skills(repoId) library AND extracted memories would
 *     pull skill rows into the consolidation cluster.
 *   - LWW returning { kept: 1, rejected: ALL OTHERS } mass-tombstones the
 *     entire skill library along with the older extracted facts.
 *
 * AFTER THE FIX:
 *   - The cluster only sees rows with kind='extracted'. Skill rows survive
 *     untouched. Already-consolidated rows (kind='derived') also survive,
 *     preserving the boundary on the 2nd reflect() call.
 *
 * @see .claude/knowledge-base/reviews/v0-7-distillation-pipeline-review-2026-06-02.md § F-C2
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';

import {
  createLocalMemory,
  LastWriteWinsConflictPolicy,
  PgvectorStore,
  StubEmbedder,
} from '@usetheo/memory';
import type { LLM, LLMResponse, Message } from '@usetheo/memory';

const PG_URI = process.env['THEOMEM_PG_URI'] ?? '';

// Extraction LLM stub: returns empty so the test focuses on the
// recall+filter behaviour, not on LLM extraction quality.
const emptyJsonLlm: LLM = {
  async generateResponse(_messages: readonly Message[]): Promise<unknown> {
    return Promise.resolve([]);
  },
  async generateChat(_messages: readonly Message[]): Promise<LLMResponse> {
    return Promise.resolve({ role: 'assistant', content: '[]' });
  },
};

describe.skipIf(PG_URI === '')(
  'F-C2 — episodic↔semantic boundary preserved by kind filter',
  () => {
    let pool: pg.Pool;
    let schemaDim = 1536;
    const TEST_AGENT = 'f-c2-skill-isolation-agent';

    async function reset(): Promise<void> {
      await pool.query(
        `DELETE FROM consolidation_history WHERE policy_name = 'last-write-wins'`,
      );
      await pool.query(`DELETE FROM memories WHERE agent_id = $1`, [TEST_AGENT]);
    }

    async function seedRow(text: string, kind: string, offsetMs: number): Promise<string> {
      const embedding = Array.from({ length: schemaDim }, () => 0);
      embedding[0] = 1;
      // A `kind='derived'` row MUST carry a non-empty `derived_from` per the
      // memories_kind_derived_from_check constraint (migration 0015 closed the
      // NULL hole that previously admitted derived+NULL). Seed a placeholder
      // provenance id for derived rows; NULL for everything else.
      const derivedFrom = kind === 'derived' ? '["f-c2-seed-src"]' : null;
      const result = await pool.query<{ id: string }>(
        `INSERT INTO memories (
           text, hash, embedding, payload, agent_id, kind, derived_from, created_at,
           last_accessed_at, access_count, llm_importance_score
         ) VALUES ($1, $2, $3::vector, $4, $5, $6, $8::jsonb, NOW() + ($7 || ' milliseconds')::interval,
                   NOW(), 0, 0.5)
         RETURNING id`,
        [
          text,
          `f-c2-hash-${String(Date.now())}-${String(Math.random())}`,
          `[${embedding.join(',')}]`,
          { text, agent_id: TEST_AGENT },
          TEST_AGENT,
          kind,
          String(offsetMs),
          derivedFrom,
        ],
      );
      const id = result.rows[0]?.id;
      if (id === undefined) throw new Error('seed: no row');
      return id;
    }

    beforeAll(async () => {
      pool = new pg.Pool({ connectionString: PG_URI });
      const probe = await pool.query<{ atttypmod: number }>(
        `SELECT a.atttypmod FROM pg_attribute a
           JOIN pg_class c ON c.oid = a.attrelid
          WHERE c.relname = 'memories' AND a.attname = 'embedding'
            AND a.attisdropped = false`,
      );
      schemaDim = probe.rows[0]?.atttypmod ?? 1536;
    });
    afterAll(async () => {
      await reset();
      await pool.end();
    });
    beforeEach(async () => {
      await reset();
    });

    it('skill rows (kind=skill) survive reflect({ conflictResolution: LWW }) on the same scope', async () => {
      // Given: a skill library + 2 extracted facts in the same agent_id scope
      const skillIds = [
        await seedRow('def parse_csv(s): return s.split(",")', 'skill', -10_000),
        await seedRow('def to_json(obj): return json.dumps(obj)', 'skill', -8_000),
      ];
      const extractedRejectedId = await seedRow('Older fact', 'extracted', -5_000);
      const extractedKeptId = await seedRow('Newer fact', 'extracted', +5_000);

      const memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool),
        embedder: new StubEmbedder(),
        llm: emptyJsonLlm,
        reflectionPolicy: { kind: 'manual' },
      });

      // When: reflect runs LWW conflict resolution
      await memory
        .agent(TEST_AGENT)
        .reflect({ conflictResolution: new LastWriteWinsConflictPolicy() });

      // Then: skill rows untouched (no t_invalid)
      const { rows: skillRows } = await pool.query<{ id: string; t_invalid: Date | null }>(
        `SELECT id, t_invalid FROM memories WHERE id = ANY($1::uuid[])`,
        [skillIds],
      );
      expect(skillRows).toHaveLength(2);
      for (const row of skillRows) {
        expect(row.t_invalid).toBeNull();
      }

      // And: extracted older fact was rejected (soft-deleted)
      const { rows: rejectedRows } = await pool.query<{ t_invalid: Date | null }>(
        `SELECT t_invalid FROM memories WHERE id = $1`,
        [extractedRejectedId],
      );
      expect(rejectedRows[0]?.t_invalid).not.toBeNull();

      // And: extracted newer fact was kept (t_invalid still NULL)
      const { rows: keptRows } = await pool.query<{ t_invalid: Date | null }>(
        `SELECT t_invalid FROM memories WHERE id = $1`,
        [extractedKeptId],
      );
      expect(keptRows[0]?.t_invalid).toBeNull();

      await memory.dispose();
    });

    it('derived rows (kind=derived) are NOT re-consolidated when reflect() runs over a cluster with extracted siblings', async () => {
      // /review re-run F-tests-rerun-1 (test name) + F-tests-rerun-2 (void
      // discards): renamed from "subsequent reflect()" since the body invokes
      // reflect() ONCE; assertions added for both extracted seedlings instead
      // of void-discarding them.
      // Given: a previously-consolidated derived row + 2 extracted facts
      const derivedId = await seedRow('Previously consolidated', 'derived', -10_000);
      const extractedOlderId = await seedRow('Older extracted', 'extracted', -5_000);
      const extractedNewerId = await seedRow('Newer extracted', 'extracted', +5_000);

      const memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool),
        embedder: new StubEmbedder(),
        llm: emptyJsonLlm,
        reflectionPolicy: { kind: 'manual' },
      });

      await memory
        .agent(TEST_AGENT)
        .reflect({ conflictResolution: new LastWriteWinsConflictPolicy() });

      // Then: derived row survives — kind='derived' was filtered out
      const { rows: derivedRows } = await pool.query<{ t_invalid: Date | null }>(
        `SELECT t_invalid FROM memories WHERE id = $1`,
        [derivedId],
      );
      expect(derivedRows[0]?.t_invalid).toBeNull();

      // And: the two extracted facts behaved per LWW (older rejected, newer kept).
      const { rows: olderRows } = await pool.query<{ t_invalid: Date | null }>(
        `SELECT t_invalid FROM memories WHERE id = $1`,
        [extractedOlderId],
      );
      expect(olderRows[0]?.t_invalid).not.toBeNull();
      const { rows: newerRows } = await pool.query<{ t_invalid: Date | null }>(
        `SELECT t_invalid FROM memories WHERE id = $1`,
        [extractedNewerId],
      );
      expect(newerRows[0]?.t_invalid).toBeNull();

      await memory.dispose();
    });
  },
);
