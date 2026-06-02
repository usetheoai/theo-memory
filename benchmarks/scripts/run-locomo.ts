/**
 * v0.8 LoCoMo runner — SECONDARY benchmark per ADR D2.
 *
 * Per ADR D4: LoCoMo is CC-BY-NC-SA 4.0; full fixtures download at
 * install time via benchmarks/scripts/download-fixtures.mjs.
 *
 * Drift-T7.1-1: smoke fixture is hand-authored (NOT a subset of LoCoMo
 * data) to avoid NC license question for committed files.
 *
 * @see plan v1.2 § T7.1 + ADRs D2 / D4
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
  loadLoCoMoFixture,
  type LoCoMoConversation,
} from '../../src/benchmarks/fixtures/index.js';
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
  convs: readonly LoCoMoConversation[],
  limit?: number,
): { readonly corpus: BenchmarkCorpus; readonly queries: readonly BenchmarkQuery[] } {
  const bounded = limit !== undefined ? convs.slice(0, limit) : convs;
  const items = bounded.flatMap((c, i) =>
    c.qa.map((q, j) => ({
      id: `loco-${String(i)}-${String(j)}`,
      text: `${q.questionText} ${q.answer}`,
      timestamp: new Date(),
      speaker: c.speakerA,
      metadata: { category: q.category },
    })),
  );
  const corpus: BenchmarkCorpus = {
    conversationId: 'locomo',
    items,
  };
  const queries: readonly BenchmarkQuery[] = bounded.flatMap((c) =>
    c.qa.map((q) => ({
      questionId: q.questionId,
      questionText: q.questionText,
      conversationId: 'locomo',
      goldAnswer: q.answer,
      category: q.category,
      expectedSpeakers: [c.speakerA, c.speakerB],
    })),
  );
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
  const convs = await loadLoCoMoFixture(opts.fixturePath);
  const { corpus, queries } = buildCorpusAndQueries(convs, opts.limit);

  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(new InMemorySpanExporter())],
  });
  const tracer = provider.getTracer('v0-8-locomo');

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
    process.env['LOCOMO_FIXTURE_PATH'] ?? join(REPO_ROOT, 'benchmarks', 'data', 'locomo', 'locomo10.json');
  const resultsPath =
    process.env['LOCOMO_RESULTS_PATH'] ??
    join(REPO_ROOT, 'benchmarks', 'results', 'locomo', 'themory.json');
  main({ fixturePath, resultsPath })
    .then((report) => {
      console.log(`[run-locomo] aborted: ${String(report.aborted)}`);
      console.log(`[run-locomo] questionCount: ${String(report.aggregate.questionCount)}`);
      // v0-8-fixes-cycle-1 T2.1 + ADR D7
      process.exit(report.aborted ? 1 : 0);
    })
    .catch((err: unknown) => {
      console.error('[run-locomo] FATAL:', err);
      process.exit(1);
    });
}
