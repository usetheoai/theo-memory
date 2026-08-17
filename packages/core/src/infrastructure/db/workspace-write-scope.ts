/**
 * De onde vem o `workspace_id` de uma linha nova — e por que isso é uma
 * DECLARAÇÃO, não um default.
 *
 * O produto roda em duas formas, e elas discordam sobre o que "sem contexto"
 * significa:
 *
 *   - **multi-inquilino** (`themory server`): todo store recebe o pool de
 *     `tenantScopedPool`, que aplica `app.workspace_id` em cada conexão e RECUSA
 *     entregar conexão sem escopo. Aqui, uma escrita sem contexto é defeito.
 *   - **single-tenant** (o SDK local, o MCP, os verbos da CLI): o consumidor
 *     entrega um `Pool` CRU. Não existe contexto para ler, e nunca existiu — o
 *     `DEFAULT 'default'` da coluna era exatamente essa ponte.
 *
 * A primeira versão desta correção usava
 * `COALESCE(NULLIF(current_setting('app.workspace_id', true), ''), 'default')`
 * direto no SQL. Funcionava, e era a coisa errada: reintroduzia, no código, o
 * mesmo balde compartilhado que o trabalho de tirar o `DEFAULT` do schema existe
 * para eliminar — e o fazia como comportamento PADRÃO, alcançável por qualquer
 * caminho que perdesse o wrapper por acidente.
 *
 * Aqui o padrão é o oposto: **estrito**. Sem escopo, a escrita lança
 * `WorkspaceScopeError` — a mesma função e o mesmo erro que o pool usa para
 * recusar uma conexão sem escopo. O fallback só existe depois que alguém o
 * declara, e quem declara é o CONSTRUTOR DO STORE, olhando o POOL que recebeu:
 * pool marcado por `tenantScopedPool` mantém o modo estrito; pool cru declara
 * single-tenant e diz isso no stderr, uma vez.
 *
 * A fronteira é o construtor do store, e não a fábrica, porque os stores são
 * superfície pública: quem monta um `PgvectorStore` direto sobre um `Pool` cru
 * está em single-tenant tanto quanto quem chama `createLocalMemory`. Decidir só
 * na fábrica fazia esse uso lançar — medido em 23 testes de integração.
 *
 * A decisão é estrutural (o objeto que garante o contexto é o mesmo que decide o
 * modo), não configuração — e o boot multi-inquilino a confirma chamando
 * `requireStrictWorkspaceWrites()`, que se recusa a subir se o modo tiver caído
 * para single-tenant. O estrito é MONOTÔNICO: um processo que já construiu sobre
 * pool escopado não é rebaixado por uma construção posterior, senão a ordem de
 * construção decidiria a política de escrita.
 *
 * O que sobra de risco, dito: um deploy multi-inquilino que entregue o pool cru
 * ao store. Três coisas o pegam, nesta ordem — a linha de stderr no boot, a
 * asserção acima, e a própria policy, que RECUSA a escrita com erro (medido:
 * `new row violates row-level security policy`, tanto sem contexto quanto com
 * contexto diferente de `default`). `INSERT` sob `WITH CHECK` levanta erro; não
 * é o silêncio de zero linhas que um `DELETE` fail-closed produz.
 *
 * @see tenant-scoped-pool.ts — a marca e a recusa de conexão sem escopo
 * @see workspace-scope.ts — requireScopeValue, o mesmo erro do lado da conexão
 */
import type { Pool } from 'pg';

import { currentScope, requireScopeValue } from './workspace-scope.js';

/** A marca que `tenantScopedPool` põe no pool que devolve. */
export const SCOPED_POOL = Symbol.for('themory.tenantScopedPool');

type WriteMode =
  | { readonly kind: 'strict' }
  | { readonly kind: 'single-tenant'; readonly workspaceId: string };

let mode: WriteMode = { kind: 'strict' };
let strictLatched = false;
let announced = false;

