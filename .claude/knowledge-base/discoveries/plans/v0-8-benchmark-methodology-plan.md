# Discovery Plan: v0.8 Benchmark Methodology

> **Version 1.1** (2026-06-02) — Absorbs the `/discover-edge-cases` report at `.claude/knowledge-base/reviews/v0-8-benchmark-methodology-edge-cases-2026-06-02.md` (verdict NEEDS_ADJUSTMENT — 2 MUST FIX + 5 SHOULD TEST + 2 DOCUMENT). **TWO MUST FIX ABSORBED:** (a) **EC-1** Q3 Fase B now includes WebFetch path for HF dataset license card (huggingface.co allowlisted per ADR D3); (b) **EC-2** Q8 candidates capped at 5 with explicit priority order (1=RAGAS, 2=LangSmith Evaluations, 3=DeepEval, 4=BEIR, 5=ARES) + stop condition reserving budget for Q6/Q7. **FIVE SHOULD TEST CHECKPOINTS ADDED** to Halt-loop Checkpoints (EC-3 pre-loop allowlist verification, EC-4 Q1 duck-type fallback, EC-5 Q4 imports-vs-extras cross-check, EC-6 HF gated-dataset honest handling, EC-7 Q7 separate-rows assertion). **TWO DOCUMENT NOTES** inlined into Q5 (EC-8 wall-clock acceptably undocumented) and Q6 (EC-9 latest arXiv version discipline).
>
> **Version 1.0** (2026-06-02) — Initial discovery plan. Investigates **how memory-system benchmarks (LongMemEval / LoCoMo / DMR) are designed, run, and reported** so v0.8 (roadmap Item 10) can reproduce them **independently and defensibly** against TheMemory v0.7 + Mem0 v3 + Zep + Letta. Reference projects in scope: `.claude/knowledge-base/references/mem0/` (Apache 2.0, rich `evaluation/` dir) + `.claude/knowledge-base/references/letta/` (Apache 2.0, no committed benchmark code). LangMem clone is ABSENT (cap on scope). Expected output: a blueprint at `.claude/knowledge-base/discoveries/blueprints/v0-8-benchmark-methodology-blueprint.md` that gives `/auto-plan v0-8-independent-benchmark-reproduction` enough signal to plan the implementation with confidence ≥ 70.

**Slug:** `v0-8-benchmark-methodology`
**Owner:** project owner (`usetheodev@gmail.com`)
**Created:** 2026-06-02
**Time budget:** **7h total** (Mem0 4h · Letta 1h · WebSearch/WebFetch 2h)

## Context

`CLAUDE.md` roadmap row 10 (v0.8) requires reproducing LongMemEval + LoCoMo + DMR against TheMemory v0.7 + Mem0 v3 + Zep + Letta on **identical fixtures** with a published matrix (P95 latency / recall@10 / cost/session / temporal accuracy) at `docs/benchmarks/v0.8.md`. Row 11 (v1.0) gates `production-ready` claim on "Item 10 reproduced independently with verifiable artifacts" — see CLAUDE.md row 11. The /dogfood gate (independent) also blocks production-ready until anchor scenario runs ≥ 30 days; see `.claude/rules/dogfood-golden-rule.md`.

Triggering evidence: `/auto-plan v0-8-independent-benchmark-reproduction` Step 1 (`scripts/assess_confidence.py`) returned **20/100 LOW** confidence with refusal per `.claude/rules/cycle-auto-plan.md § Hard gates #3`. Signals collected: 0 references, 0 patterns skills, 0 ADRs, 0 completed similar plans. The honest blocker is **prior_art is unmapped** — Mem0/Zep/Letta publish benchmark numbers but the methodology + fixture state + reproducibility conventions are not yet investigated in this repo.

Pre-existing reference state (verified 2026-06-02):

