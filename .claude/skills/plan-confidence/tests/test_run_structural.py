"""T4.3 — run_structural.py orchestrator tests."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

from run_structural import (  # noqa: E402
    M2_ACTIVE_DIMENSIONS,
    renormalize_weights,
    run_structural,
)

SKILL_ROOT = Path(__file__).parent.parent
FIXTURES = SKILL_ROOT / "fixtures"
RUBRIC = SKILL_ROOT / "templates" / "rubric-v1.md"
THRESHOLDS = SKILL_ROOT.parent.parent / "rules" / "plan-confidence-thresholds.txt"


# ADR D8 / EC-2 renormalize tests

def test_renormalize_weights_m2_sums_to_one() -> None:
    weights = renormalize_weights(["completude", "risco_estrutural"])
    assert abs(sum(weights.values()) - 1.0) < 1e-9


def test_renormalize_weights_m2_proportions_correct() -> None:
    weights = renormalize_weights(["completude", "risco_estrutural"])
    # SOTA: completude=0.30, risco=0.20. Sum 0.50. completude/0.50 = 0.6.
    assert abs(weights["completude"] - 0.6) < 1e-9
    assert abs(weights["risco_estrutural"] - 0.4) < 1e-9


def test_renormalize_weights_m3_proportions_correct() -> None:
    """When M3 activates evidencia (0.30 SOTA): sum 0.30+0.30+0.20=0.80. Renormalized 3/8, 3/8, 2/8."""
    weights = renormalize_weights(["completude", "evidencia", "risco_estrutural"])
    assert abs(weights["completude"] - 0.30 / 0.80) < 1e-9
    assert abs(weights["evidencia"] - 0.30 / 0.80) < 1e-9
    assert abs(weights["risco_estrutural"] - 0.20 / 0.80) < 1e-9
    assert abs(sum(weights.values()) - 1.0) < 1e-9


# Verdict tests with fixtures

def test_run_structural_good_plan_passes() -> None:
    """fixture good-plan.md: coverage 100%, ADRs with alternatives, bug-fix with TDD."""
    report = run_structural(FIXTURES / "good-plan.md", RUBRIC, THRESHOLDS)
    # Verdict should NOT be INVALID
    assert report.verdict != "INVALID"
    assert report.hard_caps_triggered == []
    # In M2 with renormalization, max achievable is 100. We expect at least 70 (SHIPPABLE_WITH_CAVEATS).
    assert report.final_score_after_caps >= 70, (
        f"good-plan got {report.final_score_after_caps}, expected >= 70. "
        f"completude={report.completude_score}, risco={report.risco_estrutural_score}"
    )


def test_run_structural_m2_score_can_reach_above_50() -> None:
    """v1.1 EC-2 fix: with renormalization, score is NOT capped at 50 in M2."""
    report = run_structural(FIXTURES / "good-plan.md", RUBRIC, THRESHOLDS)
    assert report.final_score_after_caps > 50, (
        "EC-2 fix: M2 renormalization must allow scores above 50"
    )


def test_run_structural_missing_coverage_capped() -> None:
    report = run_structural(FIXTURES / "missing-coverage-plan.md", RUBRIC, THRESHOLDS)
    assert "coverage_lt_100" in report.hard_caps_triggered
    assert report.verdict == "INVALID"
    assert report.final_score_after_caps <= 49


def test_run_structural_no_tdd_capped() -> None:
    report = run_structural(FIXTURES / "no-tdd-plan.md", RUBRIC, THRESHOLDS)
    assert "bugfix_without_tdd" in report.hard_caps_triggered
    assert report.final_score_after_caps <= 70


def test_run_structural_weak_imperatives_penalty() -> None:
    report = run_structural(FIXTURES / "weak-imperatives-plan.md", RUBRIC, THRESHOLDS)
    # Should have risco_estrutural < 100 due to smells, but no hard cap from smells
    assert report.risco_estrutural_score < 100
    assert "coverage_lt_100" not in report.hard_caps_triggered


# JSON output structure tests

def test_run_structural_emits_valid_json_compatible_data() -> None:
    """Verify the report can be serialized to valid JSON."""
    report = run_structural(FIXTURES / "good-plan.md", RUBRIC, THRESHOLDS)
    # dataclass to dict (no Motivo nesting issue here since list is empty for M2 evidence/calibration)
    from dataclasses import asdict
    d = asdict(report)
    d["motivos"] = {k: [asdict(m) for m in v] for k, v in report.motivos.items()}
    # Must round-trip
    s = json.dumps(d, indent=2, ensure_ascii=False)
    parsed = json.loads(s)
    assert parsed["plan_slug"] == "good"


def test_run_structural_motivos_has_4_keys() -> None:
    report = run_structural(FIXTURES / "good-plan.md", RUBRIC, THRESHOLDS)
    assert set(report.motivos.keys()) == {"completude", "evidencia", "calibracao", "risco_estrutural"}


def test_run_structural_evidencia_empty_in_m2() -> None:
    report = run_structural(FIXTURES / "good-plan.md", RUBRIC, THRESHOLDS)
    assert report.motivos["evidencia"] == []


def test_run_structural_calibracao_empty_in_m2() -> None:
    report = run_structural(FIXTURES / "good-plan.md", RUBRIC, THRESHOLDS)
    assert report.motivos["calibracao"] == []


def test_run_structural_output_includes_active_dimensions() -> None:
    """v1.1 EC-2: output must include active_dimensions and weight_normalization_factor."""
    report = run_structural(FIXTURES / "good-plan.md", RUBRIC, THRESHOLDS)
    assert report.active_dimensions == M2_ACTIVE_DIMENSIONS
    assert report.weight_normalization_factor > 0


# CLI tests

def test_run_structural_cli_exit_code_0_on_pass() -> None:
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS_DIR / "run_structural.py"), str(FIXTURES / "good-plan.md")],
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, f"stderr: {proc.stderr}"


def test_run_structural_cli_exit_code_1_on_invalid() -> None:
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS_DIR / "run_structural.py"), str(FIXTURES / "missing-coverage-plan.md")],
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 1, f"expected 1 (INVALID), got {proc.returncode}. stderr: {proc.stderr}"


def test_run_structural_cli_exit_code_2_on_error() -> None:
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS_DIR / "run_structural.py"), "/tmp/__not_a_plan__"],
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 2


def test_run_structural_cli_outputs_valid_json() -> None:
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS_DIR / "run_structural.py"), str(FIXTURES / "good-plan.md")],
        capture_output=True,
        text=True,
        check=False,
    )
    # Even on green path, output goes to stdout
    parsed = json.loads(proc.stdout)
    assert "verdict" in parsed
    assert "active_dimensions" in parsed


# Runtime-metric proof (Global DoD requirement)

def test_runtime_metric_proof_missing_coverage_triggers_cap() -> None:
    """Runtime-metric proof per Global DoD: observed non-zero in real workload."""
    report = run_structural(FIXTURES / "missing-coverage-plan.md", RUBRIC, THRESHOLDS)
    assert "coverage_lt_100" in report.hard_caps_triggered, (
        "Runtime-metric proof: missing-coverage-plan fixture MUST trigger coverage_lt_100 cap "
        "and verdict INVALID. This is the smoke test for the entire pipeline."
    )
    assert report.verdict == "INVALID"
