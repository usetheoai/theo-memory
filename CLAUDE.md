## IMPORTANTE — Princípios fundamentais do TheMemory

Estes três princípios são a fonte-de-verdade do design. Antecedem qualquer decisão de schema, contrato de API, política de retrieval ou heurística de scoring. Sempre que houver tensão entre um princípio e uma decisão técnica, o princípio vence.

### Princípio 1 — Nem toda memória tem o mesmo peso.

Relevância é um score contínuo, não um booleano. O sistema combina sinais ortogonais:

- **Frequência / confirmação** — `confirmation_count` bumpa quando o mesmo fato é asserido sob o mesmo escopo (composite UPSERT per ADR D5; surfaces via `MemoryItem.confirmationCount`).
- **Recência** — `last_accessed_at` + `created_at` alimentam decay exponencial via `half_life_seconds` (v0.4b forgetting pipeline).
- **Confiança** — `llm_importance_score` cacheado pela extração LLM (v0.4a).
- **Similaridade semântica** — cosine sobre embeddings (vector-based hybrid 9-step search).
- **BM25 + entity boost** — sinais lexicais e estruturais compostos aditivamente.

O sistema NÃO trata cada chamada `remember()` como evento isolado. Quando o mesmo fato chega de fontes diferentes ou momentos diferentes, o sinal de confirmação é reforçado e fica disponível para filtragem (`WHERE confirmation_count > N`), ranking e auditoria.

### Princípio 2 — Priorização e diversidade valem mais que volume.

Recuperar 5 memórias certas e variadas vale mais do que recuperar 50 paráfrases próximas. O pipeline de recall reflete isso por design:

- **Threshold semântico** gateia ANTES da combinação aditiva (`score = (semantic + bm25 + entity) / max_possible`) — sub-threshold descartado, não ponderado.
- **Top-K cap** limita o resultado bruto.
- **MMR diversify (opt-in)** — `RecallOptions.diversify` aplica Maximal Marginal Relevance rerank entre score-combine e top-K para reduzir redundância sem sacrificar relevância (ADR D3, EC-3 validação `lambda ∈ [0, 1]`).
- **Eviction triádica (v0.4b)** — quando capacidade satura, o eviction policy combina Ebbinghaus + LRU + LLM-importance e protege o long-tail (`rare-isolated` survives ≥ 5 LRU passes).

O contrato favorece densidade informacional sobre cobertura bruta. Volume sem priorização é ruído.

### Princípio 3 — Memória precisa ser auditável.

Toda decisão de gravar, ignorar, deduplicar, expirar ou substituir uma memória é OBSERVÁVEL e RASTREÁVEL. IGNORE nunca é silencioso:

- **`MEMORY_EVENTS` union tipada** (16 literais) — cada fase do write/recall/reflect emite um evento OTel tipado via `emitEvent(tracer, ...)`. Inclui `extraction_zero_facts` (LLM extraiu nada), `dedup_collision_confirmed` (UPSERT bumpou `confirmation_count`), `recall_threshold_filtered` (N candidatos sub-threshold descartados) — os 3 IGNORE-decisions que antes eram silenciosos.
- **`MemoryItem.rejectedAsDuplicate`** — flag consumer-visible: quando `remember()` retorna a linha EXISTENTE pós-dedup-collision, o consumidor SABE.
- **Audit tables** — `history` registra remember/forget; `consolidation_history` registra reflect com FK `ON DELETE SET NULL` para survival GDPR; `MemoryItem.derivedFrom` carrega provenance para memórias derivadas (v0.4a reflection, v0.7 distillation).
- **Bi-temporal `t_valid` + `t_invalid`** — `recall({ asOf })` retorna o estado válido em qualquer instante histórico (v1.1 supersedes ADR-0006 runtime clause).

Rastreabilidade é parte do contrato, não opcional. Cada decisão de gravar/ignorar/substituir tem que ser justificável e revisável.

---


# CLAUDE.md — TheMemory

Contract between Claude and the **TheMemory / `@usetheo/memory`** project (the **managed memory** community auxiliary of [Theo](../CLAUDE.md)). Read this file **and** the root `CLAUDE.md` before editing anything here.

This file complements `/home/paulo/Projetos/usetheo/CLAUDE.md` and `/home/paulo/.claude/CLAUDE.md`. Root rules apply unconditionally. TheMemory-specific rules layer on top.

---

## PRIORITY 0 — HARDENING (locked 2026-06-04)

**GO-TO CTO directive (project-owner sign-off 2026-06-04):** stop shipping new features. The only work that ships from this date forward is **HARDENING**:

1. **All public APIs correct** — every export in `src/index.ts` / `src/core/index.ts` / every subpath in `package.json#exports` is documented, typed, narrowable, JSDoc-cross-referenced, and exercised by a contract test. No `any` in public surface. No paper names in exported identifiers. No undocumented behavior.
2. **SDKs 100% functional** — every shipped feature has integration test against real `ankane/pgvector:v0.5.1`. Every shipped DIP has a working default impl. Every subpath in `package.json#exports` resolves to working code (smoke import gate). `npm pack --dry-run` ships every needed file; `__tests__` excluded. Bundle isolation gates pass (default barrel does NOT pull subpath impls per EC-26 precedent). `/dogfood` anchor scenario evidence is COLLECTED (gate flips to `EVIDENCE_SUFFICIENT`).
3. **MCP server available + reliable** — `themory mcp` boots deterministically; 4 tools (`remember` / `recall` / `forget` / `reflect`) registered with stable names + schema validation; `ghcr.io/usetheo/themory:0.1.0-alpha` (or successor tag) pullable; README + MCP setup guide explicit; real third-party consumer can install + use without project-internal knowledge.

### What does NOT ship under Priority 0

The following Roadmap items are **FROZEN until P0 closure** (no PRs, no plans, no discovery cycles spawned against them):

| Nº | Item | Status under P0 |
|---|---|---|
| 13 | v1.2 — Adaptive retrieval | **FROZEN** |
| 14 | v1.3 — Optional graph backend | **FROZEN** |
| 15 | v1.4 — Domain ontologies | **FROZEN** |
| Any unlisted Phase V+ | Future expansion | **FROZEN** |

### What CONTINUES under Priority 0 (hardening, not new features)

