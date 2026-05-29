# Discovery Plan: v0.4b — Forgetting pipeline with long-tail preservation

> **Version 1.1** — Investigate how to lock the v0.4b forgetting/eviction pipeline: a triadic-signal scoring layer (Ebbinghaus time decay + LRU/LFU access frequency + LLM-judged importance) WITH an explicit anti-long-tail guardrail (rare-but-semantically-isolated memories receive a protection multiplier defeating frequency bias). Roadmap Item 6 — CLAUDE.md flagged this as **OPEN PROBLEM #1** ("no competitor solved this"). v0.1 ships `Memory.forget(id)` for caller-driven removal; v0.4b adds the AUTOMATED forgetting layer that decides what to evict when capacity/decay thresholds fire. Reference projects: `.claude/knowledge-base/references/letta/` (primary — archival memory via `letta/services/passage_manager.py` + context-window calculator + agent_manager), `.claude/knowledge-base/references/mem0/` (secondary — explicit `delete/delete_all/_delete_memory` API but NO automated eviction; positioning-insight target), plus prior_art on Ebbinghaus 1885 forgetting curve modern reformulations + cache eviction literature (LRU/LFU/LIRS/ARC/2Q) + any "long-tail preservation" research. LangMem NOT cloned — covered via web. The blueprint will inform `/to-plan v0-4b-forgetting-pipeline` by locking: (a) triadic scoring shape (additive vs multiplicative; default weights), (b) Ebbinghaus decay function (constants from literature), (c) LRU/LFU implementation (in-memory vs DB), (d) long-tail guardrail mechanism (anti-frequency-bias protection multiplier), (e) eviction trigger (capacity-based / time-based / threshold-based), (f) test pyramid for triadic scoring + guardrail edge cases.

**Slug:** `v0-4b-forgetting-pipeline`
**Owner:** TheMemory v0.4b cycle-discover (forced-override invocation via /auto-plan)
**Created:** 2026-05-26
**Time budget:** 6h (per-project breakdown in ADR D1)

## Context

