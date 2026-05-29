# Cycle: Auto-Plan (super-cycle orchestrator)

> **INQUEBRÁVEL — 95% Confidence Gate**
>
> NÃO FAÇA NADA SE NÃO TIVER 95% DE CONFIANÇA.
> SEMPRE QUE PRECISAR DE UMA DECISÃO DO USUÁRIO, APRESENTE
> OPÇÕES PARA ELE ESCOLHER.
>
> Ver `/home/paulo/.claude/CLAUDE.md` § 1 (Confiança de 95%).

Source of truth for the `/auto-plan` super-cycle that orchestrates `cycle-discover` + `cycle-plan` end-to-end autonomously. Single skill (`/auto-plan` in `.claude/skills/auto-plan/`) drives the cycle via deterministic confidence assessment + AskUserQuestion mode selection + sequential Skill tool composition.

## Purpose

Convert "a topic the user wants planned" into "a SHIPPABLE plan ready for `/implement`" with the lowest possible human-touch:

- ONE invocation (`/auto-plan {topic-slug}`) instead of 9 manual slash commands
- Confidence-driven mode selection (plan-only vs light discover vs full discover)
- Honest refusal at LOW confidence (< 30%) unless explicitly forced
- Autonomous progression through sub-cycles until SHIPPABLE OR honest gap report

Honors `planning-with-files` v2.43.0 autonomy philosophy (absorbed 2026-05-26) while preserving TheMemory's deterministic quality gates (plan-confidence + deps-audit + edge-case classifier).

## Trigger conditions

Invoke this cycle when:

- User wants a plan from scratch and confidence to skip discover is unclear
- Working on a feature branch (NEVER on `main` per Inquebrável Rule 4)
- Repo state has SOME signals (references / patterns skills / ADRs / completed plans / CLAUDE.md roadmap entry)
- Tooling is operational

Do NOT invoke when:

- Plan already exists in `.claude/knowledge-base/plans/{slug}-plan.md` — invoke `/plan-confidence` or `/implement` directly
- User explicitly wants control over each phase — invoke `/to-plan` then chain manually
- Topic is trivially small (single-line fix) — write the change directly per `cycle-plan.md` § Trigger conditions

## Chain (inquebrável)

```
/auto-plan {topic-slug} [--depth=none|light|full] [--force-override]
  ↓
  Step 1: assess_confidence.py → deterministic score + signals (~0 LLM tokens)
  ↓
  Step 2: mode + depth decision
  ↓        - HIGH (≥95): proceed with depth=none (or user's --depth)
  ↓        - MED-HIGH (70-94): AskUserQuestion, recommend light
  ↓        - MED-LOW (30-69): AskUserQuestion, recommend full + warn
  ↓        - LOW (<30): REFUSE unless --force-override
  ↓
  Step 3: chain execution
  ↓
  ┌── Phase D (only if depth != none) ──┐
  │ /discover-plan → /discover-edge-cases │
  │ → /discover-execute (ralph-loop)      │
  │ → /discover-confidence                │
  │   if < SHIPPABLE_WITH_CAVEATS:        │
  │   → /discover-improve → re-confidence │
  └───────────────────────────────────────┘
  ↓
  Phase P (always):
  /to-plan → /edge-case-plan → /deps-audit
  → /plan-confidence
    if < SHIPPABLE:
    → /plan-improve → re-confidence
  ↓
  Phase A (always):
  attest-plan.sh {slug}  →  .claude/.attestations/{slug}.sha256
  ↓
  Step 4: deliver summary + path-to-plan OR honest gap report
```

Sequential composition. Each sub-skill uses its own ralph-loop where applicable (`/discover-execute`, `/discover-improve`, `/plan-improve`). The orchestrator does NOT introduce new halt-loop mechanics.

## Phase contracts

| Step | Input | Output | Success criterion |
|---|---|---|---|
| Step 1 (assess) | topic-slug + context length | JSON with score + signals + recommendation | Score deterministic; signals enumerable |
| Step 2 (decide) | score JSON + optional CLI flags | (mode, depth) tuple | User confirmed OR auto-resolved per band |
| Step 3D (discover) | topic-slug, depth | Blueprint at `.../blueprints/{slug}-blueprint.md` + confidence report | Verdict ≥ SHIPPABLE_WITH_CAVEATS OR halt |
| Step 3P (plan) | topic-slug + blueprint (if applicable) | Plan at `.../plans/{slug}-plan.md` + confidence report | Verdict ≥ SHIPPABLE_WITH_CAVEATS (target SHIPPABLE) |
| Step 3A (attest) | resolved plan file | `.claude/.attestations/{slug}.sha256` | Hash written; verify=OK |
| Step 4 (deliver) | both phases' outputs | Summary printed to user | Plan file exists + attested; OR honest gap report |

## Hard gates (cannot advance — BLOCK the cycle)

