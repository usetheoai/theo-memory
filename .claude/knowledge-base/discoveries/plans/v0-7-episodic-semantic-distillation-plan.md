# Discovery Plan: v0.7 — Episodic→Semantic Distillation Pipeline

> **Version 1.1** (2026-06-01) — Absorbs ALL 9 edge cases from `/discover-edge-cases v0-7-episodic-semantic-distillation` review at `.claude/knowledge-base/reviews/v0-7-episodic-semantic-distillation-edge-cases-2026-06-01.md`. **3 MUST FIX absorbed**: EC-1 (Letta tests path corrected from `letta/letta/tests/` to `.claude/knowledge-base/references/letta/tests/` — verified via `ls`); EC-2 (pre-flight allowlist additions for 6 domains shipped as separate commit BEFORE /discover-execute — see Phase 0 below); EC-3 (Q2 Fase A method changed from `git log --oneline` to syntactic diff + active-importer grep, because clones are `--depth 1` per CLAUDE.md and `git -C ... log` returns 1 commit). **3 SHOULD TEST absorbed as halt-loop checkpoints**: EC-4 (Q1 prompt fallback search paths); EC-5 (Q3 Mem0 absent conflict-resolution = FINDING POSITIVO not BLOCKED); EC-6 (Q5 Rule 9 cap at 5 libs/project). **3 DOCUMENT absorbed as ADR notes**: EC-7 (D4 expanded — snapshot infra is MANUAL because discover-web-v0-1 not shipped; precedent at `discoveries/snapshots/{v0-3,v0-4a,v0-4b,voyager-skill-library}/`); EC-8 (Q2 pre-step grep active importers in `letta/`); EC-9 (D4 — arXiv abs URL only, not PDF; fallback `ar5iv.labs.arxiv.org` already allowlisted).
>
> **Version 1.0** (2026-06-01) — Investigates how Mem0 and Letta convert raw episodic input (chat turns, document ingest, raw events) into semantic facts with provenance + conflict-resolution + gold-set evaluation methodology. Roadmap Item 9 / Open Problem #3 per `CLAUDE.md § Macro roadmap`: "Mem0 + Zep try, quality remains open." The blueprint must give `/to-plan v0-7-distillation-pipeline` an evidence-backed grounding for THE GOAL TEST (200 manually-labeled episodes → entity-extraction precision/recall thresholds + conflict-resolution test + every persisted semantic fact has non-empty `derived_from: episodeId[]`). Cross-references the academic prior art (Generative Agents reflection, CoALA distillation, MemoryBank gold-set methodology) via the discover-web allowlist.

**Slug:** `v0-7-episodic-semantic-distillation`
**Owner:** paulohenriquevn
**Created:** 2026-06-01
**Time budget:** 8h (per-project breakdown in ADR D1)

## Context

`CLAUDE.md § Macro roadmap` Item 9 (v0.7) declares the gap: "Managed pipeline: raw episodes → entity extraction → conflict resolution (LLM-judged) → semantic facts with provenance link back to source episodes." Acceptance criteria require a **gold set of 200 manually-labeled raw episodes** committed under `tests/fixtures/distillation/` + entity-extraction precision/recall thresholds locked at v0.7 kickoff + conflict-resolution test (two contradictory facts → one + history with rejected alternative + reason) + every persisted semantic fact has non-empty `derived_from: episodeId[]`.

Per the strategic-review CTO answer 2026-06-01: v0.7 is the highest-leverage MOAT but the highest-cost design (200-400k tokens /implement; gold-set authoring is the bottleneck). **Without v0.7 sólido, v0.8 benchmarks contra Mem0/Zep tendem a ficar equiparados em vez de superior** (per `CLAUDE.md § Competitive superiority matrix`). This discovery cycle precedes /to-plan so the eventual implementation plan is grounded in evidence, not training-data recall.

The 3 known-comparable approaches that must be audited:

1. **Mem0 two-stage write pipeline** (per `CLAUDE.md § Mem0-shape architecture` adoption): vector + LLM extraction + hybrid retrieval. Source at `.claude/knowledge-base/references/mem0/mem0/memory/{main,base,storage}.py`. We adopted the shape at v0.1 but NEVER investigated how their distillation handles conflict-resolution.
2. **Letta sleep-time agents** (per `CLAUDE.md § Roadmap Item 5 v0.4a`): "sleep-time worker (Letta pattern)" — used as architectural justification but never deeply explored. Letta ships FOUR versioned implementations (`groups/sleeptime_multi_agent_v{1,2,3,4}.py`) — strong evidence of iteration on this exact problem; the versions are likely a goldmine of failure modes.
3. **Generative Agents reflection** (Park et al. 2023, arxiv:2304.03442): the canonical academic reference for "consolidate observations → higher-order memories". CoALA (Sumers et al. 2023) generalizes this. MemoryBank (Zhong et al. 2023) provides the gold-set methodology we'll mirror.

