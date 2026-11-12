// verbs-as-cli-fixes-cycle-1 T3.1b / F-dom-cli-1 absorption: side-effect
// import below silences dotenv@17 banner BEFORE any other module loads. ESM
// evaluates imports in source order, depth-first. `cli-preload.js` carries
// zero own imports so it is a leaf — its side-effect runs before commander
// / run-mcp-server / run-server / verb handlers are evaluated. This MUST
// be the FIRST `import` line in this module.
import './cli-preload.js';

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
import { readFileSync } from 'node:fs';

import { runMcpServer } from '@usetheo/memory-mcp';
import type { RunMcpServerOptions } from '@usetheo/memory-mcp';
import { Command, InvalidArgumentError, Option } from 'commander';

// Substituido em build-time por `scripts/add-cli-shebang.mjs` a partir do
// manifesto do pacote. Um literal escrito a mao diverge — foi o que aconteceu:
// `--version` dizia 0.1.0-alpha enquanto o manifesto dizia outra coisa.
const CLI_VERSION = '__CLI_VERSION__';

import { registerCleanupWriteQualityCommand } from './run-cleanup-write-quality.js';
import { registerConfigCommand } from './run-config.js';
import { runForget } from './run-forget.js';
import { runHealth } from './run-health.js';
import {
  runKeysCreate,
  runKeysList,
  runKeysRevoke,
  runKeysRotate,
} from './run-keys.js';
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

/**
 * ADR-0015 #3 — resolve `--tls-cert`/`--tls-key` paths into PEM material for the
 * streamable-http listener. Both-or-neither (fail-fast, Unbreakable Rule 8): one
 * without the other is an operator error. `readFileSync` errors (ENOENT, EACCES)
 * propagate verbatim so a bad path fails loudly before the server boots.
 */
export function resolveTlsMaterial(
  certPath?: string,
  keyPath?: string,
): { cert: string; key: string } | undefined {
  if (certPath === undefined && keyPath === undefined) return undefined;
  if (certPath === undefined || keyPath === undefined) {
    throw new InvalidArgumentError(
      '--tls-cert and --tls-key must be provided together (ADR-0015 #3: TLS needs both the certificate and its private key).',
    );
  }
  return { cert: readFileSync(certPath, 'utf8'), key: readFileSync(keyPath, 'utf8') };
}