1. **Branch == main** — refuse; require feature branch (Inquebrável Rule 4).
2. **Uncommitted changes from prior cycle** — refuse; require `git status` clean OR `--allow-dirty-tree` flag.
3. **Confidence < 30 without `--force-override`** — refuse with structured "next actions" suggestion.
4. **`/discover-confidence` final verdict INVALID after `/discover-improve`** — halt; do NOT proceed to plan phase.
5. **`/plan-confidence` final verdict INVALID after `/plan-improve`** — halt; do NOT mark plan as "ready". Surface blockers.
6. **`/deps-audit` returns FAIL_INSECURE OR INVALID_PLAN_DEPS** — halt; surface CRITICAL/HIGH CVE OR plan dep structure defect; require human fix before re-trying.
7. **`/edge-case-plan` returns DISCOVERY PLAN PRECISA DE AJUSTE with MUST FIX items** — pause; AskUserQuestion confirms absorption strategy (auto-absorb via `/plan-improve`-style edit OR human review).

## Soft gates (advance, but warn)

1. **Cap likely SHIPPABLE_WITH_CAVEATS** (depth=none + confidence < 70) — warn at Step 2 but proceed if user confirms.
2. **Override of recommended depth** (user picked `none` when system recommended `full`) — proceed; add `## Accepted Risks` entry to the plan documenting the override.
3. **`/plan-improve` max-iterations reached** — emit honest "ceiling hit at score X" report; deliver plan with current verdict.
4. **`/discover-execute` halt-loop hit max iterations OR honest BLOCKED** — proceed to plan phase ONLY if blueprint has the original 4 corners populated (Coverage Corner 5 prior_art may stay partial).

## Stop conditions (cycle aborts honestly — NOT a failure)

1. **User declines all options at Step 2 AskUserQuestion** — abort gracefully; nothing written.
2. **External dep unavailable** — pgvector down for discover snapshots, network out for WebSearch, etc. Halt; surface for human to fix.
3. **Topic resolves to a slug that already has a plan in `.../plans/` AND user did not pass `--rewrite`** — refuse; suggest user pick a new slug OR pass `--rewrite` flag.

## Anti-patterns (NEVER do these — violates the contract)

1. **NEVER skip Step 1 (assess_confidence)** — the deterministic score is the basis for everything downstream. Even with `--depth=` flag, run the assessment for audit trail purposes.
2. **NEVER skip `/edge-case-plan` or `/deps-audit`** even on HIGH confidence. Those gates are cheap (5-15k + 5-20k tokens) and catch real problems.
3. **NEVER auto-commit produced plan** — delivery is the FILE; user decides commit timing.
4. **NEVER claim SHIPPABLE if any sub-skill returned WITH_CAVEATS** — verdict propagates honestly. Final verdict is `min(sub-verdicts)`.
5. **NEVER fabricate confidence signals** — the heuristic is deterministic; output is the truth. Even if score feels "too low", do not invent extra signals.
6. **NEVER attempt MORE THAN 10 `/plan-improve` iterations** — diminishing returns proven (v0.4a hit ceiling in 1-2 iters). Honest "max iterations exhausted" is the right exit.
7. **NEVER skip the attestation step** (Phase A) — even if user did not request it. Attestation defends against subsequent prompt injection via plan file edits.

## Rollback

| Artifact | Rollback procedure |
|---|---|
| Plan in `.../plans/{slug}-plan.md` | Delete file; no further state to revert |
| Blueprint in `.../discoveries/blueprints/{slug}-blueprint.md` | Delete file + `.progress-{slug}.json` |
| Snapshots in `.../discoveries/snapshots/{slug}/` | `find .../snapshots/{slug} -delete` |
| Attestation in `.../.attestations/{slug}.sha256` | `rm .../.attestations/{slug}.sha256` |
| Edge-case + deps-audit + confidence reports | Delete individual files |

`/auto-plan` does NOT modify code under `src/`. The cycle ends BEFORE `/implement`.

## Cost estimates

Per `token-budget.md` (updated by this cycle's introduction):

| Depth | Sub-skills invoked | Total tokens | Wall-clock |
|---|---|---|---|
| `none` (plan-only) | to-plan + edge-case-plan + deps-audit + plan-confidence + (optional plan-improve) | 35-100k | 5-15 min |
| `light` discover | discover-plan + edge-cases + execute (~30k) + confidence + plan chain | 80-150k | 15-30 min |
| `full` discover | discover-plan + edge-cases + execute (~120k) + confidence + improve + plan chain + plan-improve | 200-400k | 30-90 min |

These are estimates; actual cost varies with halt-loop iteration counts.

## Cross-references

- Phase SKILL.md: [`auto-plan/`](../skills/auto-plan/SKILL.md)
- Confidence assessment script: `.claude/skills/auto-plan/scripts/assess_confidence.py`
- Sub-cycle rules: `cycle-discover.md`, `cycle-plan.md`
- Companion skills (sub-skills orchestrated): `to-plan`, `edge-case-plan`, `deps-audit`, `plan-confidence`, `plan-improve`, `discover-plan`, `discover-edge-cases`, `discover-execute`, `discover-confidence`, `discover-improve`
- Composition primitives (alternative autonomy mechanism): `.claude/commands/plan-goal.md`, `.claude/commands/plan-loop.md`
- Attestation: `.claude/scripts/attest-plan.sh` + `.claude/commands/plan-attest.md`
- Inquebráveis: `/home/paulo/.claude/CLAUDE.md` § Rules 1, 2, 3, 4, 9

## Versioning

This cycle rule is **v1.0** as of 2026-05-26. Same evolution policy as `cycle-plan.md`: extensions follow ADR; softenings require strategic review.
