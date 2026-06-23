# Review: skills-cross-repo-flat-list

**Date:** 2026-06-23
**Reviewers (spawned agents):** 4 (architecture, tests, wiring+cross-validation, domain-memory-layer+security)
**Findings:** 11 total (BLOCKER: 0, HIGH: 0, MEDIUM: 1, LOW: 4, INFO: 6)
**Verdict:** READY_TO_MERGE

## Scope reviewed

HEAD on `develop`: `feat(skills): cross-repo flat skills listing (GET /v1/scopes/skill/:subject/all)`.

## BLOCKER / HIGH

_None._

## MEDIUM findings

### SEC-1 — prefix LIKE not index-scannable under utf8 collation (perf/DOS, NOT isolation) — DOCUMENTED follow-up
- Found by: domain+security.
- `agent_id LIKE '{subject}:%'` cannot use the default `text_ops` btree under `en_US.utf8` → Seq Scan + Sort over the `workspace_id='default'` partition (all customers, under the gateway master-key model) per request; deep `offset` compounds it. **NOT a tenant-isolation bug** (isolation is correct + tested at every input vector).
- **Resolution: ACCEPTED follow-up** (plan Drawbacks #4). Dev scale is tiny; correctness + isolation are sound. Fast-follow: add a `(workspace_id, agent_id text_pattern_ops)` index (non-destructive `CREATE INDEX`) — purely additive infra, no rework of this code. The review explicitly recommended follow-up over gating merge.

## LOW findings

### COR-1 — `q` did not escape LIKE metacharacters — FIXED inline
- Found by: domain+security. `description ILIKE '%'||$q||'%'` treated `%`/`_` in `q` as wildcards, inconsistent with `listEpisodes` (escapes) + the in-memory store (`.includes()` literal).
- **Resolution: FIXED.** `q` now uses `description ILIKE $n ESCAPE '\'` with `%${escapeLikePattern(q)}%` (store parity, literal-substring intent). Unit test updated.

### F-ARCH-5 — runtime `SkillWithRepo` carries undeclared `score:0` (cosmetic)
- `decodeSkillPayload` returns `SkillWithScore`; the spread keeps `score`. Never reaches the wire (`toDto` projects explicit fields). Type-honesty nit; non-blocking, no functional impact. Accepted.

### TQ-5 / TQ-6 — `q`+`offset` combined + `includeSuperseded` lack a real-DB assertion
- Both paths are unit-covered (SQL-shape + in-memory + handler); only the real-pgvector COMBINED assertion is absent. Non-blocking coverage refinements. Accepted (the isolation GOAL — the load-bearing concern — is proven non-vacuously).

## INFO findings

- F-1: plan ADR D3 wording said `MemoryStore`; impl correctly placed the method on the narrower `VectorStoreWithSkillInsert` (more SRP-correct). Plan wording nit.
- F-2: openapi test has no explicit `scopeSkillsAll` operationId assertion (covered transitively by `SwaggerParser.validate()`). Consistent with sibling paths.
- F-3 / INFO-1: no runtime metric (read endpoint — result IS the observable, consistent with every sibling read handler); domain `limit` uncapped (REST caps at 100; SDK same-tenant). Both deliberate/accepted.

## Cross-validation summary

- Coverage Matrix 12/12 delivered.
- Plan claims VERIFIED against diff: NO schema/migration, NO new dependency, core `VectorStore` DIP unchanged, per-repo `list`/`getAll`/`skillsHandler`/`composeFilters` byte-unchanged.
- ADRs D1 (prefix scan), D2 (route + literal `all`, no collision), D3 (store method + getAll unchanged), D4 (Memory widening + 11-key test) — code matches.

## Quality gates summary

- core unit 941 + pgvector SQL-shape; api unit 227; cross-repo + handler unit GREEN.
- GOAL vs real `ankane/pgvector:v0.5.1`: 5/5 (tenant isolation, repoId, wildcard-escape, strict-prefix, pagination, q).
- Recall integration regression: 12/12 (GOAL + round-trip + graph-aware).
- `npm run typecheck` clean; `npm run lint` zero warnings; `/code-quality` PASS.

## Security verdict (domain agent)

Tenant-isolation boundary is SOUND at every input vector: LIKE-wildcard escape (backslash-first, validated `alice%`→0 on real DB), strict-prefix `:` delimiter (al vs alice), subject-with-`:` rejected at handler (400) AND domain (InvalidScope), `workspace_id` ALSO filtered, no-prefix-row defensive skip. No input path lets subject A see subject B's skills.

## Handoff decision

**READY_TO_MERGE.** 0 BLOCKER, 0 HIGH. COR-1 fixed inline; SEC-1 (MEDIUM, perf) documented as an accepted additive follow-up per the reviewers' own recommendation; remaining LOW/INFO are cosmetic/coverage refinements.
