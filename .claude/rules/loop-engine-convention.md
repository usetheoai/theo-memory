# Loop engine convention

> **INQUEBRÁVEL — 95% Confidence Gate**
>
> NÃO FAÇA NADA SE NÃO TIVER 95% DE CONFIANÇA.
> SEMPRE QUE PRECISAR DE UMA DECISÃO DO USUÁRIO, APRESENTE
> OPÇÕES PARA ELE ESCOLHER.
>
> Ver `/home/paulo/.claude/CLAUDE.md` § 1 (Confiança de 95%).

Source of truth for **when to use ralph-loop vs Agent tool vs Skill tool** when designing or modifying skills in this ecosystem.

## The three loop mechanisms

This ecosystem uses three distinct mechanisms that look superficially similar but solve different problems. Choosing the wrong one wastes tokens and introduces fragility.

### 1. `ralph-loop:ralph-loop` (the autonomous halt-loop)

**What it is:** A plugin (`ralph-loop` in `~/.claude/settings.json.enabledPlugins`) that lets Claude run multi-iteration tasks across `Stop` events. Each iteration ends; the Stop hook restarts Claude with the same prompt + updated state.

**State management:** External file (`.claude/ralph-loop.local.md` + skill-specific progress JSON).

**Halt condition:** Promise marker like `<promise>BLUEPRINT_COMPLETE</promise>` in the response.

**Cost:** HIGH (each iteration is a full LLM call). Use sparingly.

**Use when:**

- The task requires many sequential decisions that depend on accumulated state (e.g., implementing 50 tasks of a plan, one at a time)
- The state cannot fit in a single Claude context window
- Each iteration has a clear stop condition (test passes, citation verified, etc.)
- Failure recovery requires restarting from a known state file

**Examples in this ecosystem:**

- `/discover-execute` — iterates over research questions in `.claude/knowledge-base/references/`; emits `<promise>BLUEPRINT_COMPLETE</promise>` when all questions answered
- `/discover-improve` — iterates Phase A (deterministic) + Phase B (LLM) until blueprint reaches target verdict
- `/plan-improve` — same pattern for implementation plans
- `/implement` — iterates over plan tasks, one TDD cycle per iteration

**Anti-pattern:** Using ralph-loop for a single-pass task. If the task can fit in one Claude context, don't pay the multi-iteration overhead.

#### How to invoke `ralph-loop:ralph-loop` safely — argument-passing contract

`ralph-loop:ralph-loop` invokes a shell script (`setup-ralph-loop.sh`) that parses its arguments via bash. **The positional prompt argument is shell-evaluated.** Backticks, `$VAR`/`$(...)`, and unescaped quotes will trigger command substitution and break the loop start with a parse error (observed regression 2026-05-22 during `/implement` startup).

**Argument contract (per ralph-loop plugin):**

```
/ralph-loop PROMPT_TEXT --completion-promise 'TEXT' --max-iterations N
```

- `PROMPT_TEXT` — initial prompt that ralph-loop will replay each iteration. **MUST be shell-safe** — no backticks, no `$VAR`/`$(...)`, no unescaped quotes, no code blocks, no markdown headers if they touch shell-active chars.
- `--completion-promise 'TEXT'` — promise marker (use single quotes if multi-word). Required to terminate the loop.
- `--max-iterations N` — iteration cap (per `.claude/rules/token-budget.md`).

**Recommended pattern: file-referenced prompt.** Inline assembly of a complex driver prompt is fragile. For non-trivial drivers (typical of `/implement`, `/discover-execute`, `/discover-improve`, `/plan-improve`), build a SHORT shell-safe positional prompt that POINTS to a file containing the full driver text:

1. **Read** the driver template (e.g., `.claude/skills/{name}/prompts/{name}-prompt.md`).
2. **Substitute** static placeholders (`{PLAN_SLUG}`, `{MAX_ITERATIONS}`, etc.) — leaving dynamic ones (`{ITERATION}`) for ralph-loop / the per-iteration Claude.
3. **Write** the substituted prompt to a per-invocation file under `.claude/halt-loop-prompts/{name}-{slug}.md` (gitignored — see `.gitignore`).
4. **Invoke** ralph-loop with a SHORT positional prompt that references the file (no shell metachars):

```
Read .claude/halt-loop-prompts/implement-discover-plan-confidence.md and follow its instructions for this halt-loop iteration.
```

