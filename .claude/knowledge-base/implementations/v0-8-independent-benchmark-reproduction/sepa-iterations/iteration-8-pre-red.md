# SEPA Pre-RED Brief — iteration 8, T6.1+T6.2+T6.3 BATCHED, MODE=TIGHT

**Tasks:** T6.1 Mem0BenchmarkAdapter + T6.2 ZepBenchmarkAdapter + T6.3 LettaBenchmarkAdapter
**Verdict:** PROCEED with DIP-interface-only design

## Design decision (locked)

Each adapter ships with a thin VendorClient interface (Mem0VendorClient / ZepVendorClient / LettaVendorClient) that the adapter consumes via DI. Unit tests inject stub clients. Real SDK wiring (`mem0ai`, `@getzep/zep-cloud`, Letta REST) is deferred to a follow-up cycle — scope keeps T6.x focused on protocol validation (BenchmarkAdapter pattern) without forcing 3 new vendor SDK deps into the audit surface.

**Rationale:**
1. v0.8 protocol shape is the load-bearing concern (T0.1 DIP). T6.x validates the Protocol works for non-TheMemory adapters too — that's the SOLID/OCP test.
2. Adding 3 vendor SDKs (mem0ai, @getzep/zep-cloud, no official Letta JS SDK) inflates the dep audit surface significantly. Each SDK has its own transitive CVE potential. Deferring keeps /deps-audit clean for the Phase 6 commit.
3. The real SDK wiring will land in a v0.8-vendor-clients follow-up cycle where each Vendor*Client is implemented + integration-tested against real keys. This is a `Known-Limitation-T6.x-1` in the implementation md.
4. EC-14 already established: integration tests use describe.skipIf when env vars absent; same pattern applies to vendor adapter integration tests.

## Drift documented
- **Drift-T6.x-1**: vendor SDK wiring (real Mem0/Zep/Letta client impls) deferred to follow-up cycle. T6.x ships the BenchmarkAdapter shape + a placeholder StubVendorClient that returns deterministic responses. Acceptable per:
  - Plan T6.x acceptance: "Per-adapter integration tests skip cleanly when env var absent" — the test layer handles env-var gating.
  - Plan ADR D1: "own the runner, adopt only metric libs" — vendor SDK adoption stays at the wire-up layer, not the Protocol layer.
  - Plan acceptance row 8 ("All 3 adapters implement same BenchmarkAdapter interface") — fully satisfied.

## Shape of each adapter (uniform across 3)

```ts
export interface {Vendor}VendorClient {
  add(userId: string, text: string): Promise<void>;
  search(userId: string, query: string, topK: number): Promise<readonly {text: string; score: number}[]>;
  synthesize(question: string, context: readonly string[]): Promise<string>;
}

export interface {Vendor}BenchmarkAdapterConfig {
  readonly client: {Vendor}VendorClient;
  readonly tokenizer: Tokenizer;
  readonly modelId?: string;
}

export class {Vendor}BenchmarkAdapter implements BenchmarkAdapter {
  readonly name = '{vendor}';
  // add: loop items, call client.add(corpus.conversationId, item.text)
  // search: client.search() → client.synthesize() → return SearchResult with modelUsed
}
```

## File list (per adapter — 3 × 2 = 6 files)
- src/benchmarks/mem0/adapter.ts (NEW)
- src/benchmarks/mem0/__tests__/adapter.test.ts (NEW; stub client)
- src/benchmarks/zep/adapter.ts (NEW)
- src/benchmarks/zep/__tests__/adapter.test.ts (NEW)
- src/benchmarks/letta/adapter.ts (NEW)
- src/benchmarks/letta/__tests__/adapter.test.ts (NEW)

Integration tests (gated on env vars) deferred to vendor-clients follow-up.

## ADR D3 invariant
No @anthropic-ai/sdk in any T6.x adapter. ADR D3 regression guard at T1.2 only scoped src/benchmarks/llm-judge/; T6.x adopts the same discipline (verify via grep before commit).

## Wiring
- (a) static caller: ADR-DEFER-WIRING-A → T7.1/T7.2 runner scripts + future vendor-clients follow-up
- (b) integration test: each adapter has unit tests with stub vendor client; real-SDK integration deferred
- (c) runtime metric: n/a at T6.x (runner emits OTel; adapters just satisfy Protocol)

## Test plan (per adapter — 5 tests each = 15 total)
1. add() returns itemCount + latencyMs
2. add() forwards items to client.add() with conversationId as userId
3. search() invokes client.search + client.synthesize and returns SearchResult shape
4. search() surfaces injected modelId via modelUsed (Drift-T5.1-1 honored)
5. exposes adapter name correctly
