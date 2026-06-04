/**
 * 8-phase write pipeline — T4.3 of v0-1-local-runtime plan v1.3.
 *
 * Port of reference TS port's `addToVectorStore`
 * (.claude/knowledge-base/references/REDACTED/reference TS port/src/oss/src/memory/index.ts:562-994) per blueprint
 * ADR D1 + plan ADR D1.0. Phases are named verbatim from the REDACTED code
 * comments at L588 / L606 / L626 / L695 / L716 / L783 / L851 / L976.
 *
 * Phase 0: context gather (system prompt + custom instructions)
 * Phase 1: existing retrieval + UUID→int mapping
 * Phase 2: LLM extraction (single call; Zod parse with EC-10 fallback)
 * Phase 3: batch embed (per-row fallback on batch failure)
 * Phase 4-5: dedup (MD5 hash check) + payload composition
 * Phase 6: batch persist (per-row fallback)
 * Phase 6.5: batch history persist (when historyManager present)
 * Phase 7: entity linking (deferred to v0.2; flag-gated via entityBoost config)
 * Phase 8: save messages (deferred to v0.2; historyManager.saveMessages optional)
 *
 * @see .claude/knowledge-base/plans/v0-1-local-runtime-plan.md § T4.3 + ADR D1.0
 * @see .claude/knowledge-base/references/REDACTED/reference TS port/src/oss/src/memory/index.ts:562-994
 */
import { randomUUID } from 'node:crypto';

import type { Tracer } from '@opentelemetry/api';

import { hashFact } from '../dedup.js';
import type { Embedder } from '../dip/embedder.js';
import type { HistoryBatchRecord, HistoryManager } from '../dip/history-manager.js';
import type { LLM } from '../dip/llm.js';
import type { InsertOutcome, VectorStore } from '../dip/vector-store.js';
import { lemmatizeForBm25 } from '../lemmatization.js';
import { emitEvent } from '../memory-event.js';
import type { MemoryItem } from '../memory-item.js';
import type { Message } from '../message.js';
import type { RememberOptions } from '../options.js';
import type { Filters, Scope } from '../scope.js';

import { AdditiveExtractionSchema, generateAdditiveExtractionPrompt } from './prompt.js';

export interface ExtractionDeps {
  readonly vectorStore: VectorStore;
  readonly embedder: Embedder;
  readonly llm: LLM;
  readonly historyManager?: HistoryManager;
  readonly tracer?: Tracer;
  readonly customInstructions?: string;
}

type Payload = Record<string, string | number | boolean | null>;

function scopeFromFilters(filters: Filters): Scope {
  if (filters.user_id !== undefined) {
    return { kind: 'user', userId: filters.user_id };
  }
  if (filters.session_id !== undefined) {
    return { kind: 'session', sessionId: filters.session_id };
  }
  if (filters.agent_id !== undefined) {
    return { kind: 'agent', agentId: filters.agent_id };
  }
  // Plan v1.3 enforces non-empty scope at the factory boundary (EC-13); here we trust the caller.
  return { kind: 'user', userId: '' };
}

function buildPayload(text: string, hash: string, filters: Filters, metadata: Payload | undefined): Payload {
  const out: Payload = { text, hash };
  if (filters.user_id !== undefined) {
    out['user_id'] = filters.user_id;
  }
  if (filters.session_id !== undefined) {
    out['session_id'] = filters.session_id;
  }
  if (filters.agent_id !== undefined) {
    out['agent_id'] = filters.agent_id;
  }
  if (metadata !== undefined) {
    for (const [k, v] of Object.entries(metadata)) {
      out[k] = v;
    }
  }
  return out;
}

function toMemoryItem(id: string, text: string, hash: string, scope: Scope, metadata: Payload, now: Date): MemoryItem {
  // v1.1 T2.1: surface attributed_to on the DTO. Reads from payload because
  // both the LLM-extraction path AND the verbatim path route attribution
  // through the payload key BEFORE this conversion.
  const attributedToRaw = metadata['attributed_to'];
  const attributedTo = typeof attributedToRaw === 'string' ? attributedToRaw : undefined;
  return {
    id,
    text,
    hash,
    scope,
    createdAt: now,
    updatedAt: now,
    metadata,
    tValid: now,
    tInvalid: null,
    ...(attributedTo !== undefined ? { attributedTo } : {}),
  };
}

/**
 * `infer: false` fast-path (REDACTED reference index.ts:568-586).
 * Each message becomes one verbatim memory; no LLM call, no entity store.
 */
async function runInferFalsePath(
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
    const now = new Date();
    const metadata = options?.metadata ?? {};
    const payload = buildPayload(msg.content, hash, filters, metadata);
    // v1.1 T2.1 + EC-2: verbatim path attribution. RememberOptions.attributedTo
    // routes through the payload to the column hoist in pgvector-store.
    if (options?.attributedTo !== undefined) {
      payload['attributed_to'] = options.attributedTo;
    }
    items.push(toMemoryItem(id, msg.content, hash, scope, payload, now));
    vectors.push(vector);
    ids.push(id);
    payloads.push(payload);
  }
  if (vectors.length > 0) {
    const outcomes = await deps.vectorStore.insert(vectors, ids, payloads);
    return patchItemsWithOutcomes(items, outcomes);
  }
  return items;
}

