/**
 * M13 T2.1/T2.2 (#111) — auditable entity supersede against real pgvector.
 *
 * `PgMemoryEntityStore.supersedeEntity({oldId,newId,workspaceId})` repoints
 * memory_entities links and entity_edges endpoints inside ONE transaction, marks
 * `old.superseded_by = new.id` (never DELETE — Princípio 3) and is idempotent.
 * Listing surfaces (list / graph expansion) hide superseded rows (T2.2).
 */
import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import { runMigrations, PgMemoryEntityStore, PgMemoryGraphStore, PgGraphExpansionStore } from '@usetheo/memory';

const PG_URI = process.env['THEOMEM_PG_URI'];
const ZERO_VEC = `[${new Array(1536).fill(0).join(',')}]`;

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('entity supersede (THEOMEM_PG_URI not set)', () => {
    test('placeholder', () => undefined);
  });
} else {
  const pool = new pg.Pool({ connectionString: PG_URI, max: 4 });
  const store = new PgMemoryEntityStore(pool);

  async function seedMemory(): Promise<string> {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO memories (id, text, hash, embedding, payload, user_id, workspace_id)
       VALUES ($1,'t',$2,$3::vector,'{}'::jsonb,'alice','ws1')`,
      [id, randomUUID(), ZERO_VEC],
    );
    return id;
  }

  async function seedEntity(name: string, type: string): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO entities (name, embedding, payload, workspace_id, user_id, type, normalized_key)
       VALUES ($1,$2::vector,'{}','ws1','alice',$3,$4) RETURNING id`,
      [name, ZERO_VEC, type, name.toLowerCase().replace(/\s+/g, '_')],
    );
    return rows[0]!.id;
  }

  async function link(memoryId: string, entityId: string): Promise<void> {
    await pool.query(`INSERT INTO memory_entities (memory_id, entity_id) VALUES ($1,$2)`, [memoryId, entityId]);
  }

  async function counts(entityId: string): Promise<{ links: number; superseded: string | null }> {
    const l = await pool.query<{ n: string }>(`SELECT count(*) AS n FROM memory_entities WHERE entity_id = $1`, [entityId]);
    const s = await pool.query<{ superseded_by: string | null }>(`SELECT superseded_by FROM entities WHERE id = $1`, [entityId]);
    return { links: Number(l.rows[0]?.n ?? 0), superseded: s.rows[0]?.superseded_by ?? null };
  }

  afterAll(async () => {
    await pool.query('TRUNCATE memories, entities, memory_entities, entity_edges CASCADE');
    await pool.end();
  });

  beforeEach(async () => {
    await runMigrations(pool);
    await pool.query('TRUNCATE memories, entities, memory_entities, entity_edges RESTART IDENTITY CASCADE');
  });

  describe('PgMemoryEntityStore.supersedeEntity (T2.1)', () => {
    test('test_supersede_repoints_links_and_edges_and_marks_old', async () => {
      // Given OLD (2 links + 1 outgoing edge) and NEW
      const m1 = await seedMemory();
      const m2 = await seedMemory();
      const oldId = await seedEntity('codex', 'PROPER');
      const newId = await seedEntity('Codex', 'PRODUCT');
      const target = await seedEntity('TheoCloud', 'PRODUCT');
      await link(m1, oldId);
      await link(m2, oldId);
      await pool.query(
        `INSERT INTO entity_edges (source_entity_id, target_entity_id, relation, normalized_relation, source_memory_id, workspace_id)
         VALUES ($1,$2,'reviews','reviews',$3,'ws1')`,
        [oldId, target, m1],
      );

      // When
      const changed = await store.supersedeEntity({ oldId, newId, workspaceId: 'ws1' });

      // Then
      expect(changed).toBe(true);
      const oldC = await counts(oldId);
      const newC = await counts(newId);
      expect(oldC.links).toBe(0);
      expect(newC.links).toBe(2);
      expect(oldC.superseded).toBe(newId);
      const edge = await pool.query<{ source_entity_id: string }>(
        `SELECT source_entity_id FROM entity_edges WHERE source_memory_id = $1`, [m1]);
      expect(edge.rows[0]?.source_entity_id).toBe(newId);
    });

    test('test_supersede_is_idempotent', async () => {
      const m1 = await seedMemory();
      const oldId = await seedEntity('acme', 'PROPER');
      const newId = await seedEntity('Acme', 'ORG');
      await link(m1, oldId);
      expect(await store.supersedeEntity({ oldId, newId, workspaceId: 'ws1' })).toBe(true);
      // second call: no-op, false, counts unchanged
      expect(await store.supersedeEntity({ oldId, newId, workspaceId: 'ws1' })).toBe(false);
      expect((await counts(newId)).links).toBe(1);
    });

    test('test_supersede_rejects_missing_target_before_any_write', async () => {
      const m1 = await seedMemory();
      const oldId = await seedEntity('ghost', 'PROPER');
      await link(m1, oldId);
      await expect(
        store.supersedeEntity({ oldId, newId: randomUUID(), workspaceId: 'ws1' }),
      ).rejects.toThrow(/not found/i);
      // fail-closed: nothing changed
      const oldC = await counts(oldId);
      expect(oldC.links).toBe(1);
      expect(oldC.superseded).toBeNull();
    });

    test('test_shared_memory_link_no_pk_violation', async () => {
      const m1 = await seedMemory();
      const oldId = await seedEntity('shared', 'PROPER');
      const newId = await seedEntity('Shared', 'CONCEPT');
      await link(m1, oldId);
      await link(m1, newId); // same memory already linked to NEW
      expect(await store.supersedeEntity({ oldId, newId, workspaceId: 'ws1' })).toBe(true);
      expect((await counts(newId)).links).toBe(1); // no duplicate, no PK violation
    });

    test('test_no_orphan_edges_after_supersede', async () => {
      const m1 = await seedMemory();
      const oldId = await seedEntity('edgy', 'PROPER');
      const newId = await seedEntity('Edgy', 'CONCEPT');
      const other = await seedEntity('Other', 'CONCEPT');
      await link(m1, oldId);
      await pool.query(
        `INSERT INTO entity_edges (source_entity_id, target_entity_id, relation, normalized_relation, source_memory_id, workspace_id)
         VALUES ($1,$2,'uses','uses',$3,'ws1'), ($2,$1,'used_by','used_by',$3,'ws1')`,
        [oldId, other, m1],
      );
      const before = await pool.query<{ n: string }>(`SELECT count(*) AS n FROM entity_edges`);
      await store.supersedeEntity({ oldId, newId, workspaceId: 'ws1' });
      const after = await pool.query<{ n: string }>(`SELECT count(*) AS n FROM entity_edges`);
      expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
      const orphan = await pool.query<{ n: string }>(
        `SELECT count(*) AS n FROM entity_edges ee
         WHERE ee.source_entity_id = $1 OR ee.target_entity_id = $1`, [oldId]);
      expect(Number(orphan.rows[0]?.n)).toBe(0);
    });

    test('test_supersede_survives_duplicate_edge_on_new_side', async () => {
      // /review F-arch-1/F-dom-db-1 RED: NEW already carries the IDENTICAL edge
      // triple (same scope, relation, target, source_memory) that OLD carries —
      // the blind endpoint UPDATE would hit entity_edges_scope_triple_uq and
      // roll back the whole supersede. The fix drops the colliding old-side row
      // and repoints the remainder.
      const m1 = await seedMemory();
      const oldId = await seedEntity('dupedge', 'PROPER');
      const newId = await seedEntity('DupEdge', 'CONCEPT');
      const target = await seedEntity('X', 'CONCEPT');
      await link(m1, oldId);
      await pool.query(
        `INSERT INTO entity_edges (workspace_id, user_id, source_entity_id, target_entity_id, relation, normalized_relation, source_memory_id)
         VALUES ('ws1','alice',$1,$3,'uses','uses',$4), ('ws1','alice',$2,$3,'uses','uses',$4)`,
        [oldId, newId, target, m1],
      );
      const changed = await store.supersedeEntity({ oldId, newId, workspaceId: 'ws1' });
      expect(changed).toBe(true);
      const { rows } = await pool.query<{ source_entity_id: string }>(
        `SELECT source_entity_id FROM entity_edges WHERE normalized_relation = 'uses'`);
      expect(rows).toHaveLength(1); // collision resolved by drop, not duplicate
      expect(rows[0]?.source_entity_id).toBe(newId);
    });

    test('test_supersede_mid_tx_failure_rolls_back_completely', async () => {
      // /review F-tests-3 (chaos): a failure AFTER the arbiter UPDATE must roll
      // back EVERYTHING (no half-superseded state) and a retry must succeed.
      const m1 = await seedMemory();
      const oldId = await seedEntity('chaos', 'PROPER');
      const newId = await seedEntity('Chaos', 'CONCEPT');
      await link(m1, oldId);
      let fired = false;
      const faultyPool = {
        connect: async () => {
          const client = await pool.connect();
          // Explicit wrapper (never mutate the pg client): passthrough query
          // that throws ONCE on the link-repoint DELETE, mid-transaction.
          return {
            query: async (sql: string, params?: unknown[]) => {
              if (!fired && sql.includes('DELETE FROM memory_entities')) {
                fired = true;
                throw new Error('injected mid-tx failure');
              }
              return client.query(sql, params);
            },
            release: () => client.release(),
          };
        },
      } as unknown as ConstructorParameters<typeof PgMemoryEntityStore>[0];
      const faultyStore = new PgMemoryEntityStore(faultyPool);
      await expect(faultyStore.supersedeEntity({ oldId, newId, workspaceId: 'ws1' }))
        .rejects.toThrow(/injected/);
      // fully rolled back: pointer clear, link intact
      const after = await counts(oldId);
      expect(after.superseded).toBeNull();
      expect(after.links).toBe(1);
      // retry on the healthy pool succeeds
      expect(await store.supersedeEntity({ oldId, newId, workspaceId: 'ws1' })).toBe(true);
    });

    test('test_concurrent_supersede_same_old_single_winner', async () => {
      // concurrent test with atomic-counter invariant: two parallel calls, one winner
      const m1 = await seedMemory();
      const oldId = await seedEntity('racey', 'PROPER');
      const newId = await seedEntity('Racey', 'CONCEPT');
      await link(m1, oldId);
      const results = await Promise.all([
        store.supersedeEntity({ oldId, newId, workspaceId: 'ws1' }),
        store.supersedeEntity({ oldId, newId, workspaceId: 'ws1' }),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
      expect((await counts(newId)).links).toBe(1);
    });
  });

  describe('superseded rows disappear from read surfaces (T2.2)', () => {
    test('test_superseded_entity_disappears_from_list', async () => {
      const m1 = await seedMemory();
      const oldId = await seedEntity('listed', 'PROPER');
      const newId = await seedEntity('Listed', 'CONCEPT');
      await link(m1, oldId);
      await store.supersedeEntity({ oldId, newId, workspaceId: 'ws1' });
      const rows = await store.list({ workspaceId: 'ws1', filters: { user_id: 'alice' } });
      expect(rows.find((r) => r.name === 'listed')).toBeUndefined();
      const kept = rows.find((r) => r.name === 'Listed');
      expect(kept?.memoryCount).toBe(1);
    });

    test('test_edge_endpoint_resolution_skips_superseded', async () => {
      // Given OLD ('codex', earliest created_at) superseded by NEW ('Codex') —
      // both share normalized_key 'codex'. resolveEntityId's earliest-wins
      // tie-break must NOT resurrect the superseded row for new edges.
      const m1 = await seedMemory();
      const oldId = await seedEntity('codex', 'PROPER');
      const newId = await seedEntity('Codex', 'PRODUCT');
      const targetId = await seedEntity('TheoCloud', 'PRODUCT');
      await link(m1, oldId);
      await store.supersedeEntity({ oldId, newId, workspaceId: 'ws1' });

      // When a new edge is asserted with the shared endpoint key
      const graphStore = new PgMemoryGraphStore(pool);
      await graphStore.upsertEdges({
        memoryId: m1,
        workspaceId: 'ws1',
        filters: { user_id: 'alice' },
        edges: [{
          relation: 'reviews', normalizedRelation: 'reviews',
          normalizedSourceKey: 'codex', normalizedTargetKey: 'theocloud',
        }],
      });

      // Then the edge attaches to NEW, never to the superseded OLD
      const { rows } = await pool.query<{ source_entity_id: string }>(
        `SELECT source_entity_id FROM entity_edges WHERE normalized_relation = 'reviews'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.source_entity_id).toBe(newId);
      void targetId;
    });

    test('test_graph_expansion_skips_superseded', async () => {
      // Given a superseded entity that (partial/corrupt state) still carries a
      // link — the live-filter must keep it out of the expansion set.
      const m1 = await seedMemory();
      const m2 = await seedMemory();
      const oldId = await seedEntity('bridge', 'PROPER');
      const newId = await seedEntity('Bridge', 'CONCEPT');
      await link(m1, oldId);
      await store.supersedeEntity({ oldId, newId, workspaceId: 'ws1' });
      // simulate residual links through the superseded row (mid-backfill state)
      await link(m1, oldId);
      await link(m2, oldId);

      const expansion = new PgGraphExpansionStore(pool);
      const rowsViaSuperseded = await expansion.expandByEntities({
        seedMemoryIds: [m1],
        filters: { workspace_id: 'ws1', user_id: 'alice' },
        hops: 1,
        limit: 10,
      });
      // m2 is reachable ONLY through the superseded row → must not surface
      expect(rowsViaSuperseded.map((r) => r.result.id)).not.toContain(m2);
    });
  });
}
