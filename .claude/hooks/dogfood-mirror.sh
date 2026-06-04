#!/usr/bin/env bash
# Dogfood mirror hook — intercepts Claude Code PostToolUse Write/Edit calls
# targeting <project-slug>/memory/*.md and routes them through TheMemory's
# MCP surface via scripts/dogfood/claude-code-bridge.ts.
#
# T1.2 of dogfood-anchor-scenario-launch plan v1.1.
#
# EC-4 absorption: hook self-bails immediately when CLAUDE_PROJECT_DIR does
# NOT match the theo-memory project. ~/.claude/settings.json is user-global;
# without self-bail, every Claude Code project would spawn themory mcp.
#
# EC-1 absorption: bridge throws typed MCPUnreachable on transport failure +
# writes degradation log BEFORE throw. This hook exits non-zero on bridge
# failure (does NOT silently swallow).
#
# Inputs (per Claude Code PostToolUse hook contract):
#   stdin    — JSON object with tool_name + tool_input
#   env      — CLAUDE_PROJECT_DIR (project root); other Claude vars
#
# Exit codes:
#   0  success OR self-bail (not a theo-memory project; not a Write/Edit of
#      memory file; bridge skipped empty content)
#   non-zero  bridge invocation failed; consumer sees the error
#
# @see .claude/knowledge-base/plans/dogfood-anchor-scenario-launch-plan.md § T1.2

set -euo pipefail

# EC-4 self-bail: only intercept on theo-memory project.
if [[ "${CLAUDE_PROJECT_DIR:-}" != *theo-memory* ]]; then
  exit 0
fi

# Read the PostToolUse tool input JSON from stdin (Claude Code injects this).
TOOL_INPUT="$(cat || true)"

# Parse tool_name; bail unless Write or Edit.
TOOL_NAME="$(printf '%s' "$TOOL_INPUT" | grep -oE '"tool_name":"[^"]*"' | head -1 | sed 's/.*:"\(.*\)"/\1/')"
case "$TOOL_NAME" in
  Write|Edit) ;;
  *) exit 0 ;;
esac

# Extract file_path; bail unless it targets a memory file under the project.
FILE_PATH="$(printf '%s' "$TOOL_INPUT" | grep -oE '"file_path":"[^"]*"' | head -1 | sed 's/.*:"\(.*\)"/\1/')"
if [[ -z "${FILE_PATH:-}" ]]; then exit 0; fi
case "$FILE_PATH" in
  */memory/*.md) ;;
  *) exit 0 ;;
esac

# Extract content (Write) or new_string (Edit) — both are best-effort grep on
# the JSON tool_input. For multi-line content we delegate to the bridge to
# read the file from disk instead of parsing the JSON.
REPO_ROOT="$CLAUDE_PROJECT_DIR"
BRIDGE_RUNNER="$REPO_ROOT/scripts/dogfood/run-bridge.mjs"

# Invoke the bridge in mirror mode: pass the file_path so the bridge reads the
# now-written content from disk + calls bridgeRemember. Bridge's typed errors
# propagate via non-zero exit code.
node "$BRIDGE_RUNNER" --project-slug "$CLAUDE_PROJECT_DIR" --file "$FILE_PATH" --op remember
exit $?
