/**
 * MCP server composition root — extracted from cli.ts at T2.1 so the CLI
 * router (commander) can keep src/agent-tools/cli.ts thin (≤200 LoC budget
 * per plan T2.1 + SRP). Pre-T2.1, this body lived inline in `cli.ts::main()`;
 * the existing v0.3 EC-7 behavior (env-var hard-fail + dual SIGINT/SIGTERM
 * handlers + 5s shutdown timeout) is preserved verbatim. Only the call site
 * changed (now invoked via `themory mcp` OR the `themory-mcp` alias).
 *
 * Composition root (DIP-allowed): this file wires src/local/ (pgvector +
 * LocalTransformerEmbedder + OpenAILLM real providers) into the
 * agent-tools McpServer. Library layer `src/agent-tools/index.ts` does
 * NOT re-export src/local/ — the bin entry IS the composition site per
 * ADR D8. The runtime hard-fails on missing OPENAI_API_KEY rather than
 * silently wiring a deterministic placeholder; see commit e43d801 of the
 * parent cycle for the placeholder-removal rationale.
 *
 * @see ADR D1 — stdio is the primary transport for local CLI deployment
 * @see ADR D4 — McpServer consumes memoryFactory; T5.1 dispatch resolves scoped memory
 * @see ADR D8 — composition root locus
 * @see EC-7 — env-var hard-fail + dual signal handlers
 * @see Plan theo-memory-standalone-p0 § T2.1 (extraction motivation)
 */
import { Pool } from 'pg';

import { runMigrations } from '../local/index.js';
import { ApiKeyAuthVerifier } from '../server/auth/api-key-verifier.js';
import { createOauth4webapiIntrospect } from '../server/auth/oidc-introspect-oauth4webapi.js';
import { OidcAuthVerifier } from '../server/auth/oidc-verifier.js';

import {
  assertEnvOrExit,
  LOCAL_EMBEDDER_DIM,
  OPENAI_API_KEY_ENV_SPEC,
  PG_URI_ENV_SPEC,
  wireMemoryFromPool,
} from './agent-tools-memory.js';
import type { BearerAuthOptions } from './auth/with-bearer-auth.js';
import { resolveOidcConfig } from './oidc-cli-resolver.js';
import { McpServer } from './server.js';
import { connectStdio } from './transports/stdio.js';
import { connectStreamableHttp } from './transports/streamable-http.js';

// fix-cycle-2 hotfix M2: LOCAL_EMBEDDER_DIM imported from agent-tools-memory.ts
// (single source of truth for the Xenova MiniLM 384-dim constant; was
// triplicated across CLI factory + 2 runners pre-hotfix).

/** Shutdown timeout (ms) — caps how long we wait for server.stop() before force-exit. */
const SHUTDOWN_TIMEOUT_MS = 5_000;

/**
 * T2.2 option bag — CLI flags (passed by commander's `.command('mcp')`
 * action callback) override the legacy THEOMEM_MCP_* env vars. Precedence
 * resolved ONCE inside runMcpServer per SEPA iter 10 MAJOR Q2: CLI > env >
 * default. We do NOT mutate process.env here (preserves test isolation +
 * keeps env-var semantics fail-closed). EC-30 (Windows-specific stdio
 * stream caveats) documented as out-of-P0-scope.
 */
export interface RunMcpServerOptions {
  readonly transport?: 'stdio' | 'streamable-http';
  readonly port?: number;
  readonly host?: string;
  /**
   * T4.1 + ADR-0015 — auth mode for streamable-http transport.
   *
   * - `none` (default): no auth — only safe for localhost dev loops.
   * - `api-keys`: Camada 2 ApiKeyAuthVerifier (theo_live_* SHA-256 lookup).
   * - `oidc`: Camada 3 OidcAuthVerifier (RFC 7662 introspection). Currently
   *   plumbing-only — the production-grade `oauth4webapi` IntrospectFn
   *   adapter ships in a follow-up cycle alongside T5.1. Selecting `oidc` /
   *   `both` today emits a stderr warning + falls back to `api-keys` until
   *   the adapter lands. Tracked under the same plan §
   *   `theo-memory-faang-auth-lifecycle` follow-up.
   * - `both`: dual-validation (theo_live_* → apiKey, else → oidc).
   *
   * stdio transport ignores this field per ADR-0015 #1.
   */
  readonly auth?: 'none' | 'api-keys' | 'oidc' | 'both';
  /** T3.2 — OIDC issuer URL (CLI flag OR env THEMORY_OIDC_ISSUER); required when auth=oidc. */
  readonly issuer?: string;
  /** T3.2 — OIDC client_id; required when auth=oidc. Secret env-only per ADR D4. */
  readonly clientId?: string;
}

