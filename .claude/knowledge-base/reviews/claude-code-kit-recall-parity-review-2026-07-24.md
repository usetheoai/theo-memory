# Review: claude-code-kit-recall-parity (M14)

**Date:** 2026-07-24
**Reviewers (spawned agents):** 7 — architecture, tests, wiring, cross-validation, domain-security, domain-api-design, domain-testing
**Initial verdict:** NEEDS_FIXES (1 BLOCKER + 5 HIGH + ~10 MEDIUM + ~10 LOW)
**Post-fix-cycle-1 verdict:** READY_TO_MERGE (BLOCKER + all HIGH resolved and re-verified)

> Note: `consolidate_findings.py` failed to parse the agent YAML (it emitted a false
> READY_TO_MERGE with 0 findings / 0 reviewers). This report is authored from the agents'
> actual returned findings (the `findings/*.yaml` files are the audit trail) — the false
> aggregate was NOT honored (Rule 3).

## BLOCKER (fixed)

### F-BLOCKER-1: cross-user destructive IDOR in `update_memory` (and the shipped `forget` tool)
- **Found by:** architecture, cross-validation, domain-security, domain-api-design (4 independent agents)
- **Defect:** `update-memory-handler.ts` retired the old id via `workspaceScopedMemory(...).forget(id)`
  (workspace-only); `LocalMemory.forget` gates only workspace, never user. A user X could
  `update_memory({id: <user Y's memory in the same workspace>})` and soft-delete Y's row. The shipped
  `forget` tool (`forget-handler.ts`) had the identical hole (F-sec-2, pre-M14). The Phase-5 isolation
  test masked it: `emptyJsonLlm` returned `[]` → `remember` empty → the `forget` branch never ran.
- **Fix (commit 70ca1e1):** both handlers now route through the SUBJECT-SCOPED forget
  (`routeScopedMemory(...).forget` → `ScopedMemory.forget` → `deleteInScope` over the `(workspace,user)`
  filter). A foreign id is not in scope → `MemoryNotFound`, never a delete. The isolation test is
  de-vacuumed with a fact-extracting LLM: the forget path IS exercised, both foreign targets survive,
  and the attacker's own remember lands — 5/5 vs real `ankane/pgvector:v0.5.1`.

## HIGH (fixed)

- **F-HIGH-1 (get_memory fail-open, F-tests-4):** the cross-user gate skipped rows with NULL `user_id`.
  Now fail-closed: `item.metadata['user_id'] !== userId` hides the row (incl. null). Unit + integration proven.
- **F-HIGH-2 (no observability on the destructive surface, F-wiring-1/F-arch-2):** `forgetEntity` now emits
  `MEMORY_EVENTS.entity_forgotten` via an optional OTel tracer (wired in `run-mcp-server`). Tests:
  `test_forget_entity_emits_typed_event` + `test_forget_entity_no_event_when_nothing_removed`.
- **F-HIGH-3 (hard-delete vs plan soft-delete, F-tests-1/F-arch-3/F-wiring-2):** documented + justified in
  ADR-0022 (the entity graph is a re-extractable projection; `entities` has no `t_invalid`; the typed
  event is the audit trail). Amends ADR-M14-2.
- **F-HIGH-4 (T1.2 user attribution not wired, F-tests-3/F-xval-2):** `detectUserRememberDirective`
  (EN/PT) added to `theo-prompt-recall`; an explicit user "remember this" now fires an `attributedTo:'user'`
  capture. Real production trigger + tests.

## MEDIUM / LOW (addressed or accepted with rationale)

- **F-api-4 (LOW):** `EntityForgetScopeError` now maps to a self-correctable execution error in `classifyError` (+ test).
- **F-api-5 (LOW):** `list_entities` now returns `type` + `summary` (parity with REST `/entities`).
- **F-domtest-3 / F-tests-10 (benchmark measures over-fetch touch):** ACCEPTED — the metric is a faithful,
  deterministic predictor of the live `last_accessed_at IS NULL` goal; the JSON `note` documents that the
  100%→80%→5% figures reflect over-fetch coverage, not "surfaced to the agent". No live 48h psql number was
  captured (no valid embedding key in this env) — disclosed honestly, not fabricated.
- **F-xval-4 (recall + onboard not in isolation.test.ts):** ACCEPTED — recall cross-user isolation is already
  proven by the M8 `cross-user-isolation.test.ts`; `onboard` writes only to the Principal's own scope (unit
  `test_onboard_scoped_to_principal` proves no identity in the body; it has no cross-user read/delete surface).
- **F-tests-6/F-tests-7/F-domtest-2 (positive scoped-forget integration + concurrency):** the subject-scoped
  forget positive path is now integration-tested via the de-vacuumed `update_memory` case (real pgvector);
  `forgetEntity` orphan-edge safety is structural (single atomic `runInTx` transaction — BEGIN/COMMIT).
- **F-api-3 (plugin.json invented `hooks[]` shape):** ACCEPTED with disclosure — the manifest is a
  distribution descriptor for the kit's hook set + `/onboard`; the real hook wiring is `merge-settings.mjs`.
  Aligning to the exact Claude Code plugin spec is a follow-up (does not affect the shipped hook behavior).
- **F-arch-5 / F-api-6/7 / docs-stale (LOW):** cohesion/comment/doc polish — non-blocking.

## Quality gates (post-fix-cycle-1)

- `npm test` (unit): **1318 passed, 0 failed, 1 skipped**
- `npm run typecheck`: **clean**
- `npm run test:integration` (kit + entities + mcp + graph vs real `ankane/pgvector:v0.5.1`): **51/51**;
  full suite green except 2 pre-existing LLM-determinism flakes (proven pre-M14 by stash)
- `/code-quality`: **PASS (100, zero findings)**
- Isolation HARD GATE (`isolation.test.ts`): **5/5** — cross-tenant + cross-user for all 4 surfaces + #252 abort
- Benchmark: never-read 100% → 80% (constant) → 5% (per-prompt), deterministic vs real pgvector

## Spawned agents (audit trail)

- `.claude/agents/review-claude-code-kit-recall-parity-2026-07-24/{architecture,tests,wiring,cross-validation,domain-security,domain-api-design,domain-testing}.md`
- Findings: `.claude/agents/review-claude-code-kit-recall-parity-2026-07-24/findings/*.yaml`

## Handoff decision

**READY_TO_MERGE** — the BLOCKER and every HIGH are fixed and re-verified against real pgvector; the
MEDIUM/LOW are addressed or accepted with explicit rationale. Proceed to `/release`.
