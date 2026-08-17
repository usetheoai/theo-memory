-- O papel de travessia podia ler, apagar e atualizar — mas não INSERIR.
--
-- A 0030 concedeu SELECT/INSERT/UPDATE/DELETE nas tabelas escopadas e parou
-- ali. Metade das tabelas escopadas tem chave surrogate `bigserial`, e um
-- INSERT nelas toca a SEQUÊNCIA, que é um objeto próprio com privilégio
-- próprio. Sem `USAGE` na sequência o INSERT falha com:
--
--     ERROR:  permission denied for sequence reflection_counters_id_seq
--
-- POR QUE NINGUÉM VIU ANTES. A única travessia que o produto faz hoje é a
-- retenção, e ela só DELETA — caminho que não encosta em sequência nenhuma. O
-- privilégio faltante só aparece quando alguém INSERE atravessando, e o
-- primeiro a fazer isso foi o harness de integração (#196), ao semear dois
-- workspaces pelo papel de travessia em vez de pelo superusuário.
--
-- Isso é exatamente o buraco que a própria 0030 se propôs a fechar do lado das
-- tabelas — "alcance sem privilégio é um boot verde e um primeiro tick com
-- permission denied" — reaparecendo um nível abaixo, no objeto que o INSERT
-- consulta e a policy não cobre.
--
-- A 0032 já emitiu o grant equivalente para `themory_app`; esta migration
-- alinha o papel de travessia, com a mesma forma condicional: sem o papel, nada
-- é emitido.
--
-- @see 0030_worker_role_grants.sql — os grants de tabela que esta completa
-- @see 0032_app_role_grants.sql — o mesmo grant, do lado do papel de aplicação
-- @see tests/integration/_helpers/isolated-db.ts — quem encostou no buraco

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'themory_worker') THEN
        RAISE NOTICE 'themory_worker ausente: nenhum grant de sequencia emitido.';
        RETURN;
    END IF;

    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO themory_worker';
END $$;