/**
 * Resolve MCP transport via 3-tier precedence + stdio fallback:
 * (1) `opt` flag (most-specific operator intent)
 * (2) `THEOMEM_MCP_TRANSPORT` env (explicit config)
 * (3) `THEMEMORY_API_KEY` env presence heuristic — non-empty after trim →
 *     `streamable-http` (operator has a bearer token; presumes HTTP intent)
 * Fallback: `'stdio'` (embedded subprocess use case, Claude Code etc.)
 *
 * @see ADR-D1 — 3-tier precedence rationale (plan themory-mcp-bearer-by-env-faang)
 * @see EC-1 — whitespace-only trim discipline (`!== ''` alone would auto-flip on `"   "`)
 */
function resolveTransport(opt?: RunMcpServerOptions['transport']): 'stdio' | 'streamable-http' {
  if (opt !== undefined) return opt;
  const envValue = process.env['THEOMEM_MCP_TRANSPORT'];
  if (envValue === 'streamable-http' || envValue === 'stdio') return envValue;
  const apiKey = process.env['THEMEMORY_API_KEY'];
  if (apiKey !== undefined && apiKey.trim() !== '') return 'streamable-http';
  return 'stdio';
}

/**
 * Resolve MCP auth mode via 3-tier precedence + safe-default fallback. Mirrors
 * `resolveTransport`'s precedence shape:
 * (1) `opt` flag (Tier-1, most-specific operator intent)
 * (2) `THEOMEM_MCP_AUTH` env (Tier-2, explicit config)
 * (3) `THEMEMORY_API_KEY` env presence heuristic — when `transport === 'streamable-http'`
 *     AND key non-empty after trim → `'api-keys'` (Tier-3). The transport guard
 *     prevents stdio sessions from gaining auth=api-keys silently (stdio ignores
 *     bearer auth per ADR-0015 #1).
 * Fallback: `'none'` (auth-off; default for stdio + explicit no-key HTTP).
 *
 * @see ADR-D2 — env-driven HTTP auto-selects api-keys (NOT none — silent security downgrade rejected)
 * @see EC-1 — whitespace-only trim discipline (symmetric with resolveTransport)
 */
function resolveAuthMode(
  opt: RunMcpServerOptions['auth'],
  transport: 'stdio' | 'streamable-http',
): 'none' | 'api-keys' | 'oidc' | 'both' {
  if (opt !== undefined) return opt;
  const envValue = process.env['THEOMEM_MCP_AUTH'];
  if (envValue === 'none' || envValue === 'api-keys' || envValue === 'oidc' || envValue === 'both') {
    return envValue;
  }
  if (transport === 'streamable-http') {
    const apiKey = process.env['THEMEMORY_API_KEY'];
    if (apiKey !== undefined && apiKey.trim() !== '') return 'api-keys';
  }
  return 'none';
}

/**
 * Single composed-resolution wrapper consumed by `runMcpServer` AND unit tests.
 * EC-2 absorption: instead of exporting `resolveTransport`/`resolveAuthMode`
 * individually (which would freeze them as `@internal`-by-convention API and
 * lock the precedence matrix as quasi-public surface), we export ONE composer
 * that returns the {transport, auth} pair. Future refactors of the individual
 * resolvers stay module-private.
 *
 * @internal — for unit testing + composition root only; NOT re-exported from
 * `src/agent-tools/index.ts` (verified at T4.1 step 2).
 * @see EC-2 — single-export discipline
 */
export function resolveMcpModes(
  opt: Pick<RunMcpServerOptions, 'transport' | 'auth'>,
): { transport: 'stdio' | 'streamable-http'; auth: 'none' | 'api-keys' | 'oidc' | 'both' } {
  const transport = resolveTransport(opt.transport);
  const auth = resolveAuthMode(opt.auth, transport);
  return { transport, auth };
}