| Workstream | Why it qualifies as hardening |
|---|---|
| `semantic-recall-cache-v1-5-fixes-cycle-1` (4 of 8 task commits shipped: `0589a8f`, `bae2fda`, `595ef01`, `e7eb240`) | Closes 7 of 10 MAJORs from `/review` of an already-shipped surface (v1.5.0). Pure hardening; no new public API. |
| 3 pre-existing-debt MAJORs from v1.1 review (F-arch-2 ad-hoc structural type, F-arch-6/F-arch-7 LoC budget) | Internal hygiene. No public API change. |
| `/dogfood` anchor scenario evidence collection (S1: Claude Code auto-memory backed by TheMemory) | The single gate blocking v1.0. P0 sub-goal 2. |
| **`p0-api-sdk-mcp-correctness-audit`** SHIPPED 2026-06-04 (14 tasks × 17 commits; `cb63d87` HEAD) — APIs + SDKs + MCP closed in one cycle | All 8 root exports + 41 contract exports JSDoc + `@see` closure; 13 subpath smoke gates + 9 bundle isolation gates; paper-name violations 74 → 0; `themory mcp` dist-boot sentinel against `node dist/agent-tools/cli.js mcp`. P0 sub-goals 1 + 2 + 3 declared CLOSED at cycle close (local-build perspective). |
| **`p0-api-sdk-mcp-correctness-audit-fixes-cycle-1`** SHIPPED 2026-06-04 (11 tasks × 6 commits; `5b48193` HEAD) — post-`/review` fix-cycle | Closes 1 CRITICAL (F-dom-api-1 bin/files mismatch: post-install `npx @usetheo/memory mcp` would `Cannot find module './run-mcp-server.js'`) + 5 MAJOR + 1 absorbed MUST FIX (EC-1: `dist/local/migrations/*.sql` not shipped → `themory migrate` post-install would reproduce F-T7-1-3 per `architecture.md § 10.1`). `package.json#files` extended with `dist/**/*.js` + `dist/**/*.d.ts` + `dist/**/*.sql`. Pack manifest 172 → 415 entries; dist/ 1 → 244; dist migrations 0 → 12. P0 sub-goal 3 now EMPIRICALLY closed for third-party install (not just local-build). |
| v0.5 TheoCloud runtime (Item 7) | Blocked by Theo PaaS GA; if PaaS lands during P0, cloud runtime ships AS hardening of the contract surface (not as a new feature — the contract was always two-runtime per Locked Names). |

### P0 closure criteria (when do we lift the freeze?)

All three MUST be true:

- **Sub-goal 1 (APIs correct)** — `npm run typecheck` zero errors; `npm run lint` zero warnings; every public export has a `@see` cross-ref to the plan/blueprint that introduced it; no `@deprecated` markers older than 30 days; no `// TODO` / `// FIXME` in `src/`; `no-paper-names-in-code.md` grep shows zero hits in `src/**/*.ts`.
- **Sub-goal 2 (SDK functional)** — every subpath in `package.json#exports` has a passing smoke import test; bundle isolation tests pass; THE GOAL TEST of every shipped Item still passes; `/dogfood` gate returns `EVIDENCE_SUFFICIENT` per `dogfood-golden-rule.md`.
- **Sub-goal 3 (MCP available)** — `themory mcp` boots from a fresh `npx @usetheo/memory mcp` AFTER the package is published OR from the published Docker image; tested by a third-party reproducer.

Only the project owner signs off the P0 closure. After closure, Phase IV items unfreeze.

### Honest disclosure

This directive does NOT change the README Status (`Pre-release`), the locked names, the voice & tone, or the 3 root overrides. It does NOT delete any Roadmap item from history. It SCOPES forward work to hardening only. Per Inquebrável Rule 3 (extreme honesty), any future commit that introduces a new feature outside this scope must be reverted OR re-classified as in-scope with explicit rationale.

---

## What this project is

