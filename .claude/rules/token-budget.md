# Token budget — cost estimates per cycle/skill

> **INQUEBRÁVEL — 95% Confidence Gate**
>
> NÃO FAÇA NADA SE NÃO TIVER 95% DE CONFIANÇA.
> SEMPRE QUE PRECISAR DE UMA DECISÃO DO USUÁRIO, APRESENTE
> OPÇÕES PARA ELE ESCOLHER.
>
> Ver `/home/paulo/.claude/CLAUDE.md` § 1 (Confiança de 95%).

Source of truth for **expected token cost** of each cycle and skill in this ecosystem. Use this before invoking expensive cycles to make informed decisions.

## Why this rule exists

This ecosystem is **intentionally expensive** in many places. Without a centralized cost reference, contributors orçam errado:

- Engineer expects `/review` to cost like Anthropic's built-in `/review` (10-30k tokens) — it actually costs 150-250k
- Engineer assumes `cycle-discover` is a quick lookup — it can run halt-loop for 30+ iterations
- Engineer orçam a feature E2E and lacks the full picture

The numbers below are estimates based on the architecture of each skill, not empirical measurements (the system has not yet run E2E in production). Update with empirical data once available.

## Estimates per skill

### `cycle-plan` skills

| Skill | Typical cost | Notes |
|---|---|---|
| `/to-plan` | 15-40k | Reads `.claude/rules/`, patterns skills frontmatter, repo state; writes plan |
| `/edge-case-plan` | 5-15k | Reads plan, applies pragmatic checklist |
| `/deps-audit` | 5-20k | v1.1; scanner runtime is ~0 LLM tokens (`osv-scanner`, `npm audit`, `pip-audit`, `cargo audit`, `govulncheck` are external CLIs). Cost is in JSON parsing + cross-referencing plan's `## Dependencies` section + report writing. Higher end (~20k) when plan declares many deps OR many CVEs surface. |
| `/plan-confidence` | <1k | Deterministic Python; ~0 LLM tokens |
| `/plan-improve` | 10-25k | Halt-loop Phase A (deterministic, $0) + Phase B (LLM-driven) |
| **Full chain** | **35-100k** | v1.1 includes `/deps-audit`; with `/plan-improve`, otherwise 25-75k |

### `cycle-discover` skills

| Skill | Typical cost | Notes |
|---|---|---|
| `/discover-plan` | 10-30k | Reads rules, foundation doc, exploration reports, `referencia/` top-level |
| `/discover-edge-cases` | 5-15k | Reads plan + pragmatic checklist |
| `/discover-execute` | 30-100k | Halt-loop with 10-30 iterations over `referencia/` |
| `/discover-confidence` | <1k | Deterministic Python; ~0 LLM tokens |
| `/discover-improve` | 10-30k | Halt-loop Phase A + Phase B |
| `/skill-writer` | 5-15k | Reads blueprint, extracts patterns, writes candidate skill |
| `/skill-validator` | <1k | Deterministic Python; ~0 LLM tokens |
| `/skill-register` | <1k | Python script (move + audit) |
| **Full chain** | **80-200k** | varies heavily based on halt-loop iterations in execute and improve |

### `cycle-implement` skill

| Skill | Typical cost | Notes |
|---|---|---|
| `/implement` | 100-300k | Halt-loop with up to 50 iterations × (RED + GREEN + REFACTOR + WIRING + COMMIT phases). Teacher/student split: COMMIT phase migrated to haiku (experimental_until=2026-07-22, see `implement-model-routing.txt`); GREEN deferred to 2026-08-22 review. Per-task saving modest until GREEN ships. |
| **Full cycle** | **100-300k** | Single skill; cost dominated by number of tasks × iterations per task. Marginal saving from current split (~5-10%) — meaningful saving requires GREEN migration after first-month review (per spike `discoveries/blueprints/teacher-student-halt-loop-spike.md`). |

### `cycle-review` skill

| Skill | Typical cost | Notes |
|---|---|---|
| `/review` | **~60k (split) / 150-250k (fallback)** | Spawns 5-7 agents; with `review-model-routing.txt` active, 4 baseline → haiku (~5k each), 1 cross-validation → opus (~40k). Falls back to all-opus when rule file missing (status quo). See `review-model-routing.txt` + § Model routing in `cycle-review.md` for the contract and rollback criteria. |
| **Full cycle** | **~60k (split) / 150-250k (fallback)** | Split mode: ~70% reduction vs all-opus baseline (per teacher-student-model-split plan D3 — experimental until 2026-06-22, no A/B baseline yet). |

