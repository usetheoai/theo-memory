# Discover Edge Case Review — m11-routing-governance-observability

Date: 2026-07-22
Discovery plan analyzed: `.claude/knowledge-base/discoveries/plans/m11-routing-governance-observability-plan.md`
Research questions analyzed: 6
Edge cases found: 5 (MUST FIX: 1, SHOULD TEST: 2, DOCUMENT: 2)

## MUST FIX

### EC-1: Q1/Q6 cite DIRECTORY paths — execute must Read specific files, not the dir
- **Affected question:** Q1 (`mem0/mem0/configs/`), Q6 (`mem0/server/`)
- **Family:** Method
- **Scenario:** `/discover-execute` runs `Read mem0/mem0/configs/` (a directory) → error or a listing, not the config-class content the question needs.
- **Impact:** the answer to "what fields does a per-instance config carry" stays empty → `plan_completeness` methodless flag, thin blueprint.
- **Suggested fix:** the execute MUST first `ls`/Glob the directory, then Read the concrete config file (e.g., the base config module + the memory config class) — one extra `ls` step before each directory-rooted Read.

## SHOULD TEST

### EC-2: Q3 may find NO placement-decision audit in either reference (absence is a valid answer)
- **Affected question:** Q3 (queryable audit of a memory's placement/mutation)
- **Suggested halt-loop checkpoint:** before marking Q3 done, if neither ref exposes a placement-audit record, the blueprint MUST record "absent in refs" explicitly and pivot the grounding to the theo-memory reuse target (recall-trace store + M9 `consolidation_history`, ADR D2) — an honest "the field does not exist upstream; we reuse our own governance" is the correct outcome, NOT a fabricated citation.

### EC-3: --depth 1 clones may have moved the cited config classes since the clone date
- **Affected question:** Q1, Q2, Q5
- **Suggested halt-loop checkpoint:** if the exact cited file is absent (path drift), fall back to a repo-wide grep for the class/symbol name (`class .*Config`, `SearchConfig`, `pydantic`) before declaring the citation fabricated — the directory exists (verified 2026-07-22), so drift is within-repo, not a missing clone.

## DOCUMENT

### EC-4: Q6 (dashboard/REST surface) can scope-creep into auditing the whole mem0 server
- **Accepted risk:** the stop criterion is "name the endpoint shape + the per-scope distribution view", NOT a full audit of `mem0/server`. The blueprint records the endpoint/observability SHAPE mapped onto theo-memory's own `GET/PUT /v1/routing-policy` + `GET /v1/routing-audit`; it does not need mem0's full route table (KISS).

### EC-5: Q3 "audit fields" from a graph product (graphiti) may not map 1:1 onto a relational audit row
- **Accepted risk:** graphiti's episodic/edge provenance is graph-shaped; theo-memory's audit is a relational row reusing the recall-trace store. The blueprint maps the CONCEPT (who/when/what/why), not the storage shape — ADR D2 already frames this as reuse of the shipped Postgres governance machinery, not a graph port (Item 14 stays declined).

## Summary

| Question | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|----------|-------------|----------|-------------|----------|
| Q1 | 2 | 1 (EC-1) | 1 (EC-3) | 0 |
| Q2 | 1 | 0 | 1 (EC-3) | 0 |
| Q3 | 2 | 0 | 1 (EC-2) | 1 (EC-5) |
| Q5 | 1 | 0 | (EC-3) | 0 |
| Q6 | 1 | 1 (EC-1) | 0 | 1 (EC-4) |

**Verdict:** DISCOVERY PLAN OK (1 MUST FIX — the directory-vs-file Read method — absorbed as a per-Read `ls`-first step in `/discover-execute`; the rest are SHOULD-TEST checkpoints / accepted DOCUMENT risks). No new reference project, no scope expansion.
