#!/bin/bash
# PostToolUse hook for Edit/Write: lints PUBLIC COPY for banned positioning terms.
#
# Scope (CLAUDE.md § Voice and Tone — "Applies to" list):
#   - README.md (HERO + BODY sections)
#   - PITCH.md (when created)
#   - docs/marketing/**/*.md (when created)
#
# Does NOT apply to:
#   - docs/exploration-reports/*.md  (technical, can mention Mem0/Qdrant/pgvector by name)
#   - CLAUDE.md, CHANGELOG.md, source code
#   - referencia/** (already blocked by boundary-check)
#
# Banned terms (cross-referenced to CLAUDE.md):
#   - "Mem0-clone" / "Mem0 clone"          → Architecture is Mem0-SHAPE, not clone (root override 2026-05-21).
#   - "wrapper around Mem0"                → Positioning is native backend, not wrapper.
#   - "production-ready" / "production ready" / "production grade" → Pre-release until v1.0 with benchmarks (CLAUDE.md § Pre-release status).
#   - "Apache-2.0" / "Apache 2.0"          → TheMemory is the explicit MIT exception (root override #4).
#   - "Qdrant" / "pgvector" / "vector engine" / "vector store engine" → Cross-Project Rule 9 (Cloud abstraction): user-copy says "memory store".
#
# Exit 0 always — output is advisory (warn-first per user decision 2026-05-21).

set -uo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.filePath // empty')

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Public copy scope only
IS_PUBLIC_COPY=false
case "$FILE_PATH" in
  */README.md|README.md) IS_PUBLIC_COPY=true ;;
  */PITCH.md|PITCH.md) IS_PUBLIC_COPY=true ;;
  *docs/marketing/*.md) IS_PUBLIC_COPY=true ;;
  *) IS_PUBLIC_COPY=false ;;
esac

if [ "$IS_PUBLIC_COPY" = false ]; then
  exit 0
fi

# Skip technical docs even if they live under docs/
case "$FILE_PATH" in
  *docs/exploration-reports/*) exit 0 ;;
esac

CONTENT=$(echo "$INPUT" | jq -r '.tool_input.new_string // .tool_input.content // empty')

if [ -z "$CONTENT" ]; then
  exit 0
fi

WARNINGS=()

# Architecture positioning
if echo "$CONTENT" | grep -qiE '\bMem0[[:space:]]?-?[[:space:]]?clone\b'; then
  WARNINGS+=("Mem0-clone' in public copy. CLAUDE.md anchor: 'Mem0-SHAPE architecture' — inspired, not a clone. Reframe as 'Mem0-shape architecture' or 'inspired by Mem0'.")
fi

if echo "$CONTENT" | grep -qiE '\bwrapper\b'; then
  if echo "$CONTENT" | grep -qiE '\bwrapper[[:space:]]+(around|for|of)[[:space:]]+(Mem0|Letta|Zep)'; then
    WARNINGS+=("'wrapper around <competitor>' in public copy. Positioning is 'native managed memory of TheoCloud, optimized for TheoKit', not a wrapper around an existing player. Drop the 'wrapper' framing.")
  fi
fi

# Pre-release honesty (Inquebrável Rule 3)
if echo "$CONTENT" | grep -qiE 'production[[:space:]]?-?[[:space:]]?(ready|grade)'; then
  WARNINGS+=("'production-ready' or 'production-grade' in public copy. TheMemory is the explicit pre-release exception in the monorepo (CLAUDE.md § Status). No production claims until v1.0 with reproduced benchmarks.")
fi

# License clarity (MIT exception)
if echo "$CONTENT" | grep -qE 'Apache[[:space:]]?-?[[:space:]]?2\.0'; then
  if echo "$CONTENT" | grep -qiE '@usetheo/memory|TheMemory|theo-memory'; then
    WARNINGS+=("'Apache-2.0' associated with TheMemory in public copy. TheMemory ships under MIT (explicit root override 2026-05-21). Apache-2.0 applies to the other six OSS sub-projects, not this one.")
  fi
fi

# Cross-Project Rule 9 — Cloud abstraction
if echo "$CONTENT" | grep -qE '\b(Qdrant|pgvector|vector[[:space:]]+(engine|store[[:space:]]+engine))\b'; then
  # Allow these terms inside DEEP DIVE / Architecture / Foundation / Roadmap sections.
  # Detect deep-dive context by the presence of "## How it works" or "## Architecture" or "## Foundation"
  # ABOVE the offending line; if absent, warn.
  if ! echo "$CONTENT" | grep -qE '^##[[:space:]]+(How it works|Architecture|Foundation|Roadmap|Status|Planned API)'; then
    WARNINGS+=("Cross-Project Rule 9 (Cloud abstraction): user-facing copy says 'memory store' or 'managed memory', NEVER 'Qdrant' / 'pgvector' / 'vector engine'. Technical internals belong in DEEP DIVE sections ('How it works', 'Architecture'), not HERO/BODY.")
  fi
fi

if [ ${#WARNINGS[@]} -gt 0 ]; then
  echo "Public copy lint — advisory warnings on $FILE_PATH:"
  echo ""
  for w in "${WARNINGS[@]}"; do
    echo "  [WARN] $w"
    echo ""
  done
  echo "Reference: CLAUDE.md § Voice and Tone, § Architectural Decisions Locked."
fi

exit 0
