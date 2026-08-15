/**
 * A conexão que aplica MIGRATIONS, separada da que atende requisição.
 *
 * O papel de aplicação (`themory_app`) é `NOSUPERUSER NOBYPASSRLS` e não tem DDL
 * — é isso que o torna contido pelas policies. Migrar por ele é impossível por
 * desenho, então o dono do schema entra por aqui.
 *
 * Ausente, as migrations rodam pela própria conexão de requisição: é o
 * comportamento anterior, e continua correto onde o papel de requisição é o dono.
 * O guard de boot recusa superusuário e `BYPASSRLS`, não o dono comum.
 *
 * @see docs/security/database-roles.md — os três papéis e por que são três
 */
import { loadConfig, type LoadConfigOptions } from '@usetheo/memory/config';

/** Resolve a URI do dono via o resolvedor em camadas, ou undefined quando ausente. */
export function resolveMigratePgUri(opts?: LoadConfigOptions): string | undefined {
  const value = loadConfig(opts ?? {}).value['THEOMEM_MIGRATE_PG_URI'];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
