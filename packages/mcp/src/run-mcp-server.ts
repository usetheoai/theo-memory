/**
 * MCP server composition root — extracted from cli.ts at T2.1 so the CLI
 * router (commander) can keep packages/cli/src/cli.ts thin (≤200 LoC budget
 * per plan T2.1 + SRP). Pre-T2.1, this body lived inline in `cli.ts::main()`;
 * the existing v0.3 EC-7 behavior (env-var hard-fail + dual SIGINT/SIGTERM
 * handlers + 5s shutdown timeout) is preserved verbatim. Only the call site
 * changed (now invoked via `themory mcp` OR the `themory-mcp` alias).
 *
 * Composition root (DIP-allowed): this file wires src/local/ (pgvector +
 * LocalTransformerEmbedder + OpenAILLM real providers) into the
 * agent-tools McpServer. Library layer `packages/cli/src/index.ts` does
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
import { trace } from '@opentelemetry/api';
import { runMigrations, PgMemoryEntityStore, requireStrictWorkspaceWrites } from '@usetheo/memory';
import { PgRecallTraceStore } from '@usetheo/memory/recall-trace-pg';
import {
  assertEnvOrExit,
  embeddingDimForKind,
  resolveEmbedderKind,
  resolveRecallTraceEnabled,
  OPENAI_API_KEY_ENV_SPEC,
  PG_URI_ENV_SPEC,
  wireMemoryFromPool,
} from '@usetheo/memory-agent-core';
import { Pool } from 'pg';

import { createJwtAccessTokenVerifier, loadResourceServerConfig } from './auth/oauth-resource-server.js';
import type { ResourceServerConfig } from './auth/oauth-resource-server.js';
import { McpServer } from './server.js';
import { openTenantScopedPools } from './tenant-pool.js';
import { connectSse } from './transports/sse.js';
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
  /**
   * OpenMemory MCP-shape compatibility mode (Roadmap Item 26). When
   * `'openmemory'` (CLI `--compat openmemory` OR env `THEOMEM_MCP_COMPAT=openmemory`),
   * the server exposes the OpenMemory tool surface over an SSE endpoint
   * (`/{client}/sse/{user}`, default port 8765) — a drop-in for OpenMemory-wired
   * MCP clients. Overrides `transport` (forces SSE).
   */
  readonly compat?: 'openmemory';
  readonly port?: number;
  readonly host?: string;
  /**
   * Auth mode for the streamable-http transport (usetheoai/theo#477).
   *
   * - `none`: no auth, single-tenant over the raw pool — only for localhost dev loops.
   * - `oauth`: OAuth 2.1 resource server. Every request carries an RS256 access token from
   *   `THEO_OAUTH_ISSUER` whose audience is `THEO_MCP_RESOURCE`; its `tenant_id` scopes the
   *   request, and the stores run over the tenant-scoped pool.
   *
   * `api-keys`, `oidc` and `both` were REMOVED from this transport, with no compatibility
   * path; selecting one is refused rather than silently downgraded to `none`.
   * stdio ignores this field per ADR-0015 #1.
   */
  readonly auth?: McpAuthMode;
  /**
   * ADR-0015 #3 — TLS material (PEM strings) for the streamable-http listener.
   * Read from disk by the CLI `--tls-cert`/`--tls-key` flags. Required for any
   * non-localhost host; passed straight through to `connectStreamableHttp`.
   */
  readonly tls?: { readonly cert: string; readonly key: string };
}

/** Auth modes the streamable-http transport accepts. */
export type McpAuthMode = 'none' | 'oauth';

/** Modes that existed before usetheoai/theo#477 and were removed, not renamed. */
const REMOVED_AUTH_MODES = new Set(['api-keys', 'oidc', 'both']);

function removedAuthMode(mode: string, source: string): Error {
  return new Error(
    `themory mcp: auth mode "${mode}" (${source}) was removed from the MCP transport — API keys and ` +
      'token introspection are no longer accepted there. Use --auth oauth with THEO_MCP_RESOURCE and ' +
      'THEO_OAUTH_ISSUER (usetheoai/theo#477).',
  );
}