/**
 * principles-alignment-hardening T2.1 — patch MemoryItem instances with
 * UPSERT outcomes from the vector store. Surfaces Princípio 1 (confirmação)
 * + Princípio 3 (rejectedAsDuplicate IGNORE auditability) on the DTO.
 *
 * Outcomes are matched by id (input-order positional match is the fast path;
 * Map fallback handles the per-row insert path where positional order may
 * differ from the original input).
 */
function patchItemsWithOutcomes(
  items: readonly MemoryItem[],
  outcomes: readonly InsertOutcome[],
): readonly MemoryItem[] {
  if (outcomes.length === 0) {
    return items;
  }
  const byId = new Map(outcomes.map((o) => [o.id, o]));
  return items.map((item) => {
    const outcome = byId.get(item.id);
    if (outcome === undefined) {
      return item;
    }
    return {
      ...item,
      confirmationCount: outcome.confirmationCount,
      rejectedAsDuplicate: outcome.rejectedAsDuplicate,
    };
  });
}

/** Phase 3: batch embed with per-row fallback on batch failure. */
async function embedBatchWithFallback(
  texts: readonly string[],
  embedder: Embedder,
  tracer: Tracer | undefined,
): Promise<readonly (readonly number[])[]> {
  emitEvent(tracer, 'embedding_batch_started', { count: texts.length });
  try {
    const vectors = await embedder.embedBatch(texts);
    emitEvent(tracer, 'embedding_batch_completed', { count: texts.length });
    return vectors;
  } catch {
    emitEvent(tracer, 'embedding_batch_fallback', { count: texts.length });
    const out: (readonly number[])[] = [];
    for (const text of texts) {
      try {
        out.push(await embedder.embed(text));
      } catch {
        out.push([]);
      }
    }
    return out;
  }
}

/** Phase 6: batch persist with per-row fallback. Returns per-id outcomes
 * surfacing UPSERT semantics for principles-alignment-hardening T2.1 wrap. */
async function persistWithFallback(
  vectorStore: VectorStore,
  vectors: readonly (readonly number[])[],
  ids: readonly string[],
  payloads: readonly Payload[],
  tracer: Tracer | undefined,
): Promise<readonly InsertOutcome[]> {
  emitEvent(tracer, 'persist_started', { count: ids.length });
  try {
    const outcomes = await vectorStore.insert(vectors, ids, payloads);
    emitEvent(tracer, 'persist_completed', { count: ids.length });
    return outcomes;
  } catch {
    emitEvent(tracer, 'persist_fallback', { count: ids.length });
    const outcomes: InsertOutcome[] = [];
    for (let i = 0; i < ids.length; i += 1) {
      try {
        const single = await vectorStore.insert(
          [vectors[i] as readonly number[]],
          [ids[i] as string],
          [payloads[i] as Payload],
        );
        outcomes.push(...single);
      } catch {
        // Log + skip; do not poison the batch
      }
    }
    return outcomes;
  }
}

/**
 * Main entry point. Runs the 8-phase write pipeline + returns the persisted MemoryItems.
 */
