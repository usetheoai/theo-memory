/**
 * Mem0BenchmarkAdapter — BenchmarkAdapter DIP impl for the 3rd-party vendor.
 *
 * Drift-T6.x-1: ships with a Mem0VendorClient interface that the adapter
 * consumes via DI. Real `vendor SDK` SDK wiring (Mem0OfficialClient class)
 * is deferred to a follow-up cycle. T6.x scope: validate the
 * BenchmarkAdapter pattern works for non-TheMemory adapters (SOLID/OCP).
 *
 * Drift-T5.1-1 absorbed: returns SearchResult.modelUsed for cost lookup.
 *
 * Per ADR D5 implementation lives under src/benchmarks/{vendor}/; per
 * ADR D6 BenchmarkAdapter does not extend MemoryStore.
 *
 * @see plan v1.2 § T6.1 + ADRs D5 / D6
 */

import type {
  AddMetrics,
  BenchmarkAdapter,
  BenchmarkCorpus,
  BenchmarkQuery,
  SearchResult,
} from '../../dip/benchmark-adapter.js';
import type { Tokenizer } from '../../dip/tokenizer.js';

export interface Mem0VendorClient {
  add(userId: string, text: string): Promise<void>;
  search(
    userId: string,
    query: string,
    topK: number,
  ): Promise<readonly { text: string; score: number }[]>;
  synthesize(question: string, context: readonly string[]): Promise<string>;
}

export interface Mem0BenchmarkAdapterConfig {
  readonly client: Mem0VendorClient;
  readonly tokenizer: Tokenizer;
  readonly modelId?: string;
}

const DEFAULT_MODEL_ID = 'gpt-4o-mini';
const TOP_K = 30;

export class Mem0BenchmarkAdapter implements BenchmarkAdapter {
  readonly name = 'REDACTED';
  private readonly client: Mem0VendorClient;
  private readonly tokenizer: Tokenizer;
  private readonly modelId: string;

  constructor(config: Mem0BenchmarkAdapterConfig) {
    this.client = config.client;
    this.tokenizer = config.tokenizer;
    this.modelId = config.modelId ?? DEFAULT_MODEL_ID;
  }

  async add(corpus: BenchmarkCorpus): Promise<AddMetrics> {
    const start = performance.now();
    for (const item of corpus.items) {
      await this.client.add(corpus.conversationId, item.text);
    }
    return {
      itemCount: corpus.items.length,
      latencyMs: performance.now() - start,
    };
  }

  async search(query: BenchmarkQuery): Promise<SearchResult> {
    const start = performance.now();
    const hits = await this.client.search(query.conversationId, query.questionText, TOP_K);
    const context = hits.map((h) => h.text);
    const answer = await this.client.synthesize(query.questionText, context);
    const promptUser = `Context:\n${context.join('\n')}\n\nQuestion: ${query.questionText}`;
    return {
      answer,
      retrievedContext: context,
      latencyMs: performance.now() - start,
      tokensUsed: {
        prompt: this.tokenizer.count(promptUser),
        completion: this.tokenizer.count(answer),
      },
      modelUsed: this.modelId,
    };
  }
}
