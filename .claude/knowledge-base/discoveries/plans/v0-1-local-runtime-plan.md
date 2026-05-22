# Discovery Plan: v0.1 Local Runtime (Mem0-shape pipeline + pgvector schema)

> **Version 1.1** — Investigate how `referencia/mem0/mem0-ts/` implements the locked Mem0-shape pipeline (6-phase write + 9-step search + additive scoring + hash dedup + entity store + per-row fallback) and how `referencia/letta/` schemas + tests pgvector against real Postgres. Output: a technical blueprint that informs the v0.1 `/to-plan` for the local runtime — concrete file:line citations for every pattern we'll port, ADRs distinguishing what to copy vs what to adapt, deps/tools recommendations grounded in what the references actually use.
>
> **Change log:**
> - **v1.0 → v1.1 (2026-05-22)** — Absorbed 8 edge cases from `.claude/knowledge-base/reviews/v0-1-local-runtime-edge-cases-2026-05-22.md`. **2 MUST FIX:** EC-1 added sampling criterion to Q5 (Letta has 167 Alembic migrations — need pre-filter Grep before selecting representatives) + EC-2 same for Q4 (Mem0-ts has 26 test files — pre-filter pipeline tests vs adapter tests). **4 SHOULD TEST** added as new halt-loop checkpoints: EC-3 per-file Read cache for `memory/index.ts` re-read across Q1/Q2/Q3, EC-4 split-read guidance for Q1 489-line method, EC-5 Q6 reads both `pyproject.toml` AND `uv.lock`, EC-6 soft-warning budget checkpoint. **2 DOCUMENT** added as ADRs/notes: EC-7 ADR D5 confirms execute reports code reality not narrative count, EC-8 Q3 PARTIAL outcome valid for multi-sub-topic questions.

**Slug:** `v0-1-local-runtime`
**Owner:** TheMemory v0.1 cycle-discover
**Created:** 2026-05-22
**Time budget:** 6h total (Mem0: 4h, Letta: 2h, LangMem: 0h — see D1)

## Context

**What motivates this discovery NOW.** Roadmap Item 1 (v0.0 Contract design) ships in PR #4 with 5 DIPs + Memory/ScopedMemory surface. The next roadmap item is **Item 2 — v0.1 Core + local runtime** (`CLAUDE.md § Macro roadmap`). v0.1's acceptance criteria reference 6-phase write + 9-step search + additive scoring as locked behaviors. Before writing the implementation plan for v0.1, we need a blueprint capturing how the reference projects actually implement these patterns — not just summaries from CLAUDE.md.

**Evidence triggering this discovery:**
- v0.0 contract ADRs cite specific Mem0-ts paths verbatim (`referencia/mem0/mem0-ts/src/oss/src/{embeddings,llms,vector_stores,storage}/base.ts` per ADR-0008). Those DIPs were copied; the runtime needs equally faithful porting of the pipeline that consumes them.
- `.claude/rules/architecture.md § 4 Mem0-shape architecture` lists the "Adopt" set as locked patterns. The blueprint MUST cite where each adopted pattern lives in `referencia/mem0/mem0-ts/src/oss/src/memory/index.ts` (1708 LoC; non-trivial).
- ADR-0006 (bi-temporal local schema) declares `tValid` / `tInvalid` columns. We need to verify how Letta's pgvector schema handles temporal columns + Alembic migrations before designing ours.
- ADR-0001 (Mem0-shape) is the contract; without a concrete adopt-map, v0.1 implementation will drift.

