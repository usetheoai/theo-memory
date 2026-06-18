# Review: multi-tenant-rbac-and-slice1-completion

**Date:** 2026-06-18
**Reviewers (spawned agents):** 7 — architecture, tests, wiring, cross-validation, domain-database, domain-auth, domain-api-design
**Diff base:** `e881a8e..HEAD` (commits `bbf8975`, `757b068`, `94b4c74`, `477f72d`, `cdb4fbe` + fix commit `df917f8`)
**Verdict:** **READY_TO_MERGE** (post-fix)

## Summary

The slice takes workspace isolation to 100% (recall-cache / skill / eviction `workspace_id` threading) and adds the full members/roles RBAC layer (users + workspace_users + `requireRole` + last-owner invariant + anti-escalation guard), replicating the `../theo-rag` reference.

The 7-agent review surfaced **1 BLOCKER + 7 HIGH + 9 MEDIUM + assorted LOW/INFO**, concentrated in `admin-keys.ts` (the key-mint path) and the T4.1 public-surface/docs. **All BLOCKER + HIGH are now fixed** (commit `df917f8`); the security invariants (IDOR 404-not-403, default-deny, last-owner concurrency, anti-escalation, fail-closed 503) are proven against real pgvector. 2 MEDIUM + LOW items are accepted with documented rationale (below).

## Verdict math (per cycle-review § Verdicts)

- BLOCKER: **0** (1 found → fixed).
- HIGH: **0 open** (7 found → 6 fixed, 1 dismissed with rationale).
- MEDIUM: 2 accepted-with-caveat (documented); rest fixed.
- → **READY_TO_MERGE**.

## BLOCKER (fixed)

