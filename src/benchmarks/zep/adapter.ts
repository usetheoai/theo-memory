/**
 * ZepBenchmarkAdapter — BenchmarkAdapter DIP impl for the Zep vendor.
 *
 * Drift-T6.x-1: ships with a ZepVendorClient interface that the adapter
 * consumes via DI. Real `@getzep/zep-cloud` SDK wiring is deferred to a
 * follow-up cycle.
 *
 * Drift-T5.1-1 absorbed: returns SearchResult.modelUsed for cost lookup.
 *
 * @see plan v1.2 § T6.2 + ADRs D5 / D6
 */

import type {
  AddMetrics,
  BenchmarkAdapter,
  BenchmarkCorpus,
  BenchmarkQuery,
  SearchResult,
} from '../../core/dip/benchmark-adapter.js';
import type { Tokenizer } from '../../core/dip/tokenizer.js';

export interface ZepVendorClient {
  add(sessionId: string, text: string): Promise<void>;
  search(
    sessionId: string,
    query: string,
    topK: number,
  ): Promise<readonly { text: string; score: number }[]>;
  synthesize(question: string, context: readonly string[]): Promise<string>;
}

export interface ZepBenchmarkAdapterConfig {
  readonly client: ZepVendorClient;
  readonly tokenizer: Tokenizer;
  readonly modelId?: string;
}

const DEFAULT_MODEL_ID = 'gpt-4o-mini';
const TOP_K = 30;

export class ZepBenchmarkAdapter implements BenchmarkAdapter {
  readonly name = 'zep';
  private readonly client: ZepVendorClient;
  private readonly tokenizer: Tokenizer;
  private readonly modelId: string;

  constructor(config: ZepBenchmarkAdapterConfig) {
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
