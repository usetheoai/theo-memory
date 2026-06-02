/**
 * Shared runner scaffold for the 3 v0.8 CLI scripts (run-longmemeval,
 * run-locomo, run-dmr). Extracted in v0-8-fixes-cycle-1 T3.2 to close
 * F-arch-2 MAJOR (~250 LoC duplicated across 3 files; rule-of-three
 * crossed).
 *
 * Per ADR D2 of v0-8-fixes-cycle-1, bundling this refactor with the
 * Tokenizer DIP promotion (T3.1) avoids 2× /implement halt-loop +
 * /review overhead — both refactors are MOVE-only on the same code
 * surface (src/benchmarks/ + benchmarks/scripts/).
 *
 * EC-4 (MUST FIX) absorbed: eslint.config.ts files glob extended to
 * `benchmarks/scripts/**\/*.ts` so this scaffold + the 3 callers are
 * linted (previously escaped the `src/{...,benchmarks}/...` pattern).
 *
 * @see plan v0-8-fixes-cycle-1 § T3.2 + ADR D2 + EC-4
 */
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';

import type { JudgeLabel } from '../../src/benchmarks/llm-judge/json-extractor.js';
import { LlmJudgePanel } from '../../src/benchmarks/llm-judge/judge-panel.js';
import {
  BenchmarkRunner,
  type RunReport,
} from '../../src/benchmarks/runner/benchmark-runner.js';
import { CostTracker } from '../../src/benchmarks/runner/cost-tracker.js';
import { TiktokenTokenizer } from '../../src/benchmarks/runner/tiktoken-tokenizer.js';
import { TheMemoryBenchmarkAdapter } from '../../src/benchmarks/themory/adapter.js';
import type {
  BenchmarkCorpus,
  BenchmarkQuery,
} from '../../src/core/dip/benchmark-adapter.js';
import type { LLM, LLMResponse, Message } from '../../src/core/dip/llm.js';
import { createLocalMemory, InMemoryVectorStore, StubEmbedder } from '../../src/local/index.js';

/**
 * Minimal verbatim-extracting LLM for smoke runs without real keys.
 * Real BENCH_RUN should construct OpenAILLM here.
 */
export class StubAnswerLlm implements LLM {
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
 * Build a smoke-mode JudgePanel. For BENCH_RUN=full a real OpenAI /
 * OpenRouter LLM should be passed in; in smoke mode we use a
 * canned-response stub.
 *
 * v0-8-fixes-cycle-1 T1.2 (closes F-tests-2 MAJOR) + EC-6 (SHOULD TEST):
 * `stubResponses` (optional, defaults to ['CORRECT']) parameterizes the
 * judgement sequence so smoke fixtures can exercise BOTH CORRECT and
 * WRONG paths. When the fixture has more queries than `stubResponses`
 * elements, responses CYCLE MODULO LENGTH (deterministic; documented
 * sequence so e2e tests can assert specific outputs at known indices).
 *
 * Caller passes e.g. ['CORRECT', 'WRONG']; for a 3-question smoke run
 * the sequence is [CORRECT, WRONG, CORRECT] (i % 2).
 */
export function buildSmokeJudgePanel(
  stubResponses: readonly JudgeLabel[] = ['CORRECT'],
): LlmJudgePanel {
  let cursor = 0;
  function nextLabelJson(): string {
    const label = stubResponses[cursor % stubResponses.length] ?? 'CORRECT';
    cursor += 1;
    return `{"label":"${label}","reasoning":"smoke run"}`;
  }
  return new LlmJudgePanel([
    {
      name: 'smoke-gpt-4o',
      llm: {
        generateResponse: () => Promise.resolve({ text: nextLabelJson() }),
        generateChat: () =>
          Promise.resolve({
            role: 'assistant' as const,
            content: nextLabelJson(),
          }),
      },
    },
  ]);
}

/**
 * Build a local OTel tracer (NOT setGlobalTracerProvider to avoid
 * cross-test contamination when the script is imported by the e2e suite).
 */
export function buildLocalTracer(scope: string) {
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(new InMemorySpanExporter())],
  });
  return provider.getTracer(scope);
}

export interface RunBenchmarkScaffoldOpts {
  readonly tracerScope: string;
  readonly corpus: BenchmarkCorpus;
  readonly queries: readonly BenchmarkQuery[];
  readonly resultsPath: string;
  readonly modelId?: string;
  /**
   * Smoke judge-panel canned responses. Defaults to ['CORRECT', 'WRONG']
   * so e2e smoke tests exercise BOTH judgement paths (T1.2 + F-tests-2
   * MAJOR fix). Pass ['CORRECT'] for all-CORRECT smoke runs.
   */
  readonly stubResponses?: readonly JudgeLabel[];
}

/**
 * Run the benchmark scaffold end-to-end: build adapter + judge panel +
 * cost tracker, execute the runner, free the tokenizer, return the
 * RunReport. Caller is responsible for fixture-loading + corpus/query
 * construction (those vary by benchmark).
 */
export async function runBenchmark(opts: RunBenchmarkScaffoldOpts): Promise<RunReport> {
  const tracer = buildLocalTracer(opts.tracerScope);
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
  // v0-8-fixes-cycle-1 T1.2: default smoke responses exercise BOTH paths
  // so smoke e2e tests catch a regression that breaks WRONG handling.
  const judgePanel = buildSmokeJudgePanel(opts.stubResponses ?? ['CORRECT', 'WRONG']);
  const costTracker = new CostTracker({ tokenizer });

  const runner = new BenchmarkRunner({
    adapter,
    judgePanel,
    costTracker,
    tracer,
    resultsPath: opts.resultsPath,
  });

  const report = await runner.run(opts.corpus, opts.queries);
  tokenizer.free();
  return report;
}
