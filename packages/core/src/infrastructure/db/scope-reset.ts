/**
 * `Memory.reset(scope)`: the administrative wipe of one scope partition. It deletes the
 * partition's memories (including soft-deleted rows), every message the raw log holds for
 * it, and its cached recalls, and nothing outside it.
 *
 * The partition is the one the scope writes to. A user-bound session reads its own rows plus
 * the user's global rows, but that hierarchy is a recall predicate; reset drops it so wiping a
 * session never deletes the user's durable memories (#247).
 */
import type { RecallCacheStore } from '../../domain/dip/recall-cache-store.js';
import { MemoryStoreError } from '../../domain/errors.js';
import type { Filters, Scope } from '../../domain/scope.js';

import type { LocalMemoryConfig } from './config.js';
import { filtersFromScope } from './scoped-memory.js';

/** Rows listed per pass. The loop runs until the partition is empty. */
const RESET_PAGE_SIZE = 10_000;

export function partitionFiltersFromScope(scope: Scope, workspaceId: string | undefined): Filters {
  const filters = filtersFromScope(scope, workspaceId);
  if (filters.scopeHierarchy === undefined || filters.scopeHierarchy === 'global') return filters;
  const { scopeHierarchy: _recallOnly, ...partition } = filters;
  return partition;
}

export async function resetScope(
  config: LocalMemoryConfig,
  recallCacheStore: RecallCacheStore | undefined,
  scope: Scope,
  workspaceId: string | undefined,
): Promise<void> {
  const filters = partitionFiltersFromScope(scope, workspaceId);
  const deleted = new Set<string>();
  for (;;) {
    const [rows] = await config.vectorStore.list(filters, RESET_PAGE_SIZE, true);
    if (rows.length === 0) break;
    for (const row of rows) {
      if (deleted.has(row.id)) {
        throw new MemoryStoreError(`reset: memory ${row.id} is still listed after its delete; the scope was not wiped`);
      }
      await config.vectorStore.delete(row.id);
      deleted.add(row.id);
    }
  }
  // Postgres already erased the messages linked to those memories (trigger); this also
  // removes turns that produced no memory, and covers adapters without the trigger.
  const log = config.messageLog;
  if (log !== undefined && log !== false) await log.eraseScope(filters);
  await recallCacheStore?.invalidateScope(scope, workspaceId);
}
