/**
 * Internal machinery for the write pipeline — pure helpers, per-row fallbacks,
 * the `infer:false` verbatim path, and the `ExtractionDeps` DIP bundle. Extracted
 * from `pipeline.ts` (behavior-preserving) to keep each module under the 500-line
 * budget; `pipeline.ts` re-exports the public `ExtractionDeps` + `applyOntologyToEntities`.
 */
import type { Tracer } from '@opentelemetry/api';

import type { Embedder } from '../dip/embedder.js';
import type { EntityExtractor } from '../dip/entity-extractor.js';
import type { HistoryManager } from '../dip/history-manager.js';
import type { LLM } from '../dip/llm.js';
import type { MemoryEntityStore } from '../dip/memory-entity-store.js';
import type { MemoryGraphStore } from '../dip/memory-graph-store.js';
import type { MessageLog } from '../dip/message-log.js';
import type { InsertOutcome, VectorStore } from '../dip/vector-store.js';
import { IdempotencyConflict } from '../errors.js';
import { emitEvent } from '../memory-event.js';
import { evidenceFromPayload } from '../memory-evidence.js';
import type { MemoryItem } from '../memory-item.js';
import { ONTOLOGY_FALLBACK_TYPE, type Ontology } from '../ontology.js';
import type { Filters, Scope } from '../scope.js';
import { validFromOf } from '../valid-from.js';

import { persistErrorAttributes } from './persist-error.js';
import type { AutoCategorizeConfig } from './taxonomy.js';

/**
 * Fail-soft bound for an LLM-emitted auto-category (auto-categorization-write-pipeline
 * EC-1/EC-2/EC-5): trim, then accept only 1-64 chars. A non-string, empty, whitespace-only,
 * or oversized value returns `null` (dropped) — NEVER throws (unlike the operator path).
 */
export function boundedAutoCategory(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length >= 1 && trimmed.length <= 64 ? trimmed : null;
}

/**
 * domain-ontologies T2.2 (ADR D2) — coerce LLM-extracted entity types to the
 * ontology vocabulary. Out-of-vocab types map to `OTHER` + emit
 * `ontology_type_coerced` (Princípio 3). Pure: returns a NEW array, no mutation.
 * Entities with no `type` are left untouched (downstream defaults them).
 */
export function applyOntologyToEntities(
  entities: readonly { name: string; type?: string | undefined }[],
  ontology: Ontology,
  tracer: Tracer | undefined,
): readonly { name: string; type?: string | undefined }[] {
  const allowed = new Set(ontology.entityTypes);
  return entities.map((e) => {
    if (e.type === undefined || allowed.has(e.type)) {
      return e;
    }
    // M13 /review F-tests-1 (plan T1.1 Deep Dive): LLMs occasionally emit the
    // vocabulary in lowercase ('person') — a case variant of an ALLOWED type is
    // normalized, never coerced to OTHER (no coercion event: intent matched).
    const upper = e.type.toUpperCase();
    if (allowed.has(upper)) {
      return { ...e, type: upper };
    }
    emitEvent(tracer, 'ontology_type_coerced', {
      ontology: ontology.name,
      from: e.type,
      to: ONTOLOGY_FALLBACK_TYPE,
      entity: e.name,
    });
    return { ...e, type: ONTOLOGY_FALLBACK_TYPE };
  });
}

