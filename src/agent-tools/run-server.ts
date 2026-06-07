/**
 * REST server composition root for `themory server` (Roadmap Item 16-18).
 *
 * Absorbs three edge cases from plan T2.3:
 *  - EC-31 EADDRINUSE → stderr `Port ${port} already in use` + exit 1.
 *  - EC-32 SIGTERM/SIGINT → idempotent graceful shutdown: HTTP server close
 *    → pool.end() → exit 0. Re-entrant guard via `shuttingDown` boolean so
 *    a double signal does not double-call `pool.end()` (which would throw).
 *  - EC-33 readiness gate: while `createLocalMemory()` is warming, the
 *    `serve()` call has already bound the port BUT `/v1/health` answers
 *    503 `warming_up`. Flag flips when the factory resolves.
 *
 * ADR D8 (migrate-on-startup): runMigrations runs BEFORE the port binds.
 * Skipped when `THEMEMORY_SKIP_MIGRATIONS === 'true'` (positive opt-in;
 * fail-safe default = run). Replaces deleted docker-entrypoint.sh per
 * EC-47 / ADR D13 distroless discipline.
 *
 * DIP discipline: src/agent-tools/run-server.ts IS the composition root
 * (per ADR D8 + architecture.md § 3) — it imports both src/server/ (REST
 * surface) and src/local/ (pg pool + Memory factory). src/server/ itself
 * stays pg-free.
 *
 * EC-7 reuse: identical THEOMEM_PG_URI hard-fail discipline as
 * runMcpServer — exit 2 + stderr example URI when env var missing.
 *
 * @see Plan theo-memory-standalone-p0 § T2.3 + ADR D8 + EC-31/32/33 + EC-47
 */
import { serve } from '@hono/node-server';
import { Pool } from 'pg';

import type { Memory } from '../core/memory-store.js';
import { runMigrations } from '../local/index.js';
import { ApiKeyAuthVerifier } from '../server/auth/api-key-verifier.js';
import { BearerAuthVerifier, readApiKey } from '../server/auth/bearer-verifier.js';
import { createOauth4webapiIntrospect } from '../server/auth/oidc-introspect-oauth4webapi.js';
import { OidcAuthVerifier } from '../server/auth/oidc-verifier.js';
import { createServer } from '../server/index.js';

import {
  assertEnvOrExit,
  LOCAL_EMBEDDER_DIM,
  OPENAI_API_KEY_ENV_SPEC,
  PG_URI_ENV_SPEC,
  wireMemoryFromPool,
} from './agent-tools-memory.js';
import { resolveBootstrapToken, resolveOidcConfig } from './oidc-cli-resolver.js';


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

interface HttpListener {
  close: (cb?: (err?: Error) => void) => void;
  on?: (event: string, cb: (err: Error) => void) => void;
}

export async function runServer(options?: RunServerOptions): Promise<void> {
  // verbs-as-cli-fixes-cycle-1 T2.1 / ADR D3: env-fail boundary now goes
  // through the shared `assertEnvOrExit` helper at agent-tools-memory.ts.
  // Single source of truth for `Error: THEOMEM_PG_URI required ...` and
  // `Error: OPENAI_API_KEY required ...` stderr strings (closes F-arch-2 +
  // F-wire-1). PRIORITY 0 hardening + T3.2 (p0-api-sdk-mcp-correctness-audit)
  // rationale preserved at the shared helper — see agent-tools-memory.ts
  // § OPENAI_API_KEY_ENV_SPEC. Fail-closed; never silent stub fallback.
  assertEnvOrExit([PG_URI_ENV_SPEC, OPENAI_API_KEY_ENV_SPEC]);
  const pgUri = process.env['THEOMEM_PG_URI']!;

  const port = resolvePort(options?.port);
  const host = resolveHost(options?.host);

  const pool = new Pool({ connectionString: pgUri });

  // ADR D8 — migrate-on-startup BEFORE port binds.
  if (!shouldSkipMigrations()) {
    try {
      await runMigrations(pool, { embeddingDim: LOCAL_EMBEDDER_DIM });
    } catch (err) {
      process.stderr.write(
        `themory server: migrations failed (${err instanceof Error ? err.message : String(err)})\n`,
      );
      process.exit(1);
      return;
    }
  }

  process.stderr.write(
    `themory server: real providers wired — LocalTransformerEmbedder (Xenova MiniLM, dim=${String(LOCAL_EMBEDDER_DIM)}) + OpenAILLM via OPENAI_BASE_URL.\n`,
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
  const envVerifier = apiKey !== undefined ? new BearerAuthVerifier(apiKey) : undefined;

  // T3.2 — OIDC verifier construction (when --issuer supplied).
  // resolveOidcConfig throws synchronously on EC-5 (invalid URL) / EC-6
  // (clientId without secret); we let those propagate to fail-loud at boot.
  const oidcCfg = resolveOidcConfig({
    ...(options?.issuer !== undefined ? { issuer: options.issuer } : {}),
    ...(options?.clientId !== undefined ? { clientId: options.clientId } : {}),
    host,
    port,
  });
  let authVerifier = envVerifier;
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

  // T1.1 — admin sub-app composition. Wired when bootstrap token is set
  // (EC-2 normalize: empty/whitespace → undefined). When neither bootstrap
  // nor any admin key exists, admin API simply 404s — backward-compat.
  const bootstrapToken = resolveBootstrapToken();
  const adminApi = bootstrapToken !== undefined || apiKey !== undefined
    ? {
        pool,
        ...(bootstrapToken !== undefined ? { bootstrapToken } : {}),
      }
    : undefined;
  // Use ApiKeyAuthVerifier instead of the env-secret one when admin path is
  // active AND no OIDC issuer (lets theo_live_* keys auth via SHA-256 lookup).
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
    ...(authVerifier !== undefined ? { authVerifier } : {}),
    ...(oidcDiscovery !== undefined ? { oidcDiscovery } : {}),
    ...(adminApi !== undefined ? { adminApi } : {}),
    dbProbe,
    readinessProbe: () => isReady,
  });

  const listener = serve({ fetch: app.fetch, port, hostname: host }, (info: { port: number }) => {
    process.stdout.write(`themory server: listening on ${host}:${String(info.port)}\n`);
  }) as unknown as HttpListener;

  if (listener.on !== undefined) {
    listener.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        process.stderr.write(`themory server: Port ${String(port)} already in use\n`);
        process.exit(1);
        return;
      }
      process.stderr.write(`themory server: listen error: ${err.message}\n`);
      process.exit(1);
    });
  }

  // EC-32 idempotent shutdown — guard against double-fire.
  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    void (async () => {
      try {
        await Promise.race([
          new Promise<void>((resolve, reject) => {
            listener.close((err) => (err !== undefined ? reject(err) : resolve()));
          }),
          new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS)),
        ]);
        await pool.end();
      } finally {
        process.exit(0);
      }
    })();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

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