/** True when `THEO_MCP_RESOURCE` is set to something other than whitespace. */
function hasResourceEnv(): boolean {
  const value = process.env['THEO_MCP_RESOURCE'];
  return value !== undefined && value.trim() !== '';
}

/**
 * Resolve MCP transport via 3-tier precedence + stdio fallback:
 * (1) `opt` flag (most-specific operator intent)
 * (2) `THEOMEM_MCP_TRANSPORT` env (explicit config)
 * (3) `THEO_MCP_RESOURCE` presence — a server that has a resource URI is a network server
 * Fallback: `'stdio'` (embedded subprocess use case, Claude Code etc.)
 *
 * `THEMEMORY_API_KEY` used to be tier 3. API keys are no longer accepted by this transport,
 * so their presence says nothing about how it should listen.
 */
function resolveTransport(opt?: RunMcpServerOptions['transport']): 'stdio' | 'streamable-http' {
  if (opt !== undefined) return opt;
  const envValue = process.env['THEOMEM_MCP_TRANSPORT'];
  if (envValue === 'streamable-http' || envValue === 'stdio') return envValue;
  if (hasResourceEnv()) return 'streamable-http';
  return 'stdio';
}

/**
 * Resolve MCP auth mode via 3-tier precedence + safe-default fallback:
 * (1) `opt` flag
 * (2) `THEOMEM_MCP_AUTH` env
 * (3) `THEO_MCP_RESOURCE` presence on the streamable-http transport → `'oauth'`
 * Fallback: `'none'`.
 *
 * A removed mode (`api-keys`, `oidc`, `both`) from either source THROWS. Falling through to
 * `none` would turn an operator's leftover configuration into an unauthenticated listener.
 */
function resolveAuthMode(opt: RunMcpServerOptions['auth'], transport: 'stdio' | 'streamable-http'): McpAuthMode {
  if (opt !== undefined) {
    if (REMOVED_AUTH_MODES.has(opt)) throw removedAuthMode(opt, '--auth');
    return opt;
  }
  const envValue = process.env['THEOMEM_MCP_AUTH'];
  if (envValue !== undefined && REMOVED_AUTH_MODES.has(envValue)) {
    throw removedAuthMode(envValue, 'THEOMEM_MCP_AUTH');
  }
  if (envValue === 'none' || envValue === 'oauth') return envValue;
  if (transport === 'streamable-http' && hasResourceEnv()) return 'oauth';
  return 'none';
}

/**
 * `THEO_MCP_TLS_TERMINATED_UPSTREAM`: `true` declares that the gateway or mesh in front
 * terminates TLS. Anything but `true`, `false` or unset is refused — a typo must not decide
 * whether a listener speaks TLS.
 */
