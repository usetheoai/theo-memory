# Review: v0-8-independent-benchmark-reproduction

**Date:** 2026-06-02
**Verdict:** NEEDS_FIXES
**Reviewers (spawned agents):** 6 (architecture, cross-validation, review-v0-8-independent-benchmark-reproduction-domain-memory-layer, review-v0-8-independent-benchmark-reproduction-domain-observability, review-v0-8-independent-benchmark-reproduction-tests, wiring)
**Total findings:** 16

## Findings summary by severity

| Severity | Count |
|---|---|
| BLOCKER | 1 |
| CRITICAL | 0 |
| MAJOR | 5 |
| MINOR | 9 |
| INFO | 1 |

## BLOCKER findings (1)

### F-tests-1: BLEU silently returns 0 for ALL benchmark records because `natural` v8.1.0
does NOT export `BleuScore`. The bleu.test.ts suite is wholly SKIPPED via
`describe.skipIf(!isBleuAvailable())` instead of failing, so this defect
passes through CI undetected. The benchmark runner reports `bleu = 0` for
every per-query record, which silently corrupts the matrix's BLEU column
published at docs/benchmarks/v0.8.md and any future v0.8.x update.


- **Found by:** review-v0-8-independent-benchmark-reproduction-tests
- **File:** `src/benchmarks/metrics/bleu.ts` line 53
- **Plan reference:** T1.1 + ADR D1 + EC-7
- **Evidence:**

  $ node -e "const n = require('natural'); console.log(Object.keys(n).filter(k => /Bleu|BLEU/i.test(k)));"
  []
  $ node -e "const r = require('natural'); console.log(typeof r.BleuScore);"
  undefined
  
  bleu.ts loadNaturalBleu() reads natural.BleuScore which is `undefined`,
  sets probedAvailability=false, returns null. calculateBleuScore() then
  silently returns 0 on line 69.
  
  bleu.test.ts L18: describe.skipIf(!isBleuAvailable()) — when BleuScore is
  undefined the WHOLE describe block is skipped (verified: 6 skipped tests in
  contract run). EC-7 absorption assertions (L31-46) NEVER actually exercise
  the BLEU path.
  
  benchmark-runner.ts L161 wires this defective BLEU into every per-query
  record, propagating bleu=0 to results aggregation + matrix publication.

- **Recommended action:** Option A (preferred): replace `natural.BleuScore` lookup with the actual
`natural` v8 API (e.g., `new natural.BleuScore(reference, candidates,
weights).score`); confirm via `node -e ...` first. Add a non-skipped test
that asserts BLEU(identical) > 0.9 (canary against silent regression).
Option B: vendor a minimal BLEU-1 implementation (rule 9 trade-off — paper
cited in plan deep dives line 339-342). Remove the
describe.skipIf entirely so test failures surface CVE-style.



## MAJOR findings (5)

### F-dom-obs-1: Library code under src/benchmarks/runner/benchmark-runner.ts mutates the
Node.js global `process.exitCode = 1` inline (line 120). This is the same
family of defect as the iter-7 setGlobalTracerProvider regression the
domain-observability brief explicitly flagged: library code reaching into
runtime-global state instead of returning the signal through a typed
result. The smell is auditable in tests too — runner.test.ts:352 must
manually reset `process.exitCode = 0` to prevent cross-test contamination
("Reset exitCode so it does not contaminate other test files"). When the
library leaks global state and the test suite acknowledges the leak by
cleaning up after it, the contract has drifted from "DI-clean observable
runner" to "DI-clean for OTel, global-mutation for exit code". The
RunReport already carries `aborted: boolean` + `abortReason?: string` —
the CLI caller (run-longmemeval.ts / run-locomo.ts / run-dmr.ts) is the
correct locus to translate report.aborted into process.exit. Today the
CLI .then() callback ignores report.aborted entirely (run-longmemeval.ts:168-171
only logs "aborted: <bool>", never exits non-zero), so the global mutation
in library code is the ONLY signal reaching CI — meaning the architectural
leak is also the only thing keeping CI honest. Fix: move exitCode mutation
to each CLI script's .then() block, conditioned on report.aborted.


- **Found by:** review-v0-8-independent-benchmark-reproduction-domain-observability
- **File:** `src/benchmarks/runner/benchmark-runner.ts` line 120
- **Plan reference:** ADR D1 + ADR D8 + plan v1.2 § T4.1 (orchestrator owns observability)
- **Domain anchor:** architecture.md § 3 (DIP strict — library code never depends on global state); precedent of iter-7 setGlobalTracerProvider regression flagged in domain-observability.md pre-read
- **Evidence:**

  ```ts
  // src/benchmarks/runner/benchmark-runner.ts:117-122
  if (retryRecord.judgeLabel === null) {
    aborted = true;
    abortReason = `all-judges-fail policy: ${String(consecutiveNullCount)} consecutive nulls + retry also null at Q${query.questionId}`;
    process.exitCode = 1;  // <-- library mutates Node global
    break;
  }
  ```
  ```ts
  // src/benchmarks/runner/__tests__/runner.test.ts:349-352
  // exit code set to 1 for partial-result CI handling
  expect(process.exitCode).toBe(1);
  // Reset exitCode so it does not contaminate other test files
  process.exitCode = 0;  // <-- test acknowledges the leak
  ```
  ```ts
  // benchmarks/scripts/run-longmemeval.ts:167-175
  main({ fixturePath, resultsPath })
    .then((report) => {
      console.log(`[run-longmemeval] aborted: ${String(report.aborted)}`);  // <-- never exits non-zero
      console.log(`[run-longmemeval] questionCount: ${String(report.aggregate.questionCount)}`);
    })
    .catch((err: unknown) => { ... process.exit(1); });
  ```

