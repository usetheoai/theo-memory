# Code Quality Audit: voyager-skill-library

**Date:** 2026-05-30
**Mode:** plan-bound
**Verdict:** FAIL_SOFT
**Score cap:** 70
**Hard caps triggered:** _none_

## Summary

- Languages audited: typescript
- Languages skipped: python, rust, go
- Total findings: 26 (0 HARD, 1 SOFT_CAP, 0 SOFT_FLOOR, 25 INFO)

## Findings by detector

### D1 — Dead code
_No findings._

### D2 — Symbol fabrication
| File | Symbol | Severity | Message |
|---|---|---|---|
| `home/paulo/Projetos/usetheo/theo-memory/examples/chat-with-memory/app/page.tsx` | `import from '@/components/chat-surface'` | INFO | Could not verify npm package '@/components/chat-surface' (ambiguous response) [allowlisted] |
| `home/paulo/Projetos/usetheo/theo-memory/examples/chat-with-memory/app/layout.tsx` | `import from '@/components/theme-bootstrap'` | INFO | Could not verify npm package '@/components/theme-bootstrap' (ambiguous response) [allowlisted] |
| `home/paulo/Projetos/usetheo/theo-memory/examples/chat-with-memory/app/api/memory/forget/route.ts` | `import from '@/lib/memory'` | INFO | Could not verify npm package '@/lib/memory' (ambiguous response) [allowlisted] |
| `home/paulo/Projetos/usetheo/theo-memory/examples/chat-with-memory/app/api/memory/reflect/route.ts` | `import from '@/lib/memory'` | INFO | Could not verify npm package '@/lib/memory' (ambiguous response) [allowlisted] |
| `home/paulo/Projetos/usetheo/theo-memory/examples/chat-with-memory/app/api/memory/recall/route.ts` | `import from '@/lib/memory'` | INFO | Could not verify npm package '@/lib/memory' (ambiguous response) [allowlisted] |
| `home/paulo/Projetos/usetheo/theo-memory/examples/chat-with-memory/app/api/chat/route.ts` | `import from '@/lib/agent'` | INFO | Could not verify npm package '@/lib/agent' (ambiguous response) [allowlisted] |
| `home/paulo/Projetos/usetheo/theo-memory/examples/chat-with-memory/app/api/chat/route.ts` | `import from '@/lib/theomemory-plugin'` | INFO | Could not verify npm package '@/lib/theomemory-plugin' (ambiguous response) [allowlisted] |
| `home/paulo/Projetos/usetheo/theo-memory/examples/chat-with-memory/lib/openai-adapters.ts` | `import from '@usetheo/memory/contract'` | INFO | Could not verify npm package '@usetheo/memory/contract' (ambiguous response) [allowlisted] |
| `home/paulo/Projetos/usetheo/theo-memory/examples/chat-with-memory/lib/theomemory-plugin.ts` | `import from '@usetheo/memory/contract'` | INFO | Could not verify npm package '@usetheo/memory/contract' (ambiguous response) [allowlisted] |
| `home/paulo/Projetos/usetheo/theo-memory/examples/chat-with-memory/lib/memory.ts` | `import from '@usetheo/memory'` | SOFT_CAP | Fabricated npm package '@usetheo/memory' (not found on registry) [allowlisted] |
| `home/paulo/Projetos/usetheo/theo-memory/examples/chat-with-memory/lib/memory.ts` | `import from '@usetheo/memory/contract'` | INFO | Could not verify npm package '@usetheo/memory/contract' (ambiguous response) [allowlisted] |
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
| `home/paulo/Projetos/usetheo/theo-memory/src/core/__tests__/index.test-d.ts` | `import from '@usetheo/memory/contract'` | INFO | Could not verify npm package '@usetheo/memory/contract' (ambiguous response) [allowlisted] |
| `home/paulo/Projetos/usetheo/theo-memory/src/core/__tests__/index.test-d.ts` | `import from '@usetheo/memory/contract'` | INFO | Could not verify npm package '@usetheo/memory/contract' (ambiguous response) [allowlisted] |

### D3 — Cross-package orphan exports
_No findings._

### D4 — Mutation testing
_No findings._

## Related

- Golden rule: [`.claude/rules/code-quality-golden-rule.md`](../../rules/code-quality-golden-rule.md)
- Allowlist: [`.claude/rules/code-quality-allowlist.txt`](../../rules/code-quality-allowlist.txt)
- Thresholds: [`.claude/rules/code-quality-thresholds.txt`](../../rules/code-quality-thresholds.txt)