This discovery is OPT-IN cost (~170-300k tokens estimated) for HIGH leverage: the eventual /implement of v0.7 costs 200-400k. Sem o discovery, /to-plan estará inventando o design vs adotar o pattern certo.

## Phase 0 — pre-flight (BLOCKING gate for `/discover-execute`)

**EC-2 absorption — allowlist additions MUST be committed BEFORE `/discover-execute` runs.** Without this, Q7+Q8 will cite URLs that fail `.claude/rules/discover-web-allowlist.txt` → cycle-discover.md v1.1 hard gate #5 (`domain_not_in_allowlist`) caps `/discover-confidence` at 49 INVALID.

**Required pre-flight commit (single atomic):**

```
chore(allowlist)(v0-7): seed prior_art domains — aclanthology + martinfowler + blog.mem0.ai + www.letta.com + zep.ai + cognee.ai

Adds 6 entries to .claude/rules/discover-web-allowlist.txt with inline rationale
citing v0-7-episodic-semantic-distillation plan v1.1 EC-2 absorption + date.
Pre-condition for /discover-execute (Q7 academic prior_art + Q8 vendor blogs).
Subdomains added separately per allowlist subdomain rule.
```

**Verification before /discover-execute starts:**
```bash
grep -E "aclanthology\.org|martinfowler\.com|blog\.mem0\.ai|www\.letta\.com|zep\.ai|cognee\.ai" .claude/rules/discover-web-allowlist.txt | wc -l === 6
```

If grep returns < 6, halt /discover-execute with "pre-flight allowlist failed; commit allowlist additions first".

## Objective

The produced blueprint MUST enable the eventual `/to-plan v0-7-distillation-pipeline` to lock in:

- A specific pipeline shape (sequential vs sleep-time-worker vs hybrid) with named source projects + line citations
- A specific conflict-resolution algorithm with example tests from existing implementations
- A specific gold-set methodology (size, labeling protocol, eval metrics) with academic anchor
- A specific provenance schema (`derived_from`, optional `rejected_alternatives`, optional `reasoning_trace`) with prior-art comparison
- An honest assessment of Mem0/Letta gaps that v0.7 must improve on (otherwise our differentiation pitch is hollow)

Measurable success criteria for the blueprint:

- [ ] All 8 research questions answered with citations to `.claude/knowledge-base/references/` (Mem0 + Letta) OR `.claude/knowledge-base/discoveries/snapshots/v0-7-episodic-semantic-distillation/` (web prior_art)
- [ ] Cross-cutting comparison table populated for Mem0 vs Letta (5 columns: pipeline shape, extraction LLM, conflict-resolution strategy, gold-set methodology, provenance schema)
- [ ] Recommendations section provides at least one concrete decision proposal per in-scope research question
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS per `.claude/rules/discover-blueprint-golden-rule.md` (Coverage 5/5 corners — no fabricated citations — Rule 9 verdict on each dependency-candidate lib)

## In-Scope / Out-of-Scope

