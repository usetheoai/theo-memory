---
name: auto-plan
description: End-to-end autonomous orchestrator for cycle-discover + cycle-plan. Single entry-point that assesses confidence, asks user for mode/depth, then chains discover + plan + edge-case-plan + deps-audit + plan-confidence + plan-improve until a SHIPPABLE plan is produced (or honest gap report). Inspired by planning-with-files v2.43.0 autonomy + composes Claude Code primitives (/plan-goal, /plan-loop) absorbed 2026-05-26.
user-invocable: true
allowed-tools: "Read Write Edit Bash Glob Grep Skill"
---

# `/auto-plan` — Autonomous cycle orchestrator

End-to-end autonomous orchestration of `cycle-discover` + `cycle-plan`. Replaces the 9-slash manual sequence with a single invocation that:

1. **Assesses confidence** deterministically against repo state (references, patterns skills, ADRs, CLAUDE.md, completed plans, user context).
2. **Asks the user** for mode (full / plan-only) + depth (none / light / full) — recommendation pre-selected based on confidence.
3. **Chains skills autonomously** (discover → plan → audit → confidence → improve) until verdict ≥ SHIPPABLE (90+) OR honest cap report.

## When to invoke

- User wants to plan a new feature/refactor and doesn't want to invoke 9 slash commands manually.
- User wants a confidence-checked plan-only mode for incremental work.
- User wants the discover phase auto-triggered when prior art is thin.

Do NOT invoke when:

- Plan already exists and just needs `/implement` — invoke `/implement` directly.
- Working on `main` branch — switch to feature branch first.
- Context is < 50 chars AND no related artifacts exist in repo — orchestrator will refuse (LOW confidence).

## Argument parsing

```
/auto-plan {topic-slug}              # auto everything; ask confirmation if confidence < 95%
/auto-plan {topic-slug} --depth=none # skip discover entirely
/auto-plan {topic-slug} --depth=light
/auto-plan {topic-slug} --depth=full
/auto-plan {topic-slug} --force-override  # bypass refusal even at LOW confidence
```

## Process

### Step 1 — Assess confidence (deterministic, ~0 LLM tokens)

Run:

```bash
python3 .claude/skills/auto-plan/scripts/assess_confidence.py {topic-slug} \
  --context-length={len(user_provided_context_in_chars)} --json
```

Parse JSON output. Note `score`, `verdict`, `recommended_depth`, `signals`.

### Step 2 — Decide mode + depth

| Confidence band | Behavior |
|---|---|
| `HIGH` (≥ 95) | Proceed with `depth=none` (plan-only). NO AskUserQuestion needed unless user passed `--depth` flag. |
| `MED-HIGH` (70-94) | AskUserQuestion: confirm `light` (recommended) vs `none` vs `full`. |
| `MED-LOW` (30-69) | AskUserQuestion: confirm `full` (recommended) vs `light` vs `none`; warn that `none`/`light` likely cap at SHIPPABLE_WITH_CAVEATS. |
| `LOW` (< 30) | **Refuse** with suggested next actions, UNLESS `--force-override` flag present. If forced, proceed with `full` + log "OVERRIDE: user proceeded against low-confidence recommendation" in eventual plan's `## Accepted Risks` section. |

CLI `--depth=` flag ALWAYS overrides auto-recommendation (no confirmation needed).

### Step 3 — Chain execution

Based on chosen depth:

#### Phase D — Discover (only if `depth != none`)

```
Skill(/discover-plan {topic-slug})
Skill(/discover-edge-cases {topic-slug})
Skill(/discover-execute {topic-slug})       # ralph-loop halt-loop
Skill(/discover-confidence {topic-slug})
# If verdict < SHIPPABLE_WITH_CAVEATS:
Skill(/discover-improve {topic-slug})       # ralph-loop halt-loop
Skill(/discover-confidence {topic-slug})    # re-score
```

For `light` depth: pass time-budget/question-budget hints in the discover plan (instruct `/discover-plan` to target 2-3 questions, ≤ 60min budget).