function resolvePort(opt?: number): number {
  if (opt !== undefined) {
    if (!Number.isInteger(opt) || opt <= 0 || opt > 65_535) {
      throw new Error(`Invalid port: ${String(opt)} (must be an integer in 1..65535).`);
    }
    return opt;
  }
  const envRaw = process.env['THEOMEM_MCP_HTTP_PORT'];
  const envPort = envRaw === undefined ? 8080 : Number.parseInt(envRaw, 10);
  if (!Number.isInteger(envPort) || envPort <= 0 || envPort > 65_535) {
    throw new Error(`Invalid port from THEOMEM_MCP_HTTP_PORT: ${String(envRaw)} (must be an integer in 1..65535).`);
  }
  return envPort;
}

function resolveHost(opt?: string): string {
  return opt ?? process.env['THEOMEM_MCP_HTTP_HOST'] ?? '127.0.0.1';
}

export async function runMcpServer(options?: RunMcpServerOptions): Promise<void> {
  // verbs-as-cli-fixes-cycle-1 T2.1 / ADR D3: env-fail boundary now goes
  // through the shared `assertEnvOrExit` helper at agent-tools-memory.ts.
  // Single source of truth for `Error: THEOMEM_PG_URI required ...` and
  // `Error: OPENAI_API_KEY required ...` stderr strings (closes F-arch-2 +
  // F-wire-1). PRIORITY 0 hardening + user directive 2026-06-04 ("REMOVA
  // QUALQUER STUB EM NOSSO AMBIENTE PRODUTIVO") preserved at the shared
  // helper — see agent-tools-memory.ts § OPENAI_API_KEY_ENV_SPEC.
  assertEnvOrExit([PG_URI_ENV_SPEC, OPENAI_API_KEY_ENV_SPEC]);
  const pgUri = process.env['THEOMEM_PG_URI']!;

  const { transport, auth: authMode } = resolveMcpModes(options ?? {});
  // Validate port eagerly so an invalid CLI flag fails BEFORE we touch pg —
  // avoids leaking a connection pool when the operator typo'd the port.
  const port = transport === 'streamable-http' ? resolvePort(options?.port) : 0;
  const host = transport === 'streamable-http' ? resolveHost(options?.host) : '';

  const pool = new Pool({ connectionString: pgUri });
  await runMigrations(pool, { embeddingDim: LOCAL_EMBEDDER_DIM });

  process.stderr.write(
    `themory mcp: real providers wired — LocalTransformerEmbedder (Xenova MiniLM, dim=${LOCAL_EMBEDDER_DIM}) + OpenAILLM via OPENAI_BASE_URL.\n`,
  );

  // T3.1 — ADR D3 transport+auth disclosure (Princípio 3 auditability).
  // Suppressed when the operator was EXPLICIT (CLI flag OR scoped env) OR
  // when THEOMEM_MCP_QUIET=1 (EC-6 embedded-use escape). THEMEMORY_API_KEY
  // is intentionally EXCLUDED from `wasExplicit` — its presence IS the
  // Tier-3 heuristic this disclosure exists to announce; including it would
  // mute the line in exactly the scenario ADR D3 requires disclosed.
  // EC-6 scope discipline: QUIET gates ONLY this block, NOT the
  // "real providers wired" line above (FC2-T1.1 sentinel contract).
  // wasExplicit: CLI flag OR a VALID env value. Empty string is NOT explicit —
  // it matches the resolveTransport/resolveAuthMode shape (only meaningful
  // values flow through Tier-2). Test isolation discipline depends on this:
  // beforeEach stubs THEOMEM_MCP_TRANSPORT='' to neutralize a developer shell
  // carrying a real value; treating '' as explicit would suppress the
  // disclosure under test → false-GREEN.
  const envTransport = process.env['THEOMEM_MCP_TRANSPORT'];
  const envAuth = process.env['THEOMEM_MCP_AUTH'];
  const wasExplicit =
    options?.transport !== undefined ||
    options?.auth !== undefined ||
    envTransport === 'stdio' || envTransport === 'streamable-http' ||
    envAuth === 'none' || envAuth === 'api-keys' || envAuth === 'oidc' || envAuth === 'both';
  const quiet = process.env['THEOMEM_MCP_QUIET'] === '1';
  if (!wasExplicit && !quiet) {
    if (transport === 'streamable-http' && authMode === 'api-keys') {
      process.stderr.write(
        'themory mcp: transport=streamable-http + auth=api-keys (THEMEMORY_API_KEY present; pass --transport=stdio to override).\n',
      );
    } else if (transport === 'stdio') {
      process.stderr.write(
        'themory mcp: transport=stdio (default; set THEMEMORY_API_KEY for HTTP+Bearer mode).\n',
      );
    }
  }

  // verbs-as-cli-fixes-cycle-2 T3.1 / ADR D4 retrofit (closes M1): provider
  // tuple composition delegated to shared `wireMemoryFromPool` helper. Single
  // source of truth for `PgvectorStore` + `LocalTransformerEmbedder` +
  // `OpenAILLM` wiring across CLI/MCP/REST.
  const memory = await wireMemoryFromPool(pool);

  const server = new McpServer({
    name: 'themory',
    version: '0.3.0',
    memoryFactory: () => memory,
  });

  const shutdownHandler = (): void => {
    void (async (): Promise<void> => {
      try {
        await Promise.race([
          server.stop(),
          new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS)),
        ]);
      } finally {
        process.exit(0);
      }
    })();
  };

  process.on('SIGTERM', shutdownHandler);
  process.on('SIGINT', shutdownHandler);

  if (transport === 'streamable-http') {
    const bearerAuth = await resolveBearerAuth(authMode, pool, {
      ...(options?.issuer !== undefined ? { issuer: options.issuer } : {}),
      ...(options?.clientId !== undefined ? { clientId: options.clientId } : {}),
      host,
      port,
    });
    await connectStreamableHttp(server, {
      port,
      host,
      ...(bearerAuth !== undefined ? { bearerAuth } : {}),
    });
  } else {
    await connectStdio(server);
  }
}

