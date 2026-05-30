# SEPA brief — task T3.1 (phase: pre-RED) — iteration 6

**Verdict: OK to proceed with locked design decisions** (4 RED tests beyond plan's 5; 2 design decisions explicit).

## Locked design decisions

1. **insertDerivedSkillAtomic is OFF the DIP** — runtime-branded extension on local stores only (mirroring T2.1 pattern). Consolidate uses runtime `typeof` guard.
2. **Text projection** for `executeReflection.sourceMemories[i].text` = `description + "\n\nCode:\n" + code`. So LLM sees both signals when extracting merged skill draft.
3. **Clustering shape** — greedy union-find (KISS): when A~B and B~C above threshold, all three end up in same cluster via transitive closure. Documented inline.
4. **Provenance length ≥ 2** — after `validateProvenance`, also assert `draft.derivedFrom.length >= 2`. If not, SKIP that cluster gracefully (log via tracer if available, no throw).
5. **EC-2 in-memory** — JSDoc on `insertDerivedSkillAtomic` and consolidate Phase 3 explicitly documents "in-memory is best-effort, not atomic; for tests/dev only" per plan v1.1 EC-2 absorption line 475.

## Watchpoints honored
- Architecture: src/local/skills/consolidate.ts placement (NOT in src/core/) per ADR D4. ≤500 LoC budget.
- EC-2: insertDerivedSkill + markSuperseded wrapped in withTransaction on pgvector via combo method. In-memory sequential + documented.
- EC-3: Orient phase calls list with applySkillFilters({onlySkills:true, includeSuperseded:false}) — already shipped at T2.2.
- ADR D1: REUSE v0.4a executeReflection + validateProvenance (not a sibling chain).
- Invariants: derivedFrom.length ≥ 2 enforced post-validateProvenance; markSuperseded sets supersededBy (never delete sources, ADD-only).

## Tests beyond plan's 5
6. EC-2 atomicity sentinel (insertDerivedSkillAtomic throws mid-call; assert markSuperseded was NOT called).
7. Provenance length≥2 (LLM returns single-source draft for 2-skill cluster → skip without insert).
8. Text projection (assert sourceMemories[i].text = description + "\n\nCode:\n" + code).
9. Transitive cluster (A~B, B~C, A!~C → single cluster).
