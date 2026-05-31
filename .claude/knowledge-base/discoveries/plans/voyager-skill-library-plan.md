# Discovery Plan: Voyager-style skill library for TheMemory v0.6

> **Version 1.2** — Investigation into procedural memory as a reusable executable-skill library, the "Open Problem #2" from the TheMemory roadmap. Anchored in the canonical 4-type agent-memory taxonomy (working / episodic / semantic / procedural) established by Sumers et al. 2024 (CoALA, arXiv:2309.02427) — Voyager's skill library is the canonical exemplar of procedural memory cited across the literature. Targets are (a) Voyager paper + CoALA + 2 post-Voyager procedural-memory papers (ProcMEM + Mem^p) as external prior_art, (b) Mem0's `openclaw/` + `openclaw/skills/` directories where Mem0 ships skill packs locally (openclaw is Node — see ADR D5), (c) Letta's `tests/test_letta_agent_v2_skills.py` for the agent-skill cycle test pattern + `letta/groups/sleeptime_multi_agent_v4.py` cited only for deps (not tests). Output blueprint will enable the v0.6 contract decision: shape of `memory.skills(repoId)`, on-disk skill format, refinement-loop placement.
>
> **Change log:**
> - **v1.0 (2026-05-29):** initial draft. 7 questions, 4 ADRs, 5/5 corners covered.
> - **v1.1 (2026-05-29):** absorbed 3 MUST FIX + 4 SHOULD TEST + 1 DOCUMENT from `voyager-skill-library-edge-cases-2026-05-29.md`. EC-1 scoped Q2 Fase A to `mem0/openclaw/` (Mem0 has 15+ monorepo manifests — generic grep gathers out-of-scope). EC-2 fixed Q6 URLs: `pypi.org/project/mem0ai/` instead of `mem0` (likely package name — executor confirms via WebSearch first); dropped `docs.anthropic.com/.../skills` candidate (Claude Code skills live at non-allowlisted `docs.claude.com` AND are tangential to Memory product). EC-3 reframed Q1 to "agent skill cycles" matching the actual file contents — sleep-time is NOT what `test_letta_agent_v2_skills.py` tests. EC-4/5/6/7 added 4 halt-loop checkpoints (skill-as-directory, arXiv HTML fallback, Github API fallback, D4 ordering). EC-8 documented as ADR D5 (openclaw is Node — Mem0 deps come from `package.json`, not `pyproject.toml`).
> - **v1.2 (2026-05-29):** anchored procedural-memory framing in canonical literature (WebSearch verified 2026-05-29). Sumers et al. 2024 (CoALA, arXiv:2309.02427) introduced the 4-type taxonomy (working/episodic/semantic/procedural) for LLM agents and explicitly identified Voyager as the procedural-memory exemplar — without this anchor, our framing reads as project-internal premise instead of citation of established consensus. Q4 expanded from "Voyager iterative-prompting algorithm" to "Voyager iterative-prompting CONTEXTUALIZED in CoALA + 2 post-Voyager extensions (ProcMEM, Mem^p)" — same single question, broader source set. The "Memory for Autonomous LLM Agents" survey (arXiv:2603.07670) provides the empirical anchor "Voyager without skill library lost 15.3× tech-tree speed" justifying skill-library as core memory, not afterthought. ADR D2 (investigation depth) extended to cover the additional sources without budget increase: CoALA reading is targeted (only the procedural-memory subsection); ProcMEM/Mem^p are abstract-level surveys, not deep dives.

**Slug:** `voyager-skill-library`
**Owner:** paulohenriquevn
**Created:** 2026-05-29
**Time budget:** 9h (per-project breakdown in ADR D1)

## Context

The TheMemory roadmap (`CLAUDE.md` § Roadmap → Phase III item 8) declares v0.6 as **Open Problem #2** — Voyager-style procedural memory: "stores executable reusable code/playbooks indexed by retrieval; reflection refactors + dedups skills periodically (no one shipped this as infra)". The acceptance criterion is a TheoCode integration test producing ≥ 1 skill artifact in `memory.skills(repoId)`, subsequent runs retrieving + reusing the skill, plus a refactoring test consolidating 2 syntactically-different but semantically-equivalent skills into 1 with both source IDs in `derived_from`.

