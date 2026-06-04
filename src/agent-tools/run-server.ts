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

import { LocalTransformerEmbedder } from '../embedders/local.js';
import { OpenAILLM } from '../llms/openai.js';
import { createLocalMemory, runMigrations } from '../local/index.js';
import { PgvectorStore } from '../local/pgvector-store.js';
import { BearerAuthVerifier, readApiKey } from '../server/auth/bearer-verifier.js';
import { createServer } from '../server/index.js';

import {
  assertEnvOrExit,
  OPENAI_API_KEY_ENV_SPEC,
  PG_URI_ENV_SPEC,
} from './agent-tools-memory.js';

/**
 * Embedding dimension produced by LocalTransformerEmbedder (Xenova MiniLM L6 v2).
 * Mirrors run-mcp-server.ts LOCAL_EMBEDDER_DIM constant (commit e43d801) so the
 * REST + MCP composition roots stay in lockstep per architecture.md § 5.
 */
const LOCAL_EMBEDDER_DIM = 384;

const SHUTDOWN_TIMEOUT_MS = 5_000;

export interface RunServerOptions {
  readonly port?: number;
  readonly host?: string;
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
  let memory: Awaited<ReturnType<typeof createLocalMemory>> | undefined;
  const warmPromise = (async () => {
    memory = await createLocalMemory({
      vectorStore: new PgvectorStore(pool, { embeddingDim: LOCAL_EMBEDDER_DIM }),
      embedder: new LocalTransformerEmbedder(),
      llm: new OpenAILLM(),
      embeddingDim: LOCAL_EMBEDDER_DIM,
    });
    isReady = true;
  })();

  // dbProbe closure — thin (no timeout); healthDbHandler owns the 2s race.
  const dbProbe = async (): Promise<void> => {
    await pool.query('SELECT 1');
  };

  const apiKey = readApiKey();
  const authVerifier = apiKey !== undefined ? new BearerAuthVerifier(apiKey) : undefined;

  // Memory is injected via a small shim that surfaces an honest error if
  // a verb handler fires before the factory resolves. The 503-readiness
  // gate at /v1/health should prevent the orchestrator from routing user
  // traffic during that window; this shim is the defense-in-depth.
  const memoryShim = new Proxy({} as Awaited<ReturnType<typeof createLocalMemory>>, {
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