- `.claude/knowledge-base/references/mem0/evaluation/` exists with 15+ files including `run_experiments.py`, `generate_scores.py`, `evals.py`, `prompts.py`, `Makefile`, `README.md`, `metrics/llm_judge.py`, `metrics/utils.py`, and adapters under `src/{zep,langmem,memzero,openai,rag}/` — Mem0 already shipped a multi-adapter benchmark runner.
- `.claude/knowledge-base/references/letta/` — `grep -rl "longmemeval|locomo|dmr"` returns **zero hits**. Letta does not ship benchmark code in the public clone; whatever numbers they publish live in vendor blogs / unpublished CI.
- `.claude/knowledge-base/references/langmem/` — **does not exist** in the references tree (was originally listed in `CLAUDE.md § Reference projects` but is absent). Honest cap: LangMem cannot be a Fase B target.

Project rules consumed:

- `architecture.md` § DIP — any benchmark runner code lives outside `src/core/` per DIP; likely at `benchmarks/` repo root or `src/benchmarks/` (TBD by /auto-plan v0.8)
- `testing.md` § Pyramid — benchmark code is not unit-tested in the traditional sense but the runner's METRIC COMPUTATION must be unit-tested (recall@10 calculation, latency P95 calculation)
- `discover-blueprint-golden-rule.md` § Hard caps — empty Coverage corner + fabricated citation = INVALID
- Inquebrável Rule 9 (Não Reinvente a Roda) — drives Q8 (existing benchmark-runner libs)
- Inquebrável Rule 3 (Honestidade Extrema) — drives the "no benchmark theater" anti-pattern in roadmap row 10

## Objective

**Produce a blueprint that lets `/auto-plan v0-8-independent-benchmark-reproduction` reach confidence ≥ 70 (SHIPPABLE_WITH_CAVEATS minimum) on first run.**

Measurable success criteria for the blueprint:

- [ ] All 8 research questions answered with citations to `.claude/knowledge-base/references/{mem0|letta}/` AND to allowlisted URLs (with snapshots in `.claude/knowledge-base/discoveries/snapshots/v0-8-benchmark-methodology/`)
- [ ] Cross-cutting comparison table populated for Mem0 vs Letta vs (Zep via Mem0's adapter) vs LangMem-as-baseline (via Mem0's adapter) — Letta gets a "no committed code" row
- [ ] Recommendations section provides at least one decision proposal per question + a Rule 9 verdict (ADOPT / REJECT / DEFER) on at least 2 dependency-candidate benchmark-runner libs
- [ ] All cited URLs have valid snapshots + allowlist entries
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `.claude/knowledge-base/references/mem0/` | `evaluation/` (all files), `docs/core-concepts/memory-evaluation.mdx`, `docs/changelog/highlights.mdx`, `docs/migration/oss-v2-to-v3.mdx`, `docs/migration/platform-v2-to-v3.mdx` | Mem0's benchmark surface is the densest signal we have access to. The `docs/` mdx files contain the v3 benchmark announcement context. |
| `.claude/knowledge-base/references/letta/` | `tests/` (sample for memory-test patterns), `letta/` (memory subsystem only — `letta/services/`, `letta/orm/memory*`), `pyproject.toml` (deps) | Letta has no committed benchmark code; surface their memory-test discipline + dep choices instead. |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| `.claude/knowledge-base/references/mem0/openclaw/` | Side-project unrelated to memory benchmark methodology |
| `.claude/knowledge-base/references/mem0/openmemory/`, `mem0-plugin/`, `vercel-ai-sdk/`, `embedchain/` | Adjacent products; not the benchmark surface |
| `.claude/knowledge-base/references/mem0/cookbooks/`, `examples/` | Tutorial / demo content; not benchmark methodology |
| `.claude/knowledge-base/references/letta/alembic/`, `letta/agents/`, `letta/llm_api/` | Non-memory subsystems |
| `.claude/knowledge-base/references/letta/fern/`, `nginx.conf`, `compose.yaml` | Infra/deploy; not benchmark |
| `.claude/knowledge-base/references/langmem/` | **ABSENT from references tree** — cannot cite what doesn't exist (per cycle-discover.md Anti-pattern #4). Whatever LangMem comparison we get comes via Mem0's `evaluation/src/langmem.py` adapter (proxy citation). |
| Build artifacts (`build/`, `dist/`, `.venv/`, `__pycache__/`, `node_modules/`) | Not source-of-truth |
| Any project NOT cloned into `.claude/knowledge-base/references/` | Cross-Project Rule: never claim a project feature without reading its source. Zep / TheMemory's own predecessors are unclonable as references; data comes via WebSearch + snapshots. |

