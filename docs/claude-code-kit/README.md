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
| `hooks/theo-scrub.mjs` | Shared secret/PII deny-list + `scrub()` — the SAME scrub the migration tool uses (single source of truth). Applied client-side before every write. |
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
   THEOMEM_MEMORY_URL=http://127.0.0.1:8080          # local dev
   # THEOMEM_MEMORY_URL=https://app-dev.usetheo.dev  # dev, through the gateway
   # THEOMEM_MEMORY_PATH_PREFIX=/v1/memory           # required with the gateway
   # THEOMEM_MEMORY_TOKEN=theo_live_...              # required with the gateway
   ```

   **Prefer the gateway.** It authenticates the request, strips your key, and injects a
   per-tenant credential downstream, so theo-memory never sees the client credential
   (CWE-441). Talking to a published REST port instead sends your key straight to the
   service and bypasses that boundary.

   The prefix is a separate knob because the hooks append the verb path themselves —
   folding `/v1/memory` into the URL yields `/v1/memory/v1/recall`, which is what the
   previous version of these instructions produced.

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

## Secret hygiene (client-side scrub)

The server stores `infer:false` **verbatim**, so the client hook is the only place a
secret can be caught before it enters the store. **`theo-remember` and `theo-precompact`
run `theo-scrub.mjs` over the text before every write** — the same fail-closed deny-list
the migration tool uses (OpenAI / Slack / Google / AWS / GitHub keys, JWTs, Bearer tokens,
`postgres://user:pass@` connection strings, secret-named `KEY=value` assignments, PEM
private-key blocks, and a high-entropy catch-all). Matches are replaced with
`[REDACTED:<kind>]`.

The **PreCompact transcript tail** is the highest-risk source (it can carry tool-output
env dumps / `.env` reads / API responses); it is scrubbed the same way. The scrub is a
**best-effort deny-list, not an exhaustive guarantee** — a secret in an unrecognized shape
can still slip through. If a project routinely handles high-value secrets in-session,
prefer not enabling the PreCompact hook (bias the deny-list toward over-redaction, and
review `theo-scrub.mjs` before trusting it with regulated data).

## Test the merge

The settings.json merge is the load-bearing part — verify it before installing:

```bash
node docs/claude-code-kit/test-merge.mjs
```

It builds a fake settings.json with pre-existing hooks, runs the same `mergeHooks` the
installer uses, and asserts: originals survive, theo hooks are added, and a second merge
does not duplicate. Prints `PASS` / `FAIL`.

## Migrating your existing Claude Code memory (M12)

The kit ships the `/migrate-theo-memory` skill (installed to `~/.claude/skills/` by `install.sh`).
In any Claude Code session, type `/migrate-theo-memory` — it dry-runs
`themory import claude-code` (nothing written), shows you the scrub/import report, asks for your
explicit confirmation, then commits and verifies via a live `recall`. Secrets never leave the
machine: the same fail-closed scrub the hooks use redacts them before any write. Re-running is safe
(idempotent — re-imports report `deduped`, never duplicate).

Manual equivalent: `node ~/.claude/hooks/migrate-claude-code.mjs   # kit machines (installer ships the engine) [--commit] [--source <dir>]`.
