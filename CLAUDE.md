# CLAUDE.md — TheMemory

Contract between Claude and the **TheMemory / `@usetheo/memory`** project (the **managed memory** community auxiliary of [usetheo](../CLAUDE.md)). Read this file **and** the root `CLAUDE.md` before editing anything here.

This file complements `/home/paulo/Projetos/usetheo/CLAUDE.md` and `/home/paulo/.claude/CLAUDE.md`. Root rules apply unconditionally. TheMemory-specific rules layer on top.

---

## What this project is

`@usetheo/memory` (TheMemory) is the **managed three-tier memory layer** of the [usetheo](https://usetheo.dev) ecosystem. **Mem0-shape architecture** (vector + LLM fact extraction + hybrid retrieval), with three scope tiers (**User / Session / Agent**), shipping in two runtimes (**local** Postgres + pgvector for dev/CI, **TheoCloud-managed** for production). **MIT-licensed.** Native to [TheoKit](../theokit) by design.

Positioned as a **Community auxiliary** of usetheo, alongside [`@usetheo/sdk`](../theokit-sdk) and [`@usetheo/ui`](../theo-ui). **Pre-release** (contract being locked; no package published yet) — single exception to the monorepo's "every product is production-ready" claim (2026-05-15 lock).

**Strategic positioning:** the managed memory line item on the TheoCloud invoice. Analog: Vercel KV ↔ Vercel. Lock-in to TheoKit + TheoCloud is a deliberate feature, not an accident — see `## Architectural Decisions Locked` below.

## Locked names

(Decisions documented; changing requires a CLAUDE.md update + CHANGELOG entry + strategic review for items marked `strategic`.)

| Item | Value | Strategic? |
| --- | --- | --- |
| npm package | `@usetheo/memory` | strategic |
| Marketing name | **TheMemory** | strategic |
| Repository directory | `theo-memory` | strategic |
| Canonical install command | `npm install @usetheo/memory` (reserved; not yet published) | strategic |
| License | **MIT** | strategic — root override 2026-05-21 |
| Tier | Community auxiliary (OSS) | strategic |
| Memory tiers | `User` · `Session` · `Agent` | strategic |
| API verbs | `remember` / `recall` / `forget` / `reflect` | strategic |
| Two runtimes | `local` (Postgres + pgvector) + `cloud` (TheoCloud-managed) | strategic |
| Subpath exports | `@usetheo/memory` (local default) + `@usetheo/memory/cloud` (managed) | strategic |

## Voice and Tone

**Locked 2026-05-21** (Option A strategic review — 7th OSS adopter, completing the monorepo's voice contract). TheMemory has adopted the aspirational voice originally scoped to TheoKit. The operational guide — three communication layers (HERO / BODY / DEEP DIVE), vocabulary translation, banned terms list, storytelling rules, before/after examples — lives in [`../theokit/CLAUDE.md`](../theokit/CLAUDE.md). Read it before writing any public copy for this project. This file does not duplicate it.

**Applies to:**

- `README.md` HERO + BODY + "Why" + "What you'd ship" sections (everything above the `## How it works` delimiter)
- Future `PITCH.md` if added
- Site copy referencing TheMemory on `usetheo.dev` and `docs.usetheo.dev`
- Launch material, blog posts

**Does NOT apply to (stays technical-direct):**

- `README.md` from `## How it works` downward — Status section, Planned API contract, Architecture, Foundation, Roadmap, Where this fits
- This `CLAUDE.md`, `CHANGELOG.md` (when created), source code, JSDoc, inline comments
- Migration guides, runbooks, ADRs (when created)

**Cross-project narrative anchors that must hold (regardless of voice):**

- **Managed memory of TheoCloud, optimized for TheoKit** — the consolidation pitch. Comparable: Vercel KV ↔ Vercel.
- **Lock-in is a feature, owned explicitly** — not apologized for. The TheoKit-native binding + TheoCloud managed runtime are designed as deep coupling. Local mode stays open for users who want to walk away.
- **Mem0-shape architecture** — vector + LLM extraction + hybrid retrieval (semantic + BM25 + entity matching). Two-stage write pipeline. ADD-only.
- **Three tiers (User / Session / Agent)** — mapped 1:1 onto Mem0's `user_id` / `agent_id` / `run_id` filter shape internally. Public API uses scoped sub-object form (`memory.user(id).remember(...)`) for type narrowing.
- **MIT license is intentional** — explicit exception to the monorepo Apache-2.0 standard (locked 2026-05-14). For maximum permissiveness in a memory primitive consumers embed deeply into proprietary systems.
- **Pre-release is honest** — never claim production-ready until v1.0 with reproduced benchmarks. Breaks the consistency with the other 6 sub-projects' "production" status deliberately.
- **Cross-Project Rule 9 (Cloud abstraction)** — cloud runtime user-copy says `memory store`, NEVER `Qdrant` / `pgvector` / `vector engine` / `vector store engine` etc.

If a piece of TheMemory copy contradicts the locked narrative in [`../CLAUDE.md`](../CLAUDE.md) or the operational rules in [`../theokit/CLAUDE.md`](../theokit/CLAUDE.md), the root and TheoKit rules win — surface the conflict before publishing.

## Architectural Decisions Locked

Decisions taken during the project's design phase that override root contract defaults.

### Three explicit overrides of root `CLAUDE.md` (2026-05-21)

The strategic review of 2026-05-21 documented three explicit overrides of the root meta-contract. **All three confirmed by the project owner.** Re-opening any requires a new strategic review.

- **Cross-Project Rule 6 — vendor lock-in exception.** TheoKit + TheMemory + TheoCloud is a deliberate single-platform consolidation. Walk-away from this specific combination costs a memory migration. Local OSS runtime stays open; the rest of the funnel remains lock-in-free. Source: root `CLAUDE.md` § Cross-Project Rules 6.
- **Phase 1 scope expansion — TheoCloud completeness.** TheMemory enters Phase 1 as expansion of TheoCloud capacity, NOT as a 7th vertical productization. Classified as "line item on the TheoCloud invoice", analog Vercel KV. Source: root `CLAUDE.md` § Phase (now), "Expanded into scope 2026-05-21".
- **License standardization exception — MIT instead of Apache-2.0.** The 2026-05-14 license standardization mandates Apache-2.0 for every OSS product. TheMemory is the explicit MIT exception, for maximum permissiveness in proprietary embeds. Source: root `CLAUDE.md` § Product Hierarchy footnote.

## Relationship to other pillars

| Pillar | Project | Current integration (verify before claiming) |
| --- | --- | --- |
| Apex (runtime) | [TheoCloud](../theo) | Cloud runtime depends on Theo PaaS GA. No code today. v0.5 milestone. |
| Framework | [TheoKit](../theokit) | `@usetheo/memory/theokit` subpath is the lock-in surface (resolves user/session/agent from request context). No code today. v0.2 milestone. |
| Harness | [`@usetheo/sdk`](../theokit-sdk) | `@usetheo/memory/agent-tools` will expose `remember`/`recall`/`forget`/`reflect` as MCP tools for `@usetheo/sdk` agents. No code today. v0.3 milestone. **Note:** `@usetheo/sdk` already ships its own `MemoryAdapter` interface + 3 adapter packages (`@usetheo/memory-supermemory`, `@usetheo/memory-honcho`, `@usetheo/memory-mem0`, shipped 2026-05-20). TheMemory does **not** consume those — they are SDK-shape; TheMemory is the runtime. Future: `@usetheo/sdk` will accept TheMemory as one of the adapter targets via `MemoryAdapter`. |
| UI | [`@usetheo/ui`](../theo-ui) | `MemoryEditor` primitive already exists in `@usetheo/ui` (one of the 81 primitives). Natural consumer of TheMemory's API for dashboard surfaces. No wiring today. |
| Coding assistant | [`theo-code`](../theo-code) | TheoCode has its own memory subsystem (`crates/theo-infra-memory/`). Different domain (coding agent project memory) — no shared code planned. |

> "Do not invent integration that does not exist yet." (Root `CLAUDE.md` Cross-Project Rule 2.) Verify the actual import / dependency before claiming wiring exists in copy.

## Reference projects (study material)

The `referencia/` directory contains three clones (`--depth 1`, 2026-05-21) used for design study. **Read-only — never `npm install`, `pip install`, or edit them.**

| Project | Tamanho | License | Status of exploration |
|---|---|---|---|
| [`mem0`](./referencia/mem0/) | 78 MB | Apache-2.0 | Pending exploration — primary architectural reference (vector + LLM extraction + hybrid retrieval) |
| [`letta`](./referencia/letta/) | 34 MB | Apache-2.0 | Pending exploration — relevant for Postgres + pgvector schema, Alembic migrations, sleep-time agents (reflection design) |
| [`langmem`](./referencia/langmem/) | 3.9 MB | MIT | Pending exploration — relevant for procedural memory via prompt rewriting |

The directory is **gitignored** (see `.gitignore`) — clones never enter git.

## Roadmap

The roadmap below mirrors the consolidated view in the root `CLAUDE.md § Roadmap por Domínio` for theo-memory. Source of truth for status changes: this file + `README.md` § Status + `README.md` § Roadmap. **If this file and the root disagree, update both in the same PR.**

### Foundation artifacts (shipped)

| Artifact | Status |
|---|---|
| `referencia/` clones (Mem0 + Letta + LangMem, `--depth 1`, gitignored) | Shipped 2026-05-21 |
| `README.md` + strategic placement (Community auxiliary MIT, TheoKit-native, Mem0-shape, two runtimes) | Shipped 2026-05-21 |
| This `CLAUDE.md` (3 root overrides documented) | Shipped 2026-05-21 |

### Macro roadmap — competitive positioning

Premise: ship Mem0-shape commodity + **attack the 3 open problems** (long-tail forgetting, Voyager-style skill libraries, episodic→semantic distillation) + lock-in deliberato via TheoKit/TheoCloud. Each item below carries `Nº` (sequence), `Name` (semver + descriptor), `Description` (concrete scope), `Acceptance` (binary test + `Depends`), `Status`.

**Reading the Acceptance column:** Every item declares (a) one or more **binary tests** the implementation must pass, (b) **numeric thresholds** marked `TBD (lock by v0.X kickoff)` for criteria that need calibration, (c) explicit **`Depends:`** prerequisites by item number. An item is NOT considered done until its Acceptance row passes verifiably; "looks right" is not acceptable per Inquebrável Rule 5 (TDD) + Rule 7 (testes não negociáveis).

#### Phase I — Foundation (Mem0-shape, do not reinvent)

| Nº | Name | Description | Acceptance | Status |
|---|---|---|---|---|
| 1 | **v0.0 — Contract design** | Type contract for `Memory`, `MemoryStore`, four DIPs (`VectorStore`, `LLM`, `Embedder`, `HistoryManager`), three-scope `user_id`/`agent_id`/`session_id`, API verbs `remember/recall/forget/reflect` (ADD-only). Frozen in `docs.md`. | `tsc --noEmit` passes on `docs/contract/*.ts`. 4 DIP interfaces declared (`VectorStore`, `LLM`, `Embedder`, `HistoryManager`) with method counts to be fixed in the contract spec. One ADR per locked decision (Mem0-shape, three-scope, ADD-only, API verbs) under `docs/adrs/`. **Depends:** — | In progress |
| 2 | **v0.1 — Core + local runtime** | 6-phase write pipeline (`infer:false` fast-path + Phase 0-6: context gather, existing retrieval, single LLM extraction, batch embed, MD5 dedup, batch persist with fallbacks) + 9-step search with additive scoring `(semantic + bm25 + entity_boost) / max_possible` + over-fetch `max(topK*4, 60)` + separate entity vector store + auto-detected embedding dim. Backend: Postgres + pgvector + Drizzle. | Integration test: `remember("Paulo likes coffee", {userId:"u1"})` → `recall("beverages", {userId:"u1"})` returns the memory in top-3. Each of 6 write phases + 9 search steps emits one OpenTelemetry span (verify via in-memory exporter). `drizzle-kit push` applies pgvector schema to a fresh database. P95 write latency ≤ TBD (lock by v0.1 kickoff). Fallback path tested: simulated batch-embed failure still completes via per-item fallback. **Depends:** Item 1 | Planned |
| 3 | **v0.2 — TheoKit binding** | Subpath `@usetheo/memory/theokit` resolves `user_id`/`session_id`/`agent_id` from request context automatically; default-on memory in scaffolded TheoKit apps. **This is the deliberate lock-in surface** (override of Cross-Project Rule 6). | E2E test in scaffolded TheoKit app: HTTP request with auth header → `remember()` inside handler persists under correct `user_id` without explicit scoping in user code. Isolation test: two distinct `user_id` values produce disjoint `recall()` result sets (zero overlap). Scaffolded template includes memory module by default (template snapshot test). **Depends:** Item 2 | Planned |
| 4 | **v0.3 — Agent tools (MCP)** | Subpath `@usetheo/memory/agent-tools` exposes `remember/recall/forget/reflect` as MCP tools for `@usetheo/sdk` agents. Function-calling-driven memory ops (lesson from MemGPT/Letta) without inheriting the agent-loop lock-in. | MCP server boots; `tools/list` returns exactly 4 tools with stable names. End-to-end via `@usetheo/sdk` agent: each verb invoked successfully with valid payload; schema validation rejects malformed payloads with structured error. JSON-RPC trace test confirms no cross-tool state leakage. **Depends:** Item 2 | Planned |

#### Phase II — Consolidation infrastructure + cloud foundation

> Items 5+6 deliver the consolidation primitive (reflection unlocks forgetting). Item 7 lands the cloud runtime that also exposes the bi-temporal moat. These three items are the bedrock for Phase III differentiation.

| Nº | Name | Description | Acceptance | Status |
|---|---|---|---|---|
| 5 | **v0.4a — Reflection pipeline** | `reflect()` async via sleep-time worker (Letta pattern). Scoring tier opcional behind strategy interface: additive Mem0 (default) OR multiplicative Generative Agents (`recency × importance × relevance`). LLM-importance cached at write to avoid per-query cost. | Test: seed 50 memories in a scope; trigger `reflect()`; assert ≥ 1 higher-order memory exists with `derived_from: string[]` provenance linking source memory IDs. Both scoring strategies pass identical recall-shape contract test (interface compliance). Sleep-time worker test: background trigger fires within TBD seconds (lock by v0.4a kickoff) when threshold of N new memories crossed. LLM-importance score persisted on first write; second-write same content does NOT re-invoke LLM. **Depends:** Item 2 | Planned |
| 6 | **v0.4b — Forgetting with long-tail preservation** | **OPEN PROBLEM #1 — no competitor solved this.** Triadic signal (Ebbinghaus time decay + LRU/LFU + LLM-judged importance) WITH explicit anti-long-tail guardrail: rare-but-semantically-isolated memories receive a protection multiplier to defeat frequency bias. | Curated test set: 1000 memories with 50 rare-query targets seeded. After `forget()` cycle removing 30% by triadic score: `recall@10` on rare-query set ≥ TBD (lock by v0.4b kickoff). Guardrail unit test: a rare-but-isolated memory survives ≥ 5 consecutive LRU eviction passes against frequent siblings. Evaluation matrix published at `docs/forgetting-evaluation.md` (artifact must exist + be reproducible). **Depends:** Item 5 | Planned |
| 7 | **v0.5 — TheoCloud runtime + bi-temporal premium** | `cloud/` package + TheoCloud-managed backend. Bi-temporal `t_valid`/`t_invalid` columns + audit history exposed in paid tier (**Zep's only real moat — we match it bundled**). Multi-region replication, managed embedding pricing. (Graph backend explicitly NOT in this item — see Item 14.) | Bi-temporal test: `remember(fact)` at t1; `forget(id)` at t2; `recall(query, {asOf: t1})` returns the fact; `recall(query, {asOf: t2})` does NOT. `@usetheo/memory/cloud` subpath imports the cloud client and does NOT pull local runtime deps (bundle-size assertion). `THEOKIT_API_KEY` auth flow passes against staging environment (CI secret). Multi-region failover: write in region A, read in region B succeeds within TBD seconds (lock by v0.5 kickoff). **Depends:** Item 2, Theo PaaS GA | Planned (depends on PaaS GA) |

#### Phase III — Differentiation (open problems #2 + #3) and v1.0 gate

| Nº | Name | Description | Acceptance | Status |
|---|---|---|---|---|
| 8 | **v0.6 — Voyager-style skill library** | **OPEN PROBLEM #2 — only the paper exists.** Procedural memory for coding agents: stores executable reusable code/playbooks indexed by retrieval; reflection refactors + dedups skills periodically (no one shipped this as infra). Natural alignment with TheoCode. Opt-in tier `memory.skills(repoId)`. | TheoCode integration test: a successful run produces ≥ 1 skill artifact in `memory.skills(repoId)`. Subsequent run with semantically-similar prompt retrieves + reuses the skill (cache-hit metric > 0). Refactoring test: feed 2 syntactically-different but semantically-equivalent skills; reflection consolidates to 1 with both source IDs in `derived_from`. **Depends:** Item 5 | Planned |
| 9 | **v0.7 — Episodic→Semantic distillation pipeline** | **OPEN PROBLEM #3 — Mem0/Zep try, quality remains open.** Managed pipeline: raw episodes → entity extraction → conflict resolution (LLM-judged) → semantic facts with provenance link back to source episodes. | Gold set: 200 manually-labeled raw episodes committed under `tests/fixtures/distillation/`. Entity-extraction precision ≥ TBD (lock by v0.7 kickoff); recall ≥ TBD (lock by v0.7 kickoff). Conflict-resolution test: two contradictory facts → pipeline resolves to one + history records rejected alternative with reason. Every persisted semantic fact has non-empty `derived_from: episodeId[]`. Metrics published at `docs/distillation-evaluation.md`. **Depends:** Item 5 | Planned |
| 10 | **v0.8 — Independent benchmark reproduction** | Reproduce LongMemEval + LoCoMo + DMR **independently**. Compare against Mem0/Zep/Letta on real fixtures. Publish matrix: P95 latency, recall@10, cost/session, temporal accuracy. **Zero benchmark theater** — methodology + raw fixtures published alongside numbers. | All 3 benchmarks run in CI against TheMemory v0.7 + Mem0 v3 + Zep + Letta on identical fixtures (committed under `benchmarks/fixtures/`). Matrix published at `docs/benchmarks/v0.8.md` with 4 columns: P95 latency, recall@10, cost/session, temporal accuracy. Reproducibility: a third party running `pnpm bench` produces matching numbers within TBD% tolerance (lock by v0.8 kickoff). Target: TheMemory ≥ Mem0 on at least TBD of TBD metrics (lock by v0.8 kickoff); shortfalls documented honestly. **Depends:** Items 6, 8, 9 | Planned |
| 11 | **v1.0 — Contract stable** | Contract frozen. `production-ready` claim permitted ONLY after: (a) Item 10 reproduced independently with verifiable artifacts, (b) `/dogfood` returns `EVIDENCE_SUFFICIENT` (anchor scenario "Claude Code auto-memory backed by TheMemory" `running` ≥ 30 days). | (a) `docs/benchmarks/v0.8.md` exists + at least one external reproduction logged in `benchmarks/reproductions/`. (b) `/dogfood` returns `EVIDENCE_SUFFICIENT` (per `dogfood-golden-rule.md`). README Status section flipped to `Production-ready` in the same PR that bumps to v1.0. No `production-ready` token appears anywhere in repo before this PR (grep gate). **Depends:** Item 10 + `/dogfood` infra (already shipped 2026-05-22) | Planned |

#### Phase IV — Post v1.0 (competitive expansion)

| Nº | Name | Description | Acceptance | Status |
|---|---|---|---|---|
| 12 | **v1.1 — Multi-peer / `attributed_to`** | Memories carrying perspective ("memory A is about user X, said by user Y") via `attributed_to` field in payload. Delivers theory-of-mind-style perspective filtering WITHOUT inheriting Honcho's AGPL restriction. *(Decision 2026-05-22: NOT day-0 — see `## Open questions` § 1, now resolved.)* | Test: `remember(text, {userId:"x", attributedTo:"y"})` persists with both fields. `recall(query, {userId:"x", attributedTo:"y"})` returns it; `recall(query, {userId:"x"})` (no filter) also returns it under x's scope. Schema migration adds optional `attributed_to` column; existing rows remain valid (NULL). Backward-compat test: pre-v1.1 caller code keeps working unchanged. **Depends:** Item 2 | Planned |
| 13 | **v1.2 — Adaptive retrieval** | "Should I retrieve?" + "Was it good?" decision hooks (Self-RAG / CRAG / Adaptive-RAG patterns — arxiv 2310.11511, 2401.15884, 2403.14403). Retrieval as policy, not constant — reduces token cost and ranking noise. | Baseline measurement: N test queries → N retrievals (M2 = no hook). With `shouldRetrieve` hook installed: M < N retrievals AND recall on emitted retrievals ≥ baseline recall (no quality regression). `wasRetrievalGood` callback receives `{score, query, results}` post-recall and consumer can mutate downstream behavior (test via state-mutation spy). **Depends:** Item 2 | Planned |
| 14 | **v1.3 — Optional graph backend** | Adapter `@usetheo/memory/graph` for KG-style queries (Cognee/Zep use cases). **Composition** via interface, NOT replacement of vector core. Backend: Postgres + Apache AGE OR Neo4j. | Shape-shared test suite: same `MemoryStore` interface, same assertions, runs green against (a) pgvector backend AND (b) AGE backend. Graph-specific API: `memory.traverse(entityId, {depth: 2})` returns correct neighborhood verified against seeded fixture. Bundle gate: importing `@usetheo/memory` (default) does NOT pull graph deps. **Depends:** Item 2 | Planned |
| 15 | **v1.4 — Domain ontologies** | Typed schemas per domain (medical, legal, code, support) layered over LLM extraction. Attacks Cognee's pitch WITHOUT replicating its poly-store complexity. | Pilot domain (medical) ships with declared TypeScript schema. Extraction over domain-relevant fixture text produces entities conforming to schema (Zod validation passes). Consumer code: `recall<MedicalSchema>(...)` narrows return type at compile time (`tsc --noEmit` test). At least 1 cross-domain conflict caught at write time (e.g., medical-domain memory rejected from legal scope). **Depends:** Item 9 (distillation pipeline feeds typed extraction) | Planned |

### Items cut / deferred

| Item | Status | Rationale |
|---|---|---|
| Adapters (Mem0, Zep, Letta) | Out of scope (cut 2026-05-21) | Focus on being native backend, not wrapper. `@usetheo/sdk` already ships 3 `MemoryAdapter` packages (2026-05-20) for that use case. |
| Recency × importance × relevance scoring | Deferred to v0.4a behind strategy interface | README v1 promised; locked 2026-05-21 — v0.1 ships additive Mem0-style (production-tested). Multiplicative becomes opt-in strategy at v0.4a. |

### Competitive superiority matrix

How each roadmap item maps to a specific competitor weakness.

| Competitor | Their moat | Our attack | Roadmap item(s) |
|---|---|---|---|
| **Mem0** ($24M) | Drop-in simplicity, vector-centric, large provider catalog | Same architecture + reflection + long-tail forgetting + Voyager skill library + bi-temporal cloud + TheoKit-native default-on | 2, 5, 6, 7, 8, 3 |
| **Letta** ($10M) | Function-calling memory + sleep-time agents | Function-calling memory **without** agent-loop lock-in (we are primitive, not framework) | 4, 5 |
| **Zep/Graphiti** (YC W24) | Bi-temporal knowledge graph with audit | Bi-temporal in paid tier bundled with TheoCloud (no Neo4j operations for consumer) | 7 |
| **Honcho** ($5.35M) | Theory-of-mind / identity modeling | Multi-peer `attributed_to` **without** AGPL restriction (MIT) | 12 |
| **Cognee** | Ontologies + poly-store | Typed domain ontologies without poly-store complexity | 15 |
| **LangMem** | Procedural memory via prompt rewriting | Procedural skill library **with** automatic refactoring (Voyager-style, ships executable code not just prompts) | 8 |
| **LlamaIndex Memory** | Block composition with priority truncation | Three-scope tier model + reflection + skill library (their blocks have no identity, no procedural) | 1, 5, 8 |
| **Vector DBs** (Pinecone/Qdrant/Chroma/etc.) | Multi-tenancy at scale | Real semantic memory primitives (extraction, consolidation, scoring, forgetting) on top of pgvector | 2, 5, 9 |

**Honesty discipline (Inquebrável Rule #3):**

- **No production claims** until v1.0 with benchmarks reproduced independently. The README's Status section is the authoritative declaration; never weaken it without a PR-level decision.
- **No `production-ready` badge** in the README or marketing — TheMemory is the explicit exception to the monorepo "production-ready" claim (2026-05-15 lock).
- **Roadmap moves backward via PR with one-line rationale.** Items don't disappear silently. Removed items appear as `Removed` with date and reason.

## Open questions for the contract design

**Lock before v0.0 contract ships:**

1. ~~**Multi-peer / `attributed_to` support.** Mem0 has the field as opt-in. Day-one for TheMemory?~~ **RESOLVED 2026-05-22:** deferred to v1.1 (roadmap Item 12). Rationale: keeps v0.0 contract minimal; no consumer asked for day-0; backward-compat path via optional column.
2. **`update()` semantics inside ADD-only.** Mem0 has `update()`; we hold the line. Edge case: should it ever exist?
3. **Reflection trigger.** Background scheduler? Explicit call? Threshold-based? Shapes the storage layer.
4. **Bi-temporal `t_valid` / `t_invalid` columns on local.** Always there (cloud exposes them), or schema differs?
5. **Entity store opt-out.** Doubles storage cost. Configurable flag `entityBoost: false`?
6. **`THEOKIT_API_KEY` reuse** — confirm with `@usetheo/sdk` that cloud auth path is shared.

## Inviolable rules (from root and global)

1. **95% confidence gate.** Ask if uncertain. Especially load-bearing for theo-memory — the 4 root overrides are documented because they came from confirming with the project owner explicitly, not from inference.
2. **Task completion gate.** Finish before starting a new task.
3. **Extreme honesty.** Admit ignorance. Surface risks. The single biggest honesty risk here is claiming production-ready before v1.0 + reproduced benchmarks.
4. **Git rules.** No `git checkout` or `git revert`. No direct work on `main`.
5. **TDD.** Tests before production code; bug fixes start with a regression test. Especially critical for the LLM-extraction pipeline — write the prompt-output assertion test first.
6. **Changelog discipline.** Every code change updates `CHANGELOG.md` (when created — does not exist yet).
7. **Don't reinvent.** `pgvector`, `pg`, `zod` for the schema layer. `@usetheo/sdk`'s LLM client + `MemoryAdapter` for ecosystem reuse. Mem0's two-stage pipeline is the proven shape — adopt, don't redesign.
8. **No emojis** in code, READMEs, CHANGELOGs, or CLAUDE.md files unless explicitly requested.

Full text: `/home/paulo/.claude/CLAUDE.md`. Cross-project rules: `/home/paulo/Projetos/usetheo/CLAUDE.md`.

## When this file is wrong

The code (when it lands) and the README are authoritative. If this file disagrees with them, the code/README win — update this file via PR with a one-line rationale in the commit message.

**Locked items** require explicit strategic review:

- **Locked names** (npm package, license MIT exception, tier, memory tiers, API verbs, two runtimes, subpath exports) — root-level strategic review.
- **Voice and tone** — root-level strategic review per Voice and Tone section.
- **Three root overrides** (Cross-Project Rule 6 exception, Phase 1 scope, MIT license exception) — root-level strategic review.

Do not edit any of the above silently. Surface the conflict to the user first.
