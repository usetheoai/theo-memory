# Iteration 7 — T3.2 + T3.3 cross-repo (theo-cloud BFF + Dashboard)

## Outcome: COMMITTED in theo-cloud `4f869c17`

## Scope (T3.2 + T3.3 combined per plan v1.5 BFF passthrough)

Cross-repo commit in `/home/paulo/Projetos/usetheo/theo-cloud/theo`:

| File | Δ | Purpose |
|---|---|---|
| `cloud/internal/themory/client.go` | +19/-1 | `ListOptions.Scope` field; `Client.List` routes to `/v1/scopes/{scope}/{userID}/memories` |
| `cloud/internal/routes/memory.go` | +3/-0 | HTTP handler parses `?scope=` query param |
| `cloud/tests/unit/themory_client_test.go` | +31/-0 | `TestTheMemoryClient_ListWithScopeRoutesToCorrectPath` (5 cases) — 5/5 PASS |
| `cloud/dashboard/src/pages/memory/memories.tsx` | +47/-19 | 4 scope tabs + URL state + EC-8 coerce + standardized columns + EC-9 scope_type Badge |
| `cloud/dashboard/src/pages/memory/memories.test.tsx` | +33/-13 | 3 new tests + 1 EC-9 update — 7/7 PASS |

## Plan v1.5 BFF passthrough rationale
Empirical evidence at `theo-cloud/theo/cloud/internal/themory/client.go:136` (pre-T3.2): `List()` was hardcoded to `/v1/scopes/user/{userID}/memories`. T3.2's "4 scope tabs filtering DataTable" required BFF + frontend coordination. Plan v1.5 amended T3.2 scope to include the BFF Go extension (TheMemory REST already supports all 4 scope types per T1.1+T2.1+T2.2 backend work; only the BFF was hardcoded).

## TDD discipline cross-repo
- **RED**: `TestTheMemoryClient_ListWithScopeRoutesToCorrectPath` fails at build time (no Scope field on ListOptions struct).
- **GREEN**: 3 BFF Go edits (struct field + List path routing + handler param parse).
- **FRONTEND**: 3 RED tests for tabs + EC-8 + EC-9 fail initially (tabs not rendered + Badge text mismatch); GREEN after the JSX edits.
- **REGRESSION**: all 7/7 dashboard tests PASS; all 5/5 new BFF tests PASS; existing BFF tests unchanged.

## Honest disclosures (Inquebrável Rule 3)
- Pre-existing failing test `TestTheMemoryClient_EntitiesPropagatesScopeQuery` (panics on nil lastRequest because Entities() early-returns for non-user scopes WITHOUT hitting stub) is NOT caused by T3.2 — verified by re-running against unstaged baseline.
- Pre-existing `login.test.tsx:460` TS6133 unused submitStub error untouched.
- T4.1 (BFF smoke against real upstream) + T4.2 (full-chain validation) remain pending — next halt-loop iterations.
- Git stash dance early in iteration accidentally reverted my client.go + memory.go + test file edits (go.work.sum conflict on pop). Re-applied + restored test file from stash@{0} via `git restore --source=stash@{0}` (Rule 4 compliant — not `git checkout`).

## Wiring triad
- (a) Caller: Dashboard `cloudFetch('/v1/memory/list?...&scope=session')` → BFF handler → BFF client → TheMemory REST. Full chain end-to-end.
- (b) Integration tests: 5 BFF unit tests + 7 dashboard component tests + 3 backend integration tests (T3.1 sentinel from prior iter) covering boundary.
- (c) Runtime metric: N/A new; `getall_temporal_fallback{count}` from T2.2 still surfaces stale-impl signal when consumer doesn't project createdAt.

## Cross-repo commits (this halt-loop)
- theo-memory (this repo): 13 commits ahead of origin/develop (5 task + 5 audit + 1 BLOCKED + 1 plan-v1.4 + 1 plan-v1.5-edit-pending)
- theo-cloud: 1 commit `4f869c17` (T3.2 + T3.3 combined)

## Remaining tasks
- T4.1 (BFF smoke against real upstream) — write integration test asserting BFF returns identical `created_at` as upstream REST per scope
- T4.2 (Full-chain validation) — observational; 7-gate full-chain smoke
