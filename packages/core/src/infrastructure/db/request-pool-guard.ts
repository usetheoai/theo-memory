/**
 * A conexão que atende requisição é contida pelas políticas? Medido no boot.
 *
 * Todo o trabalho de isolamento deste pacote — a 0029, o pool escopado, o modo
 * de escrita estrito — assume uma coisa que nunca foi verificada: que o papel do
 * banco está **sujeito** às políticas. Um superusuário, ou um papel com
 * `BYPASSRLS`, ignora RLS por completo. Sobre ele, `FORCE ROW LEVEL SECURITY`
 * não faz nada, o `WITH CHECK` não recusa nada, e cada camada acima continua
 * reportando sucesso.
 *
 * É exatamente o modo de falha que este repositório documentou no engine e
 * depois repetiu em si mesmo: um controle que parece ligado, medido por uma
 * suíte que roda no único papel onde ele não vale.
 *
 * ESTA FUNÇÃO É A METADE QUE FALTAVA. `assertBackgroundPoolCrossWorkspace`
 * garante que o trabalho que DEVE atravessar consegue; esta garante que o
 * trabalho que NÃO deve, não consegue. As duas se recusam no boot, que é onde um
 * erro de fiação custa segundos em vez de meses.
 *
 * O QUE ELA NÃO PROMETE. Ela lê o catálogo (`rolsuper`, `rolbypassrls`) — não
 * prova que cada policy está correta, nem que o contexto é aplicado. Prova a
 * pré-condição sem a qual nada disso importa. As policies em si são medidas
 * pelos testes de isolamento contra banco real.
 *
 * @see 0032_app_role_grants.sql — os privilégios do papel contido
 * @see background-pool-reach.ts — a metade simétrica, para a travessia declarada
 */
import type { Pool } from 'pg';

/** Postura do papel de uma conexão diante da segurança de linha. */
export interface RequestPosture {
  /** `current_user` — o papel com que a conexão autenticou. */
  readonly role: string;
  /** Superusuário: ignora RLS incondicionalmente, inclusive sob FORCE. */
  readonly superuser: boolean;
  /** `BYPASSRLS`: mesma consequência, por um atributo separado. */
  readonly bypassRls: boolean;
}

const POSTURE_SQL = `
  SELECT current_user AS role,
         COALESCE((SELECT rolsuper      FROM pg_roles WHERE rolname = current_user), false) AS superuser,
         COALESCE((SELECT rolbypassrls  FROM pg_roles WHERE rolname = current_user), false) AS bypass_rls
`;

/** Lê a postura do papel no catálogo. */
export async function measureRequestPosture(pool: Pool): Promise<RequestPosture> {
  const res = await pool.query<{ role: string; superuser: boolean; bypass_rls: boolean }>(
    POSTURE_SQL,
  );
  const row = res.rows[0];
  if (row === undefined) {
    throw new Error(
      'não foi possível medir a postura do papel: o catálogo não devolveu linha — ' +
        'a conexão não está falando com o banco que se imagina',
    );
  }
  return { role: row.role, superuser: row.superuser, bypassRls: row.bypass_rls };
}

/**
 * A decisão, separada do I/O para ser testável sem banco.
 *
 * @returns a mensagem de recusa, ou `undefined` quando a conexão é contida.
 */
export function requestPostureRefusal(posture: RequestPosture): string | undefined {
  const motivo = posture.superuser
    ? 'é SUPERUSUÁRIO'
    : posture.bypassRls
      ? 'tem BYPASSRLS'
      : undefined;
  if (motivo === undefined) return undefined;

  return (
    `a conexão de requisição autentica como "${posture.role}", que ${motivo} — e nesse papel ` +
    'a segurança de linha da migration 0029 NÃO VALE: `FORCE ROW LEVEL SECURITY` é ignorado, ' +
    'o `WITH CHECK` não recusa nada, e um vazamento entre inquilinos não produziria erro algum. ' +
    'Aponte THEOMEM_PG_URI para um papel de aplicação (`themory_app`) criado com ' +
    'NOSUPERUSER NOBYPASSRLS e com os privilégios que a migration 0032 concede. ' +
    'No compose local, `dev/roles.sql` já o cria.'
  );
}

/**
 * Recusa o boot quando a conexão de requisição não é contida pelas políticas.
 * Lança com a mensagem acima; o chamador deve falhar o boot.
 */
export async function assertRequestPoolIsolated(pool: Pool): Promise<RequestPosture> {
  const posture = await measureRequestPosture(pool);
  const refusal = requestPostureRefusal(posture);
  if (refusal !== undefined) throw new Error(refusal);
  return posture;
}
