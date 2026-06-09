# SEPA — Iteration 5 / Task T4.1 / Phase Pre-RED

## Plan recap
- T4.1 adds 14-cell precedence matrix unit tests for `resolveMcpModes`.

## Findings
- [INFO] Q1 import path: `resolveMcpModes` exported at run-mcp-server.ts:146 — `import { resolveMcpModes } from '../run-mcp-server.js'`.
- [INFO] Q2 vitest `it.each` supports table-driven tests.
- [INFO] Q3 cell 9 whitespace trim handled by EC-1 discipline at L100 + L129.
- [CRITICAL — but outcome correct] Cell 14 "garbage env + apiKey" → http+api-keys is right; naming ambiguity only. Add clearer cell description.
- [MAJOR] Cell 7 (`flagA=none` explicit opt-out) — add ADR D2 invariant comment.
- [MAJOR] Existing T3.1 beforeEach already stubs THEMEMORY_API_KEY='', THEOMEM_MCP_AUTH='', THEOMEM_MCP_QUIET='', THEOMEM_MCP_TRANSPORT='' — extension reuses, no contamination risk.
- [MAJOR] Per-cell env stubs MUST go INSIDE it.each callback (not in beforeEach default).
- [MAJOR] Plan T4.1 § TDD shape already passed check_tdd_shape.py 9/9 — proceed.

## Recommended action
- Extend run-mcp-server.test.ts (preferred over new file — env-stub reuse).
- Define MATRIX typed array; per-cell env stubs inside it.each callback.
- Cell 7 + Cell 12 add `// ADR D2` JSDoc.
- No CRITICAL blockers.
