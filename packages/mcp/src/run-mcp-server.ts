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
import { runMigrations, PgMemoryEntityStore } from '@usetheo/memory';
import { PgRecallTraceStore } from '@usetheo/memory/recall-trace-pg';
import {
  assertEnvOrExit,
  embeddingDimForKind,
  resolveEmbedderKind,
  resolveRecallTraceEnabled,
  OPENAI_API_KEY_ENV_SPEC,
  PG_URI_ENV_SPEC,
  wireMemoryFromPool,
  resolveOidcConfig,
} from '@usetheo/memory-agent-core';
import { ApiKeyAuthVerifier } from '@usetheo/memory-api';
import { createOauth4webapiIntrospect } from '@usetheo/memory-api';
import { OidcAuthVerifier } from '@usetheo/memory-api';
import { parseRequireCredentialEnv } from '@usetheo/memory-api';
import { Pool } from 'pg';

import type { BearerAuthOptions } from './auth/with-bearer-auth.js';
import { McpServer } from './server.js';
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
  /**
   * ADR-0015 #3 — TLS material (PEM strings) for the streamable-http listener.
   * Read from disk by the CLI `--tls-cert`/`--tls-key` flags. Required for any
   * non-localhost host; passed straight through to `connectStreamableHttp`.
   */
  readonly tls?: { readonly cert: string; readonly key: string };
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
 * `packages/cli/src/index.ts` (verified at T4.1 step 2).
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

  // Embedder selection (THEOMEM_EMBEDDER): local (Xenova 384) | openai (1536).
  // The migration dim MUST match the embedder; resolve once and reuse.
  const embedderKind = resolveEmbedderKind();
  const embedderDim = embeddingDimForKind(embedderKind);

  const pool = new Pool({ connectionString: pgUri });
  await runMigrations(pool, { embeddingDim: embedderDim });

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
    envAuth === 'none' || envAuth === 'api-keys' || envAuth === 'oidc' || envAuth === 'both';
  const quiet = process.env['THEOMEM_MCP_QUIET'] === '1';
  if (compat === undefined && !wasExplicit && !quiet) {
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
    const bearerAuth = await resolveBearerAuth(authMode, pool, {
      ...(options?.issuer !== undefined ? { issuer: options.issuer } : {}),
      ...(options?.clientId !== undefined ? { clientId: options.clientId } : {}),
      host,
      port,
    });
    const handle = await connectStreamableHttp(makeServer, {
      port,
      host,
      ...(bearerAuth !== undefined ? { bearerAuth } : {}),
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
/** Exported for M16 (#84) test: proves THEMEMORY_REQUIRE_CREDENTIAL reaches the bearer options. */
export async function resolveBearerAuth(
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

  // M16 (#84): thread the SAME fail-closed signal the REST surface reads
  // (`run-server.ts` → `parseRequireCredentialEnv`). Without this the OIDC branch's
  // fail-closed gate is inert in production — an OIDC token that resolves no tenant
  // would still collapse into the `default` workspace. Reusing the REST env var keeps
  // one tenancy signal, not two that must agree.
  const requireCredential = parseRequireCredentialEnv(process.env['THEMEMORY_REQUIRE_CREDENTIAL']);

  return {
    ...(apiKey !== undefined ? { apiKey } : {}),
    ...(oidc !== undefined ? { oidc } : {}),
    ...(requireCredential ? { requireCredential } : {}),
  };
}
