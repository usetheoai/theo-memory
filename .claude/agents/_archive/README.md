# Archive

Agents and audit artifacts moved here per `.claude/rules/audit-trail-rotation.md`.

## Why archived

- `mem-researcher.md` (2026-05-21) — superseded by `cycle-discover` which provides systematic deep-research via `/discover-plan → /discover-execute → /discover-confidence`. The mem-researcher agent was created in Phase 1 of the project for ad-hoc exploration of `referencia/`; `cycle-discover` now covers that workflow with chain inquebrável, hard gates, and audit trail. Kept here for reference.

## Restoring

```bash
mv .claude/agents/_archive/{name}.md .claude/agents/{name}.md
git add . && git commit -m "chore(audit): restore {name} from archive"
```