`@usetheo/memory` (TheMemory) is the **managed three-tier memory layer** of the [Theo](https://usetheo.dev) ecosystem. **vector-based hybrid architecture** (vector + LLM fact extraction + hybrid retrieval), with three scope tiers (**User / Session / Agent**), shipping in two runtimes (**local** Postgres + pgvector for dev/CI, **TheoCloud-managed** for production). **MIT-licensed.** Native to [TheoKit](../theokit) by design.

Positioned as a **Community auxiliary** of Theo, alongside [`@usetheo/sdk`](../theokit-sdk) and [`@usetheo/ui`](../theo-ui). **Pre-release** (contract being locked; no package published yet) — single exception to the monorepo's "every product is production-ready" claim (2026-05-15 lock).

**Strategic positioning:** the managed memory line item on the TheoCloud invoice. Analog: Vercel KV ↔ Vercel. Lock-in to TheoKit + TheoCloud is a deliberate feature, not an accident — see `## Architectural Decisions Locked` below.

---

## Feature Status (canonical reading — 2026-06-04)

**TL;DR.** The system is feature-ready for the majority of vector-based hybrid OSS use cases AND for standalone REST/Docker/MCP consumers. The system is **NOT production-ready by project policy** — `/dogfood` gate returns `EVIDENCE_INSUFFICIENT` (Roadmap Item 11 + `dogfood-golden-rule.md`).

### What works today (consumer can use it now)

| Capability | Subpath / API surface | Roadmap Item | Caveat |
|---|---|---|---|
| 4-verb API (remember / recall / forget / reflect) + 3-tier scope (User / Session / Agent) | `@usetheo/memory` default barrel | 1, 2 | None |
| skill-based skill memory (4th tier `Repo` via `Memory.skills(repoId)`) | `Memory.skills(repoId)` | 8 + ADR-0010 | TheoCode wiring integration test pending |
| Reflection pipeline (manual + threshold + sleep-time policies) | `ReflectionPolicy` DIP | 5 | None |
| Forgetting with long-tail preservation (Ebbinghaus + LRU + LLM importance + isolation guardrail) | `Memory.forget(id, { hard? })` + `EvictionPolicy` DIP | 6 | Demo wiring `createLocalMemory({ eviction })` paused (race-condition `b2909ff` — SDK direct path works) |
| Distillation (episodic → semantic with LLM-judged conflict resolution) | `ConflictResolutionPolicy` 9th DIP via `reflect({ conflictResolution })` | 9 | LLM-MEASURED p=r=1.000 on 10 hand-authored contradictions; procedural-fixture quality untested |
| Independent benchmarks (LongMemEval / LoCoMo / DMR fixtures + multi-judge panel) | `benchmarks/` + `BenchmarkAdapter` 10th DIP | 10 | TheMemory smoke-validated only; REDACTED/REDACTED/REDACTED cells DEFERRED per Drift-T6.x-1 |
| Multi-peer attribution + bi-temporal `asOf` in local OSS tier (MIT, vs REDACTED AGPL / REDACTED) | `RememberOptions.attributedTo` + `RecallOptions.{asOf, attributedTo}` | 12 (v1.1) | EC-9 skill-scope `asOf` deferred to follow-up cycle |
| Semantic recall cache (13th DIP at the `recall()` layer, query-embedding cosine, write-trigger invalidation, 3 OTel metrics) | `createLocalMemory({ recallCache })` + `@usetheo/memory/cache-pg` | 19 (v1.5) | THE GOAL TEST hit rate 0.60 on 10 hand-authored pairs; skill-scope cache wiring deferred to v1.5.x per ADR D10 of fixes-cycle-1 |
| TheoKit-native binding (auto-scope from `ctx.session.userId`) | `@usetheo/memory/theokit` | 3 (v0.2 PR-A) | PR-B (scaffolded `create-theo` templates + E2E) pending in sibling `theokit` repo |
| MCP agent tools (stdio + streamable-HTTP transports) | `@usetheo/memory/agent-tools` | 4 (v0.3) | None |
| REST API server (Hono + OpenAPI 3.1 + Bearer auth + 12th DIP `AuthVerifier`) | `@usetheo/memory/server` | 16 | None |
| Docker stack (distroless Node 22 image at `ghcr.io/usetheo/themory:0.1.0-alpha`, 199.7 MB) | `docker-compose.prod.yaml` + Trivy CRITICAL+HIGH gate | 17 | `ghcr.io/...:0.1.0-alpha` tag-published; no semver release yet |
| Consolidated CLI (`themory {mcp,server,migrate,health}`) | `themory` bin (alias `themory-mcp` retained 1 release) | 18 | Verbs-as-CLI (`themory remember`/`recall`) deferred to P1 |
| Parametric embedding dim (384 via Xenova MiniLM, no API key) + OpenRouter env-shift | `LocalTransformerEmbedder` at `@usetheo/memory/embedders/local` | adapters-openrouter-local-embedder | TheoKit Agent itself still requires valid `THEOKIT_API_KEY` |

### What is planned (not built yet)

| Capability | Blocker | Roadmap Item |
|---|---|---|
| **TheoCloud managed runtime + multi-region** | Theo PaaS GA | 7 (v0.5) |
| **`production-ready` label / v1.0 contract freeze** | `/dogfood` `EVIDENCE_SUFFICIENT` (anchor scenario ≥ 30 days) + independent v0.8 benchmark reproduction | 11 (v1.0) |
| Adaptive retrieval (Self-RAG / CRAG / Adaptive-RAG hooks) | None (next major after v1.0) | 13 (v1.2) |
| Optional graph backend (`@usetheo/memory/graph` via Apache AGE / Neo4j) | None | 14 (v1.3) |
| Domain ontologies (typed schemas: medical / legal / code / support) | Depends on Item 9 | 15 (v1.4) |
| Scaffolded TheoKit templates + default-on memory + E2E | Sibling `theokit` repo PR-B | 3 (v0.2 PR-B) |

### Production-ready gate (Item 11)

The `production-ready` token is **deliberately blocked** by two hard gates per `dogfood-golden-rule.md` + Roadmap Item 11:

1. **`/dogfood` gate** = `EVIDENCE_INSUFFICIENT` (persistent audit 2026-05-31 `6f7ff87`). Two hard caps firing: `anchor_not_running` (anchor scenario "Claude Code auto-memory backed by TheMemory" S1 status = `planned`) + `no_anchor_evidence` (0 evidence files). Gate blocks the v1.0 promotion until the anchor scenario runs ≥ 30 days with evidence logs.
2. **Independent v0.8 benchmark reproduction** = NOT yet logged at `benchmarks/reproductions/`. Item 10 smoke-validated TheMemory cells only; competitor cells (REDACTED / REDACTED / REDACTED) deferred to vendor-SDK wiring.

Until BOTH gates close: README Status stays `Pre-release`, no `production-ready` badge, no `production-grade` claim in any public copy. Every shipped cycle since 2026-05-31 honors this in its CHANGELOG/commit message — see § Inviolable Rule 3.

### Per-audience readiness

| Audience | Ready? | Path |
|---|---|---|
| vector-based hybrid pgvector OSS consumer | YES | `@usetheo/memory` default barrel + `runMigrations(pool)` |
| TheoKit-native app | YES (PR-A) | `@usetheo/memory/theokit` + `memoryFromCtx(ctx, memory)` |
| MCP-aware agent loop (any framework) | YES | `themory mcp` OR `@usetheo/memory/agent-tools` |
| Audit/replay (bi-temporal `asOf`) | YES (v1.1) | `recall({ asOf })` — memory scopes; skill scope deferred |
| Multi-peer attribution (`attributed_to`) | YES (v1.1) | `recall({ attributedTo })` + LLM extraction N-valent |
| Semantic-cache opt-in | YES (v1.5) | `createLocalMemory({ recallCache: { threshold: 0.8 } })` |
| Standalone Docker / REST | YES | `docker compose up` against `ghcr.io/usetheo/themory:0.1.0-alpha` |
| TheoCloud / SaaS managed | NO | Blocked by Theo PaaS GA (Item 7) |
| Graph queries (REDACTED/REDACTED) | NO | Item 14 (v1.3) planned |
| Domain ontologies (medical/legal) | NO | Item 15 (v1.4) planned |
| Adaptive retrieval (Self-RAG hooks) | NO | Item 13 (v1.2) planned |
| **`production-ready` label** | **NO** | Blocked by `/dogfood` gate + benchmark reproduction (Item 11) |

---

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
| Memory tiers | `User` · `Session` · `Agent` (+ `Repo` for skills only, v0.6, [ADR-0010](.claude/knowledge-base/adrs/ADR-0010-repo-scope-fourth-tier.md)) | strategic |
| API verbs | `remember` / `recall` / `forget` / `reflect` | strategic |
| Two runtimes | `local` (Postgres + pgvector) + `cloud` (TheoCloud-managed) | strategic |
| Subpath exports | `@usetheo/memory` (local default) + `@usetheo/memory/cloud` (managed) | strategic |

---

## Voice and Tone

**Locked 2026-05-21** (Option A strategic review — 7th OSS adopter, completing the monorepo's voice contract). TheMemory has adopted the aspirational voice originally scoped to TheoKit. The operational guide — three communication layers (HERO / BODY / DEEP DIVE), vocabulary translation, banned terms list, storytelling rules, before/after examples — lives in [`../theokit/CLAUDE.md`](../theokit/CLAUDE.md). Read it before writing any public copy for this project. This file does not duplicate it.

**Applies to:**

- `README.md` HERO + BODY + "Why" + "What you'd ship" sections (everything above the `## How it works` delimiter)
- Future `PITCH.md` if added
- Site copy referencing TheMemory on `usetheo.dev` and `docs.usetheo.dev`
- Launch material, blog posts

**Does NOT apply to (stays technical-direct):**

- `README.md` from `## How it works` downward — Status section, Planned API contract, Architecture, Foundation, Roadmap, Where this fits
- This `CLAUDE.md`, `CHANGELOG.md`, source code, JSDoc, inline comments
- Migration guides, runbooks, ADRs

**Cross-project narrative anchors that must hold (regardless of voice):**

- **Managed memory of TheoCloud, optimized for TheoKit** — the consolidation pitch. Comparable: Vercel KV ↔ Vercel.
- **Lock-in is a feature, owned explicitly** — not apologized for. The TheoKit-native binding + TheoCloud managed runtime are designed as deep coupling. Local mode stays open for users who want to walk away.
- **vector-based hybrid architecture** — vector + LLM extraction + hybrid retrieval (semantic + BM25 + entity matching). Two-stage write pipeline. ADD-only.
- **Three tiers (User / Session / Agent)** — mapped 1:1 onto REDACTED's `user_id` / `agent_id` / `run_id` filter shape internally. Public API uses scoped sub-object form (`memory.user(id).remember(...)`) for type narrowing.
- **MIT license is intentional** — explicit exception to the monorepo Apache-2.0 standard (locked 2026-05-14). For maximum permissiveness in a memory primitive consumers embed deeply into proprietary systems.
- **Pre-release is honest** — never claim production-ready until v1.0 with reproduced benchmarks. Breaks the consistency with the other 6 sub-projects' "production" status deliberately.
- **Cross-Project Rule 9 (Cloud abstraction)** — cloud runtime user-copy says `memory store`, NEVER `REDACTED` / `pgvector` / `vector engine` / `vector store engine` etc.

If a piece of TheMemory copy contradicts the locked narrative in [`../CLAUDE.md`](../CLAUDE.md) or the operational rules in [`../theokit/CLAUDE.md`](../theokit/CLAUDE.md), the root and TheoKit rules win — surface the conflict before publishing.

---

## Architectural Decisions Locked

Decisions taken during the project's design phase that override root contract defaults.

### Three explicit overrides of root `CLAUDE.md` (2026-05-21)

The strategic review of 2026-05-21 documented three explicit overrides of the root meta-contract. **All three confirmed by the project owner.** Re-opening any requires a new strategic review.

- **Cross-Project Rule 6 — vendor lock-in exception.** TheoKit + TheMemory + TheoCloud is a deliberate single-platform consolidation. Walk-away from this specific combination costs a memory migration. Local OSS runtime stays open; the rest of the funnel remains lock-in-free. Source: root `CLAUDE.md` § Cross-Project Rules 6.
- **Phase 1 scope expansion — TheoCloud completeness.** TheMemory enters Phase 1 as expansion of TheoCloud capacity, NOT as a 7th vertical productization. Classified as "line item on the TheoCloud invoice", analog Vercel KV. Source: root `CLAUDE.md` § Phase (now), "Expanded into scope 2026-05-21".
- **License standardization exception — MIT instead of Apache-2.0.** The 2026-05-14 license standardization mandates Apache-2.0 for every OSS product. TheMemory is the explicit MIT exception, for maximum permissiveness in proprietary embeds. Source: root `CLAUDE.md` § Product Hierarchy footnote.

### Fourth scope tier — RepoScope (2026-05-30, v0.6)

- **ADR-0010 — `RepoScope` for skill memory.** `Memory.skills(repoId)` returns a `ScopedSkillMemory` bound to `RepoScope{ kind: 'repo', repoId }`. Exposed ONLY through `Memory.skills(...)` (not on the public 4 verbs); maps internally to `filters.agent_id` per EC-4. Extends ADR-0002's 3-tier contract; does not soften it. Source: [`ADR-0010-repo-scope-fourth-tier.md`](.claude/knowledge-base/adrs/ADR-0010-repo-scope-fourth-tier.md).

### Bi-temporal runtime lift (2026-06-03, v1.1)

- **ADR-0011 supplementary** — v1.1 LIFTS the ADR-0006 runtime-clause: local `recall({ asOf })` is honored via null-safe predicate `(t_valid IS NULL OR t_valid <= asOf) AND (t_invalid IS NULL OR t_invalid > asOf)`. Schema clause of ADR-0006 (columns since v0.1) is REINFORCED — REDACTED Apache-2.0 prior art (blueprint Q6) validates the same shape. `BiTemporalNotSupportedLocally` class still exported (cloud retains the option; `@deprecated for local`). CAVEAT: EC-9 skill-scope `asOf` deferred to follow-up cycle.

---

## Roadmap

Source of truth for status changes: this file + `README.md` § Status + `README.md` § Roadmap. If this file and the root `CLAUDE.md § Roadmap por Domínio` disagree, update both in the same PR.

Items grouped by status: **Shipped** → **Pending** → **Cut / deferred** → **Foundation artifacts (audit trail)**.

### Shipped (consumer can use today)

| Nº | Name | Acceptance + caveat | Shipped |
|---|---|---|---|
| 1 | **v0.0 — Contract design** | `tsc --noEmit` passes on `src/core/**/*.ts`. 5 DIP interfaces declared with method counts per ADR-0008. Nine ADRs locked (ADR-0001 → ADR-0009) covering vector-based hybrid, three-scope, ADD-only, API verbs, reflection trigger, bi-temporal local schema, entity-store opt-out, DIP method counts, cloud auth. | 2026-05-22 (PR #4) |
| 2 | **v0.1 — Core + local runtime** | Eight-phase write pipeline + 9-step search (additive scoring) + over-fetch + per-row fallback + auto-dim probe (1536 cap per pgvector 0.5.1 HNSW limit). In-memory adapter (unit tests) + pgvector adapter (raw SQL). THE GOAL TEST: `remember + recall` round-trip in top-3 against real `ankane/pgvector:v0.5.1`. Total: 229 contract + 28 integration = 257. Zero CRITICAL/HIGH CVE. | 2026-05-23 (PR #8) |
| 3 | **v0.2 PR-A — TheoKit binding** | `@usetheo/memory/theokit` resolves `user_id` via `memoryFromCtx(ctx, memory)`. Structural typing, ZERO peer-dep on theokit. Isolation test PASS. CAVEAT: PR-B (scaffolded `create-theo` templates + E2E) pending in sibling `theokit` repo. | 2026-05-23 (PR #11) |
| 4 | **v0.3 — Agent tools (MCP)** | `@usetheo/memory/agent-tools` exposes 4 verbs as MCP tools. Stdio + streamable-HTTP transports + AsyncLocalStorage scope binding. End-to-end via `tests/e2e/agent-tools/round-trip.test.ts`. | 2026-05-25 (PR #17 + hardening #18) |
| 5 | **v0.4a — Reflection pipeline** | `ReflectionPolicy` DIP shipped with 3 impls: `ManualReflectionPolicy` + `ThresholdReflectionPolicy` + `SleepTimeReflectionPolicy`. THE GOAL TEST: 50 memories → reflect() → ≥ 1 derived row with provenance. | 2026-05-23 (commit `494bceb`) |
| 6 | **v0.4b — Forgetting with long-tail preservation** | `TriadicScoringPolicy` (Ebbinghaus + LRU + LLM-judged importance) wired via `EvictionPolicy` DIP per ADR D12. `CapacityBasedTrigger` (post-remember) + `TimeBasedTrigger` (cron) + `PgEvictor` (soft-delete via `t_invalid`). THE GOAL TEST: `recall@10 = 1.000` on 1000-memory × 50-rare-query set. **PUBLIC API BREAKING**: `Memory.forget(id, options?: ForgetOptions)` widens with `hard?: boolean` (GDPR escape hatch). CAVEAT: Demo wiring `createLocalMemory({ eviction })` paused via hotfix `b2909ff` (race condition F-T4.1-2); SDK direct path works (67/67 integration). | 2026-05-31 (PR #24 merge `9a8bca3`) |
| 8 | **v0.6 —  skill library** | `Memory.skills(repoId)` returns `ScopedSkillMemory` exposing 4 skill verbs. Hash identity via `hashFact(description)`. Scope-isolated forget (v0.6.1 T4.1 EC-2). THE GOAL TEST: 2 semantically-equivalent skills → consolidate → 1 derived with both source IDs in `derivedFrom`. v0.6.1 fixes-cycle closed 2 CRITICAL + 8 MAJOR + 13 MINOR. CAVEAT: TheoCode integration test (cache-hit metric > 0) still pending. | 2026-05-30 (`feat/v0-6-skill-library`); v0.6.1 fixes `b6aead6` |
| 9 | **v0.7 — Episodic→Semantic distillation** | `ConflictResolutionPolicy` 9th DIP + 3 impls (Noop / LastWriteWins / LlmJudgedMergeConflictPolicy) + reflect() wiring + migration `0007_distillation_columns.sql` (consolidation_history table with `ON DELETE SET NULL` FK for GDPR survival). v0.7.1 LLM-MEASURED: precision = recall = conflict-resolution accuracy = 1.000 on 10 hand-authored contradictions via `openai/gpt-4o-mini`. CAVEAT: 1.000 reflects 10/10 unambiguous fixtures; broader procedural-fixture quality untested at LLM surface (v0.7.2 if needed). | 2026-06-02 (HEAD `83a8eb5` + paper-name cleanup `f7f14e6`) |
| 10 | **v0.8 — Independent benchmark reproduction** | `BenchmarkAdapter` 10th DIP + 4 adapter implementations + runner orchestrator + multi-judge panel via OpenRouter (NO `@anthropic-ai/sdk` per user directive). LongMemEval / LoCoMo / DMR fixture loaders. Matrix at `docs/benchmarks/v0.8.md`. v0.8-fixes-cycle-1 absorbed `/plan-confidence` INVALID 34.3/100. CAVEAT: TheMemory smoke-validated only; REDACTED/REDACTED/REDACTED cells DEFERRED per Drift-T6.x-1 (VendorClient DIP shipped but SDK wiring deferred). **`/dogfood` gate STILL `EVIDENCE_INSUFFICIENT`** — benchmarks alone do NOT unblock production-ready. | 2026-06-02 |
| 12 | **v1.1 — Multi-peer attribution + Bi-temporal local-runtime lift** | `attributed_to` as first-class promoted column on `memories` (migration `0008_attributed_to.sql`). `recall({ asOf })` honored via null-safe predicate against `t_valid`/`t_invalid` (ADR-0011 supplementary supersedes ADR-0006 runtime clause). N-valent attribution semantic per blueprint Q5 — attacks REDACTED's AGPL-3.0 moat under MIT. THE GOAL TEST 7/7 PASS. CAVEAT: EC-9 skill-scope `asOf` deferred per plan v1.3 ADR D4 amendment. 3 pre-existing-debt MAJOR (F-arch-2/6/7) deferred to refactor cycle. Pre-v1.1 rows have `attributed_to=NULL` permanently per EC-1 honest no-backfill. | 2026-06-03 (PR #28 merge `0433484`) |
| 16 | **REST API server (`@usetheo/memory/server`)** | Hono + RPC-mirror endpoints `POST /v1/{remember,recall,forget,reflect}` + `GET /v1/health` + `GET /v1/health/db` + `GET /v1/scopes/:type/:id/memories` + `GET /v1/openapi.json`. Bearer-token auth via `THEMEMORY_API_KEY`. 12th DIP `AuthVerifier` for future OAuth/JWT swap. OpenAPI 3.1 spec auto-derived from zod schemas. OTel spans per handler. 1 MB body-limit DOS guard. Single-scope-tier enforcement via zod `.strict().superRefine()` per ADR D12. | 2026-06-03 (`theo-memory-standalone-p0` chain) |
| 17 | **Docker stack** | Multi-stage Dockerfile (Node 22-bookworm-slim builder → distroless runtime). `ghcr.io/usetheo/themory:0.1.0-alpha` at 199.7 MB (under 200 MB target). ENTRYPOINT direct Node per ADR D13 (no `docker-entrypoint.sh` — migrate-on-startup discipline inside `themory server`). GitHub Actions publishes to GHCR with Trivy CRITICAL+HIGH gate. THE GOAL TEST: `docker compose up` round-trips against the published image. | 2026-06-03 |
| 18 | **CLI consolidado `themory`** | `themory {mcp,server,migrate,health}` — replaces standalone `themory-mcp` bin with multi-subcommand commander entry preserving backward-compat alias for one release. `themory mcp` reproduces v0.3 behavior. `themory server` binds port EAGERLY while Memory factory warms async (`GET /v1/health` returns 503 `warming_up` per EC-33). `themory migrate` applies pending Drizzle migrations. `themory health --deep` smoke-validates embedder + LLM. Both `themory server` AND `themory mcp` emit 3-line stub-embedder stderr disclosure on startup per Inquebrável Rule 3 honesty. CAVEAT: Verbs-as-CLI (`themory remember`/`recall`) DEFERRED to P1. | 2026-06-03 |
| 19 | **v1.5 — Semantic recall cache** | Cache `recall()` results at the `recall()` layer keyed by query-embedding cosine. 13th DIP `RecallCacheStore` (4 methods within ADR-0008 cap). `PgvectorRecallCacheStore` default impl. Write-trigger scope invalidation on remember/forget/reflect. SERIALIZABLE-isolated LRU eviction. 3 OTel metrics (Counter + 2 Histograms). Subpath `@usetheo/memory/cache-pg` with EC-26 bundle isolation (dynamic-import). THE GOAL TEST hit rate **0.60** on 10-pair hand-authored fixture set (Xenova MiniLM 384-dim, threshold 0.8) against real `ankane/pgvector:v0.5.1`. Post-merge `/review` `READY_TO_MERGE_WITH_CAVEATS` (10 MAJOR). 3 MAJORs closed inline via `c47e5ac`; remaining 7 in `semantic-recall-cache-v1-5-fixes-cycle-1` (4 of 8 task commits shipped: T0.1 `0589a8f`, T1.1 `bae2fda`, T2.1 `595ef01`, T2.2 `e7eb240`). CAVEAT: hit rate 0.60 reflects chosen fixture distribution. Skill-scope cache wiring deferred to v1.5.x per ADR D10. **`/dogfood` gate STILL `EVIDENCE_INSUFFICIENT`** — v1.5 does NOT unblock production-ready. | 2026-06-03 + fixes-cycle-1 in flight |

### Pending (not built yet)

**Pre-P0 trichotomy:**

- **(a) On the P0 critical path** — items whose blocker IS the P0 sub-goals. Continue under hardening.
- **(b) FROZEN under P0** — no work until P0 closes. The Roadmap entry stays for audit history.
- **(c) Cross-repo dependency** — waiting on sibling repo; not blocked by P0 directly.

| Nº | Name | Acceptance + dependency | P0 classification |
|---|---|---|---|
| 11 | **v1.0 — Contract stable / `production-ready` label** | (a) `docs/benchmarks/v0.8.md` exists + ≥ 1 external reproduction logged in `benchmarks/reproductions/`. (b) `/dogfood` returns `EVIDENCE_SUFFICIENT` (anchor scenario "Claude Code auto-memory backed by TheMemory" running ≥ 30 days). README Status flipped to `Production-ready` in same PR that bumps to v1.0. **Current state (persistent audit 2026-05-31 `6f7ff87`):** `EVIDENCE_INSUFFICIENT`; hard caps firing: `anchor_not_running` + `no_anchor_evidence`. The gate is correctly blocking. **Depends:** Item 10 + `/dogfood` infra (shipped 2026-05-22) | **(a) On P0 critical path** — P0 sub-goal 2 directly covers `/dogfood` closure |
| 7 | **v0.5 — TheoCloud runtime + multi-region premium** | `@usetheo/memory/cloud` subpath imports cloud client (bundle-size gate). `THEOKIT_API_KEY` auth flow against staging. Multi-region failover. (Bi-temporal `asOf` MOVED to v1.1 local OSS tier per ADR-0011; cloud premium narrows to multi-region + audit-mgmt + managed embedding pricing.) **Depends:** Item 2 + Theo PaaS GA | **(a) Conditional** — if PaaS lands during P0, cloud runtime ships AS hardening of the contract surface (not a new feature) per P0 § "What CONTINUES" |
| 3 (PR-B) | **v0.2 PR-B — Scaffolded TheoKit templates + E2E** | T4.1-T4.4 + T5.1 from v0.2 plan ADR D7: default-on memory in scaffolded TheoKit apps. **Depends:** sibling `theokit` repo PR | **(c) Cross-repo dependency** — sibling repo work; not blocked by P0 directly. Ship when sibling lands. |
| 13 | **v1.2 — Adaptive retrieval** | `shouldRetrieve` + `wasRetrievalGood` decision hooks (Self-RAG / CRAG / Adaptive-RAG patterns). | **(b) FROZEN under P0** — no plans, no PRs, no discovery cycles |
| 14 | **v1.3 — Optional graph backend** | `@usetheo/memory/graph` adapter for KG-style queries. Backend: Postgres + Apache AGE OR Neo4j. | **(b) FROZEN under P0** |
| 15 | **v1.4 — Domain ontologies** | Typed schemas per domain (medical / legal / code / support) layered over LLM extraction. | **(b) FROZEN under P0** |

### Items cut / deferred (audit trail)

| Item | Status | Rationale |
|---|---|---|
| Adapters (REDACTED, REDACTED, REDACTED) | Out of scope (cut 2026-05-21) | Focus on being native backend, not wrapper. `@usetheo/sdk` already ships 3 `MemoryAdapter` packages (2026-05-20) for that use case. |
| Recency × importance × relevance scoring | Deferred to v0.4a behind strategy interface | README v1 promised; locked 2026-05-21 — v0.1 ships additive REDACTED-style (production-tested). Multiplicative becomes opt-in strategy at v0.4a. |
| Demo `examples/chat-with-memory` eviction wiring via `createLocalMemory({ eviction })` | Deferred to follow-up cycle (paused 2026-05-31 via hotfix `b2909ff`) | F-T4.1-2 regression: when eviction is enabled AND `rememberTurn` calls `Promise.all([userScoped.remember, sessionScoped.remember])` in parallel, the `postRememberHook` + `CapacityBasedTrigger.fire` pipeline consumes user-scope rows even with scope size 0. Race-condition root cause; debugging deferred. Core eviction WORKS via the SDK direct path (integration suite 67/67 PASS); the disabled wiring is consumer-demo-only. |
| EC-9 skill-scope `asOf` (`memory.skills(repoId).recall({ asOf })`) | Deferred to follow-up cycle per plan v1-1 v1.3 ADR D4 amendment | v1.1 ships `asOf` for memory scopes only. Skill-scope adds extra ADR-0010 coordination — kept v1.1 focused. |
| Repo-tier semantic cache wiring (`memory.skills(repoId).recall()` does NOT consult cache) | Deferred to v1.5.x per `semantic-recall-cache-v1-5-fixes-cycle-1` ADR D10 | `ScopeTierTtlConfig.repo` REQUIRED in public DIP but `LocalScopedSkillMemory.recall()` skip cache. Mirrors v1.1 EC-9 honest deferral precedent. |

### Foundation artifacts (audit trail)

Detailed history of infrastructure cycles. Source-of-truth for "what landed when" beyond the macro Items table above.

| Artifact | Shipped |
|---|---|
| `.claude/knowledge-base/references/` clones (REDACTED + REDACTED + REDACTED, `--depth 1`, gitignored) | 2026-05-21 |
| `README.md` + strategic placement (Community auxiliary MIT, TheoKit-native, vector-based hybrid, two runtimes) | 2026-05-21 |
| This `CLAUDE.md` (3 root overrides + RepoScope ADR-0010 + ADR-0011 supplementary) | 2026-05-21; updated 2026-05-30, 2026-06-03, 2026-06-04 (x3 — PRIORITY 0 lock + p0-api-sdk fix-cycle close) |
| `examples/chat-with-memory/` Next.js demo (4 tabs over User/Session/Skills/History) | 2026-05-30 (`22f148b`) |
| `.claude/skills/test-chat-with-memory/` exhaustive E2E skill (30 scenarios via Chrome DevTools MCP) | 2026-05-30 (`069a257`) |
| v0.6.1 skill-library-fixes cycle (14 commits; verdict `READY_TO_MERGE`) | 2026-05-30 (`b6aead6`) |
| `chat-with-memory-e2e-fixes` cycle (4 commits; `/test-chat-with-memory READY 30/30`) | 2026-05-30 (`9e09bb9`) |
| **PR #24 — Release `develop` → `main`** (85 commits: v0.4b-fixes + v0.6 + v0.6.1 + chat-with-memory-e2e-fixes + v0.4b-forgetting) | 2026-05-31 (`9a8bca3`) |
| `examples-chat-with-memory-v0-4b-expansion` cycle (12 commits T0.1 → T6.1 + SEPA iter logs) | 2026-05-31 + hotfix `b2909ff` (F-T4.1-2 demo eviction regression) |
| `/dogfood` first persistent audit (`EVIDENCE_INSUFFICIENT`; 2 hard caps: `anchor_not_running` + `no_anchor_evidence`) | 2026-05-31 (`6f7ff87`) |
| `adapters-openrouter-local-embedder` cycle (`LocalTransformerEmbedder` + parametric `embeddingDim` + atomic dim-change pipeline) | 2026-06-02 (`4b5b0e7` → `aec5c33`) |
| **PR #28 — Release `develop` → `main`** (269 commits: v0.4b expansion + v0.7 distillation + v0.8 benchmarks + v1.1 + v1.1 fix-up cycle 2) | 2026-06-03 (`0433484`) |
| `theo-memory-standalone-p0` chain (Items 16 + 17 + 18) | 2026-06-03 |
| `p0-api-sdk-mcp-correctness-audit` cycle (14 tasks; THE GOAL TEST 42/42; paper-names 74→0; 12 new p0-audit/ integration files; declared P0 sub-goals 1+2+3 CLOSED from local-build perspective) | 2026-06-04 (`cb63d87`) |
| `p0-api-sdk-mcp-correctness-audit-fixes-cycle-1` cycle (11 tasks × 6 commits; closes 1 CRITICAL + 5 MAJOR + 1 absorbed MUST FIX EC-1 dist sql migrations; pack manifest 172→415; P0 sub-goal 3 EMPIRICALLY closed for third-party install) | 2026-06-04 (`5b48193`) |

---

## Relationship to other pillars

| Pillar | Project | Current integration (verify before claiming) |
| --- | --- | --- |
| Apex (runtime) | [TheoCloud](../theo) | Cloud runtime depends on Theo PaaS GA. No code today. v0.5 milestone. |
| Framework | [TheoKit](../theokit) | `@usetheo/memory/theokit` subpath ships v0.2 PR-A (PR #11). `memoryFromCtx(ctx, memory)` auto-scopes via structural typing (zero peer-dep, ADR D1). T4.1-T4.4 + T5.1 in sibling `theokit` repo PR-B pending. |
| Harness | [`@usetheo/sdk`](../theokit-sdk) | `@usetheo/memory/agent-tools` exposes 4 verbs as MCP tools consumable by any MCP-aware agent loop. `@usetheo/sdk` already ships its own `MemoryAdapter` interface + 3 adapter packages (2026-05-20) — different surface; TheMemory is the runtime, not the adapter. Future: `@usetheo/sdk` may accept TheMemory as a `MemoryAdapter` target. |
| UI | [`@usetheo/ui`](../theo-ui) | `MemoryEditor` primitive already exists in `@usetheo/ui` (one of 81 primitives). Natural consumer of TheMemory's API. No wiring today. |
| Coding assistant | [`theo-code`](../theo-code) | TheoCode has its own memory subsystem (`crates/theo-infra-memory/`). Different domain — no shared code planned. |

> "Do not invent integration that does not exist yet." (Root `CLAUDE.md` Cross-Project Rule 2.) Verify the actual import / dependency before claiming wiring exists in copy.

---

## Competitive superiority matrix

How each roadmap item maps to a specific competitor weakness.

| Competitor | Their moat | Our attack | Roadmap item(s) |
|---|---|---|---|
| **REDACTED** ($24M) | Drop-in simplicity, vector-centric, large provider catalog | Same architecture + reflection + long-tail forgetting + REDACTED skill library + bi-temporal local OSS (v1.1) + multi-region premium cloud (v0.5) + TheoKit-native default-on | 2, 5, 6, 7, 8, 3, 12 |
| **REDACTED** ($10M) | Function-calling memory + sleep-time agents | Function-calling memory **without** agent-loop lock-in (we are primitive, not framework) | 4, 5 |
| **REDACTED/REDACTED** (YC W24) | Bi-temporal knowledge graph with audit | Bi-temporal queries (`asOf`) shipped in v1.1 local OSS (MIT) — REDACTED's headline feature now commodity under our license. Multi-region replication + audit-mgmt remain the v0.5 cloud premium. Graph backend separately tracked as Item 14 (v1.3). | 12, 7, 14 |
| **REDACTED** ($5.35M) | Theory-of-mind / identity modeling | Multi-peer `attributed_to` **without** AGPL restriction (MIT) | 12 |
| **REDACTED** | Ontologies + poly-store | Typed domain ontologies without poly-store complexity | 15 |
| **REDACTED** | Procedural memory via prompt rewriting | Procedural skill library **with** automatic refactoring (, ships executable code not just prompts) | 8 |
| **All competitors (REDACTED/REDACTED/REDACTED/REDACTED)** | No documented read-side query cache layer | Semantic recall cache via query-embedding cosine — caches `recall()` results without re-running pipeline + LLM rerank on near-duplicate queries. Greenfield surface. | 19 |
| **REDACTED Memory** | Block composition with priority truncation | Three-scope tier model + reflection + skill library (their blocks have no identity, no procedural) | 1, 5, 8 |
| **Vector DBs** (REDACTED/REDACTED/REDACTED/etc.) | Multi-tenancy at scale | Real semantic memory primitives (extraction, consolidation, scoring, forgetting) on top of pgvector | 2, 5, 9 |

### Honesty discipline (Inquebrável Rule 3)

- **No production claims** until v1.0 with benchmarks reproduced independently. The README's Status section is the authoritative declaration; never weaken it without a PR-level decision.
- **No `production-ready` badge** in the README or marketing — TheMemory is the explicit exception to the monorepo "production-ready" claim (2026-05-15 lock).
- **Roadmap moves backward via PR with one-line rationale.** Items don't disappear silently. Removed items appear as `Removed` with date and reason.
- **Caveat disclosure is non-negotiable.** Every shipped feature lists its caveats in its `Acceptance + caveat` cell above. No silent omission.

---

## Reference projects (study material)

The `.claude/knowledge-base/references/` directory contains three clones (`--depth 1`, 2026-05-21) used for design study. **Read-only — never `npm install`, `pip install`, or edit them.**

| Project | Tamanho | License | Status of exploration |
|---|---|---|---|
| [`REDACTED`](./.claude/knowledge-base/references/REDACTED/) | 78 MB | Apache-2.0 | Primary architectural reference (vector + LLM extraction + hybrid retrieval) |
| [`REDACTED`](./.claude/knowledge-base/references/REDACTED/) | 34 MB | Apache-2.0 | Postgres + pgvector schema, Alembic migrations, sleep-time agents (reflection design) |
| [`REDACTED`](./.claude/knowledge-base/references/REDACTED/) | 3.9 MB | MIT | Procedural memory via prompt rewriting |

The directory is **gitignored** (see `.gitignore`) — clones never enter git.

---

## Open questions for the contract design (all resolved)

1. ~~**Multi-peer / `attributed_to` support.**~~ **RESOLVED 2026-05-22 → v1.1 (Item 12).** Deferred from v0.0 to keep contract minimal; backward-compat via optional column.
2. ~~**`update()` semantics inside ADD-only.**~~ **RESOLVED 2026-05-22 → [ADR-0003](.claude/knowledge-base/adrs/ADR-0003-add-only-public-api.md).** ADD-only. No public `update()`. Mutation = `forget(id) + remember(newText)`. `history(memoryId)` exists for audit.
3. ~~**Reflection trigger.**~~ **RESOLVED 2026-05-22 → [ADR-0005](.claude/knowledge-base/adrs/ADR-0005-reflection-trigger.md).** Explicit-only at v0.0. Threshold + sleep-time policies land at v0.4a behind same DIP — zero contract change.
4. ~~**Bi-temporal `t_valid` / `t_invalid` columns on local.**~~ **RESOLVED 2026-05-22 → [ADR-0006](.claude/knowledge-base/adrs/ADR-0006-bi-temporal-local-schema.md); AMENDED 2026-06-03 → [ADR-0011](.claude/knowledge-base/adrs/ADR-0011-bi-temporal-local-runtime-gate-lift.md).** v1.1 LIFTS the runtime-clause: local `recall({ asOf })` honored via null-safe predicate. Schema clause REINFORCED. CAVEAT: EC-9 skill-scope `asOf` deferred to follow-up cycle.
5. ~~**Entity store opt-out.**~~ **RESOLVED 2026-05-22 → [ADR-0007](.claude/knowledge-base/adrs/ADR-0007-entity-store-opt-out.md).** Constructor-level flag `MemoryConfig.entityBoost?: boolean` defaults to `true` (REDACTED parity). When `false`, no entity vector store instantiated.
6. ~~**`THEOKIT_API_KEY` reuse.**~~ **RESOLVED 2026-05-22 → [ADR-0009](.claude/knowledge-base/adrs/ADR-0009-cloud-auth-theokit-api-key.md).** Reuse `THEOKIT_API_KEY` env var with optional explicit `apiKey` constructor parameter override. No separate `THEMEMORY_API_KEY` (REST API server (Item 16) uses `THEMEMORY_API_KEY` for bearer auth specifically, distinct from cloud SDK auth).

---

## Inviolable rules (from root and global)

1. **95% confidence gate.** Ask if uncertain. Especially load-bearing for theo-memory — the 4 root overrides are documented because they came from confirming with the project owner explicitly, not from inference.
2. **Task completion gate.** Finish before starting a new task.
3. **Extreme honesty.** Admit ignorance. Surface risks. The single biggest honesty risk here is claiming production-ready before v1.0 + reproduced benchmarks + `/dogfood` `EVIDENCE_SUFFICIENT`.
4. **Git rules.** No `git checkout` or `git revert`. No direct work on `main`.
5. **TDD.** Tests before production code; bug fixes start with a regression test. Especially critical for the LLM-extraction pipeline — write the prompt-output assertion test first.
6. **Changelog discipline.** Every code change updates `CHANGELOG.md`.
7. **Don't reinvent.** `pgvector`, `pg`, `zod` for the schema layer. `@usetheo/sdk`'s LLM client + `MemoryAdapter` for ecosystem reuse. REDACTED's two-stage pipeline is the proven shape — adopt, don't redesign.
8. **No emojis** in code, READMEs, CHANGELOGs, or CLAUDE.md files unless explicitly requested.
9. **No paper names in code** per `.claude/rules/no-paper-names-in-code.md` (promoted 2026-05-30). Knowledge-base docs MAY cite REDACTED / REDACTED / REDACTED / etc.; `src/**` + tests MUST NOT.
10. **PRIORITY 0 freeze** (locked 2026-06-04). No new features outside the 3 P0 sub-goals (API correct + SDK functional + MCP available). Items 13/14/15 + future Phase V expansion are FROZEN until P0 closure. Any commit introducing a feature outside this scope MUST be reverted OR re-classified as in-scope with explicit rationale in the commit body. See § PRIORITY 0 above.

Full text: `/home/paulo/.claude/CLAUDE.md`. Cross-project rules: `/home/paulo/Projetos/usetheo/CLAUDE.md`.

---

## When this file is wrong

The code and the README are authoritative. If this file disagrees with them, the code/README win — update this file via PR with a one-line rationale in the commit message.

**Locked items** require explicit strategic review:

- **Locked names** (npm package, license MIT exception, tier, memory tiers, API verbs, two runtimes, subpath exports) — root-level strategic review.
- **Voice and tone** — root-level strategic review per Voice and Tone section.
- **Three root overrides** (Cross-Project Rule 6 exception, Phase 1 scope, MIT license exception) — root-level strategic review.
- **ADR-0010 RepoScope 4th tier** + **ADR-0011 bi-temporal runtime lift** — project-owner sign-off required.
- **PRIORITY 0 directive** (locked 2026-06-04, GO-TO CTO project-owner sign-off) — lifting the freeze on Items 13/14/15 OR introducing new features outside the 3 P0 sub-goals requires project-owner sign-off recorded in CHANGELOG + CLAUDE.md amendment.

Do not edit any of the above silently. Surface the conflict to the user first.
