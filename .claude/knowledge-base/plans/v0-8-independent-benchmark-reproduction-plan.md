# Plan: v0.8 — Independent Benchmark Reproduction

> **Version 1.1** (2026-06-02) — Absorbs the `/edge-case-plan` report at `.claude/knowledge-base/reviews/v0-8-independent-benchmark-reproduction-edge-cases-2026-06-02.md` (verdict NEEDS_ADJUSTMENT — 14 edge cases: 6 MUST FIX + 6 SHOULD TEST + 2 DOCUMENT). **SIX MUST FIX ABSORBED:** (a) **EC-1** T1.2 adds `src/benchmarks/llm-judge/json-extractor.ts` for robust JSON parse + SingleJudge returns `JudgeLabel | null`; (b) **EC-2** T4.1 declares all-judges-fail policy (3 consecutive null → 60s pause + 1 retry → partial-results persisted + non-zero exit code); (c) **EC-3** T4.1 adds `PricingTableMiss` typed error + runner persists `cost = NaN, pricing_table_miss: true` flag; (d) **EC-4** T5.1 Files to edit adds `vitest.benchmark.config.ts` (NEW) with 60-min testTimeout + `npm run test:benchmark` script; (e) **EC-5** T0.1 BenchmarkCorpusItem.metadata gains `speaker?: string` field + T3.1 adapter scoped userId becomes `${conversationId}::${speakerId || 'unknown'}`; (f) **EC-6** T2.1 replaces bash `download-fixtures.sh` with TypeScript `benchmarks/scripts/download-fixtures.ts` using Node 20+ native fetch (macOS-portable). **SIX SHOULD TEST CHECKPOINTS** added to respective task TDD blocks (EC-7 BLEU empty-string handling, EC-8 idempotent downloader, EC-9 runner partial-results persistence, EC-10 inter-judge agreement N=1, EC-11 zero-token cost-tracker, EC-12 robust markdown-table parser). **TWO DOCUMENT NOTES** inlined into T4.1 (EC-13 pricing-table staleness) and T6.x (EC-14 skip-clean already-established).
>
> **Version 1.0** (2026-06-02) — Initial plan. Ships an independent reproduction of LongMemEval + LoCoMo + DMR memory benchmarks against TheMemory v0.7 + Mem0 v3 + Zep + Letta on identical fixtures, publishing the matrix at `docs/benchmarks/v0.8.md`. Closes roadmap row 10 (v0.8) which row 11 (v1.0) explicitly depends on. **Heavily informed by the v0.8 discovery cycle**: blueprint `.claude/knowledge-base/discoveries/blueprints/v0-8-benchmark-methodology-blueprint.md` (SHIPPABLE_WITH_CAVEATS 89/100) provides 4 ADRs (D1-D4) + 10 R-recommendations + 6 URL snapshots + 13 verified local citations. Strategic anchors: **Mem0 ships LOCOMO-only** (we write LongMemEval + DMR adapters ourselves), **LongMemEval has ZERO third-party reproductions** (v0.8 is novel), **No Rule 9 candidate covers all 3** (we own the runner, reuse metric primitives).

## Goal

> Enable v1.0 to make a defensible "production-ready" claim by reproducing LongMemEval + LoCoMo + DMR against 4 memory systems (TheMemory v0.7 / Mem0 v3 / Zep / Letta) on identical fixtures, measured by `docs/benchmarks/v0.8.md` existing with all 12 (4 adapter × 3 benchmark) matrix cells populated AND `tests/e2e/benchmarks/matrix-publication.test.ts` PASSING against the live published artifact.

## Context

**Why now:** roadmap row 11 (v1.0 — Contract stable) gates `production-ready` claims on Item 10 reproduced independently with verifiable artifacts. Row 10 is currently `Planned`. /auto-plan v0-8-independent-benchmark-reproduction Step 1 (`scripts/assess_confidence.py`) initially returned LOW (20/100); we ran the full cycle-discover chain (`/discover-plan` → `/discover-edge-cases` → `/discover-execute` → `/discover-confidence`) to map prior_art before planning. Cycle-discover deliverable is the blueprint cited above.

**Affected directories under `src/`** (per `/architecture-docs` skill absent in TheMemory — documenting inline per to-plan/SKILL.md § Step 2):

| Directory | Today | This plan changes |
|---|---|---|
| `src/core/` | DIP interfaces (Memory, MemoryStore, 5 DIPs from v0.0, ConflictResolutionPolicy from v0.7) | Adds `BenchmarkAdapter` Protocol + result types (Phase 0) |
| `src/local/` | Pg adapter implementations | Untouched — TheMemory's role here is being a benchmarked subject, not implementing benchmarks |
| `src/cloud/` | TheoCloud client | Untouched |
| `src/theokit/` | Request-context binding | Untouched |
| `src/agent-tools/` | MCP server + 4 verbs | Untouched |
| `src/benchmarks/` | **NOT YET EXISTS** | NEW — adapter implementations + runner orchestrator (Phases 3-4-6) |
| `benchmarks/` (repo-root) | **NOT YET EXISTS** | NEW — fixture downloader scripts (`download-fixtures.sh`) + reproduction notebooks (Phase 2) |
| `docs/benchmarks/` | **NOT YET EXISTS** | NEW — `v0.8.md` published artifact (Phase 8) |
| `tests/e2e/benchmarks/` | **NOT YET EXISTS** | NEW — full-matrix smoke test (Phase 8, gated on `BENCH_RUN=true`) |

**Cross-cycle constraints:**
- `/dogfood` golden rule (`.claude/rules/dogfood-golden-rule.md`) blocks `production-ready` claims independently — v0.8 satisfies row 11 (a); row 11 (b) is the anchor scenario clock (currently EVIDENCE_INSUFFICIENT, audit `6f7ff87` 2026-05-31)
- `architecture.md § 3` DIP boundaries: `BenchmarkAdapter` interface lives in `src/core/`, implementations under `src/benchmarks/` consuming it; no upward import from `core/` into `benchmarks/`
- `testing.md § Pyramid` — unit on metric computation; integration on per-adapter loops against `tests/fixtures/benchmarks/`; e2e on full matrix (gated on env vars + paid API keys)
- `no-paper-names-in-code.md` — code/test/error-message identifiers describe BEHAVIOR not paper names; "Mem0" / "Zep" / "Letta" appear only in vendor-name positions (adapter file names + config keys), not in comment prose

## Objective

- [ ] Sub-goal 1: `BenchmarkAdapter` Protocol declared in `src/core/dip/benchmark-adapter.ts` with `add(corpus)` + `search(query)` method shape (Phase 0)
- [ ] Sub-goal 2: Metric primitives module ships BLEU + F1 + LLM-judge with configurable multi-judge panel (Phase 1)
- [ ] Sub-goal 3: Fixture downloader script ships AND LongMemEval downloads successfully from HF (Phase 2)
- [ ] Sub-goal 4: 4 adapter implementations ship (TheMemory v0.7 / Mem0 v3 / Zep / Letta) — TheMemory drives the Protocol shape (Phase 3 + Phase 6)
- [ ] Sub-goal 5: Runner orchestrator ships with P95 latency + cost/session instrumentation via OTel spans (Phase 4)
- [ ] Sub-goal 6: LongMemEval (PRIMARY) full matrix run produces 4 result JSON files; LoCoMo + DMR follow (Phase 5 + Phase 7)
- [ ] Sub-goal 7: `docs/benchmarks/v0.8.md` published with all 12 cells (4 × 3) populated + methodology section + reproducibility runbook (Phase 8)

## ADRs

### D1 — v0.8 OWNS the benchmark runner; ADOPTS only metric primitives (inherited from blueprint D1)

**Decision:** TheMemory v0.8 implements its own TypeScript benchmark runner with proper `BenchmarkAdapter` Protocol per `architecture.md § 3` DIP. For metric primitives (BLEU / F1), adopt battle-tested libraries; do NOT adopt any of the 3 evaluated Rule 9 candidates (RAGAS, DeepEval, LangSmith) as the runner.

