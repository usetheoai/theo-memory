#!/bin/bash
# Attest a plan file — compute SHA256, write to .claude/.attestations/{slug}.sha256
#
# Adapted from planning-with-files v2.43.0 attest-plan.sh. Provides tamper
# detection for plan files: the next UserPromptSubmit hook reads the stored
# hash and compares against the live file. Mismatch → injection blocked +
# tamper warning to the agent.
#
# Workflow:
#   1. After editing a plan file, run: bash .claude/scripts/attest-plan.sh {slug}
#   2. This writes .claude/.attestations/{slug}.sha256 (atomic temp-rename).
#   3. Subsequent prompts validate against this stored hash.
#   4. If the plan is edited again without re-attesting, hooks block injection.
#
# Usage:
#   bash .claude/scripts/attest-plan.sh {slug}             # attest plan file by slug
#   bash .claude/scripts/attest-plan.sh --all              # attest all plans in plans/
#   bash .claude/scripts/attest-plan.sh --verify {slug}    # verify (read-only) without re-writing

set -eu

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$PROJECT_DIR" || exit 1

ATTEST_DIR=".claude/.attestations"
PLANS_DIR=".claude/knowledge-base/plans"

mkdir -p "$ATTEST_DIR"

sha256_of() {
  local file="$1"
  (sha256sum "$file" 2>/dev/null || shasum -a 256 "$file" 2>/dev/null) | awk '{print $1}'
}

attest_one() {
  local slug="$1"
  local plan_file="${PLANS_DIR}/${slug}-plan.md"
  if [ ! -f "$plan_file" ]; then
    echo "ERROR: plan file not found: $plan_file" >&2
    return 1
  fi
  local hash
  hash=$(sha256_of "$plan_file")
  if [ -z "$hash" ]; then
    echo "ERROR: failed to compute sha256 for $plan_file" >&2
    return 1
  fi
  local out="${ATTEST_DIR}/${slug}.sha256"
  local tmp="${out}.tmp.$$"
  printf '%s' "$hash" > "$tmp"
  mv "$tmp" "$out"
  echo "attested: $slug -> $hash"
}

verify_one() {
  local slug="$1"
  local plan_file="${PLANS_DIR}/${slug}-plan.md"
  local attest_file="${ATTEST_DIR}/${slug}.sha256"
  if [ ! -f "$plan_file" ]; then
    echo "MISSING-PLAN: $plan_file"
    return 2
  fi
  if [ ! -f "$attest_file" ]; then
    echo "NO-ATTESTATION: $slug (run 'bash $0 $slug' to attest)"
    return 3
  fi
  local stored
  stored=$(tr -d '\r\n[:space:]' < "$attest_file")
  local actual
  actual=$(sha256_of "$plan_file")
  if [ "$stored" = "$actual" ]; then
    echo "OK: $slug ($actual)"
    return 0
  else
    echo "TAMPERED: $slug"
    echo "  expected: $stored"
    echo "  actual:   $actual"
    return 4
  fi
}

if [ $# -eq 0 ]; then
  echo "Usage: $0 {slug} | --all | --verify {slug} | --verify-all" >&2
  exit 1
fi

case "$1" in
  --all)
    for f in "${PLANS_DIR}"/*-plan.md; do
      [ -f "$f" ] || continue
      slug=$(basename "$f" -plan.md)
      attest_one "$slug"
    done
    ;;
  --verify)
    if [ -z "${2:-}" ]; then
      echo "Usage: $0 --verify {slug}" >&2
      exit 1
    fi
    verify_one "$2"
    ;;
  --verify-all)
    rc=0
    for f in "${PLANS_DIR}"/*-plan.md; do
      [ -f "$f" ] || continue
      slug=$(basename "$f" -plan.md)
      verify_one "$slug" || rc=$?
    done
    exit "$rc"
    ;;
  *)
    attest_one "$1"
    ;;
esac

exit 0
