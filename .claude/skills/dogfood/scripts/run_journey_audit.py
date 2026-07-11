#!/usr/bin/env python3
"""Dogfood journey-audit evaluator (T1.1) — the gate's integrity core.

Joins the journey catalog (journeys.md) against evidence/*.md and emits
EVIDENCE_SUFFICIENT / EVIDENCE_WITH_CAVEATS / EVIDENCE_INSUFFICIENT per the LOCKED
golden rule (dogfood-golden-rule.md) § 3 hard-cap order. Deterministic, stdlib-only,
no LLM (Rule 9 / parsimony — see deps-audit PASS).

Golden-rule § 3 short-circuit order (authoritative; NOT the plan pseudo-code):
  #7 zero-anchor structural FIRST -> per anchor journey select ONE newest evidence
  (date, tie -> lexicographically-last filename) -> validate that file's outcome, then
  #5 oracle_result (present + non-empty after strip), then #6 secret, then #4 freshness
  (`(today - date).days > 30` = stale; inclusive at 30). First failing flag per journey
  wins; any anchor red -> INSUFFICIENT naming each. All anchors green + a non-anchor red
  -> WITH_CAVEATS. `evidence_dir_missing` is distinct from `no_evidence`.

@see .claude/knowledge-base/plans/dogfood-unified-journey-suite-plan.md § Phase 1 / T1.1
@see .claude/knowledge-base/implementations/dogfood-unified-journey-suite/sepa-iterations/T1.1-pre-red.md
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date
from pathlib import Path

FRESHNESS_DAYS = 30
_ROW = re.compile(r"^\|\s*(J-(?:SDK|API|MCP|UI)-\d+)\s*\|\s*([^|]+?)\s*\|[^|]*\|\s*([^|]+?)\s*\|")
_SECRET = re.compile(r"theo_live_[A-Za-z0-9_-]{20,}|sk-or-v1-[A-Za-z0-9]{20,}")
_ANCHOR_TRUE = re.compile(r"^(true|yes)$", re.IGNORECASE)


def parse_catalog(path: Path) -> tuple[list[dict], dict[str, list[str]]]:
    """Return (journeys, aliases). Each journey: {id, surface, anchor: bool}."""
    text = path.read_text(encoding="utf-8") if path.exists() else ""
    journeys: list[dict] = []
    for line in text.splitlines():
        m = _ROW.match(line)
        if m:
            journeys.append({"id": m.group(1), "surface": m.group(2).strip(),
                             "anchor": bool(_ANCHOR_TRUE.match(m.group(3).strip()))})
    aliases: dict[str, list[str]] = {}
    in_aliases = False
    for line in text.splitlines():
        if re.match(r"^\s*aliases:\s*$", line):
            in_aliases = True
            continue
        if in_aliases:
            am = re.match(r"^\s+(J-[A-Z]+-\d+):\s*\[([^\]]*)\]", line)
            if am:
                aliases[am.group(1)] = [x.strip() for x in am.group(2).split(",") if x.strip()]
            elif line.strip().startswith("```") or (line.strip() and not line.startswith(" ")):
                in_aliases = False
    return journeys, aliases


def parse_frontmatter(path: Path) -> dict[str, str] | None:
    """Shallow YAML frontmatter (delimited by ---). Returns {} keys->values, or None."""
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---"):
        return None
    parts = text.split("---", 2)
    if len(parts) < 3:
        return None
    fm: dict[str, str] = {"__body__": text}
    for line in parts[1].splitlines():
        m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$", line)
        if m:
            fm[m.group(1)] = m.group(2).strip()
    return fm


def load_evidence(edir: Path) -> list[dict]:
    """Each: {key, date, outcome, oracle_result(str|None), body, filename}."""
    out: list[dict] = []
    for p in sorted(edir.glob("*.md")):
        fm = parse_frontmatter(p)
        if fm is None:
            continue
        key = fm.get("journey") or fm.get("scenario")
        if not key or "date" not in fm or "outcome" not in fm:
            continue  # missing a core § 5 field -> ignored by #3
        out.append({"key": key, "date": fm["date"], "outcome": fm["outcome"],
                    "oracle_result": fm.get("oracle_result"), "body": fm["__body__"],
                    "filename": p.name})
    return out


def _accepted_keys(journey_id: str, aliases: dict[str, list[str]]) -> set[str]:
    return {journey_id, *aliases.get(journey_id, [])}


def _newest(evs: list[dict]) -> dict | None:
    """Newest by `date` frontmatter, tie -> lexicographically-last filename (EC-5)."""
    if not evs:
        return None
    return sorted(evs, key=lambda e: (e["date"], e["filename"]))[-1]


def _journey_flag(ev: dict | None, today: date) -> str | None:
    """First failing hard-cap flag for one journey, or None if green."""
    if ev is None:
        return "no_evidence"
    if ev["outcome"] != "pass":
        return f"red:{ev['outcome']}"
    oracle = (ev["oracle_result"] or "").strip()
    if not oracle:  # #5 EC-3 — pass requires a non-empty oracle_result
        return "outcome_pass_requires_oracle_result"
    if _SECRET.search(ev["body"]):  # #6 EC-2
        return "evidence_contains_secret"
    try:
        age = (today - date.fromisoformat(ev["date"])).days
    except ValueError:
        return "bad_date"
    if age > FRESHNESS_DAYS:  # #4 — inclusive at 30
        return "stale"
    return None


def audit(catalog: Path, edir: Path, today: date | None = None) -> dict:
    today = today or date.today()
    journeys, aliases = parse_catalog(catalog)
    anchors = [j for j in journeys if j["anchor"]]
    # #7 — structural: zero anchor journeys never vacuously passes (EC-7).
    if not anchors:
        return {"verdict": "EVIDENCE_INSUFFICIENT",
                "reds": [{"id": "*", "flag": "no_anchor_journeys"}]}
    if not edir.exists():
        return {"verdict": "EVIDENCE_INSUFFICIENT",
                "reds": [{"id": j["id"], "flag": "evidence_dir_missing"} for j in anchors]}
    evidence = load_evidence(edir)
    anchor_reds: list[dict] = []
    non_anchor_reds: list[dict] = []
    for j in journeys:
        keys = _accepted_keys(j["id"], aliases)
        newest = _newest([e for e in evidence if e["key"] in keys])
        flag = _journey_flag(newest, today)
        if flag is not None:
            (anchor_reds if j["anchor"] else non_anchor_reds).append({"id": j["id"], "flag": flag})
    if anchor_reds:
        return {"verdict": "EVIDENCE_INSUFFICIENT", "reds": anchor_reds}
    if non_anchor_reds:
        return {"verdict": "EVIDENCE_WITH_CAVEATS", "reds": non_anchor_reds}
    return {"verdict": "EVIDENCE_SUFFICIENT", "reds": []}


def main() -> int:
    ap = argparse.ArgumentParser(description="Dogfood journey-audit evaluator (T1.1).")
    ap.add_argument("--catalog", required=True, type=Path)
    ap.add_argument("--evidence-dir", required=True, type=Path)
    ap.add_argument("--golden-rule", type=Path, default=None)  # reserved; caps live in code per § 3
    args = ap.parse_args()
    result = audit(args.catalog, args.evidence_dir)
    print(json.dumps(result))
    return 0 if result["verdict"] in ("EVIDENCE_SUFFICIENT", "EVIDENCE_WITH_CAVEATS") else 1


if __name__ == "__main__":
    sys.exit(main())
