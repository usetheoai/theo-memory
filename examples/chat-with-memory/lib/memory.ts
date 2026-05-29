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
import { OpenAIEmbedder, OpenAILLM } from "./openai-adapters";

let memoryPromise: Promise<Memory> | null = null;

export function getMemory(): Promise<Memory> {
  if (memoryPromise === null) {
    memoryPromise = (async () => {
      const embedder = new OpenAIEmbedder();
      const llm = new OpenAILLM();
      const vectorStore = new InMemoryVectorStore();
      return createMemory({ embedder, llm, vectorStore });
    })();
  }
  return memoryPromise;
}