### In-Scope

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `.claude/knowledge-base/references/mem0/` | `mem0/mem0/memory/{main,base,storage,utils}.py` + `mem0/tests/memory/` + `mem0/mem0/llms/` (LLM client shape) + `mem0/mem0-ts/src/memory/` (TS parity check — Mem0-shape we adopted is the TS source of truth) | Mem0-shape is locked as our architecture; the two-stage write pipeline IS the prior art we adopt. We never investigated its distillation conflict-resolution. |
| `.claude/knowledge-base/references/letta/` | `letta/letta/agents/voice_sleeptime_agent.py` + `letta/letta/groups/sleeptime_multi_agent_v{1,2,3,4}.py` + `letta/letta/services/archive_manager.py` + `letta/letta/prompts/system_prompts/{sleeptime_v2,sleeptime_doc_ingest}.py` + `letta/letta/services/agent_manager.py` (orchestration) + **`letta/tests/`** (EC-1 corrected path — verified contains `adapters/`, `conftest.py`, `configs/`; the path `letta/letta/tests/` cited in v1.0 does NOT exist) | Letta's sleep-time agents are the canonical "background distillation" reference per ADR-0005. v1→v4 iteration is gold for understanding failure modes. |
| Web prior_art (allowlisted domains) | arxiv.org (Generative Agents, CoALA, MemoryBank papers); aclanthology.org (NeurIPS/EMNLP venues); blog.mem0.ai (vendor docs); www.letta.com (vendor blog); zep.ai (Zep's competing approach); martinfowler.com (Pipeline pattern canonical source) | Inquebrável Rule 9 + cycle-discover v1.1 § prior_art corner: the design MUST cite academic anchors, not training-data recall. |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| `.claude/knowledge-base/references/mem0/openmemory/` (UI + cloud surface) | Web UI; not the distillation pipeline |
| `.claude/knowledge-base/references/mem0/embedchain/` | Different product line (RAG-focused); not in our adoption scope |
| `.claude/knowledge-base/references/mem0/cookbooks/` + `examples/` | Tutorial code; references the same pipeline already in scope |
| `.claude/knowledge-base/references/letta/letta/{client,types,schemas}/` | Surface area (API types) — load-bearing for v0.5 cloud cycle, NOT for distillation algorithm |
| `.claude/knowledge-base/references/letta/letta/local_llm/` | Inference adapters — already covered by our adapter portfolio cycles |
| LangMem | NOT CLONED (per `du -sh .claude/knowledge-base/references/` returns only mem0 + letta). CLAUDE.md mentions a langmem clone but it's not currently on disk. Out-of-scope by absence; if user wants LangMem included, must clone first. |
| Any project NOT cloned into `.claude/knowledge-base/references/` | Cross-Project Rule per cycle-discover: never claim a project feature without reading its source |

## ADRs

### D1 — Time budget + stop conditions

**Decision:** Mem0: 3h, Letta: 3h, Web prior_art: 2h. Total 8h.

**Rationale:** Mem0 is the architecture we adopted — deepest dive needed (we never investigated their distillation specifically). Letta has 4 versioned sleep-time impls — explicit iteration evidence worth equal investment. Web prior_art needs less time (3 papers + 3 vendor blogs is enough to ground claims; deeper academic survey is out-of-scope for v0.7 design grounding).

**Alternatives considered:**
- (A) Mem0-only (5h) + Letta deferred — REJECTED: Letta's v1-v4 sleep-time iteration is exactly the failure-mode evidence we need; skipping it loses the moat.
- (B) Equal-split 2.5h per project + 3h web — REJECTED: web isn't worth 3h (papers are short; vendor blogs are thin).
- (C) Web prior_art deferred to follow-up cycle — REJECTED: cycle-discover v1.1 § prior_art corner is INQUEBRÁVEL; deferral requires explicit ADR + caps confidence at SHIPPABLE_WITH_CAVEATS.

**Stop condition — per question (mandatory):** When a question's Fase A (broad ast-grep / WebSearch) returns empty matches after 3 consecutive retries with different query variants, mark the question BLOCKED with reason "Fase A exhausted — no hotspots found" and continue. Do NOT pad with unrelated hotspots from a different question's scope.

**Stop condition — per project (mandatory):** When a project's time budget is exhausted with N questions still pending, mark all remaining questions for that project as BLOCKED with reason "budget exhausted" and continue.

**Stop condition — web budget (cycle-discover v1.1):** Max 20 WebSearch + 30 WebFetch per cycle. Track in `.progress-v0-7-episodic-semantic-distillation.json`. When hit, remaining prior_art questions BLOCKED.

**Anti-pattern:** NEVER fabricate Fase B answers to close a question whose Fase A was exhausted. Honest BLOCKED with reason is required (Inquebrável Rule 3). NEVER cite a URL from training-data recall — always WebSearch + WebFetch + snapshot first.

**Consequences:** the halt-loop will stop iterating on a project when its budget is exhausted; blocked questions surface explicitly in the blueprint's `## Blocked questions (if any)` section — they become next-discovery seed.

### D2 — Investigation depth: AST-first for code, Read-first for prompts

**Decision:** For code-shape questions (Q1, Q2, Q3, Q5), use ast-grep Fase A to enumerate function/class hotspots before Read. For prompt-shape questions (Q3 conflict-resolution prompts, Q6 dev story), skip Fase A and Read directly.

**Rationale:** Letta's sleep-time agents have 4 versions × multiple files each; without ast-grep mapping, we'd Read everything blind and exhaust the budget. Mem0's `memory/main.py` is single-file orchestration; Read directly. Prompt files are text-shape (system prompts under `prompts/system_prompts/`); ast-grep doesn't help.

**Alternatives considered:**
- (A) Pure-Read everything — REJECTED: budget would explode on Letta's v1-v4 surface.
- (B) Pure-ast-grep — REJECTED: prompt files (text) and conflict-resolution narratives (prose) need full Read.
- (C) Hybrid per-question (CHOSEN).

**Consequences:** Fase A query variants must be declared upfront per question. Fase B Read paths are derived from Fase A hits. Each Q1/Q2/Q3/Q5 row in the Research Questions table specifies BOTH phases explicitly.

### D3 — prior_art Rule 9 verdict per dependency-candidate lib

**Decision:** For every lib mentioned in Mem0/Letta's distillation pipeline (spaCy, sentence-transformers, OpenAI extraction LLMs, fastapi for serving, etc.), the blueprint MUST record one of: `ADOPT` / `REJECT (rationale)` / `DEFER (revisit date)`. Per cycle-discover v1.1 § hard gate #7.

**Rationale:** v0.7 distillation will hit Rule 9 evaluation at /to-plan stage; doing it now in the blueprint saves a re-investigation cycle. Without explicit verdicts, the blueprint is half-honest.

**Alternatives considered:**
- (A) Defer Rule 9 evaluation to /to-plan — REJECTED: cycle-discover v1.1 hard gate `rule9_verdict_missing` caps at 49 (INVALID); the discovery blueprint cannot pass `/discover-confidence` without it.
- (B) Light-touch verdicts (just list libs) — REJECTED: same hard gate.

**Consequences:** Q5 (deps corner) explicitly forces the Rule 9 verdict matrix. Blueprint will have a `## Dependency-candidate evaluations` section enumerating each lib.

### D4 — Snapshot discipline for prior_art (EC-7 + EC-9 expansions)

**Decision:** Every URL cited in the blueprint MUST have a corresponding file at `.claude/knowledge-base/discoveries/snapshots/v0-7-episodic-semantic-distillation/{sha256}.md` where `sha256` is computed over `{url}\n---\n{fetched-content}`. Per cycle-discover v1.1 hard gate #6.

**Rationale:** Inquebrável Rule 3 (extreme honesty) — URLs drift, papers get revised, vendor blogs get rewritten. The snapshot is the source of truth; the live URL is volatile.

**EC-7 absorption (snapshot infra is MANUAL, not programmatic):** The cycle-discover.md v1.1 contract names helpers `_canonicalize_url_match`, `_extract_snapshot_body`, `_compute_snapshot_sha256`, `_check_urls_live` to be shipped in `.claude/skills/discover-confidence/scripts/check_reference_citations.py`. Verification 2026-06-01: `grep -l _canonicalize_url_match .claude/skills/discover-confidence/scripts/` returns EMPTY. The discover-web-v0-1 plan EXISTS at `.claude/knowledge-base/plans/discover-web-v0-1-plan.md` but is NOT in `plans/completed/` — i.e., the helpers are NOT yet shipped. **Therefore /discover-execute writes snapshots MANUALLY** during halt-loop iterations, mirroring the precedent at the 4 existing snapshot dirs: `.claude/knowledge-base/discoveries/snapshots/{v0-3-agent-tools-mcp,v0-4a-reflection-pipeline,v0-4b-forgetting-pipeline,voyager-skill-library}/`. Each manual snapshot uses `python3 -c "import hashlib; print(hashlib.sha256(b'{url}\n---\n{content}').hexdigest())"` + Write tool. When discover-web-v0-1 finally ships, next discovery cycles use the programmatic helpers; this one stays manual.

**EC-9 absorption (arXiv URL discipline):** For Q7 papers, always snapshot the **abs page** (`https://arxiv.org/abs/{id}`), NEVER the PDF (`https://arxiv.org/pdf/{id}.pdf`). Reasons: (a) abs page is stable HTML — extractable; PDF is binary — needs tooling we don't ship; (b) arxiv papers have revised versions (v1/v2/v3); abs page lists ALL versions + latest, PDF locks to one. If algorithm steps require deeper detail than abs page provides, fallback secondary to `https://ar5iv.labs.arxiv.org/{id}` (HTML rendering of the full paper; already in allowlist line 46).

**Alternatives considered:**
- (A) URLs only, no snapshot — REJECTED: cycle-discover v1.1 hard gate caps at 49.
- (B) Snapshot only the academic papers, not vendor blogs — REJECTED: vendor blogs are the most likely to be rewritten without notice.
- (C) Block this discovery on discover-web-v0-1 shipping first — REJECTED: precedent of 4 manual-snapshot cycles already exists; serialization adds 2-3 weeks for no quality gain.

**Consequences:** /discover-execute writes the snapshot AT THE SAME ITERATION the URL is cited, using manual `hashlib.sha256` + Write. Confidence verifier will check existence (`Path.exists()`) + hash match recomputed. The honest gap (helpers not yet programmatic) is documented per Inquebrável Rule 3.

### D5 — Coverage corner #5 (prior_art) is mandatory, NOT deferrable

**Decision:** prior_art is one of the 5 corners (cycle-discover v1.1) and is mandatory for this discovery. No DEFER-CORNER marker.

**Rationale:** v0.7 is the moat-defining cycle; without academic + vendor anchors, our differentiation pitch is hollow ("trust me, it's better than Mem0" is not evidence).

**Alternatives considered:**
- (A) DEFER-CORNER: prior_art | "language barrier" — REJECTED: papers are English; not applicable.
- (B) Light prior_art (1 question) — REJECTED: we need both academic anchors AND vendor-claim audit (different angles); Q7 + Q8 are not redundant.

**Consequences:** Q7 + Q8 are non-negotiable. /discover-confidence will check both have non-empty Fase B citations or honest BLOCKED.

## Research Questions

| # | Question | Corner | Reference project(s) | Fase A (broad map) | Fase B (deep — Read at each hotspot) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | How does Mem0's two-stage write pipeline transform raw input → persistable semantic facts? Specifically: where does the LLM extraction prompt live, what schema does it emit (`{memory: [...]}` per Cycle 1 stub absorption OR `{facts: [...]}` per Mem0 docs), and what's the conflict-resolution path when an emitted fact contradicts an existing one? | techniques | `.claude/knowledge-base/references/mem0/mem0/memory/{main,base,utils}.py` + `mem0/mem0/llms/` (extraction LLM client) + `mem0/mem0-ts/src/memory/` (TS parity) | ast-grep `--lang python --pattern 'def $METHOD($$$): $$$'` on `mem0/memory/main.py` to enumerate methods; ast-grep `--lang python --pattern 'class $NAME($$$): $$$'` to list classes; grep `prompt` + `extract` keywords in `mem0/memory/utils.py` | Read each candidate method + prompt file end-to-end; capture: extraction prompt verbatim, response schema, conflict-detection check (is there one? what triggers it?), fallback behavior | Sequence diagram (raw input → 6 phases → persisted fact) + extraction prompt verbatim + conflict-resolution algorithm description + path:line citations |
| Q2 | How do Letta's sleep-time agents (`sleeptime_multi_agent_v{1,2,3,4}`) consolidate episodic memory into archival/semantic memory? Why FOUR versions — what failure mode drove each iteration? What's the consensus shape that survived? | techniques | `.claude/knowledge-base/references/letta/letta/groups/sleeptime_multi_agent_v{1,2,3,4}.py` + `letta/letta/agents/voice_sleeptime_agent.py` + `letta/letta/prompts/system_prompts/{sleeptime_v2,sleeptime_doc_ingest}.py` + `letta/letta/services/archive_manager.py` | **EC-3 + EC-8 absorption — clones are `--depth 1` so `git log` brings no history. Replaced method.** Pre-step (EC-8): `grep -rE "from .sleeptime_multi_agent_v[1-4]\|import sleeptime_multi_agent_v[1-4]" letta/letta/` to identify which versions are STILL IMPORTED (consumer-active vs abandoned-experiments). Then Fase A: (a) ast-grep `--lang python --pattern 'class $NAME($$$): $$$'` on each `sleeptime_multi_agent_v*.py` to enumerate class structure; (b) `diff sleeptime_multi_agent_v1.py v2.py \| head -100`, `diff v2 v3`, `diff v3 v4` → captures signature + body deltas; (c) grep `TODO\|FIXME\|DEPRECATED\|XXX\|HACK` in each version file for inline iteration hints. | Read v1→v4 diffs from Fase A (b) full output for active versions only (skip abandoned per EC-8); Read both prompt files to capture distillation prompt text | Evolution table (active v_n → active v_(n+1) deltas; abandoned versions marked as such; v_final: shape Y + justification) + verbatim distillation prompt(s) + path:line citations |
| Q3 | Compare conflict-resolution strategies: how does each project handle two contradictory facts from different episodes (e.g., "Paulo likes coffee" at t1 + "Paulo dislikes coffee" at t2)? Last-write-wins, LLM-judged merge, manual-review queue, append-with-temporal-precedence? | techniques | Both projects (Mem0's `memory/main.py` + Letta's `services/archive_manager.py`) | grep `conflict|contradict|override|supersede|replace|update` in Mem0 `memory/main.py`; ast-grep `--lang python --pattern 'def $$$conflict$$$($$$): $$$'` on Letta `services/`; grep `merge|resolve` in both | Read each conflict-handling site; capture the algorithm (decision tree); capture test fixtures if any | Side-by-side decision-tree comparison: Mem0 strategy vs Letta strategy + 1 example trace per project + gaps in both that v0.7 must close |
| Q4 | How do both projects test the distillation pipeline? Gold sets (committed fixtures with labeled inputs+expected outputs)? Real-API calls? Mocked LLM? Property-based tests? What's the precision/recall threshold each uses (if any)? | tests | **EC-1 corrected paths:** `.claude/knowledge-base/references/mem0/tests/memory/` (verified — contains `test_main.py`, `test_memory_utils.py`, `test_storage.py`) + `.claude/knowledge-base/references/letta/tests/` (verified — contains `adapters/`, `conftest.py`, `configs/`; NOT `letta/letta/tests/` which doesn't exist) | Glob test files via `find .claude/knowledge-base/references/mem0/tests -name '*test*' -path '*memory*'` AND `find .claude/knowledge-base/references/letta/tests -name '*test*memory*' -o -name '*test*archival*' -o -name '*test*sleep*'`; ast-grep `--lang python --pattern '@pytest.fixture $$$' --pattern 'def $NAME($$$): $$$'` to enumerate fixtures | Read 3-5 test files per project; capture: LLM stub vs real-API, gold-set presence (look for `fixtures/` JSON + parametrize markers), threshold assertions | Per-project test taxonomy table: test file → LLM strategy → fixture type → assertion shape → path:line + verdict "MIRROR for v0.7?" |
| Q5 | What libs/models do they use for entity extraction? spaCy NER? LLM-only? Hybrid? What about embedding models for similarity-based dedup before extraction? Apply Inquebrável Rule 9 verdict per lib (ADOPT/REJECT/DEFER). | deps | Both projects — `pyproject.toml` + actual import sites | grep `from spacy` / `import spacy` / `from sentence_transformers` / `openai` / `langchain` in `mem0/memory/` + `letta/services/`; Read each pyproject.toml | Read each import site to confirm USAGE (not just listed dep); cross-check vs pyproject version pin | Table: lib name → ecosystem → usage site in their code → version pin → Rule 9 verdict for v0.7 (ADOPT with rationale / REJECT with alternatives / DEFER with revisit) |
| Q6 | What's the local-dev story for running the distillation pipeline against a real LLM? Docker? Just Python? Required env vars? Bootstrap commands? Time to first successful extraction call? | tools | Both projects — root `Makefile` + `README.md` + `docker-compose*.yml` + `pyproject.toml` scripts | SKIP Fase A — text-shape question. Glob: `Makefile`, `compose*.yaml`, `compose*.yml`, `README*.md`, `CONTRIBUTING.md`, `pyproject.toml [tool.poetry.scripts]` per project | Read each file; capture step-by-step "from clone to first extraction call" | Per-project dev-story checklist (clone → install → env → run → verify) + verdict "useful as v0.7 dev-story template?" |
| Q7 | What's the canonical academic shape of episodic→semantic distillation? Generative Agents (Park et al. 2023) "reflection" algorithm — how does it identify which observations to consolidate (top-N by importance score? clustering?), what's the prompt structure, and what's its provenance schema? CoALA (Sumers et al. 2023) framework — does it formalize this beyond Generative Agents? MemoryBank (Zhong et al. 2023) — what's their gold-set methodology that we should mirror for v0.7 acceptance criteria? | prior_art | Web — arxiv.org allowlisted domain | WebSearch query: `"Generative Agents" "reflection" Park 2023 arxiv` + `"CoALA" cognitive architecture language agents arxiv 2023` + `"MemoryBank" gold set evaluation memory arxiv 2023` (3 queries max per Stop condition D1) | WebFetch each canonical paper landing page (arxiv abs URL); extract the algorithm section + gold-set methodology section verbatim into snapshot per D4 | Algorithm summary per paper + verbatim quote of key reflection/distillation step + provenance schema if declared + URL + snapshot path |
| Q8 | What do Mem0, Zep, Cognee explicitly claim works for distillation in their PUBLIC docs/blogs, and what gaps do they admit? Look for: "two-stage extraction prompts" (Mem0), "graphiti temporal knowledge graph" (Zep — episode→entity→relation), "ontology-grounded extraction" (Cognee). Cross-reference what's claim vs evidence vs admitted gap. | prior_art | Web — blog.mem0.ai + www.letta.com + zep.ai + cognee.ai (must be in allowlist OR added with rationale) | WebSearch query: `Mem0 episodic semantic extraction blog` + `Zep Graphiti temporal knowledge graph distillation` + `Cognee ontology distillation` (3 queries) | WebFetch top 1-2 vendor URLs per project; extract claim + gap; snapshot per D4 | Per-vendor table: claim verbatim + URL + snapshot path + our differentiation pitch ("we improve on X because Y") |