**Cross-references:**
- `CLAUDE.md § Macro roadmap` Item 2 — v0.1 acceptance criteria
- `.claude/rules/architecture.md § 4` — Adopt / Diverge / Defer lists
- ADR-0001, ADR-0006, ADR-0008 (in `.claude/knowledge-base/adrs/` once PR #4 merges)
- `referencia/mem0/mem0-ts/src/oss/src/memory/index.ts` — the 1708-line implementation we're porting

## Objective

**Produce a blueprint that lets `/to-plan v0-1-local-runtime` lock concrete decisions for the 6-phase write pipeline, 9-step search, hash dedup, entity store, pgvector schema, integration test approach, and dev tooling — every decision grounded in a verified `referencia/{...}` citation.**

Success criteria:

- [ ] All 7 research questions answered with citations to `referencia/`
- [ ] Cross-cutting comparison table populated for Mem0 + Letta (LangMem ADR-deferred per D3)
- [ ] Recommendations section provides at least one concrete decision proposal per in-scope research question
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS
- [ ] Blueprint cites at least one project rule (`architecture.md` or `testing.md`) in its ADR Rationale

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `referencia/mem0/` | `mem0-ts/src/oss/src/memory/`, `mem0-ts/src/oss/src/utils/`, `mem0-ts/src/oss/src/vector_stores/pgvector.ts`, `mem0-ts/src/oss/src/prompts/`, `mem0-ts/src/oss/tests/`, `mem0-ts/package.json`, `server/` (for docker-compose patterns) | Primary architectural reference; the 6-phase + 9-step pipelines live here verbatim. TS impl maps directly to our `src/local/`. |
| `referencia/letta/` | `letta/orm/`, `letta/services/`, `letta/alembic/`, `letta/compose.yaml`, `letta/dev-compose.yaml`, `letta/pyproject.toml` | Pgvector schema + Alembic migration patterns + integration test against real Postgres |
| `referencia/langmem/` | (none — ADR-deferred per D3) | Out of v0.1 scope; LangMem is procedural-memory (v0.6) not pgvector-runtime |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| `referencia/mem0/docs/` | Marketing docs; not source of truth for the pipeline |
| `referencia/mem0/mem0/` (Python SDK) | We implement the TS port; mem0-ts is canonical for our purposes. Python ref consulted only if a TS path lacks a clear answer (escape hatch noted under D2). |
| `referencia/mem0/embedchain/` | Legacy RAG framework; separate codebase; not the memory layer |
| `referencia/mem0/openmemory/`, `mem0/server/dashboard/`, `mem0/openclaw/` | UI / plugin / hosted server — not the local runtime |
| `referencia/letta/letta/agent.py`, `letta/streaming/` | Agent loop + streaming — not memory storage. Letta-as-framework is out-of-scope (ADR-0001 § Letta-shape rejected) |
| `referencia/langmem/` (entirely) | ADR-deferred per D3 |
| Any project NOT cloned into `referencia/` | Inquebrável Rule: never claim a project feature without reading its source |

## ADRs

### D1 — Time budget + stop conditions

**Decision:** Mem0: 4h, Letta: 2h, LangMem: 0h (deferred per D3). Total: 6h.

**Rationale:** Mem0 is the locked architectural reference (ADR-0001) AND its TS impl (`mem0-ts/src/oss/src/memory/index.ts`, 1708 LoC) is what we directly port for v0.1. Letta's relevance is narrower — pgvector schema + Alembic migration patterns + integration test style — so half the budget. LangMem is procedural-memory (prompt rewriting); doesn't fit v0.1 pgvector-runtime scope; revisit at v0.6 (roadmap Item 8 Voyager skills).

**Alternatives considered:** Equal 2h split — rejected because Mem0 dwarfs Letta in relevant surface (1708 LoC vs ~300 LoC for Letta's orm/passage_tag + relevant services). Single-project deep-dive Mem0-only — rejected because Letta's pgvector schema may surface migration patterns Mem0-ts skips (Mem0 uses raw queries; Letta uses SQLAlchemy + Alembic which is closer to our planned Drizzle migration story).

**Stop condition — per question (mandatory):** When a question's Fase A returns empty matches after 3 consecutive retries with different query variants (e.g., pattern → kind-based → alternate path → broader scope), mark the question BLOCKED with reason "Fase A exhausted — no hotspots found" and continue to the next. Do NOT pad with unrelated hotspots from a different question's scope.

**Stop condition — per project (mandatory):** When a project's time budget is exhausted with N questions still pending, mark all remaining questions for that project as BLOCKED with reason "budget exhausted" and continue with the next project (or, if last, emit the promise with the honest blocked-questions report).

**Anti-pattern:** NEVER fabricate Fase B answers to close a question whose Fase A was exhausted. Honest BLOCKED with reason is required (Inquebrável Rule 3).

**Consequences:** the halt-loop will stop iterating on a project when its budget is exhausted, even if some questions remain blocked. The blueprint will surface blocked questions explicitly in `## Blocked questions (if any)` — they become next-discovery seed.

### D2 — Investigation depth

**Decision:** Hybrid Fase A (broad ast-grep / Grep for hotspots) + Fase B (Read each hotspot in context). For Mem0's `memory/index.ts` (the centerpiece), Read end-to-end since it's the single load-bearing file (1708 LoC ≈ 30-40k tokens). For utility files (`scoring.ts`, `lemmatization.ts`, `entity_extraction.ts`), Read fully. For Letta's pgvector schema, Read `orm/` files + `alembic/` migration history.

**Rationale:** Mem0-ts's `memory/index.ts` is the implementation we will port — partial reads risk missing the per-row fallback patterns that make the pipeline robust. Utility files are small enough to read fully. Letta's schema files are short and load-bearing.

**Alternatives:** Grep-only — rejected; loses context around the pattern. AST-grep-only — rejected; AST patterns are powerful for code-shape questions but miss prose comments and adjacent code. Hybrid is the right shape.

**Escape hatch:** If a TS file in Mem0 lacks a clear answer for a question (e.g., the rationale behind a specific algorithm), consult the Python SDK (`referencia/mem0/mem0/memory/`) ONCE as a confirmation read. Cite both. Do not turn this into a full Python sub-investigation — TS is canonical for our scope.

**Consequences:** Mem0 budget (4h) is tight given the 1708-LoC centerpiece read. Mitigation: split the centerpiece into the 6 write-pipeline phases + 9 search-step sections per Q1 / Q2 / Q3, and Read the relevant slice per question rather than re-reading the full file 3×.

### D3 — LangMem deferral

**Decision:** LangMem is OUT OF SCOPE for this v0.1 discovery. Zero time budget. Re-enter at the v0.6 discovery (Item 8 — Voyager-style skill library) when procedural memory becomes relevant.

**Rationale:** LangMem's primary value is procedural memory via prompt rewriting (per `CLAUDE.md § Competitive superiority matrix` row LangMem). v0.1 ships pgvector + Mem0-shape extraction pipeline — fundamentally different architecture (vector + LLM extract + retrieval vs prompt rewriting). Including LangMem would dilute attention without informing v0.1 decisions.

**Alternatives:** 1h budget for LangMem "just to compare" — rejected; the comparison is already documented in ADR-0001 (Mem0-shape adopted; LangMem-style deferred). Re-reading would produce the same conclusion.

**Consequences:** Coverage Matrix's "Techniques" corner is mapped only to Mem0/Letta, not LangMem. v0.6 cycle-discover will revisit. This deferral is explicit, not omission.

### D5 — Blueprint reports code reality, not ADR narrative (EC-7)

**Decision:** When the code in `referencia/mem0/mem0-ts/src/oss/src/memory/index.ts` implements a slightly different breakdown than the "6-phase write" / "9-step search" counts declared in `.claude/rules/architecture.md § 4` (and ratified by ADR-0001), the blueprint DESCRIBES WHAT THE CODE ACTUALLY DOES — not the ADR narrative. If counts diverge (e.g., 5 phases due to fusion, or 10 steps due to splitting), surface the divergence explicitly with citations.

**Rationale:** ADR-0001 was authored against Mem0 at a snapshot in time. The reference clones (`--depth 1`) capture a possibly newer or older revision. Forcing the count to match the ADR would be fabrication; honest reporting of actual code preserves Inquebrável Rule 3.

**Alternatives:** Forced-narrative reporting (match ADR count regardless) — rejected; violates honesty. Skip the structural breakdown entirely — rejected; loses the most valuable comparison data.

**Consequences:** The blueprint may diverge from the ADR's count. If divergence is material (e.g., Mem0 dropped a phase entirely), the v0.1 `/to-plan` may need to update ADR-0001 in the same PR. Document divergences in the blueprint's `## ADRs synthesized` section so they're visible.

### D4 — Use ast-grep when the question is code-shape; text-search when the question is text-shape

**Decision:** Per-question phase A method declared explicitly. Code-shape questions (e.g., "where does Mem0 implement the 6-phase write?") use ast-grep patterns; text-shape questions (e.g., "what pg version does Letta declare in pyproject.toml?") skip Fase A and go directly to Glob/Grep.

**Rationale:** ast-grep finds structural patterns reliably; text-search finds config strings reliably. Using ast-grep on configs (or text-search on code) wastes iteration budget and produces noisy hotspots.

**Consequences:** the Research Questions table below declares per-question whether Fase A uses ast-grep, plain Grep, or SKIPs to Fase B directly.

## Research Questions

| # | Question | Corner | Reference project(s) | Fase A (broad — ast-grep / Grep map) | Fase B (deep — Read at each hotspot) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | How does Mem0-ts implement the 6-phase write pipeline (context gather → existing retrieval → single LLM extraction → batch embed → hash dedup → batch persist) with per-row fallbacks at each I/O boundary? | techniques | `referencia/mem0/mem0-ts/` | `ast-grep run --lang typescript -p 'async add($$$) { $$$ }' referencia/mem0/mem0-ts/src/oss/src/memory/`; also Grep for `try { $$$ } catch` blocks within the matched range to map fallback handlers | Read `referencia/mem0/mem0-ts/src/oss/src/memory/index.ts:507-996` (the `add` method, 489 lines) end-to-end, plus the helpers it calls in `utils/factory.ts`. **EC-4 split-read guidance:** if 489-line single Read exceeds remaining context budget in the iteration, split into 3 chunks (507-670, 670-833, 833-996) — one chunk per phase-pair of the 6-phase pipeline. Capture each phase's input, output, and fallback path | Table: phase → input → output → file:line → fallback shape; plus prose summary of where extraction prompt is composed |
| Q2 | How does Mem0-ts implement the 9-step search with additive scoring (`semantic + bm25 + entity_boost / max_possible`) including sigmoid normalization and the entity-store opt-in? | techniques | `referencia/mem0/mem0-ts/` | `ast-grep run --lang typescript -p 'async search($$$) { $$$ }' referencia/mem0/mem0-ts/src/oss/src/memory/`; Read `referencia/mem0/mem0-ts/src/oss/src/utils/scoring.ts` (small) to map ScoredResult / normalizeBm25 / ENTITY_BOOST_WEIGHT exports | Read `referencia/mem0/mem0-ts/src/oss/src/memory/index.ts:1037-1271` (search method) + scoring.ts fully + `utils/entity_extraction.ts`. Document each of the 9 steps with file:line | Step-by-step table: step → operation → file:line, plus the additive scoring formula's actual implementation + entity_boost gating condition |
| Q3 | How does Mem0-ts implement hash dedup (MD5 normalize), UUID→int mapping for LLM prompts (anti-hallucination), and BM25 lemmatization? | techniques | `referencia/mem0/mem0-ts/` | Read `referencia/mem0/mem0-ts/src/oss/src/utils/lemmatization.ts` + Grep `createHash\|MD5` in `referencia/mem0/mem0-ts/src/oss/src/memory/` for dedup callsites; Grep `uuidv4\|integer.map\|toInteger` in same dir for UUID→int mapping | Read each hotspot in context. Capture: dedup hash function + normalization, UUID→int mapping algorithm + where it's used in prompts, lemmatization library + BM25 hookpoint | 3 separate prose subsections (dedup / uuid-int / lemmatization) with file:line citations + algorithm shape |
| Q4 | How does Mem0-ts test the LLM-extraction + write pipeline? Real LLM stub fixtures vs mocks vs network calls? How is determinism achieved? | tests | `referencia/mem0/mem0-ts/` | **EC-2 sampling criterion:** `referencia/mem0/mem0-ts/src/oss/tests/` contains 26 `.test.ts` files (verified via `find ... -name '*.test.ts' \| wc -l`). Many test adapter unit-tests (azure-embedder.test.ts etc.) which are NOT representative of the integration pipeline. Pre-filter: Grep `add\|search\|extraction` over the 26 files to identify pipeline-touching tests; THEN select 3-5 from THAT filtered set (NOT from all 26). Also `ast-grep run --lang typescript -p 'describe($$$, ($$$) => { $$$ })'` on the filtered set for structure; Grep `mock\|stub\|fixture` for determinism mechanism | Read the 3-5 filtered representative test files end-to-end. Capture: LLM stub pattern (returns fixed string vs schema), test isolation (per-test reset vs shared state), pgvector test backend (real Docker container vs in-memory mock) | Table: test file → LLM stub type → pgvector backend → isolation pattern, plus narrative of the canonical test shape (1 sample test transcribed). Surface the filter rationale (e.g., "26 total files; 8 matched `add\|search\|extraction`; sampled 3 of those 8 by mtime"). |
| Q5 | How does Letta schema + test pgvector against real Postgres? Alembic migration patterns + integration test fixture style? | tests | `referencia/letta/` | **EC-1 sampling criterion:** `referencia/letta/alembic/versions/` contains 167 migration files (verified via `ls \| wc -l`) — most touch non-memory schemas (org, identity, agent, etc.). Pre-filter: Grep `passages\|memories\|archival_memory\|vector` over `versions/*.py` to identify memory-schema-relevant migrations; THEN select 3 representatives from THAT filtered set: (a) the FIRST one that creates the memory table (oldest mtime in filtered set), (b) the MOST RECENT one altering it (newest), (c) ONE INTERMEDIATE. Also Grep `pgvector\|VECTOR(` in `referencia/letta/letta/orm/` to find vector column declarations; Grep `pytest\|testcontainers\|conftest` in `referencia/letta/tests/` to find integration test setup (confirmed exists: `referencia/letta/tests/conftest.py`) | Read the 3 filtered representative Alembic migrations + 2-3 orm files declaring vector columns + 1-2 integration test files | Table: migration → schema change → vector column shape; plus prose on integration test setup (container? fixture?). Surface filter rationale (e.g., "167 total migrations; 12 matched memory keywords; sampled 3 of those 12 by 'first/middle/last' criterion"). |
| Q6 | What versions / clients do Mem0-ts and Letta use for pgvector, the pg driver (pg / asyncpg / postgres-js), and the ORM (raw SQL / Drizzle / SQLAlchemy)? Are there other deps we'll need for v0.1 (lemmatization libs, hash libs, retry/backoff)? | deps | `referencia/mem0/`, `referencia/letta/` | SKIP Fase A — text-shape question. **EC-5 dual-source:** Read BOTH `referencia/mem0/mem0-ts/package.json` (declared ranges) AND `referencia/mem0/mem0-ts/package-lock.json` if discoverable for resolved versions. Same for Letta: Read BOTH `referencia/letta/pyproject.toml` (declared ranges; Hatchling build-system; confirmed STATIC deps not dynamic) AND `referencia/letta/uv.lock` (exact resolved versions — what TheMemory's /deps-audit reference for v0.1 plan). Grep `pgvector\|postgres\|drizzle\|sqlalchemy\|asyncpg\|psycopg` in all four files | Read each match in context. Capture: package name → declared range → resolved version → use site (production dep vs dev dep vs test dep) | Two tables (one per project): package → declared range → resolved version → role; plus a consolidated TheMemory dep-shortlist with Rule 9 alternatives commentary using RESOLVED versions as anchor |
| Q7 | What's the local-dev story for Mem0-ts and Letta? Docker-compose for Postgres? Migration command? Integration-test command? | tools | `referencia/mem0/server/`, `referencia/letta/` | SKIP Fase A — text-shape question. List `referencia/mem0/server/docker-compose*.yaml` + `referencia/letta/compose.yaml` + `referencia/letta/dev-compose.yaml`; Grep for `migrate\|test:integration\|alembic upgrade` in Makefiles + package.json scripts | Read each compose file + relevant Makefile / scripts section | Side-by-side table: project → docker services → integration test cmd → migration cmd, plus recommended local-dev shape for TheMemory v0.1 |

**Total: 7 questions** (within 5-10 budget; 3 in techniques, 2 in tests, 1 in deps, 1 in tools; max 3 per corner respected; LangMem corner empty per D3 ADR deferral).

## Coverage Matrix

| Corner | Questions mapped | Status |
|---|---|---|
| Integration tests | Q4, Q5 | Covered |
| Dependencies | Q6 | Covered |
| Tools | Q7 | Covered |
| Techniques | Q1, Q2, Q3 | Covered |

**Coverage: 4/4 corners covered (100%).**

## Halt-loop Checkpoints

For `/discover-execute`: what intermediate state MUST hold before the loop can mark a question DONE.

| Checkpoint | Assertion | Action if fails |
|---|---|---|
| Before answering Qx | All `referencia/{...}` paths declared in Fase A column exist (verified via `test -e`) | Mark Qx BLOCKED with reason "path not found", continue to next |
| Per-question Fase A budget | Fase A returned at least one hotspot OR 3 query-variant retries attempted | After 3 retries with empty results, mark Qx BLOCKED with reason "Fase A exhausted"; continue |
| After answering Qx | Blueprint section under Qx has at least one citation with file:line | Re-iterate Qx (1 retry max) |
| Mid-loop sanity | Total `referencia/` citations ≥ 1 per 200 words of blueprint prose | Add citations to under-cited paragraphs (1 retry max) |
| Per-project time budget | Project time budget not exhausted (Mem0: 4h, Letta: 2h) | When exhausted, mark all remaining Qx for that project BLOCKED with reason "budget exhausted"; advance to next project |
| **EC-6 — Soft budget warning (early signal)** | If budget remaining < 30% AND > 50% of questions still pending/blocked, surface honest "budget at risk" warning in the iteration log (NOT a halt — informational only). D1's stop conditions still own the hard exhaustion case | Log warning; the user reading the audit trail can decide bump budget or accept partial blueprint at next /discover-confidence |
| **EC-3 — Per-file Read cache (no re-Read amplification)** | If `referencia/mem0/mem0-ts/src/oss/src/memory/index.ts` (1708 LoC) was Read in a prior question's Fase B, subsequent questions on the same file MUST cite via line range from the prior Read rather than re-Reading the full file | Halt-loop tracks file-read state per discovery run (in iteration log); when a re-Read would occur, instead cite the relevant line range from the cached Read |
| **EC-8 — PARTIAL outcome valid for multi-sub-topic questions** | Q3 has 3 sub-topics (hash dedup + UUID→int + lemmatization). If ONE sub-topic's Fase A exhausts (3 retries) BUT the other 2 produced answers, mark Q3 PARTIAL (not full BLOCKED). PARTIAL is a valid outcome surfaced in `## Blocked questions (if any)` with explicit sub-topic granularity | Continue to next question; PARTIAL questions get their own line in the blocked-questions summary with which sub-topic was blocked |
| Before promising complete | All 4 coverage corners have populated sections | Refuse promise; continue iterating |

## Acceptance Criteria

Observable conditions for "this discovery is done":

- [ ] All 7 research questions answered OR explicitly marked BLOCKED with reason
- [ ] All four coverage corners have populated sections in the blueprint
- [ ] Every citation in the blueprint points to a real `referencia/{...}` path (verified via `Path.exists()`)
- [ ] At least one ADR section in the blueprint synthesizes decisions taken (e.g., "for v0.1, adopt Mem0's per-row fallback shape verbatim; defer entity store impl to a follow-up plan")
- [ ] Time budget respected per project: Mem0 ≤ 4h, Letta ≤ 2h, total ≤ 6h
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS
- [ ] Blueprint saved at `.claude/knowledge-base/discoveries/blueprints/v0-1-local-runtime-blueprint.md`
- [ ] Blueprint cites at least one project rule (`architecture.md § 4` adopts list, or `testing.md` pyramid) in its ADR Rationale

## Global Definition of Done

- [ ] All cycle-discover phases completed: plan → edge-cases → execute → confidence → improve (if needed) → confidence re-score
- [ ] Final `/discover-confidence` verdict recorded in the blueprint header
- [ ] No fabricated citations (all `referencia/` paths verified via `test -e` or `Read` tool)
- [ ] Coverage Matrix 100% covered
- [ ] ADRs reference at least one principle from project rules (SOLID/DRY/KISS/YAGNI) or project rule file (`architecture.md`, `testing.md`, `public-copy.md`)
- [ ] Blueprint sized appropriately: ≤ 1500 LoC markdown (lessons distilled, not full file dumps)
- [ ] Plan archival per audit-trail-rotation policy: AFTER blueprint + skill-distillation tail land, leave plan at `.claude/knowledge-base/discoveries/plans/v0-1-local-runtime-plan.md` (discovery plans do NOT have a `completed/` lifecycle today per `audit-trail-rotation.md § KEEP forever`)
