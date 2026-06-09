# Code Quality Audit: themory-category-filter-server-side

**Date:** 2026-06-09
**Mode:** plan-bound
**Verdict:** PASS_WITH_CAVEATS
**Score cap:** 89
**Hard caps triggered:** symbol_fab_unverifiable_typescript

## Summary

- Languages audited: typescript
- Languages skipped: python, rust, go
- Total findings: 15 (0 HARD, 0 SOFT_CAP, 2 SOFT_FLOOR, 13 INFO)

## Findings by detector

### D1 — Dead code
_No findings._

### D2 — Symbol fabrication
| File | Symbol | Severity | Message |
|---|---|---|---|
| `home/paulo/Projetos/usetheo/theo-memory/scripts/dogfood/claude-code-bridge.ts` | `import from '@modelcontextprotocol/sdk/client/index.js'` | SOFT_FLOOR | Could not verify npm package '@modelcontextprotocol/sdk/client/index.js' (ambiguous response) |
| `home/paulo/Projetos/usetheo/theo-memory/scripts/dogfood/claude-code-bridge.ts` | `import from '@modelcontextprotocol/sdk/client/stdio.js'` | SOFT_FLOOR | Could not verify npm package '@modelcontextprotocol/sdk/client/stdio.js' (ambiguous response) |
| `home/paulo/Projetos/usetheo/theo-memory/src/agent-tools/server.ts` | `import from '@modelcontextprotocol/sdk/server/index.js'` | INFO | Could not verify npm package '@modelcontextprotocol/sdk/server/index.js' (ambiguous response) [allowlisted] |
| `home/paulo/Projetos/usetheo/theo-memory/src/agent-tools/server.ts` | `import from '@modelcontextprotocol/sdk/shared/transport.js'` | INFO | Could not verify npm package '@modelcontextprotocol/sdk/shared/transport.js' (ambiguous response) [allowlisted] |
| `home/paulo/Projetos/usetheo/theo-memory/src/agent-tools/server.ts` | `import from '@modelcontextprotocol/sdk/types.js'` | INFO | Could not verify npm package '@modelcontextprotocol/sdk/types.js' (ambiguous response) [allowlisted] |
| `home/paulo/Projetos/usetheo/theo-memory/src/agent-tools/tools/dispatch.ts` | `import from '@modelcontextprotocol/sdk/types.js'` | INFO | Could not verify npm package '@modelcontextprotocol/sdk/types.js' (ambiguous response) [allowlisted] |
| `home/paulo/Projetos/usetheo/theo-memory/src/agent-tools/tools/remember-handler.ts` | `import from '@modelcontextprotocol/sdk/types.js'` | INFO | Could not verify npm package '@modelcontextprotocol/sdk/types.js' (ambiguous response) [allowlisted] |
| `home/paulo/Projetos/usetheo/theo-memory/src/agent-tools/tools/list-handler.ts` | `import from '@modelcontextprotocol/sdk/types.js'` | INFO | Could not verify npm package '@modelcontextprotocol/sdk/types.js' (ambiguous response) [allowlisted] |
| `home/paulo/Projetos/usetheo/theo-memory/src/agent-tools/tools/recall-handler.ts` | `import from '@modelcontextprotocol/sdk/types.js'` | INFO | Could not verify npm package '@modelcontextprotocol/sdk/types.js' (ambiguous response) [allowlisted] |
| `home/paulo/Projetos/usetheo/theo-memory/src/agent-tools/tools/forget-handler.ts` | `import from '@modelcontextprotocol/sdk/types.js'` | INFO | Could not verify npm package '@modelcontextprotocol/sdk/types.js' (ambiguous response) [allowlisted] |
| `home/paulo/Projetos/usetheo/theo-memory/src/agent-tools/tools/reflect-handler.ts` | `import from '@modelcontextprotocol/sdk/types.js'` | INFO | Could not verify npm package '@modelcontextprotocol/sdk/types.js' (ambiguous response) [allowlisted] |
| `home/paulo/Projetos/usetheo/theo-memory/src/agent-tools/tools/__tests__/handlers.test.ts` | `import from '@modelcontextprotocol/sdk/types.js'` | INFO | Could not verify npm package '@modelcontextprotocol/sdk/types.js' (ambiguous response) [allowlisted] |
| `home/paulo/Projetos/usetheo/theo-memory/src/agent-tools/transports/stdio.ts` | `import from '@modelcontextprotocol/sdk/server/stdio.js'` | INFO | Could not verify npm package '@modelcontextprotocol/sdk/server/stdio.js' (ambiguous response) [allowlisted] |
| `home/paulo/Projetos/usetheo/theo-memory/src/agent-tools/transports/streamable-http.ts` | `import from '@modelcontextprotocol/sdk/server/streamableHttp.js'` | INFO | Could not verify npm package '@modelcontextprotocol/sdk/server/streamableHttp.js' (ambiguous response) [allowlisted] |
| `home/paulo/Projetos/usetheo/theo-memory/src/agent-tools/transports/streamable-http.ts` | `import from '@modelcontextprotocol/sdk/shared/transport.js'` | INFO | Could not verify npm package '@modelcontextprotocol/sdk/shared/transport.js' (ambiguous response) [allowlisted] |

### D3 — Cross-package orphan exports
_No findings._

### D4 — Mutation testing
_No findings._

## Related

- Golden rule: [`.claude/rules/code-quality-golden-rule.md`](../../rules/code-quality-golden-rule.md)
- Allowlist: [`.claude/rules/code-quality-allowlist.txt`](../../rules/code-quality-allowlist.txt)
- Thresholds: [`.claude/rules/code-quality-thresholds.txt`](../../rules/code-quality-thresholds.txt)
