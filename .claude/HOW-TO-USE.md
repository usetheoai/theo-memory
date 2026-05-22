# How to use the `.claude/` ecosystem

Onboarding for `@usetheo/memory` (TheMemory) Claude Code workflows. Read this first if you are new to the project's `.claude/` setup.

## What this system is

A 4-cycle pipeline for taking a software feature from **idea → discovery → plan → code → merge**, with Claude Code as the active agent at each cycle. Each cycle has hard gates, anti-patterns, rollback procedures, and audit trails documented in `cycle-*.md` rules.

```
DISCOVER → PLAN → IMPLEMENT → REVIEW → MERGE
(referencia/   (knowledge-base   (code +     (most rigorous
 → blueprint)   /plans/)          tests)      gate)
```

Each arrow above is an **inquebrável chain** — you do not skip cycles, you do not advance with INVALID verdicts.

## When to use which cycle

| Question | Cycle to invoke | Entry-point command |
|---|---|---|
| "How does Letta / Mem0 / LangMem do X?" | `cycle-discover` | `/discover-plan {topic-slug}` |
| "Let's design feature Y" | `cycle-plan` | `/to-plan` (consumes context + patterns skills) |
| "Build the feature per the plan" | `cycle-implement` | `/implement {plan-slug}` |
| "Review before merge" | `cycle-review` | `/review {plan-slug}` |
| "Just find something in code" | (no cycle) | use Glob/Grep directly OR `/ast-grep` for structural queries |

## Quick start: 5-minute reference

### 1. To investigate a reference project

```
/discover-plan letta-pgvector-schema
  → produces .claude/knowledge-base/discoveries/plans/letta-pgvector-schema-plan.md
/discover-edge-cases letta-pgvector-schema
  → reviews plan; surfaces MUST FIX
[absorb MUST FIX into plan v1.1]
/discover-execute letta-pgvector-schema
  → halt-loop investigates referencia/letta; produces blueprint
/discover-confidence letta-pgvector-schema
  → scores blueprint; if ≥ SHIPPABLE_WITH_CAVEATS:
/skill-writer letta-pgvector-schema
/skill-validator letta-pgvector-patterns
/skill-register letta-pgvector-patterns
  → first-class skill available to /to-plan
```

### 2. To plan a feature

```
/to-plan "implement src/local/ adapter for TheMemory"
  → Step 0 reads .claude/rules/ AND .claude/skills/*-patterns/ (auto-discovery)
  → produces .claude/knowledge-base/plans/{slug}-plan.md
/edge-case-plan {slug}
  → MUST FIX absorbed
/plan-confidence {slug}
  → score; if low:
/plan-improve {slug}
/plan-confidence {slug}  [re-score]
  → if ≥ SHIPPABLE_WITH_CAVEATS: plan ready for /implement
```

### 3. To implement a planned feature

```
git switch -c feature/my-feature
/implement {plan-slug}
  → halt-loop task-by-task: RED → GREEN → REFACTOR → WIRING → COMMIT
  → wiring triad enforced per task: caller + integration test + runtime metric
  → produces commits + .claude/knowledge-base/implementations/{slug}-implementation.md
  → final validation: npm test + typecheck + lint + coverage + wiring summary
```

### 4. To review before merge

```
/review {plan-slug}
  → detect domain; spawn 5-7 specialized agents (architecture, tests, wiring, cross-validation, domain-specific)
  → run all in parallel; consolidate findings by severity
  → re-validate quality gates with tighter thresholds
  → analyze edge-case coverage
  → verdict: READY_TO_MERGE / NEEDS_FIXES / NEEDS_DEEPER
  → produces .claude/knowledge-base/reviews/{slug}-review-{date}.md
  → audit trail at .claude/agents/review-{slug}-{date}/
```

## Where things live

```
.claude/
├── settings.json                 Permissions + hooks wiring
├── hooks/                        5 defensive shell hooks (runtime enforcement)
├── rules/
│   ├── architecture.md           DIP boundaries, 3-tier model, naming
│   ├── testing.md                TDD discipline, pyramid, AAA format
│   ├── public-copy.md            Voice/tone for README, PITCH, marketing
│   ├── cycle-discover.md         (v1.0 ACTIVE) SoT for discovery cycle
│   ├── cycle-plan.md             (v1.0 ACTIVE) SoT for planning cycle
│   ├── cycle-implement.md        (v1.0 ACTIVE) SoT for implementation cycle
│   ├── cycle-review.md           (v1.0 ACTIVE) SoT for review cycle
│   ├── audit-trail-rotation.md   When to archive/delete generated artifacts
│   ├── token-budget.md           Cost estimates per cycle/skill
│   ├── loop-engine-convention.md When ralph-loop vs Agent tool vs Skill tool
│   └── *-golden-rule.md, *-thresholds.txt   Per-skill rubric anchors
├── skills/                       15 skills (4 per cycle + 1 auxiliary ast-grep)
├── knowledge-base/
│   ├── plans/                    /to-plan outputs
│   ├── discoveries/
│   │   ├── plans/                /discover-plan outputs
│   │   └── blueprints/           /discover-execute outputs
│   ├── implementations/          /implement working contracts + .progress files
│   ├── reviews/                  /plan-confidence, /discover-confidence, /review reports
│   └── concepts/                 Long-form ADRs / design docs
├── agents/
│   ├── mem-researcher.md         (active or _archive — see git log)
│   └── review-{slug}-{date}/     Audit trail of /review invocations
└── scripts/
    └── check_xrefs.py            Cross-reference validator
```

## The 4 cycle rules — single source of truth

These are the **load-bearing documents**. Read the cycle rule BEFORE invoking a skill:

