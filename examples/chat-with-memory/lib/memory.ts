/**
 * theo-memory singleton — boots once per Node process.
 *
 * Default backend: InMemoryVectorStore (zero infra). Swap to pgvector by
 * setting THEOMEM_PG_URI in `.env` and importing PgvectorStore here.
 *
 * Why `globalThis`: in Next.js dev mode (`next dev`), each route handler
 * is compiled into its own module instance with its own module-scope state.
 * A bare `let memoryPromise = null` would fragment the singleton — writes
 * via /api/chat would land in a different store than reads via
 * /api/memory/recall. `globalThis` shares state across every route handler
 * within the same Node process. Standard Next.js pattern (see
 * https://nextjs.org/docs/app/building-your-application/configuring/prisma).
 */
import "server-only";
import {
  createMemory,
  InMemoryVectorStore,
  type Memory,
} from "@usetheo/memory";
import type {
  ManualReflectionPolicy,
  ReflectionTrigger,
  Scope,
} from "@usetheo/memory/contract";
import { OpenAIEmbedder, OpenAILLM } from "./openai-adapters";

/**
 * Tiny ManualReflectionPolicy — explicit-only firing (ADR-0005).
 *
 * v0.0 ships this as the only built-in. ThresholdReflectionPolicy +
 * SleepTimeReflectionPolicy (v0.4a) are coupled to PgvectorStore via
 * `bumpReflectionCounter`; for the in-memory demo path we wire the manual
 * policy so the "Run reflection" UI button works AND Memory.reflect() in
 * the route handler does not throw ReflectionNotConfigured.
 */
class DemoManualReflectionPolicy implements ManualReflectionPolicy {
  readonly kind = "manual" as const;
  async shouldReflect(_scope: Scope, _trigger: ReflectionTrigger): Promise<boolean> {
    return true;
  }
}

declare global {
  // eslint-disable-next-line no-var
  var _themory_demo_memory: Promise<Memory> | undefined;
}

export function getMemory(): Promise<Memory> {
  if (globalThis._themory_demo_memory === undefined) {
    globalThis._themory_demo_memory = (async () => {
      const embedder = new OpenAIEmbedder();
      const llm = new OpenAILLM();
      const vectorStore = new InMemoryVectorStore();
      const reflectionPolicy = new DemoManualReflectionPolicy();
      return createMemory({ embedder, llm, vectorStore, reflectionPolicy });
    })();
  }
  return globalThis._themory_demo_memory;
}