## Coverage Matrix

Every Coverage Corner MUST have at least one Research Question mapped. Per D5: prior_art is NON-DEFERRABLE for this cycle.

| Corner | Questions mapped | Status |
|---|---|---|
| Integration tests | Q4 | Covered (1 question) |
| Dependencies | Q5 | Covered (1 question, Rule 9 verdict mandatory per D3) |
| Tools | Q6 | Covered (1 question) |
| Techniques | Q1, Q2, Q3 | Covered (3 questions — max-per-corner; the meat of the discovery) |
| Prior_art | Q7, Q8 | Covered (2 questions: academic + vendor) |

**Coverage: 5/5 corners covered (100%).** No DEFER-CORNER markers.

**Question budget:** 8 total questions (within 5-10 range ✓). Per-corner max ≤ 3 ✓. Per-corner min ≥ 1 ✓.

## Halt-loop checkpoints

For `/discover-execute`, intermediate state that MUST hold before a sub-task can be marked DONE. **3 SHOULD TEST checkpoints (EC-4/5/6) absorbed from edge-case review v1.1.**

| Checkpoint | Condition | Verification |
|---|---|---|
| Q1 (Mem0 pipeline) per-question DONE | Sequence diagram OR algorithm description + extraction prompt VERBATIM + ≥ 2 `.claude/knowledge-base/references/` path:line citations | grep blueprint for path patterns matching `.claude/knowledge-base/references/mem0/.*:\d+` |
| **EC-4 checkpoint (Q1 prompt fallback):** if Fase A grep `prompt\|extract` in `mem0/memory/utils.py` returns 0 hits → retry in `mem0/configs/`, `mem0/memory/prompts.py`, `mem0/prompts/`. Mem0 frequently extracts prompts to dedicated config module. Mark BLOCKED only after 3-retry exhaustion across all 4 candidate locations. | (after fallback) | grep `.claude/knowledge-base/references/mem0/{memory/utils.py,configs/,memory/prompts.py,prompts/}` for prompt-shape strings |
| Q2 (Letta sleep-time) per-question DONE | Evolution table populated; active vs abandoned versions identified; verbatim distillation prompt(s) captured | Check blueprint § Q2 table has ≥ 1 row per active version + clear ABANDONED marker on inactive versions |
| Q3 (conflict-resolution) per-question DONE | Side-by-side decision tree (Mem0 vs Letta) + 1 example trace per project | Check blueprint § Q3 has 2 sub-trees |
| **EC-5 checkpoint (Q3 Mem0 absent = positive finding):** if Fase A grep `conflict\|contradict\|override\|supersede\|merge\|resolve` in `mem0/memory/main.py` returns 0 hits after 3 retry variants → mark **"Mem0 has no explicit conflict-handling site — this is our differentiation pitch in v0.7"** as FINDING POSITIVO in blueprint § Q3 + Recommendations. NOT BLOCKED. The absence IS the evidence. | (after retry exhaustion) | grep blueprint § Q3 for "differentiation pitch" phrase + absence-as-evidence framing |
| Q4 (tests) DONE | Per-project test taxonomy table populated + verdict on each row whether to MIRROR | Check blueprint table has 2 sub-tables (mem0 + letta), each with ≥ 3 rows |
| Q5 (deps) DONE | Rule 9 verdict (ADOPT/REJECT/DEFER + rationale) for EACH lib identified, max 5/project | grep blueprint § dep table for the 3 verb tokens; missing verdict on any row = BLOCKER |
| **EC-6 checkpoint (Q5 Rule 9 budget cap):** max 5 libs investigated per project (10 total Mem0+Letta). For each lib beyond top-5, verdict default `DEFER (revisit at /to-plan v0-7-distillation-pipeline)` with rationale "discovery budget cap; full Rule 9 evaluation moves to plan-confidence cycle". Top-5 criterion: libs mentioned in pyproject.toml AND imported in ≥ 1 site of `memory/` or `services/`. | (when listing libs in Q5) | count blueprint § Q5 rows per project: ADOPT/REJECT rows ≤ 5, DEFER rows can be unlimited |
| Q6 (tools) DONE | Per-project dev-story checklist (clone → install → env → run → verify) | Check blueprint § tools has 2 checklists |
| Q7 (academic prior_art) DONE | Each of 3 papers has: algorithm summary + verbatim key quote + URL (arXiv abs URL only per EC-9, NOT pdf) + snapshot path | grep blueprint for snapshot path pattern + verify file exists at `.claude/knowledge-base/discoveries/snapshots/v0-7-episodic-semantic-distillation/{sha256}.md`; assert URLs match pattern `https://arxiv\.org/abs/[0-9]+\.[0-9]+` |
| Q8 (vendor prior_art) DONE | Per-vendor table populated with claim verbatim + URL + snapshot path + our differentiation pitch | Same as Q7 verification |
| Blueprint Cross-cutting comparison DONE | 5-column table (Mem0 vs Letta) populated for: pipeline shape, extraction LLM, conflict-resolution strategy, gold-set methodology, provenance schema | Read blueprint § Cross-cutting comparison; assert 5 columns present |
| Blueprint Recommendations section DONE | At least 1 concrete decision proposal per research question (8 minimum) | Count § Recommendations subsections; verify ≥ 8 |

