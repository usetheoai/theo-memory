# Review: multi-tenant-workspace-isolation

**Date:** 2026-06-17
**Reviewers (spawned agents):** 7 — architecture, tests, wiring, cross-validation, domain-api-design (security/IDOR), domain-db-migrations, domain-memory-layer (parallel, scoped to `23ce3d1~1..HEAD`)
**Diff base:** `23ce3d1~1` (slug-scoped; the feature was authorized in-scope under P0 via the CLAUDE.md PRIORITY 0 Amendment 2026-06-17, governance commit `0cf9104`)
**Findings (initial round):** 0 BLOCKER, ~11 HIGH (across agents, several overlapping), plus MEDIUM/LOW/INFO
**Findings (after fix round):** all HIGH resolved or honestly downgraded/deferred-with-disclosure
**Verdict:** READY_TO_MERGE

## The one that mattered — a real security leak the reviewers caught

**F-dom-api-1/2 (CRITICAL, was un-flagged by the implementer): `reflect()` cross-workspace IDOR.** `reflect` is one of the 4 PRIMARY verbs, but `PgvectorStore.recallConsolidationCandidates()` built its WHERE by tier only and OMITTED `workspace_id` — a ws-A reflect would pull ws-B's extracted rows into the LLM merge prompt AND `persistConsolidations` could soft-delete a ws-B row as "rejected" (cross-workspace READ + DESTRUCTIVE write). The implementer had wrongly lumped reflect into the T1.2 secondary-deferral bucket. **FIXED** (`1bb62f9`): added the `workspace_id` clause to the consolidation candidate query + threaded the bound workspace into the reflect-derived write so derived rows stay in the source workspace. New regression test in `workspace-isolation.test.ts` proves ws-B's row is untouched after a ws-A reflect and derived rows stay in ws-a.

## HIGH findings — resolution

| ID | Finding | Resolution | Commit |
|---|---|---|---|
| F-dom-api-1/2 | reflect() cross-workspace read + destructive IDOR | FIXED — workspace_id clause in consolidation candidates + derived-write workspace | `1bb62f9` |
| F-arch-1 / F-dom-api-3 / F-wire-2 | ADR D4 claimed a COMPILE-TIME `ScopedFilters` guard the code doesn't deliver | Honestly DOWNGRADED — plan ADR D4 + `ScopedFilters` JSDoc now state isolation is RUNTIME-enforced (withWorkspace binding + column default + IDOR goal test); `ScopedFilters` marked forward-looking (the compile-time guard is a tracked follow-up), not dead code. Inquebrável Rule 3. | `9325ba5` |
| F-arch-2 | admin `/v1/admin/keys/*` not workspace-scoped | DISCLOSED — admin key management is deployment-level in this slice (per-workspace admin delegation is the deferred membership layer); README + CHANGELOG state `memory:admin` is a deployment-operator privilege. Coverage #16 restated partial. | `4a96245` |
| F-dom-db-1 | `0016_snapshot.json` recorded the OLD dedup index → drizzle-kit would emit a spurious 0017 | FIXED — patched the snapshot index to lead with `workspace_id`; `drizzle-kit generate` now reports "No schema changes". Runtime was always safe (runMigrations reads SQL). | `9325ba5` |
| F-tests-1 / F-dom-api-4 | EC-4 (body workspaceId→400) + REST/HTTP path untested | FIXED — NEW `workspace-isolation-rest.test.ts` (3/3) exercises createServer → bearerAuth middleware → Principal injection → handler, with two real `theo_live_*` keys: cross-workspace HTTP recall isolation + EC-4 400 + unknown-key 401. | `4a96245` |
| F-tests-2 | goal test only exercised the SDK seam, not HTTP | FIXED — same REST e2e test above. | `4a96245` |
| F-xval-1 | Coverage Matrix asserted 28/28 while T1.2 was deferred | FIXED — restated 24 shipped + 4 deferred (disclosed). | `9325ba5` |
| F-wire-1 | `WorkspaceMismatch` was a dead export | FIXED — `LocalMemory.forget` now throws it for cross-workspace (handler maps to 404); aligns with Coverage #5. | `9325ba5` |
| F-wire-3 | README "every query is scoped" overclaimed (MCP→default) | FIXED — README tightened to REST-only; MCP→default disclosed. | `9325ba5` |

