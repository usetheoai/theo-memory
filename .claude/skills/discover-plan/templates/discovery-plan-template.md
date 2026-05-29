# Discovery Plan: {Title}

> **Version 1.0** — one-paragraph executive summary explaining what this discovery will investigate, which reference projects are in scope, and what blueprint output is expected.

**Slug:** `{kebab-case-slug}`
**Owner:** {name or handle}
**Created:** {YYYY-MM-DD}
**Time budget:** {total}h (per-project breakdown in ADR D1)

## Context

What motivates this discovery NOW, what evidence (e.g., a contract gap, a benchmark result from `docs/exploration-reports/`, a Roadmap question in `CLAUDE.md`) triggered it. Cite specific paths and ADRs from the project's own `.claude/rules/` or `CLAUDE.md` § Architectural Decisions Locked.

## Objective

One clear sentence: what should the produced blueprint enable us to decide? Then a short list of measurable success criteria for the blueprint:

- [ ] All research questions in this plan answered with citations to `.claude/knowledge-base/references/`
- [ ] Cross-cutting comparison table populated for every in-scope reference project
- [ ] Recommendations section provides at least one concrete decision proposal per in-scope research question
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `.claude/knowledge-base/references/mem0/` | e.g., `mem0-ts/src/memory/`, `mem0-ts/tests/` | Mem0-shape architecture is locked; we need the integration-test pattern |
| `.claude/knowledge-base/references/letta/` | e.g., `letta/services/`, `letta/orm/` | Pgvector schema reference |
| `.claude/knowledge-base/references/langmem/` | e.g., `langmem/procedural/` | Procedural memory pattern — out-of-scope for v0.1 contract, but useful for v0.4 |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| `.claude/knowledge-base/references/mem0/docs/` | Marketing docs, not source of truth |
| `.claude/knowledge-base/references/*/build/`, `dist/`, `.venv/` | Build artifacts |
| Any project NOT cloned into `.claude/knowledge-base/references/` | Cross-Project Rule: never claim a project feature without reading its source |

## ADRs

Decisions about HOW to investigate. Each gets:
- **ID** (D1, D2, ...) for cross-referencing in questions
- **Decision** — what was decided
- **Rationale** — why this approach (with alternatives considered)
- **Consequences** — what this enables and what it constrains

### D1 — Time budget + stop conditions

**Decision:** Mem0: Xh, Letta: Yh, LangMem: Zh.

**Rationale:** {evidence-based — e.g., Mem0 is the closest analog so deepest dive; LangMem is informational for v0.4 deferred work}.

**Alternatives considered:** equal split, single project deep-dive, no time budget.

**Stop condition — per question (mandatory):** When a question's Fase A returns empty matches after 3 consecutive retries with different query variants (e.g., pattern → kind-based → alternate path → broader scope), mark the question BLOCKED with reason "Fase A exhausted — no hotspots found" and continue to the next. Do NOT pad with unrelated hotspots from a different question's scope.

**Stop condition — per project (mandatory):** When a project's time budget is exhausted with N questions still pending, mark all remaining questions for that project as BLOCKED with reason "budget exhausted" and continue with the next project (or, if last, emit the promise with the honest blocked-questions report).

**Anti-pattern:** NEVER fabricate Fase B answers to close a question whose Fase A was exhausted. Honest BLOCKED with reason is required (Inquebrável Rule 3).

**Consequences:** the halt-loop will stop iterating on a project when its budget is exhausted, even if some questions remain blocked. The blueprint will surface blocked questions explicitly in the `## Blocked questions (if any)` section — they become next-discovery seed.

### D2 — Investigation depth

**Decision:** {e.g., Read each file end-to-end vs Grep for symbols only}.

**Rationale:** {with alternatives}.

**Consequences:** {trade-off explicit}.

## Research Questions

Numbered list. Each question maps to a Coverage Corner (tests / deps / tools / techniques). Each declares BOTH phases of the investigation upfront:

- **Fase A (broad, ast-grep)** — produces a hotspot map: where to look, how many, what AST kind. Mandatory for code-shape questions; skipped only for text-shape questions (READMEs, configs, raw file content).
- **Fase B (deep, Read)** — reads each hotspot from Fase A in detail, capturing intent + comments + edge-cases. Produces the prose + line-exact citation for the blueprint.

