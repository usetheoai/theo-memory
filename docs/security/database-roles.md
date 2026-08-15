# Os três papéis do banco, e por que o serviço não usa o dono

Este documento existe porque a mudança tem consequência operacional imediata: a
partir da migration 0032 e do guard de boot, **`themory server` se recusa a subir
com uma conexão de superusuário**, e o `THEOMEM_PG_URI` do seu ambiente
provavelmente é uma.

## O problema que os papéis resolvem

A migration 0029 pôs `ENABLE` + `FORCE ROW LEVEL SECURITY` em toda tabela
escopada e não deu ao dono nenhuma policy de manutenção — o dono é contido como
qualquer um. Está certo, e mesmo assim não bastava:

> **Superusuário ignora row level security por completo.** Sobre ele, `FORCE` não
> faz nada, o `WITH CHECK` não recusa nada, e um vazamento entre inquilinos não
> produz erro algum.

O ambiente de desenvolvimento conecta exatamente assim, e a suíte também
conectava. Ou seja: a isolação estava instalada e **medida no único papel onde
ela não vale** — o mesmo modo de falha que este trabalho encontrou no engine e
depois repetiu aqui. O serviço deixou de fazer isso no #195; a suíte, no #196
(ver § A suíte roda nos mesmos papéis).

## Os papéis

| Papel | Quem usa | Alcance | Como alcança |
|---|---|---|---|
| dono (ex.: `themem`) | migrations, DDL | tudo | posse das tabelas; **não** deve atender requisição |
| `themory_app` | `themory server` | um workspace por vez | contido pelas policies da 0029, via `app.workspace_id` |
| `themory_worker` | retenção e manutenção | todos os workspaces | policy **nomeada** `*_worker_cross_workspace` |

O papel de travessia recebe privilégio de tabela na 0030 e de **sequência** na
0033 — sem a segunda, qualquer `INSERT` atravessando falha com `permission denied
for sequence`, porque a chave surrogate é `bigserial` e a sequência é um objeto
com privilégio próprio. A retenção só apaga, então nunca encostou nisso; o
harness de integração encostou no primeiro dia.

A diferença entre a terceira linha e um `BYPASSRLS` é o ponto: uma policy nomeada
aparece em `pg_policies`, é revogável por tabela e é auditável. `BYPASSRLS` é um
atributo do papel que nenhuma auditoria de policies mostraria.

## Como criar

Local, via compose — já montado em `/docker-entrypoint-initdb.d/`, roda na
primeira subida do volume:

```
dev/roles.sql
```

Volume já existente (o arquivo é idempotente):

```bash
psql "$THEOMEM_PG_URI" -f dev/roles.sql
```

Os **privilégios** não estão nesse arquivo. Quem concede são as migrations, e só
se o papel existir: `0032` para `themory_app`, `0030` para `themory_worker`.
Criar num lugar e conceder no outro mantém uma verdade só sobre o que cada papel
alcança — e é por isso que a ordem importa: **crie o papel antes de migrar**, ou
rode as migrations de novo depois de criá-lo.

## Como apontar

```bash
# atende requisição — contido pelas policies
export THEOMEM_PG_URI="postgres://themory_app:themory_app@localhost:5432/themem"

# atravessa workspaces de propósito (retenção); só quando a retenção está ligada
export THEOMEM_WORKER_PG_URI="postgres://themory_worker:themory_worker@localhost:5432/themem"
```

Migrations continuam sendo aplicadas **pelo dono** — DDL não é afetado por RLS, e
o papel de aplicação deliberadamente não tem DDL.

## O que acontece se você não fizer

O boot recusa, com a mensagem dizendo qual papel usar:

```
themory server: a conexão de requisição autentica como "themem", que é SUPERUSUÁRIO —
e nesse papel a segurança de linha da migration 0029 NÃO VALE: `FORCE ROW LEVEL
SECURITY` é ignorado, o `WITH CHECK` não recusa nada, e um vazamento entre
inquilinos não produziria erro algum. Aponte THEOMEM_PG_URI para um papel de
aplicação (`themory_app`) [...]
```

Recusar é deliberado. Um serviço que sobe sobre um papel que ignora as policies
não degrada: ele funciona perfeitamente, e a isolação simplesmente não existe.

## A suíte roda nos mesmos papéis

Isto era, até o #196, a lacuna declarada desta página: a suíte inteira conectava
como superusuário, e portanto media a isolação no único papel onde ela não vale.
Não mede mais. `createIsolatedDb()` entrega quatro pools, e o **padrão é o papel
contido**:

| Pool | Papel | Alcance |
|---|---|---|
| `pool` | `themory_app` | um workspace por vez — **o padrão** |
| `poolPinnedTo(ws)` | `themory_app` | idem, com `app.workspace_id` já fixado na conexão |
| `crossWorkspacePool(motivo)` | `themory_worker` | todos os workspaces, por policy nomeada |
| `setupPool` | o papel do `THEOMEM_PG_URI` | DDL, `TRUNCATE`, `admin_config` — **ignora RLS** |

`setupPool` tem o nome honesto: não é "o dono", é o papel que o ambiente aponta,
e aqui ele é superusuário. Uma asserção de isolamento que passa sobre ele não
prova nada.

### Qual pool para qual asserção

A regra que a migração dos ~40 arquivos seguiu, e que vale para teste novo:

| A asserção é sobre… | Pool | Por quê |
|---|---|---|
| quem enxerga ou grava o quê | `pool` / `poolPinnedTo` | é o que a policy governa; qualquer outro papel responde por ela |
| comportamento dentro de um workspace (ranking, consolidação, boost) | `poolPinnedTo('default')` | postura de produção sem reescrever o arquivo; a policy segue viva por baixo |
| forma do schema, DDL, migration | `setupPool` | é o domínio do papel de setup; não é asserção de isolamento |
| o filtro da APLICAÇÃO entre workspaces | `crossWorkspacePool(motivo)` | ver abaixo — não é a mesma coisa que a policy |

O quarto caso é o que mais engana. Um teste que prova que o `WHERE workspace_id`
de um store isola **precisa de uma conexão capaz de vazar** — rodá-lo sobre o
pool contido faz a policy responder pelo store, e o teste passaria mesmo se o
filtro fosse removido. São duas camadas independentes, e a asserção de uma não
pode ser satisfeita em silêncio pela outra. O mesmo vale para o eixo de
**usuário**: dois usuários do mesmo workspace têm a mesma policy, então só o
código os separa.

O motivo passado ao `crossWorkspacePool` não é decoração: é o que faz a travessia
aparecer na review em vez de acontecer por acidente.

### Onde os papéis nascem, na suíte

`tests/integration/global-setup.ts`, **antes** do template ser migrado — porque
0029/0030/0032 só criam policy e concedem privilégio para papel que já existe. Um
arquivo de teste **não** cria nem remove esses papéis: eles são do cluster e
compartilhados, e um `DROP ROLE` de um arquivo derruba a conexão de outro rodando
em paralelo.

## Relacionado

- `packages/core/src/infrastructure/db/request-pool-guard.ts` — o guard e a medida
- `packages/core/src/infrastructure/db/background-pool-reach.ts` — a metade simétrica
- `packages/core/src/infrastructure/db/migrations/0029_rls_fail_closed.sql` — as policies
- `tests/integration/_helpers/isolated-db.ts` — os três pools da suíte
- `tests/integration/global-setup.ts` — onde os papéis são provisionados
