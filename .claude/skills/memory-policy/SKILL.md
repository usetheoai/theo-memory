---
name: memory-policy
description: Dogfood TheMemory by routing Claude Code memory ops through the bridge. Invoke at canonical surfaces — session-start recall, post-task remember, explicit forget, periodic reflect. Use BEFORE answering when context across sessions matters; use AFTER completing a task that resulted in durable learning.
allowed-tools: Bash
---

# Skill: memory-policy

User-invocable skill providing 4 explicit commands that route memory operations
through TheMemory's MCP surface via the dogfood bridge. Primary path of ADR D1
hybrid wiring strategy.

T1.2 of dogfood-anchor-scenario-launch plan v1.1.

## When to invoke

Use these verbs at canonical surfaces — NOT on every assistant turn:

| Verb | When |
|---|---|
| `remember` | After completing a non-trivial task that produced durable learning (a design decision, a tricky bug fix root-cause, a user preference, a project-specific convention discovered during research). |
| `recall` | At session start when context across sessions matters AND before answering questions whose response depends on prior decisions / facts that may have been forgotten between sessions. |
| `forget` | When a previously-remembered fact is invalidated (a decision was reversed, a convention deprecated). Requires the memory_id from a prior recall. |
| `reflect` | Periodically (e.g., after several distinct tasks in a session OR at session end) to let TheMemory consolidate related memories via its v0.4a reflection pipeline. |

## How to invoke

Each verb shells out to `scripts/dogfood/run-bridge.mjs` (a thin runner) which
delegates to the bridge module. Bridge handles MCP transport, sanitization,
degradation logging, and typed errors.

### remember

Call when persisting a durable learning. The bridge requires the project slug
to be passed explicitly per ADR D2 v1.1 EC-3:

```bash
node "$CLAUDE_PROJECT_DIR/scripts/dogfood/run-bridge.mjs" \
  --project-slug "$CLAUDE_PROJECT_DIR" \
  --op remember \
  --text "concise factual statement to remember"
```

Exit code 0 = success or skipped (empty content). Non-zero = bridge failure;
the human user sees the error per EC-1 contract.

### recall

Call when context across sessions matters. Returns top relevant memories for
the query.

```bash
node "$CLAUDE_PROJECT_DIR/scripts/dogfood/run-bridge.mjs" \
  --project-slug "$CLAUDE_PROJECT_DIR" \
  --op recall \
  --query "what is the relevant context for X?"
```

### forget

Call when invalidating a previously-remembered fact. Requires `memory_id` from
a prior recall.

```bash
node "$CLAUDE_PROJECT_DIR/scripts/dogfood/run-bridge.mjs" \
  --project-slug "$CLAUDE_PROJECT_DIR" \
  --op forget \
  --memory-id "$MEMORY_ID"
```

### reflect

Call periodically to consolidate related memories.

```bash
node "$CLAUDE_PROJECT_DIR/scripts/dogfood/run-bridge.mjs" \
  --project-slug "$CLAUDE_PROJECT_DIR" \
  --op reflect
```

## Honest discipline

- **Project slug is REQUIRED** per ADR D2 v1.1 EC-3. No implicit `process.cwd()`
  fallback. The skill ALWAYS passes `$CLAUDE_PROJECT_DIR` explicitly. If
  `$CLAUDE_PROJECT_DIR` is unset (skill invoked outside a Claude Code project
  context), the bridge throws `InvalidProjectSlug` and the skill SHOULD surface
  the error rather than silently fall back to a default.
- **Empty content is skipped** per EC-9 — the bridge returns `{ skipped: true,
  reason: 'empty_content' }` for empty/whitespace-only text. No error.
- **MCP unreachable surfaces** per EC-1 — when `themory mcp` cannot be spawned
  OR pgvector is down, the bridge throws `MCPUnreachable` AND writes a
  degradation log file. The skill SHOULD report the degradation log path to
  the user; do NOT silently swallow.
- **Per-invocation lifecycle** per ADR D1 v1.1 EC-2 — each call spawns a fresh
  `themory mcp` subprocess. p95 latency ≤ 2s budget; if higher in practice,
  plan amends BEFORE T3.1 transition.

## Related

- Bridge module: `scripts/dogfood/claude-code-bridge.ts`
- Hook (secondary path): `.claude/hooks/dogfood-mirror.sh`
- Plan: `.claude/knowledge-base/plans/dogfood-anchor-scenario-launch-plan.md` § T1.2 + ADR D1
- Manifest: `.claude/knowledge-base/dogfood/manifest.md` § S1 anchor scenario
