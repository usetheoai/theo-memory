/**
 * Shared agent-tools Memory factory + env-fail boundary helper.
 *
 * Single source of truth for the THEOMEM_PG_URI + OPENAI_API_KEY env-validation
 * triplicated across the agent-tools subpath (CLI verbs + MCP runner + REST
 * runner). Per plan verbs-as-cli-fixes-cycle-1 § T2.1 + ADR D3, this file
 * (rename of `cli-memory-factory.ts`) is now consumed by:
 *
 *   - src/agent-tools/run-{remember,recall,forget,reflect}.ts (CLI verb handlers)
 *   - src/agent-tools/run-mcp-server.ts (MCP transport runner)
 *   - src/agent-tools/run-server.ts (REST API runner)
 *
 * `createCliMemory` is preserved as an exported alias for backward-compat with
 * the 4 verb handlers; new call-sites SHOULD use `createAgentToolsMemory`.
 *
 * EC-4 absorption — the explicit `reflectionPolicy: { kind: 'manual', ... }`
 * wire from the pre-T1.1 version of this file is INTENTIONALLY DROPPED:
 * post-T1.1, `createLocalMemory` defaults `reflectionPolicy` at the factory
 * level when the consumer OMITS the key (per ADR D1 + ADR-0005 supplementary
 * amendment). Explicit-wire here would be dead code AND a DRY violation
 * visible at the refactor source.
 *
 * @see .claude/knowledge-base/plans/verbs-as-cli-fixes-cycle-1-plan.md § T2.1 + ADRs D1 + D3
 */
import { Pool } from 'pg';

import type { Memory } from '../core/memory-store.js';
import { LocalTransformerEmbedder } from '../embedders/local.js';
import { OpenAILLM } from '../llms/openai.js';
import { createLocalMemory, runMigrations } from '../local/index.js';
import { PgvectorStore } from '../local/pgvector-store.js';

const LOCAL_EMBEDDER_DIM = 384;

/**
 * Boundary env-fail helper. Each spec is `{ name, errorMessage }`. When the
 * env var is undefined OR empty-string, writes `errorMessage` to stderr and
 * calls `process.exit(2)` (commander v12 maps invalid-arg to exit 2; we want
 * the same contract at the env-presence boundary). The whole call is
 * synchronous; `process.exit` does not return.
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
 * Canonical env specs for the agent-tools subpath. Exported so the 3 callers
 * (CLI / MCP / REST) reference the same byte-identical stderr strings —
 * single source of truth (closes F-arch-2 + F-wire-1).
 *
 * The literal `OPENAI_API_KEY required` substring is preserved verbatim so
 * existing test sentinels (`tests/integration/p0-audit/*`) continue to pass
 * after the EC-3 absorption (preserve PER-TEST wording when retrofit collapses
 * duplicates into shared helper).
 */
export const PG_URI_ENV_SPEC = {
  name: 'THEOMEM_PG_URI',
  errorMessage:
    'Error: THEOMEM_PG_URI required. Set it to a postgres connection string (e.g., postgres://user:pass@host:5432/dbname).\n',
} as const;

export const OPENAI_API_KEY_ENV_SPEC = {
  name: 'OPENAI_API_KEY',
  errorMessage:
    'Error: OPENAI_API_KEY required. Set it to a key accepted by OPENAI_BASE_URL (defaults to api.openai.com; set OPENAI_BASE_URL=https://openrouter.ai/api/v1 for OpenRouter).\n',
} as const;

/**
 * Build a `Memory` instance from env config. Hard-exits with code 2 on
 * missing `THEOMEM_PG_URI` or `OPENAI_API_KEY` via `assertEnvOrExit`.
 *
 * Returns a tuple `[memory, dispose]` — dispose closes the pg pool, called
 * by the handler in a try/finally to release the connection without
 * blocking process exit.
 *
 * EC-4 absorption: no explicit `reflectionPolicy:` wire — the factory's
 * post-T1.1 default (`{ kind: 'manual', ... }`) applies via key-omission.
 */
export async function createAgentToolsMemory(): Promise<readonly [Memory, () => Promise<void>]> {
  assertEnvOrExit([PG_URI_ENV_SPEC, OPENAI_API_KEY_ENV_SPEC]);
  // Post-assertEnvOrExit, both env vars are non-empty strings; the `!` is
  // safe (assertEnvOrExit would have called process.exit otherwise).
  const pgUri = process.env['THEOMEM_PG_URI']!;

  const pool = new Pool({ connectionString: pgUri });
  await runMigrations(pool, { embeddingDim: LOCAL_EMBEDDER_DIM });

  const memory = await createLocalMemory({
    vectorStore: new PgvectorStore(pool, { embeddingDim: LOCAL_EMBEDDER_DIM }),
    embedder: new LocalTransformerEmbedder(),
    llm: new OpenAILLM(),
    embeddingDim: LOCAL_EMBEDDER_DIM,
  });

  const dispose = async (): Promise<void> => {
    await pool.end();
  };

  return [memory, dispose] as const;
}

/**
 * Backward-compat alias for the 4 verb handlers' pre-existing import name.
 * New call-sites SHOULD prefer `createAgentToolsMemory`.
 */
export const createCliMemory = createAgentToolsMemory;