- **Recommended action:** 1. Remove `process.exitCode = 1` from src/benchmarks/runner/benchmark-runner.ts:120.
2. In each CLI script (benchmarks/scripts/run-{longmemeval,locomo,dmr}.ts),
   after `.then((report) => {...})`, add:
   ```ts
   if (report.aborted) process.exit(1);
   ```
3. Update the EC-2 abort test to assert `report.aborted === true` and
   `report.abortReason` is non-empty WITHOUT touching `process.exitCode`
   in the library-level test.
4. Optional: add a CLI-script-level test (under tests/integration/benchmarks/)
   that asserts the run-longmemeval main script exits non-zero on
   aborted runs.


### F-dom-obs-2: JSDoc honesty drift between span instrumentation and P95 computation.
Two source files claim P95 latency comes from OTel span durations:
  - result-aggregator.ts:13: "P95 latency is computed from OTel span
    durations (D8 — spans + aggregator, not OTel histogram metric)"
  - otel-instrumented.ts:6-7: "P95 latency is computed from span
    end-start by the aggregator (NOT from an OTel histogram metric)"
But in actual code, the aggregator reads `records.map((r) => r.latencyMs)`
— `record.latencyMs` is sourced from `searchResult.latencyMs`, which is
adapter-self-reported wall-clock (themory/adapter.ts:133 captures
`performance.now() - start` BEFORE the runner's withSpan callback ends).
The OTel spans are emitted, the InMemorySpanExporter receives them in
tests — but their durations are never read for P95. Span end-start and
adapter-self-reported latency are NOT equivalent: the span wraps the
adapter call but it ALSO includes the runner's withSpan setup/teardown,
whereas the adapter measures only the inner work. The two diverge by
a small but observable margin. This is a methodological documentation
defect — readers building on top of the plan's matrix expect "P95 from
spans" and will write tests that assume span duration. The honest
statement is "P95 latency is computed from adapter-self-reported
latencyMs; spans are emitted for tracing/external collector consumption
but not aggregated".
Secondary observation: the span attribute set is missing two attributes
the agent brief listed as expected (latencyMs and modelUsed). Adding
them would let external OTel collectors (e.g., production telemetry
pipelines) build their own P95 from span durations without touching
the runner. This is OPTIONAL per ADR D8 but the JSDoc drift is the
load-bearing concern.


- **Found by:** review-v0-8-independent-benchmark-reproduction-domain-observability
- **File:** `src/benchmarks/runner/result-aggregator.ts` line 13
- **Plan reference:** ADR D8 (OTel spans owned by runner, P95 computed at aggregator)
- **Domain anchor:** architecture.md § 8 (Error handling — surface honest signals); inquebrável Rule 3 (extreme honesty)
- **Evidence:**

  ```ts
  // src/benchmarks/runner/result-aggregator.ts:11-14 (JSDoc)
   * P95 latency is computed from OTel span durations (D8 — spans + aggregator,
   * not OTel histogram metric).
  ```
  ```ts
  // src/benchmarks/runner/result-aggregator.ts:61-62 (actual code)
  const sortedLatency = [...records.map((r) => r.latencyMs)].sort((a, b) => a - b);
  const p95LatencyMs = percentile(sortedLatency, 95);
  ```
  ```ts
  // src/benchmarks/themory/adapter.ts:133 (where latencyMs originates)
  latencyMs: performance.now() - start,
  ```
  ```ts
  // src/benchmarks/runner/otel-instrumented.ts:30-33 (span attributes — note: NO latencyMs, NO modelUsed)
  span.setAttribute('benchmark.adapter', attrs.adapter);
  span.setAttribute('benchmark.method', attrs.method);
  if (attrs.questionId !== undefined) {
    span.setAttribute('benchmark.question_id', attrs.questionId);
  }
  ```

- **Recommended action:** Pick ONE of:
(a) Update both JSDocs to reflect reality:
    "P95 latency is computed from adapter-self-reported latencyMs.
     OTel spans are emitted per add()/search() for external collector
     consumption but their durations are not read by the aggregator."
(b) Switch the aggregator to read span durations (would require
    capturing span end-start in withSpan and threading it through
    to the PerQueryRecord — bigger refactor; only do this if the
    plan ADR D8 truly intended span-derived P95).
Likely (a) is correct given current shipped behavior; this is a
docstring-only fix. Also strongly recommended: enrich the span
attribute set with `benchmark.latency_ms` (from withSpan timing) and
`benchmark.model_used` (passed through attrs) — these surface in
OTel exporters and close the methodological gap for downstream
consumers without changing the aggregator contract.


### F-tests-2: The smoke "THE GOAL TEST" e2e at longmemeval-themory.test.ts asserts
judgeLabel ∈ ['CORRECT', 'WRONG', null] (L75) but `buildSmokeJudgePanel`
hardcodes ALL judge responses to `{"label":"CORRECT"}`. The smoke test
cannot detect a WRONG-path regression, BLEU silently returning 0
(F-tests-1), or judge-label propagation bugs. The same Stub+CORRECT
pattern is duplicated across run-locomo.ts + run-dmr.ts.


- **Found by:** review-v0-8-independent-benchmark-reproduction-tests
- **File:** `tests/e2e/benchmarks/longmemeval-themory.test.ts` line 98-113
- **Plan reference:** T5.1 THE GOAL TEST + plan v1.2 § Acceptance line 731
- **Evidence:**

  benchmarks/scripts/run-longmemeval.ts L98-113: buildSmokeJudgePanel
  returns a LlmJudgePanel where the only judge always emits
  `{"label":"CORRECT","reasoning":"smoke run"}`.
  
  tests/e2e/benchmarks/longmemeval-themory.test.ts L75: expect(['CORRECT',
  'WRONG', null]).toContain(record.judgeLabel) — the test passes as long as
  the label is one of the 3; it cannot distinguish "judge correctly
  classified" from "judge always says CORRECT".
  
  grep buildSmokeJudgePanel: appears in run-longmemeval.ts, run-locomo.ts,
  run-dmr.ts identically (DRY violation absorbed inside this finding for
  tests scope; would otherwise be F-arch).

- **Recommended action:** Add a non-smoke e2e assertion at the runner test level (src/benchmarks/
runner/__tests__/runner.test.ts) that injects a JudgePanel emitting WRONG
for a known fixture pair and verifies the perQuery record stores
judgeLabel === 'WRONG' + judgeAccuracy aggregate correctly excludes it.
Existing unit-level coverage of judge-panel + result-aggregator handles the
WRONG path in isolation; the e2e gap is that the WIRING is not
end-to-end-tested.


### F-tests-3: Plan v1.2 § T2.1 TDD explicitly declared two RED tests for the fixture
downloader: (a) `test('download-fixtures script is idempotent — running
twice does not re-download files already present at expected size')` and
(b) `test('download-fixtures script runs on macOS without wget (Node fetch
only)')`. NEITHER test ships. EC-6 + EC-8 are implemented via
Content-Length HEAD-check but no test asserts the script's behavior.


- **Found by:** review-v0-8-independent-benchmark-reproduction-tests
- **File:** `benchmarks/scripts/download-fixtures.mjs` line 104-108
- **Plan reference:** T2.1 TDD block — EC-6 + EC-8
- **Evidence:**

  $ find tests/ -name "*download*" -o -name "*fixture-download*"
  (no results)
  $ grep -rn "EC-8\|idempotent\|re-download" benchmarks/scripts/
    benchmarks/scripts/download-fixtures.mjs:8: idempotent HEAD-checks ...
  $ grep -rn "EC-6\|portable" src/benchmarks/ tests/integration/benchmarks/
    (no test references)

- **Recommended action:** Add tests/integration/benchmarks/download-fixtures.test.ts with a
`nock`-mocked HTTP server (or a vi.fn-mocked fetch) asserting: (a) calling
the script twice with the same fixture present skips the second download
(verify HEAD request count); (b) malformed Content-Length triggers a
re-download (regression guard); (c) the script does NOT shell out to wget
/ curl (grep the spawnSync surface).


### F-tests-4: Plan declares 4 integration test files that DO NOT exist:
  - tests/integration/benchmarks/runner-integration.test.ts (§T4.1 Files to edit)
  - tests/integration/benchmarks/mem0-adapter.test.ts (§T6.1)
  - tests/integration/benchmarks/zep-adapter.test.ts (§T6.2)
  - tests/integration/benchmarks/letta-adapter.test.ts (§T6.3)
Only `tests/integration/benchmarks/themory-adapter-pg.test.ts` ships. Plan
§T4.1 DoD specifies "integration test asserts non-zero OTel spans
emitted"; the OTel span assertion exists in unit-level runner.test.ts
L231-234 (acceptable substitute), but the integration-level wiring vs.
real OTel BatchSpanProcessor + real Pg is not exercised. The vendor
adapter omissions are mitigated by Drift-T6.x-1 (VendorClient DIP + real
SDK deferred); this is documented in docs/benchmarks/v0.8.md so the gap
is honest, but it remains a plan-vs-code delta worth recording.


- **Found by:** review-v0-8-independent-benchmark-reproduction-tests
- **File:** `tests/integration/benchmarks/`
- **Plan reference:** Phase 6 collective acceptance + plan §T4.1 DoD
- **Evidence:**

  $ ls tests/integration/benchmarks/
  themory-adapter-pg.test.ts
  $ grep -rn "Drift-T6.x-1" docs/benchmarks/
  (matches present — gap documented honestly)

- **Recommended action:** (a) Verify §T4.1 DoD: rename runner.test.ts's OTel span test as the
integration substitute by moving it to tests/integration/benchmarks/
with an in-memory exporter + acknowledge Drift-T4.1-N. Or write a real
integration test that runs against pgvector + real adapter + verifies
spans propagate end-to-end. (b) For vendor adapters, Drift-T6.x-1 is
accepted; the follow-up cycle that ships real SDK wiring MUST add the
integration tests against staged keys.



## MINOR findings (9)

### F-dom-mem-1: JSDoc prose includes the paper name "MemGPT" — "DMR fixture loader
(Deep Memory Retrieval, MemGPT-derived MSC subset)". This is a paper-name
reference in JSDoc prose, which the rule forbids. Two further
occurrences exist in JSDoc prose within src/benchmarks/ (not src/** at
large, scope-bounded to v0.8 diff): src/benchmarks/llm-judge/judge-prompt.ts
line 4 ("Anti-Mem0 instructional bias: Mem0's `metrics/llm_judge.py:22-23`")
and src/benchmarks/themory/adapter.ts line 47 ("Defaults to 'gpt-4o-mini'
when omitted (Mem0 evaluation default).").


- **Found by:** review-v0-8-independent-benchmark-reproduction-domain-memory-layer
- **File:** `src/benchmarks/fixtures/dmr-loader.ts` line 2
- **Plan reference:** .claude/rules/no-paper-names-in-code.md § The rule + § How to apply (1)
- **Domain anchor:** no-paper-names-in-code.md (promoted 2026-05-30) — "Research-paper and
marketing names — Voyager, Mem0, Letta, LangMem, MemGPT, MemGPT, ... —
SHALL NOT appear in src/** production code: JSDoc, inline comments".

- **Evidence:**

  ```ts
  // src/benchmarks/fixtures/dmr-loader.ts:1-2
  /**
   * DMR fixture loader (Deep Memory Retrieval, MemGPT-derived MSC subset).
  
  // src/benchmarks/llm-judge/judge-prompt.ts:1-5
  /**
   * Judge prompt template + renderer.
   *
   * Anti-Mem0 instructional bias: Mem0's `metrics/llm_judge.py:22-23`
  
  // src/benchmarks/themory/adapter.ts:47
  * Defaults to 'gpt-4o-mini' when omitted (Mem0 evaluation default).
  ```

- **Recommended action:** Rewrite the three JSDoc strings to be neutral and citation-via-@see.
Per "How to apply" §2, citations move to `@see` pointing to the
knowledge-base coordinates (the plan section + ADR + snapshot file
already capture the provenance):

- dmr-loader.ts: "DMR fixture loader (Deep Memory Retrieval subset
  derived from MSC). @see plan § T2.1 + snapshot
  2026-06-02-dmr-memgpt-zep.md" (snapshot file name itself stays — it's
  a filesystem coordinate per the rule).
- judge-prompt.ts: "Anti-leniency instructional bias: vendor reference
  judge prompts tell the judge to be generous; plan v1.2 ADR D3 inverts
  that to 'be calibrated'. @see plan § ADR D3 + blueprint Q2".
- themory/adapter.ts:47: "Defaults to 'gpt-4o-mini' when omitted (matches
  the vendor evaluation default convention)."

Cleanup is OPPORTUNISTIC per the rule's § Pre-existing references — but
these JSDoc blocks were authored in THIS diff (T2.1 / T1.2 / T3.1
commits), making them NOT pre-existing. The cleanup belongs in a v0.8
fix-up commit before /review re-runs, or accepted as a deferred MINOR
tracked in the merge audit.


### F-dom-mem-2: `coerceMetadata()` claims to coerce arbitrary `unknown` metadata values
to PrimitiveMetadataValue (string | number | boolean | null), but the
type guard branch is incomplete: an explicit `undefined` value in the
metadata bag falls through to the else branch where `JSON.stringify(undefined)`
returns the JavaScript value `undefined` (not the string "undefined").
That `undefined` is then assigned to a field typed as PrimitiveMetadataValue,
breaking the declared invariant silently.

In practice this surfaces when BenchmarkCorpusItem.metadata is sourced
from a JSON-parsed fixture where a field was explicitly set to undefined
(e.g., csv-parse-derived row with empty cells coerced via
`coerceFieldToString` returning undefined for an unknown column). The
Drift-T3.1-2 JSDoc claims "honest, not silent drop" — but the undefined
case IS a silent drop wrapped in a type lie.


- **Found by:** review-v0-8-independent-benchmark-reproduction-domain-memory-layer
- **File:** `src/benchmarks/themory/adapter.ts` line 54-66
- **Plan reference:** src/core/dip/benchmark-adapter.ts (BenchmarkCorpusItem.metadata type) + adapter Drift-T3.1-2 absorption
- **Domain anchor:** architecture.md § 7 — "TypeScript strict mode. No `any`. If you must
escape the type system, use `unknown` with a runtime assertion." +
adapter's own PrimitiveMetadataValue = string | number | boolean | null
contract declared at line 52.

- **Evidence:**

  ```ts
  // src/benchmarks/themory/adapter.ts:52-66
  type PrimitiveMetadataValue = string | number | boolean | null;
  
  function coerceMetadata(
    raw: Readonly<Record<string, unknown>>,
  ): Readonly<Record<string, PrimitiveMetadataValue>> {
    const out: Record<string, PrimitiveMetadataValue> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        out[k] = v;
      } else {
        out[k] = JSON.stringify(v);  // <-- JSON.stringify(undefined) === undefined
      }
    }
    return out;
  }
  ```
  
  Reproduction:
  ```sh
  node -e "for (const [k,v] of Object.entries({a: undefined, b: 1})) console.log(k, typeof v)"
  # a undefined
  # b number
  ```

- **Recommended action:** Add an explicit `undefined` branch BEFORE the else, choosing one of:

(a) Skip the field entirely (clear "honest drop" — preferred if
    downstream RememberOptions metadata bag accepts sparse keys):
```ts
if (v === undefined) continue;  // explicit drop; documented in JSDoc
```

(b) Coerce to null (preserves the key, satisfies the type contract):
```ts
if (v === undefined) { out[k] = null; continue; }
```

Add a unit test in src/benchmarks/themory/__tests__/adapter.test.ts
that asserts the chosen behavior — currently the test suite covers
strings/numbers/booleans/null/nested objects via JSON.stringify but
not the explicit-undefined case.


### F-dom-obs-3: TiktokenTokenizer has zero direct unit tests. The class has three
paths worth exercising:
  - constructor with valid modelName → encoding_for_model success
  - constructor with unknown modelName → fallback to get_encoding('cl100k_base')
  - constructor with undefined → default to cl100k_base
  - count('') → returns 0 (early-return optimization)
  - count('non-empty') → delegates to enc.encode
  - free() → calls enc.free() (memory-leak prevention per testing pyramid hygiene)
The class is used as a singleton in 3 CLI scripts and as DI input to
the TheMemory adapter, but only exercised transitively. A regression
in the fallback path (e.g., a model name that throws a different
Error class than expected, or @dqbd/tiktoken changing its signature)
would surface as an obscure crash in a CLI script rather than a
named test failure. Domain hygiene says: the only file in src/
without a sibling test is a smell.


- **Found by:** review-v0-8-independent-benchmark-reproduction-domain-observability
- **File:** `src/benchmarks/runner/tiktoken-tokenizer.ts` line 1
- **Plan reference:** plan v1.2 § T5.1 + ADR D7 + Drift-T5.1-3
- **Domain anchor:** testing.md § Pyramid (Unit — pure functions, deterministic, < 50ms); testing.md "What to test — by area"
- **Evidence:**

  No file matches src/**/tiktoken*test*.ts or tests/**/tiktoken*test*.ts:
  ```bash
  $ find . -path "*__tests__*tiktoken*" -o -name "tiktoken*test*"
  (empty)
  ```
  Consumers:
  - benchmarks/scripts/run-longmemeval.ts:126: `new TiktokenTokenizer()`
  - benchmarks/scripts/run-locomo.ts:116: `new TiktokenTokenizer()`
  - benchmarks/scripts/run-dmr.ts:105: `new TiktokenTokenizer()`

- **Recommended action:** Add src/benchmarks/runner/__tests__/tiktoken-tokenizer.test.ts with
4 BDD tests:
1. "counts zero for empty string without invoking encoder"
2. "delegates to cl100k_base when no model name provided"
3. "delegates to encoding_for_model when known model provided"
4. "falls back to cl100k_base when encoding_for_model throws"
5. "releases encoder on free() (idempotent)"
Cost: ~30 lines test. Catches regressions in the silent fallback path.


### F-dom-obs-4: TiktokenTokenizer.free() is invoked in all 3 CLI scripts (run-longmemeval.ts:153,
run-locomo.ts:143, run-dmr.ts:132) AFTER `await runner.run(corpus, queries)`
with no try/finally guard. If runner.run() throws (e.g., adapter throws,
judge panel throws an unexpected non-PricingTableMiss error, or the
EC-9 fs.writeFileSync fails on a permission-denied path), the WASM
encoder allocated by @dqbd/tiktoken is never freed. Per the
tiktoken-tokenizer.ts JSDoc that explicitly mentions "memory leak
prevention", releasing the encoder via .free() IS the contract — but
the contract is unguarded against the happy path.
Note: process exit will reclaim the WASM allocation eventually, so
this is not a production-blocking leak — but for long-running CI
benchmark suites that may invoke multiple runners in sequence (or
under integration tests that import main() and don't terminate the
process between runs), the accumulation is real.


- **Found by:** review-v0-8-independent-benchmark-reproduction-domain-observability
- **File:** `benchmarks/scripts/run-longmemeval.ts` line 152
- **Plan reference:** plan v1.2 § T5.1 — TiktokenTokenizer.free() memory leak prevention
- **Domain anchor:** architecture.md § 8 (Error handling — exceptions never silently swallowed; resources released on failure path)
- **Evidence:**

  ```ts
  // benchmarks/scripts/run-longmemeval.ts:144-154 (no try/finally)
  const runner = new BenchmarkRunner({...});
  const report = await runner.run(corpus, queries);  // <-- may throw
  tokenizer.free();                                  // <-- skipped on throw
  return report;
  ```
  Same shape in run-locomo.ts:134-145 and run-dmr.ts.

- **Recommended action:** Wrap the runner.run() call in try/finally in each of the 3 CLI scripts:
```ts
const tokenizer = new TiktokenTokenizer();
try {
  // ... build adapter, judgePanel, costTracker, runner
  const report = await runner.run(corpus, queries);
  return report;
} finally {
  tokenizer.free();
}
```
Cost: 3 small refactors. Closes the lifecycle contract honored only
on happy path today.


### F-tests-5: EC-2 test asserts abort + sleep + exit-code, but never explicitly verifies
the RETRY happened on the failing query. The test uses
makeJudgePanelAlwaysNull so retry also returns null and abort fires.
There is no positive-path test ("retry succeeds → consecutiveNullCount
reset → run continues"). The runner code (benchmark-runner.ts L116-126)
contains a retry-succeeds branch that is unexercised.


- **Found by:** review-v0-8-independent-benchmark-reproduction-tests
- **File:** `src/benchmarks/runner/__tests__/runner.test.ts` line 311-353
- **Plan reference:** T4.1 EC-2 all-judges-fail policy
- **Evidence:**

  benchmark-runner.ts L116-126 contains:
    if (retryRecord.judgeLabel === null) { abort } else {
      perQuery[perQuery.length - 1] = retryRecord;
      this.persist(perQuery, false);
      consecutiveNullCount = 0;
    }
  grep -n "retry succeed\|retry.*continue" src/benchmarks/runner/__tests__/
  (no matches)

- **Recommended action:** Add a third runner test variant ("retry-succeeds-resets-counter") with a
configurable JudgePanel that returns null 3× then CORRECT on retry of Q3;
assert (a) report.aborted === false, (b) perQuery[2].judgeLabel ===
'CORRECT' (the retry result replaces the original null), (c)
consecutiveNullCount reset (drive a 4th null and verify abort does NOT
fire until 3 more in a row).


### F-tests-6: EC-13 absorption ships `emitStaleWarning` + 30-day sunset check, but no
test asserts the warning is emitted. The runner test only checks
tracker.fetchedAt() format (L105-108). The stale-warning code path is
effectively dead from a test perspective; a regression that disables the
warning would not be caught.


- **Found by:** review-v0-8-independent-benchmark-reproduction-tests
- **File:** `src/benchmarks/runner/cost-tracker.ts` line 79-95
- **Plan reference:** T4.1 EC-13 pricing-table stale documentation
- **Evidence:**

  grep -rn "isStale\|emitStaleWarning\|SUNSET_DAYS" src/benchmarks/runner/__tests__/
  (no matches)
  cost-tracker.ts L84: emitStaleWarning called from constructor when
  isStale(this.table.fetched_at, config.now)

- **Recommended action:** Add a unit test that (a) writes a temporary pricing-table.json with
fetched_at = 60 days ago, (b) captures process.stderr writes, (c)
instantiates `new CostTracker({ tokenizer, pricingTablePath: tmpPath,
now: new Date() })`, (d) asserts the warning string was emitted with the
stale date. Symmetric test for fresh-pricing-no-warning.


### F-tests-7: withSpan sets 3 attributes (benchmark.adapter, benchmark.method,
benchmark.question_id) but the runner test only asserts span name
(`benchmark.add`, `benchmark.search`). The attributes drive downstream
P95-by-adapter analysis; a regression that drops the adapter attribute
would not be detected by tests.


- **Found by:** review-v0-8-independent-benchmark-reproduction-tests
- **File:** `src/benchmarks/runner/__tests__/runner.test.ts` line 196-235
- **Plan reference:** T4.1 ADR D8
- **Evidence:**

  runner.test.ts L231-234 only checks span.name match.
  otel-instrumented.ts L30-33 sets adapter/method/question_id attributes.

- **Recommended action:** Strengthen the OTel span test to assert
`span.attributes['benchmark.adapter'] === 'themory'` +
`span.attributes['benchmark.question_id'] === 'q1'` for the search span.
InMemorySpanExporter exposes attributes via `.attributes`.


### F-tests-8: 10 test names use "and" — testing.md anti-pattern lists "Tests with 'and'
in the name — split into two tests, each testing one thing". Examples:
`runs the LoCoMo smoke fixture end-to-end and produces a RunReport`,
`catches PricingTableMiss and persists pricing_table_miss flag (EC-3)`,
`is case-insensitive and strips common punctuation`,
`aggregates 2 disagreeing judges and surfaces the split in agreement`,
`embeds the question, gold answer, and generated answer in the user
message`. Several are idiomatic phrasing (`leading and trailing
whitespace`) — not all warrant splitting.


- **Found by:** review-v0-8-independent-benchmark-reproduction-tests
- **File:** `multiple — testing rule § Anti-patterns` line various
- **Plan reference:** testing.md § Anti-patterns ("no 'and' in test names")
- **Evidence:**

  $ grep -rnE "it\(['\"].*\sand\s.*['\"]" src/benchmarks/ tests/e2e/benchmarks/
  (10 matches enumerated in the agent transcript)

- **Recommended action:** For the ones that genuinely test two behaviors (PricingTableMiss + persist
flag; judge-panel disagreement + split surface; smoke run + report
produced), split into 2 separate `it()` blocks. For idiomatic phrasing
(`leading and trailing whitespace`), accept as-is — testing.md anti-
pattern is about scope, not literal token.


### F-tests-9: The "LLM throws" test uses FailingLlm but doesn't assert that the error
was actually caught at the judge boundary (rather than bubbling up). The
test just checks the outcome is null; that's structurally correct but
doesn't distinguish "judge returned null because LLM threw" from "judge
returned null because LLM returned malformed string". Per testing.md §
BDD: "tests describe behavior" — currently the test couples two
independent null-paths and the regression signal is muddied.


- **Found by:** review-v0-8-independent-benchmark-reproduction-tests
- **File:** `src/benchmarks/llm-judge/__tests__/single-judge.test.ts` line 50-54
- **Plan reference:** T1.2 EC-2 (network failure null)
- **Evidence:**

  single-judge.test.ts L43-48 (malformed response) and L50-54 (LLM throws)
  both end with `expect(outcome).toBeNull()` with no other distinguisher.

- **Recommended action:** Either (a) split the FailingLlm test to also assert
`expect(loggerSpy).toHaveBeenCalledWith(expect.stringMatching(/LLM
error/))` — confirming the catch-and-log path; OR (b) assert the
rawResponse field captured `null` (or some sentinel) when the error path
is taken vs the literal raw string when the parse path is taken. Today
both return null indistinguishably.



## INFO findings (1)

### F-tests-10: ADR D3 guard test scans src/benchmarks/llm-judge/*.ts (excluding
*.test.ts). The plan-level invariant per ADR D3 § "Consequences" is "NO
new SDK deps for claude access" — the guard should arguably scan
src/benchmarks/**/*.ts (all benchmark code, including future runner /
adapter additions), not just llm-judge/. Today an adapter could import
@anthropic-ai/sdk and the guard would NOT detect it.


