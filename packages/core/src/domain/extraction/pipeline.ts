/**
 * 8-phase write pipeline — T4.3 of v0-1-local-runtime plan v1.3.
 *
 * Port of the upstream `addToVectorStore`
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
 */
import { randomUUID } from 'node:crypto';

import { hashFact } from '../dedup.js';
import type { HistoryBatchRecord } from '../dip/history-manager.js';
import { InvalidScope, MemoryStoreError } from '../errors.js';
import { lemmatizeForBm25 } from '../lemmatization.js';
import { emitEvent } from '../memory-event.js';
import { attachEvidence, validateMemoryEvidence, restoreDuplicateEvidence } from '../memory-evidence.js';
import type { MemoryItem } from '../memory-item.js';
import type { Message } from '../message.js';
import { DEFAULT_ENTITY_TAXONOMY } from '../ontology.js';
import type { RememberOptions } from '../options.js';
import type { Filters } from '../scope.js';
import { attachWriteContext, validateWriteContext, writeRequestHash } from '../write-context.js';

import { linkEntities, type RelationTriple } from './entity-linking.js';
import { prepareExtractedEvidence, extractedMemoryEvidence } from './evidence.js';
import { applyFactGate } from './fact-gate.js';
import { scoreNewFacts } from './importance-scoring.js';
import { correctEntityRelationLanguage } from './label-language.js';
import { detectInputLanguage } from './language.js';
import { coerceExtractionResponse } from './normalize.js';
import { applyOntologyToEntities, boundedAutoCategory, buildPayload, embedBatchWithFallback, extractResponseText, patchItemsWithOutcomes, persistWithFallback, runInferFalsePath, scopeFromFilters, toMemoryItem } from './pipeline-helpers.js';
import type { ExtractionDeps, Payload } from './pipeline-helpers.js';
import { AdditiveExtractionSchema, generateAdditiveExtractionPrompt, type AdditiveExtractionResponse } from './prompt.js';
import { applySupersessions } from './supersession.js';
import { DEFAULT_CATEGORY_TAXONOMY, classifyCategorySource } from './taxonomy.js';

function isExtractionParseError(error: unknown): boolean {
  return error instanceof SyntaxError
    || (error !== null && typeof error === 'object' && 'issues' in error);
}


// Re-export the public surface that used to live here (backward-compatible for
// `domain/index.ts` + external importers).
export { applyOntologyToEntities };
export type { ExtractionDeps, Payload } from './pipeline-helpers.js';


/**
 * Main entry point. Runs the 8-phase write pipeline + returns the persisted MemoryItems.
 */
/** Preceding turns of the scope given to the extractor as context when the deps do not say (ADR-0027). */
export const DEFAULT_CONTEXT_MESSAGE_COUNT = 10;

/** Existing memories of the scope shown to the extractor: the most similar to the new messages (ADR-0029). */
export const SIMILAR_MEMORY_COUNT = 10;

/**
 * The write pipeline. With a `MessageLog`, the preceding turns of the scope are read before
 * extraction (context only), and once the write completes the new messages are logged and
 * linked to every memory the write returned. A replayed idempotent write logs nothing; a write
 * that throws logs nothing. A log failure never fails a committed write: it is emitted as
 * `message_log_failed`.
 */
export async function runExtractionPipeline(
  messages: readonly Message[],
  filters: Filters,
  deps: ExtractionDeps,
  options?: RememberOptions,
): Promise<readonly MemoryItem[]> {
  const log = deps.messageLog;
  if (log === undefined) return extractAndPersist(messages, filters, deps, options, []);
  let previous: readonly Message[] = [];
  try {
    previous = (await log.recent(filters, deps.contextMessageCount ?? DEFAULT_CONTEXT_MESSAGE_COUNT))
      .map((m) => ({ role: m.role, content: m.content }));
  } catch (err) {
    emitEvent(deps.tracer, 'message_log_failed', { operation: 'recent', error: err instanceof Error ? err.name : 'UnknownError' });
  }
  const items = await extractAndPersist(messages, filters, deps, options, previous);
  if (items.some((item) => item.idempotentReplay === true)) return items;
  // ADR-0031: each logged message carries its embedding for search by meaning. Without one it is
  // still logged and found by its words, so an embedding failure is reported, never fatal.
  let embeddings: readonly (readonly number[])[] | undefined;
  try {
    embeddings = await deps.embedder.embedBatch(messages.map((m) => m.content));
  } catch (err) {
    emitEvent(deps.tracer, 'message_log_failed', { operation: 'embed', error: err instanceof Error ? err.name : 'UnknownError' });
  }
  try {
    const messageIds = await log.append(filters, messages, options?.observedAt, embeddings);
    await log.linkSources(filters, items.map((item) => item.id), messageIds);
  } catch (err) {
    emitEvent(deps.tracer, 'message_log_failed', { operation: 'append', error: err instanceof Error ? err.name : 'UnknownError' });
  }
  return items;
}

