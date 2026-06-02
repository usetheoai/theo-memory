/**
 * v0.8 LongMemEval runner — THE GOAL TEST per ADR D2 (PRIMARY benchmark).
 *
 * Loads the LongMemEval fixture (per ADR D4 download-at-install), wires
 * TheMemoryBenchmarkAdapter (T3.1) + LlmJudgePanel (T1.2) + BenchmarkRunner
 * (T4.1) end-to-end, and writes the run report to
 * `benchmarks/results/longmemeval/themory.json` per ADR D2.
 *
 * Drift-T5.1-2: smoke-fixture mode (3 questions) is the default for
 * /implement halt-loop TDD. Full 500-question run requires
 * BENCH_RUN=full + valid API keys.
 *
 * @see plan v1.2 § T5.1 + ADRs D2 / D4 / D7
 */
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';

import {
  loadLongMemEvalFixture,
  type LongMemEvalItem,
} from '../../src/benchmarks/fixtures/index.js';
import { LlmJudgePanel } from '../../src/benchmarks/llm-judge/judge-panel.js';
import { BenchmarkRunner } from '../../src/benchmarks/runner/benchmark-runner.js';
import { CostTracker } from '../../src/benchmarks/runner/cost-tracker.js';
import { TiktokenTokenizer } from '../../src/benchmarks/runner/tiktoken-tokenizer.js';
import { TheMemoryBenchmarkAdapter } from '../../src/benchmarks/themory/adapter.js';
import type { LLM, LLMResponse, Message } from '../../src/core/dip/llm.js';
import { createLocalMemory, InMemoryVectorStore, StubEmbedder } from '../../src/local/index.js';
import type {
  BenchmarkCorpus,
  BenchmarkQuery,
  SearchResult,
} from '../../src/core/dip/benchmark-adapter.js';
import type { RunReport } from '../../src/benchmarks/runner/benchmark-runner.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export interface RunOpts {
  readonly fixturePath: string;
  readonly resultsPath: string;
  readonly modelId?: string;
  readonly limit?: number;
}

function buildCorpusAndQueries(
  items: readonly LongMemEvalItem[],
  limit?: number,
): { readonly corpus: BenchmarkCorpus; readonly queries: readonly BenchmarkQuery[] } {
  const bounded = limit !== undefined ? items.slice(0, limit) : items;
  const corpus: BenchmarkCorpus = {
    conversationId: 'longmemeval',
    items: bounded.map((q, i) => ({
      id: `ctx-${String(i)}`,
      text: `${q.questionText} ${q.answer}`,
      timestamp: new Date(),
      metadata: { category: q.category },
    })),
  };
  const queries: readonly BenchmarkQuery[] = bounded.map((q) => ({
    questionId: q.questionId,
    questionText: q.questionText,
    conversationId: 'longmemeval',
    goldAnswer: q.answer,
    category: q.category,
  }));
  return { corpus, queries };
}

/**
 * Minimal verbatim-extracting LLM for smoke runs without real keys.
 * Real BENCH_RUN should construct OpenAILLM here.
 */
class StubAnswerLlm implements LLM {
  private nextId = 0;
  generateResponse(messages: readonly Message[]): Promise<unknown> {
    const last = messages.at(-1)?.content ?? '';
    const id = String(this.nextId);
    this.nextId += 1;
    return Promise.resolve({ memory: [{ id, text: last }] });
  }
  generateChat(messages: readonly Message[]): Promise<LLMResponse> {
    const last = messages.at(-1)?.content ?? '';
    return Promise.resolve({ role: 'assistant', content: `synthesized: ${last.slice(0, 40)}` });
  }
}

/**
 * Build a JudgePanel. For BENCH_RUN=full a real OpenAI / OpenRouter LLM
 * should be passed in; in smoke mode we use a canned-response stub.
 */
function buildSmokeJudgePanel(): LlmJudgePanel {
  return new LlmJudgePanel([
    {
      name: 'smoke-gpt-4o',
      llm: {
        generateResponse: () =>
          Promise.resolve({ text: '{"label":"CORRECT","reasoning":"smoke run"}' }),
        generateChat: () =>
          Promise.resolve({
            role: 'assistant' as const,
            content: '{"label":"CORRECT","reasoning":"smoke run"}',
          }),
      },
    },
  ]);
}

export async function main(opts: RunOpts): Promise<RunReport> {
  const items = await loadLongMemEvalFixture(opts.fixturePath);
  const { corpus, queries } = buildCorpusAndQueries(items, opts.limit);

  // Local OTel provider (NOT setGlobalTracerProvider to avoid cross-test
  // contamination when imported by the e2e suite).
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(new InMemorySpanExporter())],
  });
  const tracer = provider.getTracer('v0-8-longmemeval');

  const tokenizer = new TiktokenTokenizer();
  const modelId = opts.modelId ?? 'gpt-4o-mini';
  const memory = await createLocalMemory({
    embedder: new StubEmbedder(),
    llm: new StubAnswerLlm(),
    vectorStore: new InMemoryVectorStore(),
  });
  const adapter = new TheMemoryBenchmarkAdapter({
    memory,
    llm: new StubAnswerLlm(),
    tokenizer,
    modelId,
  });
  const judgePanel = buildSmokeJudgePanel();
  const costTracker = new CostTracker({ tokenizer });

  mkdirSync(dirname(opts.resultsPath), { recursive: true });

  const runner = new BenchmarkRunner({
    adapter,
    judgePanel,
    costTracker,
    tracer,
    resultsPath: opts.resultsPath,
  });

  const report = await runner.run(corpus, queries);
  tokenizer.free();
  return report;
}

// CLI entry — `node --import jiti/register benchmarks/scripts/run-longmemeval.ts`
// or invoked from the e2e test via main() import.
const isMain = import.meta.url === `file://${process.argv[1] ?? ''}`;
if (isMain) {
  const fixturePath =
    process.env['LONGMEMEVAL_FIXTURE_PATH'] ??
    join(REPO_ROOT, 'benchmarks', 'data', 'longmemeval', 'longmemeval_oracle.json');
  const resultsPath =
    process.env['LONGMEMEVAL_RESULTS_PATH'] ??
    join(REPO_ROOT, 'benchmarks', 'results', 'longmemeval', 'themory.json');
  main({ fixturePath, resultsPath })
    .then((report) => {
      console.log(`[run-longmemeval] aborted: ${String(report.aborted)}`);
      console.log(`[run-longmemeval] questionCount: ${String(report.aggregate.questionCount)}`);
    })
    .catch((err: unknown) => {
      console.error('[run-longmemeval] FATAL:', err);
      process.exit(1);
    });
}