Plus the flags: `--completion-promise 'IMPLEMENTATION_COMPLETE' --max-iterations 80`.

Each iteration, ralph-loop replays this short positional prompt; Claude reads the file and drives the loop step. The driver file is the single source of truth across iterations.

**Anti-patterns specific to ralph-loop invocation:**

1. **Inlining the driver prompt with backticks / fenced code blocks / `$(...)` in ralph-loop args** — shell evaluates them and the loop fails to start.
2. **Forgetting `--completion-promise`** — loop runs until `--max-iterations` is exhausted, wasting tokens.
3. **Setting `--max-iterations` too high without budget justification** — violates `.claude/rules/token-budget.md`. Skill SHOULD document its expected iteration count.
4. **Writing the driver file inside the skill dir** (e.g., `.claude/skills/{name}/.last-halt-loop.md`) — pollutes the skill source tree. Use `.claude/halt-loop-prompts/` (gitignored).
5. **Emitting the promise marker wrapped in backticks or fenced code block** — ralph-loop's regex matches the literal `<promise>TEXT</promise>` sequence OUTSIDE inline code. Wrapping the marker in single backticks (` `` `) OR a triple-fenced code block (` ``` `) prevents detection — the loop will restart despite the agent's intent to terminate. **Correct emission:** plain text, isolated on its own line, at the VERY END of the response, no markdown wrapping. Driver template authors MUST instruct their per-iteration prompts to follow this rule (post-v0-4a-T0.1 retrospective 2026-05-26). See § Halt-loop driver promise-marker emission rule below.

### Halt-loop driver promise-marker emission rule (locked 2026-05-26)

Every halt-loop driver prompt template under `.claude/skills/*/prompts/*.md` MUST instruct its per-iteration agent to:

1. Emit the promise marker (`<promise>{TEXT}</promise>`) in PLAIN TEXT — no inline code, no fenced code blocks, no backticks anywhere around the marker.
2. Place it ISOLATED on its own line, with at least one blank line above and ZERO content after (the promise marker is the LAST content of the response).
3. Place it at the VERY END of the response — any narrative summary, report, or follow-up information must PRECEDE the marker line.

Authors writing or editing driver templates must verify these three properties hold for both the SUCCESS and BLOCKED emission paths (e.g., `BLUEPRINT_COMPLETE` AND `BLUEPRINT_BLOCKED` for `discover-execute`). Failure mode confirmed: backtick-wrapped markers in `/implement v0-4a` iteration 1 + 2 caused 2 spurious restarts despite legitimate honest-BLOCKED termination.

### 2. `Agent` tool (subagent invocation)

**What it is:** Built-in tool that spawns a subagent with its own context. The subagent receives a focused prompt and returns ONE structured result.

**State management:** None — each invocation is independent.

**Halt condition:** Subagent finishes its task and returns. No mid-iteration restart.

**Cost:** Variable per agent; one full context window per agent. Cheap if focused; expensive if N agents in parallel.

**Use when:**

- The task has a clearly-scoped sub-question that benefits from isolated context
- Multiple sub-questions can be answered in parallel (each in its own agent)
- The result is a structured artifact (findings YAML, search results, summary) that doesn't need iterative refinement
- You want to protect the main context window from the verbose intermediate work

**Examples in this ecosystem:**

- `/review` — spawns 5-7 specialized agents in PARALLEL (architecture, tests, wiring, cross-validation, domain-specific); each emits findings; orchestrator consolidates
- `/discover-plan` Step 3 — may spawn a sub-agent to enumerate .claude/knowledge-base/references/ structure when grep is insufficient

**Anti-pattern:** Using Agent tool for an iterative refinement task. Each invocation is one-shot; if you need 5 retries, you'll spawn 5 agents instead of running 1 halt-loop with 5 iterations.

### 3. `Skill` tool (compose existing skills)

**What it is:** Built-in tool that invokes another skill from within the current task. The invoked skill runs in the SAME context as the caller, just with its SKILL.md instructions loaded.

**State management:** Shared with the caller. Skills can produce files, edit code, etc., visible to the caller.

**Halt condition:** Skill finishes its workflow.

**Cost:** Low overhead (no new context); cost is the skill itself.

**Use when:**

- You want to invoke a sibling skill as part of a workflow (e.g., `/to-plan` chain invokes `/edge-case-plan` then `/plan-confidence`)
- The skills share project context (files, repo state)
- Sequential composition: skill A → skill B → skill C

