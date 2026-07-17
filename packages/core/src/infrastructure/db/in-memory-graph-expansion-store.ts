/**
 * InMemoryGraphExpansionStore — an in-memory `GraphExpansionStore` for tests +
 * local/dev use (mirrors the shipped `InMemoryVectorStore` test-double precedent).
 *
 * The production traversal is SQL (`PgGraphExpansionStore`); the in-memory entity
 * graph is not modeled by `InMemoryVectorStore`, so this double takes an EXPLICIT
 * link table at construction and implements the SAME traversal SEMANTICS the pg
 * impl guarantees: shared-entity weight, seed exclusion (EC-1), candidate-side
 * scope confinement (EC-2, ADR D5), and `limit` bounding.
 *
 * @see src/domain/dip/graph-expansion-store.ts
 */
import type {
  ExpandByEntitiesParams,
  GraphExpansionRow,
  GraphExpansionStore,
} from '../../domain/dip/graph-expansion-store.js';
import type { VectorStoreResult } from '../../domain/dip/vector-store.js';
import type { Filters } from '../../domain/scope.js';

/** One memory's graph node: its row, its entity ids, and the scope it belongs to. */
export interface InMemoryGraphNode {
  readonly memoryId: string;
  readonly entityIds: readonly string[];
  readonly result: VectorStoreResult;
  readonly filters: Filters;
  /**
   * M0 — bi-temporal validity mirroring the pg store's `t_valid`/`t_invalid`.
   * Omitted/`null` `tInvalid` ⇒ currently-valid; omitted/`null` `tValid` ⇒
   * always-valid-since-creation (matches the SQL null-safe predicate).
   */
  readonly tValid?: Date | null;
  readonly tInvalid?: Date | null;
}

/**
 * M0 — mirror of `composeTemporalWhere` (ADR-0011) for the in-memory double.
 * When `asOf` is omitted, a node is valid iff it is currently-valid
 * (`tInvalid == null`). With `asOf`, it is the row valid at that instant.
 */
function isValidAt(node: InMemoryGraphNode, asOf: Date | undefined): boolean {
  const tValid = node.tValid ?? null;
  const tInvalid = node.tInvalid ?? null;
  if (asOf === undefined) {
    return tInvalid === null;
  }
  const validFrom = tValid === null || tValid.getTime() <= asOf.getTime();
  const notYetInvalid = tInvalid === null || tInvalid.getTime() > asOf.getTime();
  return validFrom && notYetInvalid;
}

function scopeMatches(node: Filters, want: Filters): boolean {
  // Candidate-side scope confinement (EC-2): every scope tier present in the
  // recall `want` must match the candidate's `node` tier exactly.
  if (want.workspace_id !== undefined && node.workspace_id !== want.workspace_id) return false;
  if (want.user_id !== undefined && node.user_id !== want.user_id) return false;
  if (want.session_id !== undefined && node.session_id !== want.session_id) return false;
  if (want.agent_id !== undefined && node.agent_id !== want.agent_id) return false;
  return true;
}

export class InMemoryGraphExpansionStore implements GraphExpansionStore {
  constructor(private readonly nodes: readonly InMemoryGraphNode[]) {}

  // eslint-disable-next-line @typescript-eslint/require-await -- DIP contract is async; logic is sync
  async expandByEntities(params: ExpandByEntitiesParams): Promise<readonly GraphExpansionRow[]> {
    const seedSet = new Set(params.seedMemoryIds);
    // Collect the entity ids of the seed memories.
    const seedEntities = new Set<string>();
    for (const n of this.nodes) {
      if (seedSet.has(n.memoryId)) {
        for (const e of n.entityIds) seedEntities.add(e);
      }
    }
    if (seedEntities.size === 0) return [];

    const rows: GraphExpansionRow[] = [];
    for (const n of this.nodes) {
      if (seedSet.has(n.memoryId)) continue; // EC-1 exclude seeds
      if (!scopeMatches(n.filters, params.filters)) continue; // EC-2 scope confine
      if (!isValidAt(n, params.filters.asOf)) continue; // M0 temporal correctness
      const shared = n.entityIds.filter((e) => seedEntities.has(e)).length;
      if (shared > 0) {
        rows.push({ result: n.result, sharedEntities: shared });
      }
    }
    rows.sort((a, b) => b.sharedEntities - a.sharedEntities);
    return rows.slice(0, params.limit);
  }
}
