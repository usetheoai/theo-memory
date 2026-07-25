/**
 * REST server composition root for `themory server` (Roadmap Item 16-18).
 *
 * The composition root (ADR D8 + architecture.md § 3): imports both the REST surface and the pg
 * pool + Memory factory; the REST layer itself stays pg-free. Migrate-on-startup runs BEFORE the
 * port binds (skipped only when `THEMEMORY_SKIP_MIGRATIONS === 'true'`). Absorbs EC-31 (EADDRINUSE
 * → exit 1), EC-32 (SIGTERM/SIGINT idempotent graceful shutdown), and EC-33 (readiness gate: the
 * port binds eagerly while the Memory factory warms; `/v1/health` answers 503 `warming_up` until
 * ready). Env-fail is a hard boundary (fail-closed; never a silent stub fallback).
 *
 * @see Plan theo-memory-standalone-p0 § T2.3 + ADR D8 + EC-31/32/33 + EC-47
 */
import { serve } from '@hono/node-server';
import {
  runMigrations,
  PgMemoryEntityStore,
  PgMemoryGraphStore,
  PgUsageCounterStore,
  PgRoutingPolicyStore,
  PgRoutingAuditStore,
} from '@usetheo/memory';
import type { AuthVerifier } from '@usetheo/memory/contract';
import type { Memory } from '@usetheo/memory/contract';
import {
  PgRecallTraceStore,
  PgRecallTraceRetention,
  startRecallTraceRetentionCron,
} from '@usetheo/memory/recall-trace-pg';
import {
  assertEnvOrExit,
  embeddingDimForKind,
  resolveEmbedderKind,
  resolveRecallTraceEnabled,
  resolveRecallTraceMaxAgeSeconds,
  OPENAI_API_KEY_ENV_SPEC,
  PG_URI_ENV_SPEC,
  wireMemoryFromPool,
} from '@usetheo/memory-agent-core';
import { resolveBootstrapToken, resolveOidcConfig } from '@usetheo/memory-agent-core';
import { ApiKeyAuthVerifier } from '@usetheo/memory-api';
import { BearerAuthVerifier, readApiKey } from '@usetheo/memory-api';
import { createOauth4webapiIntrospect } from '@usetheo/memory-api';
import { OidcAuthVerifier } from '@usetheo/memory-api';
import { createServer, parseRequireCredentialEnv } from '@usetheo/memory-api';
import { Pool } from 'pg';

import { installServerLifecycle, type ServerListenerLike } from './server-lifecycle.js';
import { assertDistNotStale } from './stale-dist-guard.js';

// fix-cycle-2 hotfix M2: LOCAL_EMBEDDER_DIM imported from agent-tools-memory.ts
// (single source of truth — was triplicated across CLI factory + 2 runners).

const SHUTDOWN_TIMEOUT_MS = 5_000;

export interface RunServerOptions {
  readonly port?: number;
  readonly host?: string;
  /**
   * T3.2 + ADR D2 + EC-5 — OIDC issuer URL (RFC 8414 discovery target).
   * When supplied (CLI flag OR env `THEMORY_OIDC_ISSUER`), constructs
   * `OidcAuthVerifier` + propagates `oidcDiscovery` to `createServer`.
   */
  readonly issuer?: string;
  /**
   * T3.2 + EC-6 — OIDC client_id (registered with the issuer for
   * client_secret_basic auth on the introspection endpoint). Required when
   * `issuer` is set. CLI flag OR env `THEMORY_OIDC_CLIENT_ID`. Secret is
   * env-only per ADR D4 (`THEMORY_OIDC_CLIENT_SECRET`).
   */
  readonly clientId?: string;
}

function resolvePort(opt?: number): number {
  if (opt !== undefined) {
    if (!Number.isInteger(opt) || opt <= 0 || opt > 65_535) {
      throw new Error(`Invalid port: ${String(opt)} (must be an integer in 1..65535).`);
    }
    return opt;
  }
  const envRaw = process.env['PORT'];
  const envPort = envRaw === undefined ? 8080 : Number.parseInt(envRaw, 10);
  if (!Number.isInteger(envPort) || envPort <= 0 || envPort > 65_535) {
    throw new Error(`Invalid port from PORT env: ${String(envRaw)} (must be an integer in 1..65535).`);
  }
  return envPort;
}

function resolveHost(opt?: string): string {
  return opt ?? process.env['HOST'] ?? '0.0.0.0';
}

function shouldSkipMigrations(): boolean {
  // Positive opt-in per SEPA iter 11 CRITICAL Q6a: ONLY `=== 'true'` skips.
  // Fail-safe default is to run migrations.
  return process.env['THEMEMORY_SKIP_MIGRATIONS'] === 'true';
}

