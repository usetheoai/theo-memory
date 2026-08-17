/**
 * Quatro escritas que a isolação do banco passou a recusar — e não deveria.
 *
 * A varredura da Fase 1 (item 7) procurou `INSERT` em tabela escopada que não
 * escreve `workspace_id`. Antes da migration 0029 isso era silencioso: a linha
 * entrava com o DEFAULT `'default'` e passava a ser visível para o inquilino
 * errado. Depois da 0029 o `WITH CHECK` compara a coluna com o contexto da
 * sessão, então a mesma escrita passou a ser RECUSADA para qualquer workspace
 * que não seja literalmente `default` — trocando um vazamento silencioso por
 * uma funcionalidade quebrada, que é melhor, mas continua sendo defeito.
 *
 * Os quatro caminhos: histórico (unitário e em lote), contador de reflexão,
 * cache de recall e o registro de consolidação. Nenhum deles tinha teste sob um
 * workspace real — a suíte inteira roda como superusuário, que ignora RLS, e
 * por isso todos permaneciam verdes enquanto o produto quebrava.
 *
 * O teste exercita o CÓDIGO, não uma cópia do SQL: uma cópia continuaria verde
 * se alguém alterasse a fonte.
 *
 * @see packages/core/src/infrastructure/db/migrations/0029_rls_fail_closed.sql
 */
import { DrizzleHistoryManager, PgvectorStore, tenantScopedPool, withWorkspaceScope } from '@usetheo/memory';
import { PgvectorRecallCacheStore } from '@usetheo/memory/cache-pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createIsolatedDb, type IsolatedDb } from '../_helpers/isolated-db.js';

const WS = 'ws-scoped-insert';
const DIM = 1536;

let db: IsolatedDb;
let scopedPool: pg.Pool;
let memoryId: string;

/** Um vetor válido para a dimensão padrão do catálogo. */
function embedding(): number[] {
  return Array.from({ length: DIM }, (_, i) => (i === 0 ? 1 : 0));
}

