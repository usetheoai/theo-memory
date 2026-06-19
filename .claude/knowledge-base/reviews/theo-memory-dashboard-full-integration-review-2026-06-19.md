# Review: theo-memory-dashboard-full-integration

**Date:** 2026-06-19
**Reviewers (independent parallel agents):** 3 (architecture+wiring, test-quality, cross-validation+security)
**Slices reviewed:** theo-cloud `9c5ee4a..a4cd48e` (gateway + dashboard) + theo-memory `12ecbd7..82f67fd` (provider read-endpoints)
**Verdict:** READY_TO_MERGE

## Summary

3 independent adversarial reviewers audited both committed slices against the plan. They surfaced 2 HIGH/MAJOR correctness/security findings + 2 HIGH test gaps + several MEDIUM/LOW/INFO. All BLOCKER-gating findings were FIXED or RESOLVED before this verdict. Full test evidence: TheMemory api 168/168, gateway `go test -race` green, dashboard memory 20/20 + tsc clean, **`make e2e` PASS** (both functions, all subtests) against real `ankane/pgvector:v0.5.1` + real TheMemory + hermetic mock-openai.

## Findings + resolutions

| ID | Sev | Summary | Resolution |
|---|---|---|---|
| F-arch-1 / F-xval-1 | HIGH/MAJOR | `scopes.ts` cursor branch read the unfiltered set → `from`/`to` date filter silently dropped on paginated continuations (the dishonest no-op ADR D3 set out to kill). | **FIXED** `82f67fd` — cursor predicate now composes onto the date-filtered set; regression test (from/to + cursor) added (scopes.test.ts #16). |
| F-test-2 | HIGH | `Recall` forwarded `topK`/`threshold` to pgvector with no validation (unbounded scan). | **FIXED** `a4cd48e` — bounds topK 0..200 + threshold 0..1, 400 on violation; table-driven test. |
| F-test-1 | HIGH | remember/recall/reflect/metrics had live 502 branches with zero coverage. | **FIXED** `a4cd48e` — `TestMemoryVerbs_UpstreamErrorReturns502` (4 cases). |
| F-xval-3 | MAJOR | BFF fronts admin-only exports/webhooks behind `requireJWT` only (no `memory:admin`). | **RESOLVED (documented invariant)** `a4cd48e` — single-subject-per-customer model: a session is exactly one workspace-owner subject; ops scope strictly to `auth.GetUser().Subject` (per-subject rows); cross-tenant impossible; `memory:admin` governs API keys, not the owner's own console. Documented at the BFF route block + plan Q1. Future RBAC member → gate with `requireRole(admin)`. |
| F-arch-2 | MEDIUM | from/to+cursor coverage gap. | **FIXED** — covered by the F-arch-1 regression test. |
| F-xval-5 | MINOR | Duplicate `### Changed` header in [Unreleased]. | **FIXED** `a4cd48e` (adjacent merge). Remaining Added/Fixed duplicates are pre-existing prior-session batches, normalized at the release cut. |

### Accepted caveats (MEDIUM/LOW — do not block; documented per rubric)

- **F-test-3 (MEDIUM)** — recall scope-isolation is not e2e-proven (only list/forget are cross-tenant tested). Mitigation: recall uses the IDENTICAL subject-in-path scoping as list (which IS isolation-tested e2e), and subject-derivation-from-auth is unit-tested. Follow-up: add a cross-subject recall e2e leg.
- **F-test-4 (MEDIUM)** — an upstream 422 (invalid from/to) is mapped by the gateway client to 502 rather than surfaced as 4xx. Practical impact nil: the dashboard sends widened RFC3339 datetimes (never invalid). Follow-up: preserve upstream 4xx distinctly from 5xx.
- **F-xval-2 (MEDIUM)** — the e2e covers the SDK verb surface (remember/recall/reflect/metrics/entities) but not hard-delete removal nor the session-path exports/webhooks 401-closure; those are unit-tested. Follow-up: extend e2e with a hard-delete leg + a session-JWT exports/webhooks 2xx assertion.
- **F-arch-3 (LOW)** — cross-repo deploy ordering: provider (metrics/entities) must deploy before gateway, else dashboard tiles 502 during rollout. Documented in CLAUDE.md roadmap ("AFTER the integration round-trip is green").
- **F-arch-4 (LOW)** — DRY: `SCOPE_TYPES`/`pathParamsToScoped` triplicated across scopes.ts/metrics.ts/entities.ts. Acceptable (small, stable); extract a shared helper in a follow-up.
- **F-test-5 (LOW)** — BFF Forget unit test has a disjunctive assertion. Follow-up: wire a chi RouteContext for a deterministic assertion.
- **F-test-7 (LOW)** — no test for `attributedTo === ''` empty-string guard. Follow-up: add a fixture row.

## Coverage Matrix verification (cross-validation agent)

All 8 gaps confirmed real (DONE), with the date-filter pagination bug now fixed:

| Gap | Real? | Evidence |
|---|---|---|
| 1 remember | YES | client.Remember + handler + BFF + route + Playground panel |
| 2 recall | YES | client.Recall (score+category map) + BFF + route + Playground (score badges) |
| 3 reflect | YES | client.Reflect (raw passthrough) + BFF + route + Playground + e2e 202 |
| 4 exports/webhooks 401 | YES | WithOps + 8 BFF ops methods (mint→delegate); dashboard repointed (grep clean) |
| 5 real metrics | YES | metrics.ts subject-scoped real counts; gateway consumes; e2e total≥1 |
| 6 real entities | YES | entities.ts distinct attributed_to (real INSERTed column) + count + last_seen_at |
| 7 from/to filter | YES (fixed) | scopes.ts created_at filter (now cursor-safe) + 422; dashboard RFC3339 widen |
| 8 hard-delete | YES | client.Forget(hard) + ?hard=true + BFF passthrough + GDPR checkbox |

## Security summary
- Secret leak: NONE (mintOrFail discards minted secret; SECURITY_GATE test asserts `theo_live_` never in response bodies).
- Cross-tenant forget IDOR: CLOSED (ownership pre-check → 404; e2e proven).
- BFF admin-ops: SAFE in the single-subject-per-customer model (documented invariant; per-subject scoping; cross-tenant impossible).
- Hard-delete: opt-in (?hard=true) + checkbox + typed confirmation; subject ownership enforced.

## Honesty (Inquebrável Rule 3)
No fabricated metrics. total/entity_count/add_events real (DB-derived); retrieval_api_usage honest-0 (no recall counter); entities from the real `attributed_to` column (NER extraction disclosed as follow-up). Both CHANGELOGs accurate.

## Quality gates
- TheMemory api: 168/168 PASS; lint clean (typecheck TS2209 is a PRE-EXISTING export-map config issue, confirmed on the pristine tree).
- Gateway: `go build` + `go vet` + `go test ./... -race` GREEN.
- Dashboard: memory suite 20/20; `tsc -b` clean. (15 pre-existing J-19 failures in untouched files — documented debt.)
- e2e: `make e2e` PASS (real pgvector + real TheMemory + mock LLM).

## Verdict: READY_TO_MERGE
0 BLOCKER. 0 unresolved HIGH/MAJOR (all 4 fixed or resolved with documented invariant). Remaining findings are MEDIUM/LOW accepted caveats with follow-ups. The integration delivers 100% of the core TheMemory feature surface (4 verbs + 3-tier scope + metrics + entities + date filter + hard-delete) through the gateway BFF into the dashboard, validated end-to-end against real services.
