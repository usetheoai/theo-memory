#!/usr/bin/env bash
# T0.1 — p0-baseline.sh — baseline audit script for p0-api-sdk-mcp-correctness-audit plan.
#
# Captures the empirical baseline (paper-name counts, export counts, subpath count,
# `any` count in public surface, dist/ presence, ## Dependencies section presence)
# that downstream Phase T1/T2/T3 tasks reference as their regression sentinels.
#
# EC-11 (DOCUMENT): regex semantics target GNU grep (Linux primary dev OS per CLAUDE.md).
# BSD-grep (macOS default) may differ on \b word-boundary handling; the script is NOT
# cross-OS tested beyond Linux.
#
# Exit code: always 0 (audit-only, never gates anything by itself; reporting only).
# Output: JSON to stdout matching the schema asserted by tests/integration/p0-audit/baseline.test.ts.
#
# @see .claude/knowledge-base/plans/p0-api-sdk-mcp-correctness-audit-plan.md § T0.1

set -u
set -o pipefail

# Resolve repo root from script location (scripts/audit/ → ../..).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

# Paper-name grep — strict scope src/**/*.ts; exclude knowledge-base citations (rule-allowed).
count_paper_name() {
  local token="$1"
  grep -rE "\\b$token\\b" src/ --include="*.ts" 2>/dev/null \
    | grep -v "knowledge-base" \
    | grep -v "\.claude/knowledge-base" \
    | wc -l
}

REDACTED=$(count_paper_name "REDACTED")
REDACTED=$(count_paper_name "REDACTED")
REDACTED=$(count_paper_name "REDACTED")
REDACTED=$(count_paper_name "REDACTED")
REDACTED=$(count_paper_name "REDACTED")

# Export counts (literal `^export ` lines).
SRC_INDEX_EXPORTS=$(grep -cE '^export ' src/index.ts 2>/dev/null || echo 0)
SRC_CORE_INDEX_EXPORTS=$(grep -cE '^export ' src/core/index.ts 2>/dev/null || echo 0)

# Subpath count from package.json#exports keys.
SUBPATHS=$(python3 -c "
import json
with open('package.json') as f:
    pkg = json.load(f)
print(len(pkg.get('exports', {})))
" 2>/dev/null || echo 0)

# `any` in public surface (\bany\b — widened per EC-5 absorption to catch Array<any>, Promise<any>, etc.).
ANY_IN_PUBLIC=$(grep -cE '\bany\b' src/index.ts src/core/index.ts 2>/dev/null | awk -F: '{s+=$2} END {print s}')
if [ -z "$ANY_IN_PUBLIC" ]; then ANY_IN_PUBLIC=0; fi

# dist/agent-tools/cli.js existence (Python-truthy literal).
if [ -f "dist/agent-tools/cli.js" ]; then
  DIST_EXISTS="True"
else
  DIST_EXISTS="False"
fi

# EC-1 absorption sentinel: plan file contains ## Dependencies header (Python-truthy literal).
PLAN_FILE=".claude/knowledge-base/plans/p0-api-sdk-mcp-correctness-audit-plan.md"
if [ -f "$PLAN_FILE" ] && grep -qE '^## Dependencies$' "$PLAN_FILE"; then
  DEPENDENCIES_SECTION_PRESENT="True"
else
  DEPENDENCIES_SECTION_PRESENT="False"
fi

# Emit JSON via python3 (consistent escaping vs hand-rolled).
python3 -c "
import json
print(json.dumps({
    'paper_names': {
        'REDACTED': $REDACTED,
        'REDACTED': $REDACTED,
        'REDACTED': $REDACTED,
        'REDACTED': $REDACTED,
        'REDACTED': $REDACTED,
    },
    'exports': {
        'src/index.ts': $SRC_INDEX_EXPORTS,
        'src/core/index.ts': $SRC_CORE_INDEX_EXPORTS,
    },
    'subpaths': $SUBPATHS,
    'any_in_public': $ANY_IN_PUBLIC,
    'dist_exists': $DIST_EXISTS,
    'dependencies_section_present': $DEPENDENCIES_SECTION_PRESENT,
}, indent=2))
"