/**
 * The write pipeline with caller-supplied preceding turns and no logging of its own. For
 * callers that log inside their own transaction, such as the durable job processor (ADR-0027).
 */
export function runExtractionWithContext(
  messages: readonly Message[],
  filters: Filters,
  deps: Omit<ExtractionDeps, 'messageLog' | 'contextMessageCount'>,
  options: RememberOptions | undefined,
  previousMessages: readonly Message[],
): Promise<readonly MemoryItem[]> {
  return extractAndPersist(messages, filters, deps, options, previousMessages);
}

async function extractAndPersist(
  messages: readonly Message[],
  filters: Filters,
  deps: ExtractionDeps,
  options: RememberOptions | undefined,
  previousMessages: readonly Message[],
): Promise<readonly MemoryItem[]> {
  const sourceEvidence = options?.evidence === undefined ? undefined : validateMemoryEvidence(options.evidence);
  if (sourceEvidence !== undefined) options = { ...options, evidence: sourceEvidence };
  validateWriteContext(options, true);
  messages=messages.map(message=>({...message}));
  if(options!==undefined)options={...options,
    ...(options.expiresAt!==undefined?{expiresAt:new Date(options.expiresAt)}:{}),
    ...(options.observedAt instanceof Date?{observedAt:new Date(options.observedAt)}:{}),
    ...(options.metadata!==undefined?{metadata:{...options.metadata}}:{})};
  if (options?.idempotencyKey !== undefined && deps.vectorStore.findWriteReplay === undefined) {
    throw new InvalidScope('Idempotent writes require a store with durable write receipts, such as PgvectorStore.');
  }
  if (options?.idempotencyKey !== undefined && deps.vectorStore.findWriteReplay !== undefined) {
    const replay = await deps.vectorStore.findWriteReplay(options.idempotencyKey, writeRequestHash(messages, options), filters);
    if (replay !== null) return replay.map((row) => ({ ...toMemoryItem(row.id, String(row.payload['text'] ?? ''),
      String(row.payload['hash'] ?? row.id), scopeFromFilters(filters), { ...row.payload }, row.createdAt ?? new Date()), rejectedAsDuplicate: true, idempotentReplay: true }));
  }
  validateWriteContext(options);
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
    return runInferFalsePath(messages, filters, deps, sourceEvidence === undefined ? options : { ...options, evidence: sourceEvidence });
  }

  // ============================================================
  // Phase 0: context gather (system prompt + custom instructions)
  // ============================================================
  emitEvent(tracer, 'extraction_started');

  // ============================================================
  // Phase 1: existing retrieval + UUID→int mapping
  // ============================================================
  // The in-scope memories most similar to the new messages, so the extractor can see what the
  // new facts repeat or replace even when it is old (ADR-0029). The integer→UUID mapping is
  // owned by the prompt composer.
  const supersedeOnWrite = deps.supersedeOnWrite !== false;
  const queryVector = await deps.embedder.embed(messages.map((m) => m.content).join('\n'));
  const existingResults = await deps.vectorStore.search(queryVector, SIMILAR_MEMORY_COUNT, filters);
  const existingItems: MemoryItem[] = existingResults.map((r) => {
    const text = String(r.payload['text'] ?? '');
    const hash = String(r.payload['hash'] ?? r.id);
    const now = new Date();
    return toMemoryItem(r.id, text, hash, scopeFromFilters(filters), { ...r.payload }, now);
  });

  // ============================================================
  // Phase 2: LLM extraction (single call; Zod parse with EC-10 fallback)
  // ============================================================
  // EG-4 fixes-cycle-1 (D1): deterministically detect the input language and inject
  // the EXPLICIT target-language name into the extraction prompt. A concrete "write in
  // English" instruction is followed far more reliably than the model self-detecting
  // (live-test 2026-06-23: self-detect stored English inputs as Portuguese facts).
  const detectedLanguage = detectInputLanguage(messages.map((m) => m.content).join('\n'));
  // auto-categorization-write-pipeline T3.1 — default-on (ADR D3). When enabled, the
  // taxonomy is injected into the prompt so the LLM emits a per-fact category.
  const autoCategorizeEnabled = deps.autoCategorize?.enabled !== false;
  const autoCategorizeTaxonomy = deps.autoCategorize?.taxonomy ?? DEFAULT_CATEGORY_TAXONOMY;
  const { prompt, uuidByInt } = generateAdditiveExtractionPrompt(
    existingItems,
    messages,
    deps.customInstructions,
    deps.ontology,
    detectedLanguage ?? undefined,
    autoCategorizeEnabled ? autoCategorizeTaxonomy : undefined,
    options?.attributedTo, // M29 (#160): speaker token derived from attribution inside the prompt composer
    options?.observedAt, // anchors relative time expressions to when the messages were said
    previousMessages, // preceding turns of the scope, context only
    supersedeOnWrite,
  );
  const shownMemories = new Map<number, { id: string; text: string }>();
  for (const [promptId, id] of uuidByInt) {
    shownMemories.set(promptId, { id, text: existingItems[promptId - 1]?.text ?? '' });
  }
  let extracted: Readonly<AdditiveExtractionResponse['memory']>;
  // slice2 T2.2 — relation triples from the SAME extraction call (response-level).
  let relations: readonly RelationTriple[] | undefined;
  // multilingual nodes: the LLM is the PRIMARY node source (compromise is an
  // English-only fallback). Surface names preserved in the input language/script.
  let llmEntities: readonly { name: string; type?: string | undefined }[] | undefined;
  try {
    const extractionMessages = [
      { role: 'system' as const, content: prompt },
      { role: 'user' as const, content: messages.map((m) => `${m.role}: ${m.content}`).join('\n') },
    ];
    let parsed: AdditiveExtractionResponse;
    const raw = await deps.llm.generateResponse(extractionMessages, { type: 'json' });
    try {
      // Normalize the raw response (numeric ids, fact-under-`fact`, missing id) before the
      // strict parse — see `extraction/normalize.ts` (extracted for single responsibility).
      parsed = AdditiveExtractionSchema.parse(coerceExtractionResponse(raw));
    } catch (error) {
      if (!isExtractionParseError(error)) throw error;
      // Provider JSON mode can still return malformed content. Make one bounded repair
      // attempt before failing the write; network failures are never retried here.
      emitEvent(tracer, 'extraction_parse_retry', { attempt: 1 });
      const retryMessages = [
        {
          role: 'system' as const,
          content: `${prompt}\n\nRETRY REQUIREMENT: your prior output did not match the required schema. Return one valid JSON object only, with memory as an array of fact objects and relations/entities using the exact schema above. Do not return prose or bare strings.`,
        },
        extractionMessages[1] as { role: 'user'; content: string },
      ];
      const retriedRaw = await deps.llm.generateResponse(retryMessages, { type: 'json' });
      parsed = AdditiveExtractionSchema.parse(coerceExtractionResponse(retriedRaw));
    }
    extracted = parsed.memory;
    relations = parsed.relations;
    llmEntities = parsed.entities;
    emitEvent(tracer, 'extraction_completed', { facts: extracted.length });

    // EG-4 fixes-cycle-1 (D3): fail-soft post-extraction language guard + correction.
    // The explicit language injection (D1) reduces but does not eliminate residual
    // translation by gpt-4o-mini (the extraction prompt's own multilingual examples
    // prime the model). DETECTION IS AGGREGATE, NOT per-fact: franc-min mis-classifies
    // a single short fact (e.g. "Sarah ama escalada." → Somali), so the guard detects
    // the language of the JOINED fact text — long enough for franc to reliably flag the
    // wrong-language case (Portuguese facts for an English input). When franc cannot
    // confidently map the joined facts (short / exotic mis-detect of genuine English →
    // null), no correction runs and the facts are kept as-is. On a confident mismatch,
    // each fact gets a FOCUSED corrective rewrite ("rewrite in {name}") — translation is
    // a task LLMs perform reliably, unlike the abstract "don't translate" constraint.
    // Every detection emits `extraction_language_mismatch` (Princípio 3). FAIL-SOFT: the
    // guard NEVER drops a fact and NEVER fails remember(); on any error it keeps the
    // original text. Runs sequentially over the (typically 1-3) facts — no concurrency.
    if (detectedLanguage !== null && extracted.length > 0) {
      try {
        const lang = detectedLanguage;
        const factsLanguage = detectInputLanguage(extracted.map((f) => f.text).join(' '));
        if (factsLanguage !== null && factsLanguage.iso6391 !== lang.iso6391) {
          const result: AdditiveExtractionResponse['memory'] = [];
          let correctedCount = 0;
          for (const fact of extracted) {
            let text = fact.text;
            try {
              const rewritten = await deps.llm.generateResponse(
                [
                  {
                    role: 'system',
                    content: `Rewrite the user's text in ${lang.name}, preserving the exact meaning and any proper names. Output ONLY the rewritten text — no quotes, no preface, no commentary.`,
                  },
                  { role: 'user', content: fact.text },
                ],
                { type: 'text' },
              );
              // The LLM DIP returns a bare string (stubs) OR `{ text }` (OpenAILLM
              // text-mode wraps the content — openai.ts). Extract robustly.
              const candidate = extractResponseText(rewritten).trim();
              if (candidate.length > 0) {
                text = candidate;
                correctedCount += 1;
              }
            } catch {
              // fail-soft: keep the original fact text on any correction error.
            }
            result.push({ ...fact, text });
          }
          // Observable whenever a wrong-language fact set was DETECTED (the EG-4
          // residual stays observable even if a correction returned empty —
          // `corrected < fact_count`). NOT emitted when languages match (no-op).
          emitEvent(tracer, 'extraction_language_mismatch', {
            input_language: lang.iso6391,
            facts_language: factsLanguage.iso6391,
            fact_count: extracted.length,
            corrected: correctedCount,
          });
          if (correctedCount > 0) {
            extracted = result;
          }
        }
      } catch {
        // fail-soft: a guard error must NEVER affect remember().
      }
    }
  } catch (err) {
    // T2.1 — differentiate LLM network errors (propagate) from parse/validation
    // errors (return [] with OTel event). Per ADR D3 + EC-6: classify by error
    // TYPE (instanceof), NOT by message content.
    const isParse = isExtractionParseError(err);
    process.stderr.write(
      `[themory] extraction_failed (${isParse ? 'parse' : 'network'}): ${deps.redactErrorDetails === true ? (err instanceof Error ? err.name : 'UnknownError') : (err instanceof Error ? err.message : String(err))}\n`,
    );
    if (!isParse) {
      // Network / LLM provider errors propagate — caller decides retry policy.
      emitEvent(tracer, 'extraction_failed');
      throw err;
    }
    emitEvent(tracer, 'extraction_parse_failure');
    if (options?.strictExtraction === true) throw new MemoryStoreError('Memory extraction response was invalid.', { cause: err });
    return [];
  }

  // domain-ontologies T2.2 (ADR D2) + M13 T1.1 (ADR D1, #111) — ALWAYS coerce the
  // LLM's entity types against exactly ONE vocabulary (mutually exclusive by
  // construction — EC-2): the configured Item 15 ontology when present, else the
  // closed DEFAULT taxonomy (PERSON|ORG|PLACE|PRODUCT|CONCEPT|OTHER — the menu the
  // Phase 2 prompt already requests). Out-of-vocab → OTHER + `ontology_type_coerced`
  // (Princípio 3). Fail-soft: a coercion error degrades to raw entities — it NEVER
  // fails remember().
  if (llmEntities !== undefined) {
    try {
      llmEntities = applyOntologyToEntities(llmEntities, deps.ontology ?? DEFAULT_ENTITY_TAXONOMY, tracer);
    } catch {
      // degrade to raw entities (fail-soft); coercion is best-effort enrichment.
    }
  }

  // M27 T2.1 — deterministic durable-fact backstop gate (infer:true only; audit per drop).
  const extractedCount = extracted.length;
  extracted = prepareExtractedEvidence(applyFactGate(extracted, tracer), messages, tracer);
  if (extracted.length < extractedCount && (llmEntities !== undefined || relations !== undefined)) {
    // Batch-level graph annotations have no per-fact provenance. They could retain
    // a rejected preference by attaching it to a surviving fact. Fall back to
    // extracting nodes from the kept texts and omit these unassignable edges.
    llmEntities = undefined;
    relations = undefined;
    emitEvent(tracer, 'extraction_evidence_dropped', { reason: 'filtered_batch_graph_annotations', target: 'graph' });
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

  if (options?.strictExtraction === true &&
      (vectors.length !== extracted.length || vectors.some((v) => v.length === 0))) {
    throw new MemoryStoreError('Memory extraction did not produce embeddings for every fact.');
  }

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
  const survivingSupersedes: (readonly string[])[] = [];

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
    attachWriteContext(payload, messages, options);
    attachEvidence(payload, extractedMemoryEvidence(extracted[i]?.evidence, sourceEvidence));
    payload['text_lemmatized'] = lemmatizeForBm25(text).join(' ');
    // Attribution authority (claude-code-kit fix): the REQUEST-level
    // `options.attributedTo` is the ORIGIN of the turn — the Stop hook sets it to
    // 'assistant' for assistant-produced summaries and 'user' for explicit user
    // captures. It is AUTHORITATIVE when present, so an assistant summary can never
    // masquerade as a user fact (extraction discipline: "its suggestions never become
    // your stated preferences"). The LLM per-fact `attributed_to` is the FALLBACK
    // for attribution-agnostic multi-peer ingestion (v1.1). This mirrors the
    // infer:false path (infer-false-path.ts) so both write paths agree.
    // v1.1 T2.1 + EC-1 originally propagated only the LLM guess here; pre-v1.1 it
    // was discarded entirely. Historical rows remain NULL per ADR D2 Consequences.
    // A BLANK request-level value is treated as ABSENT (fall through to the LLM
    // per-fact guess), not as an authoritative empty attribution — `attributedTo:''`
    // is a caller mistake (`peerId || ''`), never an intent to attribute-to-empty.
    // REST also rejects it at the boundary (schemas `.min(1)`); this guards direct
    // SDK callers so the fix introduces no empty-string hazard on the infer:true path.
    const requestedAttributedTo = options?.attributedTo;
    const effectiveAttributedTo =
      requestedAttributedTo !== undefined && requestedAttributedTo !== ''
        ? requestedAttributedTo
        : extracted[i]?.attributed_to;
    if (effectiveAttributedTo !== undefined) {
      payload['attributed_to'] = effectiveAttributedTo;
    }
    // auto-categorization-write-pipeline T3.1 (supersedes the category-filter
    // operator-only decision, ADR D1). Operator category ALWAYS wins (verbatim,
    // already 1-64-validated at entry). Otherwise, when auto-categorization is
    // enabled, the LLM-emitted per-fact category is trimmed + 1-64-bounded and
    // written FAIL-SOFT (EC-1/EC-2/EC-5): an oversized / empty / whitespace-only
    // value is DROPPED (never throws InvalidScope — that is the operator path).
    if (options?.category !== undefined) {
      payload['category'] = options.category;
    } else if (autoCategorizeEnabled) {
      const rawCategory = extracted[i]?.category;
      const autoCategory = boundedAutoCategory(rawCategory);
      if (autoCategory !== null) {
        payload['category'] = autoCategory;
        emitEvent(tracer, 'category_auto_assigned', {
          source: classifyCategorySource(autoCategory, autoCategorizeTaxonomy),
          fact_count: 1,
        });
      } else if (typeof rawCategory === 'string') {
        // F-M1: the LLM PROPOSED a label but it failed the 1-64 trim/bound (EC-1/EC-5)
        // — a real drop, observable per Princípio 3 (never a silent IGNORE).
        emitEvent(tracer, 'category_auto_dropped', { reason: 'out_of_bounds' });
      }
    }
    survivingIds.push(id);
    survivingVectors.push(vector);
    survivingPayloads.push(payload);
    survivingItems.push(toMemoryItem(id, text, hash, scope, payload, now));
    survivingSupersedes.push(supersedeOnWrite ? extracted[i]?.supersedes_memory_ids ?? [] : []);
  }

  if (survivingIds.length === 0) {
    return [];
  }

  // ============================================================
  // Phase 6: batch persist (per-row fallback)
  // ============================================================
  const { outcomes: persistOutcomes, failure: persistFailure } = await persistWithFallback(
    deps.vectorStore,
    survivingVectors,
    survivingIds,
    survivingPayloads,
    tracer,
  );
  if (options?.idempotencyKey !== undefined && persistOutcomes.some(outcome=>outcome.idempotentReplay===true) && deps.vectorStore.findWriteReplay!==undefined) {
    const replay=await deps.vectorStore.findWriteReplay(options.idempotencyKey,writeRequestHash(messages,options),filters);
    if(replay!==null)return replay.map(row=>({...toMemoryItem(row.id,String(row.payload['text']??''),String(row.payload['hash']??row.id),
      scopeFromFilters(filters),{...row.payload},row.createdAt??new Date()),rejectedAsDuplicate:true,idempotentReplay:true}));
  }
  if (options?.strictExtraction === true && persistOutcomes.length !== survivingIds.length) {
    throw new MemoryStoreError('Memory persistence was incomplete; some facts may have been saved.',
      persistFailure === undefined ? undefined : { cause: persistFailure });
  }
  // principles-alignment-hardening T2.1 — patch surviving items with UPSERT
  // outcomes (confirmationCount + rejectedAsDuplicate) per ADR D1 + D4.
  const patchedItems = await restoreDuplicateEvidence(patchItemsWithOutcomes(survivingItems, persistOutcomes), deps.vectorStore);
  // Replace the surviving items array in place so downstream history persist /
  // entity link / return path see the patched DTOs.
  survivingItems.length = 0;
  survivingItems.push(...(patchedItems as MemoryItem[]));

  // ============================================================
  // Phase 6.2: supersession (ADR-0029)
  // ============================================================
  // Only facts the store confirmed persisting may invalidate anything.
  let supersessionHistory: readonly HistoryBatchRecord[] = [];
  if (survivingSupersedes.some((ids) => ids.length > 0)) {
    if (persistOutcomes.length !== survivingIds.length) {
      emitEvent(tracer, 'supersession_skipped', { reason: 'incomplete_persist', count: survivingIds.length });
    } else {
      try {
        const applied = await applySupersessions(
          survivingItems.map((memory, i) => ({ memory, promptIds: survivingSupersedes[i] ?? [] })),
          shownMemories, filters, options?.observedAt ?? new Date(), deps.vectorStore, tracer);
        supersessionHistory = applied.history;
        for (let i = 0; i < survivingItems.length; i += 1) {
          const replaced = applied.supersededBy.get(survivingItems[i]!.id);
          if (replaced !== undefined) survivingItems[i] = { ...survivingItems[i]!, supersedes: replaced };
        }
      } catch (err) {
        // The facts are committed; the replaced memories simply stay current. Observable, not silent.
        emitEvent(tracer, 'supersession_failed', { error: err instanceof Error ? err.name : 'UnknownError' });
      }
    }
  }

  // ============================================================
  // Phase 6.3: importance scoring (#238, opt-in)
  // ============================================================
  if (deps.importanceScoring === true) {
    const scored = await scoreNewFacts(survivingItems, persistOutcomes, filters, deps.vectorStore, deps.llm, tracer);
    survivingItems.length = 0;
    survivingItems.push(...(scored as MemoryItem[]));
  }

  // ============================================================
  // Phase 6.5: batch history persist
  // ============================================================
  if (deps.historyManager !== undefined) {
    const records: HistoryBatchRecord[] = [...survivingItems.map((item): HistoryBatchRecord => ({
      memoryId: item.id,
      previousValue: null,
      newValue: item.text,
      action: 'remember',
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    })), ...supersessionHistory];
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
  // EG-5: normalize entity/relation LABELS to the input language BEFORE persist.
  // The EG-4 fact guard fixes memory[].text; the labels (entities[] names +
  // relations[] verbs) still drift (live-test 2026-06-23). Always-on when the input
  // language was detected + labels exist (detect-gating is unreliable for mixed short
  // labels — see label-language.ts). FAIL-SOFT: never drops a node/edge, never fails
  // remember(); runs before linkEntities so the PERSISTED nodes/edges + their dedup
  // keys are in the input language (Princípio 2).
  // ============================================================
  if (detectedLanguage !== null && (llmEntities !== undefined || relations !== undefined)) {
    try {
      const labelFix = await correctEntityRelationLanguage(deps.llm, llmEntities, relations, detectedLanguage, messages.map((m) => m.content).join('\n'));
      llmEntities = labelFix.entities;
      relations = labelFix.relations;
      if (labelFix.corrected > 0) {
        emitEvent(tracer, 'extraction_label_language_mismatch', {
          input_language: detectedLanguage.iso6391,
          label_count: labelFix.labelCount,
          corrected: labelFix.corrected,
        });
      }
    } catch {
      // fail-soft: label correction must NEVER affect remember().
    }
  }

  // ============================================================
  // Phase 7: entity + relation linking (slice1 T3.1 + slice2 T2.2) — FAIL-SOFT.
  // Shared helper in entity-linking.ts; passes the LLM `relations` so edges link
  // after nodes. The infer:false fast-path calls linkEntities WITHOUT relations.
  // ============================================================
  await linkEntities(survivingItems, filters, deps, tracer, relations, llmEntities);

  // Phase 8: save messages — deferred to v0.2 (historyManager.saveMessages optional)

  return survivingItems;
}

