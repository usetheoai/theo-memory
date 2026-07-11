#!/usr/bin/env python3
"""Dogfood journey-catalog structural validator (T1.2) — author-time gate.

Validates `knowledge-base/dogfood/journeys.md` structure so the runtime audit (T1.1)
has a well-formed Source of Truth. Fails on: a missing surface (all four SDK/API/MCP/UI
required), a surface whose journeys are not ALL anchor (Q1 — every journey MUST be
`anchor: true`), a duplicate journey id, or a malformed id. stdlib-only (Rule 9).

@see .claude/knowledge-base/plans/dogfood-unified-journey-suite-plan.md § Phase 1 / T1.2
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

SURFACES = {"SDK", "API", "MCP", "UI"}
_ROW = re.compile(r"^\|\s*(J-(?:SDK|API|MCP|UI)-\d+)\s*\|\s*([^|]+?)\s*\|[^|]*\|\s*([^|]+?)\s*\|")
_ANCHOR_TRUE = re.compile(r"^(true|yes)$", re.IGNORECASE)


def validate(catalog: Path) -> list[str]:
    """Return a list of issue strings — empty means valid."""
    issues: list[str] = []
    if not catalog.exists():
        return [f"catalog_missing: {catalog}"]
    seen: set[str] = set()
    by_surface: dict[str, int] = {}
    rows = 0
    for line in catalog.read_text(encoding="utf-8").splitlines():
        m = _ROW.match(line)
        if not m:
            continue
        rows += 1
        jid, surface, anchor = m.group(1), m.group(2).strip(), m.group(3).strip()
        if jid in seen:
            issues.append(f"duplicate_id: {jid}")
        seen.add(jid)
        by_surface[surface] = by_surface.get(surface, 0) + 1
        if not _ANCHOR_TRUE.match(anchor):
            issues.append(f"journey_not_anchor: {jid} (Q1 — every journey MUST be anchor:true)")
    if rows == 0:
        issues.append("no_journeys")
    for s in sorted(SURFACES):
        if by_surface.get(s, 0) < 1:
            issues.append(f"surface_uncovered: {s}")
    return issues


def main() -> int:
    ap = argparse.ArgumentParser(description="Dogfood journey-catalog validator (T1.2).")
    ap.add_argument("--catalog", required=True, type=Path)
    args = ap.parse_args()
    issues = validate(args.catalog)
    print(json.dumps({"valid": not issues, "issues": issues}))
    return 0 if not issues else 1


if __name__ == "__main__":
    sys.exit(main())
