/**
 * MCP server composition root — extracted from cli.ts at T2.1 so the CLI
 * router (commander) can keep src/agent-tools/cli.ts thin (≤200 LoC budget
 * per plan T2.1 + SRP). Pre-T2.1, this body lived inline in `cli.ts::main()`;
 * the existing v0.3 EC-7 behavior (env-var hard-fail + dual SIGINT/SIGTERM
 * handlers + 5s shutdown timeout) is preserved verbatim. Only the call site
 * changed (now invoked via `themory mcp` OR the `themory-mcp` alias).
 *
 * Composition root (DIP-allowed): this file wires src/local/ (pgvector +
 * stubs) into the agent-tools McpServer. Library layer `src/agent-tools/
 * index.ts` does NOT re-export src/local/ — the bin entry IS the composition
 * site per ADR D8.
 *
 * @see ADR D1 — stdio is the primary transport for local CLI deployment
 * @see ADR D4 — McpServer consumes memoryFactory; T5.1 dispatch resolves scoped memory
 * @see ADR D8 — composition root locus
 * @see EC-7 — env-var hard-fail + dual signal handlers
 * @see Plan theo-memory-standalone-p0 § T2.1 (extraction motivation)
 */
import { Pool } from 'pg';

import { createLocalMemory, runMigrations, StubEmbedder, StubLLM } from '../local/index.js';
import { PgvectorStore } from '../local/pgvector-store.js';

import { McpServer } from './server.js';
import { connectStdio } from './transports/stdio.js';
import { connectStreamableHttp } from './transports/streamable-http.js';

/** Shutdown timeout (ms) — caps how long we wait for server.stop() before force-exit. */
const SHUTDOWN_TIMEOUT_MS = 5_000;

export async function runMcpServer(_argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  void _argv;

  const pgUri = process.env['THEOMEM_PG_URI'];
  if (pgUri === undefined || pgUri.length === 0) {
    process.stderr.write(
      'Error: THEOMEM_PG_URI required. Set it to a postgres connection string (e.g., postgres://user:pass@host:5432/dbname).\n',
    );
    process.exit(2);
    return; // unreachable but satisfies typecheck
  }

  const pool = new Pool({ connectionString: pgUri });
  await runMigrations(pool);

  const memory = await createLocalMemory({
    vectorStore: new PgvectorStore(pool),
    embedder: new StubEmbedder(),
    llm: new StubLLM(),
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

  const transport = process.env['THEOMEM_MCP_TRANSPORT'] ?? 'stdio';
  if (transport === 'streamable-http') {
    const port = Number.parseInt(process.env['THEOMEM_MCP_HTTP_PORT'] ?? '8080', 10);
    const host = process.env['THEOMEM_MCP_HTTP_HOST'] ?? '127.0.0.1';
    await connectStreamableHttp(server, { port, host });
  } else {
    await connectStdio(server);
  }
}
