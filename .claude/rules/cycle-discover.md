---
cycle: discover
phases:
  - discover-plan
  - discover-edge-cases
  - discover-execute
  - discover-confidence
  - discover-improve
  - skill-writer
  - skill-validator
  - skill-register
trigger: when a question about referencia/ (Mem0, Letta, LangMem) needs a blueprint-shaped answer
output: technical blueprint at .claude/knowledge-base/discoveries/blueprints/{slug}-blueprint.md AND (optionally) a generated patterns skill at .claude/skills/{slug}-patterns/
---

# Cycle: Discover

Source of truth for the deep-research investigation cycle over `referencia/`. Every phase below has its own SKILL.md, but the contract — chain order, anti-patterns, gates, stop conditions, rollback — lives here. SKILL.md files point HERE, not the other way around.

## Purpose

Convert a question about a reference project (Mem0 / Letta / LangMem) into:

1. A **discovery plan** declaring what to investigate (Coverage Matrix of 4 corners: tests / deps / tools / techniques)
2. A **technical blueprint** populated by deep-research over `referencia/` using halt-loop iteration
3. (Optional) A **generated patterns skill** that distills the blueprint's load-bearing knowledge into a first-class skill consumed by `/to-plan`

## Trigger conditions

Invoke this cycle when:

- A specific question about a reference project needs a structured answer beyond `Read + Grep`
- A side-by-side comparison between Mem0 / Letta / LangMem is needed
- A blueprint is required to inform a future `/to-plan` invocation (cycle-plan)

Do NOT invoke when:

- The question is text-shaped (file content, README, raw config) — use direct `Read` + `Grep`
- The reference project clone in `referencia/` is missing or stale
- A prior blueprint at `.claude/knowledge-base/discoveries/blueprints/` already covers the question

## Chain (inquebrável)

```
/discover-plan {topic-slug}
  ↓ produces .claude/knowledge-base/discoveries/plans/{slug}-plan.md
/discover-edge-cases {slug}
  ↓ incorporates MUST FIX entries; bumps plan version 1.0 → 1.1
/discover-execute {slug}
  ↓ halt-loop iterates over referencia/, populates blueprint
  ↓ emits <promise>BLUEPRINT_COMPLETE</promise> when all halt conditions met
/discover-confidence {slug}
  ↓ scores blueprint structurally (M2: research_coverage + reference_citations + completeness + smells)
  ↓ if verdict < SHIPPABLE_WITH_CAVEATS:
/discover-improve {slug}
  ↓ halt-loop refines (Phase A deterministic + Phase B LLM)
/discover-confidence {slug}    [re-score]
  ↓ if verdict ≥ SHIPPABLE_WITH_CAVEATS:
[skill distillation tail — optional, human-invoked]
/skill-writer {slug}
  ↓ produces .claude/skills/generated/{slug}-patterns/SKILL.md
/skill-validator {slug}-patterns
  ↓ if verdict == PASS:
/skill-register {slug}-patterns
  ↓ moves to .claude/skills/{slug}-patterns/, writes audit
DONE — /to-plan now discovers via Step 0 frontmatter scan
```

The cycle is **inquebrável as a contract**, not as a runtime orchestration. Today each phase is **human-invoked** sequentially — there is no orchestrator that auto-advances `/discover-plan` → `/discover-edge-cases` → `/discover-execute` → `/discover-confidence` → `/discover-improve`, and the skill-distillation tail (`/skill-writer → /skill-validator → /skill-register`) is also fully manual. Treat the chain as the recommended order; auto-orchestration is a future enhancement tracked in roadmap.

A `/discover-plan` invocation is NOT considered complete until either:

