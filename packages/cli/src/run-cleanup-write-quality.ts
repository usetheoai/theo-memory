/**
 * `themory cleanup-write-quality` handler — M27 T4.1.
 *
 * Retires already-stored write-quality pollution (questions, first-person openers, transcript
 * dumps) from a scope, REVERSIBLY (soft-delete via `forget`, never hard-delete — ADR-3). Dry-run
 * by default: it only reports the candidates. `--apply` performs the soft-deletes, emitting a
 * per-row audit event (Princípio 3). This is the operator entrypoint the /review flagged as
 * missing — `cleanupWriteQuality` (packages/core/src/application) had no caller.
 */
import { cleanupWriteQuality } from '@usetheo/memory';
import { createAgentToolsMemory } from '@usetheo/memory-agent-core';
import type { Command } from 'commander';

import type { CliFormat } from './cli-output.js';
import { resolveCliScope, validateScopeOpts } from './cli-scope.js';

export interface RunCleanupWriteQualityOptions {
  readonly user?: string;
  readonly session?: string;
  readonly agent?: string;
  readonly apply?: boolean;
  readonly limit?: number;
  readonly format: CliFormat;
}

export async function runCleanupWriteQuality(opts: RunCleanupWriteQualityOptions): Promise<void> {
  validateScopeOpts(opts);
  const limit = opts.limit ?? 1000;

  const [memory, dispose] = await createAgentToolsMemory();
  try {
    const scoped = resolveCliScope(memory, opts);
    const result = await cleanupWriteQuality(
      {
        list: () => scoped.getAll({ topK: limit }),
        forget: (id: string) => scoped.forget(id),
      },
      { dryRun: opts.apply !== true },
    );
    const out =
      opts.format === 'text'
        ? `cleanup-write-quality (${result.dryRun ? 'dry-run' : 'applied'}): ` +
          `${result.candidates.length} polluted, ${result.forgotten.length} soft-deleted, ` +
          `${result.skipped.length} skipped`
        : JSON.stringify(result, null, 2);
    process.stdout.write(out + '\n');
    if (result.dryRun && result.candidates.length > 0) {
      process.stderr.write(
        `\n${result.candidates.length} polluted row(s) found (dry-run). Re-run with --apply to soft-delete them (reversible).\n`,
      );
    }
  } finally {
    await dispose();
  }
}

/** Register `themory cleanup-write-quality` on the program (co-located with its handler). */
export function registerCleanupWriteQualityCommand(
  program: Command,
  resolveFormat: (opts: { json?: boolean; text?: boolean }) => CliFormat,
): void {
  program
    .command('cleanup-write-quality')
    .description(
      'M27: retire stored write-quality pollution (questions/first-person/dumps) from a scope; dry-run unless --apply. Reversible (soft-delete).',
    )
    .option('--user <id>', 'Scope by user id')
    .option('--session <id>', 'Scope by session id')
    .option('--agent <id>', 'Scope by agent id')
    .option('--apply', 'perform the soft-deletes (default: dry-run report only)')
    .option('--limit <n>', 'scan at most N rows', (v) => Number.parseInt(v, 10))
    .option('--json', 'Output JSON (default)')
    .option('--text', 'Output human-readable text instead of JSON')
    .action(
      async (opts: {
        user?: string;
        session?: string;
        agent?: string;
        apply?: boolean;
        limit?: number;
        json?: boolean;
        text?: boolean;
      }) => {
        try {
          await runCleanupWriteQuality({
            ...(opts.user !== undefined ? { user: opts.user } : {}),
            ...(opts.session !== undefined ? { session: opts.session } : {}),
            ...(opts.agent !== undefined ? { agent: opts.agent } : {}),
            ...(opts.apply !== undefined ? { apply: opts.apply } : {}),
            ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
            format: resolveFormat(opts),
          });
        } catch (err: unknown) {
          process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
          process.exit(2);
        }
      },
    );
}
