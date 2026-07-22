---
name: migrate-theo-memory
description: Migrate Claude Code's native file-based memory (~/.claude/projects/*/memory) into theo-memory. Orchestrates the deterministic `themory import claude-code` CLI — dry-run first, show the report, require explicit confirmation, then commit and verify via recall. Use when the user asks to import/migrate their existing Claude Code memories into theo-memory.
---

# /migrate-theo-memory — import Claude Code's file memory into theo-memory

You ORCHESTRATE the deterministic migrator. You NEVER re-implement the migration yourself (never read
the memory files and `remember` them one-by-one): the CLI applies a **fail-closed secret scrub**,
verbatim `infer:false` fidelity, chunked batching, and idempotent UPSERTs that an LLM-mediated copy
cannot guarantee. Your job is: run it, show the report, get consent, verify.

## Steps

1. **Dry-run (writes nothing):**

   ```bash
   node ~/.claude/hooks/migrate-claude-code.mjs
   ```

   The kit installer ships the engine to `~/.claude/hooks/` (same channel as the hooks — no npm or
   Docker needed on a kit machine), and the engine resolves endpoint/token AUTOMATICALLY from
   `~/.claude/theo-memory.env` (or `THEOMEM_MIGRATE_URL`/`_TOKEN` env overrides) — zero-config.

   Alternatives: from a theo-memory checkout, `node dist/agent-tools/cli.js import claude-code`; or
   the Docker image with your `~/.claude` mounted
   (`docker run -v ~/.claude:/root/.claude ghcr.io/usetheo/themory import claude-code`).

2. **Show the user the dry-run report verbatim** (scanned / would-import / redacted-in / skipped) and
   note: "redacted-in" nodes are imported WITH their secrets already scrubbed — no secret leaves the
   machine.

3. **Ask for explicit confirmation before writing.** Never `--commit` without the user saying yes in
   this conversation. Offer `--source <dir>` if they want to limit the import to one project.

4. **Commit:**

   ```bash
   node ~/.claude/hooks/migrate-claude-code.mjs --commit
   ```

   Report the summary line (`imported= deduped= failed= requests=`). Re-running is safe — idempotent
   UPSERT: a re-run reports `deduped` instead of duplicating.

5. **Verify via recall:** pick one distinctive phrase from a migrated note and call the theo-memory
   MCP `recall` tool with it; show the user the matching item as proof the import is live.

## Failure handling

- Non-zero exit / `failed > 0` → show the error verbatim; do NOT retry with `--commit` more than once
  (idempotency makes one retry safe; repeated failures need the user to check endpoint/token).
- No `~/.claude/theo-memory.env` and no `THEOMEM_*` env → tell the user to run the kit `install.sh`
  first (the kit configures the endpoint), or export `THEOMEM_MIGRATE_URL`/`_TOKEN` explicitly.

## Never

- Never bypass the dry-run → confirm → commit sequence.
- Never read memory files and push them via MCP `remember` yourself (loses the scrub + idempotency).
- Never print a token; the CLI reads it from env/file.
