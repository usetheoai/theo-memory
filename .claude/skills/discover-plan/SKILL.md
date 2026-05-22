---
name: discover-plan
description: Turn the current context + the referencia/ clones into a discovery plan saved at .claude/knowledge-base/discoveries/plans/{slug}-plan.md. Use when you want to plan a deep-research investigation into Mem0 / Letta / LangMem before producing a blueprint.
user-invocable: true
allowed-tools: Read Glob Grep Bash Write
argument-hint: "{topic-slug}"
---

# Discover-Plan — Plan a Deep-Research Investigation

Generates a structured **discovery plan** for investigating the reference implementations under `referencia/` (Mem0, Letta, LangMem). The output is the input for `/discover-execute`.

Sibling of `/to-plan` — same backbone, different output. `to-plan` produces implementation plans; `discover-plan` produces research plans whose deliverable is a **technical blueprint** (`docs/exploration-reports/mem0-ts.md` is the reference shape).

## When to Trigger

User explicitly invokes `/discover-plan {topic-slug}` when they want to:

- Investigate how a reference project solves a specific problem (e.g., dedup, retrieval, reflection).
- Compile a side-by-side blueprint across Mem0 / Letta / LangMem.
- Audit integration tests / dependencies / tools in `referencia/` before locking a TheMemory decision.

## Cycle contract

This skill is **phase 1** of [`cycle-discover`](../../rules/cycle-discover.md). The cycle rule is the **source of truth** for:

- Chain order (this skill → `/discover-edge-cases` → `/discover-execute` → `/discover-confidence` → optional `/discover-improve` → skill-distillation tail `/skill-writer` → `/skill-validator` → `/skill-register`)
- Hard gates, soft gates, stop conditions
- Anti-patterns at the cycle level
- Rollback procedures
- Cross-references to companion cycles (`cycle-plan.md`)

**Read `cycle-discover.md` before invoking this skill.** This SKILL.md retains only phase-specific detail (the protocol below for generating the discovery plan).

## Process

### Step 0 — Read project rules (MANDATORY)

Before exploring `referencia/`, internalize the project rules:

```bash
ls .claude/rules/
```

Read each `.md` file. The discovery plan SHALL cite at least one project rule (e.g., `architecture.md` for DIP boundaries that any borrowed pattern must respect, `testing.md` for test pyramid expectations that any borrowed test technique must align with).

### Step 1 — Inventory what is already known

Read in order:

1. `docs/agentic-memory-landscape.md` — the foundation survey
2. `docs/exploration-reports/*.md` — prior reports (the canonical example is `mem0-ts.md`)
3. `CLAUDE.md § Architectural Decisions Locked` — what is already locked
4. The `referencia/{mem0,letta,langmem}/` top-level structure (`ls`, `tree -L 2`)

Identify what is **already documented** vs **still open**. The discovery plan exists to close the open gaps, NOT to re-document what is already covered.

### Step 2 — Define the investigation targets

For each reference project in scope, declare:

- **Project**: `referencia/mem0/`, `referencia/letta/`, `referencia/langmem/`
- **In scope**: subdirectories the investigation will touch (e.g., `mem0-ts/src/memory/`, `letta/letta/services/`)
- **Out of scope**: subdirectories explicitly excluded (e.g., `mem0/docs/`, build artifacts)

Out-of-scope MUST be explicit. Vague "everything else" violates Coverage Matrix completeness.

### Step 3 — Define the four-corner research coverage (MANDATORY — explicit decision step)

This is its own decision step, NOT a check that happens at the end. Pause here and declare the four-corner coverage BEFORE drafting Research Questions in Step 4.

Every discovery plan MUST cover the four corners or explicitly justify deferral with an ADR:

| Corner | What to find | Example questions |
|---|---|---|
| **Integration tests** | How does each ref project test the boundary the blueprint targets? | "How does Mem0 test the LLM-extraction pipeline against a real Postgres?" |
| **Dependencies** | What runtime + dev deps do they pull in? Versions? Justifications? | "Does Letta depend on `psycopg` or `asyncpg`? Which version of pgvector?" |
| **Tools** | Build/test/lint tooling. CI shape. Local dev story. | "Does Mem0 ship docker-compose for dev? What's the test command?" |
| **Techniques** | The algorithm / pattern / data structure being borrowed. | "How does Letta implement archival memory eviction?" |

#### Question budget (mandatory)

