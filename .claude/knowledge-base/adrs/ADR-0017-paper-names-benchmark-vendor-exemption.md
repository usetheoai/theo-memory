# ADR-0017: `no-paper-names-in-code` exempts benchmark vendor-adapter directories

- **Status:** Accepted
- **Date:** 2026-06-15
- **Plan:** [`complete-workspace-publish-topology-plan.md`](../plans/complete-workspace-publish-topology-plan.md) (unmasked decision #2)
- **Owner:** TheMemory `complete-workspace-publish-topology` cycle
- **Sign-off:** Project owner authorization 2026-06-15 via `AskUserQuestion` ("Isentar benchmarks/ via ADR")
- **Governs:** [`no-paper-names-in-code.md`](../../rules/no-paper-names-in-code.md)

## Context

`no-paper-names-in-code.md` bans paper/marketing names (`Voyager`, `Mem0`, `Letta`, `LangMem`, `Graphiti`, …) in `src/**` production code and tests. The policy's INTENT (per its § Why) is to prevent (1) confusion — a reader assuming our code matches a paper line-by-line — and (2) bias — naming biasing future changes toward "preserve the paper's semantics" instead of "preserve OUR contract".

The v0.8/v0.9 independent-benchmark work (Roadmap Item 10) ships **vendor benchmark adapters** under `packages/core/src/domain/benchmarks/` — e.g. `Mem0BenchmarkAdapter`, `Mem0VendorClient`, and sibling Zep/Letta adapters. Here the vendor name is NOT a paper-name biasing domain code — it is the **legitimate subject** of the adapter: you cannot benchmark Mem0 (the third-party product) without naming it `Mem0`, importing the `mem0ai` SDK, and living under a `benchmarks/mem0/` directory. This is categorically different from a paper-name leaking into the memory-domain code.

The policy test (`full-public-surface.test.ts` test 30) asserts `Mem0` count == 0 in `packages/*/src/`. This conflicts with the shipped vendor adapters. (Note: the test's `\bMem0\b` word-boundary regex does NOT actually match `Mem0BenchmarkAdapter`/`Mem0VendorClient` — the `B`/`V` defeats the boundary — so the only real hit was a single JSDoc `Mem0-shape` reference in domain code, cleaned separately per the un-exempted policy. This ADR formalizes the benchmark exemption so the intent is explicit and future stricter regexes do not false-flag legitimate vendor adapters.)

## Decision

Amend `no-paper-names-in-code.md` to **exempt benchmark vendor-adapter directories** (`**/benchmarks/**` under `src/`) from the paper/marketing-name ban. In those directories, a third-party VENDOR PRODUCT name (the subject of the benchmark) is allowed in identifiers, imports, and JSDoc.

The ban REMAINS in full force everywhere else in `src/**` — including domain code, even for the `Mem0-shape` architectural descriptor (which stays allowed in README/CLAUDE.md/docs but is cleaned to neutral wording in code per the original policy).

The policy test is updated to count paper-names in `src/` **excluding** `benchmarks/`, so it precisely enforces "0 paper-names in domain code; vendor names allowed in benchmark adapters."

## Alternatives considered

- **Rename the vendor adapters (rejected).** `Mem0BenchmarkAdapter` → a neutral name loses the vendor identity that IS the point of a benchmark adapter, requires churn, and still imports the `mem0ai` SDK + lives under `benchmarks/mem0/`. The name conveys exactly the right thing.
- **Keep the test skipped (rejected).** A permanent `@skip` is an anti-pattern (`testing.md`); it hides the policy gap instead of resolving it.
- **Blanket-exempt all of `src/` for `Mem0` (rejected).** Too broad — would allow paper-name bias to creep into domain code, defeating the policy's purpose. The exemption is scoped to `benchmarks/` only.

## Consequences

- `no-paper-names-in-code.md` gains a `benchmarks/**`-under-`src/` exemption + a log entry citing this ADR.
- `full-public-surface.test.ts` test 30 counts `Mem0` in `src/` excluding `benchmarks/`, asserts 0, and is un-skipped.
- The single domain-code `Mem0-shape` JSDoc reference (`packages/mcp/src/tools/remember-schema.ts`) is cleaned to neutral wording (NOT covered by the benchmark exemption — it is domain code).
- The other 4 paper-names (Voyager/Letta/LangMem/Graphiti) remain at 0 in domain code; their benchmark adapters (if any) are likewise exempt under `benchmarks/`.

## Rollback

Revert the `no-paper-names-in-code.md` amendment + the test change; re-skip test 30. The exemption is additive (relaxes a ban for one dir class), so rollback restores the stricter prior state.
