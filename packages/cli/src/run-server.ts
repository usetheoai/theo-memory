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
  tenantScopedPool,
  assertBackgroundPoolCrossWorkspace,
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

import { resolvePgUri } from './resolve-pg-uri.js';
import { resolveWorkerPgUri } from './resolve-worker-pg-uri.js';
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
  // M25 T3.2 — resolve the DB URI through the layered config resolver (real
  // consumer / wiring triad). assertEnvOrExit above already guarantees the env
  // var is present, and env outranks any file (ADR-2), so an env-only boot is
  // byte-identical to the pre-M25 behavior; a `.themory.json` value is honored
  // only when env is unset. The `??` keeps the exact previous value as a
  // defense-in-depth fallback should resolution ever return undefined.
  const pgUri = resolvePgUri() ?? process.env['THEOMEM_PG_URI']!;

  const port = resolvePort(options?.port);
  const host = resolveHost(options?.host);

  // Embedder selection (THEOMEM_EMBEDDER): local (Xenova 384) | openai (1536).
  // Migration dim MUST match the embedder; resolve once and reuse.
  const embedderKind = resolveEmbedderKind();
  const embedderDim = embeddingDimForKind(embedderKind);

  // Two views of one pool, and the split is the point.
  //
  // `rawPool` is used for schema migrations and liveness probes — work that has
  // no tenant and must not pretend to have one.
  //
  // `pool` is the workspace-scoped view every store receives: each connection it
  // hands out carries `app.workspace_id` from the request scope, which is what
  // the fail-closed policies in migration 0029 read. Stores are unchanged; they
  // still just receive "a Pool".
  //
  // Handing the raw pool to a store would silently disable tenant isolation for
  // that store alone — the failure mode this whole change exists to remove — so
  // the raw handle is deliberately named apart and used in exactly two places.
  // Pool bounds are DECLARED, never inherited.
  //
  // node-postgres defaults to an unbounded connection lifetime: a client taken once
  // is reused until it errors. Against a managed Postgres that fails over, or a proxy
  // that recycles behind the scenes, the pool keeps handing out connections to a
  // server that is no longer there — and the symptom is a slow trickle of failed
  // queries rather than a restart anyone would notice. `maxLifetimeSeconds` retires
  // each client on a schedule instead.
  //
  // Absent configuration is worse than a wrong value: a wrong one is visible in a
  // diff and arguable, an absent one is invisible and inherited from whatever the
  // library ships next.
  const rawPool = new Pool({
    connectionString: pgUri,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    maxLifetimeSeconds: 3_600,
  });
  const pool = tenantScopedPool(rawPool);

  // ADR D8 — migrate-on-startup BEFORE port binds. Runs on the RAW pool: DDL has
  // no workspace, and the scoped pool would (correctly) refuse for lack of scope.
  if (!shouldSkipMigrations()) {
    try {
      await runMigrations(rawPool, { embeddingDim: embedderDim });
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
  // Raw pool: a liveness probe has no workspace, and the scoped pool would
  // (correctly) refuse rather than invent one.
  const dbProbe = async (): Promise<void> => {
    await rawPool.query('SELECT 1');
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
  // Both of these run BEFORE the workspace scope exists, so both take the RAW
  // pool — the scoped one would (correctly) refuse for lack of a scope.
  //
  //   * Credential resolution is what DISCOVERS the workspace. Scoping it would
  //     be circular: you would need the workspace to read the row that says
  //     which workspace the key belongs to.
  //   * The admin sub-app mounts ahead of bearerAuth by design (it resolves
  //     theo_live_* keys through its own lookup), so no scope is bound yet.
  const adminApi = bootstrapToken !== undefined
    ? { pool: rawPool, bootstrapToken }
    : undefined;
  // When admin path active without OIDC, swap to ApiKeyAuthVerifier so
  // theo_live_* keys auth via SHA-256 lookup against theo_api_keys.
  if (adminApi !== undefined && oidcCfg === null) {
    authVerifier = new ApiKeyAuthVerifier(rawPool);
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
  //
  // Retention prunes traces across EVERY workspace, so it cannot run on the
  // scoped pool — there is no single workspace to scope it to. It also cannot
  // run on the raw application pool: migration 0029 is fail-closed, so over that
  // connection the DELETE matches nothing, commits, and reports success. The
  // cron keeps "succeeding" while the table grows forever.
  //
  // So it gets its own pool, on `themory_worker`, and the reach is ASSERTED
  // before the first tick. The assertion refuses two connections for opposite
  // reasons: one that cannot cross workspaces (silent no-op) and one that
  // crosses via BYPASSRLS (silent bypass, invisible in pg_policies). Booting
  // without it is what turned a broken job into an invisible one.
  let workerPool: Pool | undefined;
  let retentionCron: { stop: () => Promise<void> } | undefined;
  if (resolveRecallTraceEnabled()) {
    const workerUri = resolveWorkerPgUri() ?? process.env['THEOMEM_WORKER_PG_URI'];
    if (workerUri === undefined || workerUri.length === 0) {
      process.stderr.write(
        'themory server: recall-trace retention is enabled but THEOMEM_WORKER_PG_URI is unset. ' +
          'The sweep spans every workspace; over the application connection the fail-closed ' +
          'policies of migration 0029 would make it delete zero rows and report success. ' +
          'Point THEOMEM_WORKER_PG_URI at the themory_worker role, or unset THEOMEM_RECALL_TRACE.\n',
      );
      process.exit(1);
      return;
    }
    workerPool = new Pool({
      connectionString: workerUri,
      // Small on purpose: one cron tick at a time. Same declared lifetime as the
      // request pool — an inherited default is invisible, a wrong value is not.
      max: 2,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      maxLifetimeSeconds: 3_600,
    });
    try {
      const reach = await assertBackgroundPoolCrossWorkspace(workerPool, 'recall_traces');
      process.stderr.write(
        `themory server: recall-trace retention crosses workspaces as "${reach.role}" ` +
          `via policy "${reach.policy}".\n`,
      );
    } catch (err) {
      process.stderr.write(
        `themory server: refusing to start recall-trace retention — ${err instanceof Error ? err.message : String(err)}\n`,
      );
      await workerPool.end().catch(() => undefined);
      process.exit(1);
      return;
    }
    retentionCron = startRecallTraceRetentionCron(new PgRecallTraceRetention(workerPool), {
      maxAgeSeconds: resolveRecallTraceMaxAgeSeconds(),
    });
  }

  const listener = serve({ fetch: app.fetch, port, hostname: host }, (info: { port: number }) => {
    process.stdout.write(`themory server: listening on ${host}:${String(info.port)}\n`);
  }) as unknown as ServerListenerLike;

  // Listener error handler + idempotent graceful shutdown (SIGTERM/SIGINT) live in
  // the lifecycle helper; it drains the retention cron before closing the pool (FX5).
  installServerLifecycle({
    listener,
    port,
    pool: rawPool,
    ...(retentionCron !== undefined ? { retentionCron } : {}),
    ...(workerPool !== undefined ? { workerPool } : {}),
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
