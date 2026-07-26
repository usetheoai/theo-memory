#!/usr/bin/env bash
# Run the FULL LongMemEval_oracle set through the e2e-qa harness R times (variance),
# same model, then aggregate into a REDACTED-comparable report.
#
# Requires: gitignored .env.local at repo root (OPENAI_API_KEY / OPENAI_BASE_URL /
# OPENAI_CHAT_MODEL / THEOMEM_PG_URI) + local pgvector. Each run uses an isolated DB.
#
# Env:  RUNS (default 3) · CONC (E2E_QA_CONCURRENCY, default 10) · OUTDIR (default /tmp/lme)
# Usage: RUNS=3 CONC=10 bash packages/eval/scripts/run-longmemeval-full.sh
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

RUNS="${RUNS:-3}"
CONC="${CONC:-10}"
OUTDIR="${OUTDIR:-/tmp/lme}"
mkdir -p "$OUTDIR"

# Load the gitignored key/env (no echo).
set -a; . ./.env.local; set +a
echo "[lme] model=${OPENAI_CHAT_MODEL:-?} runs=$RUNS concurrency=$CONC outdir=$OUTDIR"

for r in $(seq 1 "$RUNS"); do
  jsonl="$OUTDIR/run${r}.jsonl"
  : > "$jsonl"
  echo "[lme] === run $r/$RUNS → $jsonl ==="
  # Per-example fail-safe lives IN the harness (runSafely); a run that still exits
  # non-zero (infra/DB) must not abort the whole driver — keep going, aggregate what we have.
  set +e
  E2E_QA_LIMIT=full \
  E2E_QA_CONCURRENCY="$CONC" \
  E2E_QA_REFLECT=1 \
  E2E_QA_DB="themem_lme_run${r}" \
  E2E_QA_JSONL="$jsonl" \
    pnpm exec tsx packages/eval/src/stages/e2e-qa/run.ts \
    > "$OUTDIR/run${r}.log" 2>&1
  rc=$?
  set -e
  echo "[lme] run $r done (exit $rc): $(wc -l < "$jsonl") examples; $(grep -c 'ERROR=' "$OUTDIR/run${r}.log" 2>/dev/null || echo 0) per-example errors"
done

echo "[lme] === aggregating ==="
python3 packages/eval/scripts/aggregate-longmemeval.py \
  "$OUTDIR"/run*.jsonl --out docs/benchmarks/full-longmemeval-vs-REDACTED.md
echo "[lme] DONE → docs/benchmarks/full-longmemeval-vs-REDACTED.md"
