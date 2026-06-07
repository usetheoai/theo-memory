"""Tests for `check_evidence_citations` (M3 v0.1).

Per `.claude/rules/plan-confidence-golden-rule.md` § M3 v0.1, this checker
verifies four kinds of citations in a plan:

- `rule` — references to `.claude/rules/X.md` paths
- `blueprint` — references to `.claude/knowledge-base/discoveries/blueprints/X.md` paths
- `intra_plan_adr` — references to `ADR D<N>` headers within the SAME plan file
- `unbreakable_rule` — references to `Inquebrável Rule <N>` where N ∈ 1..13

Tests cover happy path (all resolved) and unresolved paths per kind.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

# Import the checker module under test (under scripts/ — must be on sys.path)
sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))
from check_evidence_citations import (  # noqa: E402
    Citation,
    EvidenceReport,
    check_evidence_citations,
)


@pytest.fixture
def tmp_repo(tmp_path: Path) -> Path:
    """Build a minimal fake repo root for citation resolution."""
    (tmp_path / ".claude" / "rules").mkdir(parents=True)
    (tmp_path / ".claude" / "rules" / "existing-rule.md").write_text("# Existing rule")
    (tmp_path / ".claude" / "knowledge-base" / "discoveries" / "blueprints").mkdir(parents=True)
    (tmp_path / ".claude" / "knowledge-base" / "discoveries" / "blueprints" / "existing-blueprint.md").write_text(
        "# Blueprint\n\n## Q1 — Some section\n\nbody\n"
    )
    (tmp_path / ".claude" / "knowledge-base" / "plans").mkdir(parents=True)
    return tmp_path


def _write_plan(repo_root: Path, body: str) -> Path:
    plan = repo_root / ".claude" / "knowledge-base" / "plans" / "test-plan.md"
    plan.write_text(body)
    return plan


def test_returns_zero_citations_when_plan_has_none(tmp_repo: Path) -> None:
    plan_body = "# Plan\n\nNo citations here just plain prose.\n"
    plan_path = _write_plan(tmp_repo, plan_body)
    report = check_evidence_citations(plan_path, tmp_repo)
    assert isinstance(report, EvidenceReport)
    assert report.total_citations == 0
    assert report.unresolved_citations == []


def test_resolves_existing_rule_citation(tmp_repo: Path) -> None:
    plan_body = "# Plan\n\nSee `.claude/rules/existing-rule.md` for details.\n"
    plan_path = _write_plan(tmp_repo, plan_body)
    report = check_evidence_citations(plan_path, tmp_repo)
    assert report.total_citations == 1
    assert report.unresolved_citations == []


def test_flags_nonexistent_rule_citation(tmp_repo: Path) -> None:
    plan_body = "# Plan\n\nSee `.claude/rules/nonexistent-rule.md` for details.\n"
    plan_path = _write_plan(tmp_repo, plan_body)
    report = check_evidence_citations(plan_path, tmp_repo)
    assert report.total_citations == 1
    assert len(report.unresolved_citations) == 1
    c = report.unresolved_citations[0]
    assert c.kind == "rule"
    assert "nonexistent-rule.md" in c.raw_text
    assert c.location_line >= 1
    assert "not found" in c.reason.lower() or "does not exist" in c.reason.lower()


def test_resolves_existing_blueprint_path(tmp_repo: Path) -> None:
    plan_body = "# Plan\n\nGrounded in `.claude/knowledge-base/discoveries/blueprints/existing-blueprint.md`.\n"
    plan_path = _write_plan(tmp_repo, plan_body)
    report = check_evidence_citations(plan_path, tmp_repo)
    assert report.total_citations == 1
    assert report.unresolved_citations == []


def test_flags_nonexistent_blueprint(tmp_repo: Path) -> None:
    plan_body = "# Plan\n\nGrounded in `.claude/knowledge-base/discoveries/blueprints/fake-blueprint.md`.\n"
    plan_path = _write_plan(tmp_repo, plan_body)
    report = check_evidence_citations(plan_path, tmp_repo)
    assert report.total_citations == 1
    assert len(report.unresolved_citations) == 1
    assert report.unresolved_citations[0].kind == "blueprint"


def test_resolves_intra_plan_adr_reference(tmp_repo: Path) -> None:
    plan_body = (
        "# Plan\n\n"
        "Per ADR D1, we rename.\n\n"
        "## ADRs\n\n"
        "### D1 — first decision\n"
        "body\n"
    )
    plan_path = _write_plan(tmp_repo, plan_body)
    report = check_evidence_citations(plan_path, tmp_repo)
    assert report.total_citations == 1
    assert report.unresolved_citations == []


def test_flags_nonexistent_intra_plan_adr(tmp_repo: Path) -> None:
    plan_body = (
        "# Plan\n\n"
        "Per ADR D99 we rename.\n\n"
        "## ADRs\n\n"
        "### D1 — first decision\n"
    )
    plan_path = _write_plan(tmp_repo, plan_body)
    report = check_evidence_citations(plan_path, tmp_repo)
    assert report.total_citations == 1
    assert len(report.unresolved_citations) == 1
    assert report.unresolved_citations[0].kind == "intra_plan_adr"


def test_resolves_valid_unbreakable_rule_reference(tmp_repo: Path) -> None:
    plan_body = "# Plan\n\nPer Inquebrável Rule 8 (error handling).\n"
    plan_path = _write_plan(tmp_repo, plan_body)
    report = check_evidence_citations(plan_path, tmp_repo)
    assert report.total_citations == 1
    assert report.unresolved_citations == []


def test_flags_out_of_range_unbreakable_rule(tmp_repo: Path) -> None:
    plan_body = "# Plan\n\nPer Inquebrável Rule 99 (fake rule).\n"
    plan_path = _write_plan(tmp_repo, plan_body)
    report = check_evidence_citations(plan_path, tmp_repo)
    assert report.total_citations == 1
    assert len(report.unresolved_citations) == 1
    assert report.unresolved_citations[0].kind == "unbreakable_rule"


def test_counts_multiple_mixed_citations(tmp_repo: Path) -> None:
    plan_body = (
        "# Plan\n\n"
        "Per `.claude/rules/existing-rule.md` and Inquebrável Rule 3.\n"
        "Per ADR D1.\n\n"
        "## ADRs\n### D1 — x\n"
    )
    plan_path = _write_plan(tmp_repo, plan_body)
    report = check_evidence_citations(plan_path, tmp_repo)
    assert report.total_citations == 3
    assert report.unresolved_citations == []
