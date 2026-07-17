/**
 * BenchmarkAdapter DIP — 10th interface in the src/core/dip/ family.
 *
 * Owns the contract that every external memory-system adapter
 * (TheMemory + 3 third-party libraries) implements for the v0.8 benchmark
 * runner. Per ADR D5 (Protocol locus) implementations live under
 * src/benchmarks/{adapter}/ and depend on this declaration; src/core/
 * never imports from src/benchmarks/.
 *
 * Per ADR D6 (ISP+SRP) this interface DOES NOT extend MemoryStore. The
 * benchmark protocol accepts arbitrary corpora + queries shaped by
 * fixture metadata (gold answer, category, expected speakers); the
 * MemoryStore contract is the internal three-tier remember/recall
 * surface. Forcing one to inherit the other would couple v0.8 benchmark
 * concerns to v0.0 contract design.
 *
 * Per ADR D1 the runner OWNS the orchestration and adapters honor this
 * Protocol as the only abstraction; no shared base class is introduced
 * (anti-pattern of standalone adapter classes with divergent signatures
 * per ADR D1).
 *
 */

/**
 * A single corpus item to be added to the adapter's memory store.
 *
 * The optional `speaker` field encodes the multi-speaker boundary that
 * LongMemEval and LoCoMo express via speaker_a / speaker_b per turn.
 * Adapters that respect speaker boundaries (TheMemory: scopedUserId per
 * speaker) preserve methodological fidelity; adapters that collapse
 * multi-speaker into a single user would artificially inflate recall@10.
 * Single-speaker fixtures (DMR-derived MSC subset) omit the field.
 *
 * @see plan § EC-5 absorption
 */
export interface BenchmarkCorpusItem {
  readonly id: string;
  readonly text: string;
  readonly timestamp: Date;
  readonly speaker?: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

/**
 * A conversation corpus to seed an adapter before queries.
 *
 * `conversationId` identifies the LongMemEval / LoCoMo / DMR conversation
 * being benchmarked; adapters typically derive their user_id scope from it
 * (TheMemory composes it with the speaker per EC-5).
 */
export interface BenchmarkCorpus {
  readonly conversationId: string;
  readonly items: readonly BenchmarkCorpusItem[];
}

/**
 * A single benchmark query against a previously-added corpus.
 *
 * `expectedSpeakers` is OPTIONAL because not every fixture is
 * multi-speaker. When present, adapters honoring speaker boundaries
 * search across each speaker's scope and merge results; when absent or
 * `['unknown']`, the adapter searches the single conversation scope.
 *
 * @see plan § EC-5 absorption
 */
export interface BenchmarkQuery {
  readonly questionId: string;
  readonly questionText: string;
  readonly conversationId: string;
  readonly goldAnswer: string;
  readonly category: string;
  readonly expectedSpeakers?: readonly string[];
}

/**
 * Metrics returned by `BenchmarkAdapter.add()`.
 *
 * `latencyMs` is end-to-end wall-clock for the add call; the runner
 * aggregates these into OTel histogram spans for P95 reporting per
 * ADR D8.
 */
export interface AddMetrics {
  readonly itemCount: number;
  readonly latencyMs: number;
}

/**
 * Result returned by `BenchmarkAdapter.search()`.
 *
 * `tokensUsed` is required so the runner cost-tracker can compute
 * cost/session per ADR D7 (tiktoken + pricing-table.json). Adapters
 * whose vendor SDK does not report usage MUST estimate via tiktoken
 * over the prompt + completion strings; reporting zeros silently is a
 * methodological defect (see EC-3 PricingTableMiss).
 */
export interface SearchResult {
  readonly answer: string;
  readonly retrievedContext: readonly string[];
  readonly latencyMs: number;
  readonly tokensUsed: {
    readonly prompt: number;
    readonly completion: number;
  };
  /**
   * The model identifier used to synthesize the answer (e.g. 'gpt-4o-mini',
   * 'openai/gpt-4o', 'anthropic/claude-3.5-sonnet'). The benchmark runner
   * looks this up in pricing-table.json for cost computation per ADR D7.
   *
   * Required field (Drift-T5.1-1 absorption): reporting cost via
   * adapter.name silently fabricated $0 for TheMemory while vendors got
   * accurate cost — EC-3 anti-silent-$0 invariant violated. The model
   * identity is the load-bearing dimension for cost; vendor identity is
   * not.
   */
  readonly modelUsed: string;
}

/**
 * The 10th DIP interface in src/core/dip/. Implemented by 4 adapters in
 * Phases 3 + 6 of v0.8 (TheMemory + 3 third-party libraries).
 *
 * `name` identifies the adapter for run-report filenames + per-vendor
 * widening this type.
 */
export interface BenchmarkAdapter {
  readonly name: string;
  add(corpus: BenchmarkCorpus): Promise<AddMetrics>;
  search(query: BenchmarkQuery): Promise<SearchResult>;
}
