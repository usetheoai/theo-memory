#!/bin/bash
# Stop hook: end-of-session sanity checks.
#
# Behavior (all warn-first — output is advisory context for Claude, never blocking):
#   1. TDD gate (warn-first): for every changed src/**/*.ts that is NOT itself a test,
#      check whether a matching .test.ts file exists somewhere in src/. If not, warn.
#   2. Locked-item drift: if CLAUDE.md was modified, surface a reminder that "Locked names"
#      and the four root overrides require a strategic review.
#   3. Pre-release honesty: if README.md was modified, scan for production-ready claims.
#
# Always exit 0 — stdout is fed back to Claude.

set -uo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
cd "$PROJECT_DIR"

# ----------------------------------------------------------------------------
# Collect ALL modified files (unstaged + staged + last commit)
# ----------------------------------------------------------------------------
UNSTAGED=$(git diff --name-only 2>/dev/null || true)
STAGED=$(git diff --cached --name-only 2>/dev/null || true)
LAST_COMMIT=$(git diff --name-only HEAD~1..HEAD 2>/dev/null || true)

ALL_FILES=$(echo -e "${UNSTAGED}\n${STAGED}\n${LAST_COMMIT}" | sort -u | grep -v '^$' || true)

if [ -z "$ALL_FILES" ]; then
  exit 0
fi

WARNINGS=()

# ----------------------------------------------------------------------------
# 1. TDD gate (warn-first)
# ----------------------------------------------------------------------------
SRC_CHANGED=$(echo "$ALL_FILES" | grep -E '^src/.+\.(ts|tsx)$' | grep -vE '\.test\.(ts|tsx)$' | grep -vE '\.spec\.(ts|tsx)$' || true)

if [ -n "$SRC_CHANGED" ]; then
  MISSING_TESTS=()
  while IFS= read -r src_file; do
    [ -z "$src_file" ] && continue

    # Skip pure type definitions, barrels, generated code
    base_name=$(basename "$src_file")
    if [ "$base_name" = "index.ts" ] || [ "$base_name" = "index.tsx" ]; then
      continue
    fi
    if echo "$src_file" | grep -qE '/(types|generated|.+\.d\.ts)'; then
      continue
    fi
    if echo "$src_file" | grep -qE '\.d\.ts$'; then
      continue
    fi

    # Candidate test files: <file>.test.ts next to it OR somewhere under __tests__
    candidate_a="${src_file%.ts}.test.ts"
    candidate_a="${candidate_a%.tsx}.test.tsx"
    base_no_ext="${base_name%.ts}"
    base_no_ext="${base_no_ext%.tsx}"

    if [ -f "$candidate_a" ]; then
      continue
    fi

    # Look for *.test.ts referencing the module name elsewhere
    found=$(grep -rl --include='*.test.ts' --include='*.test.tsx' "from ['\"].*${base_no_ext}['\"]" src/ 2>/dev/null | head -1 || true)
    if [ -n "$found" ]; then
      continue
    fi

    MISSING_TESTS+=("$src_file")
  done <<< "$SRC_CHANGED"

  if [ ${#MISSING_TESTS[@]} -gt 0 ]; then
    msg="TDD gate (warn-first) — Inquebrável Rule 5 + 7: the following source files have no matching .test.ts:"
    for f in "${MISSING_TESTS[@]}"; do
      msg+="\n    - $f"
    done
    msg+="\n  TheMemory has explicit TDD discipline (CLAUDE.md § Inviolable Rules #5). Write the test first; this is advisory because the project is still in contract-design phase."
    WARNINGS+=("$msg")
  fi
fi

# ----------------------------------------------------------------------------
# 2. Locked-item drift in CLAUDE.md
# ----------------------------------------------------------------------------
if echo "$ALL_FILES" | grep -qE '^CLAUDE\.md$'; then
  DIFF=$(git diff CLAUDE.md 2>/dev/null || true)
  if [ -n "$DIFF" ]; then
    if echo "$DIFF" | grep -qE '^[-+].*(Locked names|npm package|Marketing name|License|Memory tiers|API verbs|Two runtimes|Subpath exports|MIT|Apache)'; then
      WARNINGS+=("CLAUDE.md was modified in lines that look like Locked Items (package name, license, tiers, verbs, runtimes). Per § When this file is wrong, those changes require explicit strategic review — never edit silently. Confirm the strategic review record before considering the task done.")
    fi
    if echo "$DIFF" | grep -qE '^[-+].*(four explicit overrides|Cross-Project Rule 6|Phase 1 scope|Inquebrável Rule 9|MIT license exception)'; then
      WARNINGS+=("CLAUDE.md was modified in lines that look like one of the four root overrides. Those are root-level strategic-review territory — confirm authorization before merging.")
    fi
  fi
fi

# ----------------------------------------------------------------------------
# 3. README.md production claims
# ----------------------------------------------------------------------------
if echo "$ALL_FILES" | grep -qE '^README\.md$'; then
  README_DIFF=$(git diff README.md 2>/dev/null || true)
  if echo "$README_DIFF" | grep -qiE '^\+.*\bproduction[[:space:]]?-?[[:space:]]?(ready|grade)\b'; then
    WARNINGS+=("README.md introduces a 'production-ready' claim. TheMemory is the explicit pre-release exception in the monorepo (CLAUDE.md § Status). No production claims until v1.0 with reproduced benchmarks.")
  fi
fi

# ----------------------------------------------------------------------------
# 4. CHANGELOG discipline (Inquebrável Rule 6)
# ----------------------------------------------------------------------------
# Only warn once code actually exists (CHANGELOG.md does not yet — pre-code phase).
if [ -f "CHANGELOG.md" ]; then
  SRC_OR_TESTS=$(echo "$ALL_FILES" | grep -E '^(src/|tests/)' || true)
  if [ -n "$SRC_OR_TESTS" ] && ! echo "$ALL_FILES" | grep -qE '^CHANGELOG\.md$'; then
    WARNINGS+=("CHANGELOG.md not updated despite changes under src/ or tests/. Inquebrável Rule 6: every code change updates the [Unreleased] section.")
  fi
fi

# ----------------------------------------------------------------------------
# Report
# ----------------------------------------------------------------------------
if [ ${#WARNINGS[@]} -gt 0 ]; then
  echo "============================================"
  echo "  STOP VALIDATION — ADVISORY WARNINGS"
  echo "============================================"
  echo ""
  for w in "${WARNINGS[@]}"; do
    echo -e "  [WARN] $w"
    echo ""
  done
  echo "--------------------------------------------"
  echo "These are advisory (warn-first). Address them or document why they are intentional before considering the session complete."
fi

exit 0
