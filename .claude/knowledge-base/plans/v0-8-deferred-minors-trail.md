# v0.8.x deferred MINORs trail

> Accumulator for MINOR findings deferred across v0.8.x fix-up cycles. Per ADR D8 of `v0-8-fixes-cycle-1`: every deferred MINOR MUST be tracked here with a sunset date ≤ 90 days. Without this file, MINORs fall off the radar between cycles.
>
> Reviewed at every v0.8.x re-`/review` AND every `/dogfood` cycle to ensure no entry has crossed its sunset.

## Active entries

### F-dom-mem-2 — `coerceMetadata` undefined-edge in `themory/adapter.ts`

- **Source:** `/review v0-8-independent-benchmark-reproduction-review-2026-06-02.md` § domain-memory-layer
- **Surface:** `src/benchmarks/themory/adapter.ts:54-66`
- **Description:** `coerceMetadata()` has incomplete type-guard: explicit `undefined` values fall through to `JSON.stringify(undefined) === undefined`, then get assigned to a field typed as `PrimitiveMetadataValue` (which excludes undefined). The contract is silently broken at the type level.
- **Bounded-impact rationale:** at v0.8 acceptance time, all fixture loaders (longmemeval, locomo, dmr) use `coerceFieldToString` which always returns a string before metadata coercion. No call site empirically reaches the broken path.
- **Deferred date:** 2026-06-02
- **Sunset:** 2026-09-02 (90 days)
- **Suggested fix sketch:** add `if (v === undefined) continue;` OR coerce to `null` at the top of the for-loop in `coerceMetadata`. ~2 LoC change.

### F-dom-obs-3 — `tiktoken-tokenizer.ts` fallback-path test coverage

- **Source:** `/review v0-8-independent-benchmark-reproduction-review-2026-06-02.md` § domain-observability
- **Surface:** `src/benchmarks/runner/tiktoken-tokenizer.ts`
- **Description:** the fallback path (when `encoding_for_model` throws for an unknown model) is not directly unit-tested; it relies on integration coverage where unknown model ids are passed.
- **Bounded-impact rationale:** the cl100k_base fallback is exercised indirectly via runner unit tests that pass non-OpenAI model ids. A direct test would tighten the contract but no current regression risk.
- **Deferred date:** 2026-06-02
- **Sunset:** 2026-09-02
- **Suggested fix sketch:** add a unit test asserting `new TiktokenTokenizer('claude-3.5-sonnet')` falls back to `cl100k_base` without throwing + counts tokens > 0.

### F-dom-obs-4 — `tokenizer.free()` not in `try/finally` in 3 CLI scripts

- **Source:** `/review v0-8-independent-benchmark-reproduction-review-2026-06-02.md` § domain-observability
- **Surface:** `benchmarks/scripts/_runner-scaffold.ts` after T3.2 extraction (was in 3 individual run-*.ts pre-T3.2)
- **Description:** in `runBenchmark`, `tokenizer.free()` is called after `runner.run()` resolves. If the run throws, the WASM tokenizer encoder is never freed (memory leak on error path).
- **Bounded-impact rationale:** smoke runs are fast (< 1 minute); the test process exits shortly after a thrown error, OS cleans up. The leak does not accumulate across runs.
- **Deferred date:** 2026-06-02
- **Sunset:** 2026-09-02
- **Suggested fix sketch:** wrap the runner call in `try { ... } finally { tokenizer.free(); }`. ~3 LoC change.

## Process notes

- Adding a new entry: include `source` (review report path), `surface` (file:line), `description`, `bounded-impact rationale`, deferred date, sunset (today + 90 days max), fix sketch.
- Removing an entry: either the MINOR was absorbed in a follow-up cycle (mark the absorbing cycle/commit) OR the sunset passed (re-fire at original severity in the next `/review`).
- A 90-day sunset is the absolute maximum per ADR D8. Shorter is fine.

## Cross-reference

- Process owner: `v0-8-fixes-cycle-1` plan v1.3 ADR D8
- Reviewed at: every v0.8.x `/review` + every `/dogfood` cycle
- Allowlist precedent: `.claude/rules/deps-audit-allowlist.txt` (same sunset discipline)
