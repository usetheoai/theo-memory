# Discovery Plan: v0.4a — Reflection pipeline

> **Version 1.1** — Investigate how to lock the v0.4a reflection pipeline: a sleep-time worker that fires async `reflect()` against scoped memories + a scoring-strategy DIP that ships BOTH the additive Mem0-default and the multiplicative Generative-Agents pattern + LLM-importance scores cached at write time. Roadmap Item 5. ADR-0005 (2026-05-22) already locked the `ReflectionPolicy` DIP with `ManualReflectionPolicy` shipping at v0.0; v0.4a adds `ThresholdReflectionPolicy` + `SleepTimeReflectionPolicy` as drop-in implementations of the SAME DIP — **zero contract change** at v0.4a. Reference projects: `.claude/knowledge-base/references/letta/` (primary — `letta/services/summarizer/` + `letta/agents/voice_sleeptime_agent.py` + `letta/groups/sleeptime_multi_agent*.py` + deps `apscheduler>=3.11.0` + `temporalio>=1.8.0`; full sleep-time machinery), `.claude/knowledge-base/references/mem0/` (secondary — NO `reflect()` exists; consolidation happens implicitly during `_update_memory` writes; positioning-insight target), plus prior_art on Generative Agents 2023 (arXiv 2304.03442) scoring formula and LangMem's `BackgroundMemoryManager` (LangMem NOT cloned — covered via web). The blueprint will inform `/to-plan v0-4a-reflection-pipeline` by locking: (a) sleep-time worker mechanism (in-process timer / Node-cron / BullMQ / DEFER to v1.x), (b) `ThresholdReflectionPolicy` trigger contract, (c) scoring-strategy DIP shape (additive vs multiplicative) with default lock, (d) higher-order memory persistence (`derived_from: string[]` provenance per CLAUDE.md Item 5 acceptance), (e) LLM-importance caching contract (first-write computes; second-write same content does NOT re-invoke LLM), (f) test pyramid for async trigger + scoring + provenance.
>
> **v1.0 → v1.1 changes (2026-05-25):** absorbed 3 MUST FIX + 8 SHOULD TEST + 3 DOCUMENT items from `.claude/knowledge-base/reviews/v0-4a-reflection-pipeline-edge-cases-2026-05-25.md`:
>
> - **EC-1** (Q6 `main.py` 3222 LoC > Read default 2000): replaced "head 400 + grep" Fase A with explicit `wc -l → grep -n class+def → Read offset/limit per hit` strategy.
> - **EC-2** (Q4 `summarizer.py` 894 LoC vs "head 200"): replaced "head 200" with "Read full file (894 LoC fits in default Read limit)".
> - **EC-3** (Q2 candidate list inconsistency 5 vs 3 WebFetch): locked Node candidates list to exactly 3 (`bullmq`, `node-cron`, `croner`); `agenda`/`bree` moved to F-followup informational mention.
> - **EC-4 to EC-11** (SHOULD TEST): 8 new halt-loop checkpoints added inline under "Halt-loop checkpoints" section (pre-flight Q4-before-Q5 ordering, Q1 mocking-idiom-verbatim, Q3 library-only 4th category, Q5 out-of-scope cross-ref defense, Q6 class-boundary anchor + grep re-run, Q7 PDF Unicode brokenness, Q8 GitHub README fallback).
> - **EC-12, EC-13, EC-14** (DOCUMENT): 3 new rationale Followups added — Q2 corner classification, Q4 budget overflow rationale, D4+D5 schema-touching placement rationale.

**Slug:** `v0-4a-reflection-pipeline`
**Owner:** TheMemory v0.4a cycle-discover
**Created:** 2026-05-25
**Time budget:** 7h (per-project breakdown in ADR D1)

## Context

