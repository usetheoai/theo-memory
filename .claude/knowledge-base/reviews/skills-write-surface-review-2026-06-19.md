# Review: skills-write-surface

**Date:** 2026-06-19
**Reviewers (spawned agents):** 3 parallel — cross-validation, security+architecture, tests+wiring
**Scope:** cross-repo (theo-memory Phases 1-2 + theo-cloud Phases 3-5)
**Verdict:** READY_TO_MERGE (the 1 HIGH + actionable MEDIUM/LOW were fixed inline + re-validated; remaining notes are documented)

## Summary

All 10 plan tasks (T1.1-T5.1) implemented across both repos; all 3 edge cases (EC-W1/W2/W3) honored; all 4 ADRs (D1 409, D2 store-only, D3 namespacing, D4 scoped DELETE) upheld; Coverage Matrix 10/10; wiring triad complete. **Store-only** verified (grep of both diffs: zero `eval`/`exec`/`child_process`/`e2b`/`modal`/`sandbox` execution surface — only prose rejecting it). **Cross-customer authoring/read isolation** verified at the gateway. The single HIGH (cross-workspace delete 500-vs-404 existence-leak) was fixed at the guard. `make e2e` GREEN (all 4 suites incl. SkillsWrite).

## Findings + resolution

| ID | Severity | Finding | Resolution |
|---|---|---|---|
| F-sec-1 | HIGH | Cross-workspace skill DELETE fell through to `LocalMemory.forget`'s `WorkspaceMismatch` (api-unmapped) → 500, leaking which `(repoId,skillId)` exist in OTHER workspaces (ADR D6 / OWASP IDOR). Delete was blocked, but the 500-vs-404 differential was a probe. | FIXED `9b22bb1` — scoped-skill `forget()` guard now also checks `workspace_id` → `MemoryNotFound` (404) AT THE GUARD (parity with the `agent_id` check); `mapDomainErrorToResponse` maps `WorkspaceMismatch`→404 (defense-in-depth). 3 cross-workspace guard unit tests added. Also closes followups #4. |
| F-sec-2 | MEDIUM | Namespace injectivity (EC-5) assumed the subject contains no `:`, unvalidated. | FIXED `177ea34` — `namespaceRepo()` helper fails closed (500) if subject contains `:`; used in ListSkills/AddSkill/ForgetSkill. Invariant now enforced, not assumed. |
| F-test-1 | MEDIUM | Whitespace-only description (zod `.min(1)` passes `"   "`) → 422 mapping branch unasserted at REST. | FIXED `9b22bb1` — api test asserts `"   "` description → 422 (InvalidSkillError mapping). |
| F-test-2 | MEDIUM | EC-W2 asserted the 201/409 status pair but not "no double-insert". | FIXED `9b22bb1` — integration asserts `getAll().length === 1` after the concurrent race. |
| F-sec-3 | LOW | Gateway `ForgetSkill` did not pattern-validate `skillID` (asymmetry vs `Forget`). | FIXED `177ea34` — `memoryIDPattern` applied to `skillID`. |
| F-test-3 | LOW | client 409 test used `strings.Contains` not `errors.Is`. | FIXED `177ea34` — `errors.Is(err, ErrSkillConflict)`. |
| F-xval-1 | LOW | MCP `forget_skill` is idempotent on MemoryNotFound (parity with the `forget` verb), diverging from the plan TDD's "typed error" wording. | ACCEPTED — deliberate parity with the canonical `forget` idempotent semantic; documented in CHANGELOG. |
| F-sec-4 | LOW | MCP `add_skill`/`forget_skill` take `repoId` from the tool arg with no per-subject namespacing. | ACCEPTED — correct for the single-tenant MCP deployment model (one process = one credential); the gateway is the multi-tenant boundary. Documented. |

No XSS (dashboard renders `code` as a JSX child — React-escaped, no `dangerouslySetInnerHTML`). Scopes correct (POST=memory:write, DELETE=memory:delete).

## Quality gates (post-fix)

- theo-memory: contract 986 pass / 0 type errors; api 186 pass; integration skills 9/9 (real `ankane/pgvector:v0.5.1`).
- theo-cloud: `go build ./...` + `go test ./internal/... ./tests/unit/` green; `make e2e` EXIT=0 — GatewayProxyRoundTrip + FullVerbSurface + SkillsBrowse + **SkillsWrite** (POST 201 / dup 409 / cross-customer delete 404 / owner delete 204).
- no-paper-names: 0 hits in new `src/**` (existing `@see` plan-path refs are allowed filesystem coordinates).
- CHANGELOG updated in both repos; ADR governance (CLAUDE.md Amendment 2026-06-19 (II)) recorded.

## Handoff decision

READY_TO_MERGE. Two release PRs to open (develop→main): theo-memory first (image rebuild), then theo-cloud — when the owner chooses to cut the release.