export async function runExtractionPipeline(
  messages: readonly Message[],
  filters: Filters,
  deps: ExtractionDeps,
  options?: RememberOptions,
): Promise<readonly MemoryItem[]> {
  const tracer = deps.tracer;

  // infer:false fast-path
  if (options?.infer === false) {
    return runInferFalsePath(messages, filters, deps, options);
  }

  // ============================================================
  // Phase 0: context gather (system prompt + custom instructions)
  // ============================================================
  emitEvent(tracer, 'extraction_started');

  // ============================================================
  // Phase 1: existing retrieval + UUID→int mapping
  // ============================================================
  // For v0.1 we keep this minimal: query the store for recent in-scope memories
  // to provide LLM context. The integer→UUID mapping is owned by the prompt composer.
  const existingResults = await deps.vectorStore.list(filters, 5);
  const existingItems: MemoryItem[] = existingResults[0].map((r) => {
    const text = String(r.payload['text'] ?? '');
    const hash = String(r.payload['hash'] ?? r.id);
    const now = new Date();
    return toMemoryItem(r.id, text, hash, scopeFromFilters(filters), { ...r.payload }, now);
  });

  // ============================================================
  // Phase 2: LLM extraction (single call; Zod parse with EC-10 fallback)
  // ============================================================
  const { prompt } = generateAdditiveExtractionPrompt(existingItems, messages, deps.customInstructions);
  let extracted: readonly { id: string; text: string; attributed_to?: string | undefined; linked_memory_ids?: string[] | undefined }[];
  try {
    const raw = await deps.llm.generateResponse(
      [
        { role: 'system', content: prompt },
        { role: 'user', content: messages.map((m) => `${m.role}: ${m.content}`).join('\n') },
      ],
      { type: 'json' },
    );
    const parsed = AdditiveExtractionSchema.parse(typeof raw === 'string' ? JSON.parse(raw) : raw);
    extracted = parsed.memory;
    emitEvent(tracer, 'extraction_completed', { facts: extracted.length });
  } catch {
    emitEvent(tracer, 'extraction_failed');
    return [];
  }

  if (extracted.length === 0) {
    return [];
  }

  // ============================================================
  // Phase 3: batch embed (per-row fallback)
  // ============================================================
  const texts = extracted.map((e) => e.text);
  const vectors = await embedBatchWithFallback(texts, deps.embedder, tracer);

  // ============================================================
  // Phase 4-5: dedup + payload composition
  // ============================================================
  const [existingPayloads] = await deps.vectorStore.list(filters, 500);
  const existingHashes = new Set<string>(
    existingPayloads.map((r) => String(r.payload['hash'] ?? '')),
  );

  const scope = scopeFromFilters(filters);
  const metadata = options?.metadata ?? {};

  const survivingIds: string[] = [];
  const survivingVectors: (readonly number[])[] = [];
  const survivingPayloads: Payload[] = [];
  const survivingItems: MemoryItem[] = [];

  for (let i = 0; i < extracted.length; i += 1) {
    const text = extracted[i]?.text ?? '';
    const vector = vectors[i] ?? [];
    if (vector.length === 0) {
      continue; // embed failed for this row; skip
    }
    const hash = hashFact(text);
    if (existingHashes.has(hash)) {
      emitEvent(tracer, 'dedup_skipped', { hash });
      continue;
    }
    existingHashes.add(hash);
    const id = randomUUID();
    const now = new Date();
    const payload = buildPayload(text, hash, filters, metadata);
    payload['text_lemmatized'] = lemmatizeForBm25(text).join(' ');
    // v1.1 T2.1 + EC-1 closed: LLM-emitted attributed_to propagates into
    // payload here so the pgvector-store hoist writes it to the column.
    // Pre-v1.1 this line was MISSING — extracted[i].attributed_to was discarded
    // at payload composition (the bug EC-1 documents). T2.1 closes it for new
    // writes; historical rows remain NULL per ADR D2 Consequences.
    const llmAttributedTo = extracted[i]?.attributed_to;
    if (llmAttributedTo !== undefined) {
      payload['attributed_to'] = llmAttributedTo;
    }
    survivingIds.push(id);
    survivingVectors.push(vector);
    survivingPayloads.push(payload);
    survivingItems.push(toMemoryItem(id, text, hash, scope, payload, now));
  }

  if (survivingIds.length === 0) {
    return [];
  }

  // ============================================================
  // Phase 6: batch persist (per-row fallback)
  // ============================================================
  const persistOutcomes = await persistWithFallback(
    deps.vectorStore,
    survivingVectors,
    survivingIds,
    survivingPayloads,
    tracer,
  );
  // principles-alignment-hardening T2.1 — patch surviving items with UPSERT
  // outcomes (confirmationCount + rejectedAsDuplicate) per ADR D1 + D4.
  const patchedItems = patchItemsWithOutcomes(survivingItems, persistOutcomes);
  // Replace the surviving items array in place so downstream history persist /
  // entity link / return path see the patched DTOs.
  survivingItems.length = 0;
  survivingItems.push(...(patchedItems as MemoryItem[]));

  // ============================================================
  // Phase 6.5: batch history persist
  // ============================================================
  if (deps.historyManager !== undefined) {
    const records: HistoryBatchRecord[] = survivingItems.map((item) => ({
      memoryId: item.id,
      previousValue: null,
      newValue: item.text,
      action: 'remember',
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }));
    try {
      if (deps.historyManager.batchAddHistory !== undefined) {
        await deps.historyManager.batchAddHistory(records);
      } else {
        for (const r of records) {
          await deps.historyManager.addHistory(
            r.memoryId,
            r.previousValue,
            r.newValue,
            r.action,
            r.createdAt,
            r.updatedAt,
          );
        }
      }
      emitEvent(tracer, 'history_persisted', { count: records.length });
    } catch {
      // Silent swallow per REDACTED pattern at index.ts:805-849 (history failure must not block write)
    }
  }

  // ============================================================
  // Phase 7: entity linking — deferred to v0.2 (gated by config.entityBoost at factory)
  // Phase 8: save messages — deferred to v0.2 (historyManager.saveMessages optional)
  // ============================================================
  // Both phases are scaffolded for v0.2 expansion; v0.1 ships the minimum viable
  // pipeline that closes Roadmap Item 2 acceptance criteria.

  return survivingItems;
}
