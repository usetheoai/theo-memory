/**
 * M25 T3.2 — resolve `THEOMEM_PG_URI` through the layered config resolver.
 *
 * The real consumer wiring (DoD bullet 3): `themory server` (run-server.ts)
 * calls this instead of reading `process.env['THEOMEM_PG_URI']` directly, so an
 * operator can pin the DB URI in `./.themory.json` or `~/.themory/config.json`.
 * Env still wins over any file (ADR-2) → env-only deployments are byte-identical
 * to the pre-M25 behavior. Secrets are unaffected (the PG URI is non-secret).
 *
 * @see .claude/knowledge-base/plans/layered-config-cli-plan.md § T3.2
 */
import { loadConfig, type LoadConfigOptions } from '@usetheo/memory/config';

/** Resolve the DB URI via the 5-layer resolver, or undefined when unset. */
export function resolvePgUri(opts?: LoadConfigOptions): string | undefined {
  const value = loadConfig(opts ?? {}).value['THEOMEM_PG_URI'];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
