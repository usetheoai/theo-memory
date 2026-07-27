# Code Quality Audit: memory-write-quality-mem0-parity

**Date:** 2026-07-27
**Mode:** plan-bound
**Verdict:** PASS_WITH_CAVEATS
**Score cap:** 89
**Hard caps triggered:** symbol_fab_unverifiable_typescript

## Summary

- Languages audited: typescript
- Languages skipped: _none_
- Total findings: 31 (0 HARD, 0 SOFT_CAP, 31 SOFT_FLOOR, 0 INFO)

## Findings by detector

### D1 — Dead code
_No findings._

### D2 — Symbol fabrication
| File | Symbol | Severity | Message |
|---|---|---|---|
| `home/paulo/Projetos/usetheo/theo-data/theo-memory/tests/integration/openmemory/mcp-compat.test.ts` | `import from '@modelcontextprotocol/sdk/client/index.js'` | SOFT_FLOOR | Could not verify npm package '@modelcontextprotocol/sdk/client/index.js' (ambiguous response) |
| `home/paulo/Projetos/usetheo/theo-data/theo-memory/tests/integration/openmemory/mcp-compat.test.ts` | `import from '@modelcontextprotocol/sdk/client/sse.js'` | SOFT_FLOOR | Could not verify npm package '@modelcontextprotocol/sdk/client/sse.js' (ambiguous response) |
| `home/paulo/Projetos/usetheo/theo-data/theo-memory/packages/mcp/src/server.ts` | `import from '@modelcontextprotocol/sdk/server/index.js'` | SOFT_FLOOR | Could not verify npm package '@modelcontextprotocol/sdk/server/index.js' (ambiguous response) |
| `home/paulo/Projetos/usetheo/theo-data/theo-memory/packages/mcp/src/server.ts` | `import from '@modelcontextprotocol/sdk/shared/transport.js'` | SOFT_FLOOR | Could not verify npm package '@modelcontextprotocol/sdk/shared/transport.js' (ambiguous response) |
| `home/paulo/Projetos/usetheo/theo-data/theo-memory/packages/mcp/src/server.ts` | `import from '@modelcontextprotocol/sdk/types.js'` | SOFT_FLOOR | Could not verify npm package '@modelcontextprotocol/sdk/types.js' (ambiguous response) |
| `home/paulo/Projetos/usetheo/theo-data/theo-memory/packages/mcp/src/openmemory/tools.ts` | `import from '@modelcontextprotocol/sdk/types.js'` | SOFT_FLOOR | Could not verify npm package '@modelcontextprotocol/sdk/types.js' (ambiguous response) |
| `home/paulo/Projetos/usetheo/theo-data/theo-memory/packages/mcp/src/tools/episodes.test.ts` | `import from '@modelcontextprotocol/sdk/types.js'` | SOFT_FLOOR | Could not verify npm package '@modelcontextprotocol/sdk/types.js' (ambiguous response) |
| `home/paulo/Projetos/usetheo/theo-data/theo-memory/packages/mcp/src/tools/dispatch.ts` | `import from '@modelcontextprotocol/sdk/types.js'` | SOFT_FLOOR | Could not verify npm package '@modelcontextprotocol/sdk/types.js' (ambiguous response) |
| `home/paulo/Projetos/usetheo/theo-data/theo-memory/packages/mcp/src/tools/execute-skill-handler.ts` | `import from '@modelcontextprotocol/sdk/types.js'` | SOFT_FLOOR | Could not verify npm package '@modelcontextprotocol/sdk/types.js' (ambiguous response) |
| `home/paulo/Projetos/usetheo/theo-data/theo-memory/packages/mcp/src/tools/update-memory-handler.ts` | `import from '@modelcontextprotocol/sdk/types.js'` | SOFT_FLOOR | Could not verify npm package '@modelcontextprotocol/sdk/types.js' (ambiguous response) |
| `home/paulo/Projetos/usetheo/theo-data/theo-memory/packages/mcp/src/tools/remember-handler.ts` | `import from '@modelcontextprotocol/sdk/types.js'` | SOFT_FLOOR | Could not verify npm package '@modelcontextprotocol/sdk/types.js' (ambiguous response) |
| `home/paulo/Projetos/usetheo/theo-data/theo-memory/packages/mcp/src/tools/forget-skill-handler.ts` | `import from '@modelcontextprotocol/sdk/types.js'` | SOFT_FLOOR | Could not verify npm package '@modelcontextprotocol/sdk/types.js' (ambiguous response) |
| `home/paulo/Projetos/usetheo/theo-data/theo-memory/packages/mcp/src/tools/list-handler.ts` | `import from '@modelcontextprotocol/sdk/types.js'` | SOFT_FLOOR | Could not verify npm package '@modelcontextprotocol/sdk/types.js' (ambiguous response) |
| `home/paulo/Projetos/usetheo/theo-data/theo-memory/packages/mcp/src/tools/get-memory-handler.ts` | `import from '@modelcontextprotocol/sdk/types.js'` | SOFT_FLOOR | Could not verify npm package '@modelcontextprotocol/sdk/types.js' (ambiguous response) |
| `home/paulo/Projetos/usetheo/theo-data/theo-memory/packages/mcp/src/tools/list-entities-handler.ts` | `import from '@modelcontextprotocol/sdk/types.js'` | SOFT_FLOOR | Could not verify npm package '@modelcontextprotocol/sdk/types.js' (ambiguous response) |
| `home/paulo/Projetos/usetheo/theo-data/theo-memory/packages/mcp/src/tools/recall-handler.ts` | `import from '@modelcontextprotocol/sdk/types.js'` | SOFT_FLOOR | Could not verify npm package '@modelcontextprotocol/sdk/types.js' (ambiguous response) |
| `home/paulo/Projetos/usetheo/theo-data/theo-memory/packages/mcp/src/tools/forget-handler.ts` | `import from '@modelcontextprotocol/sdk/types.js'` | SOFT_FLOOR | Could not verify npm package '@modelcontextprotocol/sdk/types.js' (ambiguous response) |
| `home/paulo/Projetos/usetheo/theo-data/theo-memory/packages/mcp/src/tools/handlers.test.ts` | `import from '@modelcontextprotocol/sdk/types.js'` | SOFT_FLOOR | Could not verify npm package '@modelcontextprotocol/sdk/types.js' (ambiguous response) |
| `home/paulo/Projetos/usetheo/theo-data/theo-memory/packages/mcp/src/tools/add-skill-handler.ts` | `import from '@modelcontextprotocol/sdk/types.js'` | SOFT_FLOOR | Could not verify npm package '@modelcontextprotocol/sdk/types.js' (ambiguous response) |
| `home/paulo/Projetos/usetheo/theo-data/theo-memory/packages/mcp/src/tools/delete-entities-handler.ts` | `import from '@modelcontextprotocol/sdk/types.js'` | SOFT_FLOOR | Could not verify npm package '@modelcontextprotocol/sdk/types.js' (ambiguous response) |
| `home/paulo/Projetos/usetheo/theo-data/theo-memory/packages/mcp/src/tools/episodes-handler.ts` | `import from '@modelcontextprotocol/sdk/types.js'` | SOFT_FLOOR | Could not verify npm package '@modelcontextprotocol/sdk/types.js' (ambiguous response) |
| `home/paulo/Projetos/usetheo/theo-data/theo-memory/packages/mcp/src/tools/reflect-handler.ts` | `import from '@modelcontextprotocol/sdk/types.js'` | SOFT_FLOOR | Could not verify npm package '@modelcontextprotocol/sdk/types.js' (ambiguous response) |
| `home/paulo/Projetos/usetheo/theo-data/theo-memory/packages/mcp/src/tools/explain-recall-handler.ts` | `import from '@modelcontextprotocol/sdk/types.js'` | SOFT_FLOOR | Could not verify npm package '@modelcontextprotocol/sdk/types.js' (ambiguous response) |
| `home/paulo/Projetos/usetheo/theo-data/theo-memory/packages/mcp/src/transports/mcp-session-registry.ts` | `import from '@modelcontextprotocol/sdk/server/streamableHttp.js'` | SOFT_FLOOR | Could not verify npm package '@modelcontextprotocol/sdk/server/streamableHttp.js' (ambiguous response) |
| `home/paulo/Projetos/usetheo/theo-data/theo-memory/packages/mcp/src/transports/mcp-session-registry.ts` | `import from '@modelcontextprotocol/sdk/shared/transport.js'` | SOFT_FLOOR | Could not verify npm package '@modelcontextprotocol/sdk/shared/transport.js' (ambiguous response) |
| `home/paulo/Projetos/usetheo/theo-data/theo-memory/packages/mcp/src/transports/stdio.ts` | `import from '@modelcontextprotocol/sdk/server/stdio.js'` | SOFT_FLOOR | Could not verify npm package '@modelcontextprotocol/sdk/server/stdio.js' (ambiguous response) |
| `home/paulo/Projetos/usetheo/theo-data/theo-memory/packages/mcp/src/transports/sse.test.ts` | `import from '@modelcontextprotocol/sdk/client/index.js'` | SOFT_FLOOR | Could not verify npm package '@modelcontextprotocol/sdk/client/index.js' (ambiguous response) |
| `home/paulo/Projetos/usetheo/theo-data/theo-memory/packages/mcp/src/transports/sse.test.ts` | `import from '@modelcontextprotocol/sdk/client/sse.js'` | SOFT_FLOOR | Could not verify npm package '@modelcontextprotocol/sdk/client/sse.js' (ambiguous response) |
| `home/paulo/Projetos/usetheo/theo-data/theo-memory/packages/mcp/src/transports/sse.ts` | `import from '@modelcontextprotocol/sdk/server/sse.js'` | SOFT_FLOOR | Could not verify npm package '@modelcontextprotocol/sdk/server/sse.js' (ambiguous response) |
| `home/paulo/Projetos/usetheo/theo-data/theo-memory/packages/mcp/src/transports/sse.ts` | `import from '@modelcontextprotocol/sdk/server/streamableHttp.js'` | SOFT_FLOOR | Could not verify npm package '@modelcontextprotocol/sdk/server/streamableHttp.js' (ambiguous response) |
| `home/paulo/Projetos/usetheo/theo-data/theo-memory/packages/mcp/src/transports/sse.ts` | `import from '@modelcontextprotocol/sdk/shared/transport.js'` | SOFT_FLOOR | Could not verify npm package '@modelcontextprotocol/sdk/shared/transport.js' (ambiguous response) |

### D3 — Cross-package orphan exports
_No findings._

### D4 — Mutation testing
_No findings._

## Related

- Golden rule: [`.claude/rules/code-quality-golden-rule.md`](../../rules/code-quality-golden-rule.md)
- Allowlist: [`.claude/rules/code-quality-allowlist.txt`](../../rules/code-quality-allowlist.txt)
- Thresholds: [`.claude/rules/code-quality-thresholds.txt`](../../rules/code-quality-thresholds.txt)
