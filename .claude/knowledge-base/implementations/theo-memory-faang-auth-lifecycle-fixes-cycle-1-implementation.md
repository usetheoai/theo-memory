# Implementation: theo-memory-faang-auth-lifecycle-fixes-cycle-1

**Plan:** `.claude/knowledge-base/plans/theo-memory-faang-auth-lifecycle-fixes-cycle-1-plan.md` (v1.1, attested SHA256 `846994da8ffad0fc5d3156d69b228320e922f82581487a37af0689e9a2b663bb`, plan-confidence SHIPPABLE_WITH_CAVEATS 89/100)

**Started:** 2026-06-07
**Branch:** develop
**Max iterations:** 12 (7 plan tasks × ~1.5 iter avg + buffer for validation halt-loop)
**Time budget:** 4h

## Ordered task list

| Phase | Task | Files | TDD count | Wiring triad | Status |
|---|---|---|---|---|---|
| 1 | **T1.1** RED tests admin wiring | `src/server/__tests__/admin-wiring.test.ts` (NEW) | 5 (3 base + EC-1 + EC-7) | n/a (test-only) | pending |
| 1 | **T1.2** GREEN admin wiring | `src/server/app.ts` + `src/server/handlers/admin-keys.ts` + `src/server/index.ts` | (T1.1 verifies) | a:require b:require c:n/a | pending |
| 2 | **T2.1** RED tests oauth4webapi adapter | `src/server/auth/__tests__/oidc-introspect-oauth4webapi.test.ts` (NEW) | 5 (3 base + EC-3 + EC-8) | n/a (test-only) | pending |
| 2 | **T2.2** GREEN oauth4webapi adapter | `src/server/auth/oidc-introspect-oauth4webapi.ts` (NEW) | (T2.1 verifies) | a:require b:integration c:n/a | pending |
| 3 | **T3.1** RED tests CLI plumb | `src/agent-tools/__tests__/run-server-issuer.test.ts` (NEW) + `src/agent-tools/__tests__/run-mcp-server-oidc.test.ts` (NEW) | 8 (4 base + EC-2 + EC-5 + EC-6 + EC-9) | n/a (test-only) | pending |
| 3 | **T3.2** GREEN CLI plumb | `src/agent-tools/cli.ts` + `src/agent-tools/run-server.ts` + `src/agent-tools/run-mcp-server.ts` + `src/server/auth/scope-verifier.ts` (defense-in-depth) | (T3.1 verifies) | a:require b:integration c:n/a | pending |
| 4 | **T4.1** GOAL TEST e2e + sentinel | `tests/integration/auth/fixes-cycle-1-e2e.test.ts` (NEW) + `tests/integration/auth/_stub-issuer.ts` (NEW) + EC-10 afterEach cleanup | 6 e2e scenarios + 12/12 lifecycle.test.ts sentinel | a:n/a b:integration c:n/a | pending |

## Global DoD

- [ ] All 7 tasks committed
- [ ] `npm test`: 1148+17=1165 pass minimum (3 unrelated pre-existing failures stay)
- [ ] `tests/integration/auth/`: 12/12 lifecycle + 6/6 fixes-cycle-1-e2e = 18/18
- [ ] `npm run typecheck`: zero errors
- [ ] `npm run lint`: zero warnings
- [ ] File-size budget respected (adapter ≤ 200 LoC per T2.1)
- [ ] CHANGELOG.md updated under `[Unreleased]`
- [ ] Backward compatibility preserved: existing `createServer({ memory })` still boots; existing `themory server` no-flag invocation unchanged

## Validation gate (Step 5)

After IMPLEMENTATION_COMPLETE promise, run `python3 .claude/skills/implement/scripts/run_validation.py theo-memory-faang-auth-lifecycle-fixes-cycle-1`.

## Notes

- Plan attested SHA256: `846994da8ffad0fc5d3156d69b228320e922f82581487a37af0689e9a2b663bb`
- All 6 MUST FIX from `/edge-case-plan` already absorbed inline in plan v1.1 — no separate sub-tasks needed
- Honest deferral from parent cycle still applies: 3 unrelated failures in `tests/unit/examples/server-routes-contract.test.ts` are OUT OF SCOPE per cycle-implement.md Step 5.5 Forbidden list
