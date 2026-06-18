/**
 * 8-phase write pipeline — T4.3 of v0-1-local-runtime plan v1.3.
 *
 * Port of the upstream `addToVectorStore`
 * (.claude/knowledge-base/references/mem0/mem0-ts/src/oss/src/memory/index.ts:562-994) per blueprint
 * ADR D1 + plan ADR D1.0. Phases are named verbatim from the upstream code
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
 * @see .claude/knowledge-base/references/mem0/mem0-ts/src/oss/src/memory/index.ts:562-994
 */
import { randomUUID } from 'node:crypto';

import type { Tracer } from '@opentelemetry/api';

import { hashFact } from '../dedup.js';
import type { Embedder } from '../dip/embedder.js';
import type { HistoryBatchRecord, HistoryManager } from '../dip/history-manager.js';
import type { LLM } from '../dip/llm.js';
import type { InsertOutcome, VectorStore } from '../dip/vector-store.js';
import { InvalidScope } from '../errors.js';
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
    tValid: now,
    tInvalid: null,
    ...(attributedTo !== undefined ? { attributedTo } : {}),
    ...(confirmationCount !== undefined ? { confirmationCount } : {}),
  };
}

/**
 * `infer: false` fast-path (upstream reference index.ts:568-586).
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
function patchItemsWithOutcomes(
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

  // themory-category-filter-server-side T3.3 / EC-2 — SDK-layer boundary check
  // BEFORE branch dispatch. Mirrors the v1.1 asOf NaN check at src/local/index.ts:580
  // per architecture.md § 8 (validate at boundaries). REST already enforces 1-64
  // chars via zod min(1).max(64); this is defense-in-depth for direct SDK callers
  // (TheoKit agent loops, tests, migration scripts) who don't transit REST.
  if (options?.category !== undefined) {
    const cat = options.category;
    if (cat.length === 0 || cat.length > 64) {
      throw new InvalidScope(
        `category must be 1-64 chars (got ${String(cat.length)})`,
      );
    }
  }

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
    const obj: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
    // Defensive coercion: even though the system prompt asks for string ids,
    // gpt-4o-mini (and likely others) sometimes returns `linked_memory_ids:
    // [1, 2]` (number[]) — Zod then rejects with "Expected string, received
    // number" and the whole extraction silently returns []. Normalize before
    // parse so the schema stays strict but the most common LLM divergence is
    // self-healing. See /tmp/themory-issue-2.md (team report 2026-06-08) for
    // empirical isolation script + 4-model evidence.
    if (obj !== null && typeof obj === 'object' && Array.isArray((obj as { memory?: unknown }).memory)) {
      for (const item of (obj as { memory: unknown[] }).memory) {
        if (item !== null && typeof item === 'object' && Array.isArray((item as { linked_memory_ids?: unknown }).linked_memory_ids)) {
          (item as { linked_memory_ids: unknown[] }).linked_memory_ids =
            (item as { linked_memory_ids: unknown[] }).linked_memory_ids.map(String);
        }
      }
    }
    const parsed = AdditiveExtractionSchema.parse(obj);
    extracted = parsed.memory;
    emitEvent(tracer, 'extraction_completed', { facts: extracted.length });
  } catch (err) {
    // T2.1 — differentiate LLM network errors (propagate) from parse/validation
    // errors (return [] with OTel event). Per ADR D3 + EC-6: classify by error
    // TYPE (instanceof), NOT by message content.
    const isParse = err instanceof SyntaxError                    // JSON.parse failure
      || (err !== null && typeof err === 'object' && 'issues' in err);  // ZodError shape
    process.stderr.write(
      `[themory] extraction_failed (${isParse ? 'parse' : 'network'}): ${err instanceof Error ? err.message : String(err)}\n`,
    );
    if (!isParse) {
      // Network / LLM provider errors propagate — caller decides retry policy.
      emitEvent(tracer, 'extraction_failed');
      throw err;
    }
    emitEvent(tracer, 'extraction_parse_failure');
    return [];
  }

  if (extracted.length === 0) {
    // principles-alignment-hardening T3.1 — Princípio 3 IGNORE auditability per ADR D2.
    // LLM returned drafts=[]; before this commit remember() returned []
    // indistinguishably from "no input". emitEvent surfaces the IGNORE decision
    // to OTel dashboards. EC-5 absorption: emitEvent is no-op when tracer === undefined.
    const inputLength = messages.reduce((acc, m) => acc + m.content.length, 0);
    const scopeTier: string =
      filters.session_id !== undefined ? 'session' :
      filters.agent_id !== undefined ? 'agent' :
      filters.user_id !== undefined ? 'user' : 'none';
    emitEvent(tracer, 'extraction_zero_facts', {
      input_length: inputLength,
      scope_tier: scopeTier,
    });
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
  // principles-alignment-hardening T1.1 — app-level dedup against DB state
  // (`existingPayloads` Set) was REMOVED in favor of the DB-level composite
  // UPSERT (PgvectorStore ON CONFLICT per ADR D5). The DB constraint handles
  // cross-batch dedup correctly and surfaces the outcome via InsertOutcome
  // (confirmationCount + rejectedAsDuplicate) so consumers SEE the bump
  // instead of receiving silent []. The dedup_skipped event still fires for
  // WITHIN-batch duplicates (the LLM extraction emitting the same fact twice
  // in one drafts list).
  const inBatchHashes = new Set<string>();

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
    if (inBatchHashes.has(hash)) {
      // Within-batch duplicate (same fact emitted twice by the LLM in one call).
      emitEvent(tracer, 'dedup_skipped', { hash });
      continue;
    }
    inBatchHashes.add(hash);
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
    // themory-category-filter-server-side T3.3 / ADR D1 — operator-supplied
    // category attaches to EVERY extracted fact in the write batch. NOT
    // per-fact LLM-inferred (ADR D1 — category is operator vocabulary, not
    // model-derived). EC-2 length check ran at pipeline entry; here we just
    // propagate the validated value.
    if (options?.category !== undefined) {
      payload['category'] = options.category;
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
    } catch (err: unknown) {
      // T2.3 — surface history persist failure instead of silently swallowing.
      // Still non-fatal per the upstream pattern (history failure must not block write),
      // but now observable via OTel + stderr.
      const msg = err instanceof Error ? err.message : String(err);
      emitEvent(tracer, 'history_persist_failed', { error: msg });
      // eslint-disable-next-line no-console
      console.warn(`[themory] history persist failed: ${msg}`);
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
