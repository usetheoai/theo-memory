/**
 * Importance scoring on write (#238). Opt-in through `ExtractionDeps.importanceScoring`: each fact
 * the store newly persisted gets one short LLM rating, mapped to [0, 1] and written by id inside
 * the write's scope through `VectorStore.setImportance`. Facts the store already held keep the
 * score they have. Fail-soft: a failed rating or write leaves the fact stored and unscored and
 * emits `importance_scoring_failed`; the write itself never fails because of it.
 */
import type { Tracer } from '@opentelemetry/api';

import type { LLM } from '../dip/llm.js';
import type { InsertOutcome, VectorStore } from '../dip/vector-store.js';
import { emitEvent } from '../memory-event.js';
import type { MemoryItem } from '../memory-item.js';
import { normalizeImportanceRating, scoreImportance } from '../reflection/importance.js';
import type { Filters } from '../scope.js';

/** Returns the items with `llmImportanceScore` set on the ones it scored. */
export async function scoreNewFacts(
  items: readonly MemoryItem[],
  outcomes: readonly InsertOutcome[],
  filters: Filters,
  store: VectorStore,
  llm: LLM,
  tracer: Tracer | undefined,
): Promise<readonly MemoryItem[]> {
  const fresh = new Set(outcomes.filter((o) => !o.rejectedAsDuplicate && o.idempotentReplay !== true).map((o) => o.id));
  if (fresh.size === 0) return items;
  if (store.setImportance === undefined) {
    emitEvent(tracer, 'importance_scoring_failed', { reason: 'store_unsupported', count: fresh.size });
    return items;
  }
  let scored = 0;
  const result = await Promise.all(items.map(async (item) => {
    if (!fresh.has(item.id)) return item;
    try {
      const importance = normalizeImportanceRating(await scoreImportance(item.text, llm));
      if (!(await store.setImportance!(filters, item.id, importance))) {
        emitEvent(tracer, 'importance_scoring_failed', { reason: 'row_not_found', count: 1 });
        return item;
      }
      scored += 1;
      return { ...item, llmImportanceScore: importance };
    } catch (err) {
      emitEvent(tracer, 'importance_scoring_failed', { reason: err instanceof Error ? err.name : 'UnknownError', count: 1 });
      return item;
    }
  }));
  if (scored > 0) emitEvent(tracer, 'importance_scored', { count: scored });
  return result;
}
