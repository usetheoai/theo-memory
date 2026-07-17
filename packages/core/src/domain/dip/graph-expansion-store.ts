/**
 * GraphExpansionStore DIP — recall-time entity-graph traversal port.
 *
 * Given the threshold-passing seed memories of a recall, traverse the relational
 * entity graph (the EXISTING `entities` / `memory_entities` / `entity_edges`
 * tables) to find OTHER memories CONNECTED to the seeds by a shared entity
 * (1 hop) or a relation edge (opt-in 2nd hop). The recall pipeline (Step 8.7)
 * uses the result to POOL-EXPAND results with connected memories that did not
 * pass the similarity threshold on their own (Princípio 2 — priorização via the
 * structural signal, not raw volume).
 *
 * **1 method** (ISP, within the ADR-0008 method-count cap). Distinct from
 * `MemoryGraphStore` (which is locked at 2 methods, upsert + list, by its own
 * JSDoc) — recall-time traversal is a separate read concern; this port does NOT
 * widen that one.
 *
 * **Contract:**
 *   - Returns connected memories as the domain `VectorStoreResult` DTO (so the
 *     pipeline builds result rows WITHOUT a second fetch round-trip) + the
 *     `sharedEntities` weight (count of distinct entities shared with the seeds).
 *   - MUST exclude the seed ids themselves.
 *   - MUST scope-confine the CANDIDATE memory by `filters` (workspace +
 *     user/session/agent) — a same-entity memory in a DIFFERENT scope is NEVER
 *     returned (EC-2 cross-scope isolation, ADR D5).
 *   - MUST honor `limit` (bounds fan-out on hub entities).
 *   - MAY throw; the pipeline wraps the call fail-soft (ADR D4) — a traversal
 *     outage degrades to the non-graph pool and NEVER takes down recall.
 *
 * **DIP boundary discipline** (architecture.md § 3): ZERO I/O, ZERO imports
 * from `src/infrastructure`. Impls: `PgGraphExpansionStore` (the JOIN) +
 * `InMemoryGraphExpansionStore` (test mirror).
 *
 * @see ADR-0008 (DIP method-count cap)
 */
import type { Filters } from '../scope.js';

import type { VectorStoreResult } from './vector-store.js';

export interface ExpandByEntitiesParams {
  /** The threshold-passing seed memory ids to traverse from. */
  readonly seedMemoryIds: readonly string[];
  /** Recall scope — the candidate memory is confined to this scope (EC-2, ADR D5). */
  readonly filters: Filters;
  /** Traversal depth: 1 = shared-entity self-join; 2 = + one relation-edge hop. */
  readonly hops: 1 | 2;
  /** Upper bound on returned connected memories (fan-out guard). */
  readonly limit: number;
}

/** One connected memory + its structural relevance weight. */
export interface GraphExpansionRow {
  /** The connected memory, projected as the domain row DTO (built into a result without a 2nd fetch). */
  readonly result: VectorStoreResult;
  /** Count of distinct entities this memory shares with the seed set. */
  readonly sharedEntities: number;
}

export interface GraphExpansionStore {
  /**
   * Traverse the entity graph from `seedMemoryIds` and return the connected
   * memories (excluding seeds, scope-confined, `limit`-bounded), ordered by
   * `sharedEntities` descending. MUST NOT mutate input.
   */
  expandByEntities(params: ExpandByEntitiesParams): Promise<readonly GraphExpansionRow[]>;
}
