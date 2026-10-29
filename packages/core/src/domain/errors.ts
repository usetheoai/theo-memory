/**
 * Typed domain error classes. All `Error` subclasses MUST call
 * `Object.setPrototypeOf(this, ClassName.prototype)` in their constructor
 * to keep `instanceof` working across ESM/CJS, dynamic imports, and worker_threads
 * (EC-2 absorption — see edge-case review of plan v1.0).
 *
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

/**
 * InvalidRoutingPolicy — thrown when a `RoutingPolicyStore.put` payload fails the
 * `RoutingPolicySchema` (M11 T1.1). Fail-fast at the boundary (Rule 8): a bad
 * `defaultScope` / non-integer threshold is a caller error, never silently stored.
 */
export class InvalidRoutingPolicy extends Error {
  override readonly name = 'InvalidRoutingPolicy' as const;

  constructor(message: string, options?: ErrorOptions) {
    super(`Invalid routing policy: ${message}`, options);
    Object.setPrototypeOf(this, InvalidRoutingPolicy.prototype);
  }
}

/**
 * RerankerConflict — thrown when `recall()` is called with BOTH
 * `options.diversify` AND `options.rerank` set. Both are post-threshold reranks
 * of the same candidate pool; stacking them is a double-rerank with undefined
 * precedence (diversity undoes the relevance lift, or vice-versa). Fail-loud at
 * the boundary rather than silently picking one (Princípio 3 + Inquebrável
 * Rule 8). Distinct from the model-inference fail-soft (plan ADR D4): this is a
 * consumer-error fail-fast thrown BEFORE any inference.
 *
 */
export class RerankerConflict extends Error {
  override readonly name = 'RerankerConflict' as const;

  constructor(options?: ErrorOptions) {
    super(
      'recall() received both `diversify` and `rerank` — they are mutually exclusive post-threshold reranks; set at most one.',
      options,
    );
    Object.setPrototypeOf(this, RerankerConflict.prototype);
  }
}

/**
 * InvalidOntology — thrown when a domain ontology config is invalid: an unknown
 * built-in registry key, OR a custom `Ontology` failing schema validation (empty
 * `entityTypes`/`relationTypes`, or `entityTypes` missing the `OTHER` coercion
 * fallback). Fail-fast at the factory boundary (config error), distinct from the
 * runtime fail-soft coercion of out-of-vocab LLM output.
 *
 */
export class InvalidOntology extends Error {
  override readonly name = 'InvalidOntology' as const;

  constructor(message: string, options?: ErrorOptions) {
    super(`Invalid ontology: ${message}`, options);
    Object.setPrototypeOf(this, InvalidOntology.prototype);
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

/**
 * /review F-Mi4 — typed config-validation error for `embeddingDim`.
 *
 * Previously `validateEmbeddingDim` (src/local/index.ts) threw `InvalidScope`
 * for dim errors at boot; this conflated Scope-level violations (empty
 * scope key, wrong tier, EC-13 reset guard) with config-shape problems
 * (NaN / float / negative / > MAX). The plan deferred naming; this class
 * closes that deferral so callers can `instanceof InvalidEmbeddingDim`
 * to distinguish boot-time config defects from runtime scope misuse.
 */
export class InvalidEmbeddingDim extends Error {
  override readonly name = 'InvalidEmbeddingDim' as const;

  /** @param received — the literal value passed in, included in the message verbatim for operator diagnosability. */
  constructor(received: unknown, maxDim: number, options?: ErrorOptions) {
    super(
      `embeddingDim must be a positive integer ≤ ${String(maxDim)}; got ${String(received)}`,
      options,
    );
    Object.setPrototypeOf(this, InvalidEmbeddingDim.prototype);
  }
}

/**
 * Thrown by {@link validateRecallCacheStoreConfig} (T0.1) when the
 * `RecallCacheStoreConfig` fails any invariant — out-of-bounds threshold,
 * negative TTL per scope-tier (EC-1 + EC-3 absorptions).
 *
 * @see Plan semantic-recall-cache-v1-5 § ADR D1+D2+D3
 * @see src/core/dip/recall-cache-store.ts
 */
export class InvalidCacheConfig extends Error {
  override readonly name = 'InvalidCacheConfig' as const;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    Object.setPrototypeOf(this, InvalidCacheConfig.prototype);
  }
}

/**
 * Thrown by {@link validateRecallTraceStoreConfig} (explainable-recall T0.1)
 * when the `RecallTraceStoreConfig` fails an invariant — `maxRowsPerRecall`
 * not a positive integer ≤ `MAX_ROWS_PER_RECALL` (EC-1: the Postgres
 * bind-param guard; the NaN / non-integer half mirrors the
 * {@link InvalidCacheConfig} IEEE-754 precedent).
 *
 * @see plan explainable-recall § Phase 0 / T0.1
 * @see packages/core/src/domain/dip/recall-trace-store.ts
 */
export class InvalidRecallTraceConfig extends Error {
  override readonly name = 'InvalidRecallTraceConfig' as const;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    Object.setPrototypeOf(this, InvalidRecallTraceConfig.prototype);
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
 * EmbedderUnavailableError — thrown by the embedder registry (`createEmbedder`)
 * when an SDK-based provider's OPTIONAL dependency is not installed in the
 * runtime (e.g. `createEmbedder({ provider: 'openai' })` without the `openai`
 * SDK, or `'local'` without `@xenova/transformers`). Distinct from
 * `EmbedderError` (provider reachable but failing) and from an unknown-provider
 * key (also `EmbedderError`). The message carries an install hint. Mirrors
 * `SkillExecutorUnavailableError`.
 *
 */
export class EmbedderUnavailableError extends Error {
  override readonly name = 'EmbedderUnavailableError' as const;

