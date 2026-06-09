# SEPA — Iteration 4 / Task T3.1 / Phase Post-GREEN

## Plan recap
- T3.1 adds ADR D3 stderr disclosure at L196-227 of run-mcp-server.ts, gated by wasExplicit + THEOMEM_MCP_QUIET. 4 new tests (was 3 → split per SEPA SRP).

## Findings
- [MAJOR ABSORBED] Test 3 SRP violation: original `..._suppresses_disclosure_and_quiet_env_suppresses_too` combined override+quiet but only exercised override (false coverage on EC-6). **SPLIT into 2 tests:** `test_stderr_explicit_flag_suppresses_disclosure` + `test_stderr_quiet_env_suppresses_disclosure_under_env_driven_http`. EC-6 quiet escape now genuinely exercised.
- [MAJOR DEFERRED] wasExplicit DRY violation: 6-arm `||` chain at L211-215 duplicates "valid env value" predicate from resolveTransport/resolveAuthMode. Future auth mode addition would force edits in 2 places (silent drift risk). Defer to follow-up (F5) per SEPA recommendation — non-blocking.
- [MINOR — OK] JSDoc explains THEMEMORY_API_KEY exclusion, defends empty-string semantics, scope-discipline note for FC2-T1.1. Block 30 LoC at documented budget.
- [INFO] Banned-token grep clean.

## After-split verification
- Tests: 5 PASS in run-mcp-server.test.ts (was 4 + split = 5).
- Full contract suite: 1175/1177 PASS (1171 baseline + 4 new = 1175). 2 pre-existing skips. ZERO regressions.
- typecheck + lint exit 0.

## Recommended action
- PROCEED to Pre-COMMIT.
- Log F5 (wasExplicit DRY) in commit body as conscious deferral.