| # | Question | Corner | Reference project(s) | Fase A (broad — ast-grep map) | Fase B (deep — Read at each hotspot) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | How does Mem0 test the LLM-extraction pipeline against a real Postgres? | tests | `.claude/knowledge-base/references/mem0/mem0-ts/` | `ast-grep scan --rule rules/decorated-function-python.yml .claude/knowledge-base/references/mem0/` to list test fixtures; OR `ast-grep run --pattern 'describe($$$, ($$$) => { $$$ })' --lang typescript` for TS test blocks | Read each test fixture + its setup block; capture which Postgres / pgvector container is wired | Table: test name → fixture used → assertion type, with `.claude/knowledge-base/references/.../path:line` per row |
| Q2 | What pg-vector versions does Letta support? | deps | `.claude/knowledge-base/references/letta/` | `ast-grep run --pattern 'pgvector $$$' --lang python` OR Grep for `pgvector` in `pyproject.toml` / `requirements*.txt` (text-shape — Fase A may be skipped) | Read each match in context to capture version range + index type | Version range + supported index types + citations |
| Q3 | What's Mem0's local-dev story? Docker? Just Postgres? | tools | `.claude/knowledge-base/references/mem0/` | SKIP Fase A — text-shape question. Glob for `docker-compose*.yml`, `Makefile`, `README*.md` | Read each file fully | Step-by-step instructions + dependency list |
| Q4 | Does LangMem implement procedural memory as prompt-rewriting or as a structured memory class? | techniques | `.claude/knowledge-base/references/langmem/` | `ast-grep run --pattern 'class $NAME($$$): $$$' --lang python .claude/knowledge-base/references/langmem/src/langmem/prompts/` to list candidate classes | Read each candidate class to determine architecture pattern | Architecture description + class diagram + key citations |
| Q5 | Compare how Mem0 (TS) and Letta (Python) define the `add()` operation | techniques | `.claude/knowledge-base/references/mem0/`, `.claude/knowledge-base/references/letta/` | `ast-grep run -p 'async add($$$) { $$$ }' --lang typescript ref/mem0/` AND `ast-grep run -p 'def add($$$): $$$' --lang python ref/letta/` — TWO Fase A queries, one per language | Read both candidate methods side-by-side to compare signatures + bodies | Side-by-side table with TS and Python signatures + citations |

## Coverage Matrix

Every Coverage Corner MUST have at least one Research Question mapped to it. If a corner is empty, an ADR MUST justify deferral.

| Corner | Questions mapped | Status |
|---|---|---|
| Integration tests | Q1, Q5 | Covered |
| Dependencies | Q2 | Covered |
| Tools | Q3 | Covered |
| Techniques | Q4, Q5 | Covered |

**Coverage: X/Y corners covered (Z%)**

If `Z < 100%`, the discovery plan caps at `discover-confidence` INVALID (≤49). Either map a question to the missing corner OR add an ADR explicitly deferring it.

## Halt-loop Checkpoints

For `/discover-execute`: what intermediate state MUST hold before the loop can mark a question DONE.

| Checkpoint | Assertion | Action if fails |
|---|---|---|
| Before answering Qx | `.claude/knowledge-base/references/{project}/{path}` declared in Fase A exists | Mark Qx BLOCKED with reason "path not found", continue to next |
| Per-question Fase A budget | Fase A returned at least one hotspot OR 3 query-variant retries attempted | After 3 retries with empty results, mark Qx BLOCKED with reason "Fase A exhausted"; continue |
| After answering Qx | Blueprint section under Qx has at least one citation | Re-iterate Qx (1 retry max) |
| Mid-loop sanity | Total citations to `.claude/knowledge-base/references/` ≥ N / 200 words of blueprint prose | Add citations to under-cited paragraphs (1 retry max) |
| Per-project time budget | Project time budget not exhausted | When exhausted, mark all remaining Qx for that project BLOCKED with reason "budget exhausted"; advance to next project |
| Before promising complete | All 4 coverage corners have populated sections | Refuse promise, continue iterating |

## Acceptance Criteria

Observable conditions for "this discovery is done":

- [ ] All research questions answered OR explicitly marked BLOCKED with reason
- [ ] All four coverage corners have populated sections in the blueprint
- [ ] Every citation in the blueprint points to a real `.claude/knowledge-base/references/{...}` path
- [ ] At least one ADR section in the blueprint synthesizes decisions taken
- [ ] Time budget respected per project
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS
- [ ] Blueprint saved at `.claude/knowledge-base/discoveries/blueprints/{slug}-blueprint.md`

## Global Definition of Done

- [ ] All phases completed (plan → edge-cases → execute → confidence → improve if needed → confidence re-score)
- [ ] Final `/discover-confidence` verdict recorded in the blueprint header
- [ ] No fabricated citations
- [ ] Coverage Matrix 100% covered
- [ ] ADRs reference at least one principle from project rules (SOLID/DRY/KISS/YAGNI) or project rule file (architecture.md, testing.md, public-copy.md)
