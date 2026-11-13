import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createLocalMemory, PgvectorStore, StubEmbedder, StubLLM } from '@usetheo/memory';

/**
 * A hard forget erases what was derived from the memory, not only the memory's own row. A
 * reflection summary restates its sources, so one that outlives a source keeps the erased
 * content recoverable; the same holds for the free-text reason of a consolidation audit row.
 */
const PG_URI = process.env['THEOMEM_PG_URI'] ?? '';

describe.skipIf(PG_URI === '')('hard forget reaches what was derived from the memory', () => {
  let pool: pg.Pool;
  const USER = 'hard-forget-derived-user';
  const POLICY = 'hard-forget-derived-test';

  async function reset(): Promise<void> {
    await pool.query('DELETE FROM consolidation_history WHERE policy_name = $1', [POLICY]);
    await pool.query('DELETE FROM memories WHERE user_id = $1', [USER]);
  }

  async function seed(text: string, derivedFrom?: readonly string[]): Promise<string> {
    const embedding = Array.from({ length: 1536 }, () => 0);
    embedding[0] = 1;
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO memories (text, hash, embedding, payload, user_id, kind, derived_from)
       VALUES ($1, $2, $3::vector, $4, $5, $6, $7::jsonb) RETURNING id`,
      [
        text,
        `hard-forget-derived-${String(Date.now())}-${String(Math.random())}`,
        `[${embedding.join(',')}]`,
        { text, user_id: USER },
        USER,
        derivedFrom === undefined ? 'extracted' : 'derived',
        derivedFrom === undefined ? null : JSON.stringify(derivedFrom),
      ],
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('seed returned no row');
    return id;
  }

  async function exists(id: string): Promise<boolean> {
    const { rowCount } = await pool.query('SELECT 1 FROM memories WHERE id = $1', [id]);
    return (rowCount ?? 0) > 0;
  }

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: PG_URI });
  });
  afterAll(async () => {
    await reset();
    await pool.end();
  });
  beforeEach(reset);

  it('erases a summary derived from the forgotten memory, and a summary of that summary', async () => {
    const memory = await createLocalMemory({ vectorStore: new PgvectorStore(pool), embedder: new StubEmbedder(), llm: new StubLLM() });
    const source = await seed('Paulo takes a medicine for epilepsy');
    const other = await seed('Paulo walks to work');
    const summary = await seed('Paulo manages epilepsy with medicine and walks to work', [source, other]);
    const second = await seed('Paulo has a health routine built around his epilepsy', [summary]);
    const unrelated = await seed('Paulo commutes on foot', [other]);

    await memory.user(USER).forget(source, { hard: true });

    expect(await exists(source)).toBe(false);
    expect(await exists(summary)).toBe(false);
    expect(await exists(second)).toBe(false);
    expect(await exists(other)).toBe(true);
    expect(await exists(unrelated)).toBe(true);
    await memory.dispose();
  });

  it('keeps the derived summary on a soft forget', async () => {
    const memory = await createLocalMemory({ vectorStore: new PgvectorStore(pool), embedder: new StubEmbedder(), llm: new StubLLM() });
    const source = await seed('Paulo takes a medicine for epilepsy');
    const summary = await seed('Paulo manages epilepsy with medicine', [source]);

    await memory.user(USER).forget(source);

    expect(await exists(summary)).toBe(true);
    await memory.dispose();
  });

  it('removes the free-text reason of an audit row that names the forgotten memory', async () => {
    const memory = await createLocalMemory({ vectorStore: new PgvectorStore(pool), embedder: new StubEmbedder(), llm: new StubLLM() });
    const kept = await seed('Paulo takes a medicine for epilepsy');
    const rejected = await seed('Paulo takes medicine');
    const bystander = await seed('Paulo walks to work');
    const insert = `INSERT INTO consolidation_history (kept_memory_id, rejected_memory_ids, reason, policy_name, original_episode_ids)
                    VALUES ($1, $2::jsonb, $3, $4, $5::jsonb)`;
    await pool.query(insert, [kept, JSON.stringify([rejected]), 'kept the one that names epilepsy', POLICY, JSON.stringify([kept, rejected])]);
    await pool.query(insert, [bystander, '[]', 'nothing to merge for the walk', POLICY, JSON.stringify([bystander])]);

    await memory.user(USER).forget(rejected, { hard: true });

    const { rows } = await pool.query<{ reason: string; rejected_memory_ids: string[] }>(
      'SELECT reason, rejected_memory_ids FROM consolidation_history WHERE policy_name = $1 ORDER BY created_at, reason',
      [POLICY],
    );
    const reasons = rows.map((row) => row.reason).sort();
    expect(reasons).toEqual(['[erased]', 'nothing to merge for the walk']);
    expect(rows.find((row) => row.reason === '[erased]')?.rejected_memory_ids).toEqual([rejected]);
    await memory.dispose();
  });
});
