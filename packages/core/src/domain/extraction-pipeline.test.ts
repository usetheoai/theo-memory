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
import { trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { describe, expect, test, vi } from 'vitest';

import { MAX_EMBEDDING_DIM } from './constants.js';
import type { Embedder } from './dip/embedder.js';
import type { LLM } from './dip/llm.js';
import type { InsertOutcome, VectorStore, VectorStoreResult } from './dip/vector-store.js';
import { runExtractionPipeline } from './extraction/pipeline.js';
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

const setupTracer = () => {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  return { tracer: provider.getTracer('test'), exporter };
};

describe('runExtractionPipeline (8-phase write)', () => {
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

    test('no ontology configured → no coercion event (default path)', async () => {
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
      expect(spans).not.toContain('ontology_type_coerced');
    });
  });

  describe('extraction-language-determinism fixes-cycle-1 T3.1 — detect-inject + fail-soft guard', () => {
    // Capturing LLM: records the system-prompt content passed to generateResponse.
    const makeCapturingLlm = (response: unknown): { llm: LLM; captured: { system: string } } => {
      const captured = { system: '' };
      const llm: LLM = {
        generateResponse: vi.fn(async (messages: readonly { role: string; content: string }[]) => {
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
      let call = 0;
      const llm: LLM = {
        generateResponse: vi.fn(async () => {
          call += 1;
          // call 1 = extraction (json object); call 2 = correction. The real OpenAILLM
          // text-mode returns a `{ text }` OBJECT (not a bare string) — use that exact
          // shape so the guard's response-text extraction is tested against reality.
          return call === 1
            ? { memory: [{ id: '0', text: 'Sarah trabalha como cientista de dados e adora escalada' }] }
            : { text: 'Sarah works as a data scientist and loves rock climbing' };
        }),
        generateChat: vi.fn(async () => ({ role: 'assistant' as const, content: '' })),
      };
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
      let call = 0;
      const llm: LLM = {
        generateResponse: vi.fn(async () => {
          call += 1;
          if (call === 1) return { memory: [{ id: '0', text: 'Sarah trabalha como cientista de dados' }] };
          throw new Error('correction LLM unavailable');
        }),
        generateChat: vi.fn(async () => ({ role: 'assistant' as const, content: '' })),
      };
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

    test('undetermined/short input injects no directive (byte-unchanged behavior)', async () => {
      const store = new StubVectorStore();
      const { llm, captured } = makeCapturingLlm({ memory: [{ id: '0', text: 'ok' }] });
      await runExtractionPipeline(
        [{ role: 'user', content: 'hi' }],
        { user_id: 'alice' },
        { vectorStore: store, embedder: makeEmbedder(), llm },
      );
      expect(captured.system).not.toMatch(/LANGUAGE DIRECTIVE/);
    });
  });

});