Roadmap Item 5 (CLAUDE.md § Macro roadmap, currently Planned). v0.3 — Agent tools (MCP) shipped 2026-05-25 (PRs #14-#19). The reflection DIP (`ReflectionPolicy`) shipped at v0.0 per ADR-0005 (2026-05-22) with one implementation only (`ManualReflectionPolicy` — `shouldReflect()` always returns `true`). v0.4a is where the DIP earns its keep: TWO new implementations land WITHOUT a contract change, plus the scoring half of the pipeline.

**Acceptance criteria from CLAUDE.md § Roadmap Item 5 (verbatim):**

> Test: seed 50 memories in a scope; trigger `reflect()`; assert ≥ 1 higher-order memory exists with `derived_from: string[]` provenance linking source memory IDs. Both scoring strategies pass identical recall-shape contract test (interface compliance). Sleep-time worker test: background trigger fires within TBD seconds (lock by v0.4a kickoff) when threshold of N new memories crossed. LLM-importance score persisted on first write; second-write same content does NOT re-invoke LLM.

**What exists in `src/` today** (pre-v0.4a):

- `src/core/dip/reflection-policy.ts` — DIP interface per ADR-0005 / ADR-0008. Method count fixed.
- `src/core/reflection-result.ts` — return type shape.
- `src/core/__tests__/reflection-policy.test-d.ts` — type-only contract test.
- `src/agent-tools/tools/reflect-schema.ts` + `reflect-handler.ts` — v0.3 MCP expose of `reflect()`.
- ONLY `ManualReflectionPolicy` ships (per ADR-0005). NO `ThresholdReflectionPolicy`, NO `SleepTimeReflectionPolicy`, NO scoring-strategy interface, NO LLM-importance cache.

**Evidence motivating each investigation target:**

- **Letta primary:** `letta/services/summarizer/` ships 5 distinct summarizer implementations (`summarizer.py` 39kb, `self_summarizer.py` 13kb, `summarizer_sliding_window.py` 10kb, `compact.py` 20kb, `summarizer_all.py` 3.7kb) plus `thresholds.py` and `summarizer_config.py`. `letta/agents/voice_sleeptime_agent.py` + `letta/agents/ephemeral_summary_agent.py` are sleep-time agent variants. `letta/groups/sleeptime_multi_agent.py` + `_v3.py` + `_v4.py` (3 generations) show iteration on the trigger mechanism. `pyproject.toml` declares BOTH `apscheduler>=3.11.0` (in-process scheduler) AND `temporalio>=1.8.0` (workflow engine) — meaningful split that informs our Node-side Rule 9 evaluation.
- **Mem0 secondary:** `grep -rln "def reflect\|importance_score\|consolidat\|class.*Reflect\|generate_summary" .claude/knowledge-base/references/mem0 --include="*.py"` returns ZERO hits. Consolidation happens implicitly during `_update_memory` in `.claude/knowledge-base/references/mem0/mem0/memory/main.py`. Negative-space finding: Mem0's design REJECTS async reflection — write-time merge instead. Positioning insight + contrast.
- **LangMem absent from clone:** `find referencia -maxdepth 3 -name "langmem"` returns nothing. LangMem's `BackgroundMemoryManager` is relevant for design comparison BUT covered via web (langchain.com docs) — NOT via clone, per D2 below.
- **Generative Agents 2023 (Park et al., arXiv 2304.03442):** locked the multiplicative scoring formula `importance × recency × relevance` that CLAUDE.md Item 5 acceptance criterion explicitly references ("Both scoring strategies pass identical recall-shape contract test"). Paper IS the authoritative spec for the multiplicative variant.
- **ADR-0005 forward-compat invariant:** "Adding default-auto-reflect in v1.x is a BREAKING behavior change even if the type contract stays the same". v0.4a's policies CANNOT alter the v0.0 contract's "no-surprise-reflection" behavior — they execute reflection only when consumers opt in.

**Compliance scope:** plan honors `architecture.md § 3` (DIP — new policy implementations under `src/local/reflection/` will depend on `src/core/dip/reflection-policy.ts` ONLY), `testing.md` (TDD pyramid — async trigger lives at integration tier with a real timer; scoring strategies covered by unit tests; provenance assertion in integration test against real pgvector), `dogfood-golden-rule.md` (no production-ready claims; v0.4a is `Planned` and stays `Planned` until shipped), `discover-blueprint-golden-rule.md` (every cited path checked).

## Objective

Produce a blueprint that lets `/to-plan v0-4a-reflection-pipeline` lock six decisions: sleep-time worker mechanism, `ThresholdReflectionPolicy` trigger contract, scoring-strategy DIP shape (additive default + multiplicative opt-in), higher-order memory persistence with `derived_from` provenance, LLM-importance caching contract, and test pyramid coverage. The blueprint MUST surface enough technical depth that a TDD-disciplined implementation can land WITHOUT a second round of investigation.

Success criteria for the blueprint:

- [ ] All 8 research questions answered with citations to `.claude/knowledge-base/references/letta/{...}`, `.claude/knowledge-base/references/mem0/{...}`, or a snapshot of an allowlisted web source
- [ ] Cross-cutting comparison table populated for Letta vs Mem0 vs LangMem (per-project reflection / consolidation shape)
- [ ] Recommendations section provides at least one concrete decision proposal per research question (e.g., "ADOPT additive scoring as v0.4a default, REJECT multiplicative as default per ADR D3" / "ADOPT in-process `setTimeout`-based `SleepTimeReflectionPolicy` for v0.4a, DEFER BullMQ to v1.x")
- [ ] Q2 (deps) ends with an explicit Rule 9 verdict (ADOPT / REJECT / DEFER with rationale) for the Node-ecosystem scheduler candidate per `cycle-discover.md v1.1` hard gate #7
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `.claude/knowledge-base/references/letta/` | `letta/services/summarizer/` (8 files: `summarizer.py`, `self_summarizer.py`, `summarizer_sliding_window.py`, `compact.py`, `summarizer_all.py`, `summarizer_config.py`, `thresholds.py`, `enums.py`) + `letta/agents/voice_sleeptime_agent.py` + `letta/agents/ephemeral_summary_agent.py` + `letta/groups/sleeptime_multi_agent.py` + `letta/groups/sleeptime_multi_agent_v4.py` (latest generation) + `letta/groups/helpers.py` + `tests/integration_test_sleeptime_agent.py` + `tests/test_static_buffer_summarize.py` + `pyproject.toml` (deps inspection) | Primary precedent — full sleep-time + summarization machinery across all 5 summarizer variants, 3 sleep-time agent generations (v1/v3/v4), AND test discipline. Apscheduler + temporalio deps inform Node-side Rule 9 |
| `.claude/knowledge-base/references/mem0/` | `mem0/memory/main.py` (negative-space — locate `_update_memory` and adjacent consolidation logic) + `tests/memory/test_main.py` (negative-space — what's tested when no `reflect()` exists?) | Secondary — minimal precedent on async reflection. Consolidation lives in the write path; investigating where + how informs the contrast with Letta's async model |
| arXiv `2304.03442` (Park et al. 2023 — Generative Agents) | Paper landing page (PDF abstract via WebFetch + snapshot) — focus on § 4.2 "Memory Stream" formula `importance × recency × relevance` | Required for prior_art Q7 — paper IS the spec for multiplicative scoring. CLAUDE.md Item 5 acceptance criterion explicitly names "multiplicative Generative Agents" as opt-in strategy |
| `langchain.com/docs` — LangMem | `BackgroundMemoryManager` reference page (latest stable URL via WebSearch + snapshot) | Required for prior_art Q8 — LangMem NOT cloned (per D2). Web docs are the only source. Design comparison only — no code adoption |
| `npmjs.com` + GitHub repo metadata for Node scheduler candidates | `bullmq`, `node-cron`, `croner`, `agenda`, `bree` package pages — for Q2's Rule 9 ADOPT/REJECT/DEFER verdict | Required for prior_art-via-deps Q2 tail — Rule 9 mandates evaluating dep-candidates before implementing in-house |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| `.claude/knowledge-base/references/letta/letta/agent.py` + `letta/agents/letta_agent*.py` + `letta/agents/base_agent*.py` + `letta/agents/agent_loop.py` | Letta's primary agent runtime — explicit lock-in we avoid per CLAUDE.md cross-project narrative. We borrow the sleep-time TRIGGER pattern, NOT the agent loop that hosts it |
| `.claude/knowledge-base/references/letta/letta/orm/` | ORM models — relevant for v0.5 (bi-temporal) NOT v0.4a (reflection). Will be covered when v0.5 cycle-discover runs |
| `.claude/knowledge-base/references/letta/letta/server/rest_api/` | HTTP API for agent operations — orthogonal to async reflection; v0.3 cycle-discover already mapped Letta's HTTP server shape (out-of-scope there too) |
| `.claude/knowledge-base/references/letta/letta/services/mcp/` | MCP transports — covered in v0.3 cycle-discover blueprint already |
| `.claude/knowledge-base/references/letta/letta/groups/sleeptime_multi_agent_v3.py` | Intermediate generation between v1 and v4. v4 is the latest; reading v1 + v4 is sufficient to capture the iteration delta. v3 is read ONLY if v4 references it for context (per Q5 halt-loop checkpoint) |
| `.claude/knowledge-base/references/mem0/mem0/{client,configs,embeddings,llms,proxy,reranker,vector_stores}/` | Adjacent modules — irrelevant to reflection. Reflection-related code (or its absence) lives in `mem0/memory/main.py` only per the grep evidence |
| `.claude/knowledge-base/references/mem0/openmemory/`, `.claude/knowledge-base/references/mem0/server/`, `.claude/knowledge-base/references/mem0/mem0-ts/` | HTTP server, TS port, openmemory plugin — orthogonal to async reflection |
| `.claude/knowledge-base/references/langmem/` | NOT CLONED (verified `find referencia -maxdepth 3 -name "langmem"` returns nothing). Per D2: covered via web (langchain.com docs) NOT via clone |
| Generative Agents source code (any GitHub mirror of the paper's implementation) | Paper itself is authoritative; reference implementations vary in fidelity. Stick to the academic spec |
| `.claude/knowledge-base/references/*/build/`, `dist/`, `.venv/`, `node_modules/`, `.git/` | Build artifacts + git internals (per `.claude/hooks/boundary-check.sh`) |

## ADRs

### D1 — Time budget + stop conditions

**Decision:**

- `.claude/knowledge-base/references/letta/`: 4h (primary — 8 summarizer files + 2 sleep-time agent files + 2 sleep-time group files + 2 test files + pyproject.toml inspection — 5 of 8 questions)
- `.claude/knowledge-base/references/mem0/`: 1h (secondary — negative-space confirmation on 1 main file + 1 test file — 1 of 8 questions)
- arXiv paper + LangMem docs + npm scheduler libs (WebFetch + snapshots): 2h combined for 2 of 8 questions
- **Total: 7h**

**Rationale:** Letta carries the full machinery (5 summarizers + 3 sleep-time generations + scheduler deps); proportionally 4h is needed for 4 questions across techniques + tests + tools + deps corners. Mem0 receives 1h for ONE question because the answer is mostly "negative space" + adjacent write-path consolidation — diminishing returns past 1h. Prior_art receives 2h split across Generative Agents paper + LangMem docs + Node scheduler npm pages.

**Stop condition — per question (mandatory):** When a question's Fase A returns empty after 3 consecutive retries with different query variants (grep pattern → ast-grep kind → alternate path → broader scope), mark the question BLOCKED with reason "Fase A exhausted — no hotspots found" and continue. Do NOT pad with unrelated hotspots from another question's scope.

**Stop condition — per project (mandatory):** When a project's time budget is exhausted with N questions still pending, mark remaining questions BLOCKED with reason "budget exhausted" and continue. Letta is the most likely to trigger this (4h is moderate for 5 questions covering 4 corners).

**Stop condition — web budget:** Per cycle-discover.md v1.1 § Stop conditions #7, max 20 WebSearch + 30 WebFetch per cycle (configurable). v0.4a uses ~5 WebSearch + ~6 WebFetch (3 for Q2 npm pages + 1 for Q7 arXiv + 1 for Q8 LangMem + buffer). Well under cap.

**Consequences:**

- Letta gets 4 of 8 questions (50% of budget on 62.5% of question count — Letta has more material per hour)
- Mem0 gets 1 question; expected outcome is honest "minimal precedent for async reflection" doc
- prior_art corner gets 2 questions (Generative Agents paper + LangMem docs)
- Q2 (deps) spans BOTH Letta deps inspection (~30min) AND Node-side Rule 9 evaluation via web (~30min)

### D2 — LangMem absent from clone: cover via web prior_art, NOT shallow clone

**Decision:** LangMem is NOT cloned into `.claude/knowledge-base/references/`. Q8 (LangMem `BackgroundMemoryManager` comparison) is answered via WebFetch on langchain.com docs ONLY — NO shallow clone added to `.claude/knowledge-base/references/`. Allowlist domain `langchain.com` is already seeded (verified line 16 of `discover-web-allowlist.txt`).

**Rationale:**

- Only ONE question targets LangMem (Q8 — design-comparison only, no Rule 9 dep adoption). Cloning adds project-wide overhead (gitignore, boundary-check hook scope, exploration plan budget) for a single Q.
- Cycle-discover.md v1.1 explicitly supports web-only prior_art questions when a project is not cloned — "Source kind" field on per-question source table can be `web` instead of `.claude/knowledge-base/references/{project}`.
- LangMem is MIT-licensed AND its `BackgroundMemoryManager` reference page is on the allowlisted `langchain.com` domain — snapshot integrity guaranteed by the standard cycle-discover hash protocol.

**Alternatives considered:**

- (A) Shallow clone `git clone --depth 1 https://github.com/langchain-ai/langmem .claude/knowledge-base/references/langmem` — REJECTED (overhead disproportionate to one Q; CLAUDE.md `.claude/knowledge-base/references/` table currently mentions LangMem as "pending exploration" with 3.9 MB size, but no Phase II item depends on cloning it; v0.4a does not justify reversing that)
- (B) Drop Q8 entirely — REJECTED (CLAUDE.md § Competitive superiority matrix names LangMem as a Phase III/IV competitor for procedural memory at Item 8 v0.6; v0.4a's reflection design must NOT silently diverge from a well-known prior-art shape without an explicit comparison)
- (C) Selected: Web-only prior_art Q with snapshot per cycle-discover.md v1.1 hard gate #6

**Consequences:**

- Q8's Fase A method is WebSearch + WebFetch, NOT Read; halt-loop driver must support this (already works per v0-3 Q7 precedent)
- Snapshot lives at `.claude/knowledge-base/discoveries/snapshots/v0-4a-reflection-pipeline/{sha256}.md`
- If langchain.com restructures the `BackgroundMemoryManager` doc URL, halt-loop locks the URL pre-snapshot per Q8 halt-loop checkpoint (mirrors v0-3 Q7 lock pattern)

### D3 — Scoring strategy: ship BOTH; lock additive as v0.4a default

**Decision:** v0.4a ships TWO scoring strategies behind a new `ScoringStrategy` DIP — `AdditiveMem0Strategy` (default) and `MultiplicativeGenerativeAgentsStrategy` (opt-in). The default lock matches Mem0's production-tested additive model per CLAUDE.md Item 5 rejection of multiplicative as v0.1 default (locked 2026-05-21): "v0.1 ships additive Mem0-style (production-tested). Multiplicative becomes opt-in strategy at v0.4a".

**Rationale:**

- CLAUDE.md Item 5 acceptance criterion verbatim: "Both scoring strategies pass identical recall-shape contract test (interface compliance)." — shipping both is binding.
- Additive (Mem0) avoids zero-multiplication zeroing-out edge cases when recency/importance/relevance individually fall to 0.
- Multiplicative (Generative Agents) is the academic standard with stronger temporal locality bias — opt-in for consumers who want that bias.
- The DIP shape lets both pass an "identical recall-shape contract test" trivially (interface compliance test verifies same input → same shape, not same numerical output).

**Alternatives considered:**

- (A) Ship additive only at v0.4a; multiplicative at v0.5+ — REJECTED (contradicts CLAUDE.md Item 5 verbatim acceptance criterion)
- (B) Ship multiplicative only — REJECTED (lock 2026-05-21 explicitly chose additive as default for production-tested baseline)
- (C) Ship neither; expose only LLM-judged importance — REJECTED (degrades to pure LLM-call cost per query; production unfit per ADR-0005 zero-surprise-pricing invariant)
- (D) Selected: BOTH ship behind DIP; additive default; opt-in multiplicative

**Consequences:**

- New `src/core/dip/scoring-strategy.ts` interface lands in v0.4a (NEW interface, NOT a modification of an existing DIP — does NOT touch ADR-0008's locked method counts on existing 5 DIPs)
- `Memory` constructor accepts optional `scoringStrategy?: ScoringStrategy` defaulting to `AdditiveMem0Strategy` instance
- Q7 (Generative Agents paper) is load-bearing for the multiplicative implementation; without it we cannot honestly ship the strategy

### D4 — `derived_from: string[]` provenance is MANDATORY on every higher-order memory

**Decision:** Every memory persisted as a result of `reflect()` MUST carry a non-empty `derived_from: string[]` field linking the source memory IDs that produced it. Empty arrays (`[]`) are FORBIDDEN for higher-order memories; they would silently lose audit trail.

**Rationale:**

- CLAUDE.md Item 5 acceptance verbatim: "assert ≥ 1 higher-order memory exists with `derived_from: string[]` provenance linking source memory IDs". Binding.
- Inquebrável Rule 3 (extreme honesty): unconnected higher-order memories are fabricated reflections. Provenance is the audit trail.
- The `derived_from` shape also enables consumer-side dedup and verification ("did the LLM actually consolidate these specific memories?").

**Alternatives considered:**

- (A) Optional `derived_from?: string[]` — REJECTED (per Item 5 acceptance, this is required, not optional)
- (B) Store `derived_from` only at query time via DB JOIN — REJECTED (couples query layer to reflection; violates DIP boundary between core and persistence)
- (C) Selected: required column / field on the persisted memory row, populated at reflection write

**Consequences:**

- DB schema change in v0.4a: pgvector adapter adds `derived_from` JSONB column to `memories` table (NULL allowed for non-derived memories; NON-EMPTY array required for `kind = 'derived'` rows — CHECK constraint candidate)
- In-memory adapter mirrors the field shape
- A reflection that LLM-generates a higher-order memory but cannot identify ≥ 1 source memory MUST throw `ReflectionProvenanceMissingError` rather than silently persisting `[]`. New error type lands in v0.4a.

### D5 — LLM-importance cache: persist on first write, reuse on rewrite

**Decision:** LLM-importance score is computed ONCE at first `remember(content, scope)` and persisted alongside the memory row. Second `remember()` of identical content (same hash) reuses the cached score WITHOUT invoking the LLM. This honors CLAUDE.md Item 5 acceptance verbatim: "LLM-importance score persisted on first write; second-write same content does NOT re-invoke LLM."

**Rationale:**

- LLM-importance is deterministic for a given (content, prompt) pair to a high degree; re-invoking is wasteful per Inquebrável Rule 9 (don't repeat work).
- Mem0's v0.1 write pipeline already hashes content per the local-runtime blueprint (Phase 4-5 hash dedup); v0.4a piggybacks on that hash for the LLM-importance cache.
- Caching is correctness-preserving: identical content → identical importance score by construction.

**Alternatives considered:**

- (A) Re-invoke LLM on every write — REJECTED (contradicts CLAUDE.md Item 5 explicit acceptance)
- (B) Cache for N minutes / TTL — REJECTED (TTL adds complexity for no benefit; same hash → same score is permanent in expectation)
- (C) Cache only in-memory (process-local) — REJECTED (defeats sleep-time worker which lives in a separate process from the writer)
- (D) Selected: persist score on memory row; reuse by content hash match

**Consequences:**

- DB schema change in v0.4a: pgvector adapter adds `llm_importance_score` REAL column to `memories` table (NULL when scoring not yet computed; populated synchronously at write-time when policy says to)
- Hash-based cache lookup before LLM invocation; cache miss → invoke LLM → persist score → return
- The `Embedder` DIP is NOT touched (this is `LLM` DIP work). Existing ADR-0008 method counts on `LLM` interface remain locked

### D6 — Infra prerequisites (allowlist + snapshots dir) — already seeded by v0.3

**Decision:** Unlike v0.3 (which seeded `.claude/rules/discover-web-allowlist.txt` + `.claude/knowledge-base/discoveries/snapshots/` itself as the first cycle-discover invocation post-v1.1), v0.4a INHERITS the seeded infra. Pre-flight checkpoint verifies the inheritance.

**Rationale:**

- v0.3 cycle-discover (PRs #14-#15) shipped the allowlist + snapshots dir as ADR D6 prerequisite. Verified (see top of this plan's allowlist citations: `arxiv.org`, `langchain.com`, `npmjs.com` already present).
- v0.4a needs `arxiv.org` for Q7 (Generative Agents paper) — already seeded since 2026-05-22. Needs `langchain.com` for Q8 (LangMem) — already seeded. Needs `npmjs.com` for Q2 (Node scheduler libs) — already seeded (v0-3 Q2 added it).
- NO new allowlist entries required by v0.4a. Pre-flight runs as confirmation, not setup.

**Alternatives considered:**

- (A) Re-state ADR D6 from v0-3 verbatim — REJECTED (cargo-cult; v0.4a doesn't ship infra)
- (B) Skip the pre-flight check entirely — REJECTED (per cycle-discover.md v1.1 hard gate #5: "URL cited from a non-allowlisted domain" caps confidence at 49; pre-flight is the cheap insurance)
- (C) Selected: verify-only pre-flight, no new infra

**Consequences:**

- Pre-flight (iteration 0) of /discover-execute checks: (1) allowlist contains `arxiv.org`, `langchain.com`, `npmjs.com`; (2) snapshots dir exists at `.claude/knowledge-base/discoveries/snapshots/v0-4a-reflection-pipeline/` (created via `mkdir -p` if absent — idempotent)
- If allowlist is missing any of the 3 required domains: HALT with reason "infra prerequisite missing per ADR D6" and surface for human to seed (escalation, NOT silent failure)

## Research questions

8 questions across 5 corners (1+1+1+3+2). Within cycle-discover.md v1.1 budget (5-10 total, max 3 per corner, min 1 per corner).

| # | Corner | Project / Source | Question | Fase A method (broad map) | Fase B method (deep read) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | tests | letta | How does Letta test sleep-time worker trigger + summarization output? Which fixtures? Async assertions? Provenance (`derived_from`-equivalent) verification? | `Read .claude/knowledge-base/references/letta/tests/integration_test_sleeptime_agent.py` + `Read .claude/knowledge-base/references/letta/tests/test_static_buffer_summarize.py` | Section-by-section: enumerate test functions, transcribe verbatim assertion patterns, identify fixtures used, document any pytest async marks (`@pytest.mark.asyncio`, custom event loop helpers) | Table: per-test (file:line) → behavior asserted → fixture used → applicability to TheMemory's `ThresholdReflectionPolicy` + `SleepTimeReflectionPolicy` test suite |
| Q2 | deps | letta + web (npm registry) | What scheduler deps does Letta use, and why BOTH `apscheduler>=3.11.0` AND `temporalio>=1.8.0`? What's the Node ecosystem equivalent — Rule 9 ADOPT/REJECT/DEFER verdict for **EXACTLY 3 candidates locked per EC-3** (`bullmq`, `node-cron`, `croner`) plus in-process `setTimeout`? (`agenda` / `bree` informational mention only, NOT WebFetch'd — see F-q2-agenda-bree-followup.) | `Read .claude/knowledge-base/references/letta/pyproject.toml` (full file — locate scheduler/workflow deps section) + `grep -rln "from apscheduler\|from temporalio" .claude/knowledge-base/references/letta/letta --include="*.py"` (locate usage sites) + WebSearch `npm bullmq vs node-cron vs croner scheduler` + WebFetch `npmjs.com/package/bullmq` + WebFetch `npmjs.com/package/node-cron` + WebFetch `npmjs.com/package/croner` → snapshot each (EXACTLY 3 npm WebFetches per EC-3 lock) | For Letta side: 1-paragraph rationale why both (synthesized from import-site reads). For Node side: comparison table (lib / weekly downloads / last release / TS support / deps tree size / license) + Rule 9 verdict per candidate with explicit rationale | Letta rationale paragraph + Node-ecosystem comparison table + ADOPT/REJECT/DEFER verdict per Node candidate (3 libs + in-process `setTimeout` = 4 verdicts) + final recommendation for v0.4a `SleepTimeReflectionPolicy` (with rejected alternatives) |
| Q3 | tools | letta | How is Letta's sleep-time worker SHIPPED? Embedded in agent process? Separate worker process? Container? Local dev story (devbox / docker-compose / makefile target)? Build/test/distribute toolchain signal? | `Read .claude/knowledge-base/references/letta/letta/groups/helpers.py` (entry-points / wiring) + `Read .claude/knowledge-base/references/letta/letta/groups/sleeptime_multi_agent_v4.py` (latest gen; first 80 lines for module-level structure) + `find .claude/knowledge-base/references/letta -name "Dockerfile" -o -name "docker-compose*" -o -name "Makefile" \| head -5` (top-level deployment artifacts) | Inspect: process boundary (same Python process or subprocess?), start/stop lifecycle, restart-on-failure semantics, local dev story (one process or two?) | Boolean decision table: shipped as (embedded \| subprocess \| container) → consequences for v0.4a Node-side choice. Recommend deployment shape for TheMemory's `SleepTimeReflectionPolicy` |
| Q4 | techniques | letta | What does each of Letta's 5 summarizer modules implement? When does each fire? How is "higher-order memory" formed? Is there a `derived_from`-equivalent provenance field on outputs? | `Read .claude/knowledge-base/references/letta/letta/services/summarizer/summarizer.py` (**FULL file — 894 LoC, fits in default 2000-line Read limit per EC-2**) + `Read .claude/knowledge-base/references/letta/letta/services/summarizer/self_summarizer.py` (full file 13kb / ~430 LoC) + `Read .claude/knowledge-base/references/letta/letta/services/summarizer/summarizer_sliding_window.py` (full file 10kb / ~330 LoC) + `Read .claude/knowledge-base/references/letta/letta/services/summarizer/compact.py` (full file 20kb / ~650 LoC — fits in default Read limit) + `Read .claude/knowledge-base/references/letta/letta/services/summarizer/thresholds.py` (full file — 1.7kb; trigger constants) + `Read .claude/knowledge-base/references/letta/letta/services/summarizer/summarizer_all.py` (full file 3.7kb) + `Read .claude/knowledge-base/references/letta/letta/services/summarizer/summarizer_config.py` (full file 3.7kb) | Per-summarizer: (i) algorithm summary in 2-3 sentences, (ii) trigger condition (line of code), (iii) input shape, (iv) output shape, (v) provenance field (yes/no — cite line) | 5-row table (one per summarizer) + cross-cutting recommendation: which summarizer's algorithm maps cleanest to TheMemory's `reflect()` semantic + how to enforce ADR D4 `derived_from` invariant in the borrowed pattern |
| Q5 | techniques | letta | How does Letta decide WHEN to fire sleep-time? Threshold (N new messages)? Time-based (interval)? Idle detection? How is the policy plugged into agents? Iteration from `sleeptime_multi_agent.py` (v1) → `_v4.py` (latest) — what changed in trigger logic? | `Read .claude/knowledge-base/references/letta/letta/groups/sleeptime_multi_agent.py` (full file — v1; entry-point + trigger condition) + `Read .claude/knowledge-base/references/letta/letta/groups/sleeptime_multi_agent_v4.py` (full file — v4; trigger condition + delta) + `Read .claude/knowledge-base/references/letta/letta/agents/voice_sleeptime_agent.py` (full file — alternate trigger surface for voice flows) + `Read .claude/knowledge-base/references/letta/letta/agents/ephemeral_summary_agent.py` (head 100 lines — adjacent variant) | Locate the trigger condition (`if`-statement / scheduler-callback registration). Document v1→v4 delta verbatim. Cite line numbers for both | Comparison table v1 vs v4 — what trigger evolved + why (from commit history if comments cite issues) + 1-paragraph synthesis for TheMemory's `ThresholdReflectionPolicy.shouldReflect()` semantic |
| Q6 | techniques | mem0 | Mem0 ships NO `reflect()` — confirmed via grep. How then does Mem0 form "higher-order memory"? `_update_memory` in `mem0/memory/main.py` does what — merge-of-overlapping-facts? LLM-arbitrated dedup? What's the contract? Positioning implication: does Mem0's design REJECT async reflection or just OUTSOURCE it to consumers? | **Per EC-1, `main.py` confirmed 3222 LoC > default Read limit (2000) — offset-based strategy required:** Step 1 `grep -n "^class \|def _update_memory\|def update\|def _add\|consolidat" .claude/knowledge-base/references/mem0/mem0/memory/main.py` (anchor: class boundaries + relevant defs). Step 2 `Read .claude/knowledge-base/references/mem0/mem0/memory/main.py offset=<grep-hit-line> limit=300` for EACH of the ≤ 3 most relevant hits (typically `class Memory:` body + `_update_memory` body + adjacent consolidation helper). Step 3 `Read .claude/knowledge-base/references/mem0/tests/memory/test_main.py` (test names + assertion shapes — what behavior is verified when no `reflect()` exists) | Document: (i) what `_update_memory` actually does (line:N), (ii) when it triggers (caller path), (iii) what counts as "memory consolidation" in Mem0's vocabulary, (iv) is provenance tracked anywhere? | 1-page synthesis: Mem0's write-time consolidation contract + positioning contrast with Letta's async reflection + recommendation for TheMemory's design (clear: async reflection is OUR strength vs Mem0's plugin-or-write-time gap) |
| Q7 | prior_art | web (arXiv 2304.03442 — Generative Agents paper) | What does Park et al. 2023 specify for `importance × recency × relevance`? Numerical ranges? Decay function for recency (exponential? linear? half-life?)? LLM-importance prompt template (the literal prompt text)? How does the paper handle the "novel event" boost? | WebSearch `Generative Agents Park 2023 arXiv 2304.03442` + WebFetch `https://arxiv.org/abs/2304.03442` → snapshot. Locate § 4.2 "Memory Stream" via PDF link OR HTML abstract that includes the formula | Read snapshot. Extract: (a) exact formula (LaTeX/text), (b) recency decay function with constants, (c) importance scoring prompt verbatim (Appendix A.1 area typically), (d) any noted edge cases (zero-multiplication, score normalization) | Authoritative cheat-sheet for v0.4a's `MultiplicativeGenerativeAgentsStrategy` implementation. ADR D3 references this Q's output for the multiplicative formula |
| Q8 | prior_art | web (langchain.com docs — LangMem) | How does LangMem's `BackgroundMemoryManager` handle reflection? Trigger contract (callback? scheduler? threshold?). Provenance shape. Public API surface. Comparison vs Letta sleep-time vs Mem0 write-time. (LangMem absent from clone per D2.) | WebSearch `LangMem BackgroundMemoryManager langchain` + WebFetch the official reference page on `langchain.com` → snapshot | Locate the `BackgroundMemoryManager` class doc OR module doc. Extract: trigger mechanism, threshold/timing knobs, provenance fields (if any), recommended usage pattern | Design-comparison table (Letta sleep-time vs Mem0 write-time vs LangMem background-manager vs TheMemory v0.4a proposal) + observation on which prior_art most influences our final design |

### Per-question source field (per cycle-discover.md v1.1 prior_art corner convention)

| # | Source kind | Source identifier |
|---|---|---|
| Q1 | `.claude/knowledge-base/references/letta` | local |
| Q2 | `.claude/knowledge-base/references/letta` + `web` (npm registry — 3+ packages) | local + `npmjs.com` (snapshots required) |
| Q3 | `.claude/knowledge-base/references/letta` | local |
| Q4 | `.claude/knowledge-base/references/letta` | local |
| Q5 | `.claude/knowledge-base/references/letta` | local |
| Q6 | `.claude/knowledge-base/references/mem0` | local |
| Q7 | `web` (arXiv) | `arxiv.org/abs/2304.03442` (snapshot required) |
| Q8 | `web` (langchain.com docs) | `langchain.com` (snapshot required — exact URL locked during halt-loop per Q8 checkpoint) |

## Coverage Matrix

| Q | Corner | Project / Source | Method | Status |
|---|---|---|---|---|
| Q1 | tests | letta | Read 2 test files in `.claude/knowledge-base/references/letta/tests/` | mapped |
| Q2 | deps | letta + npm | Read `.claude/knowledge-base/references/letta/pyproject.toml` + 3 WebFetch npmjs pages + snapshots + Rule 9 verdict | mapped |
| Q3 | tools | letta | Read `helpers.py` + `sleeptime_multi_agent_v4.py` + find deployment artifacts | mapped |
| Q4 | techniques | letta | Read 7 summarizer files (5 algorithms + `thresholds.py` + `summarizer_config.py`) | mapped |
| Q5 | techniques | letta | Read `sleeptime_multi_agent.py` + `_v4.py` + `voice_sleeptime_agent.py` + head of `ephemeral_summary_agent.py` | mapped |
| Q6 | techniques | mem0 | Read targeted sections of `mem0/memory/main.py` + `tests/memory/test_main.py` | mapped |
| Q7 | prior_art | arXiv | WebFetch `arxiv.org/abs/2304.03442` + snapshot | mapped |
| Q8 | prior_art | langchain.com | WebSearch + WebFetch `BackgroundMemoryManager` doc page + snapshot | mapped |

**Coverage: 8/8 questions mapped (100%).** All 5 corners populated (tests=1 / deps=1 / tools=1 / techniques=3 / prior_art=2). Within per-corner cap (max 3 on techniques). Above per-corner floor (min 1 each — no DEFER-CORNER marker needed).

## Halt-loop checkpoints

For `/discover-execute v0-4a-reflection-pipeline`, intermediate state that MUST hold before marking a question DONE:

- **Pre-flight (iteration 0) — ADR D6 verification:**
  - [ ] `.claude/rules/discover-web-allowlist.txt` contains `arxiv.org`, `langchain.com`, `npmjs.com` (all 3 confirmed seeded per CLAUDE.md citation but checked at runtime for honesty)
  - [ ] `.claude/knowledge-base/discoveries/snapshots/v0-4a-reflection-pipeline/` dir exists (created via `mkdir -p` if absent — idempotent)
  - **v1.1 EC-6 absorption — question ordering invariant:** `progress.question_order = [Q1, Q2, Q3, Q4, Q5, Q6, Q7, Q8]` declared explicitly. Halt-loop driver MUST iterate in this exact order — Q4 (summarizer algorithms) BEFORE Q5 (sleep-time agents) is non-negotiable because Q5 cites summarizer outputs that Q4 documents. Out-of-order execution = scope leak risk.
  - If ANY check fails: HALT with reason "infra prerequisite missing per ADR D6"; surface to human

- **Q1:** at least 1 test pattern transcribed verbatim into blueprint § Coverage Corner 1 with citation `.claude/knowledge-base/references/letta/tests/<file>:<line>`. If either test file has zero relevant assertions (unlikely given file names), document the negative-space finding instead of inventing assertions. **v1.1 EC-4 checkpoint:** transcribe VERBATIM the time-control / mocking idiom (likely `freezegun`, `pytest-asyncio` event-loop helper, OR `monkeypatch`). Do NOT translate to vitest/jest equivalents at execute-time; cite as "Letta uses X (file:line)" — translation lives in blueprint synthesis, decision belongs to `/to-plan` downstream.

- **Q2:** snapshot file exists at `.claude/knowledge-base/discoveries/snapshots/v0-4a-reflection-pipeline/{sha256}.md` for EACH of the EXACTLY 3 npm pages fetched (`bullmq`, `node-cron`, `croner` per EC-3 lock). Hash verified. Letta `pyproject.toml` dep lines transcribed verbatim with line numbers. **Rule 9 verdict block** (per cycle-discover.md v1.1 hard gate #7 spirit — see F-q2-corner-classification for corner-classification note) populated in blueprint with explicit ADOPT/REJECT/DEFER for EACH of the 3 candidates + in-process `setTimeout` = 4 verdicts total + final recommendation. If fewer than 3 snapshots present at halt time, Q2 stays BLOCKED (ADOPT alone without naming rejected alternatives is Rule 9 half-honesty per cycle-discover.md anti-pattern #12). `agenda` / `bree` informational mention deferred to F-q2-agenda-bree-followup; NOT counted toward the 3-candidate minimum.

- **Q3:** comparison table populated with one row per signal source (helpers.py / sleeptime_multi_agent_v4.py / docker-compose if present). **v1.1 EC-5 checkpoint:** decision is now a 4-way classification, not boolean: {`embedded`, `subprocess`, `container`, `library-only`}. If `find` returns zero Docker/Compose/Makefile artifacts AND `helpers.py` exports only classes/functions (no `if __name__ == '__main__'`), the verdict IS "library-only (consumer hosts the worker process)" — document as negative-space finding, do NOT force-fit into the first 3 categories.

- **Q4:** 5-row table populated (one per summarizer algorithm). Each row cites file path + key line numbers. Provenance column (`derived_from`-equivalent) populated as YES/NO/N-A with citation. If a summarizer file is materially smaller than expected (Fase A pre-check), abbreviate the Fase B read for that file but document the size finding.

- **Q5:** v1 vs v4 comparison table populated with line-number citations. Trigger condition cited verbatim from BOTH files. **Read v3 ONLY if v4's trigger references it explicitly** (e.g., `# v3 logic: ...` or imports from v3). Otherwise v3 stays out-of-scope per the In-Scope/Out-of-Scope table. **v1.1 EC-7 checkpoint:** if `sleeptime_multi_agent_v4.py` OR `voice_sleeptime_agent.py` imports from `letta.agents.{letta_agent_*, base_agent_*, agent_loop}` (all out-of-scope per plan), DO NOT follow the link. Annotate the call site as "trigger fires via `<class>.<method>` from out-of-scope agent module — abstracted as `BaseAgent.run_step`-equivalent in TheMemory mapping; concrete impl out-of-scope per plan In-Scope/Out-of-Scope". Defense against scope creep into Letta's agent runtime (which is explicitly the lock-in we avoid per CLAUDE.md).

- **Q6:** `_update_memory` function body transcribed (or its head 30 lines + body summary) with line citation. Negative-space conclusion ("Mem0 has no `reflect()`") confirmed by re-running the grep at halt-loop time AND finding ZERO additional hits (defense vs file-tree drift in clone). Positioning insight written as a synthesis paragraph, NOT a fact-dump. **v1.1 EC-8 checkpoint — class-boundary anchor:** Step 1 `grep -n "^class " .claude/knowledge-base/references/mem0/mem0/memory/main.py` to obtain class-boundary line numbers. Step 2 document `_update_memory` ONLY within `class Memory:` body (the primary class). Methods on adjacent classes (proxies / clients / async variants) are out of Q6's target — note their existence as 1-line "also seen in" entries, but do NOT transcribe their bodies. **v1.1 EC-11 checkpoint — grep re-run defense:** at halt-loop time (NOT relying on pre-plan grep), re-execute `grep -rln "def reflect\|importance_score\|consolidat\|class.*Reflect\|generate_summary" .claude/knowledge-base/references/mem0 --include="*.py"` and confirm STILL zero hits. Citation of the re-run result locks the negative-space conclusion harder against file-tree drift.

- **Q7:** snapshot of arXiv abstract page exists with verified hash. Multiplicative formula `importance × recency × relevance` transcribed verbatim from § 4.2 with the source page-or-section number. If the abstract HTML doesn't contain the formula explicitly (paper's PDF only), document the URL-not-fully-machine-readable caveat and either (a) fetch the PDF via separate snapshot if PDF is allowlisted, OR (b) cite the formula from the abstract's summary and mark Q7 as `partial`. The PDF fetch path requires no new allowlist entry (`arxiv.org` covers both `/abs/` and `/pdf/`). **v1.1 EC-9 checkpoint — PDF Unicode brokenness:** if WebFetch'd PDF text contains garbled formula tokens (regex `\\u[0-9a-f]{4}` repetitions OR non-printable matter in formula area), mark Q7 `partial` in progress JSON AND cite formula as FOUND (even if partial) with explicit caveat in blueprint: "PDF text extraction may have lost mathematical typesetting; consult paper § 4.2 for canonical formula". Do NOT fabricate clean formula from training-data recall — fabrication is honesty violation (Inquebrável Rule 3) regardless of how plausible the reconstruction looks.

- **Q8:** snapshot of langchain.com `BackgroundMemoryManager` doc page exists. **URL lock checkpoint:** halt-loop pins the exact URL chosen pre-snapshot in progress JSON's `Q8.locked_url` field (mirrors v0-3 Q7 EC-3 pattern). If WebSearch returns multiple LangMem doc candidates, picks the FIRST whose HTML `<title>` contains `BackgroundMemoryManager` OR the LangMem section URL `/langgraph/reference/memory/`. **v1.1 EC-10 checkpoint — GitHub README fallback:** if FIRST 3 search results match NEITHER pattern, escalate fallback: WebFetch `github.com/langchain-ai/langmem/blob/main/README.md` (allowlist `github.com` already covers per `discover-web-allowlist.txt`). Official open-source README counts as valid design-comparison source for the published `BackgroundMemoryManager` API. Snapshot the README content with hash; cite under same Q8 source kind (`web — github.com fallback`).

## Acceptance Criteria

- [ ] All 8 research questions have status `done` OR `blocked` (with reason) in `.progress-v0-4a-reflection-pipeline.json` after halt-loop
- [ ] Every `.claude/knowledge-base/references/{project}/{path}` cited in blueprint exists via `Path.exists()` (no fabricated paths)
- [ ] Every URL cited has a corresponding `snapshots/v0-4a-reflection-pipeline/{sha256}.md` file
- [ ] All 5 coverage corners (tests/deps/tools/techniques/prior_art) populated with non-placeholder content
- [ ] Q2 ends with explicit Rule 9 ADOPT/REJECT/DEFER verdict per Node candidate evaluated (per cycle-discover.md v1.1 hard gate #7)
- [ ] Blueprint § ADRs has ≥ 1 ADR per LOAD-BEARING decision (likely 6: sleep-time mechanism, threshold trigger, scoring DIP, derived_from provenance, llm-importance cache, deployment shape)
- [ ] Blueprint § Recommendations provides 1+ concrete proposal per question (ADOPT/REJECT/DEFER on borrowed pattern)
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS

## Global Definition of Done

- [ ] All Acceptance Criteria above satisfied
- [ ] `/discover-confidence v0-4a-reflection-pipeline` invoked + verdict ≥ SHIPPABLE_WITH_CAVEATS per `.claude/rules/discover-blueprint-golden-rule.md`
- [ ] No hard caps triggered (no fabricated citations, all 5 corners populated, no off-allowlist domains, all snapshots present)
- [ ] If verdict = SHIPPABLE_WITH_CAVEATS: caveats listed honestly in the blueprint's Halt-loop progress section
- [ ] If verdict < SHIPPABLE_WITH_CAVEATS: re-run `/discover-improve v0-4a-reflection-pipeline` per cycle-discover chain

## Followups logged (not part of this plan, but surfaced for honesty)

| # | Item | Why deferred |
|---|---|---|
| F-langmem-clone-policy | Decide whether to clone `.claude/knowledge-base/references/langmem/` for Phase III v0.6 (Voyager-style skill library) per CLAUDE.md § Roadmap Item 8. If yes, retire D2's web-only stance for any langmem question post-v0.6. If no, keep covering via langchain.com web docs indefinitely. | v0.4a only needs ONE LangMem question (Q8 design-comparison); cloning overhead disproportionate today. v0.6 needs deeper langmem investigation (procedural memory) — that's when the clone decision earns its cost. |
| F-v0-4a-tbd-threshold-locks | Concretize the TBD threshold values in CLAUDE.md Item 5 acceptance: "background trigger fires within TBD seconds when threshold of N new memories crossed". The blueprint will recommend specific N + seconds based on Q4+Q5 evidence from Letta; `/to-plan v0-4a-reflection-pipeline` then locks them via an ADR row. | TBDs are intentionally open until the v0.4a kickoff (per CLAUDE.md Item 5 verbatim). Blueprint surfaces recommended values; `/to-plan` ADR locks them. |
| F-discover-plan-skill-bump-to-v1-1 | Same followup as v0-3's `F-discover-plan-skill-update`: `.claude/skills/discover-plan/SKILL.md` still says "four-corner" while cycle-discover.md is v1.1 (5-corner). v0-4a honors v1.1 contract per the policy "the contract is normative even if any single downstream file lags". | Same rationale as v0-3 — skill-file lag is acceptable as long as the cycle rule is honored. Bundled tracking. |
| F-q2-corner-classification (EC-12) | Cycle-discover.md v1.1 hard gate #7 (`rule9_verdict_missing` cap at 49) targets ONLY questions classified in `prior_art` corner. Q2 sits in `deps` corner (Letta deps inspection + Node ecosystem evaluation hybrid) — auto-cap does NOT fire here. Rule 9 verdict enforcement on Q2 is per-plan (Acceptance Criterion + Q2 halt-loop checkpoint), NOT via the cycle's hard gate. If `/discover-confidence` future versions extend deps-corner Rule 9 enforcement, retire this followup. | Honesty discipline; absorbed as DOCUMENT note per edge-case review. Enforcement is real (Q2 stays BLOCKED without verdict), just not via the v1.1 cap. |
| F-q2-agenda-bree-followup (EC-3 tail) | `agenda` and `bree` Node scheduler libs were originally in Q2's candidate list but moved here per EC-3 lock (Fase A only pre-allocates 3 WebFetches for `bullmq`, `node-cron`, `croner`). If a reviewer of the blueprint disputes the 3-candidate selection OR if Q2's Rule 9 verdict for the locked-3 turns out unsatisfying, a follow-up cycle MAY add `agenda` / `bree` evaluation. Not blocking v0.4a kickoff. | Time-budget realism: 3 candidates is sufficient for Rule 9 minimum (≥ 2); pre-allocating 5 risks budget overflow per F-q4-budget-overflow precedent. |
| F-q4-budget-overflow (EC-13) | Q4 reads 7 summarizer modules (~70kb total including 894-LoC `summarizer.py` full + 650-LoC `compact.py` full). Estimated synthesis time: 70-90 min vs implicit 48 min/Q in 4h Letta budget. Per-project stop-condition ("budget exhausted → BLOCKED") covers the overflow honestly: if Q5 becomes BLOCKED due to Q4 overrun, blueprint surfaces gap and human decides whether to re-run a follow-up cycle. Q4 depth > Q5 breadth trade-off accepted. | Halt-loop driver does NOT pre-shrink Q4 scope; it lets Q4 consume what it needs and marks Q5 BLOCKED if budget exhausts. Surface the gap, don't hide it. |
| F-d4-d5-decision-finality (EC-14) | ADRs D3 (scoring default), D4 (`derived_from` mandatory), D5 (LLM-importance cache contract) declare schema-touching invariants inside the DISCOVERY plan. Strictly, these decisions belong to `/to-plan v0-4a` downstream. Accepted because the blueprint will collect evidence under these lenses (e.g., Q4 column "provenance field yes/no/cite line" only matters if we already decided `derived_from` IS the target shape). Discovery plan ADRs FRAME the investigation lens; `/to-plan` retains the right to re-open D3/D4/D5 if Letta/Mem0 evidence forces revision. | Lens vs decision boundary respected. If discovery surfaces contradicting evidence, `/to-plan` re-opens; blueprint's Recommendations section is required to flag any contradictions explicitly per acceptance. |

## v1.1 edge-case absorption summary

Status of edges from `.claude/knowledge-base/reviews/v0-4a-reflection-pipeline-edge-cases-2026-05-25.md`:

| # | Severity | Absorption |
|---|---|---|
| EC-1 (Q6 `main.py` 3222 LoC > Read default 2000) | MUST FIX | ✓ Absorbed via Q6 Fase A method update (offset-based reads anchored to class boundaries) |
| EC-2 (Q4 `summarizer.py` 894 LoC vs "head 200") | MUST FIX | ✓ Absorbed via Q4 Fase A update ("FULL file — 894 LoC fits in default Read limit"; companion sizes for `compact.py` 20kb / `self_summarizer.py` 13kb / `summarizer_sliding_window.py` 10kb confirmed in line) |
| EC-3 (Q2 candidate list 5 vs 3 WebFetch) | MUST FIX | ✓ Absorbed via Q2 question text lock (3 + in-process `setTimeout`) + Fase A "EXACTLY 3 WebFetches" + Q2 halt-loop checkpoint + F-q2-agenda-bree-followup |
| EC-4 (Q1 mocking idiom transcribed verbatim) | SHOULD TEST | ✓ Absorbed via Q1 halt-loop checkpoint (no translation to vitest/jest at execute-time) |
| EC-5 (Q3 library-only 4th category) | SHOULD TEST | ✓ Absorbed via Q3 halt-loop checkpoint (4-way classification: embedded / subprocess / container / library-only) |
| EC-6 (Q4 before Q5 ordering invariant) | SHOULD TEST | ✓ Absorbed via Pre-flight checkpoint (`progress.question_order` declared explicitly) |
| EC-7 (Q5 out-of-scope cross-ref defense) | SHOULD TEST | ✓ Absorbed via Q5 halt-loop checkpoint (do NOT follow imports from `letta.agents.{letta_agent_*, base_agent_*, agent_loop}`; annotate-and-stop) |
| EC-8 (Q6 class-boundary grep anchor) | SHOULD TEST | ✓ Absorbed via Q6 halt-loop checkpoint (Step 1 anchor `^class ` boundaries; Step 2 document only within `class Memory:`) |
| EC-9 (Q7 PDF Unicode brokenness) | SHOULD TEST | ✓ Absorbed via Q7 halt-loop checkpoint (mark Q7 `partial` + caveat; do NOT fabricate clean formula from training-data recall) |
| EC-10 (Q8 GitHub README fallback) | SHOULD TEST | ✓ Absorbed via Q8 halt-loop checkpoint (`github.com/langchain-ai/langmem/blob/main/README.md` fallback if WebSearch fails URL pattern match) |
| EC-11 (Q6 grep re-run at halt-loop) | SHOULD TEST | ✓ Absorbed via Q6 halt-loop checkpoint (re-execute grep at execute-time, do NOT trust pre-plan grep against drift) |
| EC-12 (Q2 deps-corner Rule 9 enforcement) | DOCUMENT | ✓ Absorbed via F-q2-corner-classification Followup |
| EC-13 (Q4 budget overflow accepted) | DOCUMENT | ✓ Absorbed via F-q4-budget-overflow Followup |
| EC-14 (D4 + D5 schema-touching placement) | DOCUMENT | ✓ Absorbed via F-d4-d5-decision-finality Followup |

## Related

- Cycle rule: `.claude/rules/cycle-discover.md` (v1.1 — adds 5th `prior_art` corner)
- Golden rule: `.claude/rules/discover-blueprint-golden-rule.md`
- Companion v0.0 ADR-0005: `.claude/knowledge-base/adrs/ADR-0005-reflection-trigger.md` (locks `ReflectionPolicy` DIP + `ManualReflectionPolicy`; v0.4a adds two more impls behind same DIP)
- Companion v0.3 discovery plan: `.claude/knowledge-base/discoveries/plans/v0-3-agent-tools-mcp-plan.md` (shape reference + ADR D6 prerequisite pattern reused)
- Companion v0.3 blueprint: `.claude/knowledge-base/discoveries/blueprints/v0-3-agent-tools-mcp-blueprint.md` (8/8 questions, 6 ADRs, SHIPPABLE_WITH_CAVEATS 85/100 — quality bar to match)
- Roadmap entry: CLAUDE.md § Macro roadmap Item 5 (v0.4a — Reflection pipeline, Planned)
- Architecture rule consumed: `.claude/rules/architecture.md § 3` (DIP — new `src/local/reflection/` policy implementations + `src/core/dip/scoring-strategy.ts` interface — boundary-check.sh must extend when v0.4a lands)
- Testing rule consumed: `.claude/rules/testing.md § Pyramid` (async trigger lives at integration tier with real timers + real pgvector; scoring strategies covered by unit tests; LLM-importance cache covered by integration test asserting one-time LLM-invocation per content hash)
- Dogfood discipline: `.claude/rules/dogfood-golden-rule.md` (v0.4a stays Planned; no production-ready claim until v1.0)
