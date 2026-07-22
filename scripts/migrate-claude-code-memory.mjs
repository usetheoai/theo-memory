/**
 * BACK-COMPAT SHIM (M12 T1.2) — the migrator moved into the shipped package:
 * `packages/cli/src/import/migrate-claude-code.mjs`, surfaced as `themory import claude-code`.
 * This shim keeps `node scripts/migrate-claude-code-memory.mjs` and every existing
 * `import { ... } from '../scripts/migrate-claude-code-memory.mjs'` working unchanged.
 */
import { pathToFileURL } from 'node:url';

export * from '../packages/cli/src/import/migrate-claude-code.mjs';
import { main } from '../packages/cli/src/import/migrate-claude-code.mjs';

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
