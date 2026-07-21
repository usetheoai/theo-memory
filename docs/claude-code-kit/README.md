# Claude Code ⇄ theo-memory kit

A version-controlled companion kit that makes **Claude Code** use **theo-memory** as its
persistent memory layer, globally, across every project on the machine. Ships a hooks-first
auto-memory spine plus an explicit MCP complement.

> Grounded in the M6 blueprint
> [`knowledge-base/discoveries/blueprints/claude-code-theo-memory-integration-blueprint.md`](../../knowledge-base/discoveries/blueprints/claude-code-theo-memory-integration-blueprint.md)
> and the M6 plan
> [`knowledge-base/plans/claude-code-memory-integration-plan.md`](../../knowledge-base/plans/claude-code-memory-integration-plan.md).

## Why hooks first (the core finding)

**Hooks beat MCP tools for reliable auto-memory.** MCP tools are model-invoked — the model
forgets to call `remember`/`recall`. Hooks are deterministic — they fire regardless of the
model. So the kit's design (blueprint ADR-1 / ADR-5) is:

- **Hooks are the deterministic auto-memory spine** — SessionStart auto-recalls, Stop
  auto-remembers, PreCompact flushes before context is compacted away.
- **MCP is the explicit complement** — for deliberate `remember`/`recall`/`explain_recall`
  when you want to drive memory by hand.

Both send raw text; theo-memory's server-side LLM extraction distills the facts, so the
hooks stay fast and dumb.

## What's in the kit

| File | Role |
|---|---|
| `hooks/theo-lib.mjs` | Shared ESM helpers (`loadEnv`, `readInput`, `projectOf`, `post`). Fail-tolerant: a memory outage is always a silent no-op. |
| `hooks/merge-settings.mjs` | `mergeHooks(existing, additions)` — the load-bearing, tested settings.json merge (non-clobbering, idempotent). |
| `hooks/theo-recall.mjs` | **SessionStart** — recalls the project's top-K memories, injects them via `hookSpecificOutput.additionalContext`. |
| `hooks/theo-remember.mjs` | **Stop** — fire-and-forgets the last assistant message to `/v1/remember` (server extracts). Salience floor drops trivial turns. |
| `hooks/theo-precompact.mjs` | **PreCompact** — flush-before-forget: persists the transcript tail before compaction. |
| `theo-memory.env.example` | Config template (endpoint URL + optional Bearer token). |
| `install.sh` | Deploys the kit to `~/.claude` and merges the hook registrations. Idempotent. |
| `test-merge.mjs` | Standalone merge test (`node docs/claude-code-kit/test-merge.mjs`). |

## Setup

1. **Install** — from the repo root:

   ```bash
   docs/claude-code-kit/install.sh
   ```

   This copies the hook files to `~/.claude/hooks/`, seeds `~/.claude/theo-memory.env`
   (chmod 600) if absent, and **merges** the 3 theo hook registrations into
   `~/.claude/settings.json` without clobbering your existing hooks. Re-running is safe —
   the merge never duplicates the theo entries.

2. **Configure the endpoint** — edit `~/.claude/theo-memory.env`. The endpoint is the
   single config knob:

   ```
   THEOMEM_MEMORY_URL=http://127.0.0.1:8080        # local dev
   # THEOMEM_MEMORY_URL=http://165.227.121.20:8080 # deployed REST
   # THEOMEM_MEMORY_URL=https://<edge>/v1/memory    # prod gateway (owner-resolved)
   # THEOMEM_MEMORY_TOKEN=theo_live_...             # required for deployed/gateway
   ```

   The deployed REST (`http://165.227.121.20:8080`) is what the M6 build + validation ran
   against. The production gateway host is owner-gated — swap the URL when it's resolved;
   no code change needed.

3. **Register the MCP complement** (optional, explicit surface) — `install.sh` prints this;
   run it yourself with your endpoint + token:

   ```bash
   claude mcp add --transport http --scope user theo-memory <URL>/mcp \
     --header "Authorization: Bearer <TOKEN>"
   ```

## Failure discipline

A memory outage **never** blocks a Claude Code session (blueprint ADR-5, plan T3.1):

- `post()` returns `null` on any error and never throws.
- `theo-recall.mjs` injects nothing and exits 0 when recall fails or is empty.
- `theo-remember.mjs` / `theo-precompact.mjs` fire-and-forget and exit 0 regardless.

## Test the merge

The settings.json merge is the load-bearing part — verify it before installing:

```bash
node docs/claude-code-kit/test-merge.mjs
```

It builds a fake settings.json with pre-existing hooks, runs the same `mergeHooks` the
installer uses, and asserts: originals survive, theo hooks are added, and a second merge
does not duplicate. Prints `PASS` / `FAIL`.