## Edge-case absorption matrix (v1.1)

| # | Severity | Resolved by | Mechanism |
|---|---|---|---|
| EC-1 | MUST FIX | In-Scope table + Q4 path | Corrected `letta/letta/tests/` → `.claude/knowledge-base/references/letta/tests/` (verified via `ls`) |
| EC-2 | MUST FIX | Phase 0 pre-flight gate | Allowlist commit BEFORE `/discover-execute`: 6 entries (`aclanthology.org`, `martinfowler.com`, `blog.mem0.ai`, `www.letta.com`, `zep.ai`, `cognee.ai`) |
| EC-3 | MUST FIX | Q2 Fase A method replaced | `git log` → syntactic diff + active-importer grep (clones are `--depth 1`) |
| EC-4 | SHOULD TEST | Halt-loop checkpoint | Q1 prompt fallback search across `mem0/{configs,memory/prompts.py,prompts}/` before BLOCKED |
| EC-5 | SHOULD TEST | Halt-loop checkpoint | Q3 Mem0 absent conflict-resolution = FINDING POSITIVO (differentiation pitch), not BLOCKED |
| EC-6 | SHOULD TEST | Halt-loop checkpoint | Q5 Rule 9 cap at 5 libs/project (ADOPT/REJECT); beyond top-5 → DEFER default |
| EC-7 | DOCUMENT | ADR D4 expanded | Snapshot infra MANUAL — helpers not shipped; precedent of 4 prior cycles applies |
| EC-8 | DOCUMENT | Q2 pre-step | Grep active importers in `letta/` to filter abandoned versions |
| EC-9 | DOCUMENT | ADR D4 expanded | arXiv abs URL only; never PDF; fallback `ar5iv.labs.arxiv.org` already allowlisted |

