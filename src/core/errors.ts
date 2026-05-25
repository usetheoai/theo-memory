/**
 * Typed domain error classes. All `Error` subclasses MUST call
 * `Object.setPrototypeOf(this, ClassName.prototype)` in their constructor
 * to keep `instanceof` working across ESM/CJS, dynamic imports, and worker_threads
 * (EC-2 absorption — see edge-case review of plan v1.0).
 *
 * @see .claude/rules/architecture.md § 8 Error handling
 */

export class MemoryNotFound extends Error {
  override readonly name = 'MemoryNotFound' as const;

  constructor(memoryId: string, options?: ErrorOptions) {
    super(`Memory not found: ${memoryId}`, options);
    Object.setPrototypeOf(this, MemoryNotFound.prototype);
  }
}

export class InvalidScope extends Error {
  override readonly name = 'InvalidScope' as const;

  constructor(message: string, options?: ErrorOptions) {
    super(`Invalid scope: ${message}`, options);
    Object.setPrototypeOf(this, InvalidScope.prototype);
  }
}

export class EmbeddingMismatch extends Error {
  override readonly name = 'EmbeddingMismatch' as const;

  /** @param expectedDim — embedding dimension declared at write time. @param actualDim — dimension probed from the provider response. */
  constructor(expectedDim: number, actualDim: number, options?: ErrorOptions) {
    super(`Embedding dimension mismatch: expected ${String(expectedDim)}, got ${String(actualDim)}`, options);
    Object.setPrototypeOf(this, EmbeddingMismatch.prototype);
  }
}

export class BiTemporalNotSupportedLocally extends Error {
  override readonly name = 'BiTemporalNotSupportedLocally' as const;

  constructor(options?: ErrorOptions) {
    super(
      'Local runtime does not support bi-temporal asOf queries at v0.1. Use the cloud runtime (v0.5+) or query raw SQL against the t_valid/t_invalid columns.',
      options,
    );
    Object.setPrototypeOf(this, BiTemporalNotSupportedLocally.prototype);
  }
}

export class ReflectionNotConfigured extends Error {
  override readonly name = 'ReflectionNotConfigured' as const;

  constructor(options?: ErrorOptions) {
    super(
      'reflect() invoked but no ReflectionPolicy is configured. Pass a ReflectionPolicy in MemoryConfig (default: ManualReflectionPolicy).',
      options,
    );
    Object.setPrototypeOf(this, ReflectionNotConfigured.prototype);
  }
}

/**
 * @see ADR D4 — binding 3-state resolver fail-loud errors (plan v0-2-theokit-binding)
 *
 * Thrown by `@usetheo/memory/theokit`'s `memoryFromCtx` when consumer-supplied
 * `ctx.session.userId` cannot be resolved to a non-empty string — covers the two
 * "no usable scope" states:
 *   (b) `ctx.session === null` (unauthenticated request on a session-bearing context)
 *   (c) `ctx.session` field absent OR `ctx.session.userId` undefined/non-string/empty/whitespace
 * (state (a) — `userId` is a non-empty string — returns the scoped memory and does NOT throw)
 *
 * Caller-provided message lets the binding distinguish state (b) from state (c)
 * at the call site (e.g., "authenticated session required — call requireAuth(ctx.session) first").
 */
export class MissingScopeError extends Error {
  override readonly name = 'MissingScopeError' as const;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    Object.setPrototypeOf(this, MissingScopeError.prototype);
  }
}

/**
 * Thrown when a `MemoryStore` operation fails at the persistence boundary
 * (pg driver ECONNREFUSED/ETIMEDOUT/etc; pgvector index corruption; transaction
 * abort). Classified as Tool Execution Error per ADR D6 (T4.1) so MCP agent
 * loops can self-correct via retry.
 *
 * @see ADR D6 — Error mechanisms (TWO mechanisms per MCP spec)
 * @see EC-5 (plan v1.1) — pg transient codes mapped via this error class
 */
export class MemoryStoreError extends Error {
  override readonly name = 'MemoryStoreError' as const;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    Object.setPrototypeOf(this, MemoryStoreError.prototype);
  }
}

/**
 * Thrown when the embedding provider is unreachable, returns malformed data,
 * or exceeds rate limits. Classified as Tool Execution Error per ADR D6 so the
 * LLM can self-correct (retry after backoff).
 *
 * @see ADR D6 — Error mechanisms
 */
export class EmbedderError extends Error {
  override readonly name = 'EmbedderError' as const;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    Object.setPrototypeOf(this, EmbedderError.prototype);
  }
}

/**
 * Thrown when input content exceeds the embedder's per-call dimension cap
 * (1536 at v0.1 per pgvector HNSW limit; MAX_CONTENT_BYTES=50_000 at the
 * agent-tools boundary per EC-2). Classified as Tool Execution Error per ADR D6
 * with actionable text so the LLM can split + retry.
 *
 * @see ADR D6 — Error mechanisms
 * @see EC-2 (plan v1.1) — payload caps absorbed at the zod boundary
 */
export class ContentTooLargeError extends Error {
  override readonly name = 'ContentTooLargeError' as const;

  /**
   * @param maxBytes maximum allowed payload size in bytes
   * @param actualBytes observed payload size that triggered rejection
   */
  constructor(maxBytes: number, actualBytes: number, options?: ErrorOptions) {
    super(
      `Content exceeds maximum allowed payload: ${String(actualBytes)} bytes > ${String(maxBytes)} bytes. Split the input and retry.`,
      options,
    );
    Object.setPrototypeOf(this, ContentTooLargeError.prototype);
  }
}
