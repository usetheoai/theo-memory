#!/usr/bin/env python3
"""Aggregate N LongMemEval e2e-qa run JSONL files into a report.

Each input is one run's JSONL (one ExampleResult per line, with `correct`,
`questionType`, `ingestErrors`). Emits per-run + across-run mean/std, per-type
breakdown, and an honest ingestError tally.

This reports TheMemory's OWN measurement only. It deliberately emits no
comparison against another system: a cross-system number is meaningless without
the same model, the same dataset and the same judge, and the project ships no
comparative claim (see the public-copy discipline).

Usage:  aggregate-longmemeval.py run1.jsonl run2.jsonl run3.jsonl [--out report.md]
"""
from __future__ import annotations

import json
import statistics
import sys
from collections import defaultdict

CAVEATS = [
    "- **Model:** gpt-4o-mini — a small/cheap model. This number is NOT comparable to any "
    "published leaderboard figure produced with a different model.",
    "- **Judge:** the judge is STRICT (#148 abstention-is-miss guard short-circuits before the "
    "LLM judge), which LOWERS the number relative to a lenient judge.",
    "- **Pipeline:** this measures *TheMemory's* extraction/retrieval on LongMemEval. It says "
    "nothing about any other system.",
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
        "# TheMemory — full LongMemEval_oracle reproduction\n",
        f"- Runs: **{len(runs)}** · questions/run: **{runs[0]['total']}** · model: "
        "**openai/gpt-4o-mini** (OpenRouter) · embedder: LocalTransformer(384) · reflect ON.\n",
        f"- **TheMemory overall: {fmt_mean_std(overalls)}** "
        f"(per-run: {', '.join(f'{o:.1f}%' for o in overalls)}).\n",
        f"- Ingest errors across all runs: **{sum(r['ingest_errors'] for r in runs)}** "
        "(non-zero would invalidate the run — rate-limit/throttle).\n",
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
