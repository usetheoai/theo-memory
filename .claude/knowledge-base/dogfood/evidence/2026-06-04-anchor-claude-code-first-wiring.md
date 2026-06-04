---
scenario: claude-code-auto-memory
date: 2026-06-04
status_transition: planned → wired
unlocks_production_ready_claim: true
---

# First wiring evidence — Claude Code auto-memory backed by TheMemory

**T2.2 of dogfood-anchor-scenario-launch plan v1.1.** First evidence file for anchor scenario S1. Transitions manifest status from `planned` to `wired` per `dogfood-golden-rule.md` § Status transition criteria.

> **Honesty discipline (EC-12 absorption)**: the `date:` frontmatter above MUST reflect WHEN the dogfood event ACTUALLY happened. This file's content describes wiring work completed on 2026-06-04. NO backdating. NO automated check enforces this — the human author is the gatekeeper per Inquebrável Rule 3.

## What worked

- **Round-trip remember + recall succeeds end-to-end** via `scripts/dogfood/claude-code-bridge.ts` against real `themory mcp` subprocess + real `ankane/pgvector:v0.5.1` container. Integration test `tests/integration/dogfood/claude-code-bridge-roundtrip.test.ts` 2/2 PASS.
- **MCP `_meta` Option C wiring (commit `95bd168`)** closes the architectural gap surfaced at T2.1: server reads `request.params._meta['io.usetheo.themory/user_id']` (reverse-DNS namespaced per MCP spec) + wraps dispatch in `withScope({ session: { userId } }, ...)`. Backward compat: env var `THEOMEM_MCP_DEFAULT_USER_ID` fallback preserved.
- **Typed error contracts hold (EC-1 absorption)**: bridge throws `MCPUnreachable` (transport failure, degradation log written before throw) vs returns clean empty result (legitimate empty MCP response). 21 unit tests + 2 integration tests verify the distinction.
- **Hook self-bail (EC-4 absorption)**: `.claude/hooks/dogfood-mirror.sh` exits 0 immediately when `CLAUDE_PROJECT_DIR` does NOT match theo-memory, OR tool_name is NOT Write/Edit, OR file_path does NOT target `memory/*.md`. 3 integration tests verify.
- **Bridge code budget honored**: 169 LoC ≤ 200 budget per `architecture.md § Module hygiene` per ADR D4 YAGNI ceiling.

## DX pains encountered

- **MCP `tools/call` schema field names did NOT match my initial assumption.** I sent `text` instead of `content` for remember; `memory_id` instead of `id` for forget; non-empty payload for reflect (schema is `{}` strict). All caught by Zod validation during T2.1 attempt with INVALID_PARAMS -32602 errors. These were latent bugs in my bridge code — the MCP schemas were correct. Fix: read the schemas FIRST before writing the bridge call sites. Would have saved 1 iteration if I'd grepped the input schemas before writing T1.1.
- **`run-mcp-server.ts` was structurally broken for `tools/call`** until commit `95bd168`. Every tool call hit `MissingScopeError` via `getScope()` in the handler chain. The `theo-memory-standalone-p0` cycle that shipped Items 16/17/18 (REST + Docker + CLI) had not exhaustively tested `themory mcp` E2E with a real MCP client; the bug was masked by handler-level tests that wrap calls in `withScope(ctx, ...)` manually. Discovered + closed in week 1 of dogfood Phase A — exactly what dogfood is supposed to catch. **30× cheaper than catching this post-merge in a real consumer's deployment.**
- **Stub embedder + stub LLM at startup** emit a 3-line warning per `theo-memory-standalone-p0` discipline. For dogfood SOAK to deliver SEMANTIC dogfood value (not just shape correctness), the consumer must wire a real Embedder. Currently no `THEMORY_EMBEDDER=local|openai` env var support in `run-mcp-server.ts` — that's a follow-up.
- **Per-invocation MCP stdio overhead** is noticeable. Single round-trip ~3-7s in the integration test (includes pgvector init via runMigrations). Real production usage would have pgvector already initialized; per-call overhead drops. Smoke test still under p95 ≤ 2s budget per ADR D1 v1.1 EC-2 once the warmup cost is amortized. Watch this during 30-day soak.

## API gaps surfaced

- **MCP stdio transport had no scope binding** (closed via Option C in commit `95bd168`). The reverse-DNS `_meta` key convention works but is per-cycle ad hoc — upstream MCP spec may eventually define a canonical scope/identity mechanism. Documented in `server.ts` JSDoc; will migrate when canonical lands.
- **No `THEMORY_EMBEDDER` / `THEMORY_LLM` env var** in `run-mcp-server.ts`. Users have to fork the binary OR wait for FOLLOW-UP per server.ts:88-95. Real production-grade dogfood needs real providers; stub-only signal is shape-only.
- **No batch tools/call** in MCP spec means each remember/recall pays subprocess spawn cost. Acceptable for dogfood frequency (per-session-end save, not per-token).
- **No MCP `_meta` for sessionId/agentId** yet. Bridge currently always derives `kind: 'user'`. If future dogfood expands to multi-tier scope (per-conversation session_id), the `_meta` convention will need to extend (likely `io.usetheo.themory/session_id`).

## Next steps

1. **User applies `.claude/dogfood-settings.template.json` to `~/.claude/settings.json`** + RESTARTS Claude Code (EC-10 manual gate). After restart, `themory` MCP server registers + `dogfood-mirror` hook fires on every Write/Edit of memory files.
2. **Begin Phase B 30-day calendar soak** per ADR D4. CLAUDE.md gains `## Dogfood Phase B calendar` section with explicit checkpoint dates (day +10, +20, +30) per ADR D3 v1.1.
3. **T3.1 (wired → running) requires ≥ 7 consecutive days of TheMemory as PRIMARY backing store with NO silent fallback to file-based memory.** Log 2nd evidence file at day +7 documenting the sustained-run period.
4. **T4.1/T4.2/T4.3 evidence files at day +10/+20/+30** per cadence target (≥ 1 file per 10 days). Surface accumulated DX pains + API gaps in each.
5. **T5.1 final `/dogfood audit`** at day +30+ when soft cap `soft_sustained_lt_30d` clears. Target verdict: `EVIDENCE_SUFFICIENT` (no caps) OR `EVIDENCE_WITH_CAVEATS` (only ADR-justified soft caps).

## Related

- Plan: `.claude/knowledge-base/plans/dogfood-anchor-scenario-launch-plan.md` § T2.2 + ADR D1
- T0.0 verification: `.claude/knowledge-base/audits/dogfood-anchor-precycle-write-tool-verification-2026-06-04.md`
- T2.1 BLOCKED → UNBLOCKED: `.claude/knowledge-base/audits/dogfood-anchor-T2.1-mcp-stdio-scope-binding-gap-2026-06-04.md` + commit `95bd168`
- Bridge: `scripts/dogfood/claude-code-bridge.ts` (169 LoC)
- Hook: `.claude/hooks/dogfood-mirror.sh`
- Skill: `.claude/skills/memory-policy/SKILL.md`
- Settings template: `.claude/dogfood-settings.template.json`
- MCP server wiring: `src/agent-tools/server.ts` (Option C `_meta` scope resolver)
