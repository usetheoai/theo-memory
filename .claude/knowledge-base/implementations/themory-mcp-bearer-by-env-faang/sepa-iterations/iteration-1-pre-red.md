# SEPA — Iteration 1 / Task T1.1 / Phase Pre-RED

## Plan recap
- T1.1 ships 4 RED tests asserting env-driven precedence: `THEMEMORY_API_KEY` presence (no flags) → streamable-http + ApiKeyAuthVerifier + auth='api-keys'; absence/empty → stdio default.

## Findings
- INFO — Files-to-edit verified: `tests/integration/agent-tools/` exists (siblings: `public-paths.test.ts`, `the-goal.test.ts`); new file path matches plan.
- INFO — Module path verified: `src/agent-tools/transports/stdio.ts` exports `connectStdio(server)`; `src/agent-tools/transports/streamable-http.ts` exports `connectStreamableHttp(server, options)`. Both spyable via `vi.spyOn(module, 'fn')`.
- [MAJOR] — vi.spyOn caveat: ESM `.js` import targets (e.g. `from './transports/stdio.js'`) require `vi.mock()` with `__esModule: true` OR `await import()` indirection. Confirm test strategy uses module-mock pattern (not plain spyOn on import binding) — otherwise spies will not intercept the `run-mcp-server.ts` call sites and RED will give false-positive.
- [MAJOR] — Test isolation per invariant #9: every test MUST `vi.stubEnv('THEMEMORY_API_KEY', '')` in `beforeEach` + `vi.unstubAllEnvs()` in `afterEach`. Real CI env may carry `THEMEMORY_API_KEY` and silently flip stdio default. Plan T1.1 RED #2 (absence preserves stdio) is the test most at risk of false-pass.
- [MAJOR] — EC-1 absorption (invariant #10): RED #3 asserts EMPTY-STRING semantics (`THEMEMORY_API_KEY=""`). Plan invariant requires `.trim() !== ''` — confirm RED #3 also exercises whitespace-only (`"   "`) OR add a 6th regression test, else GREEN can ship `!== ''` and pass RED #3 while violating EC-1. Recommend including whitespace case in RED #3 assertion shape.
- [MAJOR] — R4 watch-item resolution: `THEMEMORY_MCP_AUTO_HTTP=0` opt-out is OUT OF SCOPE for T1.1. T1.1 covers ONLY presence/absence/empty of `THEMEMORY_API_KEY`. R4 is plan T2.x territory (opt-out semantics). Do not pre-implement; do not write RED for it now — would inflate scope and tangle resolver tests with two orthogonal env signals.
- [MAJOR] — T1.1+T1.2 atomic-commit plan is sound (both tests-only, same file), BUT commit body MUST cite both T-IDs + PRIORITY 0 sub-goal 3 rationale (a)-(d) per invariant #1. Flag at Pre-COMMIT.

## Recommended action
- Use `vi.mock('./transports/stdio.js', ...)` and `vi.mock('./transports/streamable-http.js', ...)` module-mock pattern (NOT spyOn on bare import) to ensure ESM bindings are intercepted. Add `beforeEach` env stub + `afterEach` unstub. Extend RED #3 to assert whitespace-only is also treated as absent (EC-1). Defer R4 opt-out to T2.x — do not write tests for it in this file.
