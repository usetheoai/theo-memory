/**
 * PgMemoryEntityStore.forgetEntity tests (M14 T2.4a) — fail-closed guard (#252) + scope.
 *
 * The guard is the critical one: a scope filter without a confirmed user must ABORT
 * before ANY database work (theo-cloud#252 cascade-delete lesson). The pool.connect spy
 * proves nothing was touched.
 */
import { describe, expect, test, vi } from 'vitest';

import type { Filters } from '../../domain/scope.js';
import { EntityForgetScopeError } from '../../domain/dip/memory-entity-store.js';
import { PgMemoryEntityStore } from './pg-memory-entity-store.js';

/** A pool whose client returns canned rowCounts per query substring. */
function stubPool(rowCountFor: (sql: string) => { rows: unknown[]; rowCount: number }) {
  const queries: { sql: string; params: unknown[] }[] = [];
  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      return rowCountFor(sql);
    }),
    release: vi.fn(),
  };
  const connect = vi.fn(async () => client);
  return { pool: { connect } as never, queries, connect, client };
}

describe('PgMemoryEntityStore.forgetEntity (T2.4a)', () => {
  test('test_forget_entity_aborts_without_scope_filter — filtro sem user_id → aborta antes de qualquer query (GUARDA #252)', async () => {
    const { pool, connect } = stubPool(() => ({ rows: [], rowCount: 0 }));
    const store = new PgMemoryEntityStore(pool);
    const filtersSemUser: Filters = { workspace_id: 'ws-A' }; // SEM user_id
    await expect(
      store.forgetEntity({ name: 'Codex', workspaceId: 'ws-A', filters: filtersSemUser }),
    ).rejects.toBeInstanceOf(EntityForgetScopeError);
    // O crítico: o pool NUNCA foi conectado — zero deleção em escopo aberto.
    expect(connect).not.toHaveBeenCalled();
  });

  test('test_forget_entity_scoped_delete — filtro com user_id → DELETE scoped (workspace+user), retorna contagens', async () => {
    // resolve 1 entidade; links 2; edges 1; entity 1
    const { pool, queries } = stubPool((sql) => {
      if (sql.includes('SELECT id FROM entities')) return { rows: [{ id: 'ent-1' }], rowCount: 1 };
      if (sql.includes('DELETE FROM memory_entities')) return { rows: [], rowCount: 2 };
      if (sql.includes('DELETE FROM entity_edges')) return { rows: [], rowCount: 1 };
      if (sql.includes('DELETE FROM entities')) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const store = new PgMemoryEntityStore(pool);
    const res = await store.forgetEntity({
      name: 'Codex',
      workspaceId: 'ws-A',
      filters: { workspace_id: 'ws-A', user_id: 'alice' },
    });
    expect(res).toEqual({ entitiesRemoved: 1, linksRemoved: 2, edgesRemoved: 1 });
    // O SELECT de resolução scoping por workspace + user (não escopo aberto).
    const resolve = queries.find((q) => q.sql.includes('SELECT id FROM entities'));
    expect(resolve?.params).toContain('ws-A');
    expect(resolve?.params).toContain('alice');
  });

  test('test_forget_entity_idempotent_when_absent — entidade não existe no escopo → 0/0/0, sem erro', async () => {
    const { pool } = stubPool((sql) =>
      sql.includes('SELECT id FROM entities') ? { rows: [], rowCount: 0 } : { rows: [], rowCount: 0 },
    );
    const store = new PgMemoryEntityStore(pool);
    const res = await store.forgetEntity({
      name: 'Inexistente',
      workspaceId: 'ws-A',
      filters: { workspace_id: 'ws-A', user_id: 'alice' },
    });
    expect(res).toEqual({ entitiesRemoved: 0, linksRemoved: 0, edgesRemoved: 0 });
  });
});
