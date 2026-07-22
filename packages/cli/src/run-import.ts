/**
 * `themory import claude-code` composition root (M12 T1.2, blueprint D1/D2; review F-arch-5).
 *
 * THIN flag-mapper over the deterministic engine (`./import/migrate-claude-code.mjs`). The D2
 * endpoint/token resolution (`THEOMEM_MIGRATE_*` → `THEOMEM_MEMORY_*` env → `~/.claude/theo-memory.env`
 * → default) lives IN the engine — a deliberate placement so the kit-shipped STANDALONE path
 * (`node ~/.claude/hooks/migrate-claude-code.mjs`) is zero-config too, and this runner mutates no
 * global state. Reads nothing at module load (env-free `--help` boot preserved).
 */

export interface ImportClaudeCodeOptions {
  readonly commit?: boolean;
  readonly source?: string;
}

/** Re-exported from the engine so config helpers stay unit-testable from one import path. */
export { parseKitEnvFile, resolveImportEndpoint } from './import/migrate-claude-code.mjs';

export async function runImportClaudeCode(opts: ImportClaudeCodeOptions): Promise<void> {
  const argv: string[] = [];
  if (opts.commit === true) argv.push('--commit');
  if (opts.source !== undefined) argv.push('--source', opts.source);
  // Lazy-load the engine (keeps `--help` boot free of fs walks).
  const { main } = (await import('./import/migrate-claude-code.mjs')) as {
    main: (argv?: string[]) => Promise<void>;
  };
  await main(argv);
}