## ADRs

### D1 — Time budget + per-question stop conditions

**Decision:** Mem0: 4h · Letta: 1h · Web (prior_art): 2h.

**Rationale:** Mem0's `evaluation/` dir (15+ files, 4 different adapter modules) is the densest signal we have. Letta's lack of committed benchmark code shrinks its budget — investigation there is bounded ("does Letta test memory subsystems at all? what are their fixture conventions?"). Web budget is heavier than prior cycles because prior_art has 3 questions (Q6-Q8) and each may require 2-3 WebSearch + 2-3 WebFetch + snapshot per cited URL.

**Alternatives considered:** equal 2h/2h/3h split (rejected: dilutes Mem0 surface); 6h Mem0 + 1h web (rejected: under-mapped prior_art is what triggered this cycle in the first place).

**Stop condition — per question (mandatory):** When a question's Fase A returns empty matches after 3 consecutive retries with different query variants, mark the question BLOCKED with reason "Fase A exhausted — no hotspots found" and continue to the next. For web questions, equivalent: when WebSearch returns zero results after 3 query variants, mark BLOCKED with reason "WebSearch exhausted".

**Stop condition — per project (mandatory):** When a project's time budget is exhausted with N questions still pending, mark all remaining questions for that project as BLOCKED with reason "budget exhausted" and continue.