function resolveTlsTerminatedUpstream(): boolean {
  const raw = process.env['THEO_MCP_TLS_TERMINATED_UPSTREAM']?.trim();
  if (raw === undefined || raw === '' || raw === 'false') return false;
  if (raw === 'true') return true;
  throw new Error(`themory mcp: THEO_MCP_TLS_TERMINATED_UPSTREAM="${raw}" must be "true" or "false".`);
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
 * `packages/cli/src/index.ts` (verified at T4.1 step 2).
 * @see EC-2 — single-export discipline
 */
export function resolveMcpModes(
  opt: Pick<RunMcpServerOptions, 'transport' | 'auth'>,
): { transport: 'stdio' | 'streamable-http'; auth: McpAuthMode } {
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

/**
 * Resolve OpenMemory compat mode: CLI flag (Tier-1) OR `THEOMEM_MCP_COMPAT` env
 * (Tier-2). Any value other than `'openmemory'` resolves to `undefined` (native).
 */
export function resolveCompat(opt?: RunMcpServerOptions['compat']): 'openmemory' | undefined {
  if (opt === 'openmemory') return 'openmemory';
  if (process.env['THEOMEM_MCP_COMPAT'] === 'openmemory') return 'openmemory';
  return undefined;
}

/**
 * Compat (SSE) port: CLI flag → THEOMEM_MCP_HTTP_PORT → OpenMemory default 8765.
 *
 * @internal — exported for unit testing the 8765 default + env/flag precedence;
 * NOT re-exported from `packages/cli/src/index.ts`.
 */
export function resolveCompatPort(opt?: number): number {
  if (opt !== undefined) return resolvePort(opt);
  const envRaw = process.env['THEOMEM_MCP_HTTP_PORT'];
  if (envRaw === undefined) return 8765;
  return resolvePort(Number.parseInt(envRaw, 10));
}

/**
 * Installs SIGTERM/SIGINT handlers that run `teardown` under a grace window.
 *
 * The race guard is load-bearing: one wedged session's `stop()` must never block
 * process exit past the window, or Docker/k8s escalates to SIGKILL and in-flight
 * work is cut anyway. `teardown` is a thunk because what must be torn down is only
 * known after the transport is wired.
 */
function installShutdown(teardown: () => Promise<void>): void {
  const handler = (): void => {
    void (async (): Promise<void> => {
      try {
        await Promise.race([
          teardown(),
          new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS)),
        ]);
      } finally {
        process.exit(0);
      }
    })();
  };
  process.on('SIGTERM', handler);
  process.on('SIGINT', handler);
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

  const compat = resolveCompat(options?.compat);
  const { transport, auth: authMode } = resolveMcpModes(options ?? {});
  // Validate port eagerly so an invalid CLI flag fails BEFORE we touch pg —
  // avoids leaking a connection pool when the operator typo'd the port.
  const port = transport === 'streamable-http' ? resolvePort(options?.port) : 0;
  const host = transport === 'streamable-http' ? resolveHost(options?.host) : '';

  // The OAuth path's configuration is read and validated BEFORE any pool exists: a missing
  // resource URI or issuer must cost nothing to discover (usetheoai/theo#477).
  const oauthMode = compat === undefined && transport === 'streamable-http' && authMode === 'oauth';
  const oauthConfig: ResourceServerConfig | undefined = oauthMode ? loadResourceServerConfig() : undefined;
  const tlsTerminatedUpstream = oauthMode ? resolveTlsTerminatedUpstream() : false;

  // Embedder selection (THEOMEM_EMBEDDER): local (Xenova 384) | openai (1536).
  // The migration dim MUST match the embedder; resolve once and reuse.
  const embedderKind = resolveEmbedderKind();
  const embedderDim = embeddingDimForKind(embedderKind);

  // Two database postures. The OAuth path serves many tenants, so it holds the REST bar:
  // a role subject to row-level security, the tenant-scoped pool, migrations on the owner
  // connection. Every other path (stdio, OpenMemory compat, unauthenticated localhost HTTP)
  // is single-tenant by construction and keeps the raw pool — writes land in `default`.
  let pool: Pool;
  if (oauthMode) {
    const migratePgUri = nonEmptyEnv('THEOMEM_MIGRATE_PG_URI');
    const pools = await openTenantScopedPools({
      pgUri,
      ...(migratePgUri !== undefined ? { migratePgUri } : {}),
      skipMigrations: process.env['THEMEMORY_SKIP_MIGRATIONS'] === 'true',
      embeddingDim: embedderDim,
    });
    process.stderr.write(
      `themory mcp: request connection contained by row-level security (role "${pools.role}").\n`,
    );
    pool = pools.pool;
  } else {
    pool = new Pool({ connectionString: pgUri });
    await runMigrations(pool, { embeddingDim: embedderDim });
  }

  const embedderLabel =
    embedderKind === 'openai'
      ? `OpenAIEmbedder (text-embedding-3-small, dim=${String(embedderDim)})`
      : `LocalTransformerEmbedder (Xenova MiniLM, dim=${String(embedderDim)})`;
  process.stderr.write(
    `themory mcp: real providers wired — ${embedderLabel} + OpenAILLM via OPENAI_BASE_URL.\n`,
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
    envAuth === 'none' || envAuth === 'oauth';
  const quiet = process.env['THEOMEM_MCP_QUIET'] === '1';
  if (compat === undefined && !wasExplicit && !quiet) {
    if (transport === 'streamable-http' && authMode === 'oauth') {
      process.stderr.write(
        'themory mcp: transport=streamable-http + auth=oauth (THEO_MCP_RESOURCE present; pass --transport=stdio to override).\n',
      );
    } else if (transport === 'stdio') {
      process.stderr.write(
        'themory mcp: transport=stdio (default; set THEO_MCP_RESOURCE for the OAuth-protected HTTP transport).\n',
      );
    }
  }

  // verbs-as-cli-fixes-cycle-2 T3.1 / ADR D4 retrofit (closes M1): provider
  // tuple composition delegated to shared `wireMemoryFromPool` helper. Single
  // source of truth for `PgvectorStore` + `LocalTransformerEmbedder` +
  // `OpenAILLM` wiring across CLI/MCP/REST.
  const memory = await wireMemoryFromPool(pool);
  // The confirmation, not the hope: if anything handed the stores a raw pool on the OAuth
  // path, writes without a workspace scope would fall back to `default`. Refuse to start.
  if (oauthMode) requireStrictWorkspaceWrites();

  // OpenMemory compat (Roadmap Item 26): expose the OpenMemory tool surface over
  // SSE so OpenMemory-wired MCP clients connect unchanged. A fresh McpServer per
  // connection (SDK Server is 1:1 with a transport); scope is path-derived.
  if (compat === 'openmemory') {
    const compatPort = resolveCompatPort(options?.port);
    const compatHost = resolveHost(options?.host);
    process.stderr.write(
      `themory mcp: compat=openmemory transport=sse on http://${compatHost}:${String(compatPort)}/{client}/sse/{user}\n`,
    );
    const handle = await connectSse({
      host: compatHost,
      port: compatPort,
      serverFactory: () =>
        new McpServer({ name: 'themory', version: '0.3.0', memoryFactory: () => memory, toolset: 'openmemory' }),
    });
    installShutdown(() => handle.close());
    return;
  }

  // A FACTORY, not a shared instance: the streamable-http transport builds one
  // McpServer per MCP session, because an McpServer binds a single transport at a
  // time. Reusing one instance is the M7 defect (second client rejected with
  // "Server already initialized"). Cheap to call — the expensive `memory` and
  // `pool` are captured, not rebuilt.
  const makeServer = (): McpServer =>
    new McpServer({
      name: 'themory',
      version: '0.3.0',
      memoryFactory: () => memory,
      // M4 — back explain_recall with the recall-trace store, opt-in under the same
      // THEOMEM_RECALL_TRACE posture as the SDK write + REST read.
      ...(resolveRecallTraceEnabled() ? { recallTraceStore: new PgRecallTraceStore(pool) } : {}),
      // M14 T2.2 — back list_entities with the entity read port (pool-backed). The tracer
      // makes delete_entities' `entity_forgotten` event observable (Princípio 3); it is the
      // OTel API no-op tracer unless an SDK exporter is configured, so this is always safe.
      memoryEntityStore: new PgMemoryEntityStore(pool, trace.getTracer('themory-memory-entity-store')),
    });

  // What SIGTERM must tear down differs per transport, and it is only known after
  // the transport is wired. stdio owns a single shared server; streamable-http owns
  // a listener plus every live session, reachable only through the returned handle.
  //
  // Getting this wrong is silent: pointing the shutdown at the stdio server while
  // serving HTTP stops an object that was never connected, leaves the listener open,
  // and cuts in-flight requests — on every container recreate.

  if (transport === 'streamable-http') {
    const handle = await connectStreamableHttp(makeServer, {
      port,
      host,
      ...(oauthConfig !== undefined
        ? { oauth: { config: oauthConfig, verifier: createJwtAccessTokenVerifier(oauthConfig) } }
        : {}),
      tlsTerminatedUpstream,
      ...(options?.tls !== undefined ? { tls: options.tls } : {}),
    });
    // The handle is the ONLY route to httpServer.close() + every live session's
    // server.stop(). Discarding it made SIGTERM a no-op that stopped a detached
    // server while the listener stayed open — on every container recreate.
    installShutdown(() => handle.close());
  } else {
    // stdio is single-client by construction, so one shared instance is correct —
    // and it is built ONLY here, so the HTTP path never allocates a server it does
    // not connect (the previous shape did, then pointed SIGTERM at that dead object).
    const server = makeServer();
    await connectStdio(server);
    installShutdown(() => server.stop());
  }
}

function nonEmptyEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value === undefined || value === '' ? undefined : value;
}