| Rule | Skills it governs | Read when |
|---|---|---|
| `cycle-discover.md` | discover-plan, discover-edge-cases, discover-execute, discover-confidence, discover-improve, skill-writer, skill-validator, skill-register | Investigating `referencia/` |
| `cycle-plan.md` | to-plan, edge-case-plan, plan-confidence, plan-improve | Designing a feature |
| `cycle-implement.md` | implement | Coding the planned feature |
| `cycle-review.md` | review | Reviewing before merge |

Each cycle rule has: Purpose, Trigger conditions, Chain (inquebrável), Phase contracts, Hard gates, Soft gates, Stop conditions, Anti-patterns, Rollback, Cross-references, Versioning.

## Inquebrável principles (apply across all cycles)

These come from the project's global CLAUDE.md (`/home/paulo/.claude/CLAUDE.md`). They apply EVERYWHERE in this ecosystem:

1. **95% confidence rule** — never proceed without 95%+ certainty; ask when uncertain
2. **Task completion gate** — finish before starting a new task
3. **Extreme honesty** — admit ignorance; surface risks; never invent state
4. **Git rules** — NEVER `git checkout` / `git revert` / `git push --force` / `git reset --hard` / direct commit to `main`
5. **TDD-first** — failing test before production code; bug fix starts with regression test
6. **CHANGELOG discipline** — every code change updates `[Unreleased]`
7. **Don't reinvent** — prefer mature libraries (pgvector, pg, zod, etc.)

These rules are enforced by hooks (`.claude/hooks/`) plus declarative gates in each cycle rule.

## Token budget awareness

This system is **expensive by design**. See `.claude/rules/token-budget.md` for full breakdown. Quick reference:

| Cycle | Typical cost | When NOT to use |
|---|---|---|
| `cycle-discover` (full chain) | 80-200k tokens | Question is text-shape (use Read + Grep) |
| `cycle-plan` (full chain) | 30-80k tokens | Change is trivial (single-line; write directly) |
| `cycle-implement` (50 iter halt-loop) | 100-300k tokens | No plan exists (use cycle-plan first) |
| `cycle-review` (5-7 agents parallel) | 150-250k tokens | PR is tiny (use built-in `/review` instead) |
| **Full feature E2E** | **360-830k tokens** | — |

## Pre-conditions for new contributors

Before invoking any cycle skill, verify:

- [ ] `ralph-loop` plugin is enabled (`jq '.enabledPlugins' ~/.claude/settings.json`)
- [ ] Python 3.10+ available (`python3 --version`)
- [ ] PyYAML installed (`python3 -c "import yaml"`)
- [ ] `npm` available if working on TS/Node code (most cycles SKIP gracefully if absent)
- [ ] ast-grep installed for `cycle-discover` / `cycle-review` structural queries (`ast-grep --version`)
- [ ] You read at least `cycle-{your-target}.md` and the entry-point SKILL.md before invoking

## Common questions

### "When do I use /to-plan vs /discover-plan?"

- `/to-plan` produces an **implementation plan** (what to build, how, in what order)
- `/discover-plan` produces a **discovery plan** (what to investigate in `referencia/`)

If you don't know how someone else solved a problem → `/discover-plan`. If you know the problem and need to plan the implementation → `/to-plan`.

### "What's the relationship between /review and the built-in /review?"

- Built-in `/review` (Anthropic): generic PR review, ~10-30k tokens, fast
- Custom `/review` (this ecosystem): rigorous gate with 5-7 specialized agents, ~150-250k tokens, slow

Use built-in for small PRs. Use custom `/review` before merging substantial features.

### "Can I skip /discover-edge-cases?"

No. The cycle is inquebrável. Edge cases found pre-implementation are 100x cheaper than post-implementation. If a discovery plan looks "obviously fine", running `/discover-edge-cases` takes 30s and finds 0-2 real issues.

### "What if /plan-confidence returns INVALID?"

INVALID = hard cap fired (Coverage Matrix < 100% OR fabricated citation). Loop back to `/to-plan` to fix the plan structurally. Do NOT proceed to `/plan-improve` — improve cannot fix hard caps.

### "How do I rollback a registered patterns skill?"

```bash
mv .claude/skills/{name}/ .claude/skills/generated/{name}/
# Optionally delete the audit at .claude/knowledge-base/reviews/skill-register-*.md
```

The skill returns to staging. `/to-plan` stops discovering it via Step 0.

### "How do I run end-to-end without writing code?"

The chain naturally degrades pre-code:

```
/discover-execute letta-pgvector-schema    # produces blueprint (works fully)
/discover-confidence letta-pgvector-schema  # scores blueprint (works fully)
# /implement requires plan from /to-plan AND src/ exists; will refuse pre-code
# /review requires /implement output; will refuse pre-code
```

So today (pre-code) you can exercise `cycle-discover` end-to-end. `cycle-plan` requires conversational context but works. `cycle-implement` and `cycle-review` are dormant until `src/` exists.

## Maintenance / contributor notes

- The 4 cycle rules are SoT. Changes to chain order, anti-patterns, gates go IN the cycle rule, not in SKILL.md
- SKILL.md files retain only PHASE-SPECIFIC detail. If you find generic content in a SKILL.md, move it to the cycle rule
- Cross-references between cycle rules + SKILL.md + scripts: validate via `python3 .claude/scripts/check_xrefs.py`
- Audit trail rotation: see `.claude/rules/audit-trail-rotation.md`
- Token cost expectations: see `.claude/rules/token-budget.md`

## Where to ask for help

- Project-specific questions: this file + `theo-memory/CLAUDE.md`
- Global Claude Code conventions: `/home/paulo/.claude/CLAUDE.md`
- Specific cycle: `cycle-{name}.md`
- Specific skill: `.claude/skills/{name}/SKILL.md` (+ `PORTABLE.md` when it exists)
