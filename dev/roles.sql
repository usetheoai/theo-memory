-- Papéis do banco local, com a mesma separação que produção exige.
--
-- Montado em /docker-entrypoint-initdb.d/ pelo compose, então roda UMA vez, na
-- criação do volume. Se o volume já existe, aplique à mão:
--
--   psql "$THEOMEM_PG_URI" -f dev/roles.sql
--
-- POR QUE ISTO EXISTE. O usuário que o compose cria é superusuário, e
-- superusuário IGNORA row level security. Conectar o serviço com ele faz toda a
-- isolação da migration 0029 valer zero — sem erro, sem log, sem teste vermelho.
-- O guard de boot (`assertRequestPoolIsolated`) recusa subir nesse papel, e este
-- arquivo é o que dá ao dev um papel correto para apontar.
--
-- Os privilégios NÃO estão aqui: quem os concede é a migration 0032 (aplicação)
-- e a 0030 (travessia), condicionalmente, se o papel existir. Criar aqui e
-- conceder lá mantém uma verdade só sobre o que cada papel alcança.

DO $$
BEGIN
    -- Atende requisição. Contido pelas policies — é esse o ponto.
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'themory_app') THEN
        CREATE ROLE themory_app LOGIN PASSWORD 'themory_app' NOSUPERUSER NOBYPASSRLS;
    END IF;

    -- Trabalho que atravessa workspaces de propósito (retenção, manutenção).
    -- A travessia dele é uma POLICY NOMEADA, criada pela 0029 — enumerável em
    -- pg_policies e revogável por tabela, ao contrário de BYPASSRLS.
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'themory_worker') THEN
        CREATE ROLE themory_worker LOGIN PASSWORD 'themory_worker' NOSUPERUSER NOBYPASSRLS;
    END IF;
END $$;
