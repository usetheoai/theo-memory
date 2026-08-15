-- Privilégios do papel que ATENDE REQUISIÇÃO, para que as policies valham nele.
--
-- A 0029 pôs FORCE ROW LEVEL SECURITY em toda tabela escopada e deu ao dono
-- nenhuma policy de manutenção — o dono é contido como qualquer um. Isso está
-- certo, e mesmo assim não bastava: **superusuário ignora RLS por completo**, e
-- é como o ambiente de desenvolvimento e a suíte deste repositório conectam.
-- Nesse papel, a política que este trabalho inteiro instalou não vale nada.
--
-- O conserto tem duas metades, e esta migration é a primeira:
--
--   1. existir um papel de aplicação `NOSUPERUSER NOBYPASSRLS` com os
--      privilégios de tabela que o serviço precisa (aqui);
--   2. o processo RECUSAR SUBIR quando a conexão que atende requisição não é
--      contida pelas políticas (`assertRequestPoolIsolated`, no boot).
--
-- Sem a segunda, a primeira é opcional na prática — ninguém percebe que voltou
-- a conectar como dono. Sem a primeira, a segunda derruba o dev loop.
--
-- POR QUE A CRIAÇÃO DO PAPEL NÃO ESTÁ AQUI. `CREATE ROLE` exige `CREATEROLE` ou
-- superusuário, e o papel que roda migrations em produção tende a não ter
-- nenhum dos dois — medido nesta mesma linha de trabalho, quando a rota
-- `SECURITY DEFINER` foi tentada no engine e esbarrou exatamente nisso. Então o
-- papel é provisionado por quem opera (o `dev/roles.sql` do compose local, o
-- provisionamento do ambiente em produção) e ESTA migration apenas concede,
-- condicionalmente, como a 0030 faz para o worker.
--
-- O QUE O PAPEL NÃO RECEBE, de propósito:
--   * nada de DDL — migrations continuam sendo do dono;
--   * nada em `admin_config`, que é superfície de operador;
--   * `DELETE` em `users` e `workspaces` — remover pessoa ou inquilino é ato
--     administrativo, não algo que um handler de requisição faz.
--
-- @see 0029_rls_fail_closed.sql — as policies que só valem sobre um papel contido
-- @see 0030_worker_role_grants.sql — o irmão, para o papel de travessia
-- @see infrastructure/db/request-pool-guard.ts — a segunda metade

DO $$
DECLARE
    t          text;
    has_app    boolean;
    -- Toda tabela que o caminho de requisição toca. `admin_config` fica fora.
    app_tables text[] := ARRAY[
        'workspaces',
        'workspace_users',
        'users',
        'theo_api_keys',
        'routing_policies',
        'routing_audit',
        'memories',
        'memory_entities',
        'reflection_counters',
        'entities',
        'entity_edges',
        'history',
        'consolidation_history',
        'recall_cache',
        'scope_usage_counters',
        'recall_traces'
    ];
BEGIN
    SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'themory_app') INTO has_app;
    IF NOT has_app THEN
        RAISE NOTICE 'themory_app ausente: nenhum grant emitido. O servico continua conectando como dono, e o guard de boot vai recusar.';
        RETURN;
    END IF;

    EXECUTE 'GRANT USAGE ON SCHEMA public TO themory_app';

    FOREACH t IN ARRAY app_tables LOOP
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = t
        ) THEN
            CONTINUE;
        END IF;
        IF t IN ('users', 'workspaces') THEN
            EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.%I TO themory_app', t);
        ELSE
            EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO themory_app', t);
        END IF;
    END LOOP;

    -- As chaves surrogate de `history` e companhia são `bigserial`: sem a
    -- sequência, o INSERT falha com `permission denied for sequence`, que é
    -- exatamente o modo de falha que a 0030 corrigiu do lado do worker.
    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO themory_app';
END $$;
