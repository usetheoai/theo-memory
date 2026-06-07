"""Check evidence citations in an implementation plan (M3 v0.1).

Per `.claude/rules/plan-confidence-golden-rule.md` § M3 v0.1, this checker
verifies the four kinds of citations that may appear in a plan's prose AND
that fabrication of any one of them caps the plan-confidence verdict at 49
(INVALID band).

Kinds covered (M3 v0.1):
  - `rule`             — `.claude/rules/<name>.md` paths
  - `blueprint`        — `.claude/knowledge-base/discoveries/blueprints/<name>.md` paths
  - `intra_plan_adr`   — `ADR D<N>` references; must match a `### D<N> ...`
                         header inside the SAME plan file
  - `unbreakable_rule` — `Inquebrável Rule <N>` (or `Inquebravel Rule <N>`);
                         N must be in 1..13 per Unbreakable Rules root contract

Out of scope (M3 v0.2 future):
  - Code-file refs `src/foo.py:42` — deferred until SAFE-adapted semantic check
  - External URLs / git SHAs / npm-package version pins

The checker is read-only and deterministic; zero LLM calls.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

# ---------------------------------------------------------------------------
# Public contract — consumed by `run_structural.py`
# ---------------------------------------------------------------------------


@dataclass
class Citation:
    """One citation found in the plan prose.

    Fields are exactly what `run_structural.py § evidence` serializes
    into the JSON output (`kind`, `raw_text`, `location_line`, `reason`).
    """

    kind: str  # rule | blueprint | intra_plan_adr | unbreakable_rule
    raw_text: str
    location_line: int
    reason: str = ""  # empty for resolved citations; non-empty for unresolved


@dataclass
class EvidenceReport:
    """Aggregated citation evidence for one plan."""

    total_citations: int = 0
    unresolved_citations: list[Citation] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Regex patterns
# ---------------------------------------------------------------------------

# `.claude/rules/<name>.md` — optionally backtick-wrapped
_RULE_RE = re.compile(r"\.claude/rules/([a-zA-Z0-9_-]+)\.md")

# `.claude/knowledge-base/discoveries/blueprints/<name>.md`
_BLUEPRINT_RE = re.compile(
    r"\.claude/knowledge-base/discoveries/blueprints/([a-zA-Z0-9_-]+)\.md"
)

# `ADR D<N>` — bounded by word boundaries to avoid matching `ADR D-skip-tools` etc.
# Captures the numeric portion.
_INTRA_ADR_RE = re.compile(r"\bADR\s+D(\d+)\b")

# `Inquebrável Rule <N>` (and ASCII-fallback `Inquebravel Rule <N>`) — Rule
# bounded by digit-only suffix.
_UNBREAKABLE_RE = re.compile(r"Inquebr[áa]vel\s+Rule\s+(\d+)", re.IGNORECASE)

# `### D<N>` header inside the plan — used to validate `intra_plan_adr` targets
_INTRA_ADR_HEADER_RE = re.compile(r"^###\s+D(\d+)\b", re.MULTILINE)

# Unbreakable Rules are 1..13 per root `/home/paulo/.claude/CLAUDE.md`
_UNBREAKABLE_MAX = 13


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _line_of_offset(text: str, offset: int) -> int:
    """Return 1-based line number for a character offset into `text`."""
    return text.count("\n", 0, offset) + 1


# ---------------------------------------------------------------------------
# Per-kind extractors + resolvers
# ---------------------------------------------------------------------------


def _check_rules(text: str, repo_root: Path) -> tuple[int, list[Citation]]:
    found: list[Citation] = []
    unresolved: list[Citation] = []
    seen: set[str] = set()
    for m in _RULE_RE.finditer(text):
        raw = m.group(0)
        if raw in seen:
            continue
        seen.add(raw)
        line = _line_of_offset(text, m.start())
        path = repo_root / raw
        c = Citation(kind="rule", raw_text=raw, location_line=line)
        found.append(c)
        if not path.is_file():
            c.reason = f"rule file not found at {path}"
            unresolved.append(c)
    return len(found), unresolved


def _check_blueprints(text: str, repo_root: Path) -> tuple[int, list[Citation]]:
    found: list[Citation] = []
    unresolved: list[Citation] = []
    seen: set[str] = set()
    for m in _BLUEPRINT_RE.finditer(text):
        raw = m.group(0)
        if raw in seen:
            continue
        seen.add(raw)
        line = _line_of_offset(text, m.start())
        path = repo_root / raw
        c = Citation(kind="blueprint", raw_text=raw, location_line=line)
        found.append(c)
        if not path.is_file():
            c.reason = f"blueprint file does not exist at {path}"
            unresolved.append(c)
    return len(found), unresolved


def _check_intra_plan_adrs(text: str) -> tuple[int, list[Citation]]:
    # Collect declared ADR headers (### D<N>) in the same plan.
    declared: set[str] = {m.group(1) for m in _INTRA_ADR_HEADER_RE.finditer(text)}
    found: list[Citation] = []
    unresolved: list[Citation] = []
    seen: set[str] = set()
    for m in _INTRA_ADR_RE.finditer(text):
        raw = m.group(0)
        num = m.group(1)
        # Skip if the match is itself an `### D<N>` header (not a reference).
        # The reference form is `ADR D<N>`; the header form is `### D<N>` and
        # never matches `_INTRA_ADR_RE` because `###` is not `ADR`.
        key = f"{raw}@{_line_of_offset(text, m.start())}"
        if key in seen:
            continue
        seen.add(key)
        line = _line_of_offset(text, m.start())
        c = Citation(kind="intra_plan_adr", raw_text=raw, location_line=line)
        found.append(c)
        if num not in declared:
            c.reason = f"ADR D{num} referenced but no `### D{num}` header in the plan"
            unresolved.append(c)
    return len(found), unresolved


def _check_unbreakable_rules(text: str) -> tuple[int, list[Citation]]:
    found: list[Citation] = []
    unresolved: list[Citation] = []
    seen: set[str] = set()
    for m in _UNBREAKABLE_RE.finditer(text):
        raw = m.group(0)
        num = int(m.group(1))
        key = f"{raw}@{_line_of_offset(text, m.start())}"
        if key in seen:
            continue
        seen.add(key)
        line = _line_of_offset(text, m.start())
        c = Citation(kind="unbreakable_rule", raw_text=raw, location_line=line)
        found.append(c)
        if not (1 <= num <= _UNBREAKABLE_MAX):
            c.reason = (
                f"Inquebrável Rule {num} out of range; valid range is 1..{_UNBREAKABLE_MAX} "
                f"per root /home/paulo/.claude/CLAUDE.md"
            )
            unresolved.append(c)
    return len(found), unresolved


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def check_evidence_citations(plan_path: Path, repo_root: Path) -> EvidenceReport:
    """Verify all citations in `plan_path` against `repo_root`.

    Returns an `EvidenceReport` with `total_citations` count and any
    `unresolved_citations` list. Per the golden rule, ANY unresolved
    citation triggers the `fabricated_citation` hard cap (49) in
    `run_structural.py`.
    """
    text = plan_path.read_text(encoding="utf-8")

    total = 0
    unresolved: list[Citation] = []

    for extractor in (
        lambda: _check_rules(text, repo_root),
        lambda: _check_blueprints(text, repo_root),
        lambda: _check_intra_plan_adrs(text),
        lambda: _check_unbreakable_rules(text),
    ):
        n, bad = extractor()
        total += n
        unresolved.extend(bad)

    return EvidenceReport(total_citations=total, unresolved_citations=unresolved)