Three evidence anchors trigger this discovery NOW:

1. **Roadmap dependency** — v0.6 `Depends: Item 5 (v0.4a reflection)`. v0.4a shipped 2026-05-29 (PR #22 merged). The blocker is gone.
2. **No prior infra** — `find .claude/skills/*-patterns/` returns empty across the repo; `find .claude/knowledge-base/references/` contains only `letta/` + `mem0/` (NO `langmem/` — never cloned). So nothing in-tree can be borrowed as-is; this discovery must lift patterns from external prior_art + cross-pollinate with Mem0/Letta sub-systems.
3. **Reflection pipeline already exists in TheMemory** — v0.4a shipped `ReflectionPolicy` DIP, `executeReflection()` LLM call, `validateProvenance()`, `Memory.reflect()` + `flushReflections()`. v0.6 needs to decide whether skill consolidation reuses this same pipeline OR ships a sibling.

Project rules consumed:
- `architecture.md` — DIP boundaries any borrowed pattern must respect (skills layer ≠ vector store layer)
- `testing.md` — TDD pyramid expectations for the refinement-loop tests
- `cycle-discover.md` v1.1 — 5-corner Coverage Matrix including `prior_art` (Voyager paper + GitHub repo)
- `discover-web-allowlist.txt` — domains permitted for WebSearch/WebFetch citation (`arxiv.org`, `github.com`, `mem0.ai`, `letta.com`, `langchain.com` cover the candidate sources)

## Objective

> **One sentence:** Produce a blueprint that lets us decide the shape of TheMemory's `memory.skills(repoId)` API + on-disk format + refinement-loop placement, with concrete recommendations grounded in (a) the Voyager paper's iterative-prompting algorithm, (b) Mem0's existing skill-pack layout, and (c) Letta's sleep-time agent refinement pattern.

Measurable success criteria:

- [ ] All 7 research questions answered with citations to `.claude/knowledge-base/references/` (Mem0 + Letta) OR to allowlisted URLs (Voyager paper + repo + LangMem) with snapshots under `.claude/knowledge-base/discoveries/snapshots/voyager-skill-library/`
- [ ] Cross-cutting comparison table populated for Voyager (paper) vs Mem0 openclaw skills vs Letta sleep-time vs LangMem procedural — feature parity matrix
- [ ] Recommendations section provides ≥ 1 concrete decision proposal per question (e.g., "adopt Mem0's `SKILL.md` frontmatter shape because X" or "reject Voyager's RL loop because YAGNI for code-agent context")
- [ ] At least one Rule 9 verdict (ADOPT / REJECT / DEFER) per dependency-candidate library surfaced in Q6
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (per reference project + external prior_art)

| Source | In-scope paths / domains | Reason |
|---|---|---|
| `.claude/knowledge-base/references/mem0/` | `openclaw/` (Node — `package.json`, `skills/memory-dream/`, `skills/memory-triage/`, both confirmed 2026-05-29 to be directories with `SKILL.md` + auxiliary files like `domains/` + `recall-protocol.md`). NOTE: out-of-scope `mem0-plugin/skills/`, `skills/README.md`, `skills/mem0/` deferred to next discovery (v0.6.x follow-up) — keeps Q2/Q3 scope tractable per EC-1. | Mem0 ships skill packs as the closest in-tree analog to a skill library — format + layout + retrieval shape (Node ecosystem per ADR D5) |
| `.claude/knowledge-base/references/letta/` | `letta/groups/sleeptime_multi_agent_v4.py`, `letta/services/memory_repo/`, `tests/test_letta_agent_v2_skills.py` | Letta's sleep-time multi-agent pattern for skill refinement + the skills test layout |
| External — `arxiv.org` | `https://arxiv.org/abs/2305.16291` (Voyager — Wang et al. 2023) + **`https://arxiv.org/abs/2309.02427` (CoALA — Sumers et al. 2024, canonical 4-type taxonomy)** + `https://arxiv.org/abs/2602.01869` (ProcMEM, 2026 — RL extension of procedural memory) + `https://arxiv.org/abs/2508.06433` (Mem^p, 2025 — exploring agent procedural memory) + `https://arxiv.org/abs/2603.07670` (Memory for Autonomous LLM Agents — 2026 survey, empirical anchor "15.3× without skill library") | v1.2: anchored procedural-memory framing in canonical literature. CoALA is THE source of the working/episodic/semantic/procedural taxonomy applied to LLM agents and explicitly cites Voyager as procedural-memory exemplar. ProcMEM + Mem^p are post-Voyager extensions. Survey provides empirical justification + state of field as of 2026. |
| External — `github.com` | `https://github.com/MineDojo/Voyager` (reference impl) + `https://github.com/langchain-ai/langmem` (LangMem since not cloned in references/) | Concrete on-disk skill shape; LangMem's procedural-memory API |
| External — `langchain.com` | LangChain procedural-memory blog/docs (URL TBD; discover-execute resolves via WebSearch) | LangMem positioning + API anchors |

### Out-of-Scope (explicit)

| Path / Domain | Why excluded |
|---|---|
| `.claude/knowledge-base/references/mem0/docs/` | Marketing copy, not source of truth |
| `.claude/knowledge-base/references/mem0/embedchain/` | Sibling product not relevant to skill-library shape |
| `.claude/knowledge-base/references/letta/letta/groups/sleeptime_multi_agent.py` + `v1` + `v2` + `v3` | Only latest `v4` in scope — earlier versions documented as superseded in the file's own header |
| `references/langmem` (the conceptually-expected clone directory) | NOT CLONED — that directory does not exist in this repo; LangMem accessed via `github.com/langchain-ai/langmem` instead (prior_art corner) |
| Minecraft-specific code in Voyager repo (`voyager/agents/`, `voyager/control_primitives/`) | Voyager's gameplay control is irrelevant; only the skill-library algorithm + on-disk shape are in scope |
| Reflexion (arXiv 2303.11366), Generative Agents (2304.03442), MemGPT (2310.08560) | Tangential to procedural-memory shape — referenced in TheMemory blueprints elsewhere; not re-investigated here |

## ADRs

### D1 — Time budget + stop conditions

**Decision:** Mem0: 3h, Letta: 2h, prior_art (WebSearch + WebFetch + snapshots): 4h. Total 9h.

**Rationale:** Mem0's `openclaw/skills/` + `mem0-plugin/skills/` directories are the deepest in-tree match for our target API — deserve the most time. Letta's sleep-time pattern is well-documented in CLAUDE.md `## Roadmap` already (v0.4a citation), so surface-level confirmation suffices. The bulk of the unknown is external: Voyager paper algorithm + canonical implementation shape + LangMem's procedural-memory contract — 4h dedicated to WebSearch + snapshot + cross-reference is the meat.

**Alternatives considered:** equal split (3h each) — rejected because Letta is over-budgeted; Mem0-only deep-dive — rejected because Voyager's curriculum-learning + skill-refinement algorithm is the novel core. Per Inquebrável Rule 9, evaluating LangMem as a dependency candidate (ADOPT/REJECT/DEFER) requires real understanding of its API, not training-data recall.

**Stop condition — per question (mandatory):** When a question's Fase A returns empty matches after 3 consecutive retries with different query variants (e.g., `ast-grep` pattern → grep with kind filter → broader regex → directory glob), mark the question BLOCKED with reason "Fase A exhausted — no hotspots found" and continue. Do NOT pad with unrelated hotspots from a different question's scope.

**Stop condition — per project (mandatory):** When a project's time budget is exhausted with N questions pending, mark all remaining questions for that project BLOCKED with reason "budget exhausted" and continue with the next source.

**Stop condition — prior_art web budget:** Max 15 WebSearch + 25 WebFetch per cycle (lower than cycle-discover.md v1.1 default of 20+30 because scope is one paper + 3 vendor sources). When exhausted, mark remaining prior_art questions BLOCKED with reason "web budget exhausted".

**Anti-pattern:** NEVER fabricate Fase B answers to close a question whose Fase A was exhausted. NEVER cite a URL whose snapshot does not exist (cycle-discover.md v1.1 hard gate #6). Honest BLOCKED with reason is required (Inquebrável Rule 3).

**Consequences:** halt-loop will surface blocked questions explicitly in `## Blocked questions` of the blueprint; they become next-discovery seed.

### D2 — Investigation depth

**Decision:** Deep on (a) Voyager's skill-refinement algorithm (paper + canonical impl `voyager/agents/skill_manager.py` or equivalent), (b) Mem0's `SKILL.md` frontmatter + on-disk layout. Surface-level on Letta's `sleeptime_multi_agent_v4.py` (we already understand the pattern from v0.4a blueprint). **(v1.2 amendment for Q4 expanded sources):** CoALA reading is targeted — ONLY the procedural-memory subsection (typically §3 or §4 of the paper). ProcMEM is depth-2: read abstract + algorithm section, skip experimental detail. Mem^p + the survey "Memory for Autonomous LLM Agents" are abstract-level only — we want the framing + the empirical claim, not the full survey landscape. Total v1.2 added pages-to-read: ~12-15 (CoALA section ~3p + ProcMEM ~3-4p + Mem^p abstract ~1p + survey relevant subsection ~2-3p) — fits within the 4h prior_art budget without expansion.

**Rationale:** The novel content is in the prior_art corner. Mem0's skill packs are the most concrete in-tree shape to evaluate Rule 9 against — must be read end-to-end. Letta's sleep-time is a confirm-shape check, not a borrow.

**Alternatives considered:** uniform deep-dive — rejected (budget violation, low ROI on Letta); uniform surface-level — rejected (the paper's algorithm requires careful reading to extract the iterative-prompting loop). Per `architecture.md` DIP boundary rule, skill-layer borrowings must respect the existing 5 DIPs (ScoringStrategy + VectorStore + LLM + Embedder + HistoryManager + ReflectionPolicy) — surface-level fit-check is cheap, deep-dive is wasted if the borrowing turns out to violate DIP.

**Consequences:** the blueprint's Letta section is shorter than Mem0's section. Acceptable — Letta confirms the sleep-time multi-agent pattern is documented; we cite + move on.

### D3 — LangMem accessed via GitHub repo (not via `references/langmem/`)

**Decision:** LangMem is investigated via `https://github.com/langchain-ai/langmem` as a prior_art corner URL. The conceptual clone path `references/langmem` does not exist as a directory in this repo — verified by `ls .claude/knowledge-base/references/` on 2026-05-29 returning only `letta` + `mem0` + `.gitkeep`.

**Rationale:** Cloning LangMem mid-discovery would violate the read-only invariant of `references/`. The GitHub repo is publicly accessible + on the allowlist (`github.com` is allowlisted per `discover-web-allowlist.txt`). WebFetch + snapshot of LangMem's README + the `procedural` or `skills` subdirectory listing is sufficient evidence to evaluate Rule 9.

**Consequences:** the `prior_art` corner carries more weight than usual (3 of 7 questions involve it). Snapshot discipline becomes load-bearing — every cited URL MUST have a corresponding `snapshots/voyager-skill-library/{sha256}.md` file (cycle-discover.md v1.1 hard gate #6).

### D4 — Stop condition for the refinement-loop debate

**Decision:** Q5 (Mem0 memory-dream consolidation pattern) is the deciding question for "do we reuse v0.4a `Memory.reflect()` pipeline OR ship a sibling for skills". If memory-dream uses a pattern compatible with our `executeReflection() + validateProvenance() + insertDerivedMemory()` chain, REUSE; otherwise, sibling.

**Rationale:** Avoids re-litigating the architecture decision in v0.6 implementation. The decision rule is observable from the discovery output.

**Consequences:** the blueprint MUST state the reuse-vs-sibling verdict explicitly in its recommendations section. Implementation plan in `/to-plan voyager-skill-library` consumes this verdict.

### D5 — Skill lib é Node-first; cross-ecosystem deps são paridade conceitual (v1.1 EC-8)

**Decision:** TheMemory v0.6 `memory.skills(repoId)` será TypeScript-first em `@usetheo/memory`. Mem0 `openclaw/` (Node ecosystem — `package.json`) é o anchor de adoção para shape de pacotes + tooling. Letta deps (`pyproject.toml`, Python) + Voyager deps (Python) são citados como paridade conceitual, NÃO como candidatos a portar.

**Rationale:** Verificação 2026-05-29 mostrou que `mem0/openclaw/package.json` é Node, NÃO Python. Q2 agrega deps cross-ecosystem; sem este ADR, o blueprint produziria um veredict Rule 9 confuso ("ADOPT este pacote Python pra um lib Node"). Sumarizar antecipadamente quem é o anchor + quem é referência evita esse risco. Honra `architecture.md` DIP rules (skill-layer adapters seguem o language do core, não dos exemplos).

**Alternatives considered:** restringir Q2 só ao Node (rejeitado — perderia o sinal Python sobre sandboxed exec); ADR fora do plano (rejeitado — deve ser load-bearing no blueprint Q2 + Q6).

**Consequences:** o blueprint Q2 categoriza cada dep encontrado como ANCHOR (Mem0 Node) ou PARIDADE (Letta/Voyager Python). Q6 Rule 9 verdicts ADOPT/REJECT/DEFER aplicam-se SÓ aos candidates Node (Mem0 published lib, raw Voyager skill-library JS port se existir). Candidates Python recebem CONCEPTUAL_BORROW (novo tier, não-blocking).

## Research Questions

| # | Question | Corner | Reference / source | Fase A (broad — ast-grep / grep / glob) | Fase B (deep — Read at each hotspot) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | How does `test_letta_agent_v2_skills.py` test agent skill cycles (write → recall → reuse)? Capture fixture shape, mock LLM strategy, assertion topology. (v1.1 EC-3: reframed — file does NOT test sleep-time multi-agent cycles; tests `LettaAgentV2` + `ClientSkillSchema`. See `letta/agents/letta_agent_v2.py` imports.) | tests | `.claude/knowledge-base/references/letta/tests/test_letta_agent_v2_skills.py` | SKIP Fase A — single file (text-shape) | Read the file end-to-end; capture fixture shape, mock LLM strategy, assertion topology | Table: test name → fixture used → mocked vs real LLM → assertion type, with line-exact citations |
| Q2 | What runtime + dev dependencies do Mem0 openclaw + Letta + Voyager canonical impl pull in relevant to executable-skill storage + sandboxed execution? (See ADR D5 — cross-ecosystem: Mem0 openclaw is Node, Letta is Python, Voyager is Python.) | deps | Mem0 `openclaw/package.json` (Node) + any `openclaw/skills/*/package.json`; Letta `pyproject.toml`; GitHub `MineDojo/Voyager` any-of `requirements.txt`/`setup.py`/`pyproject.toml` | (v1.1 EC-1: scoped) Read `.claude/knowledge-base/references/mem0/openclaw/package.json` directly + `find mem0/openclaw/skills -name package.json` for sub-skills; Read `.claude/knowledge-base/references/letta/pyproject.toml`; WebFetch `https://github.com/MineDojo/Voyager` raw manifest URLs in priority order (requirements.txt → setup.py → pyproject.toml; first hit wins) | Read each match in context to capture version range + purpose | 3-column table: source → declared deps relevant to skill exec → version range. Rule 9 evaluation per dep (per ADR D5: Mem0 Node deps are the borrow anchor; Voyager+Letta are conceptual paridade) |
| Q3 | What's the on-disk skill format in Mem0 openclaw skills vs Voyager skill library vs LangMem? (file shape, frontmatter, indexing format) | tools | Mem0 `openclaw/skills/memory-dream/SKILL.md`, `openclaw/skills/memory-triage/`, `mem0-plugin/skills/`, `skills/README.md`; GitHub `MineDojo/Voyager/voyager/`; GitHub `langchain-ai/langmem` | Glob `**/SKILL.md`, `**/skill.json`, `**/index.json` under Mem0 skill paths; WebFetch Voyager + LangMem repo tree | Read each file fully (Mem0) + snapshot the GitHub directory listings (Voyager + LangMem) | Side-by-side schema comparison: frontmatter fields + body shape + retrieval index format. Three-row table at minimum. |
| Q4 | What is Voyager's iterative-prompting + skill-refinement loop in algorithmic detail (critic feedback → refactor → dedup), CONTEXTUALIZED in the canonical CoALA 4-type taxonomy (Sumers et al. 2024) and the 2 post-Voyager procedural-memory extensions (ProcMEM, Mem^p)? (v1.2 expansion — anchor the framing in established literature, not project-internal premise.) | techniques | `https://arxiv.org/abs/2305.16291` (Voyager); `https://arxiv.org/abs/2309.02427` (CoALA — procedural-memory subsection only); `https://arxiv.org/abs/2602.01869` (ProcMEM abstract + algorithm section); `https://arxiv.org/abs/2508.06433` (Mem^p abstract); `https://arxiv.org/abs/2603.07670` (Memory for Autonomous LLM Agents survey — Voyager 15.3× empirical anchor) | WebSearch `Voyager Wang 2023 iterative skill refinement algorithm`; WebFetch each arXiv abs page (5 total); for Voyager + ProcMEM target the algorithm sections; for CoALA target the procedural-memory subsection; for Mem^p + survey target the abstract only | Snapshot each arXiv abs (5 snapshots); extract Voyager algorithm in pseudocode; extract CoALA's procedural-memory definition verbatim; capture ProcMEM's RL extension shape + Mem^p's framing | (a) Voyager algorithm pseudocode + state diagram + key citation page numbers. (b) CoALA-verbatim quote anchoring "skill library = procedural memory". (c) Two-row table of post-Voyager extensions: ProcMEM (RL) and Mem^p (theoretical) — what each adds vs Voyager baseline. (d) The "15.3×" empirical claim cited from the survey. |
| Q5 | How does `mem0/openclaw/skills/memory-dream/SKILL.md` implement sleep-time consolidation — is the pattern compatible with TheMemory's v0.4a `Memory.reflect()` chain (executeReflection + validateProvenance + insertDerivedMemory)? | techniques | `.claude/knowledge-base/references/mem0/openclaw/skills/memory-dream/SKILL.md`, plus `mem0/openclaw/skills/memory-triage/` for the sibling pattern | SKIP Fase A for the SKILL.md (single file); use `grep -r "memory-dream\|memory_dream" .claude/knowledge-base/references/mem0/openclaw/` to find consumer call-sites | Read SKILL.md + each consumer call-site | Decision tree: REUSE v0.4a chain (with rationale) OR ship sibling (with rationale). Decides D4 stop condition. |
| Q6 | Rule 9 dependency evaluation — for each candidate skill-library library (Voyager canonical impl, LangMem procedural, Mem0 published lib if any) — produce ADOPT / REJECT / DEFER verdict with rationale. | prior_art | `https://github.com/MineDojo/Voyager`, `https://github.com/langchain-ai/langmem`, `https://pypi.org/project/mem0ai/` (v1.1 EC-2: corrected package name from `mem0` — executor WebSearches `npm/pypi mem0 official package name 2026` FIRST to confirm before WebFetch; if name differs, update the URL in the snapshot index) | WebSearch each candidate; WebFetch package metadata + README; check last release date + license + maintenance signal | Snapshot each candidate's primary metadata page; extract version, license, last release, dep count, maintenance status | One row per candidate: name → version → license → last-release → maintenance signal → ADOPT/REJECT/DEFER verdict → rationale citing canonical source. (v1.1 EC-2: dropped `docs.anthropic.com/.../skills` candidate — Claude Code skills live at non-allowlisted `docs.claude.com` and are tangential to Memory product surface.) |
| Q7 | Are there public skill-library benchmark datasets we can use for the v0.6 acceptance test? (Voyager paper benchmarks Minecraft coverage — is there a code-agent equivalent: SWE-bench skill reuse, HumanEval-Pro, or similar?) | prior_art | `arxiv.org` + `github.com` searches | WebSearch `code agent skill library benchmark 2024 2025`, `Voyager skill reuse evaluation code generation` | Snapshot top 3 candidate benchmark papers + repos; extract dataset shape + reuse-metric definition | List of candidate benchmarks: name → citation URL → dataset shape → reuse metric → fit for v0.6 acceptance (Y/N + rationale) |

## Coverage Matrix

Every Coverage Corner MUST have at least one Research Question mapped to it (per cycle-discover.md v1.1 — 5 corners).

| Corner | Questions mapped | Status |
|---|---|---|
| Integration tests | Q1 | Covered |
| Dependencies | Q2 | Covered |
| Tools (on-disk format / indexing) | Q3 | Covered |
| Techniques | Q4, Q5 | Covered |
| Prior art (paper + external repos + Rule 9) | Q6, Q7 | Covered |

**Coverage: 5/5 corners covered (100%)**

## Halt-loop Checkpoints

For `/discover-execute`: what intermediate state MUST hold before the loop can mark a question DONE.

| Checkpoint | Assertion | Action if fails |
|---|---|---|
| Before answering Qx (local) | Any path declared in Fase A under `references/<project>/<subpath>` exists via `Path.exists()` | Mark Qx BLOCKED with reason "path not found", continue |
| Before answering Qx (web) | URL domain is in `.claude/rules/discover-web-allowlist.txt` | If not, refuse the citation. Either add domain to allowlist (with rationale) OR drop the question. Cycle-discover.md v1.1 hard gate #5. |
| After WebFetch | Snapshot written to `.claude/knowledge-base/discoveries/snapshots/voyager-skill-library/{sha256}.md` where `sha256` = `SHA256({url}\n---\n{fetched-content})` | Refuse citation. Cycle-discover.md v1.1 hard gate #6. |
| Per-question Fase A budget | Fase A returned ≥ 1 hotspot OR 3 query-variant retries attempted | After 3 retries empty, mark Qx BLOCKED with reason "Fase A exhausted"; continue |
| After answering Qx | Blueprint section under Qx has ≥ 1 citation (local path OR snapshot URL) | Re-iterate Qx (1 retry max) |
| Mid-loop sanity (citation density) | Total citations ≥ 1 per 200 words of blueprint prose | Add citations to under-cited paragraphs (1 retry max). Soft gate per cycle-discover.md v1.1. |
| Per-project time budget | Project's allocated hours not exhausted | When exhausted, mark all remaining Qx for that project/source BLOCKED with reason "budget exhausted"; advance |
| Web budget (combined) | Max 15 WebSearch + 25 WebFetch per cycle | When hit, mark remaining prior_art Qx BLOCKED with reason "web budget exhausted" |
| Q6 Rule 9 specificity | Every dependency-candidate row carries ADOPT / REJECT / DEFER + rationale (per ADR D5, Python candidates may carry CONCEPTUAL_BORROW instead) | Re-iterate Q6 row by row (1 retry max). Missing verdict caps confidence at 49 per cycle-discover.md v1.1 hard gate #7. |
| (v1.1 EC-4) Q3 Mem0 skill is directory, not single file | Each Mem0 skill cited captures its full directory tree (e.g., `memory-dream/` has `SKILL.md` + `domains/` + `recall-protocol.md` — confirmed 2026-05-29), not just frontmatter of `SKILL.md` | Re-iterate Q3 row (1 retry max) capturing `ls` output per skill |
| (v1.1 EC-5) Q4 arXiv PDF WebFetch may miss algorithm section | If WebFetch of `https://arxiv.org/pdf/2305.16291.pdf` returns content without literal `Algorithm 1` or `skill library` substring, retry against `https://ar5iv.labs.arxiv.org/html/2305.16291` BEFORE marking BLOCKED. NOTE: `ar5iv.labs.arxiv.org` is NOT yet on the allowlist — adding it requires an inline rationale line in `.claude/rules/discover-web-allowlist.txt` (`added for voyager-skill-library Q4 at 2026-05-29 — arXiv HTML rendering fallback when PDF chunking misses algorithmic content`); execute step before retry. | Mark Q4 BLOCKED with reason "PDF chunking + HTML fallback both failed" if both also empty |
| (v1.1 EC-6) Q3 + Q6 Github HTML tree does not parse cleanly | Prefer Github API URL `https://api.github.com/repos/{org}/{repo}/contents/{path}` (JSON) over `https://github.com/{org}/{repo}/tree/{branch}/{path}` (HTML). NOTE: `api.github.com` is NOT yet on the allowlist — adding it requires an inline rationale line (`added for voyager-skill-library Q3+Q6 at 2026-05-29 — structured repo listings via Github API; HTML tree pages do not WebFetch cleanly`). | Mark question BLOCKED with reason "Github API + HTML both unavailable" if both fail |
| (v1.1 EC-7) D4 stop condition exige Q5 antes da seção Recommendations | Before emitting `<promise>BLUEPRINT_COMPLETE</promise>`, validate that blueprint section `## Recommendations` cites Q5 + states the REUSE-vs-sibling verdict explicitly (per D4). If Q5 is BLOCKED, D4 is recorded as UNRESOLVED with reason in the recommendations section instead of silently omitted. | Re-iterate Q5 first (1 retry max); if still BLOCKED, write the UNRESOLVED row in `## Recommendations` then promise |
| Before promising complete | All 5 coverage corners have populated sections | Refuse promise, continue iterating |

## Acceptance Criteria

Observable conditions for "this discovery is done":

- [ ] All 7 research questions answered OR explicitly marked BLOCKED with reason
- [ ] All 5 coverage corners have populated sections in the blueprint
- [ ] Every blueprint citation under `references/<project>/<subpath>` resolves via `Path.exists()` — zero fabricated paths (cycle-discover.md v1.1 hard gate #4)
- [ ] Every cited URL is from an allowlisted domain AND has a corresponding snapshot file (cycle-discover.md v1.1 hard gates #5, #6)
- [ ] Q6 every dependency-candidate row has ADOPT / REJECT / DEFER verdict with rationale (hard gate #7)
- [ ] At least one ADR section in the blueprint synthesizes decisions taken (e.g., "REUSE v0.4a Memory.reflect() chain for skill consolidation" with rationale + Mem0 memory-dream citation)
- [ ] Time budget respected: 9h total, 3h Mem0 / 2h Letta / 4h prior_art
- [ ] D4 stop condition resolved: blueprint states REUSE-vs-sibling verdict explicitly
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS
- [ ] Blueprint saved at `.claude/knowledge-base/discoveries/blueprints/voyager-skill-library-blueprint.md`
- [ ] Snapshots committed under `.claude/knowledge-base/discoveries/snapshots/voyager-skill-library/`

## Global Definition of Done

- [ ] All phases completed (plan → edge-cases → execute → confidence → improve if needed → confidence re-score)
- [ ] Final `/discover-confidence` verdict recorded in the blueprint header
- [ ] No fabricated citations (local paths AND URLs)
- [ ] Coverage Matrix 100% covered (5/5 corners)
- [ ] ADRs reference at least one principle from project rules (`architecture.md` DIP, `testing.md` TDD pyramid, Inquebrável Rule 9 Não Reinvente)
- [ ] D3 invariant honored: zero citations to a `langmem` directory under `references/` (does not exist)
- [ ] D4 stop condition resolved with explicit reuse-vs-sibling verdict
