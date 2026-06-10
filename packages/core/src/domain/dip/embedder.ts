/**
 * Embedder DIP — adapter contract for embedding providers.
 *
 * @see ADR-0008 — DIP method counts (Embedder: 2 required).
 * @see ADR-0001 — upstream-shape architecture (auto-detected embedding dim via probe).
 */

export interface Embedder {
  /** Embed a single text. Provider-specific dimensionality. */
  embed(text: string): Promise<readonly number[]>;

  /**
   * Batch-embed many texts. Order MUST match input order.
   * Adapters SHOULD honor provider batch limits internally (chunked sub-calls);
   * the per-row fallback path (ADR-0001) handles partial batch failures.
   */
  embedBatch(texts: readonly string[]): Promise<readonly (readonly number[])[]>;
}
