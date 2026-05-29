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

# --- .claude/knowledge-base/references/ is read-only study material ---
# Only block clear WRITE/MODIFY operations targeting .claude/knowledge-base/references/.
# Read-only ops (test, ls, cat, head, tail, find, grep, for-loops, Read/Glob tools)
# are explicitly allowed — they are needed for /discover-execute and /discover-plan.
#
# Anchor the verb to a shell-segment boundary (start, space, `;`, `&&`, `||`, `|`, `(`)
# so substrings like "cp" inside "docker-compose" don't false-positive.
# Permits intermediate args/flags between verb and .claude/knowledge-base/references/ via `[^;&|]*`.
#
# Known limitation: regex-based shell parsing cannot distinguish bare `rm .claude/knowledge-base/references/`
# from `rm` appearing inside a quoted string (e.g., `echo 'this rm in a string'
# .claude/knowledge-base/references/foo`). The latter false-positives. Workaround: rephrase the echo
# without the verb-name keyword, or use `printf '%s\n' "$VAR"` style.
if echo "$COMMAND" | grep -qE '(^|[[:space:]]|;|&&|\|\||\||\()[[:space:]]*((rm|mv|cp|sed[[:space:]]+-i|tee)[[:space:]]+[^;&|]*(\./)?.claude/knowledge-base/references/|>{1,2}[[:space:]]+(\./)?.claude/knowledge-base/references/)'; then
  echo "BLOCKED: '.claude/knowledge-base/references/' contains read-only study clones (Mem0, Letta, LangMem). Never modify, delete, install dependencies in, or rename anything inside it. Use docs/exploration-reports/ to capture findings instead." >&2
  exit 2
fi

# --- No Co-Authored-By trailers in commit messages (user policy 2026-05-22) ---
# Blocks any `git commit` whose message body contains the literal "Co-Authored-By"
# (case-insensitive). User policy: this project's git history must not carry
# co-authorship trailers. The check fires on the command text, which covers:
#   - inline:    git commit -m "msg ... Co-Authored-By: ..."
#   - heredoc:   git commit -m "$(cat <<'EOF' ... Co-Authored-By: ... EOF)"
#   - amend:     git commit --amend -m "... Co-Authored-By: ..."
# Workaround for false-positive: if you genuinely need to mention the literal
# string "Co-Authored-By" inside a commit message body (e.g., a CHANGELOG entry
# describing this policy), use printf via a temp file:
#   printf '%s\n' "..." > /tmp/msg && git commit -F /tmp/msg
# The -F path is the documented escape hatch; -F + a file with the trailer is
# also caught by reading the file content, but the hook only sees the command
# text so -F is the loophole. Use carefully; the policy is on the author.
if echo "$COMMAND" | grep -qE 'git[[:space:]]+commit' && echo "$COMMAND" | grep -qiE 'co-authored-by'; then
  echo "BLOCKED: 'Co-Authored-By:' trailers are forbidden on theo-memory commits (user policy 2026-05-22). Remove the trailer from the commit message body. See ~/.claude/projects/-home-paulo-Projetos-usetheo-theo-memory/memory/no_coauthored_by_in_commits.md for rationale." >&2
  exit 2
fi

# --- npm publish guard (project is pre-release, not published yet) ---
if echo "$COMMAND" | grep -qE 'npm[[:space:]]+(publish|unpublish)'; then
  echo "BLOCKED: '@usetheo/memory' is pre-release and not yet published to npm. Publishing requires explicit human authorization plus a v1.0 milestone with reproduced benchmarks (CLAUDE.md § Pre-release status)." >&2
  exit 2
fi

# --- pip / pip install / poetry inside .claude/knowledge-base/references/ (Python sub-projects exist there) ---
if echo "$COMMAND" | grep -qE '(pip|poetry|uv)[[:space:]]+install' && pwd | grep -q '.claude/knowledge-base/references/'; then
  echo "BLOCKED: never install dependencies inside .claude/knowledge-base/references/. Those are read-only clones." >&2
  exit 2
fi

exit 0
