/**
 * Hono app composer (composition root). Constructs the `OpenAPIHono`, delegates
 * the cross-cutting middleware stage to {@link registerMiddleware} and the route
 * stage to {@link registerRoutes}, and ships the catch-all `app.onError` that
 * returns the sanitized structured envelope (EC-10, T1.6). The two stage modules
 * live under `./routes/` and preserve the exact load-bearing ordering
 * (middleware → auth-exempt → admin → bearer → members → data); see each for
 * the ordering rationale.
 *
 * @see Plan theo-memory-standalone-p0 § T1.2 + ADR D11 (DI factory shape)
 * @see Plan claude-code-memory-integration-plan § M6 T1.1 (SRP extraction)
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import type { Tracer } from '@opentelemetry/api';
import type { MemoryEvidenceReader, MemoryJobService } from '@usetheo/memory/contract';
import type { AuthVerifier } from '@usetheo/memory/contract';
import type { Memory } from '@usetheo/memory/contract';
import type { MemoryEntityStore, MemoryGraphStore } from '@usetheo/memory/contract';
import type { RecallTraceStore } from '@usetheo/memory/contract';
import type { UsageCounterStore } from '@usetheo/memory/contract';
import type { RoutingPolicyStore, RoutingAuditStore } from '@usetheo/memory/contract';

import type { AuthPool } from './auth/api-key-verifier.js';
import { mapDomainErrorToResponse } from './errors.js';
import type { OidcDiscoveryConfig } from './handlers/well-known.js';
import { registerMiddleware } from './routes/register-middleware.js';
import { registerRoutes } from './routes/register-routes.js';
import type { MembersRepository } from './store/members-store.js';

/**
 * T1.1 + ADR D1 — admin REST sub-app configuration. When supplied, mounts
 * `/v1/admin/keys/*` under `requireScope({ requiredScope: 'memory:admin' })`.
 * Backward-compat: omit `adminApi` and the sub-app is NOT mounted (every
 * existing `createServer({ memory })` continues to boot identically).
 */
export interface AdminApiOptions {
  /** pg.Pool-shaped DB access for the 5 admin handlers + scope verifier. */
  readonly pool: AuthPool;
  /**
   * Single-use bootstrap admin token sourced from env per ADR D4 (NEVER a
   * CLI flag — would leak via `ps`). Bearer matching this exact value
   * bypasses scope check on first call; EC-3 self-revoke in
   * `createKeyHandler` atomically flips `admin_config.bootstrap_consumed`
   * after the first admin key is issued.
   */
  readonly bootstrapToken?: string;
}

