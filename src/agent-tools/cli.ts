/**
 * CLI entry point for `npx @usetheo/memory/agent-tools` (stdio transport at v0.3).
 *
 * EC-7 absorbed (plan v1.1):
 * - THEOMEM_PG_URI required → hard-fail with actionable stderr message + process.exit(2)
 * - SIGINT + SIGTERM handlers via shared shutdownHandler with 5s timeout (forces exit 0)
 *
 * Composition root (DIP-allowed): cli.ts wires src/local/ (pgvector + stubs) into
 * the agent-tools McpServer. Library layer (src/agent-tools/index.ts) does NOT
 * re-export src/local/ — bin entry IS the composition site per ADR D8.
 *
 * @see ADR D1 — stdio is the primary transport for local CLI deployment
 * @see ADR D4 — McpServer consumes memoryFactory; T5.1 dispatch resolves scoped memory
 * @see EC-7 — env-var hard-fail + dual signal handlers
 */
import { Pool } from 'pg';

import { createLocalMemory, runMigrations, StubEmbedder, StubLLM } from '../local/index.js';
import { PgvectorStore } from '../local/pgvector-store.js';

import { McpServer } from './server.js';
import { connectStdio } from './transports/stdio.js';
import { connectStreamableHttp } from './transports/streamable-http.js';

/** Shutdown timeout (ms) — caps how long we wait for server.stop() before force-exit. */
const SHUTDOWN_TIMEOUT_MS = 5_000;

export async function main(_argv: readonly string[] = process.argv.slice(2)): Promise<void> {
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

// Invoke when executed directly as the bin entry (`node dist/agent-tools/cli.js`).
// Skip when imported as a module (e.g., from unit tests).
const isDirectInvocation =
  typeof process !== 'undefined' &&
  typeof process.argv[1] === 'string' &&
  /agent-tools[\\/]cli\.(?:js|ts)$/.test(process.argv[1]);

if (isDirectInvocation) {
  main().catch((err: unknown) => {
    process.stderr.write(`agent-tools CLI failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
