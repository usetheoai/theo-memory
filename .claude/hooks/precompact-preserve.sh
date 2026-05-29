#!/bin/bash
# PreCompact hook — preserves halt-loop + plan state before context compaction.
#
# Inspired by planning-with-files v2.43.0's PreCompact pattern. Adapted for
# TheMemory's cycle structure: snapshots ralph-loop state + active plan
# excerpt + recent progress entries to a recoverable location so post-
# compaction context can be rebuilt by session-catchup.py.
#
# Fires on Claude Code's PreCompact event. Outputs informational messages
# to the agent for inclusion in the compacted summary.

set -eu

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$PROJECT_DIR" || exit 0

# Output goes to stdout (captured by Claude Code as system message)
echo "[precompact-preserve] Context compaction about to occur. Preserving state."

# 1) Snapshot ralph-loop state if active
if [ -f .claude/ralph-loop.local.md ]; then
  STATE_DIR=".claude/.compaction-snapshots"
  mkdir -p "$STATE_DIR" 2>/dev/null
  TS=$(date -u +"%Y%m%dT%H%M%SZ")
  cp .claude/ralph-loop.local.md "$STATE_DIR/ralph-loop-$TS.md" 2>/dev/null && \
    echo "[precompact-preserve] ralph-loop state snapshotted: $STATE_DIR/ralph-loop-$TS.md"

  # Also surface current iteration to agent
  ITER=$(grep '^iteration:' .claude/ralph-loop.local.md | sed 's/iteration: *//' | tr -d ' ')
  PROMISE=$(grep '^completion_promise:' .claude/ralph-loop.local.md | sed 's/completion_promise: *//' | sed 's/^"\(.*\)"$/\1/')
  echo "[precompact-preserve] Active ralph-loop: iter=$ITER promise=$PROMISE"
fi

# 2) Surface active plan file excerpt
ACTIVE_PLAN=""
if [ -f .claude/.active_plan ]; then
  AP=$(tr -d '\r\n[:space:]' < .claude/.active_plan 2>/dev/null)
  if [ -n "$AP" ] && [ -f ".claude/knowledge-base/plans/$AP-plan.md" ]; then
    ACTIVE_PLAN=".claude/knowledge-base/plans/$AP-plan.md"
  fi
fi

# Fallback: newest plan file
if [ -z "$ACTIVE_PLAN" ] && [ -d .claude/knowledge-base/plans ]; then
  # shellcheck disable=SC2012
  NEWEST=$(ls -t .claude/knowledge-base/plans/*-plan.md 2>/dev/null | head -1)
  [ -n "$NEWEST" ] && ACTIVE_PLAN="$NEWEST"
fi

if [ -n "$ACTIVE_PLAN" ] && [ -f "$ACTIVE_PLAN" ]; then
  echo "[precompact-preserve] Active plan: $ACTIVE_PLAN"
  echo "[precompact-preserve] Plan Goal (first blockquote line after ## Goal):"
  # Find first '> ' line after the ## Goal heading; check blockquote BEFORE exit on prose.
  awk '
    /^## Goal/{ flag=1; next }
    flag && /^> /{ print; exit }
    flag && /^## /{ exit }
  ' "$ACTIVE_PLAN" 2>/dev/null
fi

# 3) Tail recent progress entries (if progress.md convention is in use)
PLAN_SLUG=""
if [ -n "$ACTIVE_PLAN" ]; then
  PLAN_SLUG=$(basename "$ACTIVE_PLAN" -plan.md)
fi
PROGRESS_FILE=".claude/knowledge-base/progress/${PLAN_SLUG}-progress.md"
if [ -n "$PLAN_SLUG" ] && [ -f "$PROGRESS_FILE" ]; then
  echo "[precompact-preserve] Last 10 progress entries:"
  tail -10 "$PROGRESS_FILE" 2>/dev/null | sed 's/^/  /'
fi

# 4) Reminder to agent
echo ""
echo "[precompact-preserve] Post-compaction: plan + progress + ralph-loop state are on disk."
echo "[precompact-preserve] Run \`python3 .claude/scripts/session-catchup.py\` to rebuild context."

exit 0
