# Review: m11-routing-governance-observability

**Date:** 2026-07-22
**Reviewers (spawned agents):** 2 parallel (architecture+wiring+isolation; tests+cross-validation)
**Diff:** `8d66260^..f468097` (M11 implement) + fix-cycle `9fea184`
**Code-quality gate:** PASS_WITH_CAVEATS (89) — `2e65b42`
**Findings:** 19 total (BLOCKER: 0, HIGH: 1, MEDIUM: 3, LOW: 4, INFO: 11)
**Verdict:** READY_TO_MERGE (all HIGH + MEDIUM resolved in `9fea184`)

## HIGH (resolved)

- **F-tests-1 — M9 promotion decisions were not audited.** The ROADMAP M11 DoD is "every routing AND promotion decision" queryable-audited; only routing (remember) was wired. **FIX:** a session→global promotion (M9 reflect) now emits a fail-soft audit row (`routingAuditStore` threaded `LocalMemoryConfig` → `runReflection`; `wireMemoryFromPool` injects `PgRoutingAuditStore` for the deployed artifact). Integration test `test_m9_promotion_is_audited` proves a durable-fact reflect promotes AND records a retrievable audit row on real pgvector.

## MEDIUM (all resolved)

| ID | Summary | Resolution |
|---|---|---|
| F-tests-2 | `POST /v1/remember/batch` not audited | each batched item now records its routing decision (fail-soft). |
| F-tests-3 | routing POLICY is inert (not enforced on writes) | **disclosed honestly** (CHANGELOG): M11 ships the config + audit + isolation surface (the DoD); enforcing `defaultScope`/`llmRouting` on the write path is a named follow-up. Not an overclaim now. |
| F-tests-4 | REST 404 not proven end-to-end on real pg | added a real-pg full-stack routing-policy PUT→GET 200 roundtrip; the member cross-user 404 branch stays handler-unit-proven; the two compose the gate (CHANGELOG softened from "proven end-to-end"). |

## LOW (resolved / disclosed)

- **F-arch-2 / F-arch-3** — `routing-governance.ts` now resolves via `getPrincipal(c)` (absent → `DEFAULT_PRINCIPAL` owner) so an absent Principal passes the SAME role/isolation branch — removes a special-case grant (unreachable in prod behind bearerAuth, but consistent now). **FIXED.**
- **F-tests-5** — wired fail-soft: a throwing audit store no longer fails `POST /v1/remember` (real-pg test asserts 201). **FIXED.**
- **F-arch-6** — audit awaited on the remember hot path + always wired (grows `routing_audit`). **DISCLOSED** (retention sweep = follow-up); fail-soft covers rejections.

## INFO (clean — no action)

- **Isolation (the M11 hard gate) — AIRTIGHT.** F-arch-1: `resolveTarget` correct (member→own only, cross-user→404, admin→any, workspace always from Principal). F-arch-7: both pg stores dual-scoped (`WHERE workspace_id AND user_id`); no cross-tenant SQL path. F-arch-8: audit keying tracks the effective write scope. Proven on real pgvector (`governance-isolation.test.ts`).
- F-arch-4: fail-closed default conservative (session/off) + consistent across in-memory/pg/schema.
- F-arch-5: fail-soft primitive truly non-blocking on error.
- F-arch-9: wiring triad pillar (a) satisfied — no orphan exports (every DIP has a production caller).
- F-arch-10: DIP/layering clean (domain pg-free; adapters in infra).
- F-arch-11: migrations 0025/0026 additive, isolated, journal-consistent.
- F-tests-6/7: isolation proof real (non-vacuous); unit + handler tests behavior-asserting with edge + negative coverage.

## Cross-validation

100% of the M11 Coverage Matrix maps to committed tasks (T1.1→T4.1 + wiring). All ROADMAP M11 DoD items met: per-`(workspace,user)` config (fail-closed, admin-scoped, isolated) ✓; every routing AND promotion decision audited ✓ (fixed); isolation 404 ✓; integration test on real pgvector ✓. Dashboard is the declared cross-repo split (M4 precedent). The policy-enforcement gap is disclosed, not silent.

## Quality gates (post-fix)

- typecheck: PASS (0)
- unit: 35/35 (routing-policy 4, routing-audit 4, handler 4, memory-event 23)
- integration (real pgvector): 5/5 (store isolation, remember→audit, promotion→audit, REST roundtrip, remember-survives-audit-failure)
- M9 regression: 9 unit + 10 integration green (reflect changes safe)
- lint: 0 errors
- code-quality: PASS_WITH_CAVEATS (89) — 27 `symbol_fab_unverifiable_typescript` SOFT_FLOOR (sandbox no-registry class; typecheck authoritative), HARD=0

## Handoff decision

**READY_TO_MERGE.** No BLOCKER; the single HIGH + all 3 MEDIUM + both actionable LOW findings resolved in `9fea184`; the two disclosed caveats (inert policy, audit growth) are honest follow-ups, not defects. Proceed to `/release`.
