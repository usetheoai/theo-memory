#!/usr/bin/env python3
"""Aggregate N LongMemEval e2e-qa run JSONL files into a report.

Each input is one run's JSONL (one ExampleResult per line, with `correct`,
`questionType`, `ingestErrors`). Emits per-run + across-run mean/std, per-type
breakdown, and an honest ingestError tally.

This reports TheMemory's OWN measurement only. It deliberately emits no
comparison against another system: a cross-system number is meaningless without
the same model, the same dataset and the same judge. Incomplete or degraded runs
are explicitly marked invalid and never presented as a full benchmark score.

Usage:  aggregate-longmemeval.py run1.jsonl run2.jsonl run3.jsonl [--out report.md]
"""
from __future__ import annotations

import json
import statistics
import sys
from collections import defaultdict

CAVEATS = [
    "- **Model/provider:** model and API provider are recorded in the run metadata. This number is NOT comparable to any "
    "published leaderboard figure produced with a different model.",
    "- **Judge:** the judge is STRICT (#148 abstention-is-miss guard short-circuits before the "
    "LLM judge), which LOWERS the number relative to a lenient judge.",
    "- **Pipeline:** this measures *TheMemory's* extraction/retrieval on LongMemEval. It says "
    "nothing about any other system.",
    "- **Integrity:** a run is valid only when it contains all 500 unique examples and has zero "
    "ingestion, reflection, or pipeline errors.",
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
    ids = [r.get("questionId") for r in rows]
    ingest_errors = sum(int(r.get("ingestErrors", 0) or 0) for r in rows)
    truncated_examples = sum(
        1 for r in rows
        if r.get("availableTurns") is not None
        and int(r.get("ingestedTurns", 0) or 0) != int(r["availableTurns"])
    )
    unknown_turn_coverage = sum(1 for r in rows if r.get("availableTurns") is None)
    other_stage_errors = sum(
        1 for r in rows if r.get("reflectionError") or r.get("error")
    )
    unique_complete = total == 500 and len(set(ids)) == 500 and None not in ids
    return {
        "total": total,
        "correct": correct,
        "overall": (100.0 * correct / total) if total else 0.0,
        "by_type": {t: (sum(v), len(v)) for t, v in sorted(by_type.items())},
        "ingest_errors": ingest_errors,
        "truncated_examples": truncated_examples,
        "unknown_turn_coverage": unknown_turn_coverage,
        "other_stage_errors": other_stage_errors,
        "integrity_valid": unique_complete and ingest_errors == 0 and other_stage_errors == 0
        and truncated_examples == 0 and unknown_turn_coverage == 0,
    }


def fmt_mean_std(vals: list[float]) -> str:
    if len(vals) == 1:
        return f"{vals[0]:.1f}%"
    return f"{statistics.mean(vals):.1f}% ± {statistics.pstdev(vals):.1f}"


def _header_block(runs: list[dict], overalls: list[float], metadata: dict[str, str]) -> list[str]:
    model = metadata.get("model", "unspecified")
    provider = metadata.get("provider", "unspecified")
    embedder = metadata.get("embedding", "unspecified")
    reflection = metadata.get("reflection", "unspecified")
    top_k = metadata.get("top_k", "unspecified")
    turn_cap = metadata.get("turn_cap", "unspecified")
    concurrency = metadata.get("concurrency", "unspecified")
    variant = metadata.get("dataset_variant", "unspecified")
    dataset_file = metadata.get("dataset_file", "unspecified")
    dataset_sha256 = metadata.get("dataset_sha256", "unspecified")
    valid = all(r["integrity_valid"] for r in runs)
    if variant == "oracle":
        variant_note = "**Variant note:** Oracle includes only evidence sessions; this is not LongMemEval-S and must not be compared with S results."
    elif variant == "S":
        variant_note = "**Variant note:** LongMemEval-S includes the full distractor history and is the standard conversational-memory comparison set."
    elif variant == "M":
        variant_note = "**Variant note:** LongMemEval-M is the approximately 1.5M-token history variant; report separately from S and Oracle."
    else:
        variant_note = "**Variant note:** dataset variant is not identified; do not compare this result with published LongMemEval results."
    return [
        f"# TheMemory — LongMemEval {variant} reproduction\n",
        f"- Dataset: **{dataset_file}** · variant: **{variant}** · SHA-256: **{dataset_sha256}**. {variant_note}\n",
        f"- Runs: **{len(runs)}** · questions/run: **{runs[0]['total']}** · model/provider: "
        f"**{model} / {provider}** · embedder: **{embedder}** · reflection: **{reflection}** · "
        f"top-k: **{top_k}** · turn cap: **{turn_cap}** · concurrency: **{concurrency}**.\n",
        f"- Run integrity: **{'VALID' if valid else 'INVALID'}** "
        f"(each run must contain exactly 500 unique examples and zero stage errors).\n",
        f"- **TheMemory overall on variant {variant} (diagnostic if invalid): {fmt_mean_std(overalls)}** "
        f"(per-run: {', '.join(f'{o:.1f}%' for o in overalls)}).\n",
        f"- Ingest errors across all runs: **{sum(r['ingest_errors'] for r in runs)}** "
        f"· Other stage-error examples: **{sum(r['other_stage_errors'] for r in runs)}** "
        f"· Truncated-history examples: **{sum(r['truncated_examples'] for r in runs)}** "
        f"· Examples with unknown turn coverage: **{sum(r['unknown_turn_coverage'] for r in runs)}**.\n",
        f"- Commit: **{metadata.get('head', 'unspecified')}** · source tree SHA-256: "
        f"**{metadata.get('core_eval_source_sha256', 'unspecified')}**.\n",
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


def build_report(runs: list[dict], metadata: dict[str, str] | None = None) -> str:
    overalls = [r["overall"] for r in runs]
    metadata = metadata or {}
    blocks = (
        _header_block(runs, overalls, metadata)
        + [""]
        + _per_type_block(runs)
        + ["## Honest comparability caveats (Rule 3)\n", *CAVEATS]
    )
    return "\n".join(blocks) + "\n"


def main() -> int:
    argv = sys.argv[1:]
    out_path = argv[argv.index("--out") + 1] if "--out" in argv else None
    meta_path = argv[argv.index("--meta") + 1] if "--meta" in argv else None
    excluded = {out_path, meta_path}
    inputs = [a for a in argv if not a.startswith("--") and a not in excluded]
    if not inputs:
        print("usage: aggregate-longmemeval.py run1.jsonl [run2.jsonl ...] [--meta run.meta] [--out report.md]")
        return 2
    metadata: dict[str, str] = {}
    if meta_path:
        with open(meta_path, encoding="utf-8") as fh:
            metadata = dict(line.rstrip("\n").split("=", 1) for line in fh if "=" in line)
    report = build_report([run_stats(load_run(p)) for p in inputs], metadata)
    if out_path:
        with open(out_path, "w", encoding="utf-8") as fh:
            fh.write(report)
        print(f"wrote {out_path}")
    else:
        print(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
