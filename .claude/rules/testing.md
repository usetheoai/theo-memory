---
paths:
  - "src/**/*.ts"
  - "src/**/*.tsx"
  - "src/**/*.test.ts"
  - "src/**/*.test.tsx"
  - "tests/**/*.ts"
---

# Testing Rules — @usetheo/memory

These rules are scoped to source and test files. Read them whenever you touch a `.ts`/`.tsx` under `src/` or `tests/`. They complement the global TDD discipline in `/home/paulo/.claude/CLAUDE.md` § PARTE I-7 and the root-level Inquebrável Rule 5.

## Core rule — TDD + BDD são obrigatórios

- **TDD (Test-Driven Development)** is the working method, not a preference.
- Every non-trivial logic change needs a test or an explicit reason why not, documented in the PR description.
- Bug fixes ship a regression test in the same commit (test commits before the fix when practical).
- The LLM-extraction pipeline (Mem0's six-phase write — see `docs/exploration-reports/mem0-ts.md` § 4) needs prompt-output assertion tests **first**, then implementation.

## TDD — Red-Green-Refactor

The cycle is inviolable:

1. **RED** — Write the test FIRST. It MUST fail.
2. **GREEN** — Write the MINIMUM code that makes the test pass.
3. **REFACTOR** — Clean up the code while keeping tests green.

Never write production code without a failing test that justifies its existence.

## BDD — behavior, not implementation

Tests describe the **behavior** as seen from the consumer's point of view, not internal implementation. Refactors must not break tests.

Mandatory format: Given-When-Then (or Arrange-Act-Assert).

```ts
describe('UserMemory.remember', () => {
  it('extracts and persists a fact when given a free-form note', async () => {
    // Given: a fresh user memory and an LLM that returns one fact
    const memory = createTestMemory({ llmStub: stubLLM(['I prefer dark mode']) })

    // When: the user remembers a note
    const result = await memory.user('alice').remember('Hey, I like dark mode by the way')

    // Then: exactly one fact persists, embedded, deduped by hash
    expect(result.facts).toHaveLength(1)
    expect(result.facts[0].text).toBe('I prefer dark mode')
    expect(result.facts[0].scope).toEqual({ user_id: 'alice' })
  })
})
```

## Pyramid

```
        E2E (few)             — TheoKit binding end-to-end with real Postgres + pgvector
       ─────────
     Integration (some)        — local/ runtime against a real pgvector container
   ─────────────────
  Unit (many, fast)             — core/ contracts, retrieval scorer, dedup, prompt rendering
─────────────────────
```

- **Unit** — `src/core/**/*.test.ts`. Pure functions, deterministic, < 50 ms each. Mock the LLM with fixtures (never call a real provider in unit tests).
- **Integration** — `tests/integration/**/*.test.ts`. Real Postgres + pgvector via Docker (or `@testcontainers/postgresql`). Cover the two-stage write pipeline end-to-end. Reset DB state between tests.
- **E2E** — `tests/e2e/**/*.test.ts`. The TheoKit binding (`src/theokit/`) resolving user/session/agent from a fake request context. Few, slow, gated by `CI=true` or `npm run test:e2e`.

## What to test — by area

| Area | Test focus |
|---|---|
| `src/core/` — Memory contract | Type narrowing on `memory.user(id).remember(...)`, scope object built correctly. |
| `src/core/extraction/` — LLM extraction pipeline | Given an LLM stub returning N facts, the six-phase pipeline produces exactly N persistable Fact entries. ADD-only invariant: no implicit updates. |
| `src/core/retrieval/` — Search pipeline | Nine-step pipeline: semantic threshold gating, BM25 normalization, entity boost spread-attenuated. Test with synthetic embeddings. |
| `src/core/dedup/` — Hash dedup | MD5 of normalized text matches; whitespace variations collapse; semantic dedup is the LLM's job (assert it is NOT done in dedup layer). |
| `src/local/` — Postgres + pgvector adapter | Embedding dimension auto-detection via probe; batch insert with fallback to per-row on failure. |
| `src/theokit/` — Request-context binding | Resolution of user/session/agent IDs from a mocked request. Default-on behavior in scaffolded apps. |

## What NOT to test

- Internal private functions — test through the public API.
- Trivial wiring (re-exports, constants).
- The LLM provider's behavior itself — assert against fixtures, not against live calls.
- TypeScript types directly — `tsc` is the test for the type system. Use `expectTypeOf` (from vitest) only for tricky inference paths.

## Determinism

- **No flaky tests.** A failing test is a bug with maximum priority; fix or delete, never `@skip`.
- LLM calls in unit tests use stubs. Never call OpenAI/Anthropic/etc. from unit tests.
- Embeddings in unit tests use deterministic fixtures (precomputed vectors saved as JSON).
- Time-dependent tests use a frozen clock (`vi.useFakeTimers()`).

## Anti-patterns

- `it('test 1', ...)` / `it('works correctly', ...)` — describe behavior, not method names.
- Tests with `and` in the name (`creates and validates`) — split into two tests, each testing one thing.
- Mocks that exceed 5 lines of setup — the design is wrong; revisit SRP and the boundary.
- Integration tests that share state — each test resets the DB.
- Tests that only assert structure (`expect(result).toBeDefined()`) — assert actual behavior with explicit values.

## Running tests

- `npm test` — full suite (unit + integration). Default before commit.
- `npm test -- --watch` — TDD loop locally.
- `npm test -- src/core/retrieval` — narrow scope while debugging.
- `npm run test:coverage` — coverage gate. Critical paths (extraction, retrieval, dedup) must be 100%.

## Reference

- TDD cycle and BDD format: `/home/paulo/.claude/CLAUDE.md` § PARTE I-7.
- Mem0 architectural decisions to test against: `docs/exploration-reports/mem0-ts.md`.
- Three-tier scope shape: `CLAUDE.md § Architectural Decisions Locked #3`.