1. Final `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS (with or without skill distillation), OR
2. An honest BLOCKED report is produced (halt-loop exhausted, fabricated citation found, etc.)

## Phase contracts

Each phase has a SKILL.md with full operational detail. The contract below is the minimum each phase MUST honor.

| Phase | Input | Output | Success criterion |
|---|---|---|---|
| `discover-plan` | `{topic-slug}` + `.claude/rules/` + `referencia/{project}/` top-level + prior reports in `docs/exploration-reports/` | `plans/{slug}-plan.md` v1.0 with 10 mandatory sections, 5-10 research questions, Coverage Matrix 100% | All four corners (tests/deps/tools/techniques) mapped OR ADR-deferred |
| `discover-edge-cases` | `plans/{slug}-plan.md` | Report inline (or saved); plan may be bumped v1.0 → v1.1 with MUST FIX absorbed | Veredict OK or NEEDS ADJUSTMENT delivered honestly |
| `discover-execute` | Plan v1.x + `referencia/{project}/` (read-only) | `blueprints/{slug}-blueprint.md` populated; `.progress-{slug}.json` audit trail | `<promise>BLUEPRINT_COMPLETE</promise>` emitted (or honest BLOCKED report) |
| `discover-confidence` | Blueprint .md | JSON score report + verdict (SHIPPABLE / SHIPPABLE_WITH_CAVEATS / NON_SHIPPABLE / INVALID) | Hard caps audited; soft caps surfaced |
| `discover-improve` | Blueprint + previous confidence verdict | Patched blueprint + diff | Verdict ≥ target (default SHIPPABLE_WITH_CAVEATS) OR honest exhaustion |
| `skill-writer` | Blueprint + verdict ≥ SHIPPABLE_WITH_CAVEATS | `generated/{slug}-patterns/SKILL.md` + `.source-blueprint` marker | Candidate written without fabrication |
| `skill-validator` | Candidate skill at `generated/{name}/` | JSON report + verdict (PASS / NEEDS_REVIEW / REJECT) | 5 deterministic checks executed |
| `skill-register` | Validated candidate (PASS) | Promoted skill + audit at `reviews/skill-register-*.md` | Move + audit + (rare) settings.json patch atomic |

## Hard gates (cannot advance — BLOCK the cycle)

1. **`/discover-confidence` verdict INVALID** — Coverage corner empty OR fabricated citation. Cycle MUST loop back to `/discover-execute` (or further upstream to `/discover-plan`) to fix structural defect. NO advance to `/skill-writer`.
2. **`/skill-validator` verdict REJECT** — at least one FAIL. `/skill-register` REFUSES. Human MUST either delete the candidate OR fix and re-validate.
3. **Path declared in plan does NOT exist** — `Path.exists()` false. `/discover-execute` marks that question BLOCKED; never invents alternatives.
4. **Blueprint citation fabricated** — `/discover-confidence` will cap at 49. `/discover-improve` Phase A marks fabricated citations with `<!-- BLOCKED: path not found -->` rather than inventing replacements.

## Soft gates (advance, but require human review)

1. **`/discover-confidence` verdict NON_SHIPPABLE** — score 50-69, no hard cap. Halt-loop in `/discover-improve` runs; if no convergence, surface to human.
2. **`/discover-confidence` soft cap `soft_floor_*`** — at most SHIPPABLE_WITH_CAVEATS. Skill distillation tail still runs but candidate skill gets careful review.
3. **`/skill-validator` verdict NEEDS_REVIEW** — at least one WARN, no FAIL. Skill stays in `generated/`; human edits SKILL.md, re-runs `/skill-validator`. `/skill-register` refuses until PASS.

## Stop conditions (cycle aborts honestly — NOT a failure)

1. **`/discover-execute` halt-loop exhausted** — max iterations OR time budget. Emit promise WITH honest blocked-questions report. Blueprint is partial; `/discover-confidence` will reflect that.
2. **Fase A returns empty after 3 retries with different query variants** — mark that question BLOCKED with reason "Fase A exhausted — no hotspots". DO NOT pad with unrelated hotspots from another question's scope.
3. **Per-project time budget exhausted** — mark remaining questions for that project as BLOCKED with reason "budget exhausted". DO NOT continue silently.
4. **Coverage corner deferred via ADR in plan** — corner is intentionally empty; this is honest, not failure. Confidence will cap at SHIPPABLE_WITH_CAVEATS (not INVALID).

## Anti-patterns (NEVER do these — violates the contract)

1. **NEVER skip `/discover-edge-cases`** — Coverage Matrix flaws found here are 10x cheaper than during `/discover-execute`.
2. **NEVER run `/discover-execute` with an unincorporated MUST FIX** — fix the plan v1.0 → v1.1 first.
3. **NEVER run `/skill-writer` when blueprint verdict is INVALID or NON_SHIPPABLE** — propagates defect downstream into a first-class skill.
4. **NEVER fabricate a `referencia/` citation** — every path in plan, blueprint, generated skill MUST exist. Confidence will catch it; better to mark BLOCKED honestly.
5. **NEVER modify anything inside `referencia/`** — read-only zone, enforced by `.claude/hooks/boundary-check.sh`. No `npm install`, no `pip install`, no edits.
6. **NEVER use `cd` into `referencia/`** — investigate from project root with full paths.
7. **NEVER promote a NEEDS_REVIEW skill without human edit + re-validation returning PASS** — `/skill-register` refuses on principle.
8. **NEVER auto-overwrite an existing generated or first-class skill with same name** — `/skill-writer` aborts; human resolves manually.

## Rollback

| Artifact | Rollback procedure |
|---|---|
| Discovery plan in `plans/{slug}-plan.md` | Delete file; no further state to revert |
| Blueprint in `blueprints/{slug}-blueprint.md` | Delete file + `.progress-{slug}.json`; no further state to revert |
| Confidence report in `reviews/{slug}-confidence-*.md` | Delete file |
| Improve patches | `git diff` against the working tree; revert via standard git workflow |
| Generated skill in `generated/{name}/` | `find .claude/skills/generated/{name} -delete` (since deny rule blocks `rm -rf`) |
| Registered skill (first-class) | `mv .claude/skills/{name}/ .claude/skills/generated/{name}/` + delete audit at `reviews/skill-register-*.md` |

`referencia/` is read-only by hook enforcement — there is nothing to rollback there.

## Cross-references

- Phase SKILL.md (in chain order): `discover-plan/`, `discover-edge-cases/`, `discover-execute/`, `discover-confidence/`, `discover-improve/`, `skill-writer/`, `skill-validator/`, `skill-register/`
- Templates: `discover-plan/templates/discovery-plan-template.md`, `discover-execute/templates/blueprint-template.md`, `skill-writer/templates/generated-skill-template.md`
- Rubrics: `discover-confidence/templates/rubric-blueprint.md`
- Project rules consumed: `architecture.md` (DIP), `testing.md` (TDD pyramid), `public-copy.md` (positioning anchors)
- Companion cycle: `cycle-plan.md` consumes outputs of this cycle when patterns skills are registered

## Versioning

This cycle rule is **v1.0** as of 2026-05-21. Changes that ADD phases or hard gates are minor version bumps. Changes that REMOVE phases or soften hard gates are major version bumps requiring strategic review.
