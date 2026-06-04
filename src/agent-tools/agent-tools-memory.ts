/**
 * Shared agent-tools Memory factory + env-fail boundary helper.
 *
 * Single source of truth for the THEOMEM_PG_URI + OPENAI_API_KEY env-validation
 * triplicated across the agent-tools subpath (CLI verbs + MCP runner + REST
 * runner) AND for the Memory factory provider tuple (`PgvectorStore` +
 * `LocalTransformerEmbedder` + `OpenAILLM`).
 *
 * Per plan verbs-as-cli-fixes-cycle-2 § T3.1 + ADR D4, the provider-tuple
 * factory body is now extracted as `wireMemoryFromPool(pool)` so all 3
 * agent-tools entry points can share it:
 *
 *   - `createAgentToolsMemory()` (CLI verb handlers) — full lifecycle
 *     including assertEnvOrExit + new Pool + runMigrations + dispose closure.
 *   - `run-mcp-server.ts` — calls `wireMemoryFromPool(pool)` directly with
 *     its existing pool + migration lifecycle.
 *   - `run-server.ts` — calls `wireMemoryFromPool(pool)` INSIDE the EC-33
 *     readiness-Proxy warm Promise, preserving the readiness gate semantics.
 *
 * EC-3 absorption (verbs-as-cli-fixes-cycle-2 plan T3.1 step 6): the helper
 * does NOT close the pool — caller owns the pool lifecycle. A contract test
 * pins this invariant at `src/agent-tools/__tests__/agent-tools-memory.test.ts`.
 *
 * @see .claude/knowledge-base/plans/verbs-as-cli-fixes-cycle-2-plan.md § T3.1 + ADRs D3 + D4
 */
import { Pool } from 'pg';

import type { Memory } from '../core/memory-store.js';
import { LocalTransformerEmbedder } from '../embedders/local.js';
import { OpenAILLM } from '../llms/openai.js';
import { createLocalMemory, runMigrations } from '../local/index.js';
import { PgvectorStore } from '../local/pgvector-store.js';

/**
 * @internal Embedding dimension produced by `LocalTransformerEmbedder`
 * (Xenova `Xenova/all-MiniLM-L6-v2`, 384-dim, L2-normalized). Single source
 * of truth for the value consumed by:
 *   - `wireMemoryFromPool` (provider tuple construction)
 *   - `run-mcp-server.ts::runMcpServer` (pre-wire runMigrations call)
 *   - `run-server.ts::runServer` (pre-warm-Promise runMigrations call)
 *
 * NOT part of the public `@usetheo/memory/agent-tools` API surface.
 *
 * Exported by fix-cycle-2 hotfix (M2 closure from /review — closes the
 * 3-site DRY knowledge-duplication that survived ADR D4's tuple-body
 * extraction).
 */
export const LOCAL_EMBEDDER_DIM = 384;

/**
 * @internal Shared boundary helper for agent-tools subpath (CLI/MCP/REST).
 * NOT part of the public `@usetheo/memory/agent-tools` API surface.
 *
 * Boundary env-fail helper. Each spec is `{ name, errorMessage }`. When the
 * env var is undefined OR empty-string, writes `errorMessage` to stderr and
 * calls `process.exit(2)` (commander v12 maps invalid-arg to exit 2; we want
 * the same contract at the env-presence boundary).
 */
export function assertEnvOrExit(
  specs: readonly { readonly name: string; readonly errorMessage: string }[],
): void {
  for (const spec of specs) {
    const value = process.env[spec.name];
    if (value === undefined || value.length === 0) {
      process.stderr.write(spec.errorMessage);
      process.exit(2);
    }
  }
}

/**
 * @internal Shared env spec for agent-tools subpath (CLI/MCP/REST).
 * NOT part of the public `@usetheo/memory/agent-tools` API surface.
 *
 * Single source of truth for `Error: THEOMEM_PG_URI required ...` stderr
 * string consumed by the 3 callers + by existing test sentinels at
 * `tests/integration/p0-audit/*`.
 */