beforeAll(async () => {
  db = await createIsolatedDb();
  scopedPool = tenantScopedPool(db.pool) as unknown as pg.Pool;

  // A linha-mãe das FKs, escrita sob o mesmo contexto que o teste vai usar.
  const client = await db.pool.connect();
  try {
    await client.query(`SELECT set_config('app.workspace_id', $1, false)`, [WS]);
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO memories (workspace_id, user_id, text, hash, payload, embedding)
       VALUES ($1, 'u-scoped', 'texto de apoio', md5('texto de apoio'), '{}'::jsonb, $2::vector)
       RETURNING id`,
      [WS, `[${embedding().join(',')}]`],
    );
    memoryId = inserted.rows[0]?.id ?? '';
  } finally {
    await client.query(`SELECT set_config('app.workspace_id', '', false)`);
    client.release();
  }
  expect(memoryId).not.toBe('');
}, 60_000);

afterAll(async () => {
  await db?.dropDb();
});

/**
 * As leituras de verificação usam `db.setupPool`, não o pool contido, e isso é
 * deliberado: a asserção aqui é *em qual workspace a linha caiu*. Um leitor
 * contido ao workspace certo não enxerga uma linha arquivada no workspace
 * errado — ela sumiria em vez de aparecer errada, e o teste falharia dizendo
 * "0 linhas" em vez de "workspace_id = 'default'". Ver a linha errada é o que
 * dá o diagnóstico.
 */

describe('escritas em tabela escopada sob um workspace real', () => {
  it('o_historico_unitario_grava', async () => {
    const manager = new DrizzleHistoryManager(drizzle(scopedPool));

    await withWorkspaceScope(WS, async () => {
      await manager.addHistory(memoryId, null, 'valor novo', 'ADD');
    });

    const { rows } = await db.setupPool.query<{ workspace_id: string }>(
      `SELECT workspace_id FROM history WHERE memory_id = $1`,
      [memoryId],
    );
    expect(rows).toHaveLength(1);
    // A linha tem de nascer NO workspace do contexto — não no DEFAULT.
    expect(rows[0]?.workspace_id).toBe(WS);
  });

  it('o_historico_em_lote_grava', async () => {
    const manager = new DrizzleHistoryManager(drizzle(scopedPool));

    await withWorkspaceScope(WS, async () => {
      await manager.batchAddHistory([
        { memoryId, previousValue: null, newValue: 'lote 1', action: 'ADD' },
        { memoryId, previousValue: 'lote 1', newValue: 'lote 2', action: 'ADD' },
      ]);
    });

    const { rows } = await db.setupPool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM history
        WHERE memory_id = $1 AND workspace_id = $2`,
      [memoryId, WS],
    );
    expect(Number(rows[0]?.count)).toBeGreaterThanOrEqual(2);
  });

  it('o_contador_de_reflexao_grava', async () => {
    const store = new PgvectorStore(scopedPool);

    const count = await withWorkspaceScope(WS, async () =>
      store.bumpReflectionCounter({ userId: 'u-scoped' }),
    );

    expect(count).toBe(1);
    const { rows } = await db.setupPool.query<{ workspace_id: string }>(
      `SELECT workspace_id FROM reflection_counters WHERE scope_user_id = 'u-scoped'`,
    );
    expect(rows[0]?.workspace_id).toBe(WS);
  });

  it('o_cache_de_recall_grava', async () => {
    const cache = new PgvectorRecallCacheStore(scopedPool);

    await withWorkspaceScope(WS, async () => {
      await cache.set(embedding(), { kind: 'user', userId: 'u-scoped' }, [], 60, WS);
    });

    const { rows } = await db.setupPool.query<{ workspace_id: string }>(
      `SELECT workspace_id FROM recall_cache`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.workspace_id).toBe(WS);
  });

  it('dois_workspaces_com_o_mesmo_user_id_tem_contadores_separados', async () => {
    // O upsert casava a linha pelo escopo e só por ele. `user_id` é escolhido
    // pelo cliente — `admin` é o exemplo óbvio —, então o UPDATE encontrava a
    // linha do OUTRO inquilino e incrementava o contador dele: a reflexão de um
    // cliente disparada pela atividade de outro.
    //
    // O índice único não impedia nada disso, e por um motivo que quase passou
    // batido: NULLs são DISTINTOS num índice único, e um escopo de usuário tem
    // sessão e agente nulos. A migration 0031 corrige os dois lados — coluna de
    // workspace na chave e NULLS NOT DISTINCT —, mas quem faz ESTE teste passar
    // é o predicado de workspace no UPDATE. Sem ele, o segundo lê 2.
    const store = new PgvectorStore(scopedPool);
    const OUTRO = 'ws-scoped-insert-vizinho';
    const MESMO_USER = 'u-compartilhado';

    const meu = await withWorkspaceScope(WS, async () =>
      store.bumpReflectionCounter({ userId: MESMO_USER }),
    );
    const vizinho = await withWorkspaceScope(OUTRO, async () =>
      store.bumpReflectionCounter({ userId: MESMO_USER }),
    );

    // Cada um começa do zero. Se o índice ainda ignorasse o workspace, ou o
    // segundo leria 2 (incrementou o contador alheio), ou explodiria na colisão.
    expect(meu).toBe(1);
    expect(vizinho).toBe(1);

    const { rows } = await db.setupPool.query<{ workspace_id: string; count: number }>(
      `SELECT workspace_id, count FROM reflection_counters
        WHERE scope_user_id = $1 ORDER BY workspace_id`,
      [MESMO_USER],
    );
    expect(rows.map((r) => r.workspace_id)).toEqual([WS, OUTRO].sort());
  });

  it('o_registro_de_consolidacao_grava', async () => {
    const store = new PgvectorStore(scopedPool);

    await withWorkspaceScope(WS, async () => {
      await store.persistConsolidations([
        {
          keptMemoryId: memoryId,
          rejectedMemoryIds: [],
          reason: 'teste de escopo',
          policyName: 'noop',
          originalEpisodeIds: [],
        },
      ]);
    });

    const { rows } = await db.setupPool.query<{ workspace_id: string }>(
      `SELECT workspace_id FROM consolidation_history WHERE kept_memory_id = $1`,
      [memoryId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.workspace_id).toBe(WS);
  });
});