### Presentation skills

| Skill | Typical cost | Notes |
|---|---|---|
| `/excalidraw` | 5-15k per diagram | Includes the mandatory render-view-fix loop (typically 2-4 iterations of view PNG + adjust JSON). Cost scales with diagram complexity (simple: ~5k; comprehensive technical: ~15k). |
| `/marp-slide` | 10-30k | Slide drafting LLM cost; `marp-cli` render itself is ~0 LLM tokens. Cost scales with slide count (8-16 slides typical) and audience research depth. |
| `/deck` | 60-150k | Orchestrates `/excalidraw × N_diagrams` + `/marp-slide`. N_diagrams typically 4-8 for a 10-16 slide deck. Always invoke `/dogfood` BEFORE generating any status-claim deck — its <1k cost prevents shipping false production claims. |
| **Full deck workflow** | **60-150k** | Single user invocation of `/deck` includes the orchestration above. Largest single skill in the ecosystem aside from `/implement` and `/review`. |

### Auxiliary

| Skill | Typical cost | Notes |
|---|---|---|
| `/ast-grep` | <1k | Standalone Rust binary; ~0 LLM tokens |

## Estimates per typical workflow

### Workflow A: Pure investigation (no code changes)

```
/discover-plan → /discover-edge-cases → /discover-execute → /discover-confidence
```

Estimated cost: **40-150k tokens**

When to use: studying `referencia/` to inform a design decision. No `/skill-writer` because we don't need a persistent skill.

### Workflow B: Investigation that produces a reusable patterns skill

```
Workflow A + /skill-writer + /skill-validator + /skill-register
```

Estimated cost: **50-170k tokens**

Use when the blueprint will be referenced by 2+ future `/to-plan` invocations.

### Workflow C: Plan + implement a small feature (no investigation needed)

```
/to-plan → /edge-case-plan → /plan-confidence → [/plan-improve] → /plan-confidence
→ /implement
```

Estimated cost: **120-400k tokens** (without review)

Use when patterns are well-understood and you're certain about the design.

### Workflow D: Plan + implement + review

```
Workflow C + /review
```

Estimated cost: **270-650k tokens**

Use before merging anything substantial to `main`.

### Workflow E: Full chain (discover + plan + implement + review)

```
Workflow B + Workflow D
```

Estimated cost: **360-830k tokens**

Use for greenfield features in a new domain you haven't investigated yet.

## When NOT to use these cycles

Token cost-saving heuristics:

| Don't use ... | When ... | Use instead |
|---|---|---|
| `cycle-review` | PR < 100 lines diff, single file | Anthropic's built-in `/review` (10-30k) |
| `cycle-discover` full chain | Question is text-shape ("what's in README") | `Read` + `Grep` direct (<1k) |
| `cycle-plan` | Change is trivial (single-line fix) | Write the change directly (<5k) |
| `cycle-implement` | Plan was simple AND tests are trivial | Manual TDD (<30k) |
| `/skill-writer` | Blueprint is one-off (no future reuse) | Skip distillation tail; keep blueprint only |
| `cycle-review` split mode | Critical security review of high-blast-radius diff | Escalate via `spawn_reviewers.py --model-override architecture=opus --model-override domain=opus` (teacher for baseline arquétipos) |

## Cost monitoring

Currently NO automated cost tracking exists. Future work:

- Add `.claude/scripts/estimate_cost.py` that reads invocation history and reports actuals
- Hook into `Stop` to log estimated cost per session to `.claude/.cost-log.jsonl`
- Compare actual vs estimate quarterly; calibrate this document

Until then, trust the estimates above and report deviations via `CHANGELOG.md` if you see >2× actual vs estimate.

## Anti-patterns

1. **Running `cycle-review` on a typo-fix PR** — wasteful; use built-in `/review`
2. **Running full `cycle-discover` to look up one function name** — wasteful; use `Grep` + `Read`
3. **Skipping `cycle-review` because "tests pass"** — penny-wise pound-foolish; bugs found at review cost 10× to fix post-merge
4. **Treating cost estimates as exact** — they vary 3-5× based on input complexity; budget for 2× the estimate

## Cross-references

- All cycle rules: `cycle-discover.md`, `cycle-plan.md`, `cycle-implement.md`, `cycle-review.md`
- Audit-trail rotation policy: `audit-trail-rotation.md`
- Loop engine convention: `loop-engine-convention.md`
