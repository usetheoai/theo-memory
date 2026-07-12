---
name: implement-auto-categorization-write-pipeline-sepa-knowledge
description: Paired knowledge skill for the auto-categorization-write-pipeline SEPA. Holds the load-bearing invariants (mirror attributed_to, operator precedence, EC-1/EC-2 fail-soft trim+cap, ADR D4 fail-soft, category_auto_assigned event, no-paper-names) so the SEPA can refresh context without re-reading the whole plan.
---

# SEPA knowledge — auto-categorization-write-pipeline

The authoritative role contract is `.claude/agents/implement-auto-categorization-write-pipeline-2026-07-12/sepa.md`.
Plan: `.claude/knowledge-base/plans/auto-categorization-write-pipeline-plan.md`.
Edge cases: `.claude/knowledge-base/reviews/auto-categorization-write-pipeline-edge-cases-2026-07-12.md`.
Precedent to mirror: `attributed_to` (`packages/core/src/domain/extraction/prompt.ts:172`, `pipeline.ts:595-597`).
