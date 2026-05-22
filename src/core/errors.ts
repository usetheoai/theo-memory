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