export interface ExtractionDeps {
  /** Background services must not log model output or provider error details. */
  readonly redactErrorDetails?: boolean;
  readonly vectorStore: VectorStore;
  readonly embedder: Embedder;
  readonly llm: LLM;
  readonly historyManager?: HistoryManager;
  readonly tracer?: Tracer;
  readonly customInstructions?: string;
  /** entity-extraction-nodes-slice1 T3.1 — Phase 7 node ports. BOTH must be present
   *  for node linking to run (the factory threads them only when entityBoost !== false). */
  readonly entityExtractor?: EntityExtractor;
  readonly memoryEntityStore?: MemoryEntityStore;
  /** entity-relation-extraction-slice2 T2.2 — Phase 7 edge port. Threaded the same
   *  way as the node ports; relations come from the LLM (infer:true path only). */
  readonly memoryGraphStore?: MemoryGraphStore;
  /** domain-ontologies T2.2 (Item 15) — optional domain ontology. When present,
   *  its vocab is injected into the extraction prompt + the LLM's entity types
   *  are validated post-parse (out-of-vocab → OTHER, observable). */
  readonly ontology?: Ontology;
  /** auto-categorization-write-pipeline T3.1 — default-on model-derived category.
   *  When enabled (the default) and the caller supplied no `options.category`, the
   *  LLM-emitted per-fact `category` is written to `payload['category']` (trimmed +
   *  1-64 bounded, fail-soft). A caller category always overrides. */
  readonly autoCategorize?: AutoCategorizeConfig;
  /** Raw message log (ADR-0027). When present, writes are logged and linked to their facts, and
   *  the preceding turns of the scope reach the extractor as context. */
  readonly messageLog?: MessageLog;
  /** ADR-0029: let the extractor mark existing memories a new fact replaces (default true). */
  readonly supersedeOnWrite?: boolean;
  /** #238: rate each newly stored fact's importance with one LLM call (default false). */
  readonly importanceScoring?: boolean;
  /** How many preceding turns the extractor sees. Defaults to DEFAULT_CONTEXT_MESSAGE_COUNT. */
  readonly contextMessageCount?: number;
}

export type Payload = Record<string, string | number | boolean | null>;

/**
 * Extract plain text from an LLM `generateResponse` result. The LLM DIP returns a
 * bare string (most stubs) OR a `{ text }` object (OpenAILLM text-mode wraps the
 * content — see infrastructure/llms/openai.ts). Used by the EG-4 language-correction
 * guard, which needs the rewritten fact as a string. Returns '' when neither shape
 * yields a string (caller treats '' as "no correction" → keeps the original).
 */
export function extractResponseText(raw: unknown): string {
  if (typeof raw === 'string') {
    return raw;
  }
  if (raw !== null && typeof raw === 'object' && typeof (raw as { text?: unknown }).text === 'string') {
    return (raw as { text: string }).text;
  }
  return '';
}

export function scopeFromFilters(filters: Filters): Scope {
  const user = filters.user_id === undefined ? {} : { userId: filters.user_id };
  if (filters.session_id !== undefined) {
    return { kind: 'session', sessionId: filters.session_id, ...user };
  }
  if (filters.agent_id !== undefined) {
    return { kind: 'agent', agentId: filters.agent_id, ...user };
  }
  if (filters.user_id !== undefined) {
    return { kind: 'user', userId: filters.user_id };
  }
  // Plan v1.3 enforces non-empty scope at the factory boundary (EC-13); here we trust the caller.
  return { kind: 'user', userId: '' };
}

export function buildPayload(text: string, hash: string, filters: Filters, metadata: Payload | undefined): Payload {
  const out: Payload = { text, hash };
  // multi-tenant-workspace-isolation T3.1: carry the workspace into the payload
  // so the store insert hoists it to the workspace_id column. Sourced from the
  // Principal-bound filters (ADR D3), never from caller metadata.
  if (filters.workspace_id !== undefined) {
    out['workspace_id'] = filters.workspace_id;
  }
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
      if (!['workspace_id','user_id','session_id','agent_id','text','hash','confirmation_count','distinct_source_count','created_at','t_valid','t_invalid','origin_source_ids'].includes(k)) out[k] = v;
    }
  }
  return out;
}

export function toMemoryItem(id: string, text: string, hash: string, scope: Scope, metadata: Payload, now: Date): MemoryItem {
  // v1.1 T2.1: surface attributed_to on the DTO. Reads from payload because
  // both the LLM-extraction path AND the verbatim path route attribution
  // through the payload key BEFORE this conversion.
  const attributedToRaw = metadata['attributed_to'];
  const attributedTo = typeof attributedToRaw === 'string' ? attributedToRaw : undefined;
  const categoryRaw = metadata['category'];
  const category = typeof categoryRaw === 'string' ? categoryRaw : undefined;
  // principles-alignment-hardening T2.1 / EC-6 — hoist confirmation_count from
  // the projected payload (pgvector-store search/get/list now SELECT it) to
  // MemoryItem.confirmationCount. Recall-returned items now surface the
  // Princípio 1 (CLAUDE.md § IMPORTANTE) confirmação signal.
  const confirmationCountRaw = metadata['confirmation_count'];
  const confirmationCount = typeof confirmationCountRaw === 'number' ? confirmationCountRaw : undefined;
  return {
    id,
    text,
    hash,
    scope,
    createdAt: now,
    updatedAt: now,
    metadata,
    tValid: validFromOf(metadata, now),
    tInvalid: null,
      ...evidenceFromPayload(metadata),
    ...(attributedTo !== undefined ? { attributedTo } : {}),
    ...(category !== undefined ? { category } : {}),
    ...(confirmationCount !== undefined ? { confirmationCount } : {}),
  };
}