For `full` depth: standard `/discover-plan` defaults (5-10 questions per `cycle-discover.md v1.1`).

If `/discover-confidence` after improve still < SHIPPABLE_WITH_CAVEATS → halt with honest report; do NOT proceed to plan phase.

#### Phase P — Plan (always)

```
Skill(/to-plan {topic-slug})
Skill(/edge-case-plan {topic-slug})
# Human absorbs MUST FIX items (orchestrator surfaces them via AskUserQuestion)
Skill(/deps-audit {topic-slug})
Skill(/plan-confidence {topic-slug})
# If verdict < SHIPPABLE:
Skill(/plan-improve {topic-slug})           # ralph-loop, max 10 iterations
Skill(/plan-confidence {topic-slug})         # re-score
```

#### Phase A — Attest (always, post-plan)

```
Bash(.claude/scripts/attest-plan.sh {topic-slug})
```

Locks the SHA256 so UserPromptSubmit hook can validate.

### Step 4 — Deliver

Print summary:

```
=== /auto-plan complete ===
Topic: {slug}
Mode chosen: {depth}
Confidence at start: {score}/100 ({verdict})

Discover phase: {SKIP | SHIPPABLE_WITH_CAVEATS {score} | SHIPPABLE {score}}
Plan phase:     {SHIPPABLE_WITH_CAVEATS {score} | SHIPPABLE {score} | NEEDS_HUMAN}

Final plan: .claude/knowledge-base/plans/{slug}-plan.md
Confidence: SHIPPABLE_WITH_CAVEATS / SHIPPABLE / NEEDS_HUMAN
Blueprint (if discover ran): .claude/knowledge-base/discoveries/blueprints/{slug}-blueprint.md
Attestation hash: {sha256}

Next step: /implement {slug} when ready.
```

If any phase blocked → honest report listing what blocked + recommended human action.

## Hard gates (cannot proceed)

1. **Branch == main** → refuse; require feature branch.
2. **Uncommitted changes from prior cycle** → refuse; require git status clean OR explicit `--allow-dirty-tree`.
3. **Confidence < 30 without `--force-override`** → refuse with suggested next actions.
4. **`/discover-confidence` final verdict INVALID after improve** → halt; surface blockers; do NOT proceed to plan.
5. **`/plan-confidence` final verdict INVALID after improve** → halt; surface gaps; do NOT deliver as "ready".

## Soft gates (proceed with warning)

1. **Cap likely SHIPPABLE_WITH_CAVEATS** at depth=none with confidence < 70 → warn but proceed.
2. **Override of recommended depth** (user picked `none` when system suggested `full`) → proceed; add `## Accepted Risks` entry to plan.

## Anti-patterns

1. **NEVER fabricate confidence signals.** The script is deterministic; output is the truth.
2. **NEVER skip /edge-case-plan or /deps-audit even on HIGH confidence.** Those gates are cheap.
3. **NEVER auto-commit produced plan.** Delivery is the file; user decides when to commit.
4. **NEVER claim SHIPPABLE if plan-confidence returned WITH_CAVEATS** — honesty per Inquebrável Rule 3.
5. **NEVER proceed past INVALID verdict** — that's an explicit fail-closed.

## Cycle contract

This skill is `phase 0` of a NEW super-cycle that orchestrates `cycle-discover` + `cycle-plan`. The cycle rule SoT is `.claude/rules/cycle-auto-plan.md`. Hard gates + soft gates + anti-patterns live there.

## Related

- `.claude/rules/cycle-auto-plan.md` — cycle SoT
- `.claude/rules/cycle-discover.md` — discover sub-cycle
- `.claude/rules/cycle-plan.md` — plan sub-cycle
- `.claude/commands/plan-goal.md` + `plan-loop.md` — Claude Code primitive composition (alternative autonomy mechanism)
- `.claude/scripts/attest-plan.sh` — attestation post-plan
- Inspired by `planning-with-files` v2.43.0 (MIT, OthmanAdi) — autonomous file-based planning pattern, absorbed 2026-05-26
