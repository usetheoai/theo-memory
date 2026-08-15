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

O ambiente de desenvolvimento e a suíte deste repositório conectam exatamente
assim. Ou seja: a isolação estava instalada e **medida no único papel onde ela
não vale** — o mesmo modo de falha que este trabalho encontrou no engine e depois
repetiu aqui.

## Os papéis

| Papel | Quem usa | Alcance | Como alcança |
|---|---|---|---|
| dono (ex.: `themem`) | migrations, DDL | tudo | posse das tabelas; **não** deve atender requisição |
| `themory_app` | `themory server` | um workspace por vez | contido pelas policies da 0029, via `app.workspace_id` |
| `themory_worker` | retenção e manutenção | todos os workspaces | policy **nomeada** `*_worker_cross_workspace` |

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

## O que ainda NÃO é coberto

A suíte de integração continua conectando como superusuário — mudar isso exigiria
reescrever fixtures que gravam entre workspaces e truncam tabelas. O que fecha a
lacuna é que os testes de isolamento provisionam papéis restritos por conta
própria (`tests/integration/tenant-isolation/`), e é ali que a isolação é medida
sobre um papel onde ela vale.

## Relacionado

- `packages/core/src/infrastructure/db/request-pool-guard.ts` — o guard e a medida
- `packages/core/src/infrastructure/db/background-pool-reach.ts` — a metade simétrica
- `packages/core/src/infrastructure/db/migrations/0029_rls_fail_closed.sql` — as policies
