# Quem mora no workspace `default`

Consulta operacional para responder uma pergunta só: **quantas linhas estão no
workspace `default`, e isso é intencional?**

## Por que a pergunta existe

Toda coluna de escopo do catálogo nasceu com `DEFAULT 'default'` — a ponte que
manteve as instalações single-tenant funcionando quando o `workspace_id` foi
introduzido. O efeito colateral é que **um `INSERT` que esquece a coluna não
falha**: a linha entra em `default` e passa a ser visível para quem estiver
naquele workspace.

Antes da migration 0029 esse era o modo de falha silencioso do produto inteiro.
Depois dela o `WITH CHECK` recusa a escrita quando o contexto da sessão é outro —
mas apenas para conexões sujeitas à política. Uma conexão de superusuário
continua gravando em `default` sem reclamar, e é assim que a suíte de testes
deste repositório roda.

Por isso a contagem não é auditoria automática: o catálogo **não distingue** uma
linha legítima da instalação legada de uma linha que errou o inquilino. Ela é um
sinal para decisão de produto.

## A consulta

Descobre as tabelas escopadas no próprio catálogo, então roda contra qualquer
banco do ecossistema (`workspace_id` nos produtos TS, `tenant_id` no engine):

```sql
SELECT c.table_name,
       (xpath('/row/c/text()',
              query_to_xml(format('SELECT count(*) AS c FROM public.%I WHERE %I = ''default''',
                                  c.table_name, c.column_name),
                           false, true, '')))[1]::text::bigint AS linhas_default,
       (xpath('/row/c/text()',
              query_to_xml(format('SELECT count(*) AS c FROM public.%I', c.table_name),
                           false, true, '')))[1]::text::bigint AS linhas_total
  FROM information_schema.columns c
  JOIN pg_tables t ON t.schemaname = 'public' AND t.tablename = c.table_name
 WHERE c.table_schema = 'public'
   AND c.column_name IN ('workspace_id', 'tenant_id')
 ORDER BY 2 DESC NULLS LAST, 1;
```

## O que foi medido (2026-08-14)

Contra os bancos alcançáveis nesta máquina — os dois são bancos de teste, não
implantações:

| banco | linhas em `default` | leitura |
|---|---|---|
| `themem` (pgvector local) | 1, em `workspace_users` | a semente deliberada `default-owner`, a ponte single-tenant |
| `theo_test` (engine) | 0 | nenhuma linha escopada foi criada por essa via |

Nenhuma linha mal-arquivada. O número que importaria — o de uma implantação real —
não foi medido aqui, e a decisão registrada foi de **recriar os bancos**, o que
torna a contagem anterior irrelevante por escolha, não por omissão.

## O que NÃO fazer com o resultado

Apagar linhas em `default` sem decisão de produto. Nesse workspace convivem a
instalação legada legítima e o erro de escopo, e nada no catálogo separa as duas.

## Relacionado

- `packages/core/src/infrastructure/db/migrations/0029_rls_fail_closed.sql` — as políticas
- `tests/integration/tenant-isolation/scoped-insert-paths.test.ts` — as quatro escritas que esqueciam a coluna
