/**
 * RED-phase tests for src/core/extraction/pipeline.ts — T4.3 of v0-1-local-runtime plan v1.3.
 *
 * 8-phase write pipeline per blueprint D1 + ADR D1.0. Tests use:
 *  - Content-based LLM mock (parses prompt + echoes extracted text)
 *  - Mock embedder (fixed 1536-dim vector)
 *  - Inline minimal VectorStore stub (NOT InMemoryVectorStore — DIP boundary)
 *  - In-memory OTel exporter for span assertions
 *
 * Pattern per blueprint Recommendation 11.
 */
import { randomUUID } from 'node:crypto';

import { trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { describe, expect, test, vi } from 'vitest';

import { MAX_EMBEDDING_DIM } from './constants.js';
import type { Embedder } from './dip/embedder.js';
import type { HistoryBatchRecord } from './dip/history-manager.js';
import type { LLM } from './dip/llm.js';
import type { InsertOutcome, VectorStore, VectorStoreResult } from './dip/vector-store.js';
import { runExtractionPipeline } from './extraction/pipeline.js';
import { LANGUAGE_IDENTIFICATION_PROMPT } from './extraction/language-identification.js';
import { InMemoryMessageLog } from '../infrastructure/db/in-memory-message-log.js';
import { InMemoryVectorStore } from '../infrastructure/db/in-memory-store.js';
import { BUILTIN_ONTOLOGIES } from './ontology.js';
import type { Filters } from './scope.js';

type Payload = Record<string, string | number | boolean | null>;

class StubVectorStore implements VectorStore {
  private rows = new Map<string, { vector: readonly number[]; payload: Payload }>();

  initialize(): Promise<void> { return Promise.resolve(); }
  async insert(vectors: readonly (readonly number[])[], ids: readonly string[], payloads: readonly Payload[]): Promise<readonly InsertOutcome[]> {
    const outcomes: InsertOutcome[] = [];
    for (let i = 0; i < ids.length; i += 1) {
      const id = ids[i] as string;
      this.rows.set(id, { vector: vectors[i] as readonly number[], payload: payloads[i] as Payload });
      outcomes.push({ id, confirmationCount: 1, rejectedAsDuplicate: false });
    }
    await Promise.resolve();
    return outcomes;
  }
  async search(_q: readonly number[], topK = 10, _filters?: Filters): Promise<readonly VectorStoreResult[]> {
    const out: VectorStoreResult[] = [];
    for (const [id, row] of this.rows.entries()) {
      out.push({ id, payload: row.payload });
      if (out.length >= topK) break;
    }
    await Promise.resolve();
    return out;
  }
  keywordSearch(): Promise<readonly VectorStoreResult[] | null> { return Promise.resolve(null); }
  async get(id: string): Promise<VectorStoreResult | null> {
    const row = this.rows.get(id);
    await Promise.resolve();
    return row === undefined ? null : { id, payload: row.payload };
  }
  async update(id: string, vector: readonly number[], payload: Payload): Promise<void> {
    this.rows.set(id, { vector, payload });
    await Promise.resolve();
  }
  async delete(id: string): Promise<void> { this.rows.delete(id); await Promise.resolve(); }
  async deleteInScope(): Promise<boolean> { await Promise.resolve(); return false; }
  async deleteCol(): Promise<void> { this.rows.clear(); await Promise.resolve(); }
  async list(filters?: Filters, topK = 100): Promise<readonly [readonly VectorStoreResult[], number]> {
    const matches: VectorStoreResult[] = [];
    for (const [id, row] of this.rows.entries()) {
      let ok = true;
      if (filters !== undefined) {
        for (const [k, v] of Object.entries(filters)) {
          if (v !== undefined && row.payload[k] !== v) { ok = false; break; }
        }
      }
      if (ok) matches.push({ id, payload: row.payload });
    }
    await Promise.resolve();
    return [matches.slice(0, topK), matches.length];
  }
  async listEpisodes(): Promise<readonly VectorStoreResult[]> { await Promise.resolve(); return []; }
  getUserId(): Promise<string> { return Promise.resolve(''); }
  setUserId(): Promise<void> { return Promise.resolve(); }
  get size(): number { return this.rows.size; }
}

const mockEmbedding = (): readonly number[] => {
  const v = new Array<number>(MAX_EMBEDDING_DIM).fill(0);
  v[0] = 0.1;
  return v;
};

const makeEmbedder = (): Embedder => ({
  embed: vi.fn(async () => mockEmbedding()),
  embedBatch: vi.fn(async (texts: readonly string[]) => texts.map(() => mockEmbedding())),
});

const makeLlm = (response: unknown): LLM => ({
  generateResponse: vi.fn(async () => response),
  generateChat: vi.fn(async () => ({ role: 'assistant' as const, content: '' })),
});

const isIdentification = (messages: readonly { content: string }[]): boolean =>
  messages[0]?.content === LANGUAGE_IDENTIFICATION_PROMPT;

/** The LLM calls other than the input-language identification that precedes extraction. */
const extractionCalls = (llm: LLM) =>
  vi.mocked(llm.generateResponse).mock.calls.filter(([messages]) => !isIdentification(messages));

/** Answers the identification call with `language`, and every other call through `answer`. */
const languageAwareLlm = (language: unknown, answer: (call: number) => unknown): LLM => {
  let call = 0;
  return {
    generateResponse: vi.fn(async (messages: readonly { role: string; content: string }[]) => {
      if (isIdentification(messages)) {
        if (language instanceof Error) throw language;
        return language;
      }
      call += 1;
      const value = answer(call);
      if (value instanceof Error) throw value;
      return value;
    }),
    generateChat: vi.fn(async () => ({ role: 'assistant' as const, content: '' })),
  };
};

const setupTracer = () => {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  return { tracer: provider.getTracer('test'), exporter };
};

describe('runExtractionPipeline (8-phase write)', () => {
  test('retries one malformed JSON extraction response before failing a strict write', async () => {
    const store = new StubVectorStore();
    let calls = 0;
    const llm: LLM = {
      generateResponse: async () => {
        calls += 1;
        return calls === 1
          ? 'not json at all'
          : { memory: [{ id: '0', text: 'The user adopted a golden retriever named Max.' }] };
      },
      generateChat: async () => ({ role: 'assistant', content: '' }),
    };
    const result = await runExtractionPipeline(
      [{ role: 'user', content: 'I adopted a golden retriever named Max.' }],
      { user_id: 'alice' },
      { vectorStore: store, embedder: makeEmbedder(), llm },
      { attributedTo: 'user', strictExtraction: true },
    );
    expect(calls).toBe(2);
    expect(result.map((item) => item.text)).toContain('The user adopted a golden retriever named Max.');
  });

  test('persists one fact extracted from a 1-message conversation', async () => {
    const store = new StubVectorStore();
    const llm = makeLlm({ memory: [{ id: '0', text: 'Paulo likes coffee' }] });
    const result = await runExtractionPipeline(
      [{ role: 'user', content: 'I love coffee' }],
      { user_id: 'alice' },
      { vectorStore: store, embedder: makeEmbedder(), llm },
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.text).toBe('Paulo likes coffee');
    expect(result[0]?.scope).toEqual({ kind: 'user', userId: 'alice' });
  });

  test('themory-issue-2: coerces linked_memory_ids number[] → string[] before Zod parse (gpt-4o-mini divergence)', async () => {
    // Pre-fix RED: gpt-4o-mini reads "Use the integer ids in linked_memory_ids"
    // literally and returns [1, 2] (number[]) when the new content relates to
    // existing memories. Zod schema requires string[]; parse fails; catch swallows;
    // extraction silently returns []. Caminho feliz mais comum quebrado.
    // Post-fix: defensive coercion at pipeline.ts before AdditiveExtractionSchema.parse.
    const store = new StubVectorStore();
    const llm = makeLlm({
      memory: [{
        id: '6',
        text: 'O usuário prefere café no estilo aeropress.',
        attributed_to: 'user',
        linked_memory_ids: [1, 2],  // ← number[], exact shape gpt-4o-mini emits
      }],
    });
    const result = await runExtractionPipeline(
      [{ role: 'user', content: 'Eu prefiro café no estilo aeropress.' }],
      { user_id: 'alice' },
      { vectorStore: store, embedder: makeEmbedder(), llm },
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.text).toBe('O usuário prefere café no estilo aeropress.');
  });

  test('EC-9: empty extraction returns [] without persist call', async () => {
    const store = new StubVectorStore();
    const insertSpy = vi.spyOn(store, 'insert');
    const llm = makeLlm({ memory: [] });
    const result = await runExtractionPipeline(
      [{ role: 'user', content: 'silence' }],
      { user_id: 'alice' },
      { vectorStore: store, embedder: makeEmbedder(), llm },
    );
    expect(result).toEqual([]);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  test('principles-alignment-hardening T3.1 — emits extraction_zero_facts when LLM returns drafts=[] (ADR D2 Princípio 3)', async () => {
    const { tracer, exporter } = setupTracer();
    const store = new StubVectorStore();
    const llm = makeLlm({ memory: [] });
    const result = await runExtractionPipeline(
      [{ role: 'user', content: 'silence' }],
      { user_id: 'alice' },
      { vectorStore: store, embedder: makeEmbedder(), llm, tracer },
    );
    expect(result).toEqual([]);
    const spans = exporter.getFinishedSpans();
    const zeroFactsSpan = spans.find((s) => s.name === 'extraction_zero_facts');
    expect(zeroFactsSpan).toBeDefined();
    expect(zeroFactsSpan!.attributes['input_length']).toBe('silence'.length);
    expect(zeroFactsSpan!.attributes['scope_tier']).toBe('user');
  });

  test('principles-alignment-hardening T3.1 EC-5 — extraction_zero_facts no-op when tracer === undefined', async () => {
    const store = new StubVectorStore();
    const llm = makeLlm({ memory: [] });
    // No tracer in deps — emitEvent must be a clean no-op.
    const result = await runExtractionPipeline(
      [{ role: 'user', content: 'silence' }],
      { user_id: 'alice' },
      { vectorStore: store, embedder: makeEmbedder(), llm },
    );
    expect(result).toEqual([]);
  });

  test('EC-10: malformed LLM JSON returns [] + emits extraction_parse_failure event (T2.1)', async () => {
    const { tracer, exporter } = setupTracer();
    const store = new StubVectorStore();
    const llm = makeLlm('not json at all');
    const result = await runExtractionPipeline(
      [{ role: 'user', content: 'x' }],
      { user_id: 'alice' },
      { vectorStore: store, embedder: makeEmbedder(), llm, tracer },
    );
    expect(result).toEqual([]);
    const spanNames = exporter.getFinishedSpans().map((s) => s.name);
    expect(spanNames).toContain('extraction_parse_failure');
  });

  test('T2.1: LLM network error propagates instead of returning []', async () => {
    const { tracer } = setupTracer();
    const store = new StubVectorStore();
    const llm: LLM = {
      generateResponse: () => Promise.reject(new Error('ECONNREFUSED')),
      generateChat: () => Promise.reject(new Error('ECONNREFUSED')),
    };
    await expect(
      runExtractionPipeline(
        [{ role: 'user', content: 'x' }],
        { user_id: 'alice' },
        { vectorStore: store, embedder: makeEmbedder(), llm, tracer },
      ),
    ).rejects.toThrow('ECONNREFUSED');
  });

  test('emits dedup_skipped for WITHIN-batch duplicates (LLM emits same fact twice in one call)', async () => {
    // principles-alignment-hardening T1.1 contract change: dedup against
    // existing DB state moved from app-level to DB-level (PgvectorStore composite
    // UPSERT per ADR D5). The dedup_skipped event still fires for WITHIN-batch
    // duplicates (the LLM emitting the same fact twice in one extraction call).
    const { tracer, exporter } = setupTracer();
    const store = new StubVectorStore();
    const llm = makeLlm({
      memory: [
        { id: '0', text: 'Paulo likes coffee' },
        { id: '1', text: 'Paulo likes coffee' }, // duplicate within the SAME drafts list
      ],
    });
    const result = await runExtractionPipeline(
      [{ role: 'user', content: 'within batch dup' }],
      { user_id: 'alice' },
      { vectorStore: store, embedder: makeEmbedder(), llm, tracer },
    );
    expect(result).toHaveLength(1); // second copy dedup-skipped within the batch
    const spanNames = exporter.getFinishedSpans().map((s) => s.name);
    expect(spanNames).toContain('dedup_skipped');
  });

  test('per-row fallback on embedBatch failure: still persists via single embed', async () => {
    const store = new StubVectorStore();
    const embedder: Embedder = {
      embed: vi.fn(async () => mockEmbedding()),
      embedBatch: vi.fn(async () => { throw new Error('batch endpoint down'); }),
    };
    const llm = makeLlm({ memory: [{ id: '0', text: 'Paulo likes coffee' }] });
    const result = await runExtractionPipeline(
      [{ role: 'user', content: 'x' }],
      { user_id: 'alice' },
      { vectorStore: store, embedder, llm },
    );
    expect(result).toHaveLength(1);
    expect(embedder.embed).toHaveBeenCalled();
  });

  test('emits spans for extraction/embedding/persist completion when tracer provided', async () => {
    const { tracer, exporter } = setupTracer();
    const store = new StubVectorStore();
    const llm = makeLlm({ memory: [{ id: '0', text: 'fact' }] });
    await runExtractionPipeline(
      [{ role: 'user', content: 'x' }],
      { user_id: 'alice' },
      { vectorStore: store, embedder: makeEmbedder(), llm, tracer },
    );
    const spanNames = new Set(exporter.getFinishedSpans().map((s) => s.name));
    expect(spanNames.has('extraction_completed')).toBe(true);
    expect(spanNames.has('embedding_batch_completed')).toBe(true);
    expect(spanNames.has('persist_completed')).toBe(true);
  });

  test('infer:false fast-path persists message text verbatim (no LLM call)', async () => {
    const store = new StubVectorStore();
    const llm = makeLlm({ memory: [] });
    const result = await runExtractionPipeline(
      [{ role: 'user', content: 'verbatim fact' }],
      { user_id: 'alice' },
      { vectorStore: store, embedder: makeEmbedder(), llm },
      { infer: false },
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.text).toBe('verbatim fact');
    expect(llm.generateResponse).not.toHaveBeenCalled();
  });

  test('propagates scope into persisted payload', async () => {
    const store = new StubVectorStore();
    const llm = makeLlm({ memory: [{ id: '0', text: 'fact' }] });
    await runExtractionPipeline(
      [{ role: 'user', content: 'x' }],
      { user_id: 'alice', session_id: 's1' },
      { vectorStore: store, embedder: makeEmbedder(), llm },
    );
    const [rows] = await store.list({ user_id: 'alice', session_id: 's1' });
    expect(rows.length).toBe(1);
  });

  test('calls historyManager.batchAddHistory when provided (with optional batch method)', async () => {
    const store = new StubVectorStore();
    const llm = makeLlm({ memory: [{ id: '0', text: 'fact' }] });
    const batchAddHistory = vi.fn(async () => undefined);
    const historyManager = {
      addHistory: vi.fn(async () => undefined),
      getHistory: vi.fn(async () => []),
      reset: vi.fn(async () => undefined),
      close: vi.fn(() => undefined),
      batchAddHistory,
    };
    await runExtractionPipeline(
      [{ role: 'user', content: 'x' }],
      { user_id: 'alice' },
      { vectorStore: store, embedder: makeEmbedder(), llm, historyManager },
    );
    expect(batchAddHistory).toHaveBeenCalledOnce();
  });

  test('history is skipped when historyManager is absent (no throw)', async () => {
    const store = new StubVectorStore();
    const llm = makeLlm({ memory: [{ id: '0', text: 'fact' }] });
    const result = await runExtractionPipeline(
      [{ role: 'user', content: 'x' }],
      { user_id: 'alice' },
      { vectorStore: store, embedder: makeEmbedder(), llm },
    );
    expect(result).toHaveLength(1);
  });

  describe('domain-ontologies T2.2 — ontology coercion + fail-soft (Item 15)', () => {
    test('out-of-vocab entity type is coerced + emits ontology_type_coerced; in-vocab kept', async () => {
      const { tracer, exporter } = setupTracer();
      const store = new StubVectorStore();
      const llm = makeLlm({
        memory: [{ id: '0', text: 'clinical note' }],
        entities: [
          { name: 'hypertension', type: 'Diagnosis' }, // in medical vocab
          { name: 'Merlin', type: 'Wizard' }, // out-of-vocab → OTHER
        ],
      });
      const result = await runExtractionPipeline(
        [{ role: 'user', content: 'note' }],
        { user_id: 'alice' },
        { vectorStore: store, embedder: makeEmbedder(), llm, tracer, ontology: BUILTIN_ONTOLOGIES.medical },
      );
      expect(result).toHaveLength(1);
      const spans = exporter.getFinishedSpans().map((sp) => sp.name);
      expect(spans).toContain('ontology_type_coerced');
    });

    test('FAIL-SOFT: an ontology-layer throw (broken tracer) NEVER fails the write (ADR D2)', async () => {
      const store = new StubVectorStore();
      const llm = makeLlm({
        memory: [{ id: '0', text: 'clinical note' }],
        entities: [{ name: 'Merlin', type: 'Wizard' }], // out-of-vocab → triggers the coercion event path
      });
      // A tracer whose startActiveSpan throws on the coercion event — the pipeline's
      // ontology try/catch MUST swallow it so the write still succeeds (fail-soft).
      const throwingTracer = {
        startActiveSpan: ((name: string) => {
          if (name === 'ontology_type_coerced') throw new Error('tracer exploded');
        }) as never,
      } as never;
      const result = await runExtractionPipeline(
        [{ role: 'user', content: 'note' }],
        { user_id: 'alice' },
        { vectorStore: store, embedder: makeEmbedder(), llm, tracer: throwingTracer, ontology: BUILTIN_ONTOLOGIES.medical },
      );
      // The fact still persisted despite the ontology-layer throw.
      expect(result).toHaveLength(1);
      expect(result[0]?.text).toBe('clinical note');
    });

    test('no ontology configured → DEFAULT taxonomy coerces out-of-vocab observably (M13 T1.1)', async () => {
      // Pin FLIPPED by M13 (#111, ADR D1): the default path now applies
      // DEFAULT_ENTITY_TAXONOMY — an out-of-vocab type ('Wizard') is coerced to
      // OTHER with the observable `ontology_type_coerced` event (Princípio 3),
      // instead of being silently discarded to a mechanism label.
      const { tracer, exporter } = setupTracer();
      const store = new StubVectorStore();
      const llm = makeLlm({
        memory: [{ id: '0', text: 'clinical note' }],
        entities: [{ name: 'Merlin', type: 'Wizard' }],
      });
      await runExtractionPipeline(
        [{ role: 'user', content: 'note' }],
        { user_id: 'alice' },
        { vectorStore: store, embedder: makeEmbedder(), llm, tracer },
      );
      const spans = exporter.getFinishedSpans().map((sp) => sp.name);
      expect(spans).toContain('ontology_type_coerced');
    });
  });

  describe('extraction-language-determinism fixes-cycle-1 T3.1 — detect-inject + fail-soft guard', () => {
    // Capturing LLM: records the system-prompt content passed to generateResponse.
    const makeCapturingLlm = (response: unknown): { llm: LLM; captured: { system: string } } => {
      const captured = { system: '' };
      const llm: LLM = {
        generateResponse: vi.fn(async (messages: readonly { role: string; content: string }[]) => {
          if (isIdentification(messages)) return { language: 'en' };
          captured.system = messages.find((m) => m.role === 'system')?.content ?? '';
          return response;
        }),
        generateChat: vi.fn(async () => ({ role: 'assistant' as const, content: '' })),
      };
      return { llm, captured };
    };

    test('injects the detected input language into the system prompt (D1)', async () => {
      const store = new StubVectorStore();
      const { llm, captured } = makeCapturingLlm({ memory: [{ id: '0', text: 'Sarah works as a data scientist' }] });
      await runExtractionPipeline(
        [{ role: 'user', content: 'My name is Sarah and I work as a data scientist and I love rock climbing' }],
        { user_id: 'alice' },
        { vectorStore: store, embedder: makeEmbedder(), llm },
      );
      expect(captured.system).toMatch(/LANGUAGE DIRECTIVE/);
      expect(captured.system).toMatch(/in English/);
    });

    test('corrects a mismatched fact + emits extraction_language_mismatch (D3, Princípio 3)', async () => {
      const { tracer, exporter } = setupTracer();
      const store = new StubVectorStore();
      // Call-aware stub: the EXTRACTION call ({type:'json'}) returns a Portuguese
      // fact for the English input (the residual EG-4 leak); the CORRECTION call
      // (plain text) returns the English rewrite.
      // call 1 = extraction (json object); call 2 = correction. The real OpenAILLM
      // text-mode returns a `{ text }` OBJECT (not a bare string) — use that exact
      // shape so the guard's response-text extraction is tested against reality.
      const llm = languageAwareLlm({ language: 'en' }, (call) => (call === 1
        ? { memory: [{ id: '0', text: 'Sarah trabalha como cientista de dados e adora escalada' }] }
        : { text: 'Sarah works as a data scientist and loves rock climbing' }));
      const result = await runExtractionPipeline(
        [{ role: 'user', content: 'My name is Sarah and I work as a data scientist and I love rock climbing' }],
        { user_id: 'alice' },
        { vectorStore: store, embedder: makeEmbedder(), llm, tracer },
      );
      // The persisted fact was CORRECTED to English (guard never drops it).
      expect(result).toHaveLength(1);
      expect(result[0]?.text).toBe('Sarah works as a data scientist and loves rock climbing');
      const mismatch = exporter.getFinishedSpans().find((s) => s.name === 'extraction_language_mismatch');
      expect(mismatch).toBeDefined();
      expect(mismatch!.attributes['input_language']).toBe('en');
      expect(mismatch!.attributes['facts_language']).toBe('pt');
      expect(mismatch!.attributes['fact_count']).toBe(1);
      expect(mismatch!.attributes['corrected']).toBe(1);
    });

    test('the language guard is fail-soft: a correction error keeps the original fact + emits residual (never fails remember)', async () => {
      const { tracer, exporter } = setupTracer();
      const store = new StubVectorStore();
      // Extraction returns a PT fact (mismatch); the correction call throws.
      const llm = languageAwareLlm({ language: 'en' }, (call) => (call === 1
        ? { memory: [{ id: '0', text: 'Sarah trabalha como cientista de dados' }] }
        : new Error('correction LLM unavailable')));
      const result = await runExtractionPipeline(
        [{ role: 'user', content: 'My name is Sarah and I work as a data scientist and I love rock climbing' }],
        { user_id: 'alice' },
        { vectorStore: store, embedder: makeEmbedder(), llm, tracer },
      );
      // remember() still resolves; the original (uncorrected) fact is kept.
      expect(result).toHaveLength(1);
      expect(result[0]?.text).toBe('Sarah trabalha como cientista de dados');
      // residual is observable: the mismatch fired with corrected=0 (Princípio 3).
      const mismatch = exporter.getFinishedSpans().find((s) => s.name === 'extraction_language_mismatch');
      expect(mismatch).toBeDefined();
      expect(mismatch!.attributes['facts_language']).toBe('pt');
      expect(mismatch!.attributes['fact_count']).toBe(1);
      expect(mismatch!.attributes['corrected']).toBe(0);
    });

    test('no extraction_language_mismatch when the fact language matches the input (no-op discipline)', async () => {
      const { tracer, exporter } = setupTracer();
      const store = new StubVectorStore();
      const llm = makeLlm({ memory: [{ id: '0', text: 'Sarah works as a data scientist and enjoys climbing' }] });
      await runExtractionPipeline(
        [{ role: 'user', content: 'My name is Sarah and I work as a data scientist and I love rock climbing' }],
        { user_id: 'alice' },
        { vectorStore: store, embedder: makeEmbedder(), llm, tracer },
      );
      const spans = exporter.getFinishedSpans().map((s) => s.name);
      expect(spans).not.toContain('extraction_language_mismatch');
    });

    test('names the input language from the text with its proper names masked (#254)', async () => {
      const llm = languageAwareLlm({ language: 'en' }, () => ({ memory: [{ id: '0', text: "Mihaela's nephew Sorin is a pilot" }] }));
      await runExtractionPipeline(
        [{ role: 'user', content: "Mihaela's nephew Sorin is a pilot." }],
        { user_id: 'alice' },
        { vectorStore: new StubVectorStore(), embedder: makeEmbedder(), llm },
      );
      const identification = vi.mocked(llm.generateResponse).mock.calls.find(([messages]) => isIdentification(messages));
      expect(identification?.[0][1]?.content).toBe("X's nephew X is a pilot.");
      expect(extractionCalls(llm)[0]?.[0][0]?.content).toMatch(/LANGUAGE DIRECTIVE: the input language is English/);
    });

    test('a failed identification injects no directive and emits extraction_language_identification_failed (#254)', async () => {
      const { tracer, exporter } = setupTracer();
      const llm = languageAwareLlm(new Error('identification LLM unavailable'), () => ({ memory: [{ id: '0', text: 'Sarah works as a data scientist' }] }));
      const result = await runExtractionPipeline(
        [{ role: 'user', content: 'My name is Sarah and I work as a data scientist' }],
        { user_id: 'alice' },
        { vectorStore: new StubVectorStore(), embedder: makeEmbedder(), llm, tracer },
      );
      expect(result).toHaveLength(1);
      expect(extractionCalls(llm)[0]?.[0][0]?.content).not.toMatch(/LANGUAGE DIRECTIVE/);
      const span = exporter.getFinishedSpans().find((sp) => sp.name === 'extraction_language_identification_failed');
      expect(span?.attributes['reason']).toBe('llm_error');
      expect(span?.attributes['error']).toBe('Error');
    });

    test('an unsupported input language is reported with its code and injects no directive (#254)', async () => {
      const { tracer, exporter } = setupTracer();
      const llm = languageAwareLlm({ language: 'pl' }, () => ({ memory: [{ id: '0', text: 'Ola mieszka w Krakowie' }] }));
      await runExtractionPipeline(
        [{ role: 'user', content: 'Ola mieszka w Krakowie od dawna' }],
        { user_id: 'alice' },
        { vectorStore: new StubVectorStore(), embedder: makeEmbedder(), llm, tracer },
      );
      expect(extractionCalls(llm)[0]?.[0][0]?.content).not.toMatch(/LANGUAGE DIRECTIVE/);
      const span = exporter.getFinishedSpans().find((sp) => sp.name === 'extraction_language_identification_failed');
      expect(span?.attributes['reason']).toBe('unsupported_language');
      expect(span?.attributes['language']).toBe('pl');
    });

    test('a message with no text makes no identification call and injects no directive', async () => {
      const store = new StubVectorStore();
      const { llm, captured } = makeCapturingLlm({ memory: [{ id: '0', text: 'ok' }] });
      await runExtractionPipeline(
        [{ role: 'user', content: '   ' }],
        { user_id: 'alice' },
        { vectorStore: store, embedder: makeEmbedder(), llm },
      );
      expect(captured.system).not.toMatch(/LANGUAGE DIRECTIVE/);
      expect(vi.mocked(llm.generateResponse).mock.calls.some(([messages]) => isIdentification(messages))).toBe(false);
    });
  });

  describe('entity-label-language-determinism EG-5 — label normalization guard', () => {
    test('corrects PT entity/relation labels to EN + emits extraction_label_language_mismatch', async () => {
      const { tracer, exporter } = setupTracer();
      const store = new StubVectorStore();
      // call 1 = extraction (EN fact + PT entity/relation labels); call 2 = the label map.
      const llm = languageAwareLlm({ language: 'en' }, (call) => (call === 1
        ? {
            memory: [{ id: '0', text: 'User enjoys surfing on weekends.' }],
            entities: [{ name: 'surfar' }, { name: 'fins de semana' }],
            relations: [{ source: 'user', relationship: 'gosta de', destination: 'surfar' }],
          }
        : { surfar: 'surfing', 'fins de semana': 'weekends', 'gosta de': 'enjoys' }));
      const result = await runExtractionPipeline(
        [{ role: 'user', content: 'My name is Daniel and I enjoy surfing on weekends' }],
        { user_id: 'alice' },
        { vectorStore: store, embedder: makeEmbedder(), llm, tracer },
      );
      expect(result).toHaveLength(1); // fact persisted
      const span = exporter.getFinishedSpans().find((s) => s.name === 'extraction_label_language_mismatch');
      expect(span).toBeDefined();
      expect(span!.attributes['input_language']).toBe('en');
      expect(span!.attributes['corrected']).toBe(3);
    });

    test('the label guard is fail-soft: a map-call error never fails remember', async () => {
      const store = new StubVectorStore();
      const llm = languageAwareLlm({ language: 'en' }, (call) => (call === 1
        ? {
            memory: [{ id: '0', text: 'User enjoys surfing on weekends.' }],
            entities: [{ name: 'surfar' }],
            relations: [{ source: 'user', relationship: 'gosta de', destination: 'surfar' }],
          }
        : new Error('label map LLM unavailable')));
      const result = await runExtractionPipeline(
        [{ role: 'user', content: 'My name is Daniel and I enjoy surfing on weekends' }],
        { user_id: 'alice' },
        { vectorStore: store, embedder: makeEmbedder(), llm },
      );
      expect(result).toHaveLength(1); // remember resolved despite the label-map error
    });
  });

});

describe('runExtractionPipeline observedAt', () => {
  const OBSERVED = new Date('2023-07-23T18:46:00Z');

  test('gives the extractor the observation date so it can resolve relative time expressions', async () => {
    const llm = makeLlm({ memory: [{ id: '0', text: 'Gina went to a dance class on 2023-07-21' }] });
    await runExtractionPipeline(
      [{ role: 'user', content: 'Last Friday I went to a dance class' }],
      { user_id: 'gina' },
      { vectorStore: new StubVectorStore(), embedder: makeEmbedder(), llm },
      { observedAt: OBSERVED },
    );
    const firstCall = extractionCalls(llm)[0]?.[0] ?? [];
    expect(firstCall[0]?.content).toContain('2023-07-23 (Sunday)');
  });

  test('reports the observation time as the memory valid-from instant', async () => {
    const llm = makeLlm({ memory: [{ id: '0', text: 'Gina went to a dance class on 2023-07-21' }] });
    const [item] = await runExtractionPipeline(
      [{ role: 'user', content: 'Last Friday I went to a dance class' }],
      { user_id: 'gina' },
      { vectorStore: new StubVectorStore(), embedder: makeEmbedder(), llm },
      { observedAt: OBSERVED },
    );
    expect(item?.tValid).toEqual(OBSERVED);
  });

  test('the verbatim path (infer:false) also records the observation time', async () => {
    const [item] = await runExtractionPipeline(
      [{ role: 'user', content: 'Gina opened her online store' }],
      { user_id: 'gina' },
      { vectorStore: new StubVectorStore(), embedder: makeEmbedder(), llm: makeLlm({ memory: [] }) },
      { observedAt: OBSERVED, infer: false },
    );
    expect(item?.tValid).toEqual(OBSERVED);
  });

  test('a future observation time is rejected before any provider call', async () => {
    const llm = makeLlm({ memory: [] });
    await expect(runExtractionPipeline(
      [{ role: 'user', content: 'x' }],
      { user_id: 'gina' },
      { vectorStore: new StubVectorStore(), embedder: makeEmbedder(), llm },
      { observedAt: new Date(Date.now() + 24 * 3600 * 1000) },
    )).rejects.toThrow(/observedAt/);
    expect(llm.generateResponse).not.toHaveBeenCalled();
  });
});

describe('runExtractionPipeline message log', () => {
  const SCOPE = { user_id: 'anna' };

  test('logs the new messages and links them to the facts they produced', async () => {
    const messageLog = new InMemoryMessageLog();
    const items = await runExtractionPipeline(
      [{ role: 'user', content: 'I took my sister Anna to the pottery class' }],
      SCOPE,
      { vectorStore: new StubVectorStore(), embedder: makeEmbedder(), llm: makeLlm({ memory: [{ id: '0', text: 'user took their sister Anna to a pottery class' }] }), messageLog },
    );
    expect(items).toHaveLength(1);
    expect((await messageLog.recent(SCOPE, 10)).map((m) => m.content)).toEqual(['I took my sister Anna to the pottery class']);
    expect((await messageLog.sourcesOf(SCOPE, items[0]!.id)).map((m) => m.content)).toEqual(['I took my sister Anna to the pottery class']);
  });

  test('gives the extractor the preceding turns of the scope as context', async () => {
    const messageLog = new InMemoryMessageLog();
    await messageLog.append(SCOPE, [{ role: 'user', content: 'I took my sister Anna to the pottery class' }]);
    const llm = makeLlm({ memory: [] });
    await runExtractionPipeline([{ role: 'user', content: 'She loved it' }], SCOPE,
      { vectorStore: new StubVectorStore(), embedder: makeEmbedder(), llm, messageLog });
    const system = extractionCalls(llm)[0]?.[0]?.[0]?.content ?? '';
    expect(system).toContain('## Previous Messages');
    expect(system).toContain('user: I took my sister Anna to the pottery class');
    // The current turn is a New Message, never its own context.
    expect(system.slice(system.indexOf('## Previous Messages'), system.indexOf('## New Messages'))).not.toContain('She loved it');
  });

  test('reads at most the configured number of preceding turns', async () => {
    const messageLog = new InMemoryMessageLog();
    for (const content of ['t1', 't2', 't3']) await messageLog.append(SCOPE, [{ role: 'user', content }]);
    const llm = makeLlm({ memory: [] });
    await runExtractionPipeline([{ role: 'user', content: 'now' }], SCOPE,
      { vectorStore: new StubVectorStore(), embedder: makeEmbedder(), llm, messageLog, contextMessageCount: 2 });
    const system = extractionCalls(llm)[0]?.[0]?.[0]?.content ?? '';
    expect(system).not.toContain('user: t1');
    expect(system).toContain('user: t2');
    expect(system).toContain('user: t3');
  });

  test('logs the messages even when nothing was extracted from them', async () => {
    const messageLog = new InMemoryMessageLog();
    await runExtractionPipeline([{ role: 'user', content: 'hmm ok' }], SCOPE,
      { vectorStore: new StubVectorStore(), embedder: makeEmbedder(), llm: makeLlm({ memory: [] }), messageLog });
    expect((await messageLog.recent(SCOPE, 10)).map((m) => m.content)).toEqual(['hmm ok']);
  });

  test('the verbatim path (infer:false) logs and links too', async () => {
    const messageLog = new InMemoryMessageLog();
    const [item] = await runExtractionPipeline([{ role: 'user', content: 'Anna opened a store' }], SCOPE,
      { vectorStore: new StubVectorStore(), embedder: makeEmbedder(), llm: makeLlm({ memory: [] }), messageLog }, { infer: false });
    expect((await messageLog.sourcesOf(SCOPE, item!.id)).map((m) => m.content)).toEqual(['Anna opened a store']);
  });

  test('records the observation time on the logged messages', async () => {
    const messageLog = new InMemoryMessageLog();
    const observedAt = new Date('2023-07-23T18:46:00Z');
    await runExtractionPipeline([{ role: 'user', content: 'x' }], SCOPE,
      { vectorStore: new StubVectorStore(), embedder: makeEmbedder(), llm: makeLlm({ memory: [] }), messageLog }, { observedAt });
    expect((await messageLog.recent(SCOPE, 1))[0]?.observedAt).toEqual(observedAt);
  });

  test('a failing log does not fail the write, and the failure is an observable event', async () => {
    const { tracer, exporter } = setupTracer();
    const failing = new InMemoryMessageLog();
    vi.spyOn(failing, 'append').mockRejectedValue(new Error('log unavailable'));
    const items = await runExtractionPipeline([{ role: 'user', content: 'I live in Lisbon' }], SCOPE,
      { vectorStore: new StubVectorStore(), embedder: makeEmbedder(), llm: makeLlm({ memory: [{ id: '0', text: 'user lives in Lisbon' }] }), messageLog: failing, tracer });
    expect(items).toHaveLength(1);
    expect(exporter.getFinishedSpans().map((span) => span.name)).toContain('message_log_failed');
  });

  test('a rejected write logs nothing', async () => {
    const messageLog = new InMemoryMessageLog();
    await expect(runExtractionPipeline([{ role: 'user', content: 'x' }], SCOPE,
      { vectorStore: new StubVectorStore(), embedder: makeEmbedder(), llm: makeLlm({ memory: [] }), messageLog },
      { observedAt: new Date(Date.now() + 86_400_000) })).rejects.toThrow();
    expect(await messageLog.recent(SCOPE, 10)).toEqual([]);
  });
});

describe('runExtractionPipeline supersession on write', () => {
  const SCOPE = { user_id: 'anna' };
  /** Vectors by topic: residence facts share one direction, everything else another. */
  const topicVector = (text: string): readonly number[] => {
    const v = new Array<number>(MAX_EMBEDDING_DIM).fill(0);
    v[/Porto|Lisbon|live|moved/i.test(text) ? 0 : 1] = 1;
    return v;
  };
  const topicEmbedder = (): Embedder => ({
    embed: vi.fn(async (text: string) => topicVector(text)),
    embedBatch: vi.fn(async (texts: readonly string[]) => texts.map(topicVector)),
  });
  /** The id the prompt gave to the existing memory whose text contains `needle`. */
  const promptIdOf = (system: string, needle: string): string =>
    system.split('\n').find((line) => /^\d+\. /.test(line) && line.includes(needle))?.split('.')[0] ?? 'none';
  /** An extractor that states `text` and supersedes the existing memory containing `needle`. */
  const supersedingLlm = (text: string, needle: string): LLM => ({
    generateResponse: vi.fn(async (messages: readonly { readonly content: string }[]) => {
      const system = messages[0]?.content ?? '';
      return { memory: [{ id: '0', text, supersedes_memory_ids: [promptIdOf(system, needle)] }] };
    }),
    generateChat: vi.fn(),
  });

  async function seed(store: InMemoryVectorStore, text: string, tValid = '2023-01-01T00:00:00.000Z'): Promise<string> {
    const id = randomUUID();
    await store.insert([topicVector(text)], [id], [{ text, hash: id, user_id: 'anna', t_valid: tValid }]);
    return id;
  }

  test('a fact that replaces an existing memory invalidates it from the observation time', async () => {
    const store = new InMemoryVectorStore();
    const porto = await seed(store, 'user lives in Porto');
    const observedAt = new Date('2024-03-01T00:00:00Z');
    const [item] = await runExtractionPipeline([{ role: 'user', content: 'I moved to Lisbon' }], SCOPE,
      { vectorStore: store, embedder: topicEmbedder(), llm: supersedingLlm('user lives in Lisbon', 'Porto') }, { observedAt });
    expect(item?.supersedes).toEqual([porto]);
    expect((await store.list(SCOPE, 10))[0].map((r) => r.payload['text'])).toEqual(['user lives in Lisbon']);
    expect((await store.list({ ...SCOPE, asOf: new Date('2024-02-01T00:00:00Z') }, 10))[0].map((r) => r.id)).toContain(porto);
  });

  test('records each supersession in the history with both texts', async () => {
    const store = new InMemoryVectorStore();
    const porto = await seed(store, 'user lives in Porto');
    const batchAddHistory = vi.fn(async (_records: readonly HistoryBatchRecord[]) => undefined);
    const historyManager = { addHistory: vi.fn(), getHistory: vi.fn(), reset: vi.fn(), close: vi.fn(), batchAddHistory };
    await runExtractionPipeline([{ role: 'user', content: 'I moved to Lisbon' }], SCOPE,
      { vectorStore: store, embedder: topicEmbedder(), llm: supersedingLlm('user lives in Lisbon', 'Porto'), historyManager });
    const records = batchAddHistory.mock.calls.flatMap((call) => [...call[0]]);
    expect(records).toContainEqual(expect.objectContaining({
      memoryId: porto, action: 'supersede', previousValue: 'user lives in Porto', newValue: 'user lives in Lisbon',
    }));
  });

  test('the extractor sees the existing memories most similar to the new messages, not only the latest', async () => {
    const store = new InMemoryVectorStore();
    // The residence fact is the oldest of seven, so a most-recent-five context would miss it.
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
      await seed(store, 'user lives in Porto');
      for (let i = 0; i < 6; i += 1) {
        vi.setSystemTime(new Date(Date.UTC(2024, 0, 2 + i)));
        await seed(store, `user owns book number ${String(i)}`);
      }
    } finally {
      vi.useRealTimers();
    }
    expect((await store.list(SCOPE, 5))[0].map((r) => r.payload['text'])).not.toContain('user lives in Porto');
    const llm = makeLlm({ memory: [] });
    await runExtractionPipeline([{ role: 'user', content: 'I moved to Lisbon' }], SCOPE, { vectorStore: store, embedder: topicEmbedder(), llm });
    const system = extractionCalls(llm)[0]?.[0]?.[0]?.content ?? '';
    expect(system).toContain('user lives in Porto');
  });

  test('an id the prompt never showed is rejected as an observable event and nothing is invalidated', async () => {
    const { tracer, exporter } = setupTracer();
    const store = new InMemoryVectorStore();
    await seed(store, 'user lives in Porto');
    const llm = makeLlm({ memory: [{ id: '0', text: 'user lives in Lisbon', supersedes_memory_ids: ['99'] }] });
    const [item] = await runExtractionPipeline([{ role: 'user', content: 'I moved to Lisbon' }], SCOPE,
      { vectorStore: store, embedder: topicEmbedder(), llm, tracer });
    expect(item?.supersedes ?? []).toEqual([]);
    expect((await store.list(SCOPE, 10))[1]).toBe(2);
    expect(exporter.getFinishedSpans().map((span) => span.name)).toContain('supersession_rejected');
  });

  test('an observation older than the memory it would replace leaves that memory current', async () => {
    const { tracer, exporter } = setupTracer();
    const store = new InMemoryVectorStore();
    const lisbon = await seed(store, 'user lives in Lisbon', '2024-06-01T00:00:00.000Z');
    const [item] = await runExtractionPipeline([{ role: 'user', content: 'I live in Porto' }], SCOPE,
      { vectorStore: store, embedder: topicEmbedder(), llm: supersedingLlm('user lives in Porto', 'Lisbon'), tracer },
      { observedAt: new Date('2023-01-01T00:00:00Z') });
    expect(item?.supersedes ?? []).toEqual([]);
    expect((await store.list(SCOPE, 10))[0].map((r) => r.id)).toContain(lisbon);
    expect(exporter.getFinishedSpans().map((span) => span.name)).toContain('supersession_skipped');
  });

  test('supersedeOnWrite false keeps every existing memory current and does not ask the extractor', async () => {
    const store = new InMemoryVectorStore();
    const porto = await seed(store, 'user lives in Porto');
    const llm = supersedingLlm('user lives in Lisbon', 'Porto');
    const [item] = await runExtractionPipeline([{ role: 'user', content: 'I moved to Lisbon' }], SCOPE,
      { vectorStore: store, embedder: topicEmbedder(), llm, supersedeOnWrite: false });
    expect(item?.supersedes ?? []).toEqual([]);
    expect((await store.list(SCOPE, 10))[0].map((r) => r.id)).toContain(porto);
    const system = extractionCalls(llm)[0]?.[0]?.[0]?.content ?? '';
    expect(system).not.toContain('supersedes_memory_ids');
  });
});
