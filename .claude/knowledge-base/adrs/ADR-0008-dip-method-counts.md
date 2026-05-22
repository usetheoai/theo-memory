# ADR-0008: DIP method counts (VectorStore 11, LLM 2, Embedder 2, HistoryManager 4+3, ReflectionPolicy 1+2)

- **Status:** Accepted
- **Date:** 2026-05-22
- **Plan:** [`memory-contract-v0-0-plan.md`](../plans/memory-contract-v0-0-plan.md) § ADRs § D8
- **Owner:** TheMemory v0.0 contract design
- **Resolves:** Roadmap Item 1 acceptance criterion ("4 DIP interfaces declared with method counts fixed")

## Context

DIP (Dependency Inversion Principle) interfaces define the seams between `src/core/` (the domain logic) and the adapters in `src/local/` and `src/cloud/` (runtime implementations). The interfaces' exact method counts determine:

- How portable adapters are from Mem0's reference (`referencia/mem0/mem0-ts/src/oss/src/{storage,vector_stores,llms,embeddings}/base.ts`)
- ISP compliance: are consumers forced to depend on methods they don't call?
- Forward-compat surface: each new method is a new contract obligation for every implementer

Roadmap Item 1 acceptance criterion says: "4 DIP interfaces declared (VectorStore, LLM, Embedder, HistoryManager) with method counts to be fixed in the contract spec." This ADR is that fix.

`ReflectionPolicy` is a fifth DIP introduced by ADR-0005; this ADR fixes its shape too.

## Decision

Lock the five DIP surfaces at the following method counts (verified against `referencia/mem0/mem0-ts/src/oss/src/`):

### Embedder (2 required)

```ts
export interface Embedder {
  embed(text: string): Promise<ReadonlyArray<number>>;
  embedBatch(texts: ReadonlyArray<string>): Promise<ReadonlyArray<ReadonlyArray<number>>>;
}
```

Source-of-truth: `referencia/mem0/mem0-ts/src/oss/src/embeddings/base.ts` (verified to exist; 5 LoC).

### LLM (2 required)

```ts
export interface LLM {
  generateResponse(
    messages: ReadonlyArray<Message>,
    responseFormat?: { readonly type: 'json' | 'text' },
    tools?: ReadonlyArray<unknown>,
  ): Promise<unknown>;
  generateChat(messages: ReadonlyArray<Message>): Promise<LLMResponse>;
}
```

Notes:
- `Role` tightened to `'system' | 'user' | 'assistant'` (Mem0 uses `string`; ours is narrower).
- `tools` is DELIBERATELY opaque (`ReadonlyArray<unknown>`) at v0.0. v0.3 (agent-tools layer) locks a typed tool schema — at that point this DIP gains a generic parameter `LLM<TToolShape>`. JSDoc on the field documents the forward-compat path (EC-10).
- `generateResponse` return is `unknown` because providers return varying shapes; the LLM adapter normalizes at v0.1.

Source-of-truth: `referencia/mem0/mem0-ts/src/oss/src/llms/base.ts` (verified to exist; 20 LoC).

### VectorStore (11 required)

```ts
export interface VectorStore {
  initialize(): Promise<void>;
  insert(
    vectors: ReadonlyArray<ReadonlyArray<number>>,
    ids: ReadonlyArray<string>,
    payloads: ReadonlyArray<Record<string, string | number | boolean | null>>,
  ): Promise<void>;
  search(
    query: ReadonlyArray<number>,
    topK?: number,
    filters?: Filters,
  ): Promise<ReadonlyArray<VectorStoreResult>>;
  keywordSearch(
    query: string,
    topK?: number,
    filters?: Filters,
  ): Promise<ReadonlyArray<VectorStoreResult> | null>;
  get(vectorId: string): Promise<VectorStoreResult | null>;
  update(
    vectorId: string,
    vector: ReadonlyArray<number>,
    payload: Record<string, string | number | boolean | null>,
  ): Promise<void>;
  delete(vectorId: string): Promise<void>;
  deleteCol(): Promise<void>;
  list(
    filters?: Filters,
    topK?: number,
  ): Promise<readonly [ReadonlyArray<VectorStoreResult>, number]>;
  getUserId(): Promise<string>;
  setUserId(userId: string): Promise<void>;
}
```

Notes:
- `keywordSearch` is REQUIRED in our contract (Mem0 makes it optional). BM25 fallback is part of the nine-step search (ADR-0001). An adapter that genuinely cannot support BM25 returns `null` to opt out — but the method MUST be present.
- `payload` type tightened from Mem0's `Record<string, any>` to typed primitives. Aligns with `MemoryItem.metadata`.
- `update` exists on `VectorStore` but NOT on the public `Memory` surface (ADR-0003) — internal-only, used by reflection / consolidation paths to refresh vectors.
- `getUserId / setUserId` are SESSION METADATA (Mem0 telemetry parity), NOT tenant-isolation keys. Tenant isolation always uses `Filters` (EC-6 from edge-case review). JSDoc on the methods documents this.

