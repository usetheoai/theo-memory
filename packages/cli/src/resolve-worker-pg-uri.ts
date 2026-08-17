/**
 * Resolves the connection used by workspace-SPANNING background work.
 *
 * `THEOMEM_PG_URI` is the application's connection: one workspace at a time,
 * fail-closed under migration 0029. The retention sweep is the opposite kind of
 * work — it exists to touch every workspace's rows — and over the application
 * connection it would delete nothing and say so in no log line.
 *
 * `THEOMEM_WORKER_PG_URI` points at `themory_worker`, the role migration 0029
 * grants the `*_worker_cross_workspace` policies to. It is deliberately a
 * separate variable rather than a fallback: a deployment that has not created
 * that role should find out at boot, not from a table that grew for a year.
 *
 * Resolved through the same layered config as the main URI, so it can be pinned
 * in `./.themory.json` / `~/.themory/config.json` and read by
 * `themory config get/list`. Non-secret, like its sibling.
 *
 * @see @usetheo/memory infrastructure/db/background-pool-reach.ts — the boot assertion
 */
import { loadConfig, type LoadConfigOptions } from '@usetheo/memory/config';

/** Resolve the cross-workspace DB URI via the 5-layer resolver, or undefined when unset. */
export function resolveWorkerPgUri(opts?: LoadConfigOptions): string | undefined {
  const value = loadConfig(opts ?? {}).value['THEOMEM_WORKER_PG_URI'];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
