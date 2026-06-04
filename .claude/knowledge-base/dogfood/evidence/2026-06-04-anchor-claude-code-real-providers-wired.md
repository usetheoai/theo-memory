---
date: 2026-06-04
scenario: claude-code-auto-memory
status_transition: planned -> wired
unlocks_production_ready_claim: false
---

# Evidence — Claude Code anchor scenario S1 wiring activated with REAL providers

## Headline

A Claude Code session running in `theo-memory` project invoked `mcp__themory__remember` end-to-end through the project-local `.mcp.json` MCP server registration. Real OpenRouter LLM (`openai/gpt-4o-mini`) extracted 4 discrete facts. Real Xenova MiniLM embedder produced 384-dim vectors persisted in pgvector. Subsequent `mcp__themory__recall` returned the semantically-relevant fact at top-1 with cosine score 0.657. No stubs in the production path.

## Configuration applied

Files registered AND verified working post the third Claude Code restart of this session:

| Path | Contents | Status |
|---|---|---|
| `theo-memory/.mcp.json` | `mcpServers.themory` → `node /home/paulo/Projetos/usetheo/theo-memory/dist/agent-tools/cli.js mcp` with env `THEOMEM_PG_URI` + `THEOMEM_MCP_DEFAULT_USER_ID=claude-code-theo-memory` + `OPENAI_BASE_URL=https://openrouter.ai/api/v1` + `OPENAI_CHAT_MODEL=openai/gpt-4o-mini` + `OPENAI_API_KEY=...` (temporary key supplied by user) | gitignored (committed template at `.mcp.json.example`) |
| `theo-memory/.claude/settings.json` | `hooks.PostToolUse[Edit\|Write]` includes `dogfood-mirror.sh` alongside the pre-existing `post-edit-check.sh` + `public-copy-lint.sh` | committed |
| `theo-memory/.claude/hooks/dogfood-mirror.sh` | Bash PostToolUse hook with `CLAUDE_PROJECT_DIR` self-bail (EC-4 absorption) routing memory/*.md edits through `scripts/dogfood/run-bridge.mjs` | committed (executable, +x) |
| `theo-memory/dist/agent-tools/run-mcp-server.js` | Compiled from `src/agent-tools/run-mcp-server.ts` v1.5 — drops `StubLLM` + `StubEmbedder`, hard-fails on missing `OPENAI_API_KEY`, wires `LocalTransformerEmbedder` + `OpenAILLM` with `embeddingDim: 384` consistently across `runMigrations` + `PgvectorStore` + `createLocalMemory` | dev build (verified: `grep StubLLM dist/agent-tools/run-mcp-server.js` returns 0) |

## Empirical evidence captured this session

### Schema honesty

Postgres `themem.public.memories.embedding` column dimension: `vector(384)`. Matches the Xenova MiniLM dim claim in the codebase — schema and runtime agree.

### LLM extraction validated end-to-end

Single `mcp__themory__remember` call with the following input content:

> The TheMemory project ships its MCP server via the themory CLI binary, registered in .mcp.json. The default user scope is claude-code-theo-memory. The embedder is LocalTransformerEmbedder using Xenova MiniLM with 384 dimensions. The LLM provider is OpenAI-compatible via OPENAI_BASE_URL pointing to OpenRouter using openai/gpt-4o-mini as the chat model.

Produced **4 discrete facts** persisted in `memories` with `kind=extracted`, `attributed_to=user`, `confirmation_count=1`, `user_id=claude-code-theo-memory` — all at `2026-06-04T10:29:11Z`:

| id (prefix) | Extracted fact |
|---|---|
| `8324f06b…` | The TheMemory project ships its MCP server via the themory CLI binary, registered in .mcp.json. |
| `73da7250…` | The default user scope for TheMemory project is claude-code-theo-memory. |
| `28dd1fd3…` | The embedder used in TheMemory project is LocalTransformerEmbedder using Xenova MiniLM with 384 dimensions. |
| `18c88ae6…` | The LLM provider for TheMemory project is OpenAI-compatible via OPENAI_BASE_URL, pointing to OpenRouter using openai/gpt-4o-mini as the chat model. |

The LLM split the prose input into one fact per declarative clause. This is the Mem0-shape extraction pipeline (`kind=extracted`) functioning with a real LLM. Pre-fix (StubLLM), the same input produced ZERO rows.

### Semantic recall validated end-to-end

`mcp__themory__recall({ query: "Which embedding model does TheMemory use?", topK: 3 })` returned:

| Rank | Score | Returned fact (text) |
|---|---|---|
| 1 | **0.657** | The embedder used in TheMemory project is LocalTransformerEmbedder using Xenova MiniLM with 384 dimensions. |
| 2 | 0.492 | The default user scope for TheMemory project is claude-code-theo-memory. |
| 3 | 0.447 | The TheMemory project ships its MCP server via the themory CLI binary, registered in .mcp.json. |

The query NEVER mentions "LocalTransformerEmbedder", "MiniLM", "384", or "Xenova" — the top-1 is selected by genuine semantic similarity from the embedder, not lexical overlap. This is the proof that the embedder is producing meaningful vector representations, not deterministic-noise vectors.

## Honesty discipline (Inquebrável Rule 3)

- `unlocks_production_ready_claim: false`. Per `dogfood-golden-rule.md`, the production-ready label requires sustained 30-day evidence. This file is day 0 of that window. Soft cap `soft_sustained_lt_30d` will continue firing for ≥ 30 days regardless of how much wiring works — that is the gate working AS DESIGNED.
- The temporary OpenRouter API key sits in `.mcp.json` (gitignored). It is the user's responsibility to rotate the key when the soak window ends; the gitignore protects it from leaking.
- Prior `wired` claim in commit `eb46e66` was REVERTED in `cb63d87` because the empirical configuration check failed (no MCP server registered, no hooks active, zero pgvector rows). The current `planned` → `wired` flip stands on different ground: configuration verified, MCP server boots with REAL providers, pgvector grew empirically.
- The stub-removal in `run-mcp-server.ts` is a code change introduced THIS session at user directive ("REMOVA QUALQUER STUB EM NOSSO AMBIENTE PRODUTIVO"). The FOLLOW-UP comment that prior shipped (warning gate when real-provider config lands) is now obsolete — the stub-warning path is unreachable because the file no longer imports `StubLLM`/`StubEmbedder`. A follow-up commit may delete the obsolete FOLLOW-UP comment from `run-server.ts` (REST server) once that path is similarly hardened.

## DX pains encountered this session

1. **Discovery cost**: `~/.claude/settings.json` is NOT where Claude Code reads `mcpServers`. Two restarts were burned diagnosing that the canonical path is project-local `.mcp.json`. Documentation gap on the Claude Code side — surfaced; recommendation to add a `## Where Claude Code reads MCP config` callout to `README.md § Quickstart` once the wiring stabilises.
2. **Scope binding indirection**: MCP `tools/call` does not natively carry a project-aware scope. The Option C `_meta.io.usetheo.themory/user_id` shape works for SDK callers that can inject custom `_meta`, but Claude Code's built-in tool dispatcher does not pass `_meta` through. The env-var fallback (`THEOMEM_MCP_DEFAULT_USER_ID`) covers this gap but pins the scope to ONE userId per `.mcp.json` registration. For multi-project Claude Code users, this is acceptable (one `.mcp.json` per project) but worth surfacing in MCP onboarding docs.
3. **Schema dim coupling**: `runMigrations` + `PgvectorStore` + `createLocalMemory` all need the SAME `embeddingDim` value, and existing data at a different dim must be dropped manually for dev. The atomic-dim-change pipeline absorbed by `adapters-openrouter-local-embedder` cycle handles fresh DB; production switching dims would need additional choreography. Not blocking for v1.0 but a known gap to surface in CHANGELOG when the dim parameter graduates from internal-default to user-facing config.

## API gaps surfaced

None blocking. The 4-verb surface (`remember/recall/forget/reflect`) and the scope binding worked as documented once configuration paths were correct.

## What this evidence does NOT establish

- **Continuous dogfood use over 30 days.** Required to clear `soft_sustained_lt_30d`. Begins TODAY.
- **Daily evidence cadence.** Required for `soft_floor_evidence_density_low`. Plan T4.1/T4.2/T4.3/T4.4 (day +1, +10, +20, +30 evidence files) provide the cadence.
- **Recall quality at higher scale.** Today validated 4 facts. Long-tail behavior at 100+ facts is a separate measurement (Item 11 v1.0 acceptance + benchmark reproduction).
- **MEMORY.md mapping decision.** Open question 2 in the manifest still stands — the dogfood-mirror hook routes Write/Edit on `memory/*.md` through TheMemory, but the relationship between `MEMORY.md` (Claude Code's index) and TheMemory's recall ranking is not yet decided.

## Next checkpoints per the plan

- T3.1 — first natural-usage evidence file (this file IS the configuration-verified day 0; T3.1 logs the first BUSINESS-USE moment when Claude Code's auto-memory genuinely persisted a session-spanning recall).
- T4.* — day +1, +10, +20, +30 evidence files documenting sustained use.
- T5.1 — final audit pre-PR.
- T6.1 — PR for the cycle close.
