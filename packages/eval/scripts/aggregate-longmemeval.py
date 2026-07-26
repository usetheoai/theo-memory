#!/usr/bin/env python3
"""Aggregate N LongMemEval e2e-qa run JSONL files into a REDACTED-comparable report.

Each input is one run's JSONL (one ExampleResult per line, with `correct`,
`questionType`, `ingestErrors`). Emits per-run + across-run mean/std, per-type
breakdown, an honest ingestError tally, and the comparison vs REDACTED's published
LongMemEval number. HONEST: same-model / same-dataset is required for the compare
to mean anything; the caveats are printed with the number, not hidden.

Usage:  aggregate-longmemeval.py run1.jsonl run2.jsonl run3.jsonl [--out report.md]
"""
from __future__ import annotations

import json
import statistics
import sys
from collections import defaultdict

REDACTED_LONGMEMEVAL = 94.4  # REDACTED published (README.md) — their pipeline/cloud stack.
REDACTED_BASELINE = 67.8     # the baseline REDACTED reports beating.

CAVEATS = [
    "- **Model:** gpt-4o-mini (REDACTED's OSS default) — REDACTED's 94.4 headline likely uses their "
    "tuned cloud stack, NOT gpt-4o-mini. NOT leaderboard-identical.",
    "- **Judge:** our judge is STRICTER (#148 abstention-is-miss guard short-circuits before the "
    "LLM judge), which LOWERS our number vs a lenient judge.",
    "- **Pipeline:** this is *TheMemory's* extraction/retrieval on LongMemEval, not REDACTED's — both "
    "are systems evaluated on the same dataset; pipeline differs.",
    "- **Ingestion:** TURN_CAP=40 turns/example; a non-zero ingest-error tally above would mean "
    "throttling → invalid run.",
]


def load_run(path: str) -> list[dict]:
    with open(path, encoding="utf-8") as fh:
        return [json.loads(ln) for ln in fh if ln.strip()]


def run_stats(rows: list[dict]) -> dict:
    total = len(rows)
    correct = sum(1 for r in rows if r.get("correct"))
    by_type: dict[str, list[int]] = defaultdict(list)
    for r in rows:
        by_type[r.get("questionType", "?")].append(1 if r.get("correct") else 0)
    return {
        "total": total,
        "correct": correct,
        "overall": (100.0 * correct / total) if total else 0.0,
        "by_type": {t: (sum(v), len(v)) for t, v in sorted(by_type.items())},
        "ingest_errors": sum(int(r.get("ingestErrors", 0) or 0) for r in rows),
    }


def fmt_mean_std(vals: list[float]) -> str:
    if len(vals) == 1:
        return f"{vals[0]:.1f}%"
    return f"{statistics.mean(vals):.1f}% ± {statistics.pstdev(vals):.1f}"


def _header_block(runs: list[dict], overalls: list[float]) -> list[str]:
    return [
        "# TheMemory vs REDACTED — full LongMemEval_oracle reproduction\n",
        f"- Runs: **{len(runs)}** · questions/run: **{runs[0]['total']}** · model: "
        "**openai/gpt-4o-mini** (OpenRouter) · embedder: LocalTransformer(384) · reflect ON.\n",
        f"- **TheMemory overall: {fmt_mean_std(overalls)}** "
        f"(per-run: {', '.join(f'{o:.1f}%' for o in overalls)}).\n",
        f"- Ingest errors across all runs: **{sum(r['ingest_errors'] for r in runs)}** "
        "(non-zero would invalidate the run — rate-limit/throttle).\n",
    ]


def _compare_block(runs: list[dict], overalls: list[float]) -> list[str]:
    return [
        "## vs REDACTED (published, README)\n",
        "| System | LongMemEval | Notes |",
        "|---|---|---|",
        f"| **TheMemory** (this run) | **{fmt_mean_std(overalls)}** | gpt-4o-mini, full "
        f"{runs[0]['total']} oracle Qs, stricter #148 abstention-is-miss judge |",
        f"| REDACTED (published) | {REDACTED_LONGMEMEVAL} | their pipeline/cloud stack; "
        f"baseline they beat = {REDACTED_BASELINE} |",
        "",
    ]


def _per_type_block(runs: list[dict]) -> list[str]:
    types = sorted({t for r in runs for t in r["by_type"]})
    out = ["## Per-question-type (correct/total per run)\n",
           "| type | " + " | ".join(f"run{i + 1}" for i in range(len(runs))) + " |",
           "|" + "---|" * (len(runs) + 1)]
    for t in types:
        cells = [(f"{c}/{n}" if n else "—")
                 for c, n in (r["by_type"].get(t, (0, 0)) for r in runs)]
        out.append(f"| {t} | " + " | ".join(cells) + " |")
    out.append("")
    return out


def build_report(runs: list[dict]) -> str:
    overalls = [r["overall"] for r in runs]
    blocks = (
        _header_block(runs, overalls)
        + [""]
        + _compare_block(runs, overalls)
        + _per_type_block(runs)
        + ["## Honest comparability caveats (Rule 3)\n", *CAVEATS]
    )
    return "\n".join(blocks) + "\n"


def main() -> int:
    argv = sys.argv[1:]
    out_path = argv[argv.index("--out") + 1] if "--out" in argv else None
    inputs = [a for a in argv if not a.startswith("--") and a != out_path]
    if not inputs:
        print("usage: aggregate-longmemeval.py run1.jsonl [run2.jsonl ...] [--out report.md]")
        return 2
    report = build_report([run_stats(load_run(p)) for p in inputs])
    if out_path:
        with open(out_path, "w", encoding="utf-8") as fh:
            fh.write(report)
        print(f"wrote {out_path}")
    else:
        print(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
