## IMPORTANTE — Princípios fundamentais do TheMemory

Estes três princípios são a fonte-de-verdade do design. Antecedem qualquer decisão de schema, contrato de API, política de retrieval ou heurística de scoring. Sempre que houver tensão entre um princípio e uma decisão técnica, o princípio vence.

### Princípio 1 — Nem toda memória tem o mesmo peso.

Relevância é um score contínuo, não um booleano. O sistema combina sinais ortogonais:

- **Frequência / confirmação** — `confirmation_count` bumpa quando o mesmo fato é asserido sob o mesmo escopo (composite UPSERT per ADR D5; surfaces via `MemoryItem.confirmationCount`).
- **Recência** — `last_accessed_at` + `created_at` alimentam decay exponencial via `half_life_seconds` (v0.4b forgetting pipeline).
- **Confiança** — `llm_importance_score` cacheado pela extração LLM (v0.4a).
- **Similaridade semântica** — cosine sobre embeddings (vector-based hybrid 9-step search).
- **BM25 + entity boost** — sinais lexicais e estruturais compostos aditivamente.

O sistema NÃO trata cada chamada `remember` como evento isolado. Quando o mesmo fato chega de fontes diferentes ou momentos diferentes, o sinal de confirmação é reforçado e fica disponível para filtragem (`WHERE confirmation_count > N`), ranking e auditoria.

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
- **`MemoryItem.rejectedAsDuplicate`** — flag consumer-visible: quando `remember` retorna a linha EXISTENTE pós-dedup-collision, o consumidor SABE.
- **Audit tables** — `history` registra remember/forget; `consolidation_history` registra reflect com FK `ON DELETE SET NULL` para survival GDPR; `MemoryItem.derivedFrom` carrega provenance para memórias derivadas (v0.4a reflection, v0.7 distillation).
- **Bi-temporal `t_valid` + `t_invalid`** — `recall({ asOf })` retorna o estado válido em qualquer instante histórico (v1.1 supersedes ADR-0006 runtime clause).

Rastreabilidade é parte do contrato, não opcional. Cada decisão de gravar/ignorar/substituir tem que ser justificável e revisável.

---


# CLAUDE.md — TheMemory

Contract between Claude and the **TheMemory / `@usetheo/memory`** project (the **managed memory** community auxiliary of [Theo](../CLAUDE.md)). Read this file **and** the root `CLAUDE.md` before editing anything here.

This file complements `<HOME>/Projetos/usetheo/CLAUDE.md` and `<HOME>/.claude/CLAUDE.md`. Root rules apply unconditionally. TheMemory-specific rules layer on top.

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

### Amendment 2026-06-17 — Multi-tenant workspace isolation RE-CLASSIFIED as in-scope (project-owner sign-off)

**Project-owner directive (2026-06-17):** the **multi-tenant-flat workspace isolation** model — a `workspaces` tenant boundary resolved from the API-key credential (`AuthVerifier` evolves from `verify(token): boolean` to resolving a `Principal { workspaceId }`), with every query scoped by the Principal's workspace — is hereby **re-classified as IN-SCOPE under PRIORITY 0**, on the explicit rationale that it is **CORE to the system** (the foundation the v0.5 TheoCloud managed runtime, Roadmap Item 7, is built on; the `theo_api_keys.tenant_id='self'` + `subject` columns from Item 20 were already planted as its forward-compat seam).

This is a deliberate scope expansion of P0, signed off by the project owner per the closure-authority rule above. It carries **strategic** weight (it interacts with the locked names "memory tiers" and "two runtimes") and ships a **PUBLIC API BREAKING** change to `AuthVerifier`. Honest disclosure (Rule 3):

- **Slug:** `multi-tenant-workspace-isolation`. Tracked as a new Roadmap row (folds into / unblocks Item 7).
- **Locked-names interaction:** the three memory tiers (`User` / `Session` / `Agent`) are NOT replaced — they remain as within-workspace organizational partitions. `workspace_id` is added as the OUTER tenant anchor, resolved from the credential. The two-runtime contract is unchanged (local OSS gains workspace isolation; cloud is its managed form).
- **Breaking change:** `AuthVerifier.verify` → Principal resolution is a pre-release breaking change (acceptable while Status is `Pre-release`); the legacy `THEMEMORY_API_KEY` env credential bridges to a `default` workspace so existing single-tenant deployments keep working (non-destructive migration: add nullable → backfill `default` → NOT NULL → compat bridge → enforce).
- **Does NOT unfreeze** Items 13/14/15 or any other Phase V item — those stay FROZEN. Only this slug is re-classified.

### Amendment 2026-06-17 (II) — Multi-tenant RBAC (members + roles) RE-CLASSIFIED as in-scope (project-owner sign-off)

**Project-owner directive (2026-06-17):** the **RBAC membership layer** — `users` + `workspace_users` (M:N with an `owner|admin|member` role), `Principal` widened to `{ workspaceId, userId, role, scopes }`, `requireRole(min)` gating the management routes, `/v1/members` CRUD, the **last-owner invariant** (atomic `FOR UPDATE` tx → 409), the **anti-escalation guard** on key mint, and **fail-closed 503** on auth-backend failure — is hereby **re-classified as IN-SCOPE under PRIORITY 0**, on the explicit rationale that it is the **membership layer the workspace amendment (above) and the v0.5 TheoCloud managed runtime (Item 7) depend on** to delegate per-workspace administration. Replicates the `../theo-rag` sibling reference (same TS+Hono+drizzle+pg+zod stack).

Honest disclosure (Rule 3):

- **Slug:** `multi-tenant-rbac-and-slice1-completion`. Also completes the deferred secondary-store isolation of the first slug (recall-cache / skill / eviction `workspace_id` threading → Slice 1 100%).
- **Breaking change:** `Principal` widened from `{ workspaceId, scopes }` to `{ workspaceId, userId, role, scopes }` (pre-release; acceptable). The env/no-credential bridge resolves to the seeded `default-owner` with role `owner`; a key with no membership row resolves default-deny to `member`.
- **Non-destructive migration** `0017_workspace_members.sql`: idempotent seed (`default-owner` + its `default`-workspace owner membership) + backfill of legacy keys, so single-tenant deployments keep working.
- **Does NOT unfreeze** Items 13/14/15 or any other Phase V item — those stay FROZEN. Only this slug is re-classified.

### Amendment 2026-06-18 — OpenMemory MCP-shape compatibility classified under P0 sub-goal 3 (project-owner directive)

**Project-owner directive (2026-06-18, "URGENTE P0"):** add **OpenMemory MCP-shape compatibility** — TheMemory's MCP server exposing the OpenMemory tool surface (`add_memories` / `search_memory` / `list_memories` / `delete_all_memories`) over the OpenMemory SSE transport convention, so any MCP client already wired to the OpenMemory MCP Server (Cursor / Claude Desktop / Windsurf / Cline) works against TheMemory as a drop-in. Governance path per the owner: **create a Roadmap item + run a `/discover` cycle first** (no code until the blueprint lands).

Honest classification (Rule 3 + Rule 10):

- **This is NOT the cut data-adapter.** The "Adapters (, , ) — cut 2026-05-21" decision rejected *wrapping a vendor's data SDK as a backend*. This is **MCP protocol/tool-shape interoperability** — it maps the OpenMemory tool names onto our existing `remember`/`recall`/`forget` verbs; no `the vendor SDK` dependency, no vendor backend. It therefore falls under **P0 sub-goal 3 (MCP available + reliable)**, not a freeze violation. The cut stays in force for true vendor data-adapters.
- **Slug:** `openmemory-mcp-compat` (Roadmap Item 26). Governance: discover → blueprint → plan → implement → review, like any P0-hardening cycle.
- **Scope guardrail:** MCP tool-shape + transport compatibility only. NOT the OpenMemory dashboard UI, NOT importing the `openmemory/` Docker stack, NOT a data-SDK dependency. The local `` reference clone (`openmemory/`) is read-only study material for the discover.

### Amendment 2026-06-19 — Skills (Repo-tier) dashboard surface UNFROZEN + RE-CLASSIFIED as in-scope (project-owner / CTO sign-off)

**Project-owner directive (2026-06-19, explicit CTO request — "Eu quero o item 1 e 2 isso é um PEDIDO do CTO"):** the **read-only Skills / Repo-tier dashboard surface** — a new TheMemory REST listing endpoint for skills, fronted by the theo-cloud gateway BFF, surfaced as a dashboard Skills tab — is hereby **UNFROZEN and re-classified as IN-SCOPE under PRIORITY 0**. This lifts the freeze that the `dashboard-phase2-skills-bitemporal-attribution` blueprint (ADR D2, SHIPPABLE 98.5) explicitly deferred to "owner unfreeze" per Rule 10.

Honest classification (Rule 3 + Rule 10):