export const PG_URI_ENV_SPEC = {
  name: 'THEOMEM_PG_URI',
  errorMessage:
    'Error: THEOMEM_PG_URI required. Set it to a postgres connection string (e.g., postgres://user:pass@host:5432/dbname).\n',
} as const;

/**
 * @internal Shared env spec for agent-tools subpath (CLI/MCP/REST).
 * NOT part of the public `@usetheo/memory/agent-tools` API surface.
 *
 * Single source of truth for `Error: OPENAI_API_KEY required ...` stderr
 * string consumed by the 3 callers + by existing test sentinels.
 */
export const OPENAI_API_KEY_ENV_SPEC = {
  name: 'OPENAI_API_KEY',
  errorMessage:
    'Error: OPENAI_API_KEY required. Set it to a key accepted by OPENAI_BASE_URL (defaults to api.openai.com; set OPENAI_BASE_URL=https://openrouter.ai/api/v1 for OpenRouter).\n',
} as const;

/**
 * @internal Shared Memory factory composition helper for agent-tools subpath.
 * NOT part of the public `@usetheo/memory/agent-tools` API surface.
 *
 * Builds a `Memory` instance from the provided `pool`. Composes the provider
 * tuple (`PgvectorStore` + `LocalTransformerEmbedder` + `OpenAILLM`) at the
 * SINGLE SOURCE OF TRUTH. Called by:
 *   - `createAgentToolsMemory()` (CLI verb handlers + tuple lifecycle)
 *   - `run-mcp-server.ts::runMcpServer` (direct, after env-validation)
 *   - `run-server.ts::runServer` (inside the EC-33 readiness warm Promise)
 *
 * EC-3 contract: the helper DOES NOT close the pool. Caller owns the pool
 * lifecycle (close it on dispose / shutdown). Pinned by
 * `test_wireMemoryFromPool_does_not_close_pool` at
 * `src/agent-tools/__tests__/agent-tools-memory.test.ts`.
 *
 * @see plan verbs-as-cli-fixes-cycle-2 § ADR D4 — extract rationale
 */
export async function wireMemoryFromPool(pool: Pool): Promise<Memory> {
  return createLocalMemory({
    vectorStore: new PgvectorStore(pool, { embeddingDim: LOCAL_EMBEDDER_DIM }),
    embedder: new LocalTransformerEmbedder(),
    llm: new OpenAILLM(),
    embeddingDim: LOCAL_EMBEDDER_DIM,
  });
}

/**
 * @internal Shared CLI Memory factory for agent-tools verb handlers.
 * NOT part of the public `@usetheo/memory/agent-tools` API surface.
 *
 * Build a `Memory` instance from env config. Hard-exits with code 2 on
 * missing `THEOMEM_PG_URI` or `OPENAI_API_KEY` via `assertEnvOrExit`.
 *
 * Returns a tuple `[memory, dispose]` — dispose closes the pg pool, called
 * by the handler in a try/finally to release the connection without
 * blocking process exit.
 *
 * EC-4 absorption (fix-cycle-1): no explicit `reflectionPolicy:` wire — the
 * factory's post-T1.1 default (`{ kind: 'manual', ... }`) applies via
 * key-omission.
 */
export async function createAgentToolsMemory(): Promise<readonly [Memory, () => Promise<void>]> {
  assertEnvOrExit([PG_URI_ENV_SPEC, OPENAI_API_KEY_ENV_SPEC]);
  // Post-assertEnvOrExit, both env vars are non-empty strings; the `!` is
  // safe (assertEnvOrExit would have called process.exit otherwise).
  const pgUri = process.env['THEOMEM_PG_URI']!;

  const pool = new Pool({ connectionString: pgUri });
  await runMigrations(pool, { embeddingDim: LOCAL_EMBEDDER_DIM });

  const memory = await wireMemoryFromPool(pool);

  const dispose = async (): Promise<void> => {
    await pool.end();
  };

  return [memory, dispose] as const;
}