/**
 * principles-alignment-hardening T2.1 — patch MemoryItem instances with
 * UPSERT outcomes from the vector store. Surfaces Princípio 1 (confirmação)
 * + Princípio 3 (rejectedAsDuplicate IGNORE auditability) on the DTO.
 *
 * Pairing is POSITIONAL by input order: outcomes[i] corresponds to items[i].
 * This handles the ON CONFLICT DO UPDATE case where PgvectorStore's
 * RETURNING projects the EXISTING row's id (not the random id we attempted
 * to INSERT) — positional pairing preserves the consumer's expectation that
 * "I asked for fact X; here is what the store knows about it (existing id +
 * post-bump count + dedup flag)".
 *
 * When `outcomes.length !== items.length` (e.g., per-row fallback dropped
 * some rows), items beyond the outcomes length are returned unpatched.
 */
export function patchItemsWithOutcomes(
  items: readonly MemoryItem[],
  outcomes: readonly InsertOutcome[],
): readonly MemoryItem[] {
  if (outcomes.length === 0) {
    return items;
  }
  return items.map((item, i) => {
    const outcome = outcomes[i];
    if (outcome === undefined) {
      return item;
    }
    return {
      ...item,
      // Overwrite id with the store's authoritative value: identical for fresh
      // inserts, but the EXISTING row's id when ON CONFLICT bumped instead.
      id: outcome.id,
      confirmationCount: outcome.confirmationCount,
      rejectedAsDuplicate: outcome.rejectedAsDuplicate,
      ...(outcome.idempotentReplay!==undefined?{idempotentReplay:outcome.idempotentReplay}:{}),
      ...(outcome.distinctSourceCount!==undefined?{distinctSourceCount:outcome.distinctSourceCount}:{}),
      ...(outcome.expiresAt!==undefined?{expiresAt:outcome.expiresAt}:{}),
    };
  });
}

/** Phase 3: batch embed with per-row fallback on batch failure. */
export async function embedBatchWithFallback(
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
        const vec = await embedder.embed(text);
        // T2.2 — reject zero-dim vectors from corrupting the vector store.
        if (vec.length === 0) {
          emitEvent(tracer, 'embed_zero_dim_skipped');
          out.push([]);
        } else {
          out.push(vec);
        }
      } catch {
        out.push([]);
      }
    }
    return out;
  }
}

/** Phase 6: batch persist with per-row fallback. Returns per-id outcomes
 * surfacing UPSERT semantics for principles-alignment-hardening T2.1 wrap. */
/** What a persist attempt saved, and the first error that kept a row out (#231). */
export interface PersistResult {
  readonly outcomes: readonly InsertOutcome[];
  readonly failure?: unknown;
}

export async function persistWithFallback(
  vectorStore: VectorStore,
  vectors: readonly (readonly number[])[],
  ids: readonly string[],
  payloads: readonly Payload[],
  tracer: Tracer | undefined,
): Promise<PersistResult> {
  emitEvent(tracer, 'persist_started', { count: ids.length });
  try {
    const outcomes = await vectorStore.insert(vectors, ids, payloads);
    emitEvent(tracer, 'persist_completed', { count: ids.length });
    return { outcomes };
  } catch (error) {
    if (error instanceof IdempotencyConflict) throw error;
    emitEvent(tracer, 'persist_fallback', { count: ids.length, ...persistErrorAttributes(error) });
    const outcomes: InsertOutcome[] = [];
    let failure: unknown;
    for (let i = 0; i < ids.length; i += 1) {
      try {
        const single = await vectorStore.insert(
          [vectors[i] as readonly number[]],
          [ids[i] as string],
          [payloads[i] as Payload],
        );
        outcomes.push(...single);
      } catch (rowError) {
        if (rowError instanceof IdempotencyConflict) throw rowError;
        // Skip the row so it does not poison the batch, but keep why it failed.
        failure ??= rowError;
      }
    }
    return failure === undefined ? { outcomes } : { outcomes, failure };
  }
}

export { runInferFalsePath } from './infer-false-path.js';