## MEDIUM/LOW — disposition

- **F-dom-mem-1 (MEDIUM):** the `PgEvictor` soft-delete SQL is workspace-agnostic. The `forget` path is guarded by the app-level check in `LocalMemory.forget` (throws before evict); the cron/capacity eviction path is part of the deferred T1.2 (opt-in, demo wiring already PAUSED). Disclosed.
- **F-dom-db-3 (LOW):** the migration uses `ADD COLUMN DEFAULT 'default' NOT NULL` (PG11+ metadata-default) instead of the literal add-nullable→backfill→SET-NOT-NULL recipe — safe and simpler; D5 amended to describe what shipped.
- **F-dom-api-5/6, F-dom-mem-2, F-tests-7 (LOW):** fail-open `?? DEFAULT_WORKSPACE_ID` handler default; in-memory EC-9 parity has no explicit assertion; migration test doesn't reproduce the legacy-NULL backfill ordering. All low-risk; the in-memory store isolates via its generic equality loop. Logged for the follow-up.

## Deferred (honestly disclosed, tracked follow-up `multi-tenant-workspace-isolation-secondary-stores`)

- T1.2: recall-cache (EC-8 cross-workspace cache-key), skill-store, eviction per-workspace threading — opt-in secondary surfaces, column-level safe single-workspace.
- ADR D4 compile-time `ScopedFilters` wiring into the VectorStore DIP.
- Per-workspace admin-key delegation (membership layer).
- MCP per-workspace binding (Q2).

## Cross-validation summary
- Tasks: T0.1, T0.2, T1.1, T2.1, T3.1, T4.1 shipped; T1.2 deferred (disclosed). 9 ADRs respected (D4 honestly amended).
- Governance (Inquebrável Rule 10): SATISFIED — CLAUDE.md Amendment 2026-06-17 + CHANGELOG + sign-off commit `0cf9104`; shipped work matches the declared scope.
- THE GOAL TEST `tests/integration/auth/workspace-isolation.test.ts`: 4/4 against real pgvector (cross-workspace recall empty; create-from-binding; cross-workspace forget 404 + untouched; reflect isolation). REST e2e `workspace-isolation-rest.test.ts`: 3/3.

## Quality gates
- Contract: 934 passed | 2 skipped.
- typecheck: 0 errors. lint: 0 warnings.
- Integration (workspace surface): goal 4/4 + REST 3/3 + store 3/3 + principal 5/5 + migration 5/5.
- Full integration suite (keyless, real `ankane/pgvector:v0.5.1`, clean run): **94 files / 514 passed | 61 skipped | 0 failed | 0 failed files** (520s). No regression from the workspace changes; the new workspace + REST e2e tests are included.

## Spawned agents (audit trail)
- `.claude/agents/review-multi-tenant-workspace-isolation-2026-06-17/{architecture,tests,wiring,cross-validation,domain-api-design,domain-db-migrations,domain-memory-layer}.md` (+ findings/).

## Handoff decision

**READY_TO_MERGE.** 0 BLOCKER. The single CRITICAL-class security defect the reviewers surfaced (the reflect cross-workspace IDOR on a primary verb) is FIXED and regression-tested. Every HIGH is resolved, honestly downgraded, or deferred-with-disclosure. The primary 4-verb path (remember/recall/forget/reflect) is fully workspace-isolated end-to-end (SDK seam + REST/HTTP both tested). The deferred surfaces (opt-in recall-cache/skill/eviction, compile-time guard, per-workspace admin, MCP binding) are honestly disclosed in the plan + CHANGELOG + README and tracked as a follow-up. Per Inquebrável Rule 3, no claim exceeds what the code delivers.
