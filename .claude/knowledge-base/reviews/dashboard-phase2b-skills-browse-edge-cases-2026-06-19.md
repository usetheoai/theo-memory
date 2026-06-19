# Edge Case Review — dashboard-phase2b-skills-browse

Date: 2026-06-19
Tasks analyzed: 9 (T1.1, T1.2, T2.1, T2.2, T3.1, T3.2, T3.3, T4.1, T5.1)
Edge cases found: 6 (MUST FIX: 1, SHOULD TEST: 3, DOCUMENT: 2)

The plan is strong: D3 (per-customer repo namespacing) + the e2e isolation leg already close the highest-severity security edge (cross-customer skill leak), and the Failure scenarios section covers upstream 5xx / null / empty. The gaps below are a workspace-isolation parity hole (MUST FIX), three render/transport robustness tests, and two accepted-risk documentation items.

## MUST FIX

### EC-1: Skills endpoint must resolve the workspace exactly like the memories endpoint (multi-tenant-rbac parity)

- **Affected task:** T2.1 (and T1.1's filter)
- **Family:** Permission
- **Scenario:** The memories endpoint resolves the authenticated workspace from the Principal (multi-tenant-rbac-and-slice1-completion threads `workspace_id` into `getAll`/`composeFilters`). If the new skills handler calls a bare `memory.skills(repoId)` WITHOUT the same workspace binding, `LocalScopedSkillMemory` falls back to `workspace_id='default'` (per `scoped-skill-memory.ts` ADR D7). On a multi-workspace deployment that either (a) lists the wrong workspace's skills or (b) returns empty for a non-default workspace — a cross-workspace correctness/isolation defect of the same class the metrics/entities work guarded against.
- **Impact:** wrong-workspace skill listing OR silent empty result on non-default workspaces; bypasses the multi-tenant-rbac `workspace_id` isolation the rest of the surface enforces.
- **Suggested fix:** in T2.1, resolve `memory.skills(repoId)` through the SAME workspace-bound `Memory` the memories handler uses (the Principal/workspace resolution already wired in `createServer`/`pathParamsToScoped`); add a plan note + a test asserting a skill written under workspace A is NOT returned when the request resolves workspace B.

## SHOULD TEST

### EC-2: repoId containing `/` (or other path-reserved chars) reaching the TheMemory path segment
- **Affected task:** T2.1, T3.1
- **Suggested test:** `test_skills_repoId_with_slash_is_handled` — assert the gateway client `url.PathEscape`s the (namespaced) repoId AND the TheMemory route still resolves the single `:repoId` segment (or returns a clean 400, not a route-miss 404). A repoId like `org/repo` must not silently 404 via path-segment splitting.

### EC-3: derived skills have `code = null` / `codeLanguage = null` — dashboard render
- **Affected task:** T4.1
- **Suggested test:** `test_SkillsPage_renders_null_code_skill` — assert a skill row with `code: null` (a consolidated/derived skill) renders without crashing (empty/“—” code cell), since `getAll()` includes derived head-of-chain skills (Q1 decision: INCLUDE).

### EC-4: result truncated at the `topK` cap — honest "showing first N" indicator
- **Affected task:** T2.1, T4.1
- **Suggested test:** `test_skills_listing_truncation_disclosed` — when a repo has more skills than the cap, assert the response/UI honestly indicates truncation (e.g. `skills.length === cap` → dashboard shows "showing first N"). Closes the Q3 silent-truncation gap (Inquebrável Rule 3 honesty) without adding cursor pagination now.

## DOCUMENT

### EC-5: namespacing separator assumes the subject does not contain `:`
- **Accepted risk:** D3 composes `{subject}:{repoId}` and bars `:` in repoId, making the concatenation injective GIVEN subjects contain no `:`. Kratos UUID/email subjects satisfy this today. If a future identity provider allows `:` in the subject, two (subject, repoId) pairs could theoretically collide. Documented as an assumption in D3; revisit only if the subject charset changes (then use a length-prefixed or non-printable separator).

### EC-6: TheMemory skills endpoint has no per-repo ownership check (isolation is the gateway's job)
- **Accepted risk:** like the existing memories endpoint, `GET /v1/scopes/skill/:repoId/skills` lists whatever repoId is requested for the authenticated key's workspace — there is NO per-repo ownership enforcement at the TheMemory layer. This is consistent with the shipped single-tenant-per-deployment / workspace-keyed model; the gateway's D3 namespacing is the multi-tenant isolation boundary. A direct SDK/REST caller with a valid key can list any repoId in its workspace by design (it owns the workspace). Documented; matches the entities/metrics precedent.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 1 | 1 (EC-1 filter) | 0 | 0 |
| T2.1 | 4 | 1 (EC-1) | 2 (EC-2, EC-4) | 1 (EC-6) |
| T3.1 | 1 | 0 | 1 (EC-2) | 0 |
| T3.2 | 1 | 0 | 0 | 1 (EC-5) |
| T4.1 | 2 | 0 | 2 (EC-3, EC-4) | 0 |

**Verdict:** PLAN NEEDS ADJUSTMENT — absorb EC-1 (MUST FIX: workspace resolution parity) into T2.1 + T1.1; fold EC-2/EC-3/EC-4 into the respective task TDD; record EC-5/EC-6 as DOCUMENT notes in the ADRs. All fixes are ≤1 sentence or a test — no new modules, no scope creep.
