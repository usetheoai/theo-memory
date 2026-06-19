# Review: dashboard-phase2b-skills-browse

**Date:** 2026-06-19
**Reviewers (spawned agents):** 3 parallel — cross-validation, security+architecture, tests+wiring
**Scope:** cross-repo (theo-memory Phases 1-2 + theo-cloud Phases 3-5)
**Verdict:** READY_TO_MERGE (the 1 MEDIUM + 1 actionable LOW were fixed inline; remaining findings are LOW/INFO non-blocking)

## Summary

All 9 plan tasks (T1.1-T5.1) implemented across both repos; all 6 edge cases (EC-1..EC-6) honored; Coverage Matrix 8/8; wiring triad complete (caller + integration + e2e). The security-critical property — multi-tenant cross-customer isolation (ADR D3) — was independently verified to HOLD via defense-in-depth (non-spoofable subject + `:`-reject injectivity guard + gateway-composed namespace + TheMemory's own `workspace_id` filter). `make e2e` GREEN incl. the D3 isolation leg.

## Findings + resolution

| ID | Severity | Finding | Resolution |
|---|---|---|---|
| F-1 | MEDIUM | `getAll` returned decode-time `now()` for `createdAt` (decodeSkillPayload hardcodes it), not the stored `created_at` — dashboard "Created" column showed wrong/identical timestamps. Untested in all 3 layers. | FIXED `2f6898a` — `getAll` overrides with the real `VectorStore.list` createdAt; integration regression test (UPDATE to a past date → getAll returns it) added against real pgvector. |
| EC-4 | LOW | `truncated` was a false positive at exactly `topK` (`>=` vs real tail). | FIXED `2f6898a` — handler over-fetches `topK+1`, reports `truncated` only on a real tail, slices to `topK`; exact-N no-false-positive unit test added. |
| LOW-1 | LOW | `LocalScopedSkillMemory.forget` scope guard checks `agent_id` but not `workspace_id`. | OUT OF SCOPE — the read-only browse feature does not expose `forget`. Filed as adjacent follow-up debt (see `followups/dashboard-integration-followups.md`). Pre-existing; not introduced by this cycle. |
| F-2 | LOW | Plan T2.1 "Files to edit" cites `index.ts`; actual registration is `app.ts` (re-exported via index barrel). | Doc-only divergence; no code impact. Noted for the archived plan. |
| EC-2 | LOW | theo-memory api test exercises a `:`/`.` repoId but not a literal `/`. | Unreachable in production (gateway `url.PathEscape`s before transit; Go-side test covers the escaping). Test-completeness gap only. |
| F-3 / INFO | INFO | e2e exercises the SDK route `/v1/memory/skills` (not the BFF `/v1/dashboard/memory/skills`); code payload surfaced in DTO; no 422-branch unit test. | Acceptable: BFF is a pure mint→delegate proxy with its own unit test; code-in-browse is the intended unfrozen scope; 422 is zod-bounded. |

## Quality gates

- theo-memory: contract 975 pass / 0 type errors; api 177 pass; integration skills 4/4 (real `ankane/pgvector:v0.5.1`).
- theo-cloud: `go build ./...` + `go test ./internal/... ./tests/unit/` green; `make e2e` EXIT=0 (GatewayProxyRoundTrip + FullVerbSurface + SkillsBrowse incl. D3 isolation). 15 pre-existing dashboard failures (logs/mocks/SSE) are unrelated to this diff (confirmed: no logs/mocks files in the diff).
- no-paper-names: 0 hits in `src/**` of either repo (2 cleaned: `4e9aaef`, `c2bcec3`).
- CHANGELOG updated in both repos.

## Handoff decision

READY_TO_MERGE. Two PRs to open (develop→main): theo-memory + theo-cloud (theo-memory merges + image rebuilds first per cross-repo merge order).