### F-dom-auth-1 / F-dom-db-1 — key-mint INSERT omitted `workspace_id` (cross-tenant credential misplacement)
- Found by: domain-auth + domain-database (independent corroboration).
- `createKeyHandler` INSERT (both bootstrap + non-bootstrap) omitted `workspace_id` → every minted key fell back to the schema default `'default'` regardless of the minting admin's workspace, AND decoupled the anti-escalation guard's role check (against `callerWorkspace`) from runtime role resolution (joined on `workspace_id='default'`).
- **Fix (`df917f8`):** caller workspace+role resolved unconditionally from the credential; both INSERTs stamp `workspace_id = callerWorkspace`. Regression test added (`workspace-rbac.test.ts` — a wsrbac admin's minted key carries `workspace_id='wsrbac'`).

## HIGH

| ID | Summary | Disposition |
|---|---|---|
| F-dom-auth-2 | Caller role failed OPEN to `owner` on lookup miss | **FIXED** — default-deny `member`; 503 on backend error. Regression test added. |
| F-dom-db-2 (=F-arch-3/F-wire-2) | `insertDerivedSkill` omitted `workspace_id` (public-surface cross-workspace leak) | **FIXED** — column + param added (parity with sibling inserts). |
| F-xval-1 (=F-arch-1/F-wire-1) | Anti-escalation inlined SQL; `getMemberRole` DIP dead (ADR D4) | **FIXED** — target lookup wired through `MembersRepository.getMemberRole` (inline fallback for stub-pool unit tests). |
| F-xval-2 (=F-dom-api-2) | api barrel didn't re-export RBAC surface (T4.1) | **FIXED** — `requireRole`/`MembersRepository`/`WorkspaceRole`/`roleSatisfies` re-exported from `@usetheo/memory-api`. |
| F-xval-3 | `public-surface-rbac.test.ts` (T4.1) missing | **FIXED** — contract test created (4 cases, green). |
| F-dom-api-1 | OpenAPI omitted `/v1/members` | **FIXED** — 4 routes registered with full response schemas. |
| F-dom-auth-3 | Bootstrap-token path skips the anti-escalation guard | **DISMISSED (rationale):** the bootstrap token is a one-time deployment secret that already grants owner-equivalent power (it mints the first admin key); binding within the `default` workspace is inside its trust boundary. Not an escalation beyond what possession of the token already confers. Tracked as a hardening note. |

## MEDIUM

| ID | Summary | Disposition |
|---|---|---|
| F-dom-auth-5 | Key rotation dropped `user_id` + `workspace_id` | **FIXED** — rotated key preserves both from the old row. |
| F-dom-db-3 | `setRole`/`remove` lock-order deadlock (different-target concurrent demotions) | **FIXED** — single workspace-wide `FOR UPDATE` acquisition; last-owner invariant preserved. |
| F-dom-auth-6 | `requireScope` lacked try/catch → 500 vs 503 inconsistency | **FIXED** — fails closed with 503. |
| F-dom-api-3 | `/v1/members` returned 400 for body-validation (vs 422 elsewhere) | **FIXED** — now 422. |
| F-dom-api-4 | README stale `Principal { workspaceId, scopes }` | **FIXED** — `{workspaceId,userId,role,scopes}`. |
| F-arch-2 | `recall_cache.workspace_id` column not read/written (dead) | **ACCEPTED (rationale):** isolation is enforced by the `ws:<id>|` scope-key prefix (proven by `cache-skill-eviction-isolation.test.ts` — distinct keys, no cross-hit). The column is a reserved denormalization; making it a redundant `AND` clause would expand the SERIALIZABLE-tx surface for no isolation gain. |
| F-arch-4 | `admin-keys.ts` over 500-LoC budget | **ACCEPTED (caveat):** the file aggregates the 5 key-lifecycle handlers; the DIP wiring removed the duplicated target SQL but the caller-resolution + INSERT widening keep it ~600 LoC. Extraction tracked as hygiene follow-up; no behavior risk. |
| F-dom-auth-4 | Lateral same-rank key binding (admin→admin) | **ACCEPTED (in-spec):** ADR D4 says "outranks"; equal-rank binding is by design. Flagged for owner awareness. |
| F-dom-db-4 | `ownerCount` locks all member rows | **ACCEPTED:** correct; whole-workspace serialization is acceptable at this scale (matches theo-rag). |

## LOW / test-traceability (accepted)

- F-tests-1/2 (matrix `.not.toBe(403)`, member→403 on mint route): the mint route is `requireScope('memory:admin')`-gated (covered by `scope-verifier.test.ts`); the new default-deny + BLOCKER regression tests cover the anti-escalation path concretely. Matrix strengthening tracked as a test-hardening follow-up.
- F-xval-4/5/6, F-tests-3/4/5/6: plan-named test files consolidated/relocated (assertions exist: the pg FOR-UPDATE race is in `workspace-rbac.test.ts`; the role-join default-deny is in `principal-resolution.test.ts` + the new no-membership regression). Traceability note; no coverage gap.
- F-dom-api-5: empty `:userId` → 404 (leak-free, largely unreachable). No change.

## Quality gates

- `npm run lint`: PASS (0 warnings).
- `npm run typecheck` (core contract): PASS (0 errors).
- Core contract suite: 940 passed, 2 skipped.
- api package suite: 160 passed.
- Integration suite (real `ankane/pgvector:v0.5.1`): **97 files / 537 passed / 53 skipped / 0 real failures.** (The only red file, `examples/chat-with-memory-distillation.test.ts`, is an ENVIRONMENT artifact — a stale `next dev` server left on `:3000` defeats the test's `describe.skipIf(!reachable)` gate; with `:3000` clear it passes/skips cleanly. Not caused by this slice — examples are not touched by the diff.)
- `/code-quality`: PASS (score_cap 100; 0 dead code, 0 symbol fabrication; `getMemberRole` now has a caller).

## Security invariants proven (real pgvector)

- IDOR cross-workspace → 404 (never 403), recall empty, forget untouched, reflect no-leak (`workspace-isolation.test.ts`).
- Secondary stores isolated: cache no-cross-hit (EC-8), skill isolation, eviction stays in-workspace (`cache-skill-eviction-isolation.test.ts`).
- RBAC: last-owner concurrency (FOR UPDATE, exactly-one-409), anti-escalation 403/422/200, default-deny member, minted-key-carries-workspace, 503 fail-closed, role×route matrix (`workspace-rbac.test.ts`, `workspace-rbac-matrix.test.ts`, `middleware.test.ts`).

## Spawned agents (audit trail)

- `.claude/agents/review-multi-tenant-rbac-and-slice1-completion-2026-06-18/{architecture,tests,wiring,cross-validation,domain-database,domain-auth,domain-api-design}.md`

## Handoff decision

**READY_TO_MERGE.** Slice 1 is 100% (every workspace-scoped surface isolated); Slice 2 (RBAC) is functionally complete with all BLOCKER/HIGH closed and security invariants proven against real pgvector. Accepted MEDIUM/LOW items are documented with rationale and tracked as non-blocking hardening follow-ups.