Source-of-truth: `referencia/mem0/mem0-ts/src/oss/src/vector_stores/base.ts` (verified to exist; 35 LoC).

### HistoryManager (4 required + 3 optional)

```ts
export interface HistoryManager {
  addHistory(
    memoryId: string,
    previousValue: string | null,
    newValue: string | null,
    action: 'remember' | 'forget' | 'reflect',
    createdAt?: Date,
    updatedAt?: Date,
    isDeleted?: boolean,
  ): Promise<void>;
  getHistory(memoryId: string): Promise<ReadonlyArray<HistoryEntry>>;
  reset(): Promise<void>;
  close(): void;

  // Optional (V3 messages — only when backend supports session-scoped chat log):
  saveMessages?(messages: ReadonlyArray<Message>, sessionScope: string): Promise<void>;
  getLastMessages?(sessionScope: string, limit?: number): Promise<ReadonlyArray<Message & { readonly createdAt: Date }>>;
  batchAddHistory?(records: ReadonlyArray<HistoryBatchRecord>): Promise<void>;
}
```

Notes vs Mem0:
- `action` is a string-union, not `string` (tighter at compile time).
- `isDeleted: boolean` not `number`.
- `createdAt` / `updatedAt` are `Date` not `string` (parsed at the adapter boundary).

Source-of-truth: `referencia/mem0/mem0-ts/src/oss/src/storage/base.ts` (verified to exist; 37 LoC).

### ReflectionPolicy (1 required + 2 optional)

```ts
export interface ReflectionPolicy {
  shouldReflect(scope: Scope, trigger: ReflectionTrigger): Promise<boolean>;
  onReflectionStart?(scope: Scope, options: ReflectOptions): Promise<void>;
  onReflectionEnd?(scope: Scope, result: ReflectionResult | Error): Promise<void>;
}
```

New DIP introduced by ADR-0005 (no Mem0 equivalent — Mem0 doesn't ship reflection).

## Consequences

**Positive:**

- Mem0-ts adapters port with minimal adaptation. The pgvector adapter at `referencia/mem0/mem0-ts/src/oss/src/vector_stores/pgvector.ts` ships 11 methods that map 1:1 onto our surface.
- ISP compliance: optional methods on `HistoryManager` are the right shape — not every backend supports V3 message history. Same logic on `ReflectionPolicy`.
- v0.5 cloud adapter is bounded by the same surface — no scope creep into adapter-specific methods leaking into core.
- DIP boundary is enforced by `.claude/hooks/boundary-check.sh` (architecture.md § 3).

**Negative:**

- Any divergence from Mem0's signatures will hurt portability. Adapters from third parties may need rewrites.
- Introducing a sixth DIP later (e.g., `ReflectionWorker` for distributed reflection) is a contract change at v1.x.
- The 11-method `VectorStore` surface is large by ISP standards. Splitting it (e.g., `VectorReadStore` + `VectorWriteStore`) would be more ISP-pure but breaks portability from Mem0.

**Reversibility:**

- Adding methods to optional sections (`HistoryManager?` slot, `ReflectionPolicy?` slot) is backward-compatible.
- Removing or renaming REQUIRED methods is breaking.
- Tightening optional → required is breaking for existing implementers.

## Alternatives

| Alternative | Verdict | Why rejected |
|---|---|---|
| **Smaller `VectorStore` surface** (5 methods: init / insert / search / get / delete) | Rejected | Mem0's pgvector adapter needs `list / update / getUserId / setUserId` for tenant isolation + maintenance ops. Forcing adapters to subclass and add these is worse than declaring them required. |
| **Folded `Embedder` into `LLM`** (single provider abstraction) | Rejected | Embeddings and chat-completion are operationally separate (different rate limits, different SLAs, often different providers). Conflating them couples the bills together. |
| **More restrictive `tools` type at v0.0** (e.g., Zod schema) | Rejected | v0.3 agent-tools layer hasn't locked the tool schema yet. Premature constraint. `unknown` + JSDoc forward-compat note is the right call. |
| **Drop `keywordSearch` from required, make it optional** (Mem0's choice) | Rejected | Nine-step search REQUIRES BM25 fallback. An adapter that can't support it returns `null`; the method MUST exist. |

## References

- `.claude/rules/architecture.md § 3 Dependency direction` — DIP boundary enforcement.
- ADR-0001 (Mem0-shape — these surfaces are part of the "Adopt" list).
- ADR-0003 (no public `update` — `VectorStore.update` is internal-only).
- ADR-0005 (`ReflectionPolicy` introduction).
- `referencia/mem0/mem0-ts/src/oss/src/embeddings/base.ts`
- `referencia/mem0/mem0-ts/src/oss/src/llms/base.ts`
- `referencia/mem0/mem0-ts/src/oss/src/vector_stores/base.ts`
- `referencia/mem0/mem0-ts/src/oss/src/storage/base.ts`
- Global CLAUDE.md PARTE II § 13.4 ISP — optional methods justified.