**Anti-pattern:** NEVER fabricate Fase B answers when Fase A was exhausted. NEVER cite an arXiv ID or vendor URL from training-data recall — every URL must be reached via WebSearch THEN WebFetch THEN snapshot (per cycle-discover.md Anti-pattern #10 + #11).

**Consequences:** halt-loop stops iterating on a project when budget exhausted. Blocked questions surface in blueprint's `## Blocked questions` section.

### D2 — Investigation depth

**Decision:** **Mem0 evaluation/ — read each file end-to-end** (small files, average <200 LoC each, total ~15 files). Letta — Grep-first, Read-only-hotspots (no committed bench code to read end-to-end).

**Rationale:** Mem0's evaluation/ dir is the only place we get the full methodology in committed code. Reading partially would miss critical context (e.g., LLM-judge prompt phrasing affects metric reproducibility). Letta's surface is sparse enough that Grep+selective-Read is sufficient.

**Alternatives considered:** Grep-only for Mem0 (rejected: misses inline rationale + prompt text in `prompts.py`); Read-all for Letta (rejected: budget waste, no signal).

**Consequences:** Mem0 questions produce richer blueprint sections; Letta questions produce honest "limited surface" sections.

### D3 — Web allowlist additions REQUIRED before /discover-execute

**Decision:** Append the following domains to `.claude/rules/discover-web-allowlist.txt` BEFORE /discover-execute runs, each with inline rationale citing this discovery slug + date:

- `huggingface.co` — added for `v0-8-benchmark-methodology` Q6/Q7 at 2026-06-02 — LongMemEval + LoCoMo fixtures likely hosted on HF datasets
- `aclanthology.org` — added for `v0-8-benchmark-methodology` Q6/Q7 at 2026-06-02 — peer-reviewed memory-system papers
- `paperswithcode.com` — added for `v0-8-benchmark-methodology` Q6/Q7/Q8 at 2026-06-02 — benchmark leaderboards
- `mem0.ai` — added for `v0-8-benchmark-methodology` Q6 at 2026-06-02 — Mem0 v3 benchmark announcement post
- `www.getzep.com` — added for `v0-8-benchmark-methodology` Q7 at 2026-06-02 — Zep benchmark blog posts (bi-temporal claims)
- `letta.com` — added for `v0-8-benchmark-methodology` Q7 at 2026-06-02 — Letta benchmark vendor blog
- `docs.langchain.com` — added for `v0-8-benchmark-methodology` Q4/Q8 at 2026-06-02 — LangChain LangSmith eval framework (Rule 9 candidate)
- `python.langchain.com` — added for `v0-8-benchmark-methodology` Q4/Q8 at 2026-06-02 — LangChain official docs (different host)
- `developer.nvidia.com` — added for `v0-8-benchmark-methodology` Q8 at 2026-06-02 — NeMo Guardrails / Eval references (Rule 9 candidate)

**Rationale:** Each domain cited above is a primary source for v0.8 methodology. The allowlist update is a precondition for /discover-execute — cycle-discover.md v1.1 § Hard gates #5 caps confidence at 49 (INVALID) on off-allowlist URL.

**Alternatives considered:** WebSearch-only / no WebFetch (rejected: cycle-discover.md requires snapshot for every URL cited); add domains during /discover-execute halt-loop (rejected: that's drive-by addition per Anti-pattern #11).

**Consequences:** human must apply the additions to `discover-web-allowlist.txt` (with inline rationale) BEFORE /discover-execute runs. If skipped, /discover-confidence will cap at 49.

### D4 — LangMem cannot be a Fase B target

**Decision:** LangMem investigation is limited to **proxy citation via Mem0's `evaluation/src/langmem.py` adapter** + WebSearch for the LangMem repository on GitHub. No `.claude/knowledge-base/references/langmem/` paths can be cited because the clone is absent.

**Rationale:** Per cycle-discover.md Anti-pattern #4 ("NEVER fabricate a `.claude/knowledge-base/references/` citation"). The CLAUDE.md row originally listed LangMem alongside Mem0/Letta but the references tree shows only Mem0 + Letta. Best-effort honest path: investigate LangMem through Mem0's adapter + the upstream GitHub via WebFetch.

**Alternatives considered:** add LangMem to the in-scope (rejected: would require re-cloning which is a separate operation and not in scope for this cycle); skip LangMem entirely (rejected: violates spirit of side-by-side comparison even if data is thin).

**Consequences:** The blueprint's Cross-cutting comparison table will have a "LangMem (via Mem0 adapter)" column with HONESTLY THIN data + a footnote citing this ADR. Any Recommendations section that proposes a LangMem-relevant decision MUST cite ADR D4 as the depth limitation.

### D5 — Coverage Corner deferral

**Decision:** No corner deferred. All 5 corners (tests / deps / tools / techniques / prior_art) get ≥ 1 question.

**Rationale:** prior_art is the heaviest (3 questions) because the v0.8 methodology depends on academic + vendor sources outside `.claude/knowledge-base/references/`. tests / deps / tools / techniques are each ≥ 1 because the Mem0 evaluation/ dir naturally surfaces signal for each.

## Research Questions

| # | Question | Corner | Reference project(s) | Fase A (broad — Grep / ast-grep / WebSearch query variants) | Fase B (deep — Read / WebFetch at each hotspot) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | What is Mem0's benchmark runner architecture? How does `run_experiments.py` orchestrate the comparison across adapters (memzero / zep / langmem / rag / openai baseline)? | techniques | `.claude/knowledge-base/references/mem0/evaluation/` | `grep -rn "def main\|argparse\|click\|fire" .claude/knowledge-base/references/mem0/evaluation/*.py` (entry-points); `grep -rn "for adapter\|for method\|for model" .claude/knowledge-base/references/mem0/evaluation/` (loop shape) | Read `run_experiments.py` end-to-end + `Makefile` + `evals.py` orchestrator + each `src/*/add.py` `search.py` adapter pair | Architecture diagram (text) showing entry point → adapter loop → metrics aggregation → output; identify the abstraction boundary (which interface do adapters implement) |
| Q2 | What metrics does Mem0 compute, and how? Specifically: how does `metrics/llm_judge.py` decide correctness? How does `metrics/utils.py` compute the recall@K / precision-style numbers? | techniques | `.claude/knowledge-base/references/mem0/evaluation/metrics/` | `grep -n "def \|class " .claude/knowledge-base/references/mem0/evaluation/metrics/*.py` (function map); `grep -n "judge\|score\|recall\|precision" .claude/knowledge-base/references/mem0/evaluation/metrics/*.py` | Read `llm_judge.py` end-to-end (prompt text + parsing); Read `utils.py` for stats helpers; Read `prompts.py` for any judge prompts | Metrics table (metric name → computation logic → which file:line → known limitation, e.g., LLM-as-judge variance) |
| Q3 | What FIXTURES does Mem0's evaluation use? Are LongMemEval / LoCoMo / DMR datasets committed to the repo, downloaded at runtime, or referenced as external dependencies? | tests | `.claude/knowledge-base/references/mem0/evaluation/` + WebFetch HF dataset cards if runtime-downloaded | `find .claude/knowledge-base/references/mem0/evaluation -type f \( -name "*.json" -o -name "*.jsonl" -o -name "*.csv" -o -name "*.parquet" -o -name "*.yaml" \)` (data files); `grep -rn "load_dataset\|huggingface\|hf://\|download\|fetch" .claude/knowledge-base/references/mem0/evaluation/` | Read `evals.py` + `run_experiments.py` for fixture loading; Read `README.md` for setup instructions. **EC-1 absorbed:** if fixtures download at runtime via `load_dataset('{repo}/{dataset}')` or equivalent, WebFetch the corresponding `huggingface.co/datasets/{repo}/{dataset}` card → snapshot → extract `license:` field from card frontmatter or page body. The license lives on HF, NOT in Mem0's repo — Read-only Fase B leaves licence as "unknown" which is a fabrication risk for v0.8 fixture-commit decisions. | Fixture table (dataset name → committed/downloaded → location → size → **license** with citation to HF dataset card snapshot) + setup steps if downloaded |
| Q4 | What deps does Mem0's evaluation/ pull in (beyond core Mem0)? Are there specific stats/scoring libs (scipy / scikit-learn / statsmodels / specialized eval libs)? | deps | `.claude/knowledge-base/references/mem0/` | Grep `pyproject.toml`, `evaluation/Makefile`, `evaluation/*.py` for `import` statements + extras | Read each unique import to identify usage; check `pyproject.toml` for version pins | Dep table (name → version → purpose in evaluation/ → Rule 9 ADOPT/REJECT candidate for us) |
| Q5 | What does Mem0's `evaluation/Makefile` declare? What env vars + run targets does it expose? How long does a single benchmark run take + what hardware does it assume? | tools | `.claude/knowledge-base/references/mem0/evaluation/` | `grep -nE "^\.PHONY\|^[a-zA-Z_-]+:" .claude/knowledge-base/references/mem0/evaluation/Makefile` (targets); `grep -n "ENV\|export\|getenv\|os.environ" .claude/knowledge-base/references/mem0/evaluation/`  | Read `Makefile` end-to-end; Read `README.md` setup section + any wall-clock / cost notes. **EC-8 documented risk:** wall-clock may NOT be documented in README or Makefile (Mem0 likely runs benchmarks on internal infra without publishing hardware specs). Accept "wall-clock not documented; we'll measure during our v0.8 implementation" as a valid answer — NOT a blocker. v0.8 measurement is intrinsic to the implementation anyway. | Setup checklist (env vars, install steps, run targets, expected wall-clock — OR honest "undocumented; measure during v0.8 impl") — copy-paste ready for our v0.8 implementation |
| Q6 | LongMemEval — what's the paper's authoritative version (arXiv ID + date)? Where do fixtures live? What's the dataset license? Have any third parties reproduced the reported numbers + what tolerance did they observe? | prior_art | WebSearch + WebFetch only (no `.claude/knowledge-base/references/` path) | `WebSearch "LongMemEval arxiv"`, `WebSearch "LongMemEval huggingface dataset"`, `WebSearch "LongMemEval reproduction github"` (3 variants if first returns empty) | WebFetch arXiv abs page → snapshot; WebFetch HF dataset card → snapshot; WebFetch any third-party reproduction repo READMEs → snapshot. **EC-9 inline discipline:** if the arXiv paper has multiple versions (v1, v2, v3 visible in arxiv.org/abs/{ID} header), cite the **LATEST version** as authoritative + mention prior versions ONLY if reported metrics changed between versions. Do NOT cite v1 if v3 exists. | arXiv ID + date + venue (LATEST version) · HF dataset URL + license + size · ≥ 1 third-party reproduction with tolerance reported (or honest "no reproductions found") |
| Q7 | LoCoMo + DMR — same questions as Q6 for these two benchmarks. Are they more or less reproducible than LongMemEval per published evidence? | prior_art | WebSearch + WebFetch only | `WebSearch "LoCoMo conversational memory benchmark arxiv"`, `WebSearch "DMR memory benchmark arxiv"`, `WebSearch "Mem0 v3 LoCoMo DMR scores"` (3 variants each, fold into 1 Fase A query budget across both benchmarks) | WebFetch each paper landing page → snapshot; WebFetch Mem0 v3 announcement post → snapshot; WebFetch any third-party reproduction → snapshot | Same table shape as Q6 with LoCoMo + DMR rows + reproducibility verdict (more reproducible / less / comparable) |
| Q8 | **Rule 9 verdict** — are there existing benchmark-runner libraries we should ADOPT instead of writing our own? **EC-2 absorbed — investigate up to 5 candidates in priority order:** (1) **RAGAS** (most-active RAG eval framework, 2026 releases), (2) **LangChain LangSmith Evaluations** (vendor-managed eval suite), (3) **DeepEval** (open-source eval framework with custom metrics), (4) **BEIR** (information-retrieval benchmark suite), (5) **ARES** (automated RAG evaluation). Stop conditions: at least 2 must reach explicit ADOPT/REJECT/DEFER verdict; **HALT at 5 candidates OR when web budget reaches 30 min remaining (reserve for Q6/Q7)**, whichever first. Candidates 6+ (RAGElo, NVIDIA NeMo Eval, lightning-eval) are FOLLOW-UP — record as "not investigated due to budget cap" if reached. | prior_art | WebSearch + WebFetch | For EACH candidate in priority order (1→5): `WebSearch "{candidate} python library"`, then `WebSearch "{candidate} memory-system OR conversational AI evaluation"` if first query empty (max 2 query variants per candidate, NOT 3 — reserve budget). Stop at 5 candidates OR 30-min budget reserve, whichever first. | For each candidate that passes Fase A: WebFetch GitHub README → snapshot; WebFetch PyPI page → snapshot; identify last release date + license + scope (metric/fixture/orchestration coverage). | Per-candidate verdict ADOPT/REJECT/DEFER with rationale + matrix (candidate → license → last release → covers metrics/fixtures/orchestration → blocker if any). **Minimum 2 verdicts complete; up to 5; uninvestigated candidates listed as "follow-up / budget-capped".** |

## Coverage Matrix

| Corner | Questions mapped | Status |
|---|---|---|
| **Integration tests** | Q3 | Covered (1) |
| **Dependencies** | Q4 | Covered (1) |
| **Tools** | Q5 | Covered (1) |
| **Techniques** | Q1, Q2 | Covered (2) |
| **Prior art** | Q6, Q7, Q8 | Covered (3) |

**Coverage: 5/5 corners (100%)**. Question budget: 8 questions total (within 5-10 budget); max per corner = 3 (prior_art, at cap); min per corner = 1 (deps / tests / tools — all at min). All within `cycle-discover.md` v1.1 question budget.

## Halt-loop Checkpoints

| Checkpoint | Assertion | Action if fails |
|---|---|---|
| **Pre-loop checkpoint — EC-3 absorbed** | Before iteration 1: all 9 domains from ADR D3 exist in `.claude/rules/discover-web-allowlist.txt` (`huggingface.co`, `aclanthology.org`, `paperswithcode.com`, `mem0.ai`, `www.getzep.com`, `letta.com`, `docs.langchain.com`, `python.langchain.com`, `developer.nvidia.com`) | HALT with reason "allowlist not updated per ADR D3" before any WebFetch attempt. Avoids cascade of domain_not_in_allowlist failures across Q6/Q7/Q8. |
| Before answering Qx | Cited `.claude/knowledge-base/references/{...}` path exists (or for prior_art Qx: the WebSearch query returns ≥ 1 result on first try) | Mark Qx BLOCKED with reason "path not found" or "WebSearch returned 0"; continue |
| Per-question Fase A budget | Fase A returned ≥ 1 hotspot OR 3 query-variant retries attempted | After 3 retries empty → mark Qx BLOCKED with reason "Fase A exhausted"; continue |
| **Web allowlist precondition** | Before any URL is fetched: domain is in `.claude/rules/discover-web-allowlist.txt` | If not allowlisted, mark URL BLOCKED with reason "domain_not_in_allowlist", DO NOT WebFetch (would taint the snapshot trail); continue to next URL |
| **Snapshot-before-cite invariant** | Before adding any URL to blueprint: `snapshots/v0-8-benchmark-methodology/{sha256}.md` has been written for that URL | If snapshot write failed (network out, WebFetch error), mark Qx as PARTIAL with reason "url-unfetchable"; do NOT cite URL |
| **HF gated-dataset honest handling — EC-6 absorbed** (Q3, Q6, Q7) | When WebFetch on a `huggingface.co/datasets/{...}` URL returns HTTP 401/403 OR the fetched body contains "requires authentication" / "gated dataset" / "license required" / "you must be logged in" | Mark the dataset as **"gated — requires HF token + license acceptance"** in the blueprint with snapshot of the response page. Do NOT fabricate fixture availability; do NOT claim license unknown without surfacing the gating itself. |
| **Q1 duck-type fallback — EC-4 absorbed** | If Q1 Fase B reveals Mem0's `evaluation/src/{adapter}/` modules have NO shared base class / Protocol / abstract method | Record explicitly as "no formal interface; duck-type contract" + extract the function signatures expected across adapters (`add()`, `search()`, etc.) as the de-facto contract. Do NOT fabricate a class hierarchy. |
| **Q4 imports-vs-extras cross-check — EC-5 absorbed** | Every `import` in `evaluation/*.py` Fase B maps to a dep declared in `pyproject.toml` main OR `[project.optional-dependencies]` extras | Flag any orphan import (declared nowhere) as 'undocumented external dep — Rule 9 risk for our v0.8 reproduction'. Capture in blueprint with file:line of the orphan import. |
| **Q7 separate-rows assertion — EC-7 absorbed** | Q7 answer shape MUST produce ≥ 1 row per benchmark: 1 row for LoCoMo AND 1 row for DMR (not a combined "they're similar" single row) | Re-iterate Q7 to split into separate rows (1 retry max); if still collapsed, mark Q7 PARTIAL with reason "benchmark rows not separated". |
| After answering Qx | Blueprint section under Qx has at least one citation (`.claude/knowledge-base/references/...` OR allowlisted URL with verified snapshot) | Re-iterate Qx (1 retry max) |
| Per-project time budget | Project's time budget not exhausted | Exhausted → mark remaining for that project BLOCKED "budget exhausted"; advance |
| **Rule 9 verdict completeness** (Q8 specific) | For at least 2 of the 5 capped candidates (per Q8 priority order), blueprint records explicit ADOPT/REJECT/DEFER verdict with rationale | Re-iterate Q8 to fill in at least 2 verdicts (1 retry); if still incomplete, mark Q8 PARTIAL with reason "Rule 9 verdict thin" |
| Before promising complete | All 5 coverage corners have populated sections | Refuse promise, continue iterating |

## Acceptance Criteria

- [ ] All 8 research questions answered OR explicitly marked BLOCKED/PARTIAL with reason
- [ ] All 5 coverage corners have populated blueprint sections
- [ ] Every `.claude/knowledge-base/references/{...}` citation in the blueprint resolves via `Path.exists()`
- [ ] Every URL citation has a corresponding snapshot at `.claude/knowledge-base/discoveries/snapshots/v0-8-benchmark-methodology/{sha256}.md`
- [ ] Every URL's domain appears in `.claude/rules/discover-web-allowlist.txt` (the human must apply ADR D3 additions before /discover-execute)
- [ ] At least one ADR section in the blueprint synthesizes decisions taken during research (e.g., "we recommend reusing Mem0's metric-judge prompt with adaptation X")
- [ ] At least 2 Rule 9 ADOPT/REJECT/DEFER verdicts in Q8 (per the halt-loop checkpoint)
- [ ] Time budget respected per project
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS

## Global Definition of Done

- [ ] All cycle phases completed (this plan → `/discover-edge-cases` → `/discover-execute` → `/discover-confidence` → optional `/discover-improve` → final `/discover-confidence` re-score)
- [ ] Final `/discover-confidence` verdict recorded in the blueprint header
- [ ] No fabricated citations (local OR URL)
- [ ] Coverage Matrix 100% covered (already locked at 100% in this plan)
- [ ] ADRs reference at least one principle from project rules: D1 cites `cycle-discover.md` § Stop conditions; D2 cites `architecture.md` § DIP indirectly via "abstraction boundary" framing; D3 cites `cycle-discover.md` v1.1 § Hard gate #5; D4 cites cycle-discover.md Anti-pattern #4; D5 cites cycle-discover.md v1.1 question budget. Inquebrável Rule 9 drives Q8.
- [ ] Web allowlist updated per ADR D3 BEFORE /discover-execute (manual step by human)
- [ ] Blueprint saved at `.claude/knowledge-base/discoveries/blueprints/v0-8-benchmark-methodology-blueprint.md`
- [ ] Downstream readiness: `/auto-plan v0-8-independent-benchmark-reproduction` re-run after blueprint ships should now score ≥ 70 (signals: blueprint cited as prior_art + Rule 9 ADRs landed + Q8 candidates evaluated + per-question methodology answers)

## Related

- Companion cycle (downstream): `cycle-plan.md` — `/auto-plan v0-8-independent-benchmark-reproduction` consumes this blueprint
- Sibling skill (next phase): `/discover-edge-cases v0-8-benchmark-methodology`
- Sibling skill (after edge-cases): `/discover-execute v0-8-benchmark-methodology`
- Source of truth: `.claude/rules/cycle-discover.md` v1.1 (5-corner coverage, web allowlist + snapshot enforcement, Rule 9 evaluation requirement)
- Roadmap rows: `CLAUDE.md` row 10 (v0.8) + row 11 (v1.0 gate)
- Inquebrável: `/home/paulo/.claude/CLAUDE.md` § 3 (Honestidade Extrema) + § 9 (Não Reinvente a Roda)
