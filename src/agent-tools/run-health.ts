/**
 * `themory health` readiness probe (EC-37).
 *
 * Verifies the DI graph composes + the upstream DB is reachable:
 *  - **Mandatory** (always run):
 *    1. `pool.query('SELECT 1')` within 2s (EC-17 parity).
 *    2. `createLocalMemory({...})` composes without throwing.
 *  - **Optional `--deep`** (off by default; adds latency + cost when wired
 *    against real providers):
 *    3. `embedder.embed('ping')` — round-trip a single embedding.
 *    4. `llm.generateChat([...])` — round-trip a single chat completion.
 *
 * At P0 the bundled `StubEmbedder` + `StubLLM` return deterministic values,
 * so `--deep` is a smoke-check of method-presence + composition. Against
 * future real OpenAI / local impls the same probe is a network round-trip.
 *
 * Returns the suggested process exit code so callers (the commander action
 * + tests) can decide how to surface it. The CLI action calls
 * `process.exit(code)`; tests inspect the return value directly without
 * polluting the test runner's exit code.
 *
 * Exit codes:
 *   0  all enabled checks passed
 *   1  any enabled check failed (mandatory or --deep)
 *   2  THEOMEM_PG_URI missing (EC-7 parity)
 *
 * @see Plan theo-memory-standalone-p0 § T2.5 + EC-37 + EC-17 + EC-7
 */
import { Pool } from 'pg';

import { createLocalMemory, StubEmbedder, StubLLM } from '../local/index.js';
import { PgvectorStore } from '../local/pgvector-store.js';

const DB_PROBE_TIMEOUT_MS = 2_000;

export interface RunHealthOptions {
  readonly deep?: boolean;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${String(ms)}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function runHealth(options?: RunHealthOptions): Promise<number> {
  const pgUri = process.env['THEOMEM_PG_URI'];
  if (pgUri === undefined || pgUri.length === 0) {
    process.stderr.write(
      'Error: THEOMEM_PG_URI required. Set it to a postgres connection string (e.g., postgres://user:pass@host:5432/dbname).\n',
    );
    return 2;
  }

  const pool = new Pool({ connectionString: pgUri });
  try {
    // Mandatory check 1 — DB SELECT 1 within 2s (EC-17).
    try {
      await withTimeout(pool.query('SELECT 1'), DB_PROBE_TIMEOUT_MS, 'db SELECT 1');
      process.stdout.write('themory health: db OK\n');
    } catch (err) {
      process.stderr.write(
        `themory health: db check failed (${err instanceof Error ? err.message : String(err)})\n`,
      );
      return 1;
    }

    // Mandatory check 2 — Memory factory composes without throwing.
    const embedder = new StubEmbedder();
    const llm = new StubLLM();
    let memoryReady = false;
    try {
      await createLocalMemory({
        vectorStore: new PgvectorStore(pool),
        embedder,
        llm,
      });
      memoryReady = true;
      process.stdout.write('themory health: memory factory OK\n');
    } catch (err) {
      process.stderr.write(
        `themory health: memory factory composition failed (${err instanceof Error ? err.message : String(err)})\n`,
      );
      return 1;
    }
    if (!memoryReady) return 1;

    if (options?.deep === true) {
      // Optional check 3 — embedder.embed('ping').
      try {
        await embedder.embed('ping');
        process.stdout.write('themory health: deep embedder OK\n');
      } catch (err) {
        process.stderr.write(
          `themory health: deep embedder check failed (${err instanceof Error ? err.message : String(err)})\n`,
        );
        return 1;
      }

      // Optional check 4 — llm.generateChat([...]).
      try {
        await llm.generateChat([{ role: 'user', content: 'ok' }]);
        process.stdout.write('themory health: deep llm OK\n');
      } catch (err) {
        process.stderr.write(
          `themory health: deep llm check failed (${err instanceof Error ? err.message : String(err)})\n`,
        );
        return 1;
      }
    }
    return 0;
  } finally {
    await pool.end().catch(() => undefined);
  }
}