- **Found by:** review-v0-8-independent-benchmark-reproduction-tests
- **File:** `src/benchmarks/llm-judge/__tests__/no-anthropic-sdk.test.ts` line 32
- **Plan reference:** ADR D3 regression guard
- **Evidence:**

  no-anthropic-sdk.test.ts L18: SRC_DIR = dirname(dirname(...)) → resolves
  to src/benchmarks/llm-judge/ only.

- **Recommended action:** Widen the scan to walk src/benchmarks/ recursively via `glob`
(`src/benchmarks/**/*.ts` excluding *.test.ts + *.test-d.ts). Keeps the
regression guard robust against future surface expansion. Optional —
could be deferred since current scope is correct for the modules that
ship today.



## Quality gates (re-validated against HEAD `b67035f`)

| Gate | Result | Threshold | Notes |
|---|---|---|---|
| `npm test` | 800 PASS / 8 skipped (102 files PASS / 2 skipped) | zero failures | 6 of the 8 skips trace to F-tests-1 BLOCKER (bleu.test.ts `describe.skipIf`); 2 + 1 benchmark skip are legitimate env-var gates |
| `npm run typecheck` | zero errors | zero errors | clean |
| `npm run lint` | zero warnings | zero warnings (tighter than /implement's "fewer than before") | clean |
| `npm run test:benchmark` | 12 PASS / 1 skipped (4 files) | zero failures | matches T8.2 THE FINAL GOAL TEST PASS |
| `matrix-publication.test.ts` | PASS | required | structurally validates 12 cells but does NOT validate real-number sub-metrics (per Drift-T8.x-1, accepts Smoke OR Deferred+DriftRef) |
| Coverage critical paths | not measured this cycle | 100% (cycle-review tighter than /implement's 90%) | T-final reported 100% for critical paths in /implement validation; not re-measured here |

## Edge-case coverage analysis

`edge_case_coverage.py` heuristic over-extracted bullets from plan v1.2 (21 bullets but most are DoD entries / paragraph text, not real edge cases). Manual cross-check against the 14 absorbed edge cases (EC-1..EC-14):

| EC | Description | Test exists | Status |
|---|---|---|---|
| EC-1 | json-extractor robust JSON parse + null fallback | `src/benchmarks/llm-judge/__tests__/json-extractor.test.ts` | covered |
| EC-2 | All-judges-fail policy (3 nulls → 60s + retry → abort) | `src/benchmarks/runner/__tests__/runner.test.ts:350` | covered |
| EC-3 | PricingTableMiss typed error → cost=NaN | `src/benchmarks/runner/__tests__/runner.test.ts:306` | covered |
| EC-4 | vitest.benchmark.config.ts 60-min testTimeout | config file ships | covered (config-level) |
| EC-5 | scopedUserId per speaker | `src/benchmarks/themory/__tests__/adapter.test.ts` | covered |
| EC-6 | TypeScript downloader Node 20 fetch (macOS-portable) | **NO TEST** (F-tests-3 MAJOR) | missing |
| EC-7 | BLEU empty-string handling | bleu.test.ts L31-46 (silently SKIPPED — F-tests-1) | covered structurally / NEVER RUNS |
| EC-8 | Idempotent downloader | **NO TEST** (F-tests-3 MAJOR) | missing |
| EC-9 | Runner partial-results incremental persist | `runner.test.ts` partial-results assertion | covered |
| EC-10 | Inter-judge agreement N=1 | `inter-judge-agreement.test.ts` | covered |
| EC-11 | Zero-token cost-tracker (return 0) | `cost-tracker.test.ts` | covered |
| EC-12 | Robust markdown-table parser | `matrix-publication.test.ts` parser logic | covered |
| EC-13 | Pricing-table staleness warning | doc note inlined (no observable assertion) | partial |
| EC-14 | Env-var-skip-clean already-established | implicit via describe.skipIf pattern | covered |

**Coverage:** 11/14 fully covered, 1 partial (EC-13), 2 missing (EC-6, EC-8). Of the 11 "covered" rows, **EC-7 (BLEU empty-string) is structurally covered but never actually runs** due to F-tests-1 BLOCKER.

## Cross-validation summary

Per the cross-validation reviewer (opus-class depth):

| Metric | Value |
|---|---|
| Plan task IDs | 14 (T0.1 → T8.2 + T-final) |
| Fully implemented | 14 (all `committed` per progress JSON) |
| Partial / Missing / Diverged | 0 / 0 / 0 |
| ADRs honored (D1-D9) | 9/9 |
| @anthropic-ai/sdk imports across `src/benchmarks/` + `benchmarks/scripts/` + `package.json` | 0 (D3 v1.2 invariant verified by independent grep) |
| Plan drift | none (plan frozen 20 min before /implement started; never amended mid-cycle) |
| Plan-Driven Corrections (drifts MORE HONEST than literal plan text) | 2 (Drift-T5.1-1 SearchResult.modelUsed added mid-cycle; Drift-T8.x-1 structural-marker assertion contract — both documented in commit messages + methodology doc + v0.8.md drift trail) |
| **Goal contract honesty call** | **HONEST RESIDUAL SCOPE per Inquebrável Rule 3** (3 Smoke + 9 Deferred+DriftRef markers; /dogfood gate independently blocks production-ready claim regardless) |

## Verdict synthesis

**Verdict: NEEDS_FIXES** — merge cannot proceed until the BLOCKER is resolved.

**Root-cause classification of the BLOCKER:**

F-tests-1 is the same family of defect as Inquebrável Rule 3 violations: the code claims a capability (BLEU computation per ADR D1) that doesn't actually execute. The combination of (a) `describe.skipIf` masking the unavailability, (b) `loadNaturalBleu()` silently caching `null`, (c) `calculateBleuScore()` returning `0` on null path, and (d) the runner consuming `0` and writing it to results, produces a benchmark pipeline that silently corrupts the BLEU column. This violates the plan's Goal (defensible benchmark publication) and the project's honesty discipline ("if a column would silently be wrong, mark it Deferred — Drift-*").

The implementation either needs to:
- **Option A (preferred, cycle-implement scope):** repair the `natural` v8 BLEU API call (verify the actual export name) + add a non-skipped canary assertion `BLEU(identical) > 0.9` + remove `describe.skipIf` so the test FAILS loudly if the library API ever shifts again. Estimated 1 small task in a follow-up cycle.
- **Option B:** vendor a minimal BLEU-1 implementation (~30 LoC) per Inquebrável Rule 9 trade-off — eliminates external dep entirely.
- **Option C (honest deferral, acceptable):** mark BLEU column as `Deferred — Drift-T1.1-1 (natural BLEU API mismatch)` in `docs/benchmarks/v0.8.md`, downgrade T1.1's BLEU acceptance criterion, replace with F1+EM in the smoke matrix. Same honesty model as Drift-T6.x-1. Requires `bleu.ts` to throw on initialization rather than silently fall through to `0`, AND the matrix-publication test to assert the BLEU column shows the Deferred marker.

**MAJOR findings — must-address before merge OR formally dismissed via ADR:**

| ID | Severity | Summary | Action |
|---|---|---|---|
| F-arch-1 | MAJOR | Tokenizer DIP has 5 consumers (rule-of-three crossed); should promote to `src/core/dip/tokenizer.ts` (11th DIP). Drift-T4.1-1 ("2 consumers") is now stale | Fix-up cycle: promote Tokenizer; OR explicit Drift-T4.1-2 marker updating rationale |
| F-arch-2 | MAJOR | 3 runner scripts duplicate ~250 LoC (StubAnswerLlm + buildSmokeJudgePanel + OTel setup + main scaffold) | Fix-up cycle: extract `benchmarks/scripts/_runner-scaffold.ts` |
| F-arch-3 | MAJOR | Integration test `reset()` filters by `agent_id` but adapter writes `user_id`; silent isolation defect (would flake on 2nd test) | Fix in same fix-up cycle as F-tests-1; trivial column rename |
| F-tests-2 | MAJOR | `buildSmokeJudgePanel` hardcodes ALL judge responses to CORRECT; smoke e2e never exercises WRONG path | Fix-up cycle: parameterize stub to emit a WRONG ≥ 1 sample |
| F-tests-3 | MAJOR | 2 RED tests for downloader (EC-6 macOS portability + EC-8 idempotency) absent | Fix-up cycle: add 2 lightweight tests with mocked fetch |
| F-tests-4 | MAJOR | 4 integration test files declared, only 1 ships | 3 of 4 mitigated by Drift-T6.x-1 (vendor adapters deferred); `runner-integration.test.ts` absorbed into T5.1 smoke — needs Drift-T4.1-3 marker (per F-xval-3 INFO) |
| F-dom-obs-1 | MAJOR | `process.exitCode = 1` mutation in library code (architectural family of iter-7 setGlobalTracerProvider regression) | Fix-up cycle: move to CLI `.then()` blocks |
| F-dom-obs-2 | MAJOR | `result-aggregator.ts` JSDoc claims P95 from OTel span durations but reads adapter-self-reported `latencyMs` | Fix-up cycle: rewrite JSDoc to honest signal OR change source to OTel spans |
| F-xval-1 | MAJOR | LongMemEval loader chose `JSON.stringify` fallback over plan's `throw new InvalidFixtureFormat` | Fix-up cycle: surface as Drift-T2.1-2 marker (documentation-only) |
| F-xval-2 | MAJOR | T8.2 FINAL GOAL TEST assertion contract shifted from 5-sub-metric-per-cell to structural-honesty-marker | Already documented as Drift-T8.x-1; this finding requests an explicit Drift-T8.x-2 marker linking it to the Drift-T5.1-1 family. Defensible Plan-Driven Correction |

**MINOR + INFO findings:** 9 + 1 — see detailed sections above; absorb opportunistically.

## Handoff decision

**HALT — DO NOT MERGE.** Merge blocked by F-tests-1 BLOCKER.

Recommended next cycle:

1. **`/to-plan v0-8-fixes-cycle-1`** absorbing:
   - F-tests-1 BLOCKER (decide Option A / B / C above)
   - F-arch-3 (test-isolation column rename — trivial, batchable)
   - F-tests-2, F-tests-3 (smoke discipline + downloader RED tests)
   - F-dom-obs-1 (process.exitCode relocation)
   - F-dom-obs-2 (P95 JSDoc/source alignment)
   - F-xval-1, F-xval-2 (honest drift markers — documentation)
   - **Strategic question for plan author:** F-arch-1 (Tokenizer 11th DIP promotion) and F-arch-2 (`_runner-scaffold.ts` extraction) are real refactors with semantic risk — bundle in this fix-up cycle, OR defer to a separate `v0-8-architecture-debt` cycle? Per cycle-plan SKILL `--depth=light` confidence assessment.

2. **`/edge-case-plan` → `/deps-audit` → `/plan-confidence`** chain on the fix-up plan.

3. **`/implement`** halt-loop on fix-up plan.

4. **`/review`** re-run (this skill) on the resulting fix-up branch.

5. Only on `/review` re-run returning `READY_TO_MERGE`: open PR `develop → main` for the v0.8 release.

**Independent gate still blocking v1.0:** `/dogfood` returns `EVIDENCE_INSUFFICIENT` per audit `6f7ff87` (2026-05-31). Even after v0.8 fixes land, row 11 (v1.0 — `production-ready`) requires anchor scenario "Claude Code auto-memory backed by TheMemory" running ≥ 30 days with evidence logs. v0.8 only addresses row 11(a) "Item 10 reproduced independently with verifiable artifacts" — and only partially per Drift-T6.x-1 (vendor SDKs deferred).

## Audit trail

Spawned agents (their findings files live alongside this report):

- `.claude/agents/review-v0-8-independent-benchmark-reproduction-2026-06-02/architecture.md`
- `.claude/agents/review-v0-8-independent-benchmark-reproduction-2026-06-02/cross-validation.md`
- `.claude/agents/review-v0-8-independent-benchmark-reproduction-2026-06-02/review-v0-8-independent-benchmark-reproduction-domain-memory-layer.md`
- `.claude/agents/review-v0-8-independent-benchmark-reproduction-2026-06-02/review-v0-8-independent-benchmark-reproduction-domain-observability.md`
- `.claude/agents/review-v0-8-independent-benchmark-reproduction-2026-06-02/review-v0-8-independent-benchmark-reproduction-tests.md`
- `.claude/agents/review-v0-8-independent-benchmark-reproduction-2026-06-02/wiring.md`
