/**
 * Result of a reflection cycle. Produced by Memory.reflect(); consumed by ReflectionPolicy.onReflectionEnd.
 *
 * @see ADR-0005 — reflection trigger (explicit-only at v0.0; policy DIP declared).
 */
import type { MemoryItem } from './memory-item.js';

export interface ReflectionResult {
  /** Higher-order memories created during reflection. Empty array if reflection produced no new facts. */
  readonly higherOrderMemories: readonly MemoryItem[];

  /** Memory ids the reflection drew from. Provenance for higherOrderMemories. */
  readonly sourceIds: readonly string[];
}
