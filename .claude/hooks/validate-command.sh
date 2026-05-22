#!/bin/bash
# PreToolUse hook for Bash: blocks destructive commands.
# Reflects the Inquebrável git rules from /home/paulo/.claude/CLAUDE.md.
# Exit 0 = allow, Exit 2 = block (stderr is shown to Claude).

set -euo pipefail

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if [ -z "$COMMAND" ]; then
  exit 0
fi

# --- Inquebrável git rules (CLAUDE.md PARTE I §4) ---
if echo "$COMMAND" | grep -qE 'git[[:space:]]+checkout([[:space:]]|$)'; then
  echo "BLOCKED: 'git checkout' is forbidden by Inquebrável Rule 4. Use 'git switch' or 'git restore' instead." >&2
  exit 2
fi

if echo "$COMMAND" | grep -qE 'git[[:space:]]+revert([[:space:]]|$)'; then
  echo "BLOCKED: 'git revert' is forbidden by Inquebrável Rule 4. Create a new commit that reverses the change explicitly." >&2
  exit 2
fi

if echo "$COMMAND" | grep -qE 'git[[:space:]]+push[[:space:]]+(-f([[:space:]]|$)|--force([[:space:]]|$))'; then
  echo "BLOCKED: force push is forbidden. Use --force-with-lease only when explicitly authorized." >&2
  exit 2
fi

if echo "$COMMAND" | grep -qE 'git[[:space:]]+reset[[:space:]]+--hard'; then
  echo "BLOCKED: 'git reset --hard' is forbidden. Use 'git stash' or create a branch instead." >&2
  exit 2
fi

# --- No work directly on main (CLAUDE.md PARTE I §4) ---
BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
if [ "$BRANCH" = "main" ]; then
  if echo "$COMMAND" | grep -qE 'git[[:space:]]+commit([[:space:]]|$)'; then
    echo "BLOCKED: never commit directly to main (Inquebrável Rule 4). Create a feature branch with 'git switch -c'." >&2
    exit 2
  fi
fi

# --- rm -rf on dangerous paths ---
if echo "$COMMAND" | grep -qE 'rm[[:space:]]+-rf?[[:space:]]+(/[[:space:]]*$|/[[:space:]]|/\*|~[[:space:]]*$|~[[:space:]]|\$HOME|/home([[:space:]]|/|$)|/etc([[:space:]]|/|$)|/usr([[:space:]]|/|$)|/var([[:space:]]|/|$)|/bin([[:space:]]|/|$)|/lib([[:space:]]|/|$)|/opt([[:space:]]|/|$)|/boot([[:space:]]|/|$)|/root([[:space:]]|/|$))'; then
  echo "BLOCKED: 'rm -rf' on a system path. Scope deletions to project-relative paths or /tmp/." >&2
  exit 2
fi

# --- referencia/ is read-only study material ---
if echo "$COMMAND" | grep -qE '(rm|mv|cp|sed[[:space:]]+-i|>[[:space:]]*)[[:space:]]+(\./)?referencia/'; then
  echo "BLOCKED: 'referencia/' contains read-only study clones (Mem0, Letta, LangMem). Never modify, delete, install dependencies in, or rename anything inside it. Use docs/exploration-reports/ to capture findings instead." >&2
  exit 2
fi

# --- npm publish guard (project is pre-release, not published yet) ---
if echo "$COMMAND" | grep -qE 'npm[[:space:]]+(publish|unpublish)'; then
  echo "BLOCKED: '@usetheo/memory' is pre-release and not yet published to npm. Publishing requires explicit human authorization plus a v1.0 milestone with reproduced benchmarks (CLAUDE.md § Pre-release status)." >&2
  exit 2
fi

# --- pip / pip install / poetry inside referencia/ (Python sub-projects exist there) ---
if echo "$COMMAND" | grep -qE '(pip|poetry|uv)[[:space:]]+install' && pwd | grep -q 'referencia/'; then
  echo "BLOCKED: never install dependencies inside referencia/. Those are read-only clones." >&2
  exit 2
fi

exit 0
