# Dogfood driver — MCP surface

> Tells Claude Code how to execute each J-MCP-* journey from `knowledge-base/dogfood/journeys.md`
> AS A HUMAN (a real `@modelcontextprotocol/sdk` client driving the `themory mcp` server) and record
> one evidence file per journey (frontmatter per `dogfood-golden-rule.md § 5`). `oracle_result` = the
> tool list + round-trip result. Secrets redacted to `theo_live_`/`sk-or-` + ≤4 chars (EC-2).

## Preconditions

- `themory mcp` bootable (native) and `themory mcp --compat openmemory` (SSE, port 8765) against a
  real pgvector. The OpenMemory integration suite (`tests/integration/openmemory`) available.

## On failure (EC-8 — every journey)

Oracle unresolvable at run time → `outcome: fail reason=oracle_unresolvable`, never a silent skip.

## Per-journey protocol

| Journey | Steps (human) | Oracle (`oracle_result`) |
|---|---|---|
| J-MCP-1 | native `themory mcp` over stdio: real client `tools/list` + remember→recall | 4 tools listed + a recall hit; record the tool names + hit |
| J-MCP-2 | native over streamable-http with a bearer: `tools/list` | http `tools/list` with bearer succeeds; record status + tool count |
| J-MCP-3 | `--compat openmemory` SSE: `add_memories`/`search_memory`/`list_memories`/`delete_memories` | run `tests/integration/openmemory`; record exit 0 + the 4 OpenMemory tool names + add→search→delete round-trip |
| J-MCP-4 | user A tries to read/delete user B's memory | 404/empty, no existence leak; record the isolation result (IDOR closed) |

## Evidence template

```yaml
---
journey: J-MCP-<N>
date: <today>
operator: claude-code
outcome: pass | partial | fail
oracle_result: "<tool list + round-trip result>"
summary: <one line>
---
```
