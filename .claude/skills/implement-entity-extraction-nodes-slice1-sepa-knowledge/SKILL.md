---
name: implement-entity-extraction-nodes-slice1-sepa-knowledge
description: Paired knowledge layer for the SEPA observing the /implement halt-loop on entity-extraction-nodes-slice1. Holds the compromise-not-spaCy (D1), 2-Postgres-tables-no-graph-DB (D2), EC-1..EC-7, Phase-7-fail-soft, and endpoint-shape-unchanged invariants the SEPA defends each iteration. Read by the SEPA for context refresh. Generated 2026-06-20 by /implement.
---

# SEPA knowledge — entity-extraction-nodes-slice1

This skill is the SEPA's knowledge layer for the implementation halt-loop. The SEPA reads it to refresh the locked invariants without re-reading every artifact.

## The invariants (defend every iteration)

| # | Invariant | Severity if violated | Source |
|---|---|---|---|
| D1 | `compromise` lazy `require` + regex fallback; OPTIONAL dep; never spaCy/Python; never hard-import in default barrel | CRITICAL | plan ADR D1 + CLAUDE.md Amendment 2026-06-20 |
| D2 | 2 Postgres tables (`entities` extend + `memory_entities`); NO graph DB | CRITICAL | plan ADR D2 |
| EC-1 | `type` in UNIQUE `(workspace_id, scope, type, normalized_key)` | MAJOR | edge-cases EC-1 |
| EC-2 | empty/short-name drop guard (extractor + persist) | MAJOR | edge-cases EC-2 |
| EC-3 | per-memory entity cap | MINOR | edge-cases EC-3 |
| EC-4 | entityBoost defaults ON + threaded to Phase 7 | MAJOR | edge-cases EC-4 |
| EC-5 | entity embedding dim == memories MAX_EMBEDDING_DIM | MAJOR | edge-cases EC-5 |
| Phase7 | fail-soft: `entity_linking_failed` event, swallow; remember() never fails | CRITICAL | plan ADR D3 / T3.1 |
| Shape | endpoint response `{entities:[{id, memory_count, last_seen_at}]}` unchanged | MAJOR | plan ADR D3 / T4.1 |
| Names | no paper names in `packages/**/src/**` | MAJOR | no-paper-names-in-code.md |

## Reference port target

The `compromise` extractor mirrors `.claude/knowledge-base/references/mem0/mem0-ts/src/oss/src/utils/entity_extraction.ts`: 4 types (PROPER/QUOTED/COMPOUND/NOUN), stoplists (GENERIC_HEADS / NON_SPECIFIC_ADJ), lazy `require` at module load with try/catch → regex fallback. Port the BEHAVIOR + stoplists; name identifiers neutrally (no `Mem0` in code).
