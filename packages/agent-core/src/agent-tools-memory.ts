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
 * pins this invariant at `packages/cli/src/__tests__/agent-tools-memory.test.ts`.
 *
 * @see .claude/knowledge-base/plans/verbs-as-cli-fixes-cycle-2-plan.md § T3.1 + ADRs D3 + D4
 */

import { createLocalMemory, runMigrations, SandboxedSkillExecutor } from '@usetheo/memory';
import { PgvectorStore } from '@usetheo/memory';
import type { Embedder, Memory } from '@usetheo/memory/contract';
// NOTE: `LocalTransformerEmbedder` (@xenova/transformers) and `OpenAILLM` (openai)
// are backed by OPTIONAL dependencies. They are dynamically imported inside
// `wireMemoryFromPool` (the single construction site) so that merely importing
// this module — e.g. when `themory --help` loads the CLI router — does NOT pull
// the heavy optional-dep graph. The deps load only when a Memory is actually
// built (mcp / server / verb handlers at runtime).
import { Pool } from 'pg';

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
 * @internal Embedding dimension produced by `OpenAIEmbedder`
 * (`text-embedding-3-small`, 1536-dim — fits pgvector's 1536 HNSW cap).
 * Single source of truth for the OpenAI-embedder path.
 */
export const OPENAI_EMBEDDER_DIM = 1536;

/** Which embedder backs the runtime Memory. */
export type EmbedderKind = 'local' | 'openai';

/**
 * @internal Resolve the embedder backend from `THEOMEM_EMBEDDER`:
 *   - unset / empty / `'local'` → `'local'` (Xenova MiniLM, no API key, default
 *     for back-compat with the 384-dim local runtime).
 *   - `'openai'`               → `'openai'` (OpenAI `text-embedding-3-small`,
 *     1536-dim; requires `OPENAI_API_KEY`; no @xenova/onnx/sharp at runtime).
 *
 * Fails LOUD (throws) on any other value — no silent fallback (Inquebrável Rule 8).
 */
export function resolveEmbedderKind(): EmbedderKind {
  const k = process.env['THEOMEM_EMBEDDER'];
  if (k === undefined || k === '' || k === 'local') return 'local';
  if (k === 'openai') return 'openai';
  throw new Error(
    `Unknown THEOMEM_EMBEDDER='${k}' (expected 'local' or 'openai').`,
  );
}

/**
 * production-runtime-hardening T1.1 (ADR D1): opt-in gate for M1 skill execution.
 *
 * `THEOMEM_SKILL_EXECUTION=true` → enable; unset / anything-else → DISABLED. The
 * STORE-only default is preserved (the REST execute endpoint stays `501
 * SKILL_EXECUTION_NOT_CONFIGURED` when unset), honoring M1's opt-in/gated security
 * line. Exact-match `'true'` only (EC-2) — mirrors `resolveEmbedderKind`'s
 * exact-match contract so `'1'`/`'TRUE'`/`'yes'` do NOT silently enable an
 * RCE-capable surface.
 *
 * @see .claude/knowledge-base/plans/production-runtime-hardening-plan.md § T1.1 + ADR D1
 */
export function resolveSkillExecutionEnabled(): boolean {
  return process.env['THEOMEM_SKILL_EXECUTION'] === 'true';
}

/** Embedding dimension for an embedder kind (must match the migration dim). */
export function embeddingDimForKind(kind: EmbedderKind): number {
  return kind === 'openai' ? OPENAI_EMBEDDER_DIM : LOCAL_EMBEDDER_DIM;
}

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
 * `packages/cli/src/__tests__/agent-tools-memory.test.ts`.
 *
 * @see plan verbs-as-cli-fixes-cycle-2 § ADR D4 — extract rationale
 */
export async function wireMemoryFromPool(pool: Pool): Promise<Memory> {
  // Lazy-load the optional-dependency-backed adapters at the single construction
  // site (see import-section note). Keeps CLI module-load (and `--help`) free of
  // the @xenova/transformers + openai graph. Only the SELECTED embedder is
  // imported — `THEOMEM_EMBEDDER=openai` never pulls @xenova/onnx/sharp.
  const kind = resolveEmbedderKind();
  const embeddingDim = embeddingDimForKind(kind);

  const [embedder, { OpenAILLM }] = await Promise.all([
    buildEmbedder(kind),
    import('@usetheo/memory/llms/openai'),
  ]);

  // production-runtime-hardening T1.1 (ADR D1/D2 + EC-1/EC-4): opt-in skill
  // execution, wired at this single shared site so server + MCP + CLI all honor
  // one `THEOMEM_SKILL_EXECUTION` flag. Default OFF → no skillExecutor → the REST
  // execute endpoint stays 501 (secure STORE-only default unchanged). EC-1: the
  // SandboxedSkillExecutor constructor is addon-free (isolated-vm loads lazily at
  // execute()), so enabling this on a runtime without the addon boots fine and
  // degrades to a typed 503 at execute — never a boot crash. EC-4: the static
  // import does NOT pull isolated-vm at module-load (type-only import in the impl).
  const skillExecutor = resolveSkillExecutionEnabled() ? new SandboxedSkillExecutor() : undefined;

  return createLocalMemory({
    vectorStore: new PgvectorStore(pool, { embeddingDim }),
    embedder,
    llm: new OpenAILLM(),
    embeddingDim,
    ...(skillExecutor !== undefined ? { skillExecutor } : {}),
  });
}

/** Lazily construct the selected embedder (imports only the chosen backend). */
async function buildEmbedder(kind: EmbedderKind): Promise<Embedder> {
  if (kind === 'openai') {
    const { OpenAIEmbedder } = await import('@usetheo/memory/embedders/openai');
    return new OpenAIEmbedder();
  }
  const { LocalTransformerEmbedder } = await import('@usetheo/memory/embedders/local');
  return new LocalTransformerEmbedder();
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
  // Migration dim MUST match the selected embedder (local 384 / openai 1536).
  await runMigrations(pool, { embeddingDim: embeddingDimForKind(resolveEmbedderKind()) });

  const memory = await wireMemoryFromPool(pool);

  const dispose = async (): Promise<void> => {
    await pool.end();
  };

  return [memory, dispose] as const;
}