**Examples in this ecosystem:**

- `/to-plan` orchestrator (when implemented) would invoke `/edge-case-plan` → `/plan-confidence` → optionally `/plan-improve` → `/plan-confidence`
- `/discover-plan` chain documents the same sequential composition

**Anti-pattern:** Using Skill tool for a task that needs isolated context. If the called skill would interfere with the caller's context, use Agent tool instead.

## Decision matrix

| Task shape | Recommended mechanism | Why |
|---|---|---|
| Iterate over a list with state-dependent decisions | **ralph-loop** | Multi-iteration with external state |
| Parallel deep-review of N aspects | **Agent (parallel)** | Each agent in isolated context |
| Sequential composition of skills | **Skill tool** | Shared context, low overhead |
| Single focused question with structured output | **Agent (one-shot)** | Cheap; protects main context |
| Single quick query | **None** — Read/Grep directly | Don't use any mechanism for a 1-line query |

## When in doubt, ask these 4 questions

1. **Can the task complete in ONE Claude context?**
   - YES → Skill tool OR direct invocation (no mechanism)
   - NO → ralph-loop or Agent

2. **Does the task have N parallel sub-questions?**
   - YES → Agent (parallel)
   - NO → continue to Q3

3. **Does the task require state across iterations?**
   - YES → ralph-loop
   - NO → Skill tool

4. **Should the sub-task have its own isolated context?**
   - YES → Agent (one-shot)
   - NO → Skill tool

## Examples by ecosystem

| Skill | Mechanism | Why |
|---|---|---|
| `/to-plan` | Skill tool (composes /edge-case-plan, /plan-confidence) | Sequential, shared context |
| `/edge-case-plan` | Read + Grep + reasoning | Single context, no loop needed |
| `/plan-confidence` | Bash (python script) | Deterministic; no LLM loop |
| `/plan-improve` | ralph-loop | Multi-iteration refinement with state |
| `/discover-plan` | Skill tool + Read/Grep | Sequential, shared context |
| `/discover-execute` | ralph-loop | Long iteration over `.claude/knowledge-base/references/` |
| `/discover-confidence` | Bash (python script) | Deterministic; no LLM loop |
| `/implement` | ralph-loop | 50 iterations × 5 phases per task |
| `/review` | Agent (parallel) | 5-7 specialized agents in parallel |
| `/skill-writer` | Single Claude turn | Reads blueprint + writes candidate skill in one go |
| `/skill-validator` | Bash (python script) | Deterministic |
| `/skill-register` | Bash (python script) | Just moves files + writes audit |
| `/ast-grep` | Bash | External tool; no LLM |

## Cost implications

Choosing the wrong mechanism is expensive:

- ralph-loop overhead: ~20% extra tokens per iteration (Stop hook + restart)
- Agent overhead: full context window per agent (5 agents = 5× context cost)
- Skill tool overhead: low — composes within the same context

Rule of thumb: use the MOST CONSTRAINED mechanism that solves the problem. Skill tool < Agent < ralph-loop in terms of overhead.

## Anti-patterns

1. **Using ralph-loop for everything because "halt-loop sounds robust"** — pay the overhead only when iteration is genuinely needed.
2. **Spawning 10 Agents in parallel for "thoroughness"** — each one is a full context window. 10 agents in parallel = 10× cost. Match the count to the actual sub-problems.
3. **Using Skill tool to invoke a skill that shouldn't see the caller's context** — risk of context pollution. Use Agent for isolated work.
4. **Running ralph-loop with no halt condition** — recipe for runaway loops. Every ralph-loop must define a clear promise marker.
5. **Conflating "halt-loop" (a concept) with "ralph-loop" (a tool)** — many tasks need iteration without needing ralph-loop. A while loop in Python is also a "halt-loop".

## Cross-references

- ralph-loop plugin: `ralph-loop:ralph-loop` skill (must be enabled in `~/.claude/settings.json.enabledPlugins`)
- Skills using ralph-loop: `/discover-execute`, `/discover-improve`, `/plan-improve`, `/implement`
- Skills using Agent (parallel): `/review`
- Skills using Skill tool composition: `/to-plan` (chain), `/discover-plan` (chain)
- Cycle rules referencing this convention: `cycle-discover.md`, `cycle-plan.md`, `cycle-implement.md`, `cycle-review.md`
- Audit-trail rotation: `audit-trail-rotation.md`
- Token budget: `token-budget.md`