**9 / 9 edge cases absorbed. Coverage: 100%.**

## Acceptance Criteria

The discovery is DONE when ALL of the following hold:

- [ ] **Phase 0 pre-flight (EC-2):** allowlist additions for 6 domains committed BEFORE `/discover-execute` runs; `grep` returns 6 matches
- [ ] Blueprint at `.claude/knowledge-base/discoveries/blueprints/v0-7-episodic-semantic-distillation-blueprint.md` exists
- [ ] All 8 research questions answered OR explicitly BLOCKED with reason
- [ ] Coverage Matrix 5/5 corners (no DEFER-CORNER markers)
- [ ] Every `.claude/knowledge-base/references/` citation verifies via `Path.exists()`
- [ ] Every URL citation has matching snapshot at `.claude/knowledge-base/discoveries/snapshots/v0-7-episodic-semantic-distillation/{sha256}.md`
- [ ] Every URL domain is in `.claude/rules/discover-web-allowlist.txt` (add inline with rationale if new)
- [ ] Each dep candidate in Q5 has Rule 9 verdict (ADOPT/REJECT/DEFER + rationale)
- [ ] Cross-cutting comparison table (5 columns, Mem0 vs Letta) populated
- [ ] Recommendations section: ≥ 1 concrete decision proposal per research question
- [ ] `## Blocked questions (if any)` section honest — no fabricated answers padding closed questions
- [ ] `/discover-confidence v0-7-episodic-semantic-distillation` verdict ≥ SHIPPABLE_WITH_CAVEATS (score ≥ 70)

