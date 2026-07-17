/**
 * Public subpath `@usetheo/memory/reranker-local` — local cross-encoder
 * reranker. Surfaces `CrossEncoderReranker` (the default `Reranker` impl,
 * cross-encoder via `@xenova/transformers`) so consumers can:
 *   - Wire it into `createLocalMemory({ reranker })`, then opt in per recall
 *     via `recall({ rerank: {} })`.
 *
 * Mirrors the `embedders/local` + `cache-pg` subpath-isolation precedent
 * (plan ADR D5 — the default `@usetheo/memory` barrel does NOT pull this
 * module, nor `@xenova/transformers`, transitively).
 *
 * @see package.json#exports."./reranker-local"
 */

export {
  CrossEncoderReranker,
  type CrossEncoderRerankerOptions,
} from './cross-encoder.js';
