# Review: skills-subject-prefix-index (M2 / SEC-1)

**Date:** 2026-06-23
**Reviewers (spawned agents):** 5 — architecture, tests, wiring, cross-validation, domain-database
**Findings:** 30 total (BLOCKER: 0, HIGH: 0, MEDIUM: 1, LOW: 4, INFO: 25)
**Verdict:** READY_TO_MERGE

## Scope reviewed

Commit `c394831` on `develop`: a single additive partial composite btree index `idx_memories_skill_subject_prefix` on `(workspace_id, agent_id text_pattern_ops) WHERE kind='skill' AND t_invalid IS NULL` (migration 0021) to make `PgvectorStore.listSkillsBySubject`'s `agent_id LIKE '{subject}:%'` prefix index-range-scannable (SEC-1). Files: `schema.ts` (index decl), `0021_shallow_fenris.sql`, `meta/0021_snapshot.json`, `meta/_journal.json`, `tests/integration/skills-subject-prefix-index.test.ts`, `CHANGELOG.md`. No query/API change.

## BLOCKER / HIGH

None.

## MEDIUM

### F-dom-db-4 (MEDIUM) — plain blocking `CREATE INDEX` (not `CONCURRENTLY`) — ACCEPTED WITH CAVEAT (pre-existing, systemic; NOT specialized for 0021)
- Found by: domain-database. A plain `CREATE INDEX` takes a SHARE lock on `memories`, blocking concurrent writes for the build duration. On a large write-hot production table this is a deploy-time write stall.
- **Disposition: ACCEPT for SEC-1.** Honest rationale (the domain agent's own recommendation):
  1. `CREATE INDEX CONCURRENTLY` **cannot run inside a transaction block**, and the repo's Drizzle `migrate()` runs every migration in a tx — so CONCURRENTLY is not a drop-in swap; it would require pulling the DDL OUT of the migration into an out-of-band ops runbook, breaking the single-source-of-truth migration discipline.
  2. This is a **PROJECT-WIDE pre-existing property** — every prior partial-index migration (`0005`, `0008`, `0009`) is a plain in-tx `CREATE INDEX`. 0021 inherits the pattern; it is NOT a regression introduced by this change.
  3. The `memories` table is **pre-release at trivial scale** (CI `ankane/pgvector:v0.5.1`); the lock window is negligible today.
  4. Special-casing 0021 alone to CONCURRENTLY would DIVERGE from precedent for zero SEC-1 benefit (anti-pattern). The `IF NOT EXISTS` keeps a future CONCURRENTLY re-creation path non-conflicting.
- **Action:** recorded as a project-wide ops followup (roadmap M4) to decide a large-table CONCURRENTLY runbook before TheoCloud GA / any large production `memories` table. Does NOT block the SEC-1 merge.

## LOW

- **F-xval-7 (LOW) — FIXED:** the implement-validate report's Coverage Matrix was truncated (open fence, no rows). Completed inline — the 9-row matrix is now rendered + fence closed.
- **F-arch-4 / F-dom-db (LOW) — ACCEPTED (by design):** the index does not serve the residual `superseded_by IS NULL` + `description ILIKE` filters (`text_pattern_ops` cannot serve ILIKE; the `agent_id` prefix is the selective clause). Documented in plan Drawback #5.
- **F-dom-db-2 (LOW) — ACCEPTED (forward-correct):** leading `workspace_id` is non-selective TODAY (all tenants share `'default'`), so it is effectively dead weight now; the composite is the forward-correct choice for when multi-tenant workspace isolation lands (becomes selective with zero migration). Honest disclosure recorded.
- **F-dom-db-3 (LOW) — ACCEPTED (out of scope):** the index does not serve `ORDER BY created_at DESC` (a small post-scan sort remains over the per-tenant result set); SEC-1 scope is eliminating the Seq Scan, not the sort. Cheap at per-tenant skill volumes.
- **F-tests-3 (LOW) — ACCEPTED (parity):** test bodies omit explicit AAA comment labels, matching the sibling `skills-cross-repo-flat-list.test.ts` convention; test names are behavior-describing, no "and". Optional hygiene, out of scope.

## Test-integrity verdict (tests agent)

PASS. NON-VACUOUS (both missing-index and wrong-opclass regressions are genuinely reachable and fail the suite — proven via the live RED run showing `agent_id ~~ 'alice:%'` as a Filter), DETERMINISTIC (`skipIf` + isolated DB + ~2000-row seed + ANALYZE + `enable_seqscan=off` + literal prefix — zero flake surface), and the dual structural (`pg_indexes` opclass) + behavioral (`EXPLAIN` Index Cond) assertion is the strongest form of the proof. All plan edge cases (EC-1..EC-4, Drawbacks #2/#3/#6) covered.

## Cross-validation summary

Plan tasks 3/3 fully implemented; ADRs D1-D3 all respected (text_pattern_ops not pg_trgm; composite leading workspace_id + partial; generated via drizzle-kit + schema.ts source of truth); EC-1 (literal-pattern EXPLAIN) + EC-4 (unnamed-statement custom plan) honored; query string UNCHANGED (no API divergence); CHANGELOG accurate (Fixed, SEC-1). No claimed-done-but-missing, no divergence, no post-implement plan edit.

## Wiring summary

SQL-index-migration shape (no new export → no classic triad): (a) caller = the unchanged `listSkillsBySubject` query (planner-level consumer); (b) integration test = the new GOAL; (c) runtime metric = N/A (an index is a transparent accelerator). Migration applied by `runMigrations`→`migrate()` (journal idx 21 == filename tag); shipped in pack manifest + copied to dist; partial predicate is a subset of the query constants (not an orphan index); schema.ts ↔ generated SQL ↔ snapshot agree (drizzle-kit generate = no-op, no drift).

## Quality gates

- `npm run typecheck`: PASS · `npm run lint`: PASS · `npm run build`: PASS
- New GOAL 2/2 · cross-repo GOAL 5/5 · schema-snapshot-parity PASS · publish-readiness PASS · `/code-quality` PASS (score_cap 100)

## Spawned agents (audit trail)

- .claude/agents/review-skills-subject-prefix-index-2026-06-23/architecture.md
- .claude/agents/review-skills-subject-prefix-index-2026-06-23/tests.md
- .claude/agents/review-skills-subject-prefix-index-2026-06-23/wiring.md
- .claude/agents/review-skills-subject-prefix-index-2026-06-23/cross-validation.md
- .claude/agents/review-skills-subject-prefix-index-2026-06-23/domain-database.md

## Handoff decision

**READY_TO_MERGE.** 0 BLOCKER, 0 HIGH. The single MEDIUM (blocking CREATE INDEX vs CONCURRENTLY) is a pre-existing project-wide migration-strategy property, not a regression, and CONCURRENTLY is incompatible with the repo's in-tx Drizzle migration model — accepted with caveat and recorded as roadmap M4 (ops runbook before GA). All actionable LOW (F-xval-7) fixed inline; remaining LOW are by-design/parity. Pure additive infra index; no query/API change; results byte-unchanged.
