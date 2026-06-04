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
import { Command, InvalidArgumentError, Option } from 'commander';

import { runForget } from './run-forget.js';
import { runHealth } from './run-health.js';
import { runMcpServer } from './run-mcp-server.js';
import type { RunMcpServerOptions } from './run-mcp-server.js';
import { runMigrate } from './run-migrate.js';
import { runRecall } from './run-recall.js';
import { runReflect } from './run-reflect.js';
import { runRemember } from './run-remember.js';
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

  // EC-3 + EC-6 absorption: commander's default exit on invalid-arg /
  // invalid-option-arg is code 1. Plan ADR D4 + plan T0.1 tests 16-18
  // promise exit 2. Override globally so the option-parser bounds-validators
  // (parseTopK / parseThreshold / parseDiversify) hit the contract floor.
  program.exitOverride((err) => {
    if (
      err.code === 'commander.invalidArgument' ||
      err.code === 'commander.invalidOptionArgument'
    ) {
      process.exit(2);
    }
    process.exit(err.exitCode);
  });

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

  // ─── 4-verb subcommands per plan verbs-as-cli v1.1 + ADR D2 ──────────────
  // remember / recall / reflect: 3-tier mutually-exclusive scope flags.
  // forget: NO scope flags per EC-1 (memoryId globally unique).

  const parseTopK = (raw: string): number => {
    const n = Number.parseInt(raw, 10);
    if (!Number.isInteger(n) || n < 1 || n > 100) {
      throw new InvalidArgumentError(`Invalid --top-k: ${raw} (must be an integer in 1..100).`);
    }
    return n;
  };
  const parseThreshold = (raw: string): number => {
    const n = Number.parseFloat(raw);
    if (!Number.isFinite(n) || n < 0 || n > 1) {
      throw new InvalidArgumentError(`Invalid --threshold: ${raw} (must be a float in [0, 1]).`);
    }
    return n;
  };
  const parseDiversify = (raw: string): number => {
    const n = Number.parseFloat(raw);
    if (!Number.isFinite(n) || n < 0 || n > 1) {
      throw new InvalidArgumentError(`Invalid --diversify: ${raw} (must be a float in [0, 1]).`);
    }
    return n;
  };
  const resolveFormat = (opts: { json?: boolean; text?: boolean }): 'json' | 'text' =>
    opts.text === true ? 'text' : 'json';

  program
    .command('remember <text>')
    .description('Write a fact to memory (3-tier scope required).')
    .option('--user <id>', 'Scope by user id')
    .option('--session <id>', 'Scope by session id')
    .option('--agent <id>', 'Scope by agent id')
    .option('--json', 'Output JSON (default)')
    .option('--text', 'Output human-readable text instead of JSON')
    .action(
      async (
        text: string,
        opts: { user?: string; session?: string; agent?: string; json?: boolean; text?: boolean },
      ) => {
        try {
          await runRemember({
            text,
            ...(opts.user !== undefined ? { user: opts.user } : {}),
            ...(opts.session !== undefined ? { session: opts.session } : {}),
            ...(opts.agent !== undefined ? { agent: opts.agent } : {}),
            format: resolveFormat(opts),
          });
        } catch (err: unknown) {
          process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
          process.exit(2);
        }
      },
    );

  program
    .command('recall <query>')
    .description('Query memory with optional --top-k, --threshold, --diversify.')
    .option('--user <id>', 'Scope by user id')
    .option('--session <id>', 'Scope by session id')
    .option('--agent <id>', 'Scope by agent id')
    .option('--top-k <n>', 'Max items returned (1..100; defaults to engine default)', parseTopK)
    .option('--threshold <f>', 'Semantic similarity floor [0, 1]', parseThreshold)
    .option('--diversify <lambda>', 'MMR diversification lambda [0, 1] (opt-in)', parseDiversify)
    .option('--json', 'Output JSON (default)')
    .option('--text', 'Output human-readable text instead of JSON')
    .action(
      async (
        query: string,
        opts: {
          user?: string;
          session?: string;
          agent?: string;
          topK?: number;
          threshold?: number;
          diversify?: number;
          json?: boolean;
          text?: boolean;
        },
      ) => {
        try {
          await runRecall({
            query,
            ...(opts.user !== undefined ? { user: opts.user } : {}),
            ...(opts.session !== undefined ? { session: opts.session } : {}),
            ...(opts.agent !== undefined ? { agent: opts.agent } : {}),
            ...(opts.topK !== undefined ? { topK: opts.topK } : {}),
            ...(opts.threshold !== undefined ? { threshold: opts.threshold } : {}),
            ...(opts.diversify !== undefined ? { diversify: opts.diversify } : {}),
            format: resolveFormat(opts),
          });
        } catch (err: unknown) {
          process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
          process.exit(2);
        }
      },
    );

  program
    .command('forget <id>')
    .description('Hard or soft delete a memory by UUID (NO scope flag — memoryId globally unique).')
    .option('--hard', 'Hard-delete (default: soft via t_invalid)')
    .option('--json', 'Output JSON (default)')
    .option('--text', 'Output human-readable text instead of JSON')
    .action(async (id: string, opts: { hard?: boolean; json?: boolean; text?: boolean }) => {
      try {
        await runForget({
          id,
          ...(opts.hard !== undefined ? { hard: opts.hard } : {}),
          format: resolveFormat(opts),
        });
      } catch (err: unknown) {
        process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
        process.exit(2);
      }
    });

  program
    .command('reflect')
    .description('Trigger reflection pipeline; emits derived insights for the scope.')
    .option('--user <id>', 'Scope by user id')
    .option('--session <id>', 'Scope by session id')
    .option('--agent <id>', 'Scope by agent id')
    .option('--json', 'Output JSON (default)')
    .option('--text', 'Output human-readable text instead of JSON')
    .action(
      async (opts: {
        user?: string;
        session?: string;
        agent?: string;
        json?: boolean;
        text?: boolean;
      }) => {
        try {
          await runReflect({
            ...(opts.user !== undefined ? { user: opts.user } : {}),
            ...(opts.session !== undefined ? { session: opts.session } : {}),
            ...(opts.agent !== undefined ? { agent: opts.agent } : {}),
            format: resolveFormat(opts),
          });
        } catch (err: unknown) {
          process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
          process.exit(2);
        }
      },
    );

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
