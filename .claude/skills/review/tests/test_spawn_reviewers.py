"""Tests for spawn_reviewers.py — verifies template substitution + agent generation."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parent.parent / "scripts" / "spawn_reviewers.py"


def _run(plan: Path, slug: str, primary: str, output_dir: Path, secondary: str = "") -> tuple[int, dict]:
    skill_dir = Path(__file__).parent.parent  # The review skill dir (where templates live)
    args = [
        sys.executable,
        str(SCRIPT),
        "--plan", str(plan),
        "--slug", slug,
        "--primary-domain", primary,
        "--secondary-domains", secondary,
        "--output-dir", str(output_dir),
        "--skill-dir", str(skill_dir),
    ]
    result = subprocess.run(args, capture_output=True, text=True)
    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError:
        data = {"raw": result.stdout, "stderr": result.stderr, "exit": result.returncode}
    return result.returncode, data


def test_baseline_4_agents_generated(sample_plan: Path, tmp_path: Path) -> None:
    output_dir = tmp_path / "agents-out"
    rc, data = _run(sample_plan, "test-slug", "pgvector-schema", output_dir)
    assert rc == 0
    # Baseline = 4 (architecture, tests, wiring, cross-validation) + 1 domain (primary)
    assert data["agents_count"] >= 5
    baseline_roles = {a["role"] for a in data["agents_generated"]}
    assert {"architecture", "tests", "wiring", "cross-validation"} <= baseline_roles


def test_agent_files_actually_written(sample_plan: Path, tmp_path: Path) -> None:
    output_dir = tmp_path / "agents-out"
    rc, data = _run(sample_plan, "test-slug", "pgvector-schema", output_dir)
    for agent in data["agents_generated"]:
        path = Path(agent["path"])
        assert path.exists()
        content = path.read_text(encoding="utf-8-sig")
        # Substitution markers should be replaced
        assert "{SLUG}" not in content
        assert "test-slug" in content


def test_secondary_domains_spawn_extra_agents(sample_plan: Path, tmp_path: Path) -> None:
    output_dir = tmp_path / "agents-out"
    rc, data = _run(
        sample_plan,
        "test-slug",
        "pgvector-schema",
        output_dir,
        secondary="memory-layer,db-migrations",
    )
    assert rc == 0
    domain_roles = [a["role"] for a in data["agents_generated"] if a["role"].startswith("domain-")]
    assert len(domain_roles) >= 3  # primary + 2 secondary


def test_findings_dir_created(sample_plan: Path, tmp_path: Path) -> None:
    output_dir = tmp_path / "agents-out"
    rc, data = _run(sample_plan, "test-slug", "pgvector-schema", output_dir)
    findings_dir = Path(data["findings_dir"])
    assert findings_dir.exists()
    assert findings_dir.is_dir()