export async function runServer(options?: RunServerOptions): Promise<void> {
  // M20 (#118): fail FAST before anything else if the running dist/ is older than src/ (dev
  // host-run) — a stale build silently serves pre-build code. No-op for a published package.
  assertDistNotStale();
  // Env-fail boundary via the shared `assertEnvOrExit` helper (single source of the
  // THEOMEM_PG_URI / OPENAI_API_KEY stderr strings). Fail-closed; never silent stub fallback.
  assertEnvOrExit([PG_URI_ENV_SPEC, OPENAI_API_KEY_ENV_SPEC]);
  const pgUri = process.env['THEOMEM_PG_URI']!;

  const port = resolvePort(options?.port);
  const host = resolveHost(options?.host);

  // Embedder selection (THEOMEM_EMBEDDER): local (Xenova 384) | openai (1536).
  // Migration dim MUST match the embedder; resolve once and reuse.
  const embedderKind = resolveEmbedderKind();
  const embedderDim = embeddingDimForKind(embedderKind);

  const pool = new Pool({ connectionString: pgUri });

  // ADR D8 — migrate-on-startup BEFORE port binds.
  if (!shouldSkipMigrations()) {
    try {
      await runMigrations(pool, { embeddingDim: embedderDim });
    } catch (err) {
      process.stderr.write(
        `themory server: migrations failed (${err instanceof Error ? err.message : String(err)})\n`,
      );
      process.exit(1);
      return;
    }
  }

  const embedderLabel =
    embedderKind === 'openai'
      ? `OpenAIEmbedder (text-embedding-3-small, dim=${String(embedderDim)})`
      : `LocalTransformerEmbedder (Xenova MiniLM, dim=${String(embedderDim)})`;
  process.stderr.write(
    `themory server: real providers wired — ${embedderLabel} + OpenAILLM via OPENAI_BASE_URL.\n`,
  );

  // EC-33 readiness gate — bind port EAGERLY; warm Memory factory async so
  // /v1/health observes the 503-then-200 transition. Without async kickoff,
  // the factory resolves before any HTTP probe could land and the gate
  // would be unobservable.
  let isReady = false;
  let memory: Memory | undefined;
  // verbs-as-cli-fixes-cycle-2 T3.1 / ADR D4 retrofit (closes M1): provider
  // tuple composition delegated to shared `wireMemoryFromPool` helper INSIDE
  // the warm Promise — preserves the EC-33 readiness-Proxy lifecycle exactly
  // (memory assignment happens at the same `await` point; flag flip
  // unchanged).
  const warmPromise = (async () => {
    memory = await wireMemoryFromPool(pool);
    isReady = true;
  })();

  // dbProbe closure — thin (no timeout); healthDbHandler owns the 2s race.
  const dbProbe = async (): Promise<void> => {
    await pool.query('SELECT 1');
  };

  const apiKey = readApiKey();
  const envVerifier: AuthVerifier | undefined =
    apiKey !== undefined ? new BearerAuthVerifier(apiKey) : undefined;

  // F-arch-2 fix — OIDC ONLY resolves when operator explicitly opts in via
  // `--issuer` flag OR `THEMORY_OIDC_ISSUER` env (the resolver itself reads
  // env as fallback). Without explicit OIDC intent, skip the resolver entirely
  // so stale OIDC env vars from prior debug sessions don't crash boot.
  // Per F-arch-2 (review fixes-cycle-1): resolveOidcConfig fired unconditionally
  // before, causing `themory server` (no flags) + stale env to throw EC-5/EC-6.
  const oidcIntent = options?.issuer !== undefined || process.env['THEMORY_OIDC_ISSUER'] !== undefined;
  const oidcCfg = oidcIntent
    ? resolveOidcConfig({
        ...(options?.issuer !== undefined ? { issuer: options.issuer } : {}),
        ...(options?.clientId !== undefined ? { clientId: options.clientId } : {}),
        host,
        port,
      })
    : null;
  let authVerifier: AuthVerifier | undefined = envVerifier;
  let oidcDiscovery: Parameters<typeof createServer>[0]['oidcDiscovery'];
  if (oidcCfg !== null) {
    const introspect = await createOauth4webapiIntrospect({
      issuer: oidcCfg.issuer,
      clientId: oidcCfg.clientId,
      clientSecret: oidcCfg.clientSecret,
    });
    authVerifier = new OidcAuthVerifier({ introspect });
    oidcDiscovery = oidcCfg.oidcDiscovery;
  }

  // F-arch-1 fix — admin sub-app composition is EXPLICIT opt-in per ADR D1.
  // Mounts ONLY when operator supplied THEMORY_ADMIN_BOOTSTRAP_TOKEN (the
  // canonical bootstrap path). Pre-fix: also auto-mounted when THEMEMORY_API_KEY
  // was set, which violated ADR D1's "ONLY when adminApi supplied" contract
  // and silently flipped behavior for env-secret-only deployments (the
  // generic /v1/* still answers correctly; /v1/admin/* would previously 404
  // and now answers 401 SCOPE_INSUFFICIENT — same net rejection but
  // different envelope, breaks the contract).
  const bootstrapToken = resolveBootstrapToken();
  const adminApi = bootstrapToken !== undefined
    ? { pool, bootstrapToken }
    : undefined;
  // When admin path active without OIDC, swap to ApiKeyAuthVerifier so
  // theo_live_* keys auth via SHA-256 lookup against theo_api_keys.
  if (adminApi !== undefined && oidcCfg === null) {
    authVerifier = new ApiKeyAuthVerifier(pool);
  }

  // Memory is injected via a small shim that surfaces an honest error if
  // a verb handler fires before the factory resolves. The 503-readiness
  // gate at /v1/health should prevent the orchestrator from routing user
  // traffic during that window; this shim is the defense-in-depth.
  const memoryShim = new Proxy({} as Memory, {
    get(_target, prop) {
      if (memory === undefined) {
        throw new Error(
          'Memory not ready: server is still warming up. Poll GET /v1/health until 200 before sending verb traffic.',
        );
      }
      return Reflect.get(memory, prop) as unknown;
    },
  });

  const app = createServer({
    memory: memoryShim,
    // Model B (ADR D4): fail-closed multi-tenant mode opt-in via env. The TheoCloud
    // gateway deployment sets THEMEMORY_REQUIRE_CREDENTIAL=true so a misconfigured
    // (no-credential) boot rejects rather than collapsing to the shared default workspace.
    requireCredential: parseRequireCredentialEnv(process.env['THEMEMORY_REQUIRE_CREDENTIAL']),
    ...(authVerifier !== undefined ? { authVerifier } : {}),
    ...(oidcDiscovery !== undefined ? { oidcDiscovery } : {}),
    ...(adminApi !== undefined ? { adminApi } : {}),
    dbProbe,
    readinessProbe: () => isReady,
    // F-M1 (/review): wire the entities read port so GET /v1/scopes/:type/:id/entities
    // serves REAL extracted entities (not the attributed_to fallback) in production.
    // Shares the same pool the Memory factory uses; closes the slice's goal loop.
    memoryEntityStore: new PgMemoryEntityStore(pool),
    // slice2 T3.2 — wire the edges read port so GET /v1/scopes/:type/:id/graph
    // serves REAL relation edges in production (mirrors the entity-port F-M1 fix).
    memoryGraphStore: new PgMemoryGraphStore(pool),
    // T2.4 — wire the recall-counter read port so GET /v1/scopes/:type/:id/metrics
    // serves the REAL retrieval_api_usage (same pool as the Memory factory, so the
    // counter recall() increments is the counter metrics reads). Mirrors the above.
    usageCounterStore: new PgUsageCounterStore(pool),
    // M11 T3.1 — wire the routing-governance ports so GET/PUT /v1/routing-policy +
    // GET /v1/routing-audit are mounted in production (same pool). Mirrors the above.
    routingPolicyStore: new PgRoutingPolicyStore(pool),
    routingAuditStore: new PgRoutingAuditStore(pool),
    // explainable-recall-read S2 (/review F-arch-1) — wire the recall-trace READ
    // port so GET /v1/recall-traces/:recallId is mounted in production, opt-in via
    // the same THEOMEM_RECALL_TRACE flag that enables the write (wireMemoryFromPool).
    ...(resolveRecallTraceEnabled() ? { recallTraceStore: new PgRecallTraceStore(pool) } : {}),
  });

  // M4 T3.1 — start the recall-trace retention cron under the same opt-in flag.
  // maxAge from THEOMEM_RECALL_TRACE_MAX_AGE_SECONDS (validated: fail-fast on a
  // non-positive/non-finite value — FX2 /review M4-R2 — never a silent full-wipe).
  const retentionCron = resolveRecallTraceEnabled()
    ? startRecallTraceRetentionCron(new PgRecallTraceRetention(pool), {
        maxAgeSeconds: resolveRecallTraceMaxAgeSeconds(),
      })
    : undefined;

  const listener = serve({ fetch: app.fetch, port, hostname: host }, (info: { port: number }) => {
    process.stdout.write(`themory server: listening on ${host}:${String(info.port)}\n`);
  }) as unknown as ServerListenerLike;

  // Listener error handler + idempotent graceful shutdown (SIGTERM/SIGINT) live in
  // the lifecycle helper; it drains the retention cron before closing the pool (FX5).
  installServerLifecycle({
    listener,
    port,
    pool,
    ...(retentionCron !== undefined ? { retentionCron } : {}),
    shutdownTimeoutMs: SHUTDOWN_TIMEOUT_MS,
  });

  // Let the warm Promise surface its rejection (if any) to the loop so the
  // process exits non-zero on Memory bootstrap failure.
  warmPromise.catch((err: unknown) => {
    process.stderr.write(
      `themory server: Memory factory failed to warm (${err instanceof Error ? err.message : String(err)})\n`,
    );
    process.exit(1);
  });
  // In tests (mocked factory resolves synchronously inside microtasks), the
  // warm promise completes before this function returns — let runServer
  // await it so the EC-33 test can deterministically observe both states.
  await warmPromise.catch(() => undefined);
}
