/**
 * theo-memory singleton — boots once per Node process.
 *
 * Backend auto-detect (v0.6.1 demo expansion):
 *   - `THEOMEM_PG_URI` set    → `PgvectorStore` + `runMigrations` (real persistence)
 *   - `THEOMEM_PG_URI` unset  → `InMemoryVectorStore` (zero infra)
 *
 * Demonstrates both runtimes of the contract from a single binary surface,
 * and persistence survives `npm run dev` restarts when pgvector is wired.
 *
 * `globalThis` shares the singleton across Next.js dev's per-route module
 * instances (writes via /api/chat must land in the SAME store as reads via
 * /api/memory/recall — standard Next.js pattern).
 */
import "server-only";
import {
  createMemory,
  InMemoryVectorStore,
  PgvectorStore,
  runMigrations,
  type Memory,
} from "@usetheo/memory";
import type {
  ManualReflectionPolicy,
  ReflectionTrigger,
  Scope,
  VectorStore,
} from "@usetheo/memory/contract";
import pg from "pg";
import { OpenAIEmbedder, OpenAILLM } from "./openai-adapters";

/** Explicit-only reflection policy (ADR-0005). */
class DemoManualReflectionPolicy implements ManualReflectionPolicy {
  readonly kind = "manual" as const;
  async shouldReflect(_scope: Scope, _trigger: ReflectionTrigger): Promise<boolean> {
    return true;
  }
}

export type BackendKind = "pgvector" | "in-memory";

interface MemorySingleton {
  readonly memory: Memory;
  readonly backend: BackendKind;
  readonly pgPool: pg.Pool | null;
}

declare global {
  // eslint-disable-next-line no-var
  var _themory_demo_singleton: Promise<MemorySingleton> | undefined;
}

async function buildStore(): Promise<{
  vectorStore: VectorStore;
  backend: BackendKind;
  pgPool: pg.Pool | null;
}> {
  const pgUri = process.env.THEOMEM_PG_URI;
  if (typeof pgUri === "string" && pgUri.length > 0) {
    const pgPool = new pg.Pool({ connectionString: pgUri });
    await runMigrations(pgPool);
    return {
      vectorStore: new PgvectorStore(pgPool),
      backend: "pgvector",
      pgPool,
    };
  }
  return {
    vectorStore: new InMemoryVectorStore(),
    backend: "in-memory",
    pgPool: null,
  };
}

export function getSingleton(): Promise<MemorySingleton> {
  if (globalThis._themory_demo_singleton === undefined) {
    globalThis._themory_demo_singleton = (async () => {
      const embedder = new OpenAIEmbedder();
      const llm = new OpenAILLM();
      const reflectionPolicy = new DemoManualReflectionPolicy();
      const { vectorStore, backend, pgPool } = await buildStore();
      const memory = await createMemory({
        embedder,
        llm,
        vectorStore,
        reflectionPolicy,
      });
      // eslint-disable-next-line no-console
      console.log(`[theomemory-demo] backend=${backend}`);
      return { memory, backend, pgPool };
    })();
  }
  return globalThis._themory_demo_singleton;
}

export async function getMemory(): Promise<Memory> {
  return (await getSingleton()).memory;
}

export async function getBackend(): Promise<BackendKind> {
  return (await getSingleton()).backend;
}