- **Total: 5-10 questions across all corners.** Below 5 → blueprint will be thin; above 10 → halt-loop will likely exhaust budget. Sweet spot 6-8.
- **Max 3 questions per corner.** If you find yourself wanting a 4th in one corner, fold two into one OR move to a follow-up discovery plan (next slug).
- **Min 1 question per corner.** If a corner has zero, you MUST add an ADR justifying the deferral (e.g., D-skip-tools because Letta's tooling already documented in `letta/README.md` and not load-bearing for `src/local/`).
- **Each question maps to exactly one corner.** Questions that legitimately span corners (e.g., "compare test discipline AND dependency profile") should be split.

#### Pre-validate cited paths (mandatory)

Before adding a `referencia/{project}/{path}` to ANY question's Fase A or Fase B column, verify the path exists. The `discover-confidence` hard cap on fabricated citations will fire if even one fake path slips through.

The Coverage Matrix in the discovery plan MUST map each question to a method (read which file, grep which symbol, run which command) and a target answer format.

### Step 4 — Write the discovery plan

Use the template at `.claude/skills/discover-plan/templates/discovery-plan-template.md`. Save to:

```
.claude/knowledge-base/discoveries/plans/{slug}-plan.md
```

Where `{slug}` is kebab-case derived from the topic. Examples: `mem0-dedup-pipeline`, `letta-pgvector-schema`, `langmem-procedural-memory`.

## Plan Template Outline

The full template is in `templates/discovery-plan-template.md`. Required sections:

1. **Header** — version, slug, owner, dates.
2. **Context** — what motivates this discovery NOW, what evidence triggered it.
3. **Objective** — one sentence + measurable success criteria for the resulting blueprint.
4. **In-scope / Out-of-scope** — by reference project + by subdirectory.
5. **ADRs** — decisions about HOW to investigate (depth, time-budget, what to skip).
6. **Research questions** — numbered list. Each question → coverage corner (tests/deps/tools/techniques) → planned method → expected answer shape.
7. **Coverage Matrix** — 100% mapping: every question → at least one method. Gaps marked explicitly as ADR-deferred.
8. **Halt-loop checkpoints** — for `/discover-execute`: what intermediate state must hold before the loop can mark a sub-task DONE.
9. **Acceptance Criteria** — observable conditions for "this discovery is done": every question answered, every citation backed by a `referencia/` path, blueprint sections complete.
10. **Global Definition of Done** — links to `/discover-confidence` thresholds + golden rule.

## Quality Rules

These rules are NON-NEGOTIABLE for every discovery plan:

1. **Every research question maps to a method.** No "we'll figure it out". Method = `Read path/to/file`, `Grep 'pattern' in dir/`, `find -name`, `git log --grep`, etc.
2. **Every citation in the plan points to a real path in `referencia/`.** Fabricated paths are a `discover-confidence` hard cap (INVALID).
3. **Out-of-scope is explicit.** Vague "rest" is rejected.
4. **Question budget respected.** Total 5-10 questions, max 3 per corner, min 1 per corner (or ADR-deferred). See Step 3.
5. **Time-budget per project.** Each reference project gets a budget (e.g., "Mem0: 4h, Letta: 2h, LangMem: 1h"). Halt-loop respects it. Per-question stop condition mandatory in D1 (see template).
6. **Coverage Matrix is complete.** Every research question maps to at least one method. Deferred questions need an ADR.
7. **ADRs justify investigation depth.** Why dig into one subdirectory but skip another? Document the rationale.
8. **No premature conclusions.** A discovery plan ASKS questions; it doesn't answer them. Answers come from `/discover-execute`.

## What this skill does NOT do

- Execute the research itself — that's `/discover-execute`.
- Write the blueprint — that's `/discover-execute` output.
- Modify anything inside `referencia/` — read-only zone (enforced by `.claude/hooks/boundary-check.sh`).
- Score the result — that's `/discover-confidence`.

## Anti-patterns

1. **"Let's just explore Mem0 first and see what we find."** — no plan = no Coverage Matrix = no quality gate. Always plan first.
2. **Citing files without verifying they exist.** Open a Read tool and check before adding a path to the plan.
3. **Skipping a coverage corner.** "We don't need integration tests for this" — that's an ADR, not a free pass.
4. **Asking unanswerable questions.** "Is Mem0's architecture good?" — make it concrete: "Does Mem0's `MemoryClient.add()` accept multi-peer attribution? Where?"

## Related

- Sibling skill: `/discover-edge-cases` (next step after this skill)
- Sibling skill: `/discover-execute` (consumes the plan)
- Sibling skill: `/discover-confidence` (scores the blueprint produced by execute)
- Template: `templates/discovery-plan-template.md`
- Reference shape: `docs/exploration-reports/mem0-ts.md` (the canonical blueprint produced by a discovery)
