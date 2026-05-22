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
| Foundation document | `docs/agentic-memory-landscape.md` (2026-05-16) | — |

## Voice and Tone

**Locked 2026-05-21** (Option A strategic review — 7th OSS adopter, completing the monorepo's voice contract). TheMemory has adopted the aspirational voice originally scoped to TheoKit. The operational guide — three communication layers (HERO / BODY / DEEP DIVE), vocabulary translation, banned terms list, storytelling rules, before/after examples — lives in [`../theokit/CLAUDE.md`](../theokit/CLAUDE.md). Read it before writing any public copy for this project. This file does not duplicate it.

**Applies to:**

- `README.md` HERO + BODY + "Why" + "What you'd ship" sections (everything above the `## How it works` delimiter)
- Future `PITCH.md` if added
- Site copy referencing TheMemory on `usetheo.dev` and `docs.usetheo.dev`
- Launch material, blog posts

**Does NOT apply to (stays technical-direct):**

- `README.md` from `## How it works` downward — Status section, Planned API contract, Architecture, Foundation, Roadmap, Where this fits
- `docs/agentic-memory-landscape.md`, `docs/exploration-reports/*`
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

Decisions taken during the project's design phase. **Do not re-litigate without reading the source artifact first.** Each entry names the artifact and the date.

### 1. Four explicit overrides of root `CLAUDE.md` (2026-05-21)

The strategic review of 2026-05-21 documented four explicit overrides of the root meta-contract. **All four confirmed by the project owner.** Re-opening any requires a new strategic review.

- **Cross-Project Rule 6 — vendor lock-in exception.** TheoKit + TheMemory + TheoCloud is a deliberate single-platform consolidation. Walk-away from this specific combination costs a memory migration. Local OSS runtime stays open; the rest of the funnel remains lock-in-free. Source: root `CLAUDE.md` § Cross-Project Rules 6.
- **Phase 1 scope expansion — TheoCloud completeness.** TheMemory enters Phase 1 as expansion of TheoCloud capacity, NOT as a 7th vertical productization. Classified as "line item on the TheoCloud invoice", analog Vercel KV. Source: root `CLAUDE.md` § Phase (now), "Expanded into scope 2026-05-21".
- **Inquebrável Rule 9 — strategic build override.** The `docs/agentic-memory-landscape.md` foundation document (2026-05-16) explicitly recommended NOT building a Mem0-clone. Override accepted because the motive is strategic (lock-in + revenue + single platform), not technical (differentiation). Source: `docs/agentic-memory-landscape.md` § 10 + memory.
- **License standardization exception — MIT instead of Apache-2.0.** The 2026-05-14 license standardization mandates Apache-2.0 for every OSS product. TheMemory is the explicit MIT exception, for maximum permissiveness in proprietary embeds. Source: root `CLAUDE.md` § Product Hierarchy footnote.

### 2. Mem0-shape architecture (locked 2026-05-21)

After cloning Mem0 v3.0.3 (`referencia/mem0/mem0-ts/`) and producing a full exploration report (`docs/exploration-reports/mem0-ts.md`, 2026-05-21), the following Mem0 patterns are **locked for v0.1**:

- **Six-phase write pipeline:** Phase 0 context gathering → Phase 1 existing memory retrieval → Phase 2 single LLM extraction call (ADD-only, additive prompt) → Phase 3 batch embed → Phase 4-5 hash dedup → Phase 6 batch persist with fallbacks.
- **Nine-step search pipeline:** preprocess query → embed → semantic search (over-fetch `max(topK * 4, 60)`) → optional keyword search → BM25 sigmoid normalization → entity boost from separate entity store → score and rank → format.
- **Additive scoring formula:** `combined = (semantic + bm25 + entity_boost) / max_possible` with semantic threshold gating BEFORE combining. **NOT** the multiplicative `recency × importance × relevance` mentioned in README v1.
- **Separate entity vector store** with `linkedMemoryIds` + spread-attenuated boost (formula: `boost = similarity * 0.5 * (1.0 / (1.0 + 0.001 * (numLinked - 1)**2))`). Achieves Zep-style entity boost without a graph database.
- **Hash dedup via MD5 of text** — exact-match only; semantic dedup is the LLM's job in the extraction prompt.
- **UUID → integer mapping** for LLM prompts (anti-hallucination, near-zero cost).
- **`textLemmatized` precomputed at write** in payload — BM25 read latency stays low.
- **Auto-detected embedding dimension** via probe call — eliminates a recurring user footgun.
- **`infer: false` escape hatch** — when caller already has facts, skip LLM extraction.
- **Robust fallbacks at every I/O boundary** — batch fails → individual; insert fails → one-by-one.

**Source artifact:** `docs/exploration-reports/mem0-ts.md` § 4, 5, 8.

### 3. Three-scope model — user_id / agent_id / session_id (locked 2026-05-21)

Mem0's three-scope filter shape (`user_id` / `agent_id` / `run_id`) maps **1:1** onto TheMemory's User / Session / Agent tiers. We rename `run_id` → `session_id` for clarity. Implementation: scope passed internally as a `filters` object identical in shape to Mem0's. Public API uses scoped sub-object form (`memory.user(id).remember(text)`) for TypeScript narrowing; both shapes resolve to the same `filters` object before reaching the vector store.

**Source artifact:** `docs/exploration-reports/mem0-ts.md` § 3.2.

### 4. API verbs — divergence from Mem0 (locked 2026-05-21)

TheMemory keeps `remember / recall / forget / reflect` (not Mem0's `add / search / delete`). Divergence accepted for clarity to TheoKit users. **`update()` is NOT shipped** — ADD-only by design; users `forget(id) + remember(newText)` if they want the effect of update. `history(memoryId)` will ship for audit trails (cheap, no new code path).

**Source artifact:** `docs/exploration-reports/mem0-ts.md` § 10.4 + 10.5.

### 5. Generative Agents scoring deferred to v0.4 (locked 2026-05-21)

Original README v1 promised `score = recency × importance × relevance` (Generative Agents-style, Park et al. 2023). After exploration, **v0.1 ships Mem0's additive formula instead**. The multiplicative Generative Agents-style formula moves to **v0.4 (Reflection + Forgetting)** behind a strategy interface, opt-in. Reason: Mem0's formula is production-tested; recency decay and LLM-importance scoring are complexity extra without benchmarks justifying.

**Action item:** README's "Retrieval — Mem0-shape, multi-signal" section still mentions recency × importance × relevance. **Update on next pass.**

**Source artifact:** `docs/exploration-reports/mem0-ts.md` § 5.1 + 10.1.

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
| [`mem0`](./referencia/mem0/) | 78 MB | Apache-2.0 | Explored — full report at `docs/exploration-reports/mem0-ts.md` (2026-05-21) |
| [`letta`](./referencia/letta/) | 34 MB | Apache-2.0 | Pending exploration — relevant for Postgres + pgvector schema, Alembic migrations, sleep-time agents (reflection design) |
| [`langmem`](./referencia/langmem/) | 3.9 MB | MIT | Pending exploration — relevant for procedural memory via prompt rewriting |

The directory is **gitignored** (see `.gitignore`) — clones never enter git.

## Roadmap

The roadmap below mirrors the consolidated view in the root `CLAUDE.md § Roadmap por Domínio` for theo-memory. Source of truth for status changes: this file + `README.md` § Status + `README.md` § Roadmap. **If this file and the root disagree, update both in the same PR.**

| ROADMAP ITEM | DESCRIÇÃO | STATUS |
|---|---|---|
| Foundation document | `docs/agentic-memory-landscape.md` (2026-05-16) — 13 sections, 10+ players surveyed (Mem0, Letta, Zep/Graphiti, Cognee, Honcho, LangMem, LlamaIndex Memory, MemGPT, Generative Agents, Voyager) | Shipped |
| Mem0 TS exploration report | `docs/exploration-reports/mem0-ts.md` (2026-05-21) — DIP boundaries, 6-phase write pipeline, 9-step search, scoring divergence locked, what to adopt vs avoid | Shipped |
| Reference clones (`referencia/`) | Mem0 + Letta + LangMem cloned `--depth 1` (2026-05-21) for design study; gitignored | Shipped |
| README + strategic placement | Community auxiliary MIT (4 root overrides explicit), TheoKit-native, Mem0-shape architecture, two runtimes | Shipped (2026-05-21) |
| This `CLAUDE.md` | Project-specific contract layered on root; 4 overrides documented, architectural decisions locked from exploration | Shipped (2026-05-21) |
| 0.0 — Contract design | Type contract for `Memory`, `MemoryStore`, three tiers, retrieval scorer, two-stage pipeline. Frozen in `docs.md` (planned) | In progress |
| 0.1 — Core + local runtime | `core/` + `local/` (Postgres + pgvector). Three tiers, additive Mem0-style retrieval, two-stage write pipeline | Planned |
| 0.2 — TheoKit binding | `theokit/` package: request-context resolution, default-on memory in scaffolded TheoKit apps | Planned |
| 0.3 — Agent tools | `agent-tools/` package: MCP tools for `@usetheo/sdk` agents | Planned |
| 0.4 — Reflection + forgetting | `reflect()` pipeline (Generative Agents-shaped behind strategy interface). LLM-importance-aware forgetting that preserves long-tail | Planned |
| 0.5 — TheoCloud runtime | `cloud/` package + TheoCloud-managed backend. Premium: graph memory, bi-temporal audit, multi-region replication, managed embedding pricing | Planned (depends on PaaS GA) |
| 1.0 — Contract stable | Benchmarks reproduced independently; production claims allowed | Planned |
| Adapters (Mem0, Zep, Letta) | Originally roadmap 0.5; cut 2026-05-21 — foco em ser backend nativo, não wrapper. `@usetheo/sdk` já tem 3 MemoryAdapter packages para esse caso de uso | Out of scope |
| Recency × importance × relevance scoring | README v1 promised; locked 2026-05-21 — v0.1 usa aditivo Mem0-style. Multiplicativo move pra v0.4 atrás de strategy interface | Deferred to v0.4 |

**Honesty discipline (Inquebrável Rule #3):**

- **No production claims** until v1.0 with benchmarks reproduced independently. The README's Status section is the authoritative declaration; never weaken it without a PR-level decision.
- **No `production-ready` badge** in the README or marketing — TheMemory is the explicit exception to the monorepo "production-ready" claim (2026-05-15 lock).
- **Roadmap moves backward via PR with one-line rationale.** Items don't disappear silently. Removed items appear as `Removed` with date and reason.

## Open questions for the contract design

Tracked in the exploration report (`docs/exploration-reports/mem0-ts.md` § 11). **Lock before v0.0 contract ships:**

1. **Multi-peer / `attributed_to` support.** Mem0 has the field as opt-in. Day-one for TheMemory?
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

The code (when it lands), the README, and the exploration reports are authoritative. If this file disagrees with them, the code/README/reports win — update this file via PR with a one-line rationale in the commit message.

**Locked items** require explicit strategic review:

- **Locked names** (npm package, license MIT exception, tier, memory tiers, API verbs, two runtimes, subpath exports) — root-level strategic review.
- **Voice and tone** — root-level strategic review per Voice and Tone section.
- **Four root overrides** (Cross-Project Rule 6 exception, Phase 1 scope, Inquebrável Rule 9 override, MIT license exception) — root-level strategic review.
- **Mem0-shape architecture commitments** — local sub-project review (re-explore the source artifact first).
- **Three-scope model + API verbs + ADD-only** — local sub-project review (re-read the exploration report first).

Do not edit any of the above silently. Surface the conflict to the user first.