/**
 * O workspace de uma linha nova. Estrito por padrão: sem escopo, lança.
 *
 * A ORDEM importa e um teste a fixa: um escopo explícito vence a declaração,
 * sempre. A declaração single-tenant governa apenas a AUSÊNCIA de escopo — ela
 * responde "o que fazer quando ninguém disse", não "ignore quem disse". A
 * primeira versão desta função invertia isso, e um consumidor do SDK que usasse
 * `withWorkspaceScope` veria suas escritas caírem no balde mesmo tendo dito o
 * inquilino. `currentScope()` em vez de `requireScopeValue` no teste de
 * presença porque o caso cross-workspace precisa continuar lançando, e é
 * `requireScopeValue` quem sabe recusá-lo.
 */
export function workspaceIdForWrite(operation: string): string {
  if (currentScope() !== undefined || mode.kind === 'strict') {
    return requireScopeValue(operation);
  }
  return mode.workspaceId;
}

/**
 * Decide o modo a partir do pool que ENTROU num store.
 *
 * Chamado pelos construtores dos stores, não apenas pela fábrica: `PgvectorStore`,
 * `PgvectorRecallCacheStore` e `DrizzleHistoryManager` são superfície pública, e
 * um consumidor que monte um deles direto sobre um `Pool` cru está no modo
 * single-tenant tanto quanto quem chama `createLocalMemory`. Colocar a decisão
 * só na fábrica fazia esse uso lançar — medido: 23 testes de integração, todos
 * construindo store direto sobre pool cru.
 *
 * A fronteira certa é o pool entrando no store, porque é exatamente aí que se
 * sabe se as conexões daquele store carregam contexto ou não.
 */
export function configureWorkspaceWritesFromPool(pool: Pool, workspaceId = 'default'): void {
  const scoped = (pool as unknown as Record<symbol, unknown>)[SCOPED_POOL] === true;
  if (scoped) {
    // ESTRITO É MONOTÔNICO. Um processo que em algum momento construiu sobre um
    // pool escopado é um servidor multi-inquilino, e nada construído depois pode
    // relaxar a regra para o processo inteiro. Sem a trava, a ORDEM de
    // construção decidiria a política de escrita — que é exatamente o tipo de
    // acoplamento invisível que este arquivo existe para remover. O teste de
    // contrato do servidor foi quem mostrou isso: uma construção anterior com
    // pool cru derrubava o boot.
    mode = { kind: 'strict' };
    strictLatched = true;
    return;
  }
  if (strictLatched) return;
  mode = { kind: 'single-tenant', workspaceId };
  if (!announced) {
    announced = true;
    // Uma linha, uma vez. Um modo que muda o destino de toda escrita não pode
    // ser inferido depois, lendo o banco e estranhando o resultado.
    process.stderr.write(
      `themory: modo single-tenant — escritas sem contexto de workspace serão gravadas ` +
        `em "${workspaceId}". O servidor multi-inquilino recusa este modo no boot.\n`,
    );
  }
}

/**
 * Recusa o modo single-tenant. Chamado pelo boot multi-inquilino DEPOIS da
 * fiação: se o servidor recebeu um pool cru por engano, isto é o que impede o
 * processo de subir e passar meses gravando no balde compartilhado.
 */
export function requireStrictWorkspaceWrites(): void {
  if (mode.kind !== 'strict') {
    throw new Error(
      'o servidor multi-inquilino está em modo single-tenant de escrita: alguma coisa ' +
        'entregou aos stores um pool CRU em vez do pool de tenantScopedPool. Nesse modo ' +
        `toda escrita sem contexto iria para "${mode.workspaceId}" — e a policy da ` +
        'migration 0029 recusaria cada uma delas. Passe tenantScopedPool(rawPool).',
    );
  }
}

/** O modo atual — para diagnóstico e para os testes afirmarem o padrão. */
export function currentWorkspaceWriteMode(): WriteMode {
  return mode;
}

/** Restaura o padrão estrito. Existe para os testes; o produto nunca volta atrás. */
export function resetWorkspaceWriteModeForTests(): void {
  mode = { kind: 'strict' };
  strictLatched = false;
  announced = false;
}
