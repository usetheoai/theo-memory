/**
 * Payload size caps applied at the zod boundary BEFORE dispatch invokes Memory.
 *
 * Fail-fast guard against agent loops sending OOM-grade payloads to the embedder.
 *
 * @see EC-2 (plan v1.1) — payload size caps absorbed inline at T2.1
 */

/**
 * Maximum byte length for `remember.content` input.
 *
 * Chosen as ~12k tokens (rough 4 bytes/token estimate for English), aligned with
 * the v0.1 `MAX_EMBEDDING_DIM` cap. Rejection at zod surface → Protocol Error
 * `-32602 Invalid params` per ADR D6.
 */
export const MAX_CONTENT_BYTES = 50_000;

/**
 * Maximum byte length for `recall.query` input.
 *
 * Queries are typically nouns or short phrases (per discover blueprint Q6 finding); 2 KB is
 * generous for legitimate use and tight enough to catch payload abuse.
 */
export const MAX_QUERY_BYTES = 2_000;
