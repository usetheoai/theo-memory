/**
 * Public surface for `@usetheo/memory` — T7.2 of v0-1-local-runtime plan v1.3.
 *
 * Consumers import from this barrel:
 *   import { createMemory, type Memory } from '@usetheo/memory'
 *
 * The default factory points at the local runtime (Postgres + pgvector).
 * The `@usetheo/memory/cloud` subpath (v0.5) will export `createCloudMemory`
 * for the TheoCloud-managed runtime; the `./contract` subpath stays as the
 * v0.0 contract-preview entry for adapter authors who only need types.
 */

// Default factory (local runtime)
export { createMemory, createLocalMemory, runMigrations } from './local/index.js';
export type { LocalMemoryConfig } from './local/index.js';

// Local-runtime adapter classes (advanced consumers wiring custom configs)
export { InMemoryVectorStore, PgvectorStore, DrizzleHistoryManager } from './local/index.js';
export { entities, history, memories } from './local/index.js';

// Re-export the full v0.0 contract from src/core
export * from './core/index.js';