- **What unfreezes:** ONLY the **read-only skills browse surface** of Roadmap Item 8 ( skill library, already SHIPPED at the SDK layer). The capability exists in `src/core` (`Memory.skills(repoId)`); this work exposes a **listing** of it over REST + gateway + dashboard. It is the "dashboard surface" companion to an already-shipped feature, not a net-new memory capability.
- **Slug:** `dashboard-phase2b-skills-browse`. Governance: `/to-plan` from blueprint ADR D2 → `/edge-case-plan` → `/plan-confidence` → `/implement` → `/review`, like any P0-hardening cycle. The discovery is already done (blueprint exists).
- **Public API addition (pre-release, acceptable):** `ScopedSkillMemory` today exposes only `add`/`recall`/`consolidate`/`forget` — NO list-all method. The browse needs a read-only list (e.g. `getAll` returning the repo's skills); this is a forward-only addition to the DIP contract. The REST endpoint `GET /v1/scopes/skill/:repoId/skills` REPLACES the current honest `501 SKILL_LISTING_NOT_IMPLEMENTED` for the listing path.
- **Scope guardrail (KISS/YAGNI):** read-only browse ONLY — list `{hash, description, code payload, language, createdAt, derivedFrom, supersededBy}` per repo. NO skill executor, NO editor, NO sandbox/e2b/modal deps, NO write/forget from the dashboard. Per ADR D2 alternatives (a)+(b) rejected.
- **Does NOT unfreeze** Items 13/14/15 or any other Phase V item — those stay FROZEN. Only this read-only skills-browse surface is re-classified.

### Amendment 2026-06-19 (II) — Skills WRITE surface (REST POST + MCP add_skill + UI forget curation) RE-CLASSIFIED as in-scope (project-owner / CTO sign-off)

**Project-owner directive (2026-06-19, explicit `/goal`):** the **programmatic skills WRITE surface** — a REST `POST /v1/scopes/skill/:repoId/skills` (create), an MCP `add_skill` tool, and **forget curation** (delete a bad skill) wired through the gateway BFF + surfaced as a delete action in the dashboard Skills tab — is hereby **re-classified as IN-SCOPE under PRIORITY 0**, extending the read-only unfreeze above.

Honest classification (Rule 3 + Rule 10):

- **What this is:** exposure of the ALREADY-SHIPPED `ScopedSkillMemory.add` + `forget` SDK capability (Roadmap Item 8, SHIPPED) over REST + MCP + gateway, plus a delete (curation) control in the dashboard. It is surface exposure of an existing capability (P0 sub-goal 2 "SDKs 100% functional" + sub-goal 3 "MCP available"), not a net-new memory capability. The closed loop it enables: an **agent** (running against TheoCloud/MCP) authors its own skills — the canonical flow — instead of skills being SDK-in-process-only.
- **Slug:** `skills-write-surface`. Governance: `/discover` → `/to-plan` → `/edge-case-plan` → `/plan-confidence` → `/implement` → `/review`, like any P0-hardening cycle.
- **Public surface additions (pre-release, acceptable):** REST `POST /v1/scopes/skill/:repoId/skills` (body = `SkillDraft {code, description, codeLanguage}`); MCP `add_skill` tool; gateway `POST /v1/memory/skills` (SDK, `memory:write`) + BFF `POST /v1/dashboard/memory/skills` (JWT) + a forget path; dashboard delete-skill curation. Per-customer repoId namespacing (`{subject}:{repoId}`, D3) reused.
- **Scope guardrail (KISS/YAGNI — the security line):** STORE-only. The system stores code-as-skill (text); it does NOT execute it. NO executor, NO sandbox (e2b/modal), NO code editor in the UI. The UI gets at most a **forget (delete)** curation control + optionally edit-description — NOT a code editor. Authoring of code is for the **agent** (REST/MCP); the human curates. Per the design discussion 2026-06-19 (UI-create of executable code rejected: contradicts the agent-autonomy thesis + RCE surface).
- **Does NOT unfreeze** Items 13/14/15 or any other Phase V item — those stay FROZEN. Only this skills write/curation surface is re-classified.

### Amendment 2026-06-20 — Entity + relation extraction (NO graph DB) UNFROZEN + RE-CLASSIFIED as in-scope (project-owner / CTO sign-off)

**Project-owner directive (2026-06-20, explicit live-session unfreeze):** **entity + relation extraction** — populating the currently-unwritten `entities` table from memory text, plus a relations (triples) layer + a dashboard graph view — is hereby **UNFROZEN and re-classified as IN-SCOPE under PRIORITY 0**. This closes the long-standing honest gap (Followup #3: the `entities` table is never populated; session memory [[themory-entities-table-unpopulated]]) and answers the CTO's request for a -style entity-graph experience **WITHOUT a graph database**.

Honest classification (Rule 3 + Rule 10):

- **What this is:** a real NER/extraction-and-persist pipeline + a 2-table Postgres relational model (`entities` + `entity_edges`) + a listing/graph REST surface + a dashboard graph view. Grounded in blueprint `entity-relation-extraction-no-graphdb` (`/discover-confidence` SHIPPABLE 100, 2026-06-19).
- **Slug:** `entity-relation-extraction-no-graphdb` (Roadmap Followup #3 promoted). Governance: `/to-plan` → `/edge-case-plan` → `/deps-audit` → `/plan-confidence` → `/implement` → `/review`, like any P0 cycle.
- **Locked technique decisions (project-owner, this session):**
 - **D1 — Entity extraction via `compromise` (the the reference TS port way), NOT the Python NLP library.** the Python NLP library is Python; TheMemory is TS/Node. 's own TS implementation uses the `compromise` npm package with a regex-only fallback (`the reference TS port/src/oss/src/utils/entity_extraction.ts:300` lazy `require("compromise")`). We mirror that: `compromise` as an OPTIONAL lazy-loaded dep + regex fallback. the Python NLP library-via-Python-sidecar was REJECTED (cross-runtime, +Python runtime in the Docker image). The naive "install the Python NLP library like " is honestly impossible on a Node stack — `compromise` IS "the way" for TS.
 - **D2 — Persist as 2 Postgres tables, NO graph DB.** `entities` + `entity_edges` (resolution by `(scope, normalized_key)` UNIQUE; edges carry `source_memory_id` provenance per Princípio 3). Item 14 (`@usetheo/memory/graph` backend) stays **FROZEN/out-of-scope** — a 1–2 hop dashboard view needs only JOINs.
 - **Relations (edges):** `compromise` extracts NODES only; the triple (edge) extraction reuses the EXISTING write-pipeline LLM call (blueprint D1) — no second NLP stack. Suggested phasing: Slice 1 = entities/nodes (compromise) → fixes the empty Entities tab; Slice 2 = relations/edges + `{nodes,edges}` graph view.
- **Public surface additions (pre-release, acceptable):** a TheMemory REST `GET /v1/scopes/:type/:id/entities` upgrade (real counts, not `attributed_to`-derived) + a future `GET /v1/scopes/:type/:id/graph` (`{nodes,edges}`); gateway SDK + BFF proxies; dashboard Entities/graph view. New migration(s) for the `entities` population + `entity_edges` table.
- **Does NOT unfreeze** Items 13/14/15 (incl. Item 14 graph backend) or any other Phase V item — those stay FROZEN. Only this Postgres-only entity+relation extraction surface is re-classified.

### Amendment 2026-06-21 — PRIORITY 0 FREEZE LIFTED (FULL unfreeze, project-owner sign-off)

**Project-owner directive (2026-06-21, explicit "vamos fazer um unfreeze"):** the PRIORITY 0 feature freeze is hereby **LIFTED IN FULL**. Items **13 (adaptive retrieval), 14 (graph backend), 15 (domain ontologies), 21 (agentic tool-use + sandbox), 23 (reranker), 24 (embedder registry), 25 (ingest robustness)** and any other Phase V+ item are **no longer FROZEN** — they may be discovered, planned, implemented, and reviewed via the normal cycle. This supersedes the freeze clause of the 2026-06-04 GO-TO CTO directive and every "FROZEN under P0" marker in the Roadmap below.

Honest classification (Rule 3 + Rule 10):

- **Trigger:** the `/loop-cross-validation` vs (2026-06-21, `cross-validation-output/final_report.md`, overall 3.58/5) surfaced 4 gaps. The owner chose a **full unfreeze** to address them without per-item gating friction.
- **The P0 HARDENING discipline itself is NOT abandoned.** The 3 P0 sub-goals (APIs correct / SDKs functional / MCP available) remain the quality bar for everything that ships; "hardening" work continues to take precedence when it conflicts with a new feature. What changes is ONLY that net-new features are no longer categorically blocked.
- **`production-ready` / v1.0 stays SEPARATELY gated (Item 11).** The freeze lift does NOT touch the v1.0 gate. Gate status (updated 2026-07-20): `/dogfood` = `EVIDENCE_SUFFICIENT` (CLOSED). The former gate (a) — the independent v0.8 comparative benchmark reproduction — was **DROPPED per ADR-0020** (the benchmark feature was removed in v0.35.0; the product ships no comparative "faster-than" claim, so `public-copy.md § 4` does not apply). **v1.0 is now gated on `/dogfood` alone, which is CLOSED — so the path to v1.0 is unblocked.** Declaring v1.0 (README Status `Pre-release → Production-ready` + a `v1.0.0` cut) remains a **separate, deliberate owner release action**; this file does not auto-flip it. The no-comparative-claim guardrail (`public-copy.md § 4`) stays in force for any future benchmark claim.
- **Gap roadmap (this session):** the actionable memory gaps are **G2 (procedural execution + injection/command sandbox — Item 21)** and **G3 (first-class episodic / message-log tier)**. See `.claude/knowledge-base/roadmaps/memory-gaps-roadmap.md`.
- **G1 (in-context working-memory tier) + G4 (context-window / token-budget) are DEFERRED (project-owner, this session).** They are agent-RUNTIME concerns, not memory-layer features — implementing them in TheMemory core would contradict the locked "memory layer, NOT agent runtime" override. They are recorded as cross-repo followups for **TheoKit**, NOT in this roadmap's critical path.
- **Locked overrides unchanged:** the 3 root overrides (vendor lock-in exception, Phase-1 scope, Apache-2.0), the locked names, voice/tone, and ADR-0010/0011 are NOT touched by this unfreeze.

---

## What this project is

`@usetheo/memory` (TheMemory) is the **managed three-tier memory layer** of the [Theo](https://usetheo.dev) ecosystem. **vector-based hybrid architecture** (vector + LLM fact extraction + hybrid retrieval), with three scope tiers (**User / Session / Agent**), shipping in two runtimes (**local** Postgres + pgvector for dev/CI, **TheoCloud-managed** for production). **Apache-2.0-licensed.** Native to [TheoKit](../theokit) by design.

Positioned as a **Community auxiliary** of Theo, alongside [`@usetheo/sdk`](../theokit-sdk) and [`@theokit/ui`](../theo-ui). **Pre-release** (contract being locked; no package published yet) — single exception to the monorepo's "every product is production-ready" claim (2026-05-15 lock).

**Strategic positioning:** the managed memory line item on the TheoCloud invoice. Analog: Vercel KV ↔ Vercel. Lock-in to TheoKit + TheoCloud is a deliberate feature, not an accident — see `## Architectural Decisions Locked` below.

---

## Feature Status (canonical reading — 2026-06-04)

**TL;DR.** The system is feature-ready for the majority of vector-based hybrid OSS use cases AND for standalone REST/Docker/MCP consumers. The system is **NOT yet labelled production-ready by project policy** — but as of 2026-07-20 both v1.0 gates are resolved: `/dogfood` = **`EVIDENCE_SUFFICIENT` (CLOSED)**, and the former gate (a) — the independent v0.8 comparative benchmark — was **DROPPED per ADR-0020** (benchmark feature removed in v0.35.0; no comparative claim is shipped). **The v1.0 path is unblocked; the actual v1.0 label + version cut is a pending owner release decision, not a technical blocker.**

### What works today (consumer can use it now)

| Capability | Subpath / API surface | Roadmap Item | Caveat |
|---|---|---|---|
| 4-verb API (remember / recall / forget / reflect) + 3-tier scope (User / Session / Agent) | `@usetheo/memory` default barrel | 1, 2 | None |
| skill-based skill memory (4th tier `Repo` via `Memory.skills(repoId)`) | `Memory.skills(repoId)` | 8 + ADR-0010 | TheoCode wiring integration test pending |
| Reflection pipeline (manual + threshold + sleep-time policies) | `ReflectionPolicy` DIP | 5 | None |
| Forgetting with long-tail preservation (Ebbinghaus + LRU + LLM importance + isolation guardrail) | `Memory.forget(id, { hard? })` + `EvictionPolicy` DIP | 6 | Demo wiring `createLocalMemory({ eviction })` paused (race-condition `b2909ff` — SDK direct path works) |
| Distillation (episodic → semantic with LLM-judged conflict resolution) | `ConflictResolutionPolicy` 9th DIP via `reflect({ conflictResolution })` | 9 | LLM-MEASURED p=r=1.000 on 10 hand-authored contradictions; procedural-fixture quality untested |
| Independent benchmarks (LongMemEval / LoCoMo / DMR fixtures + multi-judge panel) | `benchmarks/` + `BenchmarkAdapter` 10th DIP | 10 | TheMemory smoke-validated only; // cells DEFERRED per Drift-T6.x-1 |
| Multi-peer attribution + bi-temporal `asOf` in local OSS tier (Apache-2.0, vs AGPL / ) | `RememberOptions.attributedTo` + `RecallOptions.{asOf, attributedTo}` | 12 (v1.1) | EC-9 skill-scope `asOf` deferred to follow-up cycle |
| Semantic recall cache (13th DIP at the `recall` layer, query-embedding cosine, write-trigger invalidation, 3 OTel metrics) | `createLocalMemory({ recallCache })` + `@usetheo/memory/cache-pg` | 19 (v1.5) | THE GOAL TEST hit rate 0.60 on 10 hand-authored pairs; skill-scope cache wiring deferred to v1.5.x per ADR D10 of fixes-cycle-1 |
| TheoKit-native binding (auto-scope from `ctx.session.userId`) | `@usetheo/memory/theokit` | 3 (v0.2 PR-A) | PR-B (scaffolded `create-theo` templates + E2E) pending in sibling `theokit` repo |
| MCP agent tools (stdio + streamable-HTTP transports) | `@usetheo/memory-mcp` (+ `themory mcp`); shared agent helpers at `@usetheo/memory-agent-core` | 4 (v0.3) | The `@usetheo/memory/agent-tools` subpath was REDEFINED to the `@usetheo/memory-agent-core` leaf package on 2026-06-15 (complete-workspace-publish-topology T4 / ADR D3) — breaks the former cli↔mcp cycle; pre-release breaking change |
| OpenMemory MCP-shape compat (drop-in for OpenMemory-wired clients over SSE) | `themory mcp --compat openmemory` (env `THEOMEM_MCP_COMPAT`); `connectSse` from `@usetheo/memory-mcp` | 26 (v0.5.0) | Opt-in; native `themory mcp` unchanged. `client_name → mcp_client` metadata enrichment deferred (path segment parsed but not yet surfaced as metadata) |
| REST API server (Hono + OpenAPI 3.1 + Bearer auth + 12th DIP `AuthVerifier`) | `@usetheo/memory/server` | 16 | None |
| Docker stack (distroless Node 22 image at `ghcr.io/usetheo/themory:0.1.0-alpha`, 199.7 MB) | `docker-compose.prod.yaml` + Trivy CRITICAL+HIGH gate | 17 | `ghcr.io/...:0.1.0-alpha` tag-published; no semver release yet |
| Consolidated CLI (`themory {mcp,server,migrate,health}`) | `themory` bin (alias `themory-mcp` retained 1 release) | 18 | Verbs-as-CLI (`themory remember`/`recall`) deferred to P1 |
| Parametric embedding dim (384 via Xenova MiniLM, no API key) + OpenRouter env-shift | `LocalTransformerEmbedder` at `@usetheo/memory/embedders/local` | adapters-openrouter-local-embedder | TheoKit Agent itself still requires valid `THEOKIT_API_KEY` |

### What is planned (not built yet)

| Capability | Blocker | Roadmap Item |
|---|---|---|
| **TheoCloud managed runtime + multi-region** | Theo PaaS GA | 7 (v0.5) |
| **`production-ready` label / v1.0 contract freeze** | Owner release decision (both technical gates resolved: `/dogfood` `EVIDENCE_SUFFICIENT`; comparative-benchmark gate DROPPED per ADR-0020) | 11 (v1.0) |
| Adaptive retrieval (Self-RAG / CRAG / Adaptive-RAG hooks) | None (next major after v1.0) | 13 (v1.2) |
| Optional graph backend (`@usetheo/memory/graph` via Apache AGE / a graph database) | None | 14 (v1.3) |
| Domain ontologies (typed schemas: medical / legal / code / support) | Depends on Item 9 | 15 (v1.4) |
| Scaffolded TheoKit templates + default-on memory + E2E | Sibling `theokit` repo PR-B | 3 (v0.2 PR-B) |

### Production-ready gate (Item 11)

The `production-ready` token was historically blocked by two hard gates per `dogfood-golden-rule.md` + Roadmap Item 11. As of 2026-07-20 **both are resolved**:

1. **`/dogfood` gate** = **`EVIDENCE_SUFFICIENT` — CLOSED (re-audited 2026-07-12)**. The anchor scenario S1 ("Claude Code auto-memory backed by TheMemory") transitioned `planned → wired → running` (2026-06-04); 49 evidence files are logged and the unified journey suite (ADR-0019, every journey `anchor: true`) passes `run_journey_audit.py` with 0 reds. This supersedes the stale 2026-05-31 `6f7ff87` audit (`EVIDENCE_INSUFFICIENT`, `anchor_not_running` + `no_anchor_evidence`). **This gate no longer blocks v1.0.**
2. **Independent v0.8 benchmark reproduction** = **DROPPED per ADR-0020 (2026-07-20)**. The benchmark feature was removed entirely in v0.35.0 (`283fbc2`); the competitor SDK wiring (`v0-9-vendor-client-impls`) was abandoned 2026-06-07; and the product ships **no** comparative "faster-than" claim, so the `public-copy.md § 4` independent-reproduction requirement (which gates *comparative claims*) does not apply. This gate no longer blocks v1.0.

**Both technical gates are now resolved.** What remains is a **deliberate owner release decision**: flipping README Status `Pre-release → Production-ready` in the same PR that cuts `v1.0.0`. Until the owner makes that call, README Status stays `Pre-release`, no `production-ready` badge, no `production-grade` claim in any public copy — and the no-comparative-claim guardrail (`public-copy.md § 4`) stays in force for any future benchmark claim. See § Inviolable Rule 3.

### Per-audience readiness

| Audience | Ready? | Path |
|---|---|---|
| vector-based hybrid pgvector OSS consumer | YES | `@usetheo/memory` default barrel + `runMigrations(pool)` |
| TheoKit-native app | YES (PR-A) | `@usetheo/memory/theokit` + `memoryFromCtx(ctx, memory)` |
| MCP-aware agent loop (any framework) | YES | `themory mcp` OR `@usetheo/memory-mcp` (shared helpers: `@usetheo/memory-agent-core`, formerly the `@usetheo/memory/agent-tools` subpath) |
| OpenMemory-wired MCP client (Cursor/Claude/Windsurf/Cline) | YES (v0.5.0) | `themory mcp --compat openmemory` — drop-in OpenMemory tool surface over SSE on port 8765 |
| Audit/replay (bi-temporal `asOf`) | YES (v1.1) | `recall({ asOf })` — memory scopes; skill scope deferred |
| Multi-peer attribution (`attributed_to`) | YES (v1.1) | `recall({ attributedTo })` + LLM extraction N-valent |
| Semantic-cache opt-in | YES (v1.5) | `createLocalMemory({ recallCache: { threshold: 0.8 } })` |
| Standalone Docker / REST | YES | `docker compose up` against `ghcr.io/usetheo/themory:0.1.0-alpha` |
| TheoCloud / SaaS managed | NO | Blocked by Theo PaaS GA (Item 7) |
| Graph queries | NO | Item 14 (v1.3) planned |
| Domain ontologies (medical/legal) | NO | Item 15 (v1.4) planned |
| Adaptive retrieval (Self-RAG hooks) | NO | Item 13 (v1.2) planned |
| **`production-ready` label** | **Pending owner call** | Both technical gates resolved: `/dogfood` CLOSED (2026-07-12) + comparative-benchmark gate DROPPED per ADR-0020 (2026-07-20). v1.0 label/cut is now an owner release decision, not a blocker (Item 11) |

---

## Locked names

(Decisions documented; changing requires a CLAUDE.md update + CHANGELOG entry + strategic review for items marked `strategic`.)

| Item | Value | Strategic? |
| --- | --- | --- |
| npm package | `@usetheo/memory` | strategic |
| Marketing name | **TheMemory** | strategic |
| Repository directory | `theo-memory` | strategic |
| Canonical install command | `npm install @usetheo/memory` (reserved; not yet published) | strategic |
| License | **Apache-2.0** | strategic — aligned with monorepo standard 2026-06-09 (reverted prior MIT carve-out of 2026-05-21) |
| Tier | Community auxiliary (OSS) | strategic |
| Memory tiers | `User` · `Session` · `Agent` (+ `Repo` for skills only, v0.6, [ADR-0010](.claude/knowledge-base/adrs/ADR-0010-repo-scope-fourth-tier.md)) | strategic |
| API verbs | `remember` / `recall` / `forget` / `reflect` | strategic |
| Two runtimes | `local` (Postgres + pgvector) + `cloud` (TheoCloud-managed) | strategic |
| Subpath exports | `@usetheo/memory` (local default) + `@usetheo/memory/cloud` (managed) | strategic |
| themory CLI verbs | `remember <text>` / `recall <query>` / `forget <id>` / `reflect` (closes Roadmap Item 18 verbs-as-CLI; per ADR D2 of verbs-as-cli plan + verbs-as-cli-fixes-cycle-1 T5.3) + `import claude-code` (M12, 2026-07-22 — data-import namespace; ships ONLY claude-code, future sources by demand) + `reextract` (M13, 2026-07-23 — backfill LLM de entidades semânticas, #111) | strategic |
| themory CLI flags (stable) | `--user` / `--session` / `--agent` / `--top-k` / `--threshold` / `--diversify` / `--hard` / `--json` / `--text` (sentinel-guarded by `src/__tests__/cli-locked-names.test.ts`) | strategic |

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
- **Three tiers (User / Session / Agent)** — mapped 1:1 onto 's `user_id` / `agent_id` / `run_id` filter shape internally. Public API uses scoped sub-object form (`memory.user(id).remember(...)`) for type narrowing.
- **Apache-2.0 licensed** — aligned with the monorepo standard (re-aligned 2026-06-09; prior MIT carve-out locked 2026-05-21 was reverted after weighing patent grant + trademark protection upside against perceived embed friction).
- **Pre-release is honest** — never claim production-ready until the owner explicitly declares v1.0 (both technical gates are resolved as of 2026-07-20 per ADR-0020; the label is now an owner call, not a blocker). No comparative "faster-than" claim without satisfying `public-copy.md § 4` in full. Breaks the consistency with the other 6 sub-projects' "production" status deliberately.
- **Cross-Project Rule 9 (Cloud abstraction)** — cloud runtime user-copy says `memory store`, NEVER `` / `pgvector` / `vector engine` / `vector store engine` etc.

If a piece of TheMemory copy contradicts the locked narrative in [`../CLAUDE.md`](../CLAUDE.md) or the operational rules in [`../theokit/CLAUDE.md`](../theokit/CLAUDE.md), the root and TheoKit rules win — surface the conflict before publishing.

---

## Architectural Decisions Locked

Decisions taken during the project's design phase that override root contract defaults.

### Three explicit overrides of root `CLAUDE.md` (2026-05-21)

The strategic review of 2026-05-21 documented three explicit overrides of the root meta-contract. **All three confirmed by the project owner.** Re-opening any requires a new strategic review.

- **Cross-Project Rule 6 — vendor lock-in exception.** TheoKit + TheMemory + TheoCloud is a deliberate single-platform consolidation. Walk-away from this specific combination costs a memory migration. Local OSS runtime stays open; the rest of the funnel remains lock-in-free. Source: root `CLAUDE.md` § Cross-Project Rules 6.
- **Phase 1 scope expansion — TheoCloud completeness.** TheMemory enters Phase 1 as expansion of TheoCloud capacity, NOT as a 7th vertical productization. Classified as "line item on the TheoCloud invoice", analog Vercel KV. Source: root `CLAUDE.md` § Phase (now), "Expanded into scope 2026-05-21".
- **License — Apache-2.0, aligned with monorepo standard.** The 2026-05-14 license standardization mandates Apache-2.0 for every OSS product. TheMemory was carved out as an MIT exception on 2026-05-21; the carve-out was reverted on 2026-06-09 — explicit patent grant + trademark protection in Apache-2.0 are net-positive for embeds in proprietary systems, and all direct competitors (, , /) are Apache-2.0. Source: root `CLAUDE.md` § Product Hierarchy.

### Fourth scope tier — RepoScope (2026-05-30, v0.6)

- **ADR-0010 — `RepoScope` for skill memory.** `Memory.skills(repoId)` returns a `ScopedSkillMemory` bound to `RepoScope{ kind: 'repo', repoId }`. Exposed ONLY through `Memory.skills(...)` (not on the public 4 verbs); maps internally to `filters.agent_id` per EC-4. Extends ADR-0002's 3-tier contract; does not soften it. Source: [`ADR-0010-repo-scope-fourth-tier.md`](.claude/knowledge-base/adrs/ADR-0010-repo-scope-fourth-tier.md).

### Bi-temporal runtime lift (2026-06-03, v1.1)

- **ADR-0011 supplementary** — v1.1 LIFTS the ADR-0006 runtime-clause: local `recall({ asOf })` is honored via null-safe predicate `(t_valid IS NULL OR t_valid <= asOf) AND (t_invalid IS NULL OR t_invalid > asOf)`. Schema clause of ADR-0006 (columns since v0.1) is REINFORCED — Apache-2.0 prior art (blueprint Q6) validates the same shape. `BiTemporalNotSupportedLocally` class still exported (cloud retains the option; `@deprecated for local`). CAVEAT: EC-9 skill-scope `asOf` deferred to follow-up cycle.

### M8 — `(workspace, user)` cross-user isolation (2026-07-22, boundary-enforced)

- **[ADR-0021](.claude/knowledge-base/adrs/ADR-0021-m8-boundary-enforced-user-isolation.md)** — the `(workspace, user)` isolation is enforced at the **scope-resolution boundary**, NOT by a type-mandatory scope field (supersedes the M8 plan's ADR D1). `Memory.session(sessionId, userId?)` / `Memory.agent(agentId, userId?)` gain an OPTIONAL `userId` (backward-compatible); the REST/MCP layer binds `Principal.userId` into every session/agent scope so a user-Principal's access is `(workspace, user, session)`, while a workspace-admin credential (`Principal.userId === null`) stays workspace-scoped. The three memory tiers (User/Session/Agent) are UNCHANGED — no new tier was added. PROVEN by the cross-user isolation hard-gate integration test (3/3 vs real `ankane/pgvector:v0.5.1`; user B reads zero of user A's rows) + the composite index `memories_ws_user_session_idx` (migration 0024, EXPLAIN confirms Index Scan). Owner sign-off: the `/goal` directive authorizing the M8 isolation work.

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
| 5 | **v0.4a — Reflection pipeline** | `ReflectionPolicy` DIP shipped with 3 impls: `ManualReflectionPolicy` + `ThresholdReflectionPolicy` + `SleepTimeReflectionPolicy`. THE GOAL TEST: 50 memories → reflect → ≥ 1 derived row with provenance. | 2026-05-23 (commit `494bceb`) |
| 6 | **v0.4b — Forgetting with long-tail preservation** | `TriadicScoringPolicy` (Ebbinghaus + LRU + LLM-judged importance) wired via `EvictionPolicy` DIP per ADR D12. `CapacityBasedTrigger` (post-remember) + `TimeBasedTrigger` (cron) + `PgEvictor` (soft-delete via `t_invalid`). THE GOAL TEST: `recall@10 = 1.000` on 1000-memory × 50-rare-query set. **PUBLIC API BREAKING**: `Memory.forget(id, options?: ForgetOptions)` widens with `hard?: boolean` (GDPR escape hatch). CAVEAT: Demo wiring `createLocalMemory({ eviction })` paused via hotfix `b2909ff` (race condition F-T4.1-2); SDK direct path works (67/67 integration). | 2026-05-31 (PR #24 merge `9a8bca3`) |
| 8 | **v0.6 — skill library** | `Memory.skills(repoId)` returns `ScopedSkillMemory` exposing 4 skill verbs. Hash identity via `hashFact(description)`. Scope-isolated forget (v0.6.1 T4.1 EC-2). THE GOAL TEST: 2 semantically-equivalent skills → consolidate → 1 derived with both source IDs in `derivedFrom`. v0.6.1 fixes-cycle closed 2 CRITICAL + 8 MAJOR + 13 MINOR. CAVEAT: TheoCode integration test (cache-hit metric > 0) still pending. | 2026-05-30 (`feat/v0-6-skill-library`); v0.6.1 fixes `b6aead6` |
| 9 | **v0.7 — Episodic→Semantic distillation** | `ConflictResolutionPolicy` 9th DIP + 3 impls (Noop / LastWriteWins / LlmJudgedMergeConflictPolicy) + reflect wiring + migration `0007_distillation_columns.sql` (consolidation_history table with `ON DELETE SET NULL` FK for GDPR survival). v0.7.1 LLM-MEASURED: precision = recall = conflict-resolution accuracy = 1.000 on 10 hand-authored contradictions via `openai/gpt-4o-mini`. CAVEAT: 1.000 reflects 10/10 unambiguous fixtures; broader procedural-fixture quality untested at LLM surface (v0.7.2 if needed). | 2026-06-02 (HEAD `83a8eb5` + paper-name cleanup `f7f14e6`) |
| 10 | **v0.8 — Independent benchmark reproduction** | `BenchmarkAdapter` 10th DIP + 4 adapter implementations + runner orchestrator + multi-judge panel via OpenRouter (NO `@anthropic-ai/sdk` per user directive). LongMemEval / LoCoMo / DMR fixture loaders. Matrix at `docs/benchmarks/v0.8.md`. v0.8-fixes-cycle-1 absorbed `/plan-confidence` INVALID 34.3/100. CAVEAT: TheMemory smoke-validated only; // cells DEFERRED per Drift-T6.x-1 (VendorClient DIP shipped but SDK wiring deferred). **`/dogfood` gate STILL `EVIDENCE_INSUFFICIENT`** — benchmarks alone do NOT unblock production-ready. | 2026-06-02 |
| 12 | **v1.1 — Multi-peer attribution + Bi-temporal local-runtime lift** | `attributed_to` as first-class promoted column on `memories` (migration `0008_attributed_to.sql`). `recall({ asOf })` honored via null-safe predicate against `t_valid`/`t_invalid` (ADR-0011 supplementary supersedes ADR-0006 runtime clause). N-valent attribution semantic per blueprint Q5 — attacks 's AGPL-3.0 moat under MIT. THE GOAL TEST 7/7 PASS. CAVEAT: EC-9 skill-scope `asOf` deferred per plan v1.3 ADR D4 amendment. 3 pre-existing-debt MAJOR (F-arch-2/6/7) deferred to refactor cycle. Pre-v1.1 rows have `attributed_to=NULL` permanently per EC-1 honest no-backfill. | 2026-06-03 (PR #28 merge `0433484`) |
| 16 | **REST API server (`@usetheo/memory/server`)** | Hono + RPC-mirror endpoints `POST /v1/{remember,recall,forget,reflect}` + `GET /v1/health` + `GET /v1/health/db` + `GET /v1/scopes/:type/:id/memories` + `GET /v1/openapi.json`. Bearer-token auth via `THEMEMORY_API_KEY`. 12th DIP `AuthVerifier` for future OAuth/JWT swap. OpenAPI 3.1 spec auto-derived from zod schemas. OTel spans per handler. 1 MB body-limit DOS guard. Single-scope-tier enforcement via zod `.strict.superRefine` per ADR D12. | 2026-06-03 (`theo-memory-standalone-p0` chain) |
| 17 | **Docker stack** | Multi-stage Dockerfile (Node 22-bookworm-slim builder → distroless runtime). `ghcr.io/usetheo/themory:0.1.0-alpha` at 199.7 MB (under 200 MB target). ENTRYPOINT direct Node per ADR D13 (no `docker-entrypoint.sh` — migrate-on-startup discipline inside `themory server`). GitHub Actions publishes to GHCR with Trivy CRITICAL+HIGH gate. THE GOAL TEST: `docker compose up` round-trips against the published image. | 2026-06-03 |
| 18 | **CLI consolidado `themory`** | `themory {mcp,server,migrate,health}` — replaces standalone `themory-mcp` bin with multi-subcommand commander entry preserving backward-compat alias for one release. `themory mcp` reproduces v0.3 behavior. `themory server` binds port EAGERLY while Memory factory warms async (`GET /v1/health` returns 503 `warming_up` per EC-33). `themory migrate` applies pending Drizzle migrations. `themory health --deep` smoke-validates embedder + LLM. Both `themory server` AND `themory mcp` emit 3-line stub-embedder stderr disclosure on startup per Inquebrável Rule 3 honesty. CAVEAT: Verbs-as-CLI (`themory remember`/`recall`) DEFERRED to P1. | 2026-06-03 |
| 19 | **v1.5 — Semantic recall cache** | Cache `recall` results at the `recall` layer keyed by query-embedding cosine. 13th DIP `RecallCacheStore` (4 methods within ADR-0008 cap). `PgvectorRecallCacheStore` default impl. Write-trigger scope invalidation on remember/forget/reflect. SERIALIZABLE-isolated LRU eviction. 3 OTel metrics (Counter + 2 Histograms). Subpath `@usetheo/memory/cache-pg` with EC-26 bundle isolation (dynamic-import). THE GOAL TEST hit rate **0.60** on 10-pair hand-authored fixture set (Xenova MiniLM 384-dim, threshold 0.8) against real `ankane/pgvector:v0.5.1`. Post-merge `/review` `READY_TO_MERGE_WITH_CAVEATS` (10 MAJOR). 3 MAJORs closed inline via `c47e5ac`; remaining 7 in `semantic-recall-cache-v1-5-fixes-cycle-1` (4 of 8 task commits shipped: T0.1 `0589a8f`, T1.1 `bae2fda`, T2.1 `595ef01`, T2.2 `e7eb240`). CAVEAT: hit rate 0.60 reflects chosen fixture distribution. Skill-scope cache wiring deferred to v1.5.x per ADR D10. **`/dogfood` gate STILL `EVIDENCE_INSUFFICIENT`** — v1.5 does NOT unblock production-ready. | 2026-06-03 + fixes-cycle-1 in flight |
| 20 | **theo-memory-faang-auth-lifecycle — FAANG-grade auth lifecycle hardening for `@usetheo/memory/server`** | **Camada 2 (OSS multi-user)**: Stripe-shape `theo_live_*` keys (`theo_api_keys` table migration `0012` + `ApiKeyAuthVerifier` 12th-DIP impl + 5 admin REST handlers + `requireScope` middleware + bootstrap self-revoke EC-3 atomic-tx + `themory keys {create,list,rotate,revoke}` CLI). **Camada 3 (OIDC bridge)**: `OidcAuthVerifier` (RFC 7662 introspection + EC-4 AbortController 5000ms timeout + EC-5 in-flight Map coalescing + EC-12 cache staleness window) + `dualValidationAuth` Hono middleware (prefix-routes `theo_live_*` → ApiKey verifier, else → OIDC) with EC-1 fallthrough + production `createOauth4webapiIntrospect` adapter at `src/server/auth/oidc-introspect-oauth4webapi.ts` (ADR D2+D3 — discovery cached at construction per RFC 8414; EC-3 introspection_endpoint guard at boot). **Sub-goal 3 (MCP HTTP auth)**: `withBearerAuth` node:http wrapper + `connectStreamableHttp({ bearerAuth, tls? })` + ADR-0015 #3 non-localhost-without-TLS guard + `themory mcp --auth=<none\|api-keys\|oidc\|both>` flag. **RFC 9728**: `/.well-known/oauth-protected-resource` handler + `oidcDiscovery` option on `createServer`. **CLI**: `themory server --issuer <URL> --client-id <id>` + `themory mcp --auth=oidc --issuer <URL>` (env equivalents: `THEMORY_OIDC_ISSUER`, `THEMORY_OIDC_CLIENT_ID`); secrets env-only per ADR D4 (`THEMORY_OIDC_CLIENT_SECRET`, `THEMORY_ADMIN_BOOTSTRAP_TOKEN`). Admin REST `/v1/admin/keys/*` wired via opt-in `createServer({ adminApi: { pool, bootstrapToken? } })` per ADR D1. **3 new ADRs**: ADR-0013 (OIDC bridge, supersedes ADR-0009 § Alternatives row 4) + ADR-0014 (OSS lifecycle parity per blueprint Q3 Cal.com/PostHog/Plausible canonical) + ADR-0015 (MCP HTTP auth). **THE GOAL TEST**: 12-scenario `tests/integration/auth/lifecycle.test.ts` 12/12 GREEN + 6-scenario `tests/integration/auth/fixes-cycle-1-e2e.test.ts` 6/6 GREEN against real `ankane/pgvector:v0.5.1` + stubbed RFC 7662 Hydra-shape issuer. **Public surface** (re-exported from `@usetheo/memory/server`): `ApiKeyAuthVerifier`, `OidcAuthVerifier`, `IntrospectFn`, `IntrospectionResult` (12 RFC 7662 claims incl. `aud` for audience-validation/token-confusion mitigation per RFC 8707), `dualValidationAuth`, `createOauth4webapiIntrospect`, `requireScope`, `wellKnownOauthProtectedResourceHandler`, `AdminApiOptions`, `OidcDiscoveryConfig`. PRIORITY 0 sub-goal 2 (SDK functional) + sub-goal 3 (MCP available) hardening per CLAUDE.md. | 2026-06-07 (PR #32 merge `fca24a7`) |
| 26 | **OpenMemory MCP-shape compatibility** | Opt-in `toolset: 'openmemory'` on the MCP server exposes the OpenMemory tool surface (`add_memories`/`search_memory`/`list_memories`/`delete_memories`) as an alias over the native verbs (adapter-only in `packages/mcp`; `src/core` untouched, no `the vendor SDK` dep). `connectSse` SSE transport on the OpenMemory route convention (`GET /{client}/sse/{user}` + POST messages + `/{client}/http/{user}` Streamable HTTP) using the SDK's `SSEServerTransport` — NO new dependency. CLI `themory mcp --compat openmemory` (env `THEOMEM_MCP_COMPAT`), default port 8765. Per-user isolation enforced across all four tools incl. `delete_memories` (cross-user delete IDOR closed in `/review`: ownership confirmed via `memory.get(id).scope` before forget). Source-confirmed divergence from the announcement: delete tool is `delete_memories(memory_ids)`, NOT `delete_all_memories` (per ADR D4). THE GOAL TEST: real `@modelcontextprotocol/sdk` client over SSE vs real `ankane/pgvector:v0.5.1` — `tools/list` = exactly the 4 names, add→search→delete round-trip, per-user read+delete isolation (4/4). `/review` 6 agents → READY_TO_MERGE (BLOCKER + 5 HIGH closed). P0 sub-goal 3 (MCP available). | 2026-06-18 (PR #50 merge `1e328a4`, tag `v0.5.0`) |

### Pending (not built yet)

**Pre-P0 trichotomy:**

- **(a) On the P0 critical path** — items whose blocker IS the P0 sub-goals. Continue under hardening.
- **(b) FROZEN under P0** — no work until P0 closes. The Roadmap entry stays for audit history.
- **(c) Cross-repo dependency** — waiting on sibling repo; not blocked by P0 directly.

| Nº | Name | Acceptance + dependency | P0 classification |
|---|---|---|---|
| 11 | **v1.0 — Contract stable / `production-ready` label** | (a) ~~`docs/benchmarks/v0.8.md` exists + ≥ 1 external reproduction~~ **DROPPED per ADR-0020 (2026-07-20)** — benchmark feature removed in v0.35.0; no comparative claim is shipped so `public-copy.md § 4` does not apply. (b) `/dogfood` returns `EVIDENCE_SUFFICIENT`. README Status flipped to `Production-ready` in same PR that bumps to v1.0. **Current state (2026-07-20):** gate (b) `/dogfood` = `EVIDENCE_SUFFICIENT` — **CLOSED** (anchor S1 `running`; 49 evidence files; ADR-0019 journey suite 0 reds); gate (a) — **DROPPED (ADR-0020)**. **Both technical gates resolved — the v1.0 label + `v1.0.0` cut is now a pending owner release decision, not a blocker.** | **Owner release decision (both technical gates resolved)** |
| 7 | **v0.5 — TheoCloud runtime + multi-region premium** | `@usetheo/memory/cloud` subpath imports cloud client (bundle-size gate). `THEOKIT_API_KEY` auth flow against staging. Multi-region failover. (Bi-temporal `asOf` MOVED to v1.1 local OSS tier per ADR-0011; cloud premium narrows to multi-region + audit-mgmt + managed embedding pricing.) **Depends:** Item 2 + Theo PaaS GA | **(a) Conditional** — if PaaS lands during P0, cloud runtime ships AS hardening of the contract surface (not a new feature) per P0 § "What CONTINUES" |
| 3 (PR-B) | **v0.2 PR-B — Scaffolded TheoKit templates + E2E** | T4.1-T4.4 + T5.1 from v0.2 plan ADR D7: default-on memory in scaffolded TheoKit apps. **Depends:** sibling `theokit` repo PR | **(c) Cross-repo dependency** — sibling repo work; not blocked by P0 directly. Ship when sibling lands. |
| 13 | **v1.2 — Adaptive retrieval** | `shouldRetrieve` + `wasRetrievalGood` decision hooks (Self-RAG / CRAG / Adaptive-RAG patterns). | **(b) FROZEN under P0** — no plans, no PRs, no discovery cycles |
| 14 | **v1.3 — Optional graph backend** | `@usetheo/memory/graph` adapter for KG-style queries. Backend: Postgres + Apache AGE OR a graph database. | **(b) FROZEN under P0** |
| 15 | **v1.4 — Domain ontologies** | Typed schemas per domain (medical / legal / code / support) layered over LLM extraction. | **(b) FROZEN under P0** |

### Cross-validation-derived backlog (post-P0)

> Source: `/loop-cross-validation` against `the reference project` (2026-06-15). Full report at `cross-validation-output/final_report.md`. Overall score 4.05/5 — target excels on engineering rigor (observability, typed errors, DIP, auth, bi-temporal); these are the actionable gaps where the reference is stronger. **All are NEW features → FROZEN under P0 (Inquebrável Rule 10); no plans/PRs until P0 closes.** Watcher daemon was evaluated and DISCARDED (cargo-cult of a different product shape). Listed here so the findings are not lost.

| Nº | Name | Acceptance + dependency | P0 classification |
|---|---|---|---|
| 21 | **Agentic tool-use + injection/command sandbox** | LLM-driven tool-use surface for the memory layer. **Security-by-design companion (non-negotiable, same plan):** reject shell metacharacters + `shlex`-style split + command whitelist + path-confinement to allowed roots + subprocess timeout/output-cap + per-task tool-call cap; new `ToolInvocationDeniedError` + OTel auditability event per denied call (Princípio 3). Reference: `the reference project/maintenance.py:452-514`. **HIGH priority once unfrozen** — sandbox MUST ship WITH tool-use, never after. See session memory `themory-agentic-tool-use-planned`. | **(b) FROZEN under P0** — new feature; plan post-P0 |
| 22 | **Layered config + `themory config` subcommand** | Config resolution: defaults → global file → project file → env (`env:VAR` refs) → CLI flags via deep-merge, plus `themory config init/set/get/list`. Closes the lowest cross-validation dimension (Configuration 2.5/5). Reference: `the reference project/config.py:357`. Highest operator-ergonomics ROI. | **(b) FROZEN under P0** — new feature; plan post-P0 |
| 23 | **Optional cross-encoder reranker (`Reranker` DIP)** | New `Reranker` DIP + default cross-encoder impl wired as a post-threshold stage in the recall pipeline; backend auto-detection (ONNX/torch). Lifts precision@k. Reference: `the reference project/reranker.py:236`. CAVEAT: heavy optional dep (onnxruntime/@xenova). | **(b) FROZEN under P0** — new feature; plan post-P0 |
| 24 | **Embedder registry + more providers** | String-keyed embedder registry with lazy dynamic-import + install-hint errors; ship 1-3 more first-party adapters (e.g. Google/Voyage/Ollama) to narrow the 3-vs-8 provider gap. Reference: `the reference project/embeddings/__init__.py:58`. | **(b) FROZEN under P0** — new feature; plan post-P0 |
| 25 | **Ingest robustness (opt-in)** | (a) per-item graceful-degradation / poison-record skip on bulk `remember` with an OTel event per skip (keep fail-fast default); (b) deterministic chunker fallback for the no-LLM / very-long-input path; (c) offline-first model resolution for the local embedder (air-gapped CI). References: `the reference project/core.py:103`, `chunker.py:80`, `embeddings/onnx.py:64`. LOW priority. | **(b) FROZEN under P0** — new features; plan post-P0 |

### Context-graph completeness backlog (/ parity — added 2026-07-10)

> Source: conceptual cross-check of TheMemory's entity-graph against /'s "temporal context graph" model (`/roadmap-feature` session 2026-07-10). Finding (grounded in code, not docs): TheMemory **already ships a temporal context graph** in Postgres relational form — `entities` + `memory_entities` + `entity_edges` (triples w/ provenance) + first-class episodes (v0.22) + ontology/custom-types (Item 15, v0.16) + graph-aware recall 1-2 hop traversal (v0.19) + bi-temporal `asOf` (v1.1). That is **8 of the 11** "context graph" components present. **Item 14 (graph-DB backend AGE/a graph database) STAYS declined** — none of these justify a graph DB; all sit behind a DIP over the existing 3 Postgres tables. These 3 items close the remaining deltas. **All sit BEHIND M1 (`agentic-skill-execution-sandbox`, Item 21) in the queue** — they must not jump the M1 line. Every gap crosses core + REST + MCP + Dashboard where applicable. **These three Items ARE the formal milestones `ROADMAP.md` M0/M1/M2** (same three deltas, machine-tracked view for `cycle-roadmap`/`/roadmap-feature`); `ROADMAP.md` was created 2026-07-10 to resolve the missing-roadmap impediment.

| Nº | Name | Acceptance + dependency | Priority / effort |
|---|---|---|---|
| 27 | **Graph-aware recall temporal correctness** — ✅ DONE (verified 2026-07-26) | `PgGraphExpansionStore` (`packages/core/src/infrastructure/db/pg-graph-expansion-store.ts:45,50`) now threads the shipped bi-temporal predicate via `composeTemporalWhere(filters.asOf, …, 'm.')` (memory rows) + `'ee.'` (edge rows), so graph expansion never resurfaces a `t_invalid` (superseded/evicted) memory and honors `asOf`. Regression tests: `in-memory-graph-expansion-store.temporal.test.ts` — **T1.4** (a superseded memory is NOT resurfaced through expansion) + **T1.3** (asOf returns the state valid at the instant). Reused the ADR-0011 predicate. The earlier "likely BUG" (JOIN without `m.t_invalid IS NULL`) NO LONGER HOLDS. | **DONE** — shipped + regression-tested. Item 28 (edge validity) stays ~80% redundant with this (do NOT build speculatively — YAGNI); Item 29 (evolving summaries) LOW/on-demand. |
| 28 | **Edge-level validity windows + fact invalidation** | `entity_edges` carries only `created_at` — no own `t_valid`/`t_invalid` and no automatic invalidation. Edge validity is TODAY derivable from the source memory via FK `source_memory_id` (Item 27 delivers exactly this). Own edge-bitemporality is needed ONLY for edges that contradict independent of a single source memory — **no user has requested this**. Scope: migration `entity_edges.t_valid/t_invalid` + invalidation policy behind a DIP + write-pipeline wiring. **Surfaces:** migration + core, REST `/v1/entities` + graph, MCP, Dashboard graph view (active vs superseded edge). **Depends:** Item 27 (which makes ~80% of this redundant). | **MEDIUM · effort L · ~80% redundant with #27.** Do NOT build speculatively — gate on a concrete edge-granular historical query actually appearing (YAGNI). |
| 29 | **Evolving entity summaries** | `entities` (mig. `0018_entity_nodes.sql`) has `name/embedding/payload/type` but NO `summary` field regenerated as facts accrue ('s node summary). Maintained-on-write = 1 LLM call per entity per update (recurring cost). **Prefer on-demand:** compute the summary when the entity is viewed, no eager LLM cost. **Surfaces:** core, REST `GET /v1/scopes/:type/:id/entities`, MCP, Dashboard Entities tab. **Depends:** entity+relation extraction (v0.11, shipped) + ontology (v0.16, shipped). | **LOW · nice-to-have · effort M (maintained-on-write) or S (on-demand).** On-demand only; never eager LLM per write. |

### Hardening candidates surfaced by cross-validation (IN-SCOPE under P0)

These are NOT features — they qualify as P0 hardening and may proceed now:

| Item | P0 sub-goal | Note |
|---|---|---|
| `packages/mcp` build broken (`packages/mcp/src/server.js` missing — `ERR_MODULE_NOT_FOUND`) | 3 (MCP available + reliable) | **CLOSED 2026-06-15** by `extract-cli-to-packages` build-fix (commit `57880fb`): root cause was dist `@usetheo/*` bare specifiers resolving to TS source; fixed via `postbuild:rewrite-aliases` + lazy optional-dep load. `themory --help` now boots env-free; regression guard `tests/integration/p0-audit/cli-dist-boot-envfree.test.ts`. |
| **`complete-workspace-publish-topology`** (reorg debt, follow-up plan — MOSTLY DONE 2026-06-15) | 2 (SDK functional) | Surfaced by `/review extract-cli-to-packages`. **DONE:** ADR D1-a (src-only) + D2-a (no npm bin; CLI via Docker) resolved by owner; `packages/core#files` src-only allow-list added; publish-readiness + pack-manifest + full-public-surface pack tests retargeted to `packages/core` (all GREEN); `@usetheo/memory/agent-tools` phantom subpath fixed via T4 (extracted shared helpers to the `@usetheo/memory-agent-core` leaf, ADR D3 — breaks the cli↔mcp cycle; subpath REDEFINED, pre-release breaking). **REMAINING (2 unmasked pre-existing decisions, `test.skip`'d):** (a) root barrel ships 9 exports vs T0.1 baseline 8 — API-owner decision; (b) `` paper-name policy vs the legitimate v0.9 benchmark vendor adapters — policy decision (exempt `benchmarks/` or rename). |
| Inverted test pyramid (95 integration : 10 unit) + dead-error reachability of the 18 error classes | 1 (APIs correct) | Rebalance with fast unit tests (scoring/mmr/extraction); run `/code-quality` to confirm no `dead_public_export` among the 18 error classes. |
| **Gateway-facing read endpoints: `GET /v1/metrics` + `GET /v1/entities` (+ subject-scoped forget)** — project-owner directive 2026-06-18 ("P0, AFTER the theo-cloud integration") | 1 + 2 (APIs correct + SDK functional) | **PLANNED (post-integration).** Surfaced by the theo-cloud gateway integration: the gateway (`internal/themory`) needs per-scope `metrics` (total/usage counters) + `entities` aggregation, which the REST surface does not expose today. The gateway currently DERIVES `total_memories` by paging the scope and reports usage counters as `0` (honest gap). A server-side `GET /v1/metrics` (real counters via OTel/`history`) + `GET /v1/entities` removes the O(scope) derivation. Also: a **subject-scoped forget** (e.g. `POST /v1/forget` honoring the scope, or `DELETE /v1/scopes/user/{id}/memories/{memId}`) would let the gateway drop its O(scope) ownership pre-check (the IDOR is closed gateway-side today). Sequence AFTER the integration round-trip is green (it now is — theo-cloud `tests/e2e` PASS). |

### Items cut / deferred (audit trail)

| Item | Status | Rationale |
|---|---|---|
| Adapters (, , ) | Out of scope (cut 2026-05-21) | Focus on being native backend, not wrapper. `@usetheo/sdk` already ships 3 `MemoryAdapter` packages (2026-05-20) for that use case. |
| Recency × importance × relevance scoring | Deferred to v0.4a behind strategy interface | README v1 promised; locked 2026-05-21 — v0.1 ships additive -style (production-tested). Multiplicative becomes opt-in strategy at v0.4a. |
| Demo `examples/chat-with-memory` eviction wiring via `createLocalMemory({ eviction })` | Deferred to follow-up cycle (paused 2026-05-31 via hotfix `b2909ff`) | F-T4.1-2 regression: when eviction is enabled AND `rememberTurn` calls `Promise.all([userScoped.remember, sessionScoped.remember])` in parallel, the `postRememberHook` + `CapacityBasedTrigger.fire` pipeline consumes user-scope rows even with scope size 0. Race-condition root cause; debugging deferred. Core eviction WORKS via the SDK direct path (integration suite 67/67 PASS); the disabled wiring is consumer-demo-only. |
| EC-9 skill-scope `asOf` (`memory.skills(repoId).recall({ asOf })`) | Deferred to follow-up cycle per plan v1-1 v1.3 ADR D4 amendment | v1.1 ships `asOf` for memory scopes only. Skill-scope adds extra ADR-0010 coordination — kept v1.1 focused. |
| Repo-tier semantic cache wiring (`memory.skills(repoId).recall` does NOT consult cache) | Deferred to v1.5.x per `semantic-recall-cache-v1-5-fixes-cycle-1` ADR D10 | `ScopeTierTtlConfig.repo` REQUIRED in public DIP but `LocalScopedSkillMemory.recall` skip cache. Mirrors v1.1 EC-9 honest deferral precedent. |

### Foundation artifacts (audit trail)

Detailed history of infrastructure cycles. Source-of-truth for "what landed when" beyond the macro Items table above.

| Artifact | Shipped |
|---|---|
| `.claude/knowledge-base/references/` clones ( + + , `--depth 1`, gitignored) | 2026-05-21 |
| `README.md` + strategic placement (Community auxiliary Apache-2.0 per 2026-06-09 realignment, TheoKit-native, vector-based hybrid, two runtimes) | 2026-05-21 |
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
| `p0-api-sdk-mcp-correctness-audit-fixes-cycle-1 hotfix` (4th glob `dist/local/migrations/meta/**` + tests 9+10; closes /review BLOCKER F-dom-cli-blocker-1 + CRITICAL F-dom-api-fix-1; pack manifest 415→427) | 2026-06-04 (`f0c0448`) |
| `p0-api-sdk fixes-cycle-2` ADR amendments (no-paper-names meta-test self-defense + cycle-implement Acceptable bypass paths; closes F-xval-1 + F-xval-5 MAJORs from /review fix-cycle-1) | 2026-06-04 (`b90841c`) |
| **PR #30 — Release `develop` → `main`** (56 commits: p0-api-sdk + fixes-cycle-1 + hotfix + fixes-cycle-2 ADR backfill) | 2026-06-04 (`b693361`) |
| `theo-memory-faang-auth-lifecycle` cycle (13 tasks T0.1→T5.1 via 14 commits + Step 5.5 typecheck-fix 033b37c; Camada 2 Stripe-shape lifecycle + Camada 3 OIDC dual-validation + MCP HTTP auth + RFC 9728 well-known + 3 new ADRs ADR-0013/0014/0015 + ADR-0009 supersession footer; GOAL TEST 12/12 integration scenarios GREEN vs real pgvector + stubbed RFC 7662; ALL 13 tasks committed) | 2026-06-07 (`8a767eb` + `033b37c`) |
| `theo-memory-faang-auth-lifecycle-fixes-cycle-1` cycle (7 tasks + plan v1.1 SHIPPABLE_WITH_CAVEATS 89/100 attestation `846994da`; closes 2 honest deferrals from parent — admin REST wire into createApp + production oauth4webapi IntrospectFn adapter + CLI --issuer plumb; 6 MUST FIX absorbed inline; GOAL TEST 6/6 e2e + 12/12 lifecycle sentinel) | 2026-06-07 (`f97c08a` + post-fixes `c0cc535`) |
| `/review` of `theo-memory-faang-auth-lifecycle-fixes-cycle-1` (6 specialist agents spawned in parallel — architecture/tests/wiring/cross-validation/domain-cli-tooling/domain-api-design; 20 findings consolidated; 5 MAJORs fixed inline at `c0cc535` — F-arch-1 ADR D1 contract restored, F-arch-2 regression closed, F-dom-api-1 14 public symbols re-exported, F-dom-api-2 WWW-Authenticate RFC 6750 §3, F-dom-api-3 IntrospectionResult expanded 4→12 RFC 7662 claims incl. `aud` for token-confusion mitigation; plus F-dom-cli-8 trim divergence + F-xval-3 CHANGELOG update) | 2026-06-07 (`aa64626`) |
| **PR #32 — Release `develop` → `main`** (56 commits: Item 20 FAANG auth lifecycle + fixes-cycle-1 + /review fixes; closes 3 unrelated pre-existing failures from examples-chat-migration via mockCtx JSON-body parse; test suite 1166/1171 → 1169/1171 i.e. **ZERO failures, only 2 SKIPs**) | 2026-06-07 (`fca24a7`) |
| `openmemory-mcp-compat` cycle (Item 26 — discover → plan SHIPPABLE 98.8 → implement 3 phases TDD → `/review` 6 agents → READY_TO_MERGE; opt-in OpenMemory tool surface + `connectSse` SSE transport + `themory mcp --compat openmemory`; GOAL TEST 4/4 real MCP client over SSE vs real pgvector; `/review` closed 1 BLOCKER cross-user delete IDOR + 5 HIGH; `/code-quality` PASS 100) | 2026-06-18 (`895cd9b`→`5c533e3`; review fixes) |
| **PR #50 — Release `develop` → `main`** (OpenMemory MCP-shape compat; tag `v0.5.0`; CHANGELOG Added + Security) | 2026-06-18 (merge `1e328a4`) |

---

## Relationship to other pillars

| Pillar | Project | Current integration (verify before claiming) |
| --- | --- | --- |
| Apex (runtime) | [TheoCloud](../theo) | Cloud runtime depends on Theo PaaS GA. No code today. v0.5 milestone. |
| Framework | [TheoKit](../theokit) | `@usetheo/memory/theokit` subpath ships v0.2 PR-A (PR #11). `memoryFromCtx(ctx, memory)` auto-scopes via structural typing (zero peer-dep, ADR D1). T4.1-T4.4 + T5.1 in sibling `theokit` repo PR-B pending. |
| Harness | [`@usetheo/sdk`](../theokit-sdk) | `@usetheo/memory/agent-tools` exposes 4 verbs as MCP tools consumable by any MCP-aware agent loop. `@usetheo/sdk` already ships its own `MemoryAdapter` interface + 3 adapter packages (2026-05-20) — different surface; TheMemory is the runtime, not the adapter. Future: `@usetheo/sdk` may accept TheMemory as a `MemoryAdapter` target. |
| UI | [`@theokit/ui`](../theo-ui) | `MemoryEditor` primitive already exists in `@theokit/ui` (one of 81 primitives). Natural consumer of TheMemory's API. No wiring today. |
| Coding assistant | [`theo-code`](../theo-code) | TheoCode has its own memory subsystem (`crates/theo-infra-memory/`). Different domain — no shared code planned. |

> "Do not invent integration that does not exist yet." (Root `CLAUDE.md` Cross-Project Rule 2.) Verify the actual import / dependency before claiming wiring exists in copy.

---

## Competitive superiority matrix

How each roadmap item maps to a specific competitor weakness.

| Competitor | Their moat | Our attack | Roadmap item(s) |
|---|---|---|---|
| **** ($24M) | Drop-in simplicity, vector-centric, large provider catalog | Same architecture + reflection + long-tail forgetting + skill library + bi-temporal local OSS (v1.1) + multi-region premium cloud (v0.5) + TheoKit-native default-on | 2, 5, 6, 7, 8, 3, 12 |
| **** ($10M) | Function-calling memory + sleep-time agents | Function-calling memory **without** agent-loop lock-in (we are primitive, not framework) | 4, 5 |
| **/** (YC W24) | Bi-temporal knowledge graph with audit | Bi-temporal queries (`asOf`) shipped in v1.1 local OSS (Apache-2.0) — 's headline feature now commodity under our license. Multi-region replication + audit-mgmt remain the v0.5 cloud premium. Graph backend separately tracked as Item 14 (v1.3). | 12, 7, 14 |
| **** ($5.35M) | Theory-of-mind / identity modeling | Multi-peer `attributed_to` **without** AGPL restriction (Apache-2.0) | 12 |
| **** | Ontologies + poly-store | Typed domain ontologies without poly-store complexity | 15 |
| **** | Procedural memory via prompt rewriting | Procedural skill library **with** automatic refactoring (, ships executable code not just prompts) | 8 |
| **All competitors ** | No documented read-side query cache layer | Semantic recall cache via query-embedding cosine — caches `recall` results without re-running pipeline + LLM rerank on near-duplicate queries. Greenfield surface. | 19 |
| ** Memory** | Block composition with priority truncation | Three-scope tier model + reflection + skill library (their blocks have no identity, no procedural) | 1, 5, 8 |
| **Vector DBs** (///etc.) | Multi-tenancy at scale | Real semantic memory primitives (extraction, consolidation, scoring, forgetting) on top of pgvector | 2, 5, 9 |

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
| [``](./.claude/knowledge-base/references//) | 78 MB | Apache-2.0 | Primary architectural reference (vector + LLM extraction + hybrid retrieval) |
| [``](./.claude/knowledge-base/references//) | 34 MB | Apache-2.0 | Postgres + pgvector schema, Alembic migrations, sleep-time agents (reflection design) |
| [``](./.claude/knowledge-base/references//) | 3.9 MB | MIT | Procedural memory via prompt rewriting |

The directory is **gitignored** (see `.gitignore`) — clones never enter git.

---

## Open questions for the contract design (all resolved)

1. ~~**Multi-peer / `attributed_to` support.**~~ **RESOLVED 2026-05-22 → v1.1 (Item 12).** Deferred from v0.0 to keep contract minimal; backward-compat via optional column.
2. ~~**`update` semantics inside ADD-only.**~~ **RESOLVED 2026-05-22 → [ADR-0003](.claude/knowledge-base/adrs/ADR-0003-add-only-public-api.md).** ADD-only. No public `update`. Mutation = `forget(id) + remember(newText)`. `history(memoryId)` exists for audit.
3. ~~**Reflection trigger.**~~ **RESOLVED 2026-05-22 → [ADR-0005](.claude/knowledge-base/adrs/ADR-0005-reflection-trigger.md).** Explicit-only at v0.0. Threshold + sleep-time policies land at v0.4a behind same DIP — zero contract change.
4. ~~**Bi-temporal `t_valid` / `t_invalid` columns on local.**~~ **RESOLVED 2026-05-22 → [ADR-0006](.claude/knowledge-base/adrs/ADR-0006-bi-temporal-local-schema.md); AMENDED 2026-06-03 → [ADR-0011](.claude/knowledge-base/adrs/ADR-0011-bi-temporal-local-runtime-gate-lift.md).** v1.1 LIFTS the runtime-clause: local `recall({ asOf })` honored via null-safe predicate. Schema clause REINFORCED. CAVEAT: EC-9 skill-scope `asOf` deferred to follow-up cycle.
5. ~~**Entity store opt-out.**~~ **RESOLVED 2026-05-22 → ADR-0007; AMENDED 2026-07-24 → [ADR-0023](.claude/knowledge-base/adrs/ADR-0023-m15-entity-boost-flag-gates-real-behavior.md).** Constructor-level flag `MemoryConfig.entityBoost?: boolean` defaults to `true`. When `false`, no entity vector store instantiated. M15 (#122) fecha a metade que não valia: até então a flag gateava apenas o write path, porque o read path somava o componente `entity` como constante zero. Agora ela governa os dois lados.
6. ~~**`THEOKIT_API_KEY` reuse.**~~ **RESOLVED 2026-05-22 → [ADR-0009](.claude/knowledge-base/adrs/ADR-0009-cloud-auth-theokit-api-key.md).** Reuse `THEOKIT_API_KEY` env var with optional explicit `apiKey` constructor parameter override. No separate `THEMEMORY_API_KEY` (REST API server (Item 16) uses `THEMEMORY_API_KEY` for bearer auth specifically, distinct from cloud SDK auth).

---

## Inviolable rules (from root and global)

1. **95% confidence gate.** Ask if uncertain. Especially load-bearing for theo-memory — the 4 root overrides are documented because they came from confirming with the project owner explicitly, not from inference.
2. **Task completion gate.** Finish before starting a new task.
3. **Extreme honesty.** Admit ignorance. Surface risks. The single biggest honesty risk here is claiming production-ready before the owner declares v1.0 (both technical gates are resolved per ADR-0020; `/dogfood` = `EVIDENCE_SUFFICIENT`), and making any comparative "faster-than" claim without the full `public-copy.md § 4` evidence.
4. **Git rules.** No `git checkout` or `git revert`. No direct work on `main`.
5. **TDD.** Tests before production code; bug fixes start with a regression test. Especially critical for the LLM-extraction pipeline — write the prompt-output assertion test first.
6. **Changelog discipline.** Every code change updates `CHANGELOG.md`.
7. **Don't reinvent.** `pgvector`, `pg`, `zod` for the schema layer. `@usetheo/sdk`'s LLM client + `MemoryAdapter` for ecosystem reuse. 's two-stage pipeline is the proven shape — adopt, don't redesign.
8. **No emojis** in code, READMEs, CHANGELOGs, or CLAUDE.md files unless explicitly requested.
9. **No paper names in code** per `.claude/rules/no-paper-names-in-code.md` (promoted 2026-05-30). Knowledge-base docs MAY cite / / / etc.; `src/**` + tests MUST NOT.
10. **PRIORITY 0 HARDENING discipline** (locked 2026-06-04; **feature freeze LIFTED 2026-06-21** — see § PRIORITY 0 → Amendment 2026-06-21). The 3 P0 sub-goals (API correct + SDK functional + MCP available) remain the quality bar and take precedence when a new feature conflicts with hardening. The categorical FREEZE on Items 13/14/15 + Phase V is NO LONGER in force (full unfreeze, project-owner sign-off). **`production-ready`/v1.0 label remains an owner release decision** — both technical gates are resolved (2026-07-20): `/dogfood` `EVIDENCE_SUFFICIENT` + the comparative-benchmark gate DROPPED per ADR-0020 (Item 11). The unfreeze does NOT touch the honesty discipline: no `production-ready` label until the owner cuts v1.0, and no comparative claim without `public-copy.md § 4`.

Full text: `<HOME>/.claude/CLAUDE.md`. Cross-project rules: `<HOME>/Projetos/usetheo/CLAUDE.md`.

---

## When this file is wrong

The code and the README are authoritative. If this file disagrees with them, the code/README win — update this file via PR with a one-line rationale in the commit message.

**Locked items** require explicit strategic review:

- **Locked names** (npm package, license Apache-2.0 aligned with monorepo, tier, memory tiers, API verbs, two runtimes, subpath exports) — root-level strategic review.
- **Voice and tone** — root-level strategic review per Voice and Tone section.
- **Two root overrides** (Cross-Project Rule 6 exception, Phase 1 scope) — root-level strategic review. (Prior MIT license exception reverted 2026-06-09 — see Product Hierarchy footnote.)
- **ADR-0010 RepoScope 4th tier** + **ADR-0011 bi-temporal runtime lift** — project-owner sign-off required.
- **PRIORITY 0 directive** (locked 2026-06-04, GO-TO CTO project-owner sign-off) — lifting the freeze on Items 13/14/15 OR introducing new features outside the 3 P0 sub-goals requires project-owner sign-off recorded in CHANGELOG + CLAUDE.md amendment.

Do not edit any of the above silently. Surface the conflict to the user first.


## This module's role in the Theo platform (reference capability)

theo-memory is the **reference implementation** of the platform's data-plane capability pattern —
exposed at the unified Traefik edge as **`/v1/memory`** with ForwardAuth per-tenant isolation
(Model B: the gateway mints a per-tenant key and injects it upstream; the module never sees the
client's key — CWE-441 closed). Other modules (theo-rag, …) copy this pattern to integrate.

To run the whole platform locally and live-test memory end-to-end, use the local-env umbrella in
**theo-workspace**: **`theo-workspace/docs/README.md`**
(repo `usetheodev/theo-workspace`; local sibling: `../../theo-cloud/theo-workspace`).

Memory developer workflow — run theo-memory from THIS source against the rest of the platform:

- `docs/ONBOARDING.md § 4.B` — `make memory-up MODE=--host` (you run `node dist/agent-tools/cli.js server`; the script provisions Model B against it).
- `docs/adding-a-microservice.md` — the capability pattern this module defines (so you keep it integrable as it evolves).

Honest notes from the live validation (2026-06-25/26): the standalone host run needs
`node-linker=hoisted` (in `.npmrc`) so the flattened `dist/` resolves workspace deps (e.g. `eld`);
the LLM/provider is always the **real** OpenAI API (no mock); the gateway's platform-admin
credential must carry the **`memory:platform-admin`** scope to mint per-tenant keys.
