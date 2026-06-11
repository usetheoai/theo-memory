/**
 * Invokes the shared VectorStore conformance suite against InMemoryVectorStore.
 * T3.2 of v0-1-local-runtime plan v1.3.
 */
import { InMemoryVectorStore } from './in-memory-store.js';
import { runVectorStoreConformance } from './vector-store-conformance.js';

runVectorStoreConformance('InMemoryVectorStore', async () => {
  const store = new InMemoryVectorStore();
  return {
    store,
    truncate: async () => {
      await store.deleteCol();
    },
  };
});
