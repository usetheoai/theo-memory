/**
 * `infer:false` verbatim fast-path — split from pipeline-helpers.ts per the
 * 300-line module budget (SRP: the raw-store path is its own responsibility).
 *
 * Blueprint D1 (#111): this path performs NO inline entity extraction — upstream
 * parity. The graph for verbatim memories comes from the async LLM batch
 * backfill (blueprint D2).
 */
import { randomUUID } from 'node:crypto';

import { hashFact } from '../dedup.js';
import { IdempotencyConflict, MemoryStoreError } from '../errors.js';
import { attachEvidence, restoreDuplicateEvidence } from '../memory-evidence.js';
import type { MemoryItem } from '../memory-item.js';
import type { Message } from '../message.js';
import type { RememberOptions } from '../options.js';
import type { Filters } from '../scope.js';
import { attachWriteContext, writeRequestHash } from '../write-context.js';

import {
  buildPayload,
  patchItemsWithOutcomes,
  scopeFromFilters,
  toMemoryItem,
  type ExtractionDeps,
  type Payload,
} from './pipeline-helpers.js';

/**
 * `infer: false` fast-path (upstream reference index.ts:568-586).
 * Each message becomes one verbatim memory; no LLM call, no entity store.
 */
export async function runInferFalsePath(
  messages: readonly Message[],
  filters: Filters,
  deps: ExtractionDeps,
  options: RememberOptions | undefined,
): Promise<readonly MemoryItem[]> {
  const scope = scopeFromFilters(filters);
  const items: MemoryItem[] = [];
  const vectors: (readonly number[])[] = [];
  const ids: string[] = [];
  const payloads: Payload[] = [];
  for (const msg of messages) {
    if (msg.content.length === 0) {
      continue;
    }
    const id = randomUUID();
    const hash = hashFact(msg.content);
    const vector = await deps.embedder.embed(msg.content);
    if (options?.strictExtraction === true && vector.length === 0) {
      throw new MemoryStoreError('Memory write did not produce an embedding.');
    }
    const now = new Date();
    const metadata = options?.metadata ?? {};
    const payload = buildPayload(msg.content, hash, filters, metadata);
    attachWriteContext(payload, messages, options);
    attachEvidence(payload, options?.evidence);
    // v1.1 T2.1 + EC-2: verbatim path attribution. RememberOptions.attributedTo
    // routes through the payload to the column hoist in pgvector-store.
    if (options?.attributedTo !== undefined) {
      payload['attributed_to'] = options.attributedTo;
    }
    // themory-category-filter-server-side T3.3 — verbatim path category.
    // EC-2 length check ran at pipeline entry; here we just propagate. Routes
    // to payload['category'] so the pgvector-store hoist promotes it to the
    // top-level `category` column on INSERT.
    if (options?.category !== undefined) {
      payload['category'] = options.category;
    }
    items.push(toMemoryItem(id, msg.content, hash, scope, payload, now));
    vectors.push(vector);
    ids.push(id);
    payloads.push(payload);
  }
  if (vectors.length > 0) {
    let outcomes: Awaited<ReturnType<typeof deps.vectorStore.insert>>;
    try {
      outcomes = await deps.vectorStore.insert(vectors, ids, payloads);
    } catch (error) {
      if (error instanceof IdempotencyConflict) throw error;
      // The store saved nothing; say why instead of leaking a driver error type (#231).
      throw new MemoryStoreError('Memory persistence failed; nothing was saved.', { cause: error });
    }
    if (options?.idempotencyKey!==undefined && outcomes.some(outcome=>outcome.idempotentReplay===true) && deps.vectorStore.findWriteReplay!==undefined) {
      const replay=await deps.vectorStore.findWriteReplay(options.idempotencyKey,writeRequestHash(messages,options),filters);
      if(replay!==null)return replay.map(row=>({...toMemoryItem(row.id,String(row.payload['text']??''),String(row.payload['hash']??row.id),
        scope,{...row.payload},row.createdAt??new Date()),rejectedAsDuplicate:true,idempotentReplay:true}));
    }
    if (options?.strictExtraction === true && outcomes.length !== ids.length) {
      throw new MemoryStoreError('Memory persistence was incomplete; some facts may have been saved.');
    }
    // Blueprint D1 (#111, supersedes the 2026-06-20 item-2 fix): the verbatim path
    // performs NO inline entity extraction — upstream parity. The English-only
    // heuristic fallback over global corpora produced 83% graph noise; the graph for
    // verbatim memories is populated by the async LLM batch backfill (blueprint D2),
    // multilingual by construction and out of the hot path.
    return restoreDuplicateEvidence(patchItemsWithOutcomes(items, outcomes), deps.vectorStore);
  }
  return items;
}

