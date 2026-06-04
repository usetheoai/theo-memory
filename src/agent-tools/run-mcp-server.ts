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

import { LocalTransformerEmbedder } from '../embedders/local.js';
import { OpenAILLM } from '../llms/openai.js';
import { createLocalMemory, runMigrations } from '../local/index.js';
import { PgvectorStore } from '../local/pgvector-store.js';

import {
  assertEnvOrExit,
  OPENAI_API_KEY_ENV_SPEC,
  PG_URI_ENV_SPEC,
} from './agent-tools-memory.js';
import { McpServer } from './server.js';
import { connectStdio } from './transports/stdio.js';
import { connectStreamableHttp } from './transports/streamable-http.js';

/**
 * Embedding dimension produced by LocalTransformerEmbedder (Xenova MiniLM L6 v2).
 * Aligned with adapters-openrouter-local-embedder ADR D2 — parametric dim
 * pipeline (runMigrations + PgvectorStore + createLocalMemory accept the same
 * value; dim mismatch throws at probe time per EC-1).
 */
const LOCAL_EMBEDDER_DIM = 384;

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
}

function resolveTransport(opt?: RunMcpServerOptions['transport']): 'stdio' | 'streamable-http' {
  if (opt !== undefined) return opt;
  const envValue = process.env['THEOMEM_MCP_TRANSPORT'];
  if (envValue === 'streamable-http' || envValue === 'stdio') return envValue;
  return 'stdio';
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

  const transport = resolveTransport(options?.transport);
  // Validate port eagerly so an invalid CLI flag fails BEFORE we touch pg —
  // avoids leaking a connection pool when the operator typo'd the port.
  const port = transport === 'streamable-http' ? resolvePort(options?.port) : 0;
  const host = transport === 'streamable-http' ? resolveHost(options?.host) : '';

  const pool = new Pool({ connectionString: pgUri });
  await runMigrations(pool, { embeddingDim: LOCAL_EMBEDDER_DIM });

  process.stderr.write(
    `themory mcp: real providers wired — LocalTransformerEmbedder (Xenova MiniLM, dim=${LOCAL_EMBEDDER_DIM}) + OpenAILLM via OPENAI_BASE_URL.\n`,
  );

  const memory = await createLocalMemory({
    vectorStore: new PgvectorStore(pool, { embeddingDim: LOCAL_EMBEDDER_DIM }),
    embedder: new LocalTransformerEmbedder(),
    llm: new OpenAILLM(),
    embeddingDim: LOCAL_EMBEDDER_DIM,
  });

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
    await connectStreamableHttp(server, { port, host });
  } else {
    await connectStdio(server);
  }
}
