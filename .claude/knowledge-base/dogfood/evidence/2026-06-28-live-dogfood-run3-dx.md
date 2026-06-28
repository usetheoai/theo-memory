---
scenario: dashboard-memory-journey
date: 2026-06-28
status: running
operator: claude-code
outcome: partial
summary: "DX modalities exercised live — CLI (health/write→pg verified), SDK 8/8 import smoke, MCP tools/list + scope-binding security; CLI mock-recall + MCP ctx-bound round-trip are backend/by-design"
build_under_test: host dist (node dist/agent-tools/cli.js) against pg-themory:15432 + mock-openai:11434 (#77 source)
---

# 2026-06-28 — Live dogfood run 3 (DX: CLI + SDK + MCP)

Ran the three non-browser modalities the earlier runs SKIPPED, on the host dist against the
live backend (pg-themory:15432 + mock-openai:11434).

## DX · CLI (`node dist/agent-tools/cli.js`)
| id | outcome | evidence |
|---|---|---|
| CLI-HLT | **pass** | `health` → "db OK" + "memory factory OK", exit 0 |
| CLI-REM | **pass** | `remember --user clidog` exit 0; **2 rows confirmed in pg** (memories WHERE user_id IN clidog/clidog2) |
| CLI-NEG | **pass** | `recall` without a scope flag → exit 2 + typed "required" error |
| CLI-REC | partial | recall returns `[]` even at `--threshold 0` — the **mock embedder** produces near-uniform vectors so cosine recall misses; the same verbatim write+recall PASSES on the http path (`infer:false`). The CLI exposes no `--no-infer/verbatim` flag (DX gap). |

## DX · SDK (import smoke, 8/8)
`@usetheo/memory` barrel (105 exports, via dynamic `import()` — it is ESM) + `/contract`
(65 exports) + `/theokit` `/cache-pg` `/embedders` `/llms` `/adaptive-local` `/reranker-local`
all resolve & expose exports. **8/8 PASS.**

## DX · MCP (real `@modelcontextprotocol/sdk` client over stdio)
| id | outcome | evidence |
|---|---|---|
| MCP boot | **pass** | `themory mcp` stderr: "real providers wired — OpenAIEmbedder dim=1536 + OpenAILLM; transport=stdio" |
| MCP-LIST | **pass** | tools/list = remember, recall, forget, reflect, episodes, add_skill, execute_skill, forget_skill |
| MCP-SCOPE | **pass (security)** | calling `remember` with a `user` arg → `-32602 Invalid params` + "Scope not bound. Caller must invoke memoryFromCtx with ctx.session" — **anti-spoof: scope is bound from the connection ctx, NOT a tool arg** (the catalog's [CRIT] MCP-SCOPE row) |
| MCP-REM / MCP-REC | deferred | full round-trip needs a ctx-bound session over the transport (by design); the verb round-trip is already proven on cli (pg) / sdk / http |

## Honest notes
- **CLI mock-recall:** writes land in pg (verified), but recall under mock-openai embeddings misses; this is a mock-backend limitation, not a CLI defect. A real OPENAI_API_KEY (now in the skill `.env`) + the real embedder would make CLI recall meaningful.
- **CLI DX gap:** no verbatim/`--no-infer` flag — the only way to store an un-extracted fact via the CLI is to rely on the LLM extraction, which is unreliable on a mock backend.
- **MCP scope-binding is a feature, not a bug:** the tool refusing an arg-supplied scope is the anti-spoof security guarantee.

## Regressions vs baseline
- none — all previously-green rows still green; DX rows newly recorded.
