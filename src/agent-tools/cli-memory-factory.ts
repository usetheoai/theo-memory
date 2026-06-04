/**
 * CLI memory-factory helper — DRY env-fail + Memory wiring for the 4 verb
 * subcommand handlers. Mirrors `run-mcp-server.ts:84-128` + `run-server.ts`
 * env-fail + createLocalMemory pattern per ADR D4.
 *
 * @see .claude/knowledge-base/plans/verbs-as-cli-themory-remember-recall-forget-reflect-plan.md § ADR D4
 */
import { Pool } from 'pg';

import type { Memory } from '../core/memory-store.js';
import { LocalTransformerEmbedder } from '../embedders/local.js';
import { OpenAILLM } from '../llms/openai.js';
import { createLocalMemory, runMigrations } from '../local/index.js';
import { PgvectorStore } from '../local/pgvector-store.js';

const LOCAL_EMBEDDER_DIM = 384;

/**
 * Build a `Memory` instance from env config. Hard-exits with code 2 on
 * missing `THEOMEM_PG_URI` or `OPENAI_API_KEY` per ADR D4 (EC-3 amendment:
 * direct `process.exit(2)`, NOT thrown exception, to avoid commander v12
 * promise-rejection-swallow → default exit 1).
 *
 * Returns a tuple `[memory, dispose]` — dispose closes the pg pool, called
 * by the handler in a try/finally to release the connection without
 * blocking process exit.
 */
export async function createCliMemory(): Promise<readonly [Memory, () => Promise<void>]> {
  const pgUri = process.env['THEOMEM_PG_URI'];
  if (pgUri === undefined || pgUri.length === 0) {
    process.stderr.write(
      'Error: THEOMEM_PG_URI required. Set it to a postgres connection string (e.g., postgres://user:pass@host:5432/dbname).\n',
    );
    process.exit(2);
  }

  const llmApiKey = process.env['OPENAI_API_KEY'];
  if (llmApiKey === undefined || llmApiKey.length === 0) {
    process.stderr.write(
      'Error: OPENAI_API_KEY required. Set it to a key accepted by OPENAI_BASE_URL (defaults to api.openai.com; set OPENAI_BASE_URL=https://openrouter.ai/api/v1 for OpenRouter).\n',
    );
    process.exit(2);
  }

  const pool = new Pool({ connectionString: pgUri });
  await runMigrations(pool, { embeddingDim: LOCAL_EMBEDDER_DIM });

  const memory = await createLocalMemory({
    vectorStore: new PgvectorStore(pool, { embeddingDim: LOCAL_EMBEDDER_DIM }),
    embedder: new LocalTransformerEmbedder(),
    llm: new OpenAILLM(),
    embeddingDim: LOCAL_EMBEDDER_DIM,
    // Manual reflection policy — `themory reflect` is explicit-only per
    // ADR-0005. Without a policy `scoped.reflect()` throws
    // `ReflectionNotConfigured`. The manual policy permits the CLI verb
    // invocation to flow through `executeReflection` per v0.4a contract.
    reflectionPolicy: {
      kind: 'manual',
      shouldReflect: () => Promise.resolve(true),
    },
  });

  const dispose = async (): Promise<void> => {
    await pool.end();
  };

  return [memory, dispose] as const;
}
