# Audit trail rotation policy

> **INQUEBRÁVEL — 95% Confidence Gate**
>
> NÃO FAÇA NADA SE NÃO TIVER 95% DE CONFIANÇA.
> SEMPRE QUE PRECISAR DE UMA DECISÃO DO USUÁRIO, APRESENTE
> OPÇÕES PARA ELE ESCOLHER.
>
> Ver `/home/paulo/.claude/CLAUDE.md` § 1 (Confiança de 95%).

Source of truth for when audit artifacts in `.claude/agents/`, `.claude/knowledge-base/reviews/`, and similar staging dirs are archived or deleted.

## Why this rule exists

Several cycles produce **persistent audit trails** by design:

- `cycle-review` → `.claude/agents/review-{slug}-{date}/` (5-7 Claude Code-conformant agent .md + findings/ per invocation)
- `cycle-discover` → `.claude/knowledge-base/reviews/{slug}-confidence-*.md`
- `cycle-plan` → `.claude/knowledge-base/reviews/{slug}-confidence-*.md`
- `cycle-implement` → `.claude/knowledge-base/implementations/.progress-{slug}.json` + (since v1.3 2026-05-25) `.claude/agents/implement-{slug}-{date}/sepa.md` (agent DEFINITION — Claude Code-conformant frontmatter+body) + (since v1.4 2026-05-25) `.claude/skills/implement-{slug}-sepa-knowledge/SKILL.md` (paired knowledge skill — Claude Code Skills-spec-conformant; SEPA's knowledge layer) AND `.claude/knowledge-base/implementations/{slug}/sepa-iterations/iteration-{N}-{phase}.md` (per-iteration LOG OUTPUTS — kept OUT of `.claude/agents/` so that directory contains only agent definitions per Claude Code spec)
- `cycle-review` (since v1.1 2026-05-25) → paired knowledge skills at `.claude/skills/review-{slug}-{role}-knowledge/SKILL.md` (one per spawned agent — 4 baseline + 1-3 domain). Same Claude Code Skills spec; auto-generated alongside agents by `spawn_reviewers.py`. Rotate via same lifecycle as the paired agent (move to `_archive/` after 30 days post PR-merge).
- `cycle-discover` (`/discover-execute`) → `.claude/knowledge-base/discoveries/.progress-{slug}.json`
- `cycle-discover` skill distillation → `.claude/knowledge-base/reviews/skill-register-{name}-{date}.md`

> **Invariant: `.claude/agents/` is for agent DEFINITIONS only** (per Claude Code spec). Both `cycle-review` and `cycle-implement` v1.3+ honor this. Log outputs (findings, per-iteration SEPA responses) live under `.claude/knowledge-base/`. Pre-v1.3 cycle-implement runs that mixed logs into `.claude/agents/implement-{slug}-{date}/iteration-N-*.md` are grandfathered (legacy artifacts) and will rotate to `_archive/` per the 30-day rule below.

Without rotation, these grow indefinitely. 30 reviews/month × 7 agent files = 200+ files/month polluting `.claude/agents/`. Sluggish git operations + cognitive overhead navigating the tree.

## What gets rotated, what stays

### KEEP forever (deliberately persistent)

| Artifact | Reason to keep |
|---|---|
| `.claude/knowledge-base/discoveries/blueprints/{slug}-blueprint.md` | Architectural learnings; cited by patterns skills indefinitely |
| `.claude/knowledge-base/plans/{slug}-plan.md` (active) | Plan is contract; referenced by reviews and post-mortems. Lives here while the plan is the active contract (pre-merge). |
| `.claude/knowledge-base/plans/completed/{slug}-plan.md` (post-merge) | Same plan, post-merge. Moved here per the `Plan archived` checkbox in the plan template's Global DoD, after `/review` returns `READY_TO_MERGE` AND the PR is merged to `main`. Keeps the active `plans/` directory focused on in-flight work without losing the historical contract. |
| `.claude/knowledge-base/discoveries/plans/{slug}-plan.md` | Same — discovery plans do not have a `completed/` lifecycle today; they remain in place after their blueprint ships. |
| `.claude/skills/{name}-patterns/.source-blueprint` | Marker linking skill back to blueprint; load-bearing for `/skill-register` rollback |
| `CHANGELOG.md` entries | Inquebrável Rule 6 |

> **Note — active vs completed is lifecycle, not rotation.** The active → completed move is part of the plan's normal lifecycle (it remains KEEP forever in either location). It is NOT the same as the `_archive/` rotation below, which targets artifacts whose audit value decays over time (review findings, intermediate confidence scores, agent dirs). Never put plan files in `_archive/`.

### ROTATE periodically (audit value decreases over time)

| Artifact | When to rotate | How |
|---|---|---|
| `.claude/agents/review-{slug}-{date}/` | After the PR is merged AND 30 days passed | Move to `.claude/agents/_archive/review-{slug}-{date}/` |
| `.claude/knowledge-base/reviews/{slug}-review-*.md` | Same trigger | Move to `_archive/` sibling |
| `.claude/knowledge-base/reviews/{slug}-implement-validate-*.md` | After review accepted AND merged | Move to `_archive/` |
| `.claude/knowledge-base/reviews/{slug}-confidence-*.md` (intermediate scores) | After plan/blueprint reaches final SHIPPABLE | Keep only the LAST score; delete intermediates |
| `.claude/knowledge-base/implementations/.progress-{slug}.json` | After commit SHA is captured in the implementation md | Delete (state is now in git) |
| `.claude/knowledge-base/discoveries/.progress-{slug}.json` | After blueprint reaches final SHIPPABLE/SHIPPABLE_WITH_CAVEATS | Delete (state is now in the blueprint + confidence report) |

### DELETE outright

| Artifact | Reason |
|---|---|
| Python caches (`__pycache__/`, `.hypothesis/`, `.mypy_cache/`, `.pytest_cache/`, `.ruff_cache/`) | Already in `.gitignore`; rebuild from source |
| `.claude/skills/generated/` candidates that REJECT-ed | Per `/skill-validator` contract; never promote, never archive |
| Stale `.progress-*.json` from aborted halt-loops | Misleading state; delete + re-run skill |

## Rotation procedure (manual for now; automate later)

Quarterly (4× per year) maintenance, OR ad-hoc when a directory crosses thresholds.

### Threshold triggers

- `.claude/agents/review-*` count > 30 → rotate older than 30 days
- `.claude/knowledge-base/reviews/*.md` count > 50 → rotate intermediate-scores

### Manual procedure

```bash
# 1. Identify candidates for archival (older than 30 days, PR is merged)
find .claude/agents -maxdepth 1 -type d -name "review-*" -mtime +30

# 2. For each, move to _archive (preserving structure)
mkdir -p .claude/agents/_archive
mv .claude/agents/review-{old-slug}-{old-date} .claude/agents/_archive/

# 3. Similarly for reviews
mkdir -p .claude/knowledge-base/reviews/_archive
mv .claude/knowledge-base/reviews/{old-slug}-*.md .claude/knowledge-base/reviews/_archive/

# 4. Commit the archive move as one atomic commit
git add .claude/agents/_archive .claude/knowledge-base/reviews/_archive
git commit -m "chore(audit): rotate audit artifacts older than 30 days to _archive"
```

### Future automation (out of scope for v1.0)

Candidate implementations:

- Add a maintenance skill `/rotate-audit-trails` that runs the procedure above with a dry-run flag
- Add a GitHub Actions cron job that opens a PR with the rotation diff
- Add a pre-commit hook that warns when `.claude/agents/` has > 30 review-* dirs

These are deferred until manual rotation proves insufficient.

## What `_archive/` looks like

Standard structure:

```
.claude/
├── agents/
│   ├── _archive/
│   │   ├── review-old-slug-1-2026-01-15/   ← moved here from .claude/agents/
│   │   └── review-old-slug-2-2026-02-08/
│   └── review-current-slug-2026-05-21/      ← current, NOT archived
└── knowledge-base/
    └── reviews/
        ├── _archive/
        │   ├── old-slug-1-implement-validate-2026-01-15.md
        │   ├── old-slug-1-confidence-2026-01-15.md
        │   └── ...
        ├── current-slug-implement-validate-2026-05-21.md
        └── current-slug-confidence-2026-05-21.md
```

`_archive/` IS committed to git — it remains discoverable via `git log` and grep. Just out of the way for navigation.

## Restoring from archive

```bash
mv .claude/agents/_archive/review-{slug}-{date} .claude/agents/
git add . && git commit -m "chore(audit): restore review-{slug}-{date} from archive"
```

## Anti-patterns

1. **Deleting audit artifacts outright** — violates Inquebrável Rule 3 (extreme honesty). If a review found issues, the trail must exist somewhere in git history.
2. **Archiving before PR is merged** — premature; the review may still be relevant if the PR is iterating.
3. **Rotating Python caches into `_archive/`** — they're already gitignored; just delete on disk if needed.
4. **`_archive/` in `.gitignore`** — defeats the purpose. Archive IS committed; just deprioritized for daily navigation.
5. **Bulk-rotating without 30-day grace period** — recent reviews are still actively referenced in PR conversations.

## Cross-references

- Cycles producing audit trails: `cycle-discover.md`, `cycle-plan.md`, `cycle-implement.md`, `cycle-review.md`
- Plan template (defines the `Plan archived` DoD checkbox that triggers the active → completed move): [`.claude/skills/to-plan/templates/plan-template.md § Global Definition of Done`](../skills/to-plan/templates/plan-template.md)
- Cleanup script (future): `.claude/scripts/rotate_audit.py` (not yet implemented)
