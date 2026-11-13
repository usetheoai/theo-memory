-- O contador de reflexão tinha um índice único que não era único e não via o inquilino.
--
-- `reflection_counters_scope_unique_idx` cobria
-- `(scope_user_id, scope_session_id, scope_agent_id)`. Dois defeitos empilhados,
-- e o segundo é o que quase passou batido:
--
-- 1. FALTA O INQUILINO. O escopo é identificador de usuário/sessão/agente —
--    valores que o cliente escolhe. Dois workspaces com o mesmo `user_id` (algo
--    tão comum quanto `admin`) descrevem a mesma chave. O upsert casava a linha
--    do OUTRO inquilino no `UPDATE` e incrementava o contador dele: a reflexão de
--    um cliente disparada pela atividade de outro.
--
-- 2. O ÍNDICE NÃO ENFORÇAVA NADA no caso comum. Em Postgres, NULLs são DISTINTOS
--    num índice único por padrão. Um escopo de usuário tem `scope_session_id` e
--    `scope_agent_id` nulos, então `(admin, NULL, NULL)` e `(admin, NULL, NULL)`
--    convivem sem conflito — medido nesta base antes de escrever isto. A
--    unicidade que o nome do índice anuncia nunca existiu para o escopo mais
--    usado do produto, e o que segurava uma linha só era a guarda
--    `WHERE NOT EXISTS` do upsert — que duas transações simultâneas atravessam.
--
-- A correção trata os dois: a coluna de workspace entra na chave, e
-- `NULLS NOT DISTINCT` (PostgreSQL 15+) faz o índice enxergar o que ele sempre
-- disse enxergar.
--
-- SE ESTA MIGRATION FALHAR com violação de unicidade, ela está fazendo o
-- trabalho: existem linhas duplicadas que o índice antigo deixou entrar, e o
-- erro nomeia exatamente quais. Consolidá-las é decisão de produto (somar os
-- contadores? manter o maior?), não algo para uma migration decidir sozinha.
-- Medido em 2026-08-14 nesta base: 0 duplicatas.
--
-- Alargar a chave nunca cria colisão por si; a colisão possível vem do
-- `NULLS NOT DISTINCT`, e é justamente o defeito ficando visível.
--
-- @see pgvector-store.ts — bumpReflectionCounter (o upsert que depende disto)
-- @see 0029_rls_fail_closed.sql — a policy que trouxe a atenção para cá

DROP INDEX IF EXISTS reflection_counters_scope_unique_idx;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS reflection_counters_scope_unique_idx
  ON public.reflection_counters
  USING btree (workspace_id, scope_user_id, scope_session_id, scope_agent_id)
  NULLS NOT DISTINCT;
