# SEPA Pre-RED Brief — iteration 5, T3.1, MODE=VERBOSE

**Task:** T3.1 TheMemoryBenchmarkAdapter
**Verdict:** PROCEED to RED with 4 drifts documented

## Drifts (plan sketch was 80% correct; 4 mechanical gaps surfaced)

1. **Drift-T3.1-1** — Constructor widened from `(memory, tokenizer)` to `({memory, llm, tokenizer})` config object. Plan sketch line 600 calls `this.llm.generateChat` but constructor at line 570 only declared `(memory, tokenizer)`. Without LLM injection adapter can't synthesize answers from retrieved context.
2. **Drift-T3.1-2** — `metadata` coercion helper at DIP exit. `BenchmarkCorpusItem.metadata: Readonly<Record<string, unknown>>` is incompatible with `RememberOptions.metadata: Readonly<Record<string, string|number|boolean|null>>`. Coerce-not-drop via JSON.stringify fallback for nested values.
3. **Drift-T3.1-3** — `Tokenizer` DIP interface declared inline in adapter.ts (NOT yet promoted to src/core/dip/). Single method `count(text: string): number`. T4.1 will promote when tiktoken impl + 2nd consumer arrive (Rule-of-3).
4. **Drift-T3.1-4** — Cross-speaker dedup-by-id in `search()` merge. Plan sketch sorted but did not dedupe; defensive depth at no cost.

## Implementation shape locked (per SEPA)

```ts
constructor(config: {memory: Memory, llm: LLM, tokenizer: Tokenizer})
private scopedUserId(conversationId, speaker?) — EC-5 absorbed
async add(corpus) — loops items, coerceMetadata, memory.user(scopedUserId).remember()
async search(query) — multi-speaker loop, dedup-by-id, sort score desc, slice 30, llm.generateChat for answer
```

## Test plan
- 13 unit tests with createLocalMemory({StubEmbedder, StubLLM, InMemoryVectorStore}) + StubTokenizer
- 1 PG integration test gated on PG_URI

## Wiring
- (a) static caller: ADR-DEFER-WIRING-A → T4.1 runner
- (b) integration: covered at unit + PG integration
- (c) runtime metric: n/a at T3.1

## No-paper-names check
- "Mem0" usage: only in commit message + sepa-iterations log + docstring rationale for cross-speaker absent in single-judge Mem0 baseline. JSDoc should describe BEHAVIOR not paper names. SEPA recommends keeping references minimal (vendor-name enumeration matching vector-store.ts precedent OK; "anti-Mem0 single-judge" form in JSDoc body NOT OK per § Anti-patterns).
