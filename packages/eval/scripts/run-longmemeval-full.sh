#!/usr/bin/env bash
# Run all 500 examples in the selected LongMemEval dataset through e2e-qa R times,
# preserving the dataset variant in metadata (Oracle is the default; use S for standard comparison),
# same model, then aggregate into a report.
#
# Requires: gitignored .env.local or .env at repo root (OPENAI_API_KEY / OPENAI_BASE_URL /
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

# Load the gitignored key/env (no echo); .env.local takes precedence when available.
ENV_FILE="${THEOMEM_BENCH_ENV:-$([ -f ./.env.local ] && echo ./.env.local || echo ./.env)}"
set -a; . "$ENV_FILE"; set +a
MODEL="${OPENAI_CHAT_MODEL:-gpt-4o-mini-2024-07-18}"
BASE_URL="${OPENAI_BASE_URL:-https://api.openai.com/v1}"
PROVIDER="$(node -e 'try { process.stdout.write(new URL(process.argv[1]).hostname) } catch { process.stdout.write("unknown") }' "$BASE_URL")"
TOP_K="${E2E_QA_TOP_K:-20}"
DATASET="${E2E_QA_DATASET:-benchmarks/data/longmemeval_oracle.json}"
DATASET_FILE="$(basename "$DATASET")"
case "$DATASET_FILE" in
  longmemeval_oracle.json) DATASET_VARIANT="oracle" ;;
  longmemeval_s*.json) DATASET_VARIANT="S" ;;
  longmemeval_m*.json) DATASET_VARIANT="M" ;;
  *) DATASET_VARIANT="custom/unknown" ;;
esac
TURN_CAP="${E2E_QA_TURN_CAP:-0}"
INGEST_MODE="${E2E_QA_INGEST_MODE:-turn}"
META="$OUTDIR/run.meta"
SOURCE_HASH="$(find packages/core/src packages/eval/src packages/eval/scripts -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1)"
{
  echo "head=$(git rev-parse HEAD)"
  echo "core_eval_source_sha256=$SOURCE_HASH"
  echo "pnpm_lock_sha256=$(sha256sum pnpm-lock.yaml | cut -d' ' -f1)"
  echo "dataset_sha256=$(sha256sum "$DATASET" | cut -d' ' -f1)"
  echo "dataset_file=$DATASET_FILE"
  echo "dataset_variant=$DATASET_VARIANT"
  echo "model=$MODEL"
  echo "provider=$PROVIDER"
  echo "prompt_mode=official-longmemeval"
  echo "ingest_mode=$INGEST_MODE"
  echo "embedding=Xenova/all-MiniLM-L6-v2 (384d, local)"
  echo "reflection=on"
  echo "top_k=$TOP_K"
  if [ "$TURN_CAP" = "0" ]; then echo "turn_cap=all"; else echo "turn_cap=$TURN_CAP"; fi
  echo "concurrency=$CONC"
  echo "runs=$RUNS"
} > "$META"
echo "[lme] model=$MODEL provider=$PROVIDER prompt_mode=official-longmemeval ingest_mode=$INGEST_MODE top_k=$TOP_K runs=$RUNS concurrency=$CONC outdir=$OUTDIR"

for r in $(seq 1 "$RUNS"); do
  jsonl="$OUTDIR/run${r}.jsonl"
  : > "$jsonl"
  echo "[lme] === run $r/$RUNS → $jsonl ==="
  # Per-example fail-safe lives IN the harness (runSafely); a run that still exits
  # non-zero (infra/DB) must not abort the whole driver — keep going, aggregate what we have.
  set +e
  E2E_QA_LIMIT=full \
  E2E_QA_DATASET="$DATASET" \
  E2E_QA_TURN_CAP="$TURN_CAP" \
  E2E_QA_CONCURRENCY="$CONC" \
  E2E_QA_TOP_K="$TOP_K" \
  E2E_QA_INGEST_MODE="$INGEST_MODE" \
  E2E_QA_REFLECT=1 \
  E2E_QA_DB="themem_lme_run${r}" \
  E2E_QA_JSONL="$jsonl" \
    pnpm exec tsx --tsconfig packages/eval/tsconfig.json packages/eval/src/stages/e2e-qa/run.ts \
    > "$OUTDIR/run${r}.log" 2>&1
  rc=$?
  set -e
  echo "[lme] run $r done (exit $rc): $(wc -l < "$jsonl") examples; $(grep -c 'ERROR=' "$OUTDIR/run${r}.log" 2>/dev/null || echo 0) per-example errors"
done

echo "[lme] === aggregating ==="
python3 packages/eval/scripts/aggregate-longmemeval.py \
  "$OUTDIR"/run*.jsonl --meta "$META" --out docs/benchmarks/full-longmemeval.md
echo "[lme] DONE → docs/benchmarks/full-longmemeval.md"
