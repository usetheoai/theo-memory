/**
 * CLI dist-artifact env-free boot sentinel.
 *
 * Regression guard for two defects exposed by the workspace reorg
 * (`extract-cli-to-packages`):
 *
 *   1. Dist alias resolution — `tsc` emits bare `@usetheo/*` specifiers that
 *      resolve through the workspace symlink back to TypeScript SOURCE, so
 *      `node dist/agent-tools/cli.js` crashed with ERR_MODULE_NOT_FOUND
 *      (`packages/mcp/src/server.js`). Fixed by `scripts/rewrite-dist-aliases.mjs`
 *      (postbuild) rewriting aliases to relative dist paths.
 *
 *   2. Eager optional-dependency load — the CLI router statically imported the
 *      `LocalTransformerEmbedder` (@xenova/transformers) + `OpenAILLM` (openai)
 *      adapters, both OPTIONAL deps, so `themory --help` required them installed.
 *      Fixed by lazy-importing them at the single construction site
 *      (`wireMemoryFromPool`).
 *
 * Unlike the sibling `mcp-cli-boot.test.ts` (which needs OPENAI_API_KEY +
 * THEOMEM_PG_URI to spawn a live MCP server), this sentinel asserts the dist
 * artifact loads its module graph and prints `--help` / `--version` with NO env
 * and NO optional deps — exactly what a user running `themory --help` to discover
 * commands must get. It only skips when the dist artifact is absent.
 *
 * @see scripts/rewrite-dist-aliases.mjs
 * @see packages/agent-core/src/agent-tools-memory.ts (lazy optional-dep load)
 * @see .claude/knowledge-base/plans/extract-cli-to-packages-plan.md (themory --help após build)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const CLI_PATH = join(REPO_ROOT, 'dist', 'agent-tools', 'cli.js');
const DIST_EXISTS = existsSync(CLI_PATH);

if (!DIST_EXISTS) {
  console.warn('cli-dist-boot-envfree SKIP — dist/agent-tools/cli.js missing. Run `pnpm build` first.');
}

/** Run the built CLI with an env stripped of optional-dep + runtime hints. */
function runCli(args: string[]): { stdout: string; status: number } {
  // Deliberately omit OPENAI_API_KEY / THEOMEM_PG_URI to prove --help needs neither.
  const env: NodeJS.ProcessEnv = { PATH: process.env['PATH'], HOME: process.env['HOME'] };
  try {
    const stdout = execFileSync('node', [CLI_PATH, ...args], {
      env,
      encoding: 'utf8',
      timeout: 20_000,
    });
    return { stdout, status: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { stdout: (e.stdout ?? '') + (e.stderr ?? ''), status: e.status ?? 1 };
  }
}

describe.skipIf(!DIST_EXISTS)('CLI dist-artifact env-free boot', () => {
  test('`themory --help` exits 0 and lists the consolidated subcommands', () => {
    const { stdout, status } = runCli(['--help']);
    expect(status).toBe(0);
    expect(stdout).toContain('Usage: themory');
    for (const cmd of ['mcp', 'server', 'migrate', 'health', 'remember', 'recall', 'forget', 'reflect']) {
      expect(stdout).toContain(cmd);
    }
  });

  test('`themory --version` exits 0 (module graph loads with no env, no optional deps)', () => {
    const { stdout, status } = runCli(['--version']);
    expect(status).toBe(0);
    expect(stdout.trim().length).toBeGreaterThan(0);
  });

  test('`themory mcp --help` exits 0 (mcp subcommand graph resolves from dist)', () => {
    const { status } = runCli(['mcp', '--help']);
    expect(status).toBe(0);
  });

  test('no `@usetheo/*` bare specifier remains in the built CLI entry (alias rewrite applied)', () => {
    const cli = readFileSync(CLI_PATH, 'utf8');
    expect(cli).not.toMatch(/from\s+['"]@usetheo\//);
    expect(cli).not.toMatch(/import\(\s*['"]@usetheo\//);
  });
});
