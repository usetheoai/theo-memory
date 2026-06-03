/**
 * CLI router for `themory` — consolidated multi-subcommand entry per
 * Roadmap Item 18 + plan T2.1.
 *
 * Subcommands (4):
 *  - `themory mcp`     — start MCP server (T2.2; alias `themory-mcp` per EC-27)
 *  - `themory server`  — start REST server (T2.3 — stub at T2.1)
 *  - `themory migrate` — run pending Drizzle migrations (T2.4 — stub at T2.1)
 *  - `themory health`  — DI graph + DB ping readiness check (T2.5 — stub at T2.1)
 *
 * EC-27 backward-compat alias (`themory-mcp` → `themory mcp`):
 * When the bin entry is invoked via the legacy `themory-mcp` basename
 * (detected via regex on `process.argv[1]`), the router emits a one-time
 * DEPRECATED stderr warning and rewrites `process.argv` to insert `mcp` as
 * the first positional, so commander dispatches to `.command('mcp')` as if
 * the user typed `themory mcp` directly. Regex covers `.js`, `.mjs`, `.cjs`
 * and pathless invocations from npm exec / npx / direct paths.
 *
 * EC-29 absorption — `process.argv.splice(2, 0, 'mcp')` mutates the
 * process-global argv before commander parses it. Idempotent-guarded:
 * if `process.argv[2] === 'mcp'` already (user typed `themory-mcp mcp`
 * explicitly), the splice is SKIPPED to avoid double-injection producing
 * `['themory-mcp', 'mcp', 'mcp']`.
 *
 * EC-28 — `package.json#bin` maps BOTH `themory` and `themory-mcp` to this
 * same compiled entry (`./dist/agent-tools/cli.js`); the alias detection
 * here is the only behavior switch.
 *
 * @see Plan theo-memory-standalone-p0 § T2.1 + EC-27 + EC-28 + EC-29
 * @see Roadmap Item 18 — CLI consolidado
 */
import { Command, Option } from 'commander';

import { runHealth } from './run-health.js';
import { runMcpServer } from './run-mcp-server.js';
import type { RunMcpServerOptions } from './run-mcp-server.js';
import { runMigrate } from './run-migrate.js';
import { runServer } from './run-server.js';
import type { RunServerOptions } from './run-server.js';

const ALIAS_PATTERN = /themory-mcp(?:\.(?:js|mjs|cjs|ts))?$/;

export function detectMcpAlias(argv1: string | undefined): boolean {
  if (typeof argv1 !== 'string') return false;
  return ALIAS_PATTERN.test(argv1);
}

export function applyAliasArgvShim(argv: string[]): string[] {
  // Idempotent guard — never double-inject `mcp` if user typed it explicitly.
  if (argv[2] === 'mcp') return argv;
  const next = argv.slice();
  next.splice(2, 0, 'mcp');
  return next;
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('themory')
    .description('@usetheo/memory CLI — managed three-tier memory layer')
    .version('0.1.0-alpha');

  program
    .command('mcp')
    .description('Start the MCP server (stdio or streamable-http transport).')
    .addOption(
      new Option('--transport <kind>', 'MCP transport kind').choices(['stdio', 'streamable-http']),
    )
    .option('--port <number>', 'Port for streamable-http transport (1..65535)', (raw: string) => {
      const n = Number.parseInt(raw, 10);
      if (!Number.isInteger(n) || n <= 0 || n > 65_535) {
        throw new Error(`Invalid --port: ${raw} (must be an integer in 1..65535).`);
      }
      return n;
    })
    .option('--host <address>', 'Bind host for streamable-http transport')
    .action(async (opts: { transport?: 'stdio' | 'streamable-http'; port?: number; host?: string }) => {
      const options: RunMcpServerOptions = {
        ...(opts.transport !== undefined ? { transport: opts.transport } : {}),
        ...(opts.port !== undefined ? { port: opts.port } : {}),
        ...(opts.host !== undefined ? { host: opts.host } : {}),
      };
      await runMcpServer(options);
    });

  program
    .command('server')
    .description('Start the REST API server on PORT (default 8080).')
    .option('--port <number>', 'Port to bind (1..65535)', (raw: string) => {
      const n = Number.parseInt(raw, 10);
      if (!Number.isInteger(n) || n <= 0 || n > 65_535) {
        throw new Error(`Invalid --port: ${raw} (must be an integer in 1..65535).`);
      }
      return n;
    })
    .option('--host <address>', 'Bind host (default 0.0.0.0)')
    .action(async (opts: { port?: number; host?: string }) => {
      const options: RunServerOptions = {
        ...(opts.port !== undefined ? { port: opts.port } : {}),
        ...(opts.host !== undefined ? { host: opts.host } : {}),
      };
      await runServer(options);
    });

  program
    .command('migrate')
    .description('Apply pending Drizzle migrations against THEOMEM_PG_URI.')
    .action(runMigrate);

  program
    .command('health')
    .description('Probe DI graph + DB readiness; exit 0 only when both green.')
    .option('--deep', 'Additionally invoke embedder.embed + llm.generateChat smoke probes')
    .action(async (opts: { deep?: boolean }) => {
      const exitCode = await runHealth({ deep: opts.deep === true });
      process.exit(exitCode);
    });

  return program;
}

export async function main(argv: readonly string[] = process.argv): Promise<void> {
  // EC-27 backward-compat alias: themory-mcp → themory mcp.
  // Order is load-bearing per SEPA iter 9 MAJOR — warning to stderr FIRST so
  // users see the deprecation EVERY invocation regardless of parse outcome,
  // then argv splice, then commander dispatch.
  const live = argv as string[];
  if (detectMcpAlias(live[1])) {
    process.stderr.write(
      'DEPRECATED: `themory-mcp` is an alias for `themory mcp` and will be removed in v1.0. ' +
        'Update your scripts to invoke `themory mcp` directly.\n',
    );
    const shimmed = applyAliasArgvShim(live);
    if (shimmed !== live) process.argv = shimmed;
  }

  const program = buildProgram();
  await program.parseAsync(process.argv);
}

// Invoke when executed directly as the bin entry. Matches three forms:
//  - `node dist/agent-tools/cli.js` (raw build artifact)
//  - `themory` / `themory.cmd` (PATH-resolved bin, npm-installed)
//  - `themory-mcp` (alias bin per EC-27/28 — handled inside main())
// Skip when imported as a module (e.g., from unit tests).
const isDirectInvocation =
  typeof process !== 'undefined' &&
  typeof process.argv[1] === 'string' &&
  /(?:agent-tools[\\/]cli\.(?:js|ts)|themory(?:-mcp)?(?:\.(?:js|mjs|cjs|cmd))?)$/.test(
    process.argv[1],
  );

if (isDirectInvocation) {
  main().catch((err: unknown) => {
    process.stderr.write(`themory CLI failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