/**
 * T4.1 + T3.2 (fixes-cycle-1) — translate the `--auth` CLI mode into a
 * `BearerAuthOptions` bag consumed by `connectStreamableHttp`. Returns
 * `undefined` when auth is `none` OR unset.
 *
 * fixes-cycle-1: OIDC adapter is now plumbed (was stderr-disclosure-only
 * in parent cycle). When mode = `oidc` OR `both`, constructs the
 * production `OidcAuthVerifier` via `createOauth4webapiIntrospect` using
 * the resolved issuer/clientId/clientSecret. Hard-fails when mode = `oidc`
 * is selected without --issuer (Inquebrável Rule 8 fail-loud).
 */
async function resolveBearerAuth(
  mode: RunMcpServerOptions['auth'],
  pool: Pool,
  oidcInput: { issuer?: string; clientId?: string; host: string; port: number },
): Promise<BearerAuthOptions | undefined> {
  if (mode === undefined || mode === 'none') return undefined;

  // F-arch-2 fix — only invoke resolveOidcConfig when OIDC mode is actually
  // selected. Pre-fix: resolveOidcConfig fired for `--auth=api-keys` too,
  // crashing on stale `THEMORY_OIDC_ISSUER` env vars from prior debug
  // sessions even though the operator explicitly chose api-keys-only.
  const wantsOidc = mode === 'oidc' || mode === 'both';
  const oidcCfg = wantsOidc ? resolveOidcConfig(oidcInput) : null;

  if (wantsOidc && oidcCfg === null) {
    throw new Error(
      `themory mcp: --auth=${mode} requires --issuer (or THEMORY_OIDC_ISSUER env)`,
    );
  }

  const apiKey = (mode === 'api-keys' || mode === 'both') ? new ApiKeyAuthVerifier(pool) : undefined;
  let oidc;
  if (oidcCfg !== null) {
    const introspect = await createOauth4webapiIntrospect({
      issuer: oidcCfg.issuer,
      clientId: oidcCfg.clientId,
      clientSecret: oidcCfg.clientSecret,
    });
    oidc = new OidcAuthVerifier({ introspect });
  }

  return {
    ...(apiKey !== undefined ? { apiKey } : {}),
    ...(oidc !== undefined ? { oidc } : {}),
  };
}
