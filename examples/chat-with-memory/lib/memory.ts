/**
 * theo-memory singleton — boots once per process.
 *
 * Default backend: InMemoryVectorStore (zero infra). Swap to pgvector by
 * setting THEOMEM_PG_URI in `.env` and importing PgvectorStore here.
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

let memoryPromise: Promise<Memory> | null = null;

export function getMemory(): Promise<Memory> {
  if (memoryPromise === null) {
    memoryPromise = (async () => {
      const embedder = new OpenAIEmbedder();
      const llm = new OpenAILLM();
      const vectorStore = new InMemoryVectorStore();
      const reflectionPolicy = new DemoManualReflectionPolicy();
      return createMemory({ embedder, llm, vectorStore, reflectionPolicy });
    })();
  }
  return memoryPromise;
}