Roadmap Item 6 (CLAUDE.md § Macro roadmap, currently Planned, **OPEN PROBLEM #1**). Dependencies: Item 5 (v0.4a reflection pipeline) ships first (reflection's LLM-importance score is reused by forgetting's triadic signal — the SAME `llm_importance_score` column added by v0.4a per ADR D5/D11).

**Acceptance criteria from CLAUDE.md § Roadmap Item 6 (verbatim):**

> Curated test set: 1000 memories with 50 rare-query targets seeded. After `forget()` cycle removing 30% by triadic score: `recall@10` on rare-query set ≥ TBD (lock by v0.4b kickoff). Guardrail unit test: a rare-but-isolated memory survives ≥ 5 consecutive LRU eviction passes against frequent siblings. Evaluation matrix published at `docs/forgetting-evaluation.md` (artifact must exist + be reproducible).

**What exists in `src/` today** (pre-v0.4b):

- `src/agent-tools/tools/forget-handler.ts` (78 LoC, v0.3) — MCP wrapper for `Memory.forget(id)`. Idempotent on `MemoryNotFound`. NO bulk/auto eviction.
- `src/agent-tools/tools/forget-schema.ts` — JSON-RPC schema for the verb.
- `src/core/memory-store.ts:60` — `Memory.forget(id)` top-level API (v0.1).
- v0.4a adds `llm_importance_score REAL` column on `memories` table (per ADR D5/D11) — REUSED here.
- **NO `EvictionPolicy` DIP, NO Ebbinghaus decay function, NO LRU/LFU bookkeeping, NO triadic scorer, NO long-tail guardrail, NO `last_accessed_at` column, NO `access_count` column.**

**Evidence motivating each investigation target:**

- **Letta primary:** `letta/services/passage_manager.py` is the ORM service for archival memory (Letta's persistent-store equivalent). `letta/services/context_window_calculator/context_window_calculator.py` handles in-context eviction decisions. `letta/services/agent_manager.py` orchestrates memory lifecycle. `letta/alembic/versions/74e860718e0d_add_archival_memory_sharing.py` confirms archival is first-class concern. Tests at `letta/tests/performance_tests/test_insert_archival_memory.py` indicate stress-tested eviction paths.
- **Mem0 secondary:** `grep -rln "def forget\|def evict\|memory_decay\|Ebbinghaus" .claude/knowledge-base/references/mem0` returns ZERO hits. The forget primitives are `delete(memory_id)` + `delete_all(scope)` + `_delete_memory(memory_id)` (`mem0/memory/main.py:1524,1540,1722`) — explicit caller-driven only. NO automated eviction. Same negative-space pattern as v0.4a's reflection finding.
- **LangMem (NOT cloned):** Per CLAUDE.md `referencia/` (now `.claude/knowledge-base/references/`) table, LangMem is "pending exploration" and 3.9MB. Same deferral as v0.4a's D2 — cover Q6 via web (langchain.com or github.com/langchain-ai/langmem).
- **Prior art literature:** Ebbinghaus 1885 → modern reformulations (Anki spaced-repetition uses Ebbinghaus-derived intervals); cache eviction theory (LRU/LFU classics + LIRS for inter-reference recency + ARC adaptive + 2Q for double-queue). Anti-long-tail preservation: limited academic literature; possibly Generative Agents 2023 § 4.3 (reflection on "salient observations") OR information-retrieval rarity-boost literature.

**Compliance scope:** plan honors `architecture.md § 3` (DIP — new `EvictionPolicy` DIP lives in `src/core/dip/`, implementations in `src/local/eviction/`), `architecture.md § 2` ADD-only (eviction physically deletes rows OR soft-deletes via `t_invalid`; need to decide), `testing.md` (TDD pyramid — guardrail test at unit tier; recall@10 metric at integration tier with real pgvector), `dogfood-golden-rule.md` (v0.4b stays Planned until shipped), `discover-blueprint-golden-rule.md` (every cited path checked).

## Objective

Produce a blueprint that lets `/to-plan v0-4b-forgetting-pipeline` lock six decisions: triadic scoring shape, Ebbinghaus decay function + constants, LRU/LFU bookkeeping mechanism, long-tail guardrail, eviction trigger model, test pyramid coverage.

Success criteria for the blueprint:

- [ ] All 8 research questions answered with citations to `.claude/knowledge-base/references/{letta,mem0}/{...}` OR snapshots of allowlisted web sources
- [ ] Cross-cutting comparison table populated for Letta vs Mem0 vs LangMem (per-project eviction/forgetting shape)
- [ ] Recommendations section provides at least one concrete proposal per question (e.g., "ADOPT Ebbinghaus exponential decay with half-life 7 days" / "REJECT pure LRU because long-tail bias")
- [ ] Q2 ends with explicit Rule 9 ADOPT/REJECT/DEFER verdict for any Node-ecosystem cache/decay lib evaluated
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `.claude/knowledge-base/references/letta/` | `letta/services/passage_manager.py` (archival ORM) + `letta/services/context_window_calculator/context_window_calculator.py` (in-context eviction) + `letta/services/agent_manager.py` (memory lifecycle) + `letta/tests/performance_tests/test_insert_archival_memory.py` (stress-tested eviction) + `letta/alembic/versions/74e860718e0d_add_archival_memory_sharing.py` (schema signal) | Primary precedent — archival memory eviction machinery |
| `.claude/knowledge-base/references/mem0/` | `mem0/memory/main.py:1524-1730` (delete/delete_all/_delete_memory bounded scope) + `mem0/tests/memory/test_main.py` (delete tests) | Secondary — minimal precedent. Mem0 has explicit delete but ZERO automated eviction; positioning-insight target (same negative-space pattern as v0.4a Q6) |
| arXiv / Anki literature (web) | Ebbinghaus 1885 + Anki SM-2 algorithm spec | Required for Q7 prior_art — modern decay function constants |
| Cache eviction literature (web) | LRU/LFU/LIRS/ARC/2Q canonical papers/articles | Required for Q8 prior_art — which fits memory primitives |
| LangMem docs (web) | github.com/langchain-ai/langmem README + concepts | Required for Q6 design comparison (NOT cloned) |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| `.claude/knowledge-base/references/letta/letta/agent.py` + agent runtime | Agent-loop lock-in (CLAUDE.md cross-project narrative). Letta's archival memory has its own lifecycle outside the agent loop |
| `.claude/knowledge-base/references/letta/letta/services/summarizer/` | Already covered by v0.4a discovery |
| `.claude/knowledge-base/references/letta/letta/groups/sleeptime_*.py` | Already covered by v0.4a discovery |
| `.claude/knowledge-base/references/letta/letta/services/mcp/` | Covered by v0.3 discovery |
| `.claude/knowledge-base/references/mem0/mem0/{client,configs,embeddings,llms,proxy,reranker,vector_stores}/` | Orthogonal to eviction |
| `.claude/knowledge-base/references/mem0/openmemory/`, `server/`, `mem0-ts/` | Orthogonal to eviction algorithm |
| `.claude/knowledge-base/references/langmem/` | NOT CLONED (per CLAUDE.md table; deferred clone decision); covered via web for Q6 only |
| Build artifacts (`build/`, `dist/`, `.venv/`, `node_modules/`, `.git/`) | Standard exclusion |
| Caching libraries (Redis, Memcached) | Out of scope — TheMemory v0.4b targets pgvector-backed forgetting, NOT external cache replacement |

## ADRs

### D1 — Time budget + stop conditions

**Decision:**

- `.claude/knowledge-base/references/letta/`: 3h (primary — 5 files + tests)
- `.claude/knowledge-base/references/mem0/`: 1h (secondary — bounded scope; same negative-space pattern as v0.4a Q6)
- arXiv / Anki / cache lit (web): 2h combined for Q7 + Q8 + Q6 LangMem fallback
- **Total: 6h**

**Rationale:** Letta is the only project with non-trivial archival/eviction code. Mem0 is bounded (1h to read the 200-LoC delete section). Web research takes the rest.

**Stop conditions:** Per question (3-retry Fase A) + per project (budget exhausted). Web budget: max 15 WebSearch + 25 WebFetch per cycle (within `cycle-discover.md v1.1 § Stop conditions #7` cap of 20+30).

### D2 — LangMem absent from clone: cover via web prior_art

Mirror of v0.4a's D2. LangMem is NOT cloned; Q6 fetched from `github.com/langchain-ai/langmem` README + conceptual_guide. Fallback per `cycle-discover.md v1.1` hard gate #6 (allowlist + snapshot integrity).

### D3 — Triadic signal scope lock: 3 dimensions, NOT 4+

**Decision:** Ship ONE `EvictionPolicy` DIP with one `TriadicScoringPolicy` implementation combining EXACTLY 3 dimensions: (a) Ebbinghaus time decay, (b) LRU/LFU access bookkeeping, (c) LLM-judged importance (REUSED from v0.4a's `llm_importance_score` column). NO additional dimensions (e.g., "user-explicit-flag", "scope-weight", "semantic-cluster-density") in v0.4b — defer those to v0.5+ behind the same DIP.

**Rationale:**

- CLAUDE.md Item 6 acceptance verbatim: "Triadic signal (Ebbinghaus time decay + LRU/LFU + LLM-judged importance)". Three dimensions, locked.
- v0.4a established the `ScoringStrategy` DIP shape (`src/core/dip/scoring-strategy.ts`); v0.4b mirrors the pattern with `EvictionPolicy` DIP.
- LLM-importance is REUSED, not recomputed — Q5 (Mem0 negative space) confirms write-time scoring is the right place; v0.4a's content-hash cache means no extra LLM cost for eviction.

**Alternatives considered:**

- (A) 4+ dimensions including "user explicit flag" — REJECTED for v0.4b (YAGNI; no use case)
- (B) 2 dimensions (drop LFU) — REJECTED (CLAUDE.md Item 6 explicitly names LRU/LFU)
- (C) Selected: 3 dimensions, locked

### D4 — Long-tail guardrail as a MULTIPLIER, not an exclusion list

**Decision:** Anti-long-tail guardrail multiplies the eviction-score of rare-but-isolated memories by `< 1` (protection factor) BEFORE the eviction threshold compares. The multiplier is computed from semantic isolation distance (e.g., cosine distance to nearest neighbor in vector store) AND access frequency. NOT an exclusion list ("never evict tag=protected"), NOT a hard reservation ("keep top-N rarest").

**Rationale:**

- CLAUDE.md Item 6 verbatim: "rare-but-semantically-isolated memories receive a protection multiplier to defeat frequency bias"
- Multiplier is composable with the triadic scoring (just an additional factor)
- Exclusion lists require user maintenance; multiplier is automatic

**Alternatives considered:**

- (A) Exclusion list (manually-tagged "never evict") — REJECTED (manual maintenance burden)
- (B) Hard reservation (top-N rarest by isolation distance never evicted) — REJECTED (capacity-bound; doesn't scale to large scopes)
- (C) Selected: protection multiplier on eviction score

### D5 — `last_accessed_at` + `access_count` columns on `memories` table

**Decision:** Add two new columns to `memories` in v0.4b: `last_accessed_at TIMESTAMP WITH TIMEZONE` (nullable; populated on each `recall()` returning the memory) + `access_count INTEGER NOT NULL DEFAULT 0`. These support LRU (`last_accessed_at` ORDER BY) + LFU (`access_count` ORDER BY).

**Rationale:**

- LRU/LFU require persistent bookkeeping; process-local is forbidden per v0.4a's D2 (same rationale).
- `last_accessed_at` is also useful for v0.5+ debugging ("when was this memory last surfaced?"); reusable beyond eviction.
- Drizzle migration adds both columns nullable with default; v0.1 + v0.4a rows backfill as `access_count=0` + `last_accessed_at=NULL`.

**Alternatives considered:**

- (A) Separate `memory_access_log` table with one row per access — REJECTED (table grows unbounded; LRU/LFU only needs aggregate state)
- (B) Counter in Redis — REJECTED (same Redis-dep disqualification as v0.4a)
- (C) Selected: two columns on `memories` updated on every `recall()` hit

### D6 — Forget = soft-delete via `t_invalid`, NOT physical DELETE

**Decision:** Triadic-scored automatic forgetting marks memories with `t_invalid = NOW()` (bi-temporal soft-delete from v0.1 schema) instead of physical DELETE. Eviction WALK can then run a separate GC pass (e.g., delete rows where `t_invalid < NOW() - INTERVAL '30 days'`) — out of scope for v0.4b (just soft-delete).

**Rationale:**

- v0.1 schema already has bi-temporal columns `t_valid` / `t_invalid` (per ADR-0006). Re-using is honest.
- Soft-delete preserves audit trail (history table + the row itself).
- Physical DELETE breaks recall() reproducibility ("why did this memory go missing?")

**Alternatives considered:**

- (A) Physical DELETE on eviction — REJECTED (loses audit trail; collides with Inquebrável Rule 3 honesty)
- (B) Move to "evicted_memories" table — REJECTED (extra schema; same outcome as soft-delete)
- (C) Selected: `t_invalid = NOW()` soft-delete; separate GC out-of-scope

## Research questions

8 questions across 5 corners (1+1+1+3+2). Within `cycle-discover.md v1.1` budget.

| # | Corner | Source | Question | Fase A method | Fase B method | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | tests | letta | How does Letta test archival memory eviction? Stress conditions, fixtures, assertion shape, edge cases? | `Read .claude/knowledge-base/references/letta/tests/performance_tests/test_insert_archival_memory.py` full file | Document each test function: setup, fixture, assertion, runtime profile | Table per test: behavior → fixture → assertion shape |
| Q2 | deps | letta + npm | What deps support Letta's archival/eviction? Any Node-side LRU/LFU/decay lib candidates? Rule 9 ADOPT/REJECT/DEFER for **EXACTLY 3 candidates locked per v1.1 EC-3**: `lru-cache`, `quick-lru`, `keyv`. (`node-cache` informational → F-followup.) | `Read pyproject.toml` deps section + grep imports in passage_manager.py + EXACTLY 3 WebFetches (`lru-cache`, `quick-lru`, `keyv`) + snapshot each | Letta dep rationale + Node-ecosystem comparison + Rule 9 ADOPT/REJECT/DEFER per candidate | Decision table + verdict per candidate + recommendation |
| Q3 | tools | letta | How is Letta's archival memory eviction TRIGGERED? Background job? On-write threshold? On-read? Local dev story? | **v1.1 EC-1 + EC-2 absorbed:** `passage_manager.py` is 1103 LoC, `agent_manager.py` is 3599 LoC. Strategy: `grep -n "def delete_\|def evict\|capacity\|TTL\|decay\|archival" passage_manager.py agent_manager.py context_window_calculator/context_window_calculator.py` → `Read offset=<grep-hit> limit=200` per most relevant hit (max 3 reads per file). | Trigger mechanism + capacity policy + local dev story | 4-way classification (write-time / read-time / scheduled / on-demand) |
| Q4 | techniques | letta | What algorithm does Letta use for archival eviction? Pure LRU? Capacity-based? Importance-weighted? Any decay? | **v1.1 EC-1 absorbed:** `passage_manager.py` confirmed 1103 LoC (not ≤ 600). Strategy: focus the 9 `def delete_*` functions at lines 767-923 via `Read offset=767 limit=400`. + `Read context_window_calculator.py` FULL (384 LoC, OK). | Algorithm summary in 3 sentences + decision points (when fire / what evict / how protect rare) | Verbatim algorithm description |
| Q5 | techniques | mem0 | How does Mem0 `_delete_memory` work? Is delete the ONLY forget primitive? Any IMPLICIT eviction (e.g., during `_add` if quota exceeded)? Positioning vs Letta's automated archival. | `Read mem0/memory/main.py offset=1524 limit=210` (delete/delete_all/_delete_memory section) + `grep -n "quota\|max_memories\|capacity" mem0/memory/main.py` + read top 50 lines of `test_main.py` testdelete cases | Mem0's forget contract + presence/absence of capacity logic + positioning paragraph | Boolean (automated eviction yes/no) + 1-paragraph contrast |
| Q6 | techniques | langchain.com docs (web) | How does LangMem handle forgetting/eviction? `BackgroundMemoryManager` mentioned "consolidate and update outdated" — what's the forget contract? Comparison vs Letta automated + Mem0 explicit. | WebSearch + WebFetch `github.com/langchain-ai/langmem` README + conceptual_guide → snapshot | LangMem forget API + trigger model + design comparison | Design-comparison table (Letta vs Mem0 vs LangMem vs TheMemory v0.4b proposal) |
| Q7 | prior_art | web (arXiv / Anki) | What is the modern reformulation of Ebbinghaus forgetting curve? What decay constants do production systems use? Anki SM-2 algorithm specifics? | WebSearch `Ebbinghaus forgetting curve modern reformulation Anki SM-2` + WebFetch authoritative source → snapshot | Decay function (exponential? power-law?) + constants (half-life days?) + production-system precedents | Authoritative formula + recommended constants for TheMemory v0.4b |
| Q8 | prior_art | web (cache eviction lit) | Cache eviction algorithms: LRU vs LFU vs LIRS vs ARC vs 2Q — which suits a memory system best? Long-tail preservation literature? | WebSearch `cache eviction LIRS ARC 2Q comparison` + WebSearch `long-tail preservation cache rare items` + WebFetch top 2 → snapshot | Algorithm comparison table + verdict per algorithm + long-tail preservation precedent (if any) | Decision-matrix: which algorithm matches TheMemory's triadic shape + anti-long-tail goal |

## Coverage Matrix

| Q | Corner | Project / Source | Method | Status |
|---|---|---|---|---|
| Q1 | tests | letta | Read `test_insert_archival_memory.py` | mapped |
| Q2 | deps | letta + npm | Read pyproject.toml + grep imports + 3 WebFetches + Rule 9 verdict | mapped |
| Q3 | tools | letta | Read passage_manager.py + context_window_calculator.py + agent_manager.py + grep eviction | mapped |
| Q4 | techniques | letta | Read passage_manager.py + context_window_calculator.py full | mapped |
| Q5 | techniques | mem0 | Read main.py:1524-1733 offset + test_main.py delete cases + grep quota | mapped |
| Q6 | techniques | langchain.com (web) | WebSearch + WebFetch LangMem README + snapshot | mapped |
| Q7 | prior_art | arXiv / Anki (web) | WebSearch Ebbinghaus + WebFetch + snapshot | mapped |
| Q8 | prior_art | cache lit (web) | WebSearch LIRS/ARC/2Q + long-tail + WebFetch + snapshot | mapped |

**Coverage: 8/8 questions mapped (100%).** All 5 corners populated (tests=1 / deps=1 / tools=1 / techniques=3 / prior_art=2). Within per-corner cap (max 3).

## v1.1 cross-cutting observation (EC-7 absorbed)

**OPEN PROBLEM #1 status CONFIRMED ahead of halt-loop** — pre-flight grep of `passage_manager.py:767-923` shows 9 `def delete_*` functions but ZERO `def evict|capacity|TTL|decay`. Letta's archival is DELETE-only (caller-driven), mirroring Mem0's pattern. CLAUDE.md Item 6's "**no competitor solved this**" framing is empirically grounded. Q3/Q4 likely answers: "Letta has caller-driven delete primitives ONLY; no automated triadic eviction"; same for Mem0 (Q5). v0.4b's triadic-scored automated forgetting IS innovation across BOTH Letta + Mem0 — strongest positioning insight of this discovery cycle.

## Halt-loop checkpoints

For `/discover-execute v0-4b-forgetting-pipeline`:

- **Pre-flight:** verify allowlist (`arxiv.org`, `langchain.com`, `npmjs.com`, `github.com` all already seeded) + create `.claude/knowledge-base/discoveries/snapshots/v0-4b-forgetting-pipeline/` (mkdir -p)
- **Q1 (v1.1 EC-4 absorbed):** Read full file (185 LoC). If `grep "eviction\|evict\|capacity\|threshold"` returns ZERO hits, mark Q1 `partial` with reason "test file is INSERT-only stress; archival has no eviction tests" — this negative-space finding IS the answer + reinforces EC-7 cross-cutting observation.
- **Q2:** EXACTLY 3 npm WebFetches per cap (suggest: `lru-cache`, `node-cache`, `quick-lru` OR `keyv`) + Rule 9 verdict per candidate.
- **Q3:** 4-way trigger classification answered. If passage_manager has NO eviction code (purely INSERT-side), document negative-space honestly.
- **Q4:** Verbatim algorithm description with line citations. If Letta has NO automated eviction (negative-space mirroring Mem0), document.
- **Q5:** mem0 `_delete_memory` body + quota check grep negative-result + positioning paragraph.
- **Q6:** LangMem fetch + URL lock + snapshot integrity per cycle-discover v1.1 hard gate #6.
- **Q7:** Ebbinghaus formula transcribed verbatim from canonical source (probably https://en.wikipedia.org/wiki/Forgetting_curve OR an academic mirror — must be allowlisted; `en.wikipedia.org` would need allowlist addition with rationale). Per EC-9 of v0.4a precedent: NO fabrication from training-data recall.
- **Q8:** algorithm comparison table from at least 2 sources + recommended verdict.

## Acceptance Criteria

- [ ] All 8 research questions have status `done` OR `blocked` (with reason) in `.progress-v0-4b-forgetting-pipeline.json`
- [ ] Every `referencia/...` (now `.claude/knowledge-base/references/...`) citation exists via `Path.exists()`
- [ ] Every URL cited has a corresponding snapshot file
- [ ] All 5 coverage corners populated
- [ ] Q2 ends with explicit Rule 9 ADOPT/REJECT/DEFER verdict per candidate
- [ ] Blueprint § ADRs has ≥ 1 ADR (target 4-6 based on Q1-Q8 evidence)
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS

## Global Definition of Done

- [ ] All Acceptance Criteria above satisfied
- [ ] `/discover-confidence v0-4b-forgetting-pipeline` invoked + verdict ≥ SHIPPABLE_WITH_CAVEATS
- [ ] No hard caps triggered
- [ ] If verdict = SHIPPABLE_WITH_CAVEATS: caveats listed honestly in the blueprint's Halt-loop progress section

## Followups logged

| # | Item | Reason for deferral |
|---|---|---|
| F-langmem-clone-policy | Same as v0.4a F-followup. Decision deferred to v0.6 (Voyager skill library) which needs deeper langmem investigation. | v0.4b only needs ONE LangMem question (Q6); cloning overhead disproportionate. |
| F-allowlist-add-wikipedia | If Q7 needs `en.wikipedia.org` for Ebbinghaus canonical source AND no academic mirror is reachable, add `en.wikipedia.org` to `discover-web-allowlist.txt` with rationale "Ebbinghaus 1885 forgetting curve canonical source for v0-4b discovery". | Defer to halt-loop time; only add if Q7 actually needs it. |
| F-tbd-thresholds | CLAUDE.md Item 6 acceptance has TBDs (recall@10 threshold, decay half-life seconds). Blueprint recommends values; `/to-plan v0-4b-forgetting-pipeline` ADR locks them. | Same pattern as v0.4a F-v0-4a-tbd-threshold-locks. |
| F-evaluation-matrix | CLAUDE.md Item 6 requires `docs/forgetting-evaluation.md` artifact. Out of discovery scope; lives in /implement of v0.4b. | Discovery surfaces evaluation methodology; impl produces the file. |

## v0.0 → v1.0 Accepted Risks (per `/auto-plan --force-override` invocation)

- **OVERRIDE: LOW confidence (score 25/100).** This plan was authored via `/auto-plan v0-4b-forgetting-pipeline --force-override --allow-dirty-tree` despite confidence assessment recommending against. Rationale: user explicit instruction to bypass for end-to-end orchestrator test. Risks accepted: blueprint may surface unknown-unknowns (LangMem might have richer eviction model than assumed; Letta might have NO automated eviction at all, making Q3/Q4 partial). These risks will be surfaced honestly during `/discover-execute` halt-loop.

## Related

- Cycle rule: `.claude/rules/cycle-discover.md` (v1.1 — 5-corner coverage)
- Cycle rule: `.claude/rules/cycle-auto-plan.md` (super-cycle orchestrator)
- Golden rule: `.claude/rules/discover-blueprint-golden-rule.md`
- Roadmap entry: CLAUDE.md § Macro roadmap Item 6 (OPEN PROBLEM #1)
- Dependency: v0.4a `llm_importance_score` column (REUSED per ADR D3 above)
- Companion v0.4a discovery plan: `.claude/knowledge-base/discoveries/plans/v0-4a-reflection-pipeline-plan.md` (shape reference)
- Companion v0.4a blueprint: `.claude/knowledge-base/discoveries/blueprints/v0-4a-reflection-pipeline-blueprint.md` (SHIPPABLE_WITH_CAVEATS 89/100 — quality bar)
- Architecture rule consumed: `.claude/rules/architecture.md § 3` (DIP) + `§ 2` (ADD-only — eviction via soft-delete per D6)
- Testing rule consumed: `.claude/rules/testing.md § Pyramid` (recall@10 metric at integration tier)
