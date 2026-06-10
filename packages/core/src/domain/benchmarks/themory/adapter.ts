/**
 * TheMemoryBenchmarkAdapter — BenchmarkAdapter DIP impl for TheMemory.
 *
 * EC-5 absorption: scopedUserId = `${conversationId}::${speaker ?? 'unknown'}`
 * preserves the multi-speaker boundary that LongMemEval and LoCoMo encode
 * per turn. `search()` recalls each expected-speaker scope and merges the
 * results, deduplicating by id before sorting by score.
 *
 * Drift-T3.1-1: constructor takes a {memory, llm, tokenizer} config object
 *   — plan sketch was missing the llm injection point.
 * Drift-T3.1-2: metadata is coerced at the DIP exit because the external
 *   BenchmarkCorpusItem permits `unknown` values for fixture-flexibility
 *   while the internal RememberOptions constrains to flat primitives.
 *   Nested values fall through to JSON.stringify (honest, not silent drop).
 * Drift-T3.1-3: `Tokenizer` declared inline (not promoted to src/core/dip/
 *   yet) — single consumer at T3.1; T4.1 promotes when tiktoken impl ships.
 * Drift-T3.1-4: cross-speaker dedup-by-id added to the merge loop.
 *
 * Per ADR D5 implementation lives under src/benchmarks/{adapter}/; per
 * ADR D6 BenchmarkAdapter does not extend MemoryStore.
 *
 * @see plan v1.2 § T3.1 + ADRs D5/D6 + EC-5
 */

import type {
  AddMetrics,
  BenchmarkAdapter,
  BenchmarkCorpus,
  BenchmarkQuery,
  SearchResult,
} from '../../dip/benchmark-adapter.js';
import type { LLM } from '../../dip/llm.js';
import type { Tokenizer } from '../../dip/tokenizer.js';
import type { Memory } from '../../memory-store.js';

// v0-8-fixes-cycle-1 T3.1 (Drift-T4.1-2): Tokenizer was inline here in
// v0.8 source plan; promoted to src/core/dip/tokenizer.ts (11th DIP)
// after the consumer count grew to 6 production + 5 test during T6.x
// vendor adapter rollout. Re-export keeps backward compat for the
// few existing callers that still import from this path.
export type { Tokenizer } from '../../dip/tokenizer.js';

export interface TheMemoryBenchmarkAdapterConfig {
  readonly memory: Memory;
  readonly llm: LLM;
  readonly tokenizer: Tokenizer;
  /**
   * Model identifier surfaced through SearchResult.modelUsed so the
   * benchmark runner can compute cost per ADR D7. Drift-T5.1-1 absorption.
   *
   * Defaults to 'gpt-4o-mini' when omitted (common reference default for benchmark eval).
   */
  readonly modelId?: string;
}

type PrimitiveMetadataValue = string | number | boolean | null;

function coerceMetadata(
  raw: Readonly<Record<string, unknown>>,
): Readonly<Record<string, PrimitiveMetadataValue>> {
  const out: Record<string, PrimitiveMetadataValue> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      out[k] = v;
    } else {
      out[k] = JSON.stringify(v);
    }
  }
  return out;
}

const ANSWER_SYSTEM_PROMPT = 'Answer based on the retrieved context.';
const TOP_K = 30;
const DEFAULT_SPEAKERS: readonly string[] = ['unknown'];

const DEFAULT_MODEL_ID = 'gpt-4o-mini';

export class TheMemoryBenchmarkAdapter implements BenchmarkAdapter {
  readonly name = 'themory';
  private readonly memory: Memory;
  private readonly llm: LLM;
  private readonly tokenizer: Tokenizer;
  private readonly modelId: string;

  constructor(config: TheMemoryBenchmarkAdapterConfig) {
    this.memory = config.memory;
    this.llm = config.llm;
    this.tokenizer = config.tokenizer;
    this.modelId = config.modelId ?? DEFAULT_MODEL_ID;
  }

  private scopedUserId(conversationId: string, speaker?: string): string {
    return `${conversationId}::${speaker ?? 'unknown'}`;
  }

  async add(corpus: BenchmarkCorpus): Promise<AddMetrics> {
    const start = performance.now();
    for (const item of corpus.items) {
      const userId = this.scopedUserId(corpus.conversationId, item.speaker);
      await this.memory.user(userId).remember(item.text, {
        metadata: coerceMetadata(item.metadata),
      });
    }
    return {
      itemCount: corpus.items.length,
      latencyMs: performance.now() - start,
    };
  }

  async search(query: BenchmarkQuery): Promise<SearchResult> {
    const start = performance.now();
    const speakers = query.expectedSpeakers ?? DEFAULT_SPEAKERS;
    const merged: { id: string; text: string; score: number }[] = [];
    for (const sp of speakers) {
      const userId = this.scopedUserId(query.conversationId, sp);
      const hits = await this.memory.user(userId).recall(query.questionText, { topK: TOP_K });
      for (const hit of hits) {
        merged.push({ id: hit.id, text: hit.text, score: hit.score });
      }
    }
    const seen = new Set<string>();
    const deduped = merged.filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });
    deduped.sort((a, b) => b.score - a.score);
    const context = deduped.slice(0, TOP_K).map((r) => r.text);
    const promptUser = `Context:\n${context.join('\n')}\n\nQuestion: ${query.questionText}`;
    const response = await this.llm.generateChat([
      { role: 'system', content: ANSWER_SYSTEM_PROMPT },
      { role: 'user', content: promptUser },
    ]);
    return {
      answer: response.content,
      retrievedContext: context,
      latencyMs: performance.now() - start,
      tokensUsed: {
        prompt: this.tokenizer.count(promptUser) + this.tokenizer.count(ANSWER_SYSTEM_PROMPT),
        completion: this.tokenizer.count(response.content),
      },
      modelUsed: this.modelId,
    };
  }
}
