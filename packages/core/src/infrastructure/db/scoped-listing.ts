/**
 * Scoped listing helpers — the this-free read-surface internals of
 * `LocalScopedMemory.getAll` / `.listSessions` (extracted 2026-07-23 for the
 * 300-line module budget, mirroring the M8 `scoped-retrieval.ts` precedent).
 * Behavior-preserving: the façade delegates verbatim.
 */
import type { VectorStoreResult } from '../../domain/dip/vector-store.js';
import { SessionsListingNotSupported } from '../../domain/errors.js';
import { emitEvent } from '../../domain/memory-event.js';
import type { MemoryItem } from '../../domain/memory-item.js';
import type { SessionSummary } from '../../domain/memory-store.js';
import type { GetAllOptions } from '../../domain/options.js';
import type { Filters, Scope } from '../../domain/scope.js';

import type { LocalMemoryConfig } from './config.js';
import { rowsToMemoryItems } from './row-mapping.js';
import { applySkillFilters } from './scope-filters.js';

type PagedRows = Promise<readonly [readonly VectorStoreResult[], number]>;

function mapRows(
  config: LocalMemoryConfig,
  scope: Scope,
  rows: readonly VectorStoreResult[],
): readonly MemoryItem[] {
  const { items, fallbackCount } = rowsToMemoryItems(rows, scope);
  if (fallbackCount > 0) {
    emitEvent(config.tracer, 'getall_temporal_fallback', { count: fallbackCount });
  }
  return items;
}

/**
 * `getAll` internals. theo-cloud#252: an `entity` option routes through the
 * duck-typed `listByEntity` extension (memory_entities join); a store without
 * it fails LOUDLY rather than silently returning the WHOLE scope (the exact
 * bug the filter closes — cascade-forget deleting unrelated memories).
 */
export async function getAllItems(
  config: LocalMemoryConfig,
  scope: Scope,
  filters: Filters,
  options?: GetAllOptions,
): Promise<readonly MemoryItem[]> {
  const limit = options?.topK ?? 100;
  const offset = options?.offset ?? 0;
  const scopedFilters = applySkillFilters(filters, options);
  if (options?.entity !== undefined && options.entity.length > 0) {
    const store = config.vectorStore as {
      listByEntity?: (filters?: Filters, entityName?: string, topK?: number, offset?: number) => PagedRows;
    };
    if (typeof store.listByEntity !== 'function') {
      throw new Error(
        'getAll({ entity }) requires a store with the listByEntity extension — use PgvectorStore or InMemoryVectorStore.',
      );
    }
    const [rows] = await store.listByEntity(scopedFilters, options.entity, limit, offset);
    return mapRows(config, scope, rows);
  }
  const [rows] = await config.vectorStore.list(scopedFilters, limit, false, offset);
  return mapRows(config, scope, rows);
}

/**
 * Session enumeration internals (session-separation fix 2026-07-23). Delegates
 * to the store's duck-typed `listSessions` extension, anchored on the
 * `(workspace, user)` of the scope's filters; a store without the capability
 * fails loudly (Rule 8 — never a silent empty list).
 */
export async function listScopeSessions(
  config: LocalMemoryConfig,
  filters: Filters,
): Promise<readonly SessionSummary[]> {
  const store = config.vectorStore as {
    listSessions?: (filters?: Filters) => Promise<readonly SessionSummary[]>;
  };
  if (typeof store.listSessions !== 'function') {
    throw new SessionsListingNotSupported(
      'listSessions requires a store with the listSessions extension — use PgvectorStore or InMemoryVectorStore.',
    );
  }
  const anchor: Filters = {
    ...(filters.workspace_id !== undefined ? { workspace_id: filters.workspace_id } : {}),
    ...(filters.user_id !== undefined && filters.user_id !== null ? { user_id: filters.user_id } : {}),
  };
  return store.listSessions(anchor);
}