export interface CreateServerOptions {
  readonly memoryEvidenceStore?: MemoryEvidenceReader;
  readonly memoryJobs?: MemoryJobService;
  readonly memory: Memory;
  readonly authVerifier?: AuthVerifier;
  /**
   * Model B (ADR D4): fail-closed multi-tenant mode. When `true`, the bearer
   * middleware refuses the no-credential / verify-only DEFAULT_PRINCIPAL collapse
   * (returns 401) so a multi-tenant deployment cannot silently grant the shared
   * `default` owner workspace. Defaults to `false` (single-tenant dev unchanged);
   * the composition root may resolve it from `THEMEMORY_REQUIRE_CREDENTIAL` via
   * {@link parseRequireCredentialEnv}.
   */
  readonly requireCredential?: boolean;
  /**
   * Optional DB liveness probe injected by the composition root (CLI's
   * `themory server` subcommand at T2.3) without forcing `src/server/` to
   * import `pg` — DIP discipline per ADR D11 + `architecture.md § 3`.
   * Wraps a single `pool.query('SELECT 1')` in a 2s timeout (per EC-17).
   * When omitted, `GET /v1/health/db` returns 503 with `no_probe_configured`.
   */
  readonly dbProbe?: () => Promise<void>;
  /**
   * Optional OTel `Tracer` injected by the composition root. When omitted,
   * `trace.getTracer('@usetheo/memory/server', '0.1.0-alpha')` resolves to
   * the global no-op tracer — zero cost for consumers without an OTel
   * provider registered. DIP discipline per ADR D11; mirrors
   * `createLocalMemory({ tracer })`.
   */
  readonly tracer?: Tracer;
  /**
   * Optional readiness predicate consulted by `GET /v1/health` per EC-33.
   * Returns `true` once the composition root has finished warming critical
   * subsystems (typically: `createLocalMemory(...)` resolved). While the
   * probe returns `false`, `/v1/health` answers 503 `warming_up` so
   * orchestrators (Kubernetes readinessProbe, ECS health) do not route
   * traffic until the Memory factory has booted. When omitted, the gate
   * is a no-op and `/v1/health` answers 200 immediately (backward compat
   * for callers that pre-warm before invoking `createServer`).
   */
  readonly readinessProbe?: () => boolean;
  /**
   * T4.2 + ADR-0015 #4 — when supplied, exposes RFC 9728 metadata at
   * `/.well-known/oauth-protected-resource` so MCP clients can auto-discover
   * the OIDC issuer + supported scopes WITHOUT manual config. The endpoint
   * is auth-exempt (mounted BEFORE the bearer middleware) — clients fetch
   * it before having a token. When omitted, the well-known endpoint returns
   * 404 `OIDC_DISCOVERY_NOT_CONFIGURED` (honest no-OIDC signal).
   */
  readonly oidcDiscovery?: OidcDiscoveryConfig;
  /**
   * T1.1 + ADR D1 — opt-in admin REST sub-app. When supplied, mounts
   * `/v1/admin/keys/*` under `requireScope({ requiredScope: 'memory:admin' })`.
   * When omitted, admin routes return 404 (backward-compat for consumers
   * who don't need admin lifecycle).
   */
  readonly adminApi?: AdminApiOptions;
  /**
   * multi-tenant-rbac-and-slice1-completion T2.1 — DIP override for the
   * membership store powering `/v1/members/*`. When omitted, a pg-backed repo
   * is derived from `adminApi.pool` (so member routes mount whenever admin
   * lifecycle is enabled). Contract tests inject an in-memory repo here to
   * exercise the role×route matrix without a DB.
   */
  readonly membersRepository?: MembersRepository;
  /**
   * entity-extraction-nodes-slice1 T4.2 (ADR D4) — optional entities read port.
   * When supplied, `GET /v1/scopes/:type/:id/entities` serves REAL entities from
   * the `entities`/`memory_entities` tables. When omitted, the handler keeps the
   * `attributed_to`-derived fallback (no regression for servers without entity
   * linking). The composition root (CLI `themory server`) injects the
   * `PgMemoryEntityStore` here, mirroring the `adminApi.pool` wiring precedent.
   */
  readonly memoryEntityStore?: MemoryEntityStore;
  /**
   * entity-relation-extraction-slice2 T3.1 (ADR D4/D6) — optional edges read port.
   * When supplied, `GET /v1/scopes/:type/:id/graph` serves REAL relation edges
   * from `entity_edges`. When omitted, `/graph` returns `{nodes, edges:[]}` (D6).
   * The composition root (`themory server`) injects `PgMemoryGraphStore` here.
   */
  readonly memoryGraphStore?: MemoryGraphStore;
  /**
   * themory-scoped-forget-and-retrieval-counter T2.4 (ADR D4 + EC-2) — optional
   * recall-counter read port. When supplied, `GET /v1/scopes/:type/:id/metrics`
   * serves the REAL `retrieval_api_usage` from `scope_usage_counters`. When
   * omitted, the field falls back to 0 (in-memory adapter / tests — no regression).
   * The composition root (`themory server`) injects `PgUsageCounterStore` here,
   * mirroring the `memoryEntityStore` wiring precedent.
   */
  readonly usageCounterStore?: UsageCounterStore;
  /**
   * explainable-recall-read S2 (ADR D4) — optional recall-trace READ port. When
   * supplied, `GET /v1/recall-traces/:recallId` serves the dropped candidates of
   * a recall (workspace-scoped). When omitted, the route is NOT mounted (opt-in;
   * existing deployments unaffected). The composition root (`themory server`)
   * injects the same `PgRecallTraceStore` it wired for the SDK trace write,
   * mirroring the `memoryEntityStore` wiring precedent.
   */
  readonly recallTraceStore?: RecallTraceStore;
  /**
   * M11 T3.1 (ADR D1/D3) — optional routing-policy READ/WRITE port. When supplied,
   * `GET/PUT /v1/routing-policy` are mounted (PUT is admin-scoped); when omitted the routes
   * are NOT mounted (opt-in; existing deployments unaffected). The composition root
   * (`themory server`) injects `PgRoutingPolicyStore`, mirroring the `recallTraceStore` precedent.
   */
  readonly routingPolicyStore?: RoutingPolicyStore;
  /**
   * M11 T3.1 (ADR D2/D3) — optional routing-audit READ port. When supplied,
   * `GET /v1/routing-audit` serves the `(workspace, user)`-scoped placement-decision audit; when
   * omitted the route is NOT mounted. The composition root injects `PgRoutingAuditStore`.
   */
  readonly routingAuditStore?: RoutingAuditStore;
}

export function createApp(options: CreateServerOptions): OpenAPIHono {
  const { adminApi, tracer } = options;
  // EC-1 absorption — pool runtime guard. A cast escape (`pool: undefined as any`)
  // or an untyped JS caller (`{ adminApi: {} }`) can slip a bad pool past types;
  // fail synchronously at boot with a clear error rather than crashing deep in
  // the first admin request.
  if (adminApi !== undefined && (!adminApi.pool || typeof adminApi.pool.query !== 'function')) {
    throw new Error(
      `createServer: adminApi.pool is required when adminApi is supplied; got typeof pool=${typeof adminApi.pool}`,
    );
  }
  const app = new OpenAPIHono();
  registerMiddleware(app, tracer);
  registerRoutes(app, options);
  app.onError((err, c) => {
    // T1.6 — domain-error mapping (EC-10 / EC-23 / EC-24 absorbed inside
    // mapDomainErrorToResponse). Pure-function mapper keeps Hono Context
    // decoupled and reusable for non-HTTP transports.
    const { status, body } = mapDomainErrorToResponse(err);
    return c.json(body, status as Parameters<typeof c.json>[1]);
  });
  return app;
}