export function buildProgram(): Command {
  // verbs-as-cli-fixes-cycle-2 T1.1 / ADR D1: STRICT-COERCION parser factories.
  // Replaces fix-cycle-1's lossy Number.parseInt/Number.parseFloat (which
  // silently truncated `5.7` → 5 and `5abc` → 5). Now uses Number() + regex
  // pre-check + isInteger/isFinite + range. Closes M4 + EC-1 (empty string)
  // + EC-2 (hex `0x1F` / scientific `5e2` notation). Pre-regex check rejects
  // empty strings AND hex/scientific notation BEFORE Number() coercion;
  // Number() then catches decimal-trailing-garbage via isInteger/isFinite.
  // The `label` argument MUST include the `--` prefix to preserve parent
  // verbs-cli.test.ts test 16 stderr regex `/.*?top-k/i`.
  const INT_REGEX = /^-?\d+$/;
  const FLOAT_REGEX = /^-?\d+(\.\d+)?$/;
  const parseIntInRange = (label: string, min: number, max: number) =>
    (raw: string): number => {
      // EC-1 + EC-2 absorption: regex pre-check rejects empty string AND hex
      // (`0x1F`) AND scientific (`5e2`) AND trailing garbage (`5abc`)
      // BEFORE Number() coercion.
      if (raw.trim().length === 0 || !INT_REGEX.test(raw)) {
        throw new InvalidArgumentError(
          `Invalid ${label}: ${raw} (must be an integer in ${String(min)}..${String(max)}).`,
        );
      }
      const n = Number(raw);
      if (!Number.isInteger(n) || n < min || n > max) {
        throw new InvalidArgumentError(
          `Invalid ${label}: ${raw} (must be an integer in ${String(min)}..${String(max)}).`,
        );
      }
      return n;
    };
  const parseFloatInRange = (label: string, min: number, max: number) =>
    (raw: string): number => {
      if (raw.trim().length === 0 || !FLOAT_REGEX.test(raw)) {
        throw new InvalidArgumentError(
          `Invalid ${label}: ${raw} (must be a float in [${String(min)}, ${String(max)}]).`,
        );
      }
      const n = Number(raw);
      if (!Number.isFinite(n) || n < min || n > max) {
        throw new InvalidArgumentError(
          `Invalid ${label}: ${raw} (must be a float in [${String(min)}, ${String(max)}]).`,
        );
      }
      return n;
    };

  const program = new Command();
  program
    .name('themory')
    .description('@usetheo/memory CLI — managed three-tier memory layer')
    .version(CLI_VERSION);

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

  // EC-5 absorption — URL parser shared by `themory server` AND `themory mcp` for --issuer.
  const parseIssuerUrl = (raw: string): string => {
    try {
      new URL(raw);
      return raw;
    } catch {
      throw new InvalidArgumentError(`Invalid --issuer URL: ${raw} (must be a valid URL, e.g., https://auth.example.com).`);
    }
  };

  program
    .command('mcp')
    .description('Start the MCP server (stdio or streamable-http transport).')
    .addOption(
      new Option('--transport <kind>', 'MCP transport kind').choices(['stdio', 'streamable-http']),
    )
    .option(
      '--port <number>',
      'Port for streamable-http transport (1..65535)',
      parseIntInRange('--port', 1, 65_535),
    )
    .option('--host <address>', 'Bind host for streamable-http transport')
    .addOption(
      new Option(
        '--auth <mode>',
        'Auth mode for the streamable-http transport. `oauth` makes the server an OAuth 2.1 resource ' +
          'server: every request needs an RS256 access token from THEO_OAUTH_ISSUER whose audience is ' +
          'THEO_MCP_RESOURCE, and its tenant_id scopes the request. Selected automatically when ' +
          'THEO_MCP_RESOURCE is set. `none` runs without auth — ONLY for localhost dev. ' +
          'API keys are not accepted on this transport.',
      ).choices(['none', 'oauth']),
    )
    .option('--tls-cert <path>', 'Path to the TLS certificate PEM (required WITH --tls-key for a non-localhost --host per ADR-0015 #3)')
    .option('--tls-key <path>', 'Path to the TLS private-key PEM (required WITH --tls-cert)')
    .addOption(
      new Option(
        '--compat <mode>',
        'Tool-surface compatibility mode. `openmemory` exposes the OpenMemory tool surface ' +
          '(add_memories/search_memory/list_memories/delete_memories) over an SSE endpoint ' +
          '(/{client}/sse/{user}, default port 8765) — a drop-in for OpenMemory-wired MCP clients.',
      ).choices(['openmemory']),
    )
    .action(
      async (opts: {
        transport?: 'stdio' | 'streamable-http';
        port?: number;
        host?: string;
        auth?: 'none' | 'oauth';
        tlsCert?: string;
        tlsKey?: string;
        compat?: 'openmemory';
      }) => {
        const tls = resolveTlsMaterial(opts.tlsCert, opts.tlsKey);
        const options: RunMcpServerOptions = {
          ...(opts.transport !== undefined ? { transport: opts.transport } : {}),
          ...(opts.port !== undefined ? { port: opts.port } : {}),
          ...(opts.host !== undefined ? { host: opts.host } : {}),
          ...(opts.auth !== undefined ? { auth: opts.auth } : {}),
          ...(tls !== undefined ? { tls } : {}),
          ...(opts.compat !== undefined ? { compat: opts.compat } : {}),
        };
        await runMcpServer(options);
      },
    );

  program.command('worker')
    .description('Process durable memory extraction jobs against a migrated database.')
    .option('--once', 'Process at most one available job and exit.')
    .option('--purge-expired', 'Physically erase expired memories, including their historical snapshots.')
    .option('--concurrency <number>', 'Concurrent jobs (1..32)', parseIntInRange('--concurrency',1,32),2)
    .action(async (opts:{once?:boolean;concurrency?:number;purgeExpired?:boolean})=>{
      const {runWorker}=await import('./run-worker.js');
      await runWorker(opts);
    });

  program
    .command('server')
    .description('Start the REST API server on PORT (default 8080).')
    .option('--port <number>', 'Port to bind (1..65535)', parseIntInRange('--port', 1, 65_535))
    .option('--host <address>', 'Bind host (default 0.0.0.0)')
    .option('--issuer <url>', 'OIDC issuer URL for RFC 7662 introspection (or env THEMORY_OIDC_ISSUER)', parseIssuerUrl)
    .option('--client-id <id>', 'OIDC client_id (or env THEMORY_OIDC_CLIENT_ID). Secret env-only via THEMORY_OIDC_CLIENT_SECRET (ADR D4)')
    .action(async (opts: { port?: number; host?: string; issuer?: string; clientId?: string }) => {
      const options: RunServerOptions = {
        ...(opts.port !== undefined ? { port: opts.port } : {}),
        ...(opts.host !== undefined ? { host: opts.host } : {}),
        ...(opts.issuer !== undefined ? { issuer: opts.issuer } : {}),
        ...(opts.clientId !== undefined ? { clientId: opts.clientId } : {}),
      };
      await runServer(options);
    });

  program
    .command('migrate')
    .description('Apply pending Drizzle migrations against THEOMEM_PG_URI.')
    .action(runMigrate);

  // M12 — data-import namespace (ships ONLY claude-code; future sources by demand, YAGNI).
  // `migrate` = SCHEMA; `import` = DATA (blueprint D1 — never conflate the verbs).
  const importCmd = program
    .command('import')
    .description('Import external memory data into theo-memory (dry-run by default).');
  importCmd
    .command('claude-code')
    .description(
      "Import Claude Code's file-based memory (~/.claude/projects/*/memory) — dry-run unless --commit; secrets scrubbed fail-closed.",
    )
    .option('--commit', 'actually POST to /v1/remember/batch (default: dry-run report only)')
    .option('--source <dir>', 'root of Claude Code projects (default: ~/.claude/projects)')
    .action(async (opts: { commit?: boolean; source?: string }) => {
      const { runImportClaudeCode } = await import('./run-import.js');
      await runImportClaudeCode(opts);
    });

  // M13 (#111) — semantic entity backfill (blueprint ADR D3). Dry-run needs only
  // THEOMEM_PG_URI; the real run additionally requires OPENAI_API_KEY.
  program
    .command('reextract')
    .description(
      'Re-extract entities with semantic types over the existing base (LLM backfill; supersedes mechanism-labeled rows).',
    )
    .option('--dry-run', 'estimate targets + token cost; ZERO LLM calls, ZERO writes')
    .option('--resume', 'skip memories already recorded in .reextract-checkpoint.json')
    .option('--restart', 'delete the checkpoint and start over')
    .option('--limit <n>', 'process at most N target memories')
    .option('--concurrency <n>', 'max in-flight LLM calls (default 5)')
    .option('--retire-mechanism', 'retire mechanism-labeled noise entities left after a full backfill (dry-run unless --commit)')
    .option('--commit', 'actually delete the retirement set (requires --retire-mechanism)')
    .option('--json', 'machine-readable report on stdout')
    .action(async (opts: { dryRun?: boolean; resume?: boolean; restart?: boolean; limit?: string; concurrency?: string; json?: boolean; retireMechanism?: boolean; commit?: boolean }) => {
      const { runReextractCli } = await import('./reextract/run-reextract.js');
      process.exit(await runReextractCli(opts));
    });

  program
    .command('health')
    .description('Probe DI graph + DB readiness; exit 0 only when both green.')
    .option('--deep', 'Additionally invoke embedder.embed + llm.generateChat smoke probes')
    .action(async (opts: { deep?: boolean }) => {
      const exitCode = await runHealth({ deep: opts.deep === true });
      process.exit(exitCode);
    });

  // ─── Camada 2 admin: `themory keys ...` per plan theo-memory-faang-auth-lifecycle T2.3 ───
  // Hits the admin REST surface (T2.1) at $THEMORY_BASE_URL (default localhost:3000)
  // using $THEMEMORY_API_KEY for Bearer auth. Caller's responsibility to point
  // these at an admin-scoped key OR the env-bootstrap token (ADR D7).
  const buildKeysCtx = () => ({
    baseUrl: process.env['THEMORY_BASE_URL'] ?? 'http://localhost:3000',
    bearerToken: process.env['THEMEMORY_API_KEY'] ?? '',
  });

  const keys = program
    .command('keys')
    .description('Manage theo_live_* API keys (admin scope required).');

  keys
    .command('create')
    .description('Create a new API key; secret printed once.')
    .requiredOption('--name <name>', 'human-friendly label (≤ 64 chars)')
    .requiredOption('--scope <scope>', 'scope (repeat for multiple)', (val: string, prev: string[] = []) => prev.concat(val), [])
    .option('--expires <iso>', 'optional ISO-8601 expiration timestamp')
    .action(async (opts: { name: string; scope: string[]; expires?: string }) => {
      const ctx = buildKeysCtx();
      const code = await runKeysCreate(ctx, {
        name: opts.name,
        scopes: opts.scope,
        ...(opts.expires !== undefined ? { expiresAt: opts.expires } : {}),
      });
      process.exit(code);
    });

  keys
    .command('list')
    .description('List active API keys (excludes revoked).')
    .action(async () => {
      const ctx = buildKeysCtx();
      const code = await runKeysList(ctx);
      process.exit(code);
    });

  keys
    .command('revoke <id>')
    .description('Revoke an API key by id (apk-{16hex}).')
    .action(async (id: string) => {
      const ctx = buildKeysCtx();
      const code = await runKeysRevoke(ctx, id);
      process.exit(code);
    });

  keys
    .command('rotate <id>')
    .description('Rotate an API key; old key keeps working during the grace window.')
    .option('--grace-hours <n>', 'grace-window hours (1-168; default 24)', (val: string) => parseInt(val, 10))
    .action(async (id: string, opts: { graceHours?: number }) => {
      const ctx = buildKeysCtx();
      const code = await runKeysRotate(ctx, id, opts.graceHours);
      process.exit(code);
    });

  // ─── M25: `themory config init/set/get/list` (layered config) ────────────
  // Registered via a helper in run-config.ts so the router stays thin (SRP).
  registerConfigCommand(program);

  // ─── 4-verb subcommands per plan verbs-as-cli v1.1 + ADR D2 ──────────────
  // remember / recall / reflect: 3-tier mutually-exclusive scope flags.
  // forget: NO scope flags per EC-1 (memoryId globally unique).

  // T2.2 / ADR D4: replaced 3 byte-similar parsers with parseIntInRange +
  // parseFloatInRange factory invocations (see top of buildProgram).
  const parseTopK = parseIntInRange('--top-k', 1, 100);
  const parseThreshold = parseFloatInRange('--threshold', 0, 1);
  const parseDiversify = parseFloatInRange('--diversify', 0, 1);
  const resolveFormat = (opts: { json?: boolean; text?: boolean }): 'json' | 'text' =>
    opts.text === true ? 'text' : 'json';

  program
    .command('remember <text>')
    .description('Write a fact to memory (3-tier scope required).')
    .option('--user <id>', 'Scope by user id')
    .option('--session <id>', 'Scope by session id')
    .option('--agent <id>', 'Scope by agent id')
    // Issue #79 — verbatim store toggle, mirroring REST `POST /v1/remember`
    // `infer: false`. Commander stores the negated form under `opts.infer`
    // (defaults to `true`; `--no-infer` sets it to `false`). Forwarding the
    // verbatim path makes a CLI write → recall round-trip deterministic on any
    // backend (no dependency on LLM fact-extraction).
    .option('--no-infer', 'Store text verbatim, skipping LLM fact-extraction (REST infer:false parity)')
    .option('--json', 'Output JSON (default)')
    .option('--text', 'Output human-readable text instead of JSON')
    .action(
      async (
        text: string,
        opts: {
          user?: string;
          session?: string;
          agent?: string;
          infer?: boolean;
          json?: boolean;
          text?: boolean;
        },
      ) => {
        try {
          await runRemember({
            text,
            ...(opts.user !== undefined ? { user: opts.user } : {}),
            ...(opts.session !== undefined ? { session: opts.session } : {}),
            ...(opts.agent !== undefined ? { agent: opts.agent } : {}),
            ...(opts.infer === false ? { infer: false } : {}),
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

  // M27 — command def co-located with its handler (keeps cli.ts from growing further).
  registerCleanupWriteQualityCommand(program, resolveFormat);

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