**Rationale:** Blueprint Q8 verdicts: RAGAS=REJECT (RAG-focused, agent_evals roadmap-only), DeepEval=REJECT (no LongMemEval/LoCoMo/DMR), LangSmith=REJECT (vendor lock-in defeats "independent reproduction" framing of roadmap row 10). Mem0's runner is useful skeleton but has no abstraction (Q1 finding — `class Experiment` is unused stub; imperative if/elif chain). Writing our own runner with DIP keeps us independent + matches `architecture.md § 3` boundaries. Mirrors v0.7's "own the pipeline, reuse the primitives" pattern (ADR D2 of v0.7 ConflictResolutionPolicy DIP).

**Alternatives considered:**
- Fork Mem0's runner — REJECTED: inherits no-shared-interface anti-pattern; Python-only
- Adopt RAGAS as full runner — REJECTED: blueprint Q8 verdict
- Reinvent metric computation — REJECTED: Inquebrável Rule 9 violation; BLEU/F1 are battle-tested

**Consequences:** v0.8 owns 5-7 modules (Protocol + 4 adapters + runner + 1 LLM-judge orchestrator). Estimated cost 200-400k tokens per `token-budget.md` v0.8 row estimate. Reuse minimizes metric-implementation surface; runner ownership preserves independence axis.

### D2 — Benchmark priority ranking: LongMemEval PRIMARY > LoCoMo SECONDARY > DMR TERTIARY (inherited from blueprint D2)

**Decision:** Implement LongMemEval FIRST (Phase 5); LoCoMo + DMR Phase 7 in priority order.

**Rationale:** Blueprint Q6 finding — LongMemEval ICLR 2025, MIT both code+data, public HF (3.03 GB tractable), ZERO third-party reproductions → v0.8 publication is novel. Blueprint Q7 — LoCoMo CC-BY-NC-SA 4.0 NonCommercial license + Mem0 already publishes LoCoMo numbers (Mem0 paper arXiv:2504.19413) so it's the apples-to-apples Mem0 comparison ground. DMR shows ceiling effects (Zep 94.8% vs MemGPT 93.4% per Zep paper arXiv:2501.13956) — TERTIARY because score differences fall in LLM-judge noise.

**Alternatives considered:**
- DMR first (cheap implementation) — REJECTED: ceiling effects mean we'd publish indistinguishable scores
- LoCoMo first (Mem0 comparison primary) — REJECTED: NC license adds compliance complexity; LongMemEval simpler

**Consequences:** v0.8 milestone may ship with LongMemEval-only if budget tight (Phase 5 alone satisfies "novel reproduction" claim). LoCoMo + DMR (Phase 7) are incremental adds. Acceptance criteria require ALL 3 — accept honest residual scope.

### D3 — LLM-judge is configurable; default panel of 2-3 judges with inter-judge agreement (inherited from blueprint D3)

**Decision:** TheMemory's LLM-judge orchestrator exposes model / prompt / temperature / seed as config. Default panel: `gpt-4o` + `claude-sonnet` (+ optional open-source third). Per (question, gold, generated) triple, run ALL configured judges; report inter-judge agreement (Cohen's kappa OR simple % agreement). Persist raw judge responses alongside binary labels.

**Rationale:** Blueprint Q2 finding — Mem0's hardcoded `gpt-4o-mini` + temperature 0 + "be generous" instructional bias is opinionated single-judge. Production-grade reproduction requires variance reporting (Self-Consistency literature: Wang et al. 2023; LLM-as-judge benchmarks: Zheng et al. 2023). v0.7.1 LLM-measured eval (precision=recall=1.000 on 10 fixtures) already established this discipline at TheMemory; D3 extends it to v0.8.

**Alternatives considered:**
- Copy Mem0's hardcoded judge — REJECTED: reproducibility hostage to OpenAI model versioning; bias unreported
- Skip LLM-judge, BLEU/F1 only — REJECTED: BLEU/F1 weak for long-form answers per LongMemEval/LoCoMo design intent

**Consequences:** v0.8 implementation gains 1 module (judge orchestrator). Cost per benchmark run 2-3× Mem0's. LongMemEval @ 500 questions × 3 judges = ~$0.50-2.50 per full run (v0.7.1 ran ~$0.01-0.05 per 10-question hand-set; extrapolation). Acceptable for an explicitly-budget-tracked CI run.

### D4 — Download-at-install pattern for ALL 3 datasets; NO fixture committed to TheMemory repo (inherited from blueprint D4)

