#!/bin/bash
# PreToolUse hook for Edit/Write: enforces architectural boundaries.
#
# Boundaries enforced (from CLAUDE.md § Architectural Decisions Locked):
#   1. referencia/ is read-only study material — never edit it.
#   2. Dependency direction: core/ must NOT import from local/ or cloud/.
#      local/ and cloud/ must NOT import from each other.
#      theokit/ binding imports from core/ only.
#   3. Locked names cannot be silently renamed in source code (User/Session/Agent tiers,
#      remember/recall/forget/reflect verbs).
#
# Exit 0 = allow, Exit 2 = block.

set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.filePath // empty')

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

CONTENT=$(echo "$INPUT" | jq -r '.tool_input.new_string // .tool_input.content // empty')

# --- Guard 1: referencia/ is read-only ---
if echo "$FILE_PATH" | grep -qE '(^|/)referencia/'; then
  echo '{"decision":"block","reason":"BOUNDARY VIOLATION: referencia/ holds read-only clones (Mem0, Letta, LangMem) for design study. Never edit, never create files there. Capture findings in docs/exploration-reports/ instead."}' >&2
  exit 2
fi

# --- Guard 2: core/ must not import from local/ or cloud/ (DIP) ---
if echo "$FILE_PATH" | grep -qE '(^|/)src/core/.+\.(ts|tsx|js|mjs)$'; then
  if echo "$CONTENT" | grep -qE "from[[:space:]]+['\"](\.\./|\.\./\.\./)?local(/|['\"])"; then
    echo '{"decision":"block","reason":"DEPENDENCY DIRECTION: src/core/ must NOT import from src/local/. core/ defines contracts; local/ implements them (DIP — CLAUDE.md § Architectural Decisions Locked #1)."}' >&2
    exit 2
  fi
  if echo "$CONTENT" | grep -qE "from[[:space:]]+['\"](\.\./|\.\./\.\./)?cloud(/|['\"])"; then
    echo '{"decision":"block","reason":"DEPENDENCY DIRECTION: src/core/ must NOT import from src/cloud/. core/ defines contracts; cloud/ implements them."}' >&2
    exit 2
  fi
fi

# --- Guard 3: local/ and cloud/ are siblings — they cannot import each other ---
if echo "$FILE_PATH" | grep -qE '(^|/)src/local/.+\.(ts|tsx|js|mjs)$'; then
  if echo "$CONTENT" | grep -qE "from[[:space:]]+['\"](\.\./|\.\./\.\./)?cloud(/|['\"])"; then
    echo '{"decision":"block","reason":"BOUNDARY VIOLATION: src/local/ must NOT import from src/cloud/. They are sibling runtimes — share only via src/core/."}' >&2
    exit 2
  fi
fi
if echo "$FILE_PATH" | grep -qE '(^|/)src/cloud/.+\.(ts|tsx|js|mjs)$'; then
  if echo "$CONTENT" | grep -qE "from[[:space:]]+['\"](\.\./|\.\./\.\./)?local(/|['\"])"; then
    echo '{"decision":"block","reason":"BOUNDARY VIOLATION: src/cloud/ must NOT import from src/local/. They are sibling runtimes — share only via src/core/."}' >&2
    exit 2
  fi
fi

# --- Guard 4: theokit binding must depend only on core/ (not local/, not cloud/) ---
if echo "$FILE_PATH" | grep -qE '(^|/)src/theokit/.+\.(ts|tsx|js|mjs)$'; then
  if echo "$CONTENT" | grep -qE "from[[:space:]]+['\"](\.\./|\.\./\.\./)?(local|cloud)(/|['\"])"; then
    echo '{"decision":"block","reason":"BOUNDARY VIOLATION: src/theokit/ binding must depend on src/core/ only. Runtime selection (local vs cloud) happens at app composition, not inside the binding."}' >&2
    exit 2
  fi
fi

# --- Guard 5: locked architecture in source — protect the three-tier names from drift ---
# Only flag in src/ (CLAUDE.md, docs/, and tests intentionally discuss the contract).
if echo "$FILE_PATH" | grep -qE '(^|/)src/.+\.(ts|tsx)$'; then
  # If the file removes the user/session/agent tier vocabulary, surface it.
  REMOVED=$(echo "$CONTENT" | grep -ciE "type[[:space:]]+(MemoryTier|MemoryScope|UserMemory|SessionMemory|AgentMemory)" || true)
  # No-op: this is just an informational guard — boundary enforcement happens via tests, not text grep.
  # Reserved for future use; keep the hook idempotent for now.
  : "$REMOVED"
fi

exit 0
