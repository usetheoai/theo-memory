/**
 * v0.8 DMR runner — TERTIARY benchmark per ADR D2.
 *
 * Drift-T7.2-1: smoke fixture is hand-authored; real DMR derivation
 * from MSC is in benchmarks/scripts/derive-dmr-subset.ts (placeholder
 * shipping at T7.2; full derivation deferred to follow-up cycle that
 * fetches MSC dataset).
 *
 * @see plan v1.2 § T7.2 + ADR D2
 */
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';

import { loadDmrFixture, type DmrItem } from '../../src/benchmarks/fixtures/index.js';
import { LlmJudgePanel } from '../../src/benchmarks/llm-judge/judge-panel.js';
import { BenchmarkRunner } from '../../src/benchmarks/runner/benchmark-runner.js';
import { CostTracker } from '../../src/benchmarks/runner/cost-tracker.js';
import { TiktokenTokenizer } from '../../src/benchmarks/runner/tiktoken-tokenizer.js';
import { TheMemoryBenchmarkAdapter } from '../../src/benchmarks/themory/adapter.js';
import type { LLM, LLMResponse, Message } from '../../src/core/dip/llm.js';
import { createLocalMemory, InMemoryVectorStore, StubEmbedder } from '../../src/local/index.js';
import type { BenchmarkCorpus, BenchmarkQuery } from '../../src/core/dip/benchmark-adapter.js';
import type { RunReport } from '../../src/benchmarks/runner/benchmark-runner.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export interface RunOpts {
  readonly fixturePath: string;
  readonly resultsPath: string;
  readonly modelId?: string;
  readonly limit?: number;
}

function buildCorpusAndQueries(
  items: readonly DmrItem[],
  limit?: number,
): { readonly corpus: BenchmarkCorpus; readonly queries: readonly BenchmarkQuery[] } {
  const bounded = limit !== undefined ? items.slice(0, limit) : items;
  const corpus: BenchmarkCorpus = {
    conversationId: 'dmr',
    items: bounded.map((q, i) => ({
      id: `dmr-ctx-${String(i)}`,
      text: `${q.questionText} ${q.answer}`,
      timestamp: new Date(),
      metadata: {},
    })),
  };
  const queries: readonly BenchmarkQuery[] = bounded.map((q, i) => ({
    questionId: `${q.conversationId}-q${String(i)}`,
    questionText: q.questionText,
    conversationId: 'dmr',
    goldAnswer: q.answer,
    category: 'misc',
  }));
  return { corpus, queries };
}

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
  const items = await loadDmrFixture(opts.fixturePath);
  const { corpus, queries } = buildCorpusAndQueries(items, opts.limit);

  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(new InMemorySpanExporter())],
  });
  const tracer = provider.getTracer('v0-8-dmr');

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

const isMain = import.meta.url === `file://${process.argv[1] ?? ''}`;
if (isMain) {
  const fixturePath =
    process.env['DMR_FIXTURE_PATH'] ?? join(REPO_ROOT, 'benchmarks', 'data', 'dmr', 'dmr500.json');
  const resultsPath =
    process.env['DMR_RESULTS_PATH'] ?? join(REPO_ROOT, 'benchmarks', 'results', 'dmr', 'themory.json');
  main({ fixturePath, resultsPath })
    .then((report) => {
      console.log(`[run-dmr] aborted: ${String(report.aborted)}`);
      console.log(`[run-dmr] questionCount: ${String(report.aggregate.questionCount)}`);
    })
    .catch((err: unknown) => {
      console.error('[run-dmr] FATAL:', err);
      process.exit(1);
    });
}