**Decision:** `benchmarks/download-fixtures.sh` downloads LongMemEval from HF (via `wget` per blueprint Q6 snapshot), LoCoMo from snap-research GitHub (or Mem0's Google Drive mirror as fallback), DMR-derived 500-conv subset from MemGPT GitHub. Documented in `docs/benchmarks/v0.8.md § Reproducibility`.

**Rationale:** Blueprint Q7 — LoCoMo CC-BY-NC-SA 4.0 forbids bundling in commercial distribution. LongMemEval HF dataset 3.03 GB → too big for shallow-clone CI. DMR derived from MSC → consumers must re-derive subset themselves.

**Alternatives considered:**
- Commit LongMemEval (MIT permits it) — REJECTED: 3.03 GB inflates clone time + breaks shallow-clone CI
- Commit a tiny "smoke" subset for CI — ACCEPTED IMPLICITLY: see Phase 5 sub-task — separate from production runs

**Consequences:** v0.8 ships `benchmarks/download-fixtures.sh`. CI/dogfood evidence requires running it. `docs/benchmarks/v0.8.md` documents per-dataset license + manual steps.

### D5 — Adapter implementations live under `src/benchmarks/` (NOT `src/core/`); `BenchmarkAdapter` Protocol lives in `src/core/dip/`

**Decision:** Per `architecture.md § 3` DIP: `BenchmarkAdapter` interface declared in `src/core/dip/benchmark-adapter.ts` (alongside other DIP interfaces from v0.0 + v0.7). Concrete implementations live under `src/benchmarks/{themory,mem0,zep,letta}/{add,search}.ts`. `src/core/` MUST NOT import from `src/benchmarks/`.

**Rationale:** Mirrors v0.0's 5-DIP shape — `ConflictResolutionPolicy` (9th DIP from v0.7) declared in `src/core/dip/` with `Noop`/`LWW`/`LlmJudgedMerge` implementations under `src/local/conflict/`. The same DIP shape applies here: Protocol in core, concrete adapters in src/benchmarks/ (siblings of `src/local/` and `src/cloud/`).

**Alternatives considered:**
- Adapter Protocol + implementations in `src/local/benchmarks/` — REJECTED: benchmark target adapters call OTHER memory systems (Mem0 / Zep / Letta), not just our local; `src/local/` is Pg-specific
- Implementations at repo root `benchmarks/` — REJECTED: not part of npm package surface; harder for `vitest.contract.config.ts` to discover

**Consequences:** New `src/benchmarks/` top-level dir alongside `src/{core,local,cloud,theokit,agent-tools,embedders,llms}/`. Requires `vitest.contract.config.ts` `include` glob update to add `src/benchmarks/**/__tests__/**/*.test.ts` (Phase 0 sub-task). Requires `package.json#exports` consideration — likely NOT exporting `src/benchmarks/` publicly (internal tooling only).

### D6 — Adapter Protocol DOES NOT inherit from existing MemoryStore DIP — separate abstraction

**Decision:** `BenchmarkAdapter` is a NEW Protocol in `src/core/dip/`, distinct from `MemoryStore`. Methods: `add(corpus: BenchmarkCorpus): Promise<AddMetrics>` + `search(query: BenchmarkQuery): Promise<SearchResult>`. NOT extends `MemoryStore`.

**Rationale:** `MemoryStore` is TheMemory's internal API surface (`remember`/`recall`/`forget`/`reflect` semantics + 3-tier scope). `BenchmarkAdapter` is an EXTERNAL benchmark-protocol surface — it accepts arbitrary corpora + queries with fixture-shaped metadata (gold answer, category, etc.). Forcing one to inherit the other would couple v0.8's benchmark concerns to v0.0's contract design — bad SOLID.

**Alternatives considered:**
- Make `MemoryStore` extend `BenchmarkAdapter` — REJECTED: pollutes core API
- Make `BenchmarkAdapter` extend `MemoryStore` — REJECTED: most non-TheMemory adapters (Mem0 / Zep / Letta) don't conform to our MemoryStore semantics
- Single combined interface — REJECTED: violates ISP (clients of `MemoryStore` don't need benchmark methods)

**Consequences:** `TheMemoryBenchmarkAdapter` (Phase 3) is a thin shim that delegates to an injected `MemoryStore`. Other adapters (Mem0 / Zep / Letta — Phase 6) wrap their respective SDKs directly.

### D7 — Cost tracking uses tiktoken-equivalent JS lib + per-vendor pricing table; matrix reports $/session not $/run

**Decision:** Adopt `@dqbd/tiktoken` (JS port of OpenAI's tiktoken) for token counting; ship a `pricing-table.json` with per-vendor + per-model token rates (gpt-4o-mini, gpt-4o, claude-sonnet, etc.). Report `cost/session` (per-question median) NOT `cost/run` (absolute total) to allow apples-to-apples between adapter implementations that differ in batch size.

**Rationale:** Blueprint Q2 disconnect finding — Mem0 doesn't measure cost at all. Roadmap row 10 acceptance criteria require "cost/session" column. tiktoken is the canonical token-counting library; `@dqbd/tiktoken` is a npm-published JS port maintained by `dqbd`. Pricing table allows future model updates without runner changes.

**Alternatives considered:**
- Report cost/run absolute — REJECTED: adapter batch sizes differ → not comparable
- Use vendor-reported usage objects only — REJECTED: not all SDKs return usage uniformly; tiktoken count is provider-agnostic
- Roll our own tokenizer — REJECTED: Inquebrável Rule 9

**Consequences:** New runtime dep `@dqbd/tiktoken` (Phase 1) + `pricing-table.json` (Phase 4) maintained in `src/benchmarks/`. Pricing table needs sunset-style review (update on vendor pricing change) — documented in `docs/benchmarks/v0.8.md § Maintenance`.

### D8 — P95 latency via OTel histogram spans wrapped around each adapter `add` + `search` call

**Decision:** Instrument every adapter `add()` and `search()` call with OTel spans tagged `benchmark.adapter` + `benchmark.method` + `benchmark.question_id`. Use `@opentelemetry/sdk-trace-base` BatchSpanProcessor + in-memory exporter for tests; export to console for CI runs. Compute P95 from span duration histogram post-run via `generate_scores.ts`.

**Rationale:** TheMemory v0.4a already installed `@opentelemetry/api` + `@opentelemetry/sdk-trace-base` as devDependencies (see `package.json:96-97`). v0.4a OTel pattern (per `cycle-implement.md` retrospective entries) is the established discipline. Mem0's pipeline does NOT measure latency (Q2 finding); we add it natively.

**Alternatives considered:**
- `performance.now()` raw — REJECTED: doesn't propagate context across async (Promise.all etc.); OTel spans handle this
- vendor-reported latency only — REJECTED: vendor SDKs may not report wall-clock; we want end-to-end

**Consequences:** Runner shape: every adapter call is wrapped in `tracer.startActiveSpan()`. Test infrastructure: in-memory exporter aggregates spans; post-run, exporter dumps to per-question record; `generate_scores.ts` reads + computes P95.

### D9 — Skip BERTScore + SBERT-cosine in default scorecard; opt-in `--include-semantic` flag

**Decision:** Default Phase 5/6/7 runs persist only `bleu1` + `f1` + `llm_judge_label` per question (matching Mem0's persistence shape for compatibility). BERTScore + METEOR + SBERT-cosine are computed only when `--include-semantic` flag passed to runner.

**Rationale:** Blueprint Q2 disconnect finding — Mem0 computes 8 metric fns but persists only 3; BERTScore + SBERT require GPU help + extra dependencies. Pragmatic match-Mem0 default keeps cost predictable; semantic-aware opt-in available.

**Alternatives considered:**
- Persist ALL 8 metrics — REJECTED: doubles runtime + adds GPU-cost surface to default CI
- Persist 0 metrics, only LLM-judge — REJECTED: BLEU+F1 are cheap + deterministic; useful for cross-check

**Consequences:** Default `docs/benchmarks/v0.8.md` matrix shows BLEU + F1 + LLM-judge per cell + P95 latency + cost/session. Opt-in semantic metrics ship in separate `docs/benchmarks/v0.8-extended.md` (out of scope for v0.8 minimum).

## Dependency Graph

```
Phase 0 (Protocol + types) ──▶ Phase 1 (metrics + LLM-judge) ──▶ Phase 4 (runner)
   │                              │                                 │
   │                              ▼                                 │
   │                           Phase 2 (fixture downloader)         │
   │                              │                                 │
   │                              ▼                                 │
   └─────▶ Phase 3 (TheMemory adapter) ────────────────────────────▶▼
                                                                Phase 5 (LongMemEval THE GOAL TEST)
                                                                    │
                                                                    ▼
                                            Phase 6 (Mem0+Zep+Letta adapters, can parallelize 3-way)
                                                                    │
                                                                    ▼
                                                                Phase 7 (LoCoMo + DMR runs)
                                                                    │
                                                                    ▼
                                                                Phase 8 (docs/benchmarks/v0.8.md)
                                                                    │
                                                                    ▼
                                                  Final: Integration Validation
```

**Critical path:** Phase 0 → 1 → 4 → 5 (THE GOAL TEST). Phase 2 + 3 parallelize after Phase 0. Phase 6 (3 adapters) can parallelize internally + after Phase 5. Phase 7 (LoCoMo + DMR) parallelizable post-Phase 6.

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `@opentelemetry/api` | `^1.9.0` | npm (devDep at root, USED in Phase 4) | OTel span instrumentation per ADR D8; established pattern from v0.4a |
| `@opentelemetry/sdk-trace-base` | `^2.0.0` | npm (devDep) | In-memory + console exporters for P95 |
| `zod` | `^3.25.0` | npm | Result-shape validation in adapter responses |
| `openai` | `^4.77.0` | npm (optional) | LLM-judge calls (gpt-4o panel member) |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale (libs evaluated) | Why this one |
|---|---|---|---|---|
| `@dqbd/tiktoken` (NEW) | `^1.0.0` | npm | Evaluated: `gpt-tokenizer` (smaller bundle but missing claude-3 encodings); `js-tiktoken` (JS port, older, less-maintained). | OpenAI-compatible BPE tokenizer; ships claude-3 + gpt-4o + gpt-4o-mini encodings; widely used; maintained by `dqbd`. |
| `@anthropic-ai/sdk` (NEW) | `^0.30.0` | npm (optional) | Evaluated: `claude-3-sdk` (alternate name, not official); rolling our own HTTP wrapper (rejected per Rule 9). | Official Anthropic SDK for claude-sonnet judge panel member per ADR D3. |
| `csv-parse` (NEW) | `^5.5.0` | npm | Evaluated: `papaparse` (browser-focused), Node `fs.readFileSync + .split('\n')` rolling our own. | Stream-based CSV parsing for DMR fixture (MSC subset CSV). Apache-2.0 license, maintained. |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

## Phase 0: BenchmarkAdapter Protocol + result types

**Objective:** establish DIP boundary per ADR D5 + D6 — declare `BenchmarkAdapter` interface in `src/core/dip/` and the shared result/corpus/query types.

### T0.1 — Declare `BenchmarkAdapter` Protocol in `src/core/dip/benchmark-adapter.ts`

#### Objective
Ship the central DIP interface that every adapter (Phase 3 + Phase 6) implements. Defines minimal contract for `add()` + `search()` per ADR D6.

#### Evidence
Blueprint Q1 finding: Mem0's `class Experiment` is unused stub; no shared interface across adapters; orchestration is imperative if/elif. ADR D6 in this plan + D5 declare the Protocol-first approach. v0.7 ConflictResolutionPolicy is the precedent (`src/core/dip/conflict-resolution-policy.ts`).

#### Files to edit
```
src/core/dip/benchmark-adapter.ts (NEW) — declares BenchmarkAdapter interface + BenchmarkCorpus + BenchmarkQuery + AddMetrics + SearchResult types
src/core/dip/index.ts — re-export BenchmarkAdapter (consistent with v0.7 ConflictResolutionPolicy export pattern)
src/core/__tests__/benchmark-adapter.test-d.ts (NEW) — type-only test verifying Protocol shape compiles
```

#### Deep file dependency analysis
- `src/core/dip/benchmark-adapter.ts` NEW — sibling of `conflict-resolution-policy.ts` (v0.7), `llm.ts` (v0.0), `embedder.ts` (v0.0). Imports zero local code (pure types).
- `src/core/dip/index.ts` exists — append one line per v0.7 pattern. Downstream files importing `from '@usetheo/memory/contract'` get the new symbol transitively.
- `src/core/__tests__/benchmark-adapter.test-d.ts` NEW — `expectTypeOf` from vitest; runs via `vitest.contract.config.ts` typecheck include.

#### Deep Dives

**Type design:**

```ts
// src/core/dip/benchmark-adapter.ts
// EC-5 absorbed: explicit `speaker` field at top level (alongside metadata bag)
// surfaces the multi-speaker boundary that LongMemEval + LoCoMo encode in
// their fixture schemas (speaker_a/speaker_b per turn). Without this, the
// TheMemory adapter (T3.1) would collapse multi-speaker conversations under
// a single user_id and methodologically inflate recall@10.
export interface BenchmarkCorpusItem {
  readonly id: string;
  readonly text: string;
  readonly timestamp: Date;
  readonly speaker?: string;  // EC-5: "speaker_a" | "speaker_b" | undefined for single-speaker fixtures
  readonly metadata: Readonly<Record<string, unknown>>;
}
export interface BenchmarkCorpus {
  readonly conversationId: string;
  readonly items: readonly BenchmarkCorpusItem[];
}
export interface BenchmarkQuery {
  readonly questionId: string;
  readonly questionText: string;
  readonly conversationId: string;
  readonly goldAnswer: string;
  readonly category: string;
  // EC-5 absorbed: speakers whose memories this query expects to retrieve;
  // for LongMemEval/LoCoMo this is typically both speakers in the conversation;
  // for single-speaker fixtures (DMR-derived MSC), undefined or ['unknown'].
  readonly expectedSpeakers?: readonly string[];
}
export interface AddMetrics {
  readonly itemCount: number;
  readonly latencyMs: number;
}
export interface SearchResult {
  readonly answer: string;
  readonly retrievedContext: readonly string[];
  readonly latencyMs: number;
  readonly tokensUsed: { readonly prompt: number; readonly completion: number };
}
export interface BenchmarkAdapter {
  readonly name: string; // 'themory' | 'mem0' | 'zep' | 'letta'
  add(corpus: BenchmarkCorpus): Promise<AddMetrics>;
  search(query: BenchmarkQuery): Promise<SearchResult>;
}
```

**Invariants:**
- `BenchmarkCorpusItem.metadata` is `Readonly<...>` per `architecture.md § 7` (no `any`); fields preserved across serialization
- `SearchResult.tokensUsed` MUST be reported by adapter (for cost computation per ADR D7)
- `AddMetrics.latencyMs` is end-to-end (start of method call to resolution); OTel span aggregates this in runner

#### Tasks
1. Write `src/core/dip/benchmark-adapter.ts` with all 6 interfaces
2. Append re-export in `src/core/dip/index.ts`
3. Add `expectTypeOf` test in `src/core/__tests__/benchmark-adapter.test-d.ts`
4. Update `vitest.contract.config.ts` include to add `src/benchmarks/**/__tests__/**/*.test.ts` (anticipating Phase 3+)

#### TDD
```
RED:     test-d compiles → BenchmarkAdapter is callable as `new (...) => BenchmarkAdapter` (PASSES already as types only)
RED:     test-d asserts every method returns Promise of correct type (this MUST type-error before T0.1 lands)
GREEN:   T0.1 implementation makes type checks pass
REFACTOR: None expected
VERIFY:  npm run typecheck && npm test -- src/core/__tests__/benchmark-adapter
```

#### Acceptance Criteria
- [ ] `src/core/dip/benchmark-adapter.ts` exists with 6 declared interfaces
- [ ] `src/core/dip/index.ts` re-exports BenchmarkAdapter
- [ ] `src/core/__tests__/benchmark-adapter.test-d.ts` PASSES typecheck
- [ ] `vitest.contract.config.ts` include includes `src/benchmarks/**/__tests__/**/*.test.ts`
- [ ] Pass: complexity — types-only file, cyclomatic 0
- [ ] Pass: lint — `npm run lint` zero warnings
- [ ] Pass: size — `src/core/dip/benchmark-adapter.ts` ≤ 100 LoC (types module)

#### DoD
- [ ] `npm run typecheck` green
- [ ] `npm test` green
- [ ] DIP boundary respected: no import from `src/local/`, `src/cloud/`, `src/benchmarks/` into `src/core/dip/benchmark-adapter.ts`

---

## Phase 1: Metric primitives + LLM-judge orchestrator

**Objective:** ship the metric computation layer (BLEU + F1 + LLM-judge) per ADR D1 + D3.

### T1.1 — Metric primitives module at `src/benchmarks/metrics/`

#### Objective
Implement `calculateBleuScore(pred, ref)` + `calculateF1Score(pred, ref)` + `calculateExactMatch(pred, ref)`. Mirrors Mem0's `metrics/utils.py` deterministic functions in TypeScript.

#### Evidence
Blueprint Q2 finding: Mem0 ships 8 metric fns but persists only 3; BLEU + F1 are persisted. ADR D9 in this plan: default scorecard = BLEU + F1 + LLM-judge per cell.

#### Files to edit
```
src/benchmarks/metrics/bleu.ts (NEW) — BLEU-1 calculation via natural lib's BleuScore OR rolling minimal NLTK-compat
src/benchmarks/metrics/f1.ts (NEW) — token-set F1 (case-insensitive, whitespace-normalized)
src/benchmarks/metrics/exact-match.ts (NEW) — case-insensitive equality
src/benchmarks/metrics/index.ts (NEW) — barrel
src/benchmarks/metrics/__tests__/bleu.test.ts (NEW) — RED tests with known fixtures
src/benchmarks/metrics/__tests__/f1.test.ts (NEW)
src/benchmarks/metrics/__tests__/exact-match.test.ts (NEW)
```

#### Deep file dependency analysis
- `src/benchmarks/metrics/*` NEW — first content under `src/benchmarks/`. No upstream consumers yet; runner (Phase 4) will import.
- `natural` already in `optionalDependencies` (`package.json:111`) — its BleuScore function is candidate per Rule 9.

#### Deep Dives

**BLEU implementation alternatives:**

Option A: Use `natural` lib (already optionalDep). `natural.BleuScore` provides BLEU-1..BLEU-4. Pros: zero new dep; consistent with v0.4b forgetting cycle pattern (BM25 lib via `natural`).

Option B: Roll minimal BLEU-1 (~30 LoC). Pros: no optional-dep dependency; deterministic. Cons: NLTK-compat smoothing differences.

**Choice: Option A** — adopt `natural.BleuScore` per Rule 9.

**F1 token-set implementation** (mirrors Mem0's `simple_tokenize` + set-intersection at `metrics/utils.py:42-152`):
```ts
export function calculateF1Score(prediction: string, reference: string): number {
  const tokenize = (s: string): Set<string> => new Set(s.toLowerCase().replace(/[.,!?]/g, ' ').split(/\s+/).filter(Boolean));
  const pred = tokenize(prediction);
  const ref = tokenize(reference);
  if (pred.size === 0 || ref.size === 0) return 0.0;
  let common = 0;
  for (const t of pred) if (ref.has(t)) common++;
  const precision = common / pred.size;
  const recall = common / ref.size;
  return precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0.0;
}
```

#### Tasks
1. RED: `src/benchmarks/metrics/__tests__/{bleu,f1,exact-match}.test.ts` — known-fixture assertions (e.g., `expect(calculateF1Score('hello world', 'hello world')).toBeCloseTo(1.0)`)
2. GREEN: Implement the 3 functions
3. Add barrel `src/benchmarks/metrics/index.ts` re-exporting

#### TDD
```
RED:     test('calculateF1Score identical strings returns 1.0')
RED:     test('calculateF1Score empty prediction returns 0.0')
RED:     test('calculateF1Score case-insensitive')
RED:     test('calculateBleuScore identical strings returns 1.0')
RED:     test('calculateBleuScore unrelated returns near 0')
RED:     test('calculateBleuScore handles empty prediction without throwing')  # EC-7
RED:     test('calculateBleuScore handles empty reference without throwing')   # EC-7
RED:     test('calculateBleuScore handles whitespace-only inputs')             # EC-7
RED:     test('calculateExactMatch normalizes case + whitespace')
GREEN:   Implement
REFACTOR: extract `simpleTokenize` helper if F1 + BLEU share it
VERIFY:  npm test -- src/benchmarks/metrics
```

#### Acceptance Criteria
- [ ] 3 metric functions ship under `src/benchmarks/metrics/`
- [ ] 6+ RED→GREEN tests in `__tests__/`
- [ ] Pass: complexity — every function cyclomatic ≤ 5
- [ ] Pass: coverage — 100% on `src/benchmarks/metrics/*.ts` (critical paths)
- [ ] Pass: lint — zero warnings
- [ ] Pass: size — each file ≤ 100 LoC

#### DoD
- [ ] `npm test -- src/benchmarks/metrics` green
- [ ] DIP boundary: no import from `src/core/dip/` (metrics are leaf primitives)

### T1.2 — LLM-judge orchestrator at `src/benchmarks/llm-judge/`

#### Objective
Implement configurable multi-judge panel per ADR D3.

#### Files to edit
```
src/benchmarks/llm-judge/judge-panel.ts (NEW) — LlmJudgePanel class accepting LLM[] dependency injection
src/benchmarks/llm-judge/single-judge.ts (NEW) — SingleJudge.judge() returns Promise<JudgeLabel | null> per EC-1 + EC-2
src/benchmarks/llm-judge/json-extractor.ts (NEW — EC-1 absorbed) — extracts first valid {...} containing "label" field from raw LLM response; tolerates markdown code fences + prose prefix/suffix; returns null on no-match
src/benchmarks/llm-judge/inter-judge-agreement.ts (NEW) — Cohen's kappa OR simple %-agreement; returns null + warning when N=1 (EC-10)
src/benchmarks/llm-judge/judge-prompt.ts (NEW) — exported ACCURACY_PROMPT template (configurable per panel-judge)
src/benchmarks/llm-judge/__tests__/*.test.ts (NEW)
```

#### Deep Dives

**Anti-Mem0 design** (blueprint Q2):
- Model / prompt / temperature are CONFIG (not hardcoded)
- Panel of N judges (default 2: gpt-4o + claude-sonnet)
- Inter-judge agreement reported alongside binary label
- Raw response persisted alongside binary label

**Default prompt** (DESCRIPTIVE, not "be generous"):
```
Evaluate the generated answer against the gold answer for the given question.

Return a JSON object with two fields:
- "label": "CORRECT" if the generated answer conveys the same information as the gold answer (allowing reasonable paraphrase + format variation); "WRONG" otherwise
- "reasoning": one-sentence justification for the label

Be calibrated, not lenient. If the generated answer is partially correct or evasive, return WRONG.

Question: {question}
Gold answer: {gold}
Generated answer: {generated}
```

#### TDD
```
RED:     test('SingleJudge returns 1 for CORRECT label')
RED:     test('SingleJudge returns 0 for WRONG label')
RED:     test('LlmJudgePanel aggregates 2 judges to majority')
RED:     test('LlmJudgePanel reports kappa when judges disagree')
RED:     test('LlmJudgePanel persists raw responses')
RED:     test('extractJudgeJson handles markdown-wrapped response')      # EC-1
RED:     test('extractJudgeJson handles prose prefix + suffix')          # EC-1
RED:     test('extractJudgeJson returns null on malformed input')        # EC-1
RED:     test('SingleJudge returns null when json-extractor returns null')  # EC-1+EC-2
RED:     test('InterJudgeAgreement returns null + warning when N=1 judge')  # EC-10
GREEN:   Implement
VERIFY:  npm test -- src/benchmarks/llm-judge
```

#### Acceptance Criteria
- [ ] LlmJudgePanel + SingleJudge + InterJudgeAgreement + JudgePrompt modules ship
- [ ] 5+ RED→GREEN tests
- [ ] Raw response persistence verified in test
- [ ] Pass: complexity, coverage 100% on critical paths, lint zero, size ≤ 200 LoC per file

#### DoD
- [ ] Tests green
- [ ] Depends-on injected LLM interface from `src/core/dip/llm.ts` (per DIP D6)

---

## Phase 2: Fixture downloader

**Objective:** ship `benchmarks/download-fixtures.sh` per ADR D4 + lazy loader in `src/benchmarks/fixtures/`.

### T2.1 — Bash script + lazy loaders

#### Files to edit
```
benchmarks/scripts/download-fixtures.ts (NEW — EC-6 absorbed; replaces bash script) — TypeScript using Node 20+ native fetch; portable across macOS/Linux/Windows without requiring wget; idempotent (checks file existence + size before re-downloading per EC-8); for LoCoMo Google Drive: emits manual-download instructions instead of fragile auto-fetch
package.json — add "download-fixtures": "tsx benchmarks/scripts/download-fixtures.ts" npm script
benchmarks/README.md (NEW) — manual instructions + license disclaimers per dataset
src/benchmarks/fixtures/longmemeval-loader.ts (NEW) — readFile + JSON.parse + mixed-type schema normalization per blueprint Q6 defect
src/benchmarks/fixtures/locomo-loader.ts (NEW)
src/benchmarks/fixtures/dmr-loader.ts (NEW)
src/benchmarks/fixtures/__tests__/loader.test.ts (NEW) — tests against tiny committed fixture samples under tests/fixtures/benchmarks/
tests/fixtures/benchmarks/longmemeval-sample.json (NEW) — 3-question smoke fixture committed for CI
tests/fixtures/benchmarks/locomo-sample.json (NEW) — same
tests/fixtures/benchmarks/dmr-sample.json (NEW) — same
.gitignore — add benchmarks/data/ to prevent committing downloaded fixtures
```

#### Deep Dives

**LongMemEval mixed-type normalization** (blueprint Q6 defect):
```ts
// answer column mixes int and object per HF card known issue
function normalizeLongMemEvalAnswer(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number') return String(raw);
  if (typeof raw === 'object' && raw !== null) {
    if ('text' in raw) return String((raw as { text: unknown }).text);
    return JSON.stringify(raw); // fallback (rare)
  }
  throw new InvalidFixtureFormat(`LongMemEval answer field has unexpected type: ${typeof raw}`);
}
```

#### TDD
```
RED:     test('longmemeval-loader normalizes string answer')
RED:     test('longmemeval-loader normalizes number answer')
RED:     test('longmemeval-loader normalizes object-with-text answer')
RED:     test('longmemeval-loader throws on unexpected type')
RED:     test('locomo-loader parses 10-conversation sample')
RED:     test('dmr-loader parses CSV subset')
RED:     test('download-fixtures script is idempotent — running twice does not re-download files already present at expected size')  # EC-8
RED:     test('download-fixtures script runs on macOS without wget (Node fetch only)')  # EC-6
GREEN:   Implement loaders + sample fixtures + downloader TS script
VERIFY:  npm test -- src/benchmarks/fixtures
```

#### Acceptance Criteria
- [ ] `benchmarks/download-fixtures.sh` exists, executable, documented
- [ ] 3 sample fixtures committed at `tests/fixtures/benchmarks/` (≤ 5KB each)
- [ ] 3 loaders implemented + tested
- [ ] LongMemEval mixed-type normalization tested with 3 schema variants
- [ ] `.gitignore` excludes `benchmarks/data/`
- [ ] Pass: standard quality gates

#### DoD
- [ ] Tests green; smoke fixture round-trips load→assert
- [ ] Manual run of `benchmarks/download-fixtures.sh` documented in `docs/benchmarks/v0.8.md § Reproducibility` (Phase 8 dependency)

---

## Phase 3: TheMemory v0.7 BenchmarkAdapter

**Objective:** TheMemory drives the Protocol shape. First adapter forces our DIP to be ergonomic.

### T3.1 — `TheMemoryBenchmarkAdapter` at `src/benchmarks/themory/`

#### Files to edit
```
src/benchmarks/themory/adapter.ts (NEW) — TheMemoryBenchmarkAdapter implements BenchmarkAdapter
src/benchmarks/themory/__tests__/adapter.test.ts (NEW) — uses InMemoryVectorStore (no Pg) for unit
tests/integration/benchmarks/themory-adapter-pg.test.ts (NEW) — against ankane/pgvector:v0.5.1
```

#### Deep Dives

Thin shim over `Memory` from `src/local/index.ts`:
```ts
export class TheMemoryBenchmarkAdapter implements BenchmarkAdapter {
  readonly name = 'themory';
  constructor(private readonly memory: Memory, private readonly tokenizer: Tokenizer) {}
  // EC-5 absorbed: scoped userId = "${conversationId}::${speaker}" preserves
  // multi-speaker boundary per fixture (LongMemEval, LoCoMo each have ≥ 2
  // speakers per conversation). Items without speaker field fall back to
  // "unknown" — single-speaker fixtures (like DMR-derived MSC subset) get a
  // consistent userId per conversation.
  private scopedUserId(conversationId: string, speaker?: string): string {
    return `${conversationId}::${speaker ?? 'unknown'}`;
  }
  async add(corpus: BenchmarkCorpus): Promise<AddMetrics> {
    const start = performance.now();
    for (const item of corpus.items) {
      const userId = this.scopedUserId(corpus.conversationId, item.speaker);
      await this.memory.user(userId).remember(item.text, { metadata: item.metadata });
    }
    return { itemCount: corpus.items.length, latencyMs: performance.now() - start };
  }
  async search(query: BenchmarkQuery): Promise<SearchResult> {
    const start = performance.now();
    // EC-5: search across ALL speakers in the conversation (cross-speaker recall is
    // what LongMemEval tests). Implementation: query each speaker's scope + merge.
    const speakers = query.expectedSpeakers ?? ['unknown'];
    const allResults: { text: string; score: number }[] = [];
    for (const sp of speakers) {
      const r = await this.memory.user(this.scopedUserId(query.conversationId, sp)).recall(query.questionText, { topK: 30 });
      allResults.push(...r);
    }
    allResults.sort((a, b) => b.score - a.score);
    const context = allResults.slice(0, 30).map(r => r.text);
    // Use injected LLM to synthesize answer from context (mirrors Mem0 pattern)
    const answerResponse = await this.llm.generateChat([
      { role: 'system', content: 'Answer based on the retrieved context.' },
      { role: 'user', content: `Context: ${context.join('\n')}\n\nQuestion: ${query.questionText}` }
    ]);
    return {
      answer: answerResponse.content,
      retrievedContext: context,
      latencyMs: performance.now() - start,
      tokensUsed: this.computeTokenUsage(query.questionText, context, answerResponse.content)
    };
  }
}
```

#### TDD + Acceptance + DoD
Standard pattern as T0.1/T1.1. Integration test against real Pg using existing `tests/integration/distillation/` setup pattern.

---

## Phase 4: Runner orchestrator + P95 instrumentation

**Objective:** wire the runner per ADR D8 — OTel-instrumented invocation of an adapter against a corpus + query set; aggregates results to JSON.

### T4.1 — Runner module + P95 aggregation

#### Files to edit
```
src/benchmarks/runner/benchmark-runner.ts (NEW) — BenchmarkRunner class; EC-2 + EC-9: incremental per-question persistence (write JSON.append after each question) + 3-consecutive-judge-null retry policy
src/benchmarks/runner/otel-instrumented.ts (NEW) — OTel span wrapper for adapter calls
src/benchmarks/runner/result-aggregator.ts (NEW) — reads span buffer + per-question records, emits per-run JSON
src/benchmarks/runner/cost-tracker.ts (NEW) — uses @dqbd/tiktoken + pricing-table.json
src/benchmarks/runner/pricing-table.json (NEW — EC-13 inline: carries `fetched_at: 2026-06-02` + 30-day sunset reminder in adjacent README) — { 'gpt-4o-mini': {input: 0.000150, output: 0.000600}, ... }
src/benchmarks/runner/pricing-table-miss.ts (NEW — EC-3 absorbed) — typed `PricingTableMiss extends Error` thrown when model lookup fails; runner catches + persists per-question record with `cost = NaN, pricing_table_miss: true, model_attempted: <name>` flag
src/benchmarks/runner/__tests__/runner.test.ts (NEW)
tests/integration/benchmarks/runner-integration.test.ts (NEW)
```

#### Deep Dives — runner flow

```ts
class BenchmarkRunner {
  async run(adapter: BenchmarkAdapter, corpus: BenchmarkCorpus, queries: BenchmarkQuery[]): Promise<RunReport> {
    await this.tracer.startActiveSpan(`benchmark.add.${adapter.name}`, async (span) => {
      const addMetrics = await adapter.add(corpus);
      span.setAttribute('items', addMetrics.itemCount);
      span.end();
    });
    const perQuery: PerQueryResult[] = [];
    for (const query of queries) {
      await this.tracer.startActiveSpan(`benchmark.search.${adapter.name}.${query.questionId}`, async (span) => {
        const result = await adapter.search(query);
        const judgeOutcome = await this.judgePanel.judge(query, result.answer);
        perQuery.push({ query, result, judgeOutcome, latencyMs: result.latencyMs, costUsd: this.costTracker.compute(result.tokensUsed, adapter.name) });
        span.end();
      });
    }
    return this.aggregator.aggregate(perQuery, adapter.name);
  }
}
```

#### TDD

```
RED:     test('runner instruments OTel span per adapter.add call')
RED:     test('runner instruments OTel span per adapter.search call')
RED:     test('runner aggregates per-question results into RunReport')
RED:     test('cost-tracker throws PricingTableMiss when model not in table')  # EC-3
RED:     test('runner catches PricingTableMiss + persists pricing_table_miss: true flag')  # EC-3
RED:     test('cost-tracker returns 0.00 (not NaN) when tokensUsed = {prompt: 0, completion: 0}')  # EC-11
RED:     test('runner persists per-question records incrementally — if adapter.search throws on Q250, runner has saved Q0..Q249 to disk')  # EC-9
RED:     test('runner pauses 60s + retries 1× when judgePanel returns null for 3 consecutive questions')  # EC-2
RED:     test('runner emits non-zero exit code with partial_judge_failure: N field after retry exhaustion')  # EC-2
GREEN:   Implement
VERIFY:  npm test -- src/benchmarks/runner && npm run test:integration -- runner-integration
```

#### Acceptance Criteria (T4.1)
- [ ] BenchmarkRunner ships with OTel + cost + aggregator wired
- [ ] PricingTableMiss typed error introduced (EC-3); runner catches + flags
- [ ] All-judges-fail policy implemented per Deep Dives: 3-consecutive-null → 60s pause → 1 retry → partial-results persist + exit code (EC-2)
- [ ] Incremental per-question persistence (EC-9) — if process killed at Q250, results JSON has 0..249 valid records
- [ ] cost-tracker handles zero-token case returning 0.00 (not NaN) (EC-11)
- [ ] pricing-table.json carries `fetched_at` field + adjacent README documents 30-day sunset reminder (EC-13)
- [ ] Pass: standard quality gates (complexity, coverage 100% on cost-tracker + runner orchestrator, lint, size ≤ 500 LoC per file)

#### DoD (T4.1)
- [ ] All tests green; integration test asserts non-zero OTel spans emitted
- [ ] No vendor-specific assumptions leak into runner — fully Protocol-driven (DIP D5/D6)

---

## Phase 5: LongMemEval THE GOAL TEST (PRIMARY)

**Objective:** end-to-end execution of LongMemEval against TheMemory adapter; produces first published result. Demonstrates Protocol + runner end-to-end.

### T5.1 — Full LongMemEval matrix cell for TheMemory

#### Files to edit
```
benchmarks/scripts/run-longmemeval.ts (NEW) — entry point: reads fixture, instantiates TheMemory + runner + judge panel, writes results JSON
benchmarks/results/longmemeval/themory.json (NEW — generated)
vitest.benchmark.config.ts (NEW — EC-4 absorbed) — extends e2e config with testTimeout: 60 * 60 * 1000 (60 min) for long-running benchmark suite
package.json — add "test:benchmark": "vitest run --config vitest.benchmark.config.ts" script
tests/e2e/benchmarks/longmemeval-themory.test.ts (NEW) — gated on BENCH_RUN=true + OPENAI_API_KEY via describe.skipIf; uses vitest.benchmark.config.ts (NOT default e2e); expects JSON with per-question results
docs/benchmarks/v0.8-progress.md (NEW) — running log of cell completions
```

**Note on test config separation (EC-4):** `vitest.e2e.config.ts` keeps 5s default for `matrix-publication.test.ts` (T8.2 — pure file I/O, fast). Only the actual benchmark runs (T5.1 / T7.1 / T7.2) use `vitest.benchmark.config.ts` with extended timeout. This avoids penalizing the e2e gate runtime for the rare benchmark execution.

#### Acceptance — THE GOAL TEST

- [ ] `benchmarks/scripts/run-longmemeval.ts` runs against `longmemeval_oracle.json` fixture
- [ ] Output JSON has 500 records (one per question) with bleu1 + f1 + judge_label + latencyMs + costUsd
- [ ] Test asserts `judgePanel` was called per-question, raw response persisted
- [ ] P95 latency measured + emitted to console
- [ ] Cost/session computed via pricing-table
- [ ] First published "TheMemory v0.7 on LongMemEval" cell exists

---

## Phase 6: Mem0 + Zep + Letta BenchmarkAdapters

**Objective:** 3 additional adapters per ADR D6 (separate abstractions wrapping vendor SDKs). Can parallelize.

### T6.1 — Mem0BenchmarkAdapter (via OpenAI-compat REST per Mem0 server pattern)

#### Files to edit
```
src/benchmarks/mem0/adapter.ts (NEW)
src/benchmarks/mem0/__tests__/adapter.test.ts (NEW) — mocked HTTP
tests/integration/benchmarks/mem0-adapter.test.ts (NEW — gated on MEM0_API_KEY)
```

### T6.2 — ZepBenchmarkAdapter (via @getzep/zep-cloud SDK)

#### Files to edit
```
src/benchmarks/zep/adapter.ts (NEW)
src/benchmarks/zep/__tests__/adapter.test.ts (NEW)
tests/integration/benchmarks/zep-adapter.test.ts (NEW — gated on ZEP_API_KEY)
```

### T6.3 — LettaBenchmarkAdapter (via Letta REST or letta-py CLI subprocess)

#### Files to edit
```
src/benchmarks/letta/adapter.ts (NEW)
src/benchmarks/letta/__tests__/adapter.test.ts (NEW)
tests/integration/benchmarks/letta-adapter.test.ts (NEW — gated on LETTA_API_KEY)
```

#### TDD per task: 4 RED tests minimum (add OK, search OK, latency reported, tokens reported); GREEN with mocked HTTP fixtures in unit; integration with real credentials gated by env var.

#### Acceptance for all 3 (Phase 6 collective):
- [ ] 3 adapters ship
- [ ] Per-adapter integration tests skip cleanly when env var absent (per `tests/integration/distillation/` pattern — EC-14 inline: pattern established by `describe.skipIf(PG_URI === '')` precedent in skill-isolation.test.ts:44; acceptable as-is)
- [ ] Cost tracking works per-vendor (different pricing rates)
- [ ] All 3 adapters implement same `BenchmarkAdapter` interface (DIP enforced via typecheck)

---

## Phase 7: LoCoMo + DMR runs

**Objective:** populate remaining 8 matrix cells (4 adapters × 2 benchmarks).

### T7.1 — LoCoMo full matrix (4 cells)

#### Files to edit
```
benchmarks/scripts/run-locomo.ts (NEW)
benchmarks/results/locomo/{themory,mem0,zep,letta}.json (NEW — generated)
docs/benchmarks/v0.8-progress.md — append completion rows
```

### T7.2 — DMR full matrix (4 cells)

#### Files to edit
```
benchmarks/scripts/run-dmr.ts (NEW)
benchmarks/results/dmr/{themory,mem0,zep,letta}.json (NEW — generated)
docs/benchmarks/v0.8-progress.md — append
```

#### Acceptance
- [ ] All 8 cells generated
- [ ] LoCoMo runs document license disclaimer (CC-BY-NC-SA 4.0 per ADR D4)
- [ ] DMR-derived 500-conv subset re-derivation script committed at `benchmarks/scripts/derive-dmr-subset.ts`

---

## Phase 8: docs/benchmarks/v0.8.md publication

**Objective:** publish the matrix per roadmap row 10 acceptance criteria. THIS is the deliverable cited by v1.0 row 11.

### T8.1 — docs/benchmarks/v0.8.md authoring

#### Files to edit
```
docs/benchmarks/v0.8.md (NEW) — main publication
docs/benchmarks/v0.8-methodology.md (NEW) — adapter design, judge panel, OTel instrumentation, pricing-table
docs/benchmarks/v0.8-reproducibility.md (NEW) — copy-paste runbook
docs/benchmarks/v0.8-raw-results/ (NEW dir) — committed result JSONs
README.md — append "v0.8 benchmarks published" sentence
CHANGELOG.md — `[Unreleased]` Added "v0.8 — Independent benchmark reproduction (LongMemEval + LoCoMo + DMR matrix)"
```

#### Acceptance
- [ ] docs/benchmarks/v0.8.md exists with 12 cells (4 × 3) populated
- [ ] Per-cell columns: BLEU + F1 + LLM-judge accuracy + P95 latency + cost/session
- [ ] Methodology section cites blueprint + ADRs D1-D9
- [ ] Reproducibility section: copy-paste commands to re-run each cell
- [ ] Raw results JSONs committed as audit trail
- [ ] CHANGELOG.md updated

### T8.2 — `tests/e2e/benchmarks/matrix-publication.test.ts` THE FINAL GOAL TEST

#### Files to edit
```
tests/e2e/benchmarks/matrix-publication.test.ts (NEW) — reads docs/benchmarks/v0.8.md, asserts all 12 cells present + correctly formatted
```

#### Deep Dives
- Use markdown table parser; check 12 unique adapter×benchmark rows
- Assert P95 latency column is numeric (not "TBD")
- Assert cost/session column is numeric

#### TDD
```
RED:     test('matrix has 12 cells')
RED:     test('every cell has BLEU + F1 + judge + P95 + cost')
RED:     test('no TBD placeholders remain')
RED:     test('parser tolerates whitespace + cell-alignment variations in markdown table')  # EC-12
RED:     test('parser flags pricing_table_miss cells as "cost N/A" rather than failing')  # EC-3 ↔ EC-12
GREEN:   Phase 8 publication satisfies all 5 assertions
VERIFY:  npm run test:e2e
```

#### Acceptance + DoD
- [ ] `tests/e2e/benchmarks/matrix-publication.test.ts` PASSES
- [ ] THE GOAL of this plan satisfied

---

## Coverage Matrix

| # | Gap / Requirement (from blueprint + roadmap row 10) | Task(s) | Resolution |
|---|---|---|---|
| 1 | DIP for benchmark adapters (anti-Mem0 no-interface anti-pattern; Q1 + ADR D1, D5, D6) | T0.1 | BenchmarkAdapter Protocol in `src/core/dip/` |
| 2 | Metric primitives (BLEU + F1) per ADR D1 reuse-primitives | T1.1 | `src/benchmarks/metrics/` |
| 3 | Multi-judge panel (anti-Mem0 "be generous" + variance; Q2 + ADR D3) | T1.2 | `src/benchmarks/llm-judge/` |
| 4 | Fixture downloader + license discipline (ADR D4) | T2.1 | `benchmarks/download-fixtures.sh` + loaders |
| 5 | TheMemory v0.7 adapter (drives Protocol design) | T3.1 | `src/benchmarks/themory/` |
| 6 | Runner with OTel + P95 (ADR D8) + cost (ADR D7) | T4.1 | `src/benchmarks/runner/` |
| 7 | LongMemEval primary (ADR D2; Q6 zero-third-party finding) | T5.1 | LongMemEval cell for TheMemory |
| 8 | Mem0 + Zep + Letta adapters | T6.1 + T6.2 + T6.3 | 3 vendor adapters |
| 9 | LoCoMo (Mem0 comparison ground; Q7) | T7.1 | 4 LoCoMo cells |
| 10 | DMR (historical compat; Q7 ceiling-effect noted) | T7.2 | 4 DMR cells |
| 11 | docs/benchmarks/v0.8.md publication (roadmap row 10 acceptance) | T8.1 | Main artifact |
| 12 | Independent verification gate | T8.2 | THE FINAL GOAL TEST |
| 13 | Dedicated evaluation extras group (anti-Mem0 orphan deps; Q4) | T0.1 + T1.1 (via `package.json` updates) | Declared in package.json (Dependencies section above + Phase 0/1 sub-tasks) |
| 14 | Pre-parse LongMemEval mixed-type answer (Q6 dataset defect) | T2.1 | `normalizeLongMemEvalAnswer` helper |
| 15 | Skip BERTScore + SBERT default (ADR D9; Q2 pragmatic match) | T1.1 acceptance criteria | Default scorecard omits semantic metrics |
| 16 | EC-1 absorbed: LLM-judge JSON parse robustness | T1.2 (json-extractor.ts NEW) | json-extractor + SingleJudge returns nullable |
| 17 | EC-2 absorbed: all-judges-fail policy | T4.1 (runner pause+retry+exit code) | 3-consecutive-null → 60s pause → 1 retry → partial-persist |
| 18 | EC-3 absorbed: pricing-table miss honest reporting | T4.1 (PricingTableMiss typed error) | Persists pricing_table_miss flag + matrix "cost N/A" |
| 19 | EC-4 absorbed: long-running benchmark test timeout | T5.1 (vitest.benchmark.config.ts NEW + test:benchmark script) | 60-min testTimeout for benchmark runs only |
| 20 | EC-5 absorbed: multi-speaker scope discipline | T0.1 + T3.1 (BenchmarkCorpusItem.speaker + scopedUserId) | conversationId::speaker preserves boundary |
| 21 | EC-6 absorbed: cross-platform fixture downloader | T2.1 (TypeScript script using Node fetch) | macOS/Linux/Windows portable, no wget required |
| 22 | EC-7/EC-8/EC-9/EC-10/EC-11/EC-12 absorbed: SHOULD TEST adds | TDD blocks of T1.1, T2.1, T4.1, T1.2, T8.2 | Tests added inline at each task |
| 23 | EC-13/EC-14 absorbed: DOCUMENT notes | T4.1 (pricing-table sunset) + T6.x (skip-clean pattern) | Inline notes |

**Coverage: 23/23 gaps covered (100%)** (15 original + 8 edge-case absorptions per v1.1)

## Global Definition of Done

- [ ] All 9 phases (0-8) completed
- [ ] All tests passing — `npm test` green + `npm run test:integration` green (gated suites SKIP cleanly when API keys absent) + `npm run test:e2e` green for `matrix-publication.test.ts`
- [ ] Zero TypeScript errors — `npm run typecheck`
- [ ] Zero lint warnings — `npm run lint`
- [ ] File-size budget respected per `.claude/rules/architecture.md § Module hygiene` (default 500 LoC per file; types-only files like `src/core/dip/benchmark-adapter.ts` ≤ 100 LoC)
- [ ] CHANGELOG.md updated under `[Unreleased]` with "Added: v0.8 — Independent benchmark reproduction" entry (Inquebrável Rule 6)
- [ ] Backward compatibility preserved — no breaking changes to `src/index.ts` public exports (Phase 0 adds NEW `BenchmarkAdapter` re-export under `@usetheo/memory/contract` — additive only)
- [ ] Plan-specific criteria:
  - [ ] docs/benchmarks/v0.8.md published with 12 populated cells
  - [ ] All 6 URL snapshots from discovery still resolvable (audit-trail integrity)
  - [ ] LoCoMo CC-BY-NC-SA 4.0 disclaimer included in docs
  - [ ] Adapter Protocol respected per typecheck for ALL 4 adapter implementations
- [ ] **Runtime-metric proof** — OTel span buffer in `tests/integration/benchmarks/runner-integration.test.ts` MUST show non-zero spans for adapter `add` + `search`; cost tracker MUST emit non-zero USD figures; LLM-judge raw responses MUST be persisted to per-question records (not just labels). "Code exists + tests pass" is NOT proof of wiring.
- [ ] **Plan archived** — after `/review` returns READY_TO_MERGE AND PR merged to `main`, move this plan to `.claude/knowledge-base/plans/completed/v0-8-independent-benchmark-reproduction-plan.md` per audit-trail-rotation policy. Blueprint stays in place.
- [ ] **Roadmap update** — CLAUDE.md row 10 (Item 10) status flipped from `Planned` to `Shipped 2026-MM-DD` with link to docs/benchmarks/v0.8.md
- [ ] **/dogfood gate honored** — v0.8 ships do NOT trigger production-ready claim by themselves; row 11 (b) still requires anchor scenario `running` ≥ 30 days. v0.8 publication explicitly states "row 11 (b) is independent and still pending."

## Final Phase: Integration Validation (MANDATORY)

> Runs AFTER Phases 0-8. Plan NOT done until this chain passes.

### Execution

```bash
npm test                                                  # unit + Phase 0/1/2/3/4 tests
npm run test:integration                                   # Phase 3/6/7 with API-keyed adapters (SKIP cleanly when env absent)
npm run test:e2e                                          # matrix-publication.test.ts (T8.2)
npm run test:coverage                                     # ≥ 90% on changed files; 100% on metric primitives + runner
npm run typecheck                                         # zero TS errors
npm run lint                                              # zero warnings
```

Plus benchmark-specific:

```bash
BENCH_RUN=true OPENAI_API_KEY=... bash benchmarks/scripts/run-longmemeval.ts --adapter themory  # Phase 5 reproduction
BENCH_RUN=true OPENAI_API_KEY=... bash benchmarks/scripts/run-locomo.ts --adapter themory       # Phase 7.1 reproduction
BENCH_RUN=true OPENAI_API_KEY=... bash benchmarks/scripts/run-dmr.ts --adapter themory          # Phase 7.2 reproduction
```

(Optional, gated on vendor keys; verify cells produce non-zero records.)

### Acceptance Criteria

- [ ] All test suites green (unit + integration + e2e)
- [ ] Coverage ≥ 90% changed files; critical paths (metrics + runner) 100%
- [ ] Zero TS errors
- [ ] Zero lint warnings
- [ ] `tests/e2e/benchmarks/matrix-publication.test.ts` THE FINAL GOAL TEST passes
- [ ] Runtime-metric proof — see Global DoD above

### If Validation Fails

1. Identify which failures are caused by this plan vs pre-existing (run `git diff main`)
2. Fix plan-caused failures
3. Pre-existing failures logged in PR description
4. Re-run chain to confirm

---

## Notes for /implement

- **Estimated total cost:** 200-400k tokens (per `token-budget.md` v0.8 row)
- **Estimated implementation time:** 2-4 weeks across the 9 phases. Phase 0/1 fast (~1-2 days), Phase 3+6 vendor-SDK research-heavy, Phase 5 first benchmark run will surface most defects.
- **SEPA agent recommendations** — per `cycle-implement.md` v1.1, this plan WILL spawn a Staff Engineer Pair-Program Agent at startup. SEPA should:
  - Cross-reference D5/D6 DIP boundaries against `architecture.md § 3` aggressively
  - Watch for adapter implementations leaking vendor SDK types into `BenchmarkCorpus` / `SearchResult` (defeat ADR D6)
  - Flag any "be generous" instructional bias in any LLM prompt (D3 violation)
  - Verify every cost figure has a tokenizer + pricing-table source

## Cross-references

- Discovery blueprint: `.claude/knowledge-base/discoveries/blueprints/v0-8-benchmark-methodology-blueprint.md`
- Discovery confidence report: `.claude/knowledge-base/reviews/v0-8-benchmark-methodology-confidence-2026-06-02.md`
- Roadmap: `CLAUDE.md` row 10 (v0.8) + row 11 (v1.0 gate)
- Rules consumed: `architecture.md` (DIP § 3, naming § 6, hygiene § 7), `testing.md` (TDD + pyramid), `no-paper-names-in-code.md`, `dogfood-golden-rule.md` (independent gate), `plan-confidence-golden-rule.md` (this plan's quality contract)
- Sibling cycle outputs: v0.7 distillation pipeline (precedent for 9th DIP `ConflictResolutionPolicy`); v0.4a reflection pipeline (precedent for OTel BatchSpanProcessor + in-memory exporter pattern)
- Token budget: `token-budget.md` v0.8 entry (200-400k tokens estimated)
- Inquebráveis honored: Rule 3 (extreme honesty — license disclaimers + no-vendor-benchmark-theater + caveat in docs), Rule 5 (TDD — every task has RED first), Rule 9 (Não Reinvente — `natural`/`tiktoken`/`csv-parse` adopted; runner owned)
