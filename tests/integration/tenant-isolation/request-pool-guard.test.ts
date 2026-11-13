/**
 * O guard de requisição contra papéis reais — e a prova de que a diferença
 * entre eles não é cosmética.
 *
 * Superusuário IGNORA row level security. Enquanto a suíte inteira conectava
 * como um, toda asserção de isolamento media um controle desligado — o modo de
 * falha que este trabalho documentou no engine e depois repetiu aqui. O #196
 * inverteu o padrão: `db.pool` é o papel contido, e o pool de setup continua
 * disponível justamente para que esta comparação seja possível.
 *
 * Este arquivo mede os dois papéis lado a lado, na mesma base, com as mesmas
 * linhas: o de aplicação enxerga um workspace por vez, o superusuário enxerga
 * tudo. Depois afirma que o boot recusa o segundo.
 *
 * @see packages/core/src/infrastructure/db/request-pool-guard.ts
 * @see packages/core/src/infrastructure/db/migrations/0032_app_role_grants.sql
 */
import { assertRequestPoolIsolated, measureRequestPosture, runMigrations } from '@usetheo/memory';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createIsolatedDb, type IsolatedDb } from '../_helpers/isolated-db.js';

/** O nome não é escolha: a migration 0032 concede para exatamente este papel. */
const APP_ROLE = 'themory_app';

const WS_A = 'ws-guard-a';
const WS_B = 'ws-guard-b';

let db: IsolatedDb;
let appPool: pg.Pool;

async function seed(workspaceId: string): Promise<void> {
  const client = await appPool.connect();
  try {
    await client.query(`SELECT set_config('app.workspace_id', $1, false)`, [workspaceId]);
    await client.query(
      `INSERT INTO workspaces (id, name) VALUES ($1, $1) ON CONFLICT (id) DO NOTHING`,
      [workspaceId],
    );
    await client.query(
      `INSERT INTO routing_policies (workspace_id, user_id) VALUES ($1, 'u-guard')
       ON CONFLICT DO NOTHING`,
      [workspaceId],
    );
  } finally {
    await client.query(`SELECT set_config('app.workspace_id', '', false)`);
    client.release();
  }
}

beforeAll(async () => {
  // Base FRESCA: a 0032 concede só se o papel já existir, e aqui a ordem é a de
  // produção — o papel vem do global-setup (existe antes de tudo), e as
  // migrations rodam sobre uma base vazia. Clonar o template também funcionaria;
  // rodar do zero prova que o grant é emitido pela migration, não herdado.
  //
  // O papel NÃO é criado nem removido por este arquivo: `themory_app` é
  // compartilhado com a suíte inteira, e um DROP daqui derrubaria a conexão de
  // outro arquivo rodando em paralelo.
  db = await createIsolatedDb({ fresh: true });

  await runMigrations(db.setupPool);

  appPool = db.pool;

  await seed(WS_A);
  await seed(WS_B);
}, 60_000);

afterAll(async () => {
  await db?.dropDb();
});

describe('guard do pool de requisição', () => {
  it('o_papel_de_aplicacao_e_aceito_e_a_0032_lhe_deu_privilegio', async () => {
    const posture = await assertRequestPoolIsolated(appPool);

    expect(posture.role).toBe(APP_ROLE);
    expect(posture.superuser).toBe(false);
    expect(posture.bypassRls).toBe(false);

    // Aceitar sem privilégio seria um boot verde e um primeiro request com
    // `permission denied` — exatamente o buraco que a 0030 fechou do outro lado.
    const client = await appPool.connect();
    try {
      await client.query(`SELECT set_config('app.workspace_id', $1, false)`, [WS_A]);
      const { rows } = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM routing_policies`,
      );
      expect(rows[0]?.count).toBe('1');
    } finally {
      client.release();
    }
  });

  it('a_policy_de_fato_contem_esse_papel_e_nao_contem_o_superusuario', async () => {
    // A medição que justifica o guard existir. As MESMAS duas linhas, dois
    // papéis, resultados diferentes — e o segundo é o que a suíte usa por padrão.
    const scoped = await appPool.connect();
    let visto: string | undefined;
    try {
      await scoped.query(`SELECT set_config('app.workspace_id', $1, false)`, [WS_A]);
      const r = await scoped.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM routing_policies`,
      );
      visto = r.rows[0]?.count;
    } finally {
      scoped.release();
    }

    const { rows } = await db.setupPool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM routing_policies`,
    );

    expect(visto, 'o papel contido enxerga só o workspace do contexto').toBe('1');
    expect(rows[0]?.count, 'o superusuário enxerga os dois, sem contexto algum').toBe('2');
  });

  it('o_boot_recusa_a_conexao_que_ignora_as_policies', async () => {
    const posture = await measureRequestPosture(db.setupPool);
    expect(
      posture.superuser || posture.bypassRls,
      'o pool de setup é o papel do THEOMEM_PG_URI — se ele deixar de ignorar as policies, este teste precisa de outro alvo',
    ).toBe(true);

    await expect(assertRequestPoolIsolated(db.setupPool)).rejects.toThrow(/SUPERUSUÁRIO|BYPASSRLS/);
    await expect(assertRequestPoolIsolated(db.setupPool)).rejects.toThrow(/themory_app/);
  });
});