## Global Definition of Done

Beyond Acceptance Criteria, the discovery cycle exits cleanly when:

- [ ] `/discover-edge-cases v0-7-episodic-semantic-distillation` returned PLAN OK (MUST FIX items absorbed into a v1.1 of THIS plan)
- [ ] `/discover-execute v0-7-episodic-semantic-distillation` emitted `<promise>BLUEPRINT_COMPLETE</promise>` honestly (NOT padded)
- [ ] `/discover-confidence v0-7-episodic-semantic-distillation` final verdict ≥ SHIPPABLE_WITH_CAVEATS per `.claude/rules/discover-blueprint-golden-rule.md`
- [ ] (Optional) `/skill-writer` candidate skill at `.claude/skills/generated/v0-7-distillation-patterns/` produced
- [ ] (Optional) `/skill-validator` PASS → `/skill-register` promotes to `.claude/skills/v0-7-distillation-patterns/`
- [ ] All artifacts committed to develop with conventional-commit format
- [ ] Token budget honored: cycle total ≤ 300k tokens (50k discover-plan + 30k edge-cases + 170-200k execute + 5k confidence + ~30k optional distillation tail)

## Cross-references

- Cycle rule (SoT): [`cycle-discover.md`](.claude/rules/cycle-discover.md) v1.1 — declares the 5-corner Coverage Matrix + prior_art mandates
- Golden rule: [`discover-blueprint-golden-rule.md`](.claude/rules/discover-blueprint-golden-rule.md) — the verdict bands
- Web allowlist: [`discover-web-allowlist.txt`](.claude/rules/discover-web-allowlist.txt) — domains permitted for citation (arxiv, etc.)
- Inquebrável Rule 9: `/home/paulo/.claude/CLAUDE.md § 9` — Não Reinvente (drives Q5 verdict matrix per D3)
- Token budget: [`token-budget.md`](.claude/rules/token-budget.md) § cycle-discover — 80-200k per execute run
- Roadmap source: [`/home/paulo/Projetos/usetheo/theo-memory/CLAUDE.md § Macro roadmap`](CLAUDE.md) Item 9 v0.7 — the gap this discovery serves
- Companion downstream: `/to-plan v0-7-distillation-pipeline` will consume this blueprint
- Reference projects: `.claude/knowledge-base/references/mem0/` (78MB) + `.claude/knowledge-base/references/letta/` (34MB) only. LangMem NOT cloned.

## Blocked questions

(filled by /discover-execute when budget/stop conditions force honest BLOCKED)
