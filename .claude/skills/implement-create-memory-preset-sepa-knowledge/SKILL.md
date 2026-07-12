---
name: implement-create-memory-preset-sepa-knowledge
description: Knowledge librarian paired with the SEPA agent for the /implement halt-loop on plan create-memory-preset. Hydrates plan-specific context (Goal, ADRs D1-D5, absorbed edge cases EC-1..EC-6) and domain best practices for TypeScript factory overloads, pg.Pool lifecycle, and Postgres/pgvector migration wiring. Invoked by the SEPA agent when it needs authoritative context for a finding.
---

# SEPA knowledge — create-memory-preset

Paired knowledge layer for `implement-create-memory-preset-sepa`. The SEPA agent invokes this skill when a finding needs authoritative grounding. In network-available environments this skill would WebSearch canonical sources; in the current offline sandbox it serves the hydrated plan-specific context below (training-data recall is an anti-pattern — cite the plan/rules instead).

## Plan Goal (verbatim)

> "Enable an in-process `@usetheo/memory` consumer to boot a working `Memory` from just a Postgres URL and OpenAI key via `createMemory({ postgres, openai })`, measured by the integration test `create-memory preset wires pool + migrations + store and round-trips remember+recall in top-k` returning green against real `ankane/pgvector:v0.5.1`."

## ADR summary

| ID | Decision (1 line) |
|---|---|
| D1 | Non-breaking discriminated overload of `createMemory` (`postgres` field discriminates preset vs full config); preserve export name + full-config type path |
| D2 | OpenAI key via `process.env` before adapter construction, truthy-guarded (empty never clobbers ambient) |
| D3 | Auto-migrate default opt-out `{ migrate:false }`; preset owns pool → dispose ends it once |
| D4 | Dim fixed 1536; no `embeddingDim` field on the preset |
| D5 | Preset in new `preset.ts`; `factory.ts` thin dispatcher; both ≤ 500 LoC |

## Edge cases absorbed (verify honored)

- EC-1 — pool leak on failed boot → `try/catch` `pool.end()` + rethrow.
- EC-2 — GOAL TEST asserts `results.length > 0` with `threshold: 0` (stored item = extracted fact; stub embedder low cross-text cosine).
- EC-3 — no `embeddingDim` override (fixed 1536).
- EC-4 — empty `postgres` → `InvalidPresetConfig` before opening a pool.
- EC-5 — `openai: ''` truthy-guarded; ambient key untouched.
- EC-6 — `migrate:false` on un-migrated DB → clear missing-relation error.

## Domain best-practice anchors (grounded in the repo, not training recall)

- **TypeScript factory overload discrimination** — use a runtime type-guard on a field disjoint from the alternative shape (`postgres` is absent from `LocalMemoryConfig`/`MemoryConfig`; verified `packages/core/src/infrastructure/db/config.ts` + `domain/memory-store.ts:224`). Cite the `index.test-d.ts` disjointness type test.
- **pg.Pool lifecycle** — `new pg.Pool()` connects lazily; the first query (here `runMigrations`) triggers connection, so bad-URI failures surface there. The owner of the pool must `end()` it (idempotent guard). Precedent: `examples/chat-with-memory/lib/memory.ts` `buildStore`.
- **Migration + dim consistency** — `runMigrations(pool, { embeddingDim })` + `new PgvectorStore(pool, { embeddingDim })` must receive the SAME dim as the embedder output or `probeEmbedder` throws `EmbeddingMismatch` (`packages/core/src/infrastructure/db/factory.ts:130`). Fixed 1536 removes the footgun.
- **Env-set precedent** — `adaptOpenrouterEnvForDemo` (`examples/chat-with-memory/lib/memory.ts:189`) sets `process.env.OPENAI_API_KEY` before constructing the OpenAI adapters (the SDK reads env via a module-global lazy singleton `openai.ts:44` — hence EC-7's one-key-per-process caveat).

## Project rules the SEPA enforces

- `no-paper-names-in-code.md` — no `Voyager`/`Mem0`/`Letta`/etc. in `src/**` or test names.
- `testing.md` § 4.1 — negative-case tests assert the SPECIFIC typed error + message (EC-4/EC-6), not merely "it throws".
- `error-handling.md` — fail-fast, typed, no swallowed exceptions (EC-1 rethrows after cleanup).
- `parsimony-ladder.md` — reuse installed deps (`pg`, `openai`, existing `PgvectorStore`/adapters); no new dependency.
