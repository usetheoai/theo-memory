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
 * @see plan v0-4a-reflection-pipeline § T1.2 EC-1
 *
 * Thrown by AdditiveWeightedScoring's constructor when ALL three weights are 0.
 * A strategy with all-zero weights would return NaN (0/0) per memory; fail fast
 * with this guard. providedWeights field lets the caller log what was misconfigured.
 */
export class InvalidScoringWeightsError extends Error {
  override readonly name = 'InvalidScoringWeightsError' as const;

  readonly providedWeights: { readonly recency: number; readonly relevance: number; readonly importance: number };

  constructor(
    providedWeights: { recency: number; relevance: number; importance: number },
    options?: ErrorOptions,
  ) {
    super(
      `Invalid scoring weights: at least one weight must be > 0. Provided: recency=${String(providedWeights.recency)}, relevance=${String(providedWeights.relevance)}, importance=${String(providedWeights.importance)}.`,
      options,
    );
    this.providedWeights = { ...providedWeights };
    Object.setPrototypeOf(this, InvalidScoringWeightsError.prototype);
  }
}

/**
 * @see plan v0-4a-reflection-pipeline § T2.1 EC-3
 *
 * Thrown by ThresholdReflectionPolicy.shouldReflect when the supplied Scope
 * has NO non-empty userId/sessionId/agentId field. The reflection_counters
 * table's CHECK constraint (T0.2 EC-3) would reject the row at SQL level;
 * this fail-fast guard surfaces a typed error to the consumer BEFORE the SQL
 * round-trip, avoiding raw Postgres CHECK violation propagation.
 */
export class EmptyScopeError extends Error {
  override readonly name = 'EmptyScopeError' as const;

  constructor(options?: ErrorOptions) {
    super(
      'Scope is empty: at least one of userId / sessionId / agentId must be non-empty. ' +
        'All-NULL scopes cannot be persisted in reflection_counters per the table CHECK constraint.',
      options,
    );
    Object.setPrototypeOf(this, EmptyScopeError.prototype);
  }
}

/**
 * @see plan v0-4a-reflection-pipeline § T3.1 EC-4
 *
 * Thrown by SleepTimeReflectionPolicy's constructor when the provided cron
 * expression is empty OR cannot be parsed by `croner`. Validation is EAGER
 * (at construction, not lazily at start()) so misconfiguration surfaces at
 * boot — not on first tick.
 *
 * Exposes the providedExpression field so the caller can log / report the bad config.
 */
export class InvalidCronExpressionError extends Error {
  override readonly name = 'InvalidCronExpressionError' as const;

  readonly providedExpression: string;

  constructor(providedExpression: string, options?: ErrorOptions) {
    super(
      `Invalid cron expression: ${providedExpression === '' ? '(empty string)' : `"${providedExpression}"`}. ` +
        `Must be a valid croner-parseable cron expression (5 or 6 fields).`,
      options,
    );
    this.providedExpression = providedExpression;
    Object.setPrototypeOf(this, InvalidCronExpressionError.prototype);
  }
}

/**
 * @see plan v0-4a-reflection-pipeline § T4.1
 *
 * Thrown by executeReflection() when the LLM returns content that cannot be
 * parsed as a strict JSON array of `{text, derived_from}` objects. Distinct
 * from ReflectionProvenanceMissingError (T4.2) which validates IDs against
 * the source set.
 *
 * Exposes the raw LLM response for debugging.
 */
export class ReflectionLLMResponseError extends Error {
  override readonly name = 'ReflectionLLMResponseError' as const;

  readonly rawResponse: string;

  constructor(rawResponse: string, message: string, options?: ErrorOptions) {
    super(`Reflection LLM response error: ${message}`, options);
    this.rawResponse = rawResponse;
    Object.setPrototypeOf(this, ReflectionLLMResponseError.prototype);
  }
}

/**
 * @see plan v0-4a-reflection-pipeline § T4.2 + ADR D7
 *
 * Thrown by validateProvenance() when a DerivedMemoryDraft has either:
 *  - empty `derivedFrom` array (no source citation), OR
 *  - `derivedFrom` referencing IDs not present in the source set sent to the LLM.
 *
 * Fail-fast invariant per ADR D7: every derived memory MUST cite at least one
 * SOURCE memory; LLM hallucinations of fake IDs are rejected BEFORE persist.
 *
 * Exposes unknownIds + offendingDraftIndex for debugging.
 */
export class ReflectionProvenanceMissingError extends Error {
  override readonly name = 'ReflectionProvenanceMissingError' as const;

  readonly unknownIds: readonly string[];
  readonly offendingDraftIndex: number;

  constructor(
    offendingDraftIndex: number,
    unknownIds: readonly string[],
    message: string,
    options?: ErrorOptions,
  ) {
    super(
      `Reflection provenance missing at draft[${String(offendingDraftIndex)}]: ${message} (unknown ids: ${unknownIds.length === 0 ? '(empty)' : unknownIds.join(', ')})`,
      options,
    );
    this.offendingDraftIndex = offendingDraftIndex;
    this.unknownIds = [...unknownIds];
    Object.setPrototypeOf(this, ReflectionProvenanceMissingError.prototype);
  }
}

/**
 * @see plan v0-4a-reflection-pipeline § T5.1
 *
 * Thrown by scoreImportance() when the LLM response cannot be parsed into a
 * number in [1, 10]. Exposes rawResponse for debugging.
 */
export class ImportanceScoringError extends Error {
  override readonly name = 'ImportanceScoringError' as const;

  readonly rawResponse: string;

  constructor(rawResponse: string, message: string, options?: ErrorOptions) {
    super(`Importance scoring error: ${message}`, options);
    this.rawResponse = rawResponse;
    Object.setPrototypeOf(this, ImportanceScoringError.prototype);
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

/**
 * @see plan skill-library § T2.1 (insertSkill / insertDerivedSkill edge cases)
 *
 * Thrown by VectorStore.insertSkill / insertDerivedSkill when the supplied
 * skill payload violates the v0.6 contract. The store layer rejects at the
 * boundary BEFORE the SQL INSERT so consumers see a typed error instead of a
 * Postgres CHECK violation or a confusing empty-string round-trip.
 *
 * Reasons enumerated:
 *  - `'empty-description'`     — `description` is empty/whitespace (embedding target cannot be empty).
 *  - `'invalid-code-language'` — `codeLanguage` is not one of the SkillLanguage union members.
 *  - `'empty-derived-from'`    — `insertDerivedSkill` called with zero source ids.
 */
export class InvalidSkillError extends Error {
  override readonly name = 'InvalidSkillError' as const;

  readonly reason: 'empty-description' | 'invalid-code-language' | 'empty-derived-from';

  constructor(
    reason: 'empty-description' | 'invalid-code-language' | 'empty-derived-from',
    detail: string,
    options?: ErrorOptions,
  ) {
    super(`Invalid skill (${reason}): ${detail}`, options);
    this.reason = reason;
    Object.setPrototypeOf(this, InvalidSkillError.prototype);
  }
}