  constructor(provider: string, dep: string, options?: ErrorOptions) {
    super(
      `Embedder provider '${provider}' is unavailable: the '${dep}' package is not installed. Install it (e.g. \`pnpm add ${dep}\`) to use this provider, or choose a fetch-based provider (ollama / voyage / google) that needs no SDK.`,
      options,
    );
    Object.setPrototypeOf(this, EmbedderUnavailableError.prototype);
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

/**
 * Thrown when a request addresses a resource that exists in a DIFFERENT
 * workspace than the authenticated {@link Principal}'s. Maps to HTTP 404 (NOT
 * 403) at the boundary so the response does not leak the resource's existence
 * in another tenant (ADR D6 + OWASP IDOR guidance).
 *
 */
export class WorkspaceMismatch extends Error {
  override readonly name = 'WorkspaceMismatch' as const;

  constructor(message: string, options?: ErrorOptions) {
    super(`Workspace mismatch: ${message}`, options);
    Object.setPrototypeOf(this, WorkspaceMismatch.prototype);
  }
}

/**
 * Thrown by `ScopedSkillMemory.add()` when the skill's content-derived hash
 * (`hashFact(description)`) collides with an existing skill in the same scope —
 * the `UNIQUE(hash)` index rejects the insert. Skills are ADD-only
 * (architecture.md § 2): the existing row is unchanged (first-write-wins). To
 * store a variant, revise the `description` (distinct hash) or `forget(id)` then
 * `add(...)`. Maps to HTTP 409 at the REST boundary (skills-write-surface D1).
 *
 */
export class SkillAlreadyExists extends Error {
  override readonly name = 'SkillAlreadyExists' as const;

  readonly hash: string;
  readonly repoId: string;

  constructor(hash: string, repoId: string, options?: ErrorOptions) {
    super(
      `Skill already exists in repo '${repoId}' (hash ${hash}): a skill with this description is already stored. Revise the description or forget the existing skill first.`,
      options,
    );
    this.hash = hash;
    this.repoId = repoId;
    Object.setPrototypeOf(this, SkillAlreadyExists.prototype);
  }
}

/**
 * Reason a skill execution was denied by a sandbox guard. One literal per denial
 * path. The literal is carried on {@link ToolInvocationDeniedError.reason} and
 * emitted on the `tool_invocation_denied` OTel event for auditability (Princípio 3).
 *
 * All nine literals are wired by the v1 `SandboxedSkillExecutor` (T1.3). A future
 * host-callback bridge (a skill calling back into host tools) will add its own
 * per-call cap literal WITH backing code at that time (not pre-declared — review
 * 2026-06-22 F-arch-1/2 removed the unimplemented `tool-call-cap` seam per YAGNI).
 *
 */
export type ToolInvocationDeniedReason =
  | 'node-binding-attempt'
  | 'fs-access-attempt'
  | 'timeout'
  | 'output-cap'
  | 'non-cloneable-args'
  | 'non-cloneable-result'
  | 'unsupported-language'
  | 'unsupported-async'
  | 'empty-code';

/**
 * Thrown when a sandbox guard denies a skill execution. Carries a stable
 * {@link ToolInvocationDeniedReason} discriminant so callers (and the
 * `tool_invocation_denied` audit event) can distinguish denial classes. Maps to
 * HTTP 403 at the REST boundary. Distinct from {@link SkillExecutionNotConfiguredError}
 * (no executor wired → 501) and {@link SkillExecutorUnavailableError} (sandbox
 * backend not installed → 503).
 *
 */
export class ToolInvocationDeniedError extends Error {
  override readonly name = 'ToolInvocationDeniedError' as const;

  readonly reason: ToolInvocationDeniedReason;

  constructor(reason: ToolInvocationDeniedReason, detail: string, options?: ErrorOptions) {
    super(`Skill execution denied (${reason}): ${detail}`, options);
    this.reason = reason;
    Object.setPrototypeOf(this, ToolInvocationDeniedError.prototype);
  }
}

/**
 * Thrown when `ScopedSkillMemory.execute()` is called but no `SkillExecutor` was
 * wired into the memory (execution is opt-in/gated per ADR D3 — STORE-only is the
 * default). Maps to HTTP 501 at the REST boundary.
 *
 */
export class SkillExecutionNotConfiguredError extends Error {
  override readonly name = 'SkillExecutionNotConfiguredError' as const;

  constructor(message: string, options?: ErrorOptions) {
    super(`Skill execution not configured: ${message}`, options);
    Object.setPrototypeOf(this, SkillExecutionNotConfiguredError.prototype);
  }
}

/**
 * Thrown when the optional sandbox backend (the `isolated-vm` native addon) is not
 * installed in the runtime. Distinct from a denial (the skill never ran) and from
 * not-configured (an executor IS wired but its backend is missing). The message
 * carries an install hint. Maps to HTTP 503 at the REST boundary.
 *
 */
export class SkillExecutorUnavailableError extends Error {
  override readonly name = 'SkillExecutorUnavailableError' as const;

  constructor(backend: string, options?: ErrorOptions) {
    super(
      `Skill executor unavailable: the '${backend}' sandbox backend is not installed. Install it (e.g. \`pnpm add ${backend}\`) to enable skill execution.`,
      options,
    );
    Object.setPrototypeOf(this, SkillExecutorUnavailableError.prototype);
  }
}

/**
 * Thrown by `ScopedMemory.listSessions()` when the wired vector store lacks the
 * duck-typed `listSessions` extension (session-separation fix 2026-07-23). A
 * silent `[]` would be dishonest — the sessions may exist but be unenumerable.
 * Maps to HTTP 501 at the REST boundary.
 */
export class SessionsListingNotSupported extends Error {
  override readonly name = 'SessionsListingNotSupported' as const;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    Object.setPrototypeOf(this, SessionsListingNotSupported.prototype);
  }
}

/**
 * Thrown at boot when a pool intended for background, workspace-spanning work
 * cannot actually reach across workspaces — or reaches through a privilege
 * nobody declared.
 *
 * A retention sweep exists to look at every workspace's rows. Migration 0029
 * made the tables fail-closed, so over a connection with no cross-workspace
 * policy the sweep does not error: it deletes zero rows and returns, which
 * looks exactly like a quiet night. Refusing to start is the only way that
 * silence becomes something a person can read.
 *
 * @see infrastructure/db/background-pool-reach.ts — the measurement
 */
export class BackgroundPoolReachError extends Error {
  override readonly name = 'BackgroundPoolReachError' as const;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    Object.setPrototypeOf(this, BackgroundPoolReachError.prototype);
  }
}

/** Reusing an idempotency key for another request is a caller conflict, not a retry. */
export class IdempotencyConflict extends Error {
  override readonly name = 'IdempotencyConflict';
  constructor() { super('Idempotency key was already used for different content.'); }
}
