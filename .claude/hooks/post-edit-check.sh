#!/bin/bash
# PostToolUse hook for Edit/Write: quick TypeScript feedback after a change.
#
# Behavior:
#   - If the edited file is .ts/.tsx and a tsconfig.json exists at the project root,
#     run a no-emit type-check and surface the first errors to Claude.
#   - If no tsconfig.json exists yet (contract design phase), the hook is a no-op.
#   - Never blocks — output is advisory.
#
# Exit 0 always — stdout is fed back to Claude as additional context.

set -uo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.filePath // empty')

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Only check TypeScript files
if ! echo "$FILE_PATH" | grep -qE '\.(ts|tsx)$'; then
  exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
cd "$PROJECT_DIR"

# Skip if project hasn't bootstrapped TS yet
if [ ! -f "tsconfig.json" ]; then
  exit 0
fi

# Skip if tsc / npx not available
if ! command -v npx >/dev/null 2>&1; then
  exit 0
fi

# Type-check the whole project (single-package; small surface area)
TSC_OUTPUT=$(npx --no tsc --noEmit 2>&1 || true)

if echo "$TSC_OUTPUT" | grep -qE 'error TS'; then
  echo "TypeScript errors detected after edit — first 8 reported:"
  echo "$TSC_OUTPUT" | grep -E 'error TS' | head -8
  echo ""
  echo "Run 'npx tsc --noEmit' locally for the full output."
fi

exit 0
