#!/usr/bin/env python3
"""End-to-end smoke test for the .claude/ ecosystem.

Validates:
  1. All Python scripts have valid syntax (py_compile)
  2. All shell hooks have valid bash syntax
  3. settings.json is valid JSON
  4. Cross-reference validator passes
  5. Each cycle rule exists + has required sections
  6. Each first-class skill has a valid SKILL.md frontmatter
  7. Smoke chain: detect_domain → spawn_reviewers → consolidate_findings works in sequence

Run from project root:
    python3 .claude/scripts/test_e2e_smoke.py

Exit codes:
  0 — All checks passed
  1 — At least one check failed
  2 — Error (project root not found, etc.)
"""
from __future__ import annotations

import json
import py_compile
import subprocess
import sys
import tempfile
from pathlib import Path


def _find_project_root() -> Path:
    current = Path.cwd().resolve()
    while current != current.parent:
        if (current / ".claude").is_dir() or (current / ".git").exists():
            return current
        current = current.parent
    raise FileNotFoundError("Project root not found")


def check_python_syntax(project_root: Path) -> tuple[bool, list[str]]:
    issues: list[str] = []
    py_files = list((project_root / ".claude").rglob("*.py"))
    # Filter caches
    py_files = [
        p for p in py_files
        if not any(part in str(p) for part in ("__pycache__", ".mypy_cache", ".pytest_cache"))
    ]
    for py in py_files:
        try:
            py_compile.compile(str(py), doraise=True)
        except py_compile.PyCompileError as exc:
            issues.append(f"  syntax error in {py.relative_to(project_root)}: {exc}")
    return len(issues) == 0, issues


def check_shell_syntax(project_root: Path) -> tuple[bool, list[str]]:
    issues: list[str] = []
    sh_files = list((project_root / ".claude" / "hooks").glob("*.sh"))
    sh_files.extend((project_root / ".claude" / "skills").rglob("*.sh"))
    for sh in sh_files:
        result = subprocess.run(
            ["bash", "-n", str(sh)],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            issues.append(f"  shell syntax error in {sh.relative_to(project_root)}: {result.stderr.strip()}")
    return len(issues) == 0, issues


def check_settings_json(project_root: Path) -> tuple[bool, list[str]]:
    issues: list[str] = []
    for json_file in [".claude/settings.json", ".claude/settings.local.json.example"]:
        path = project_root / json_file
        if not path.exists():
            continue
        try:
            json.loads(path.read_text(encoding="utf-8-sig"))
        except json.JSONDecodeError as exc:
            issues.append(f"  invalid JSON in {json_file}: {exc}")
    return len(issues) == 0, issues


def check_xrefs(project_root: Path) -> tuple[bool, list[str]]:
    validator = project_root / ".claude" / "scripts" / "check_xrefs.py"
    if not validator.exists():
        return True, ["  check_xrefs.py not installed — skipping"]
    result = subprocess.run(
        [sys.executable, str(validator)],
        capture_output=True,
        text=True,
        cwd=str(project_root),
    )
    if result.returncode != 0:
        return False, [f"  check_xrefs.py returned {result.returncode}", "  " + result.stdout[-200:]]
    return True, []


def check_cycle_rules(project_root: Path) -> tuple[bool, list[str]]:
    issues: list[str] = []
    required_sections = ("## Purpose", "## Chain", "## Hard gates", "## Anti-patterns", "## Cross-references")
    for cycle_name in ("discover", "plan", "implement", "review"):
        rule = project_root / ".claude" / "rules" / f"cycle-{cycle_name}.md"
        if not rule.exists():
            issues.append(f"  missing cycle rule: cycle-{cycle_name}.md")
            continue
        content = rule.read_text(encoding="utf-8-sig")
        for section in required_sections:
            if section not in content:
                issues.append(f"  cycle-{cycle_name}.md missing section `{section}`")
    return len(issues) == 0, issues


def check_skill_frontmatter(project_root: Path) -> tuple[bool, list[str]]:
    issues: list[str] = []
    required_fields = ("name:", "description:")
    for skill_dir in (project_root / ".claude" / "skills").iterdir():
        if not skill_dir.is_dir() or skill_dir.name == "generated":
            continue
        skill_md = skill_dir / "SKILL.md"
        if not skill_md.exists():
            issues.append(f"  skill {skill_dir.name} missing SKILL.md")
            continue
        content = skill_md.read_text(encoding="utf-8-sig")
        if not content.startswith("---\n"):
            issues.append(f"  {skill_dir.name}/SKILL.md missing opening frontmatter")
            continue
        # Find closing ---
        end = content.find("\n---\n", 4)
        if end == -1:
            issues.append(f"  {skill_dir.name}/SKILL.md missing closing frontmatter")
            continue
        fm = content[4:end]
        for field in required_fields:
            if field not in fm:
                issues.append(f"  {skill_dir.name}/SKILL.md missing field `{field}`")
    return len(issues) == 0, issues


def check_smoke_chain(project_root: Path) -> tuple[bool, list[str]]:
    """Exercise detect_domain → spawn_reviewers → consolidate_findings in sequence."""
    issues: list[str] = []
    review_skill = project_root / ".claude" / "skills" / "review"

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)

        # 1. Create a sample plan
        plan = tmp / "smoke-plan.md"
        plan.write_text(
            "# Plan: Smoke\n\n## Context\n\nPgvector schema with Alembic migrations.\n\n## ADRs\n\n### D1 — adopt pgvector\n\nReason.\n",
            encoding="utf-8",
        )

        # 2. detect_domain
        detect = review_skill / "scripts" / "detect_domain.py"
        r1 = subprocess.run(
            [sys.executable, str(detect), "--plan", str(plan)],
            capture_output=True, text=True,
        )
        if r1.returncode not in (0, 1):
            issues.append(f"  detect_domain exit {r1.returncode}: {r1.stderr[:200]}")
            return False, issues

        domain_data = json.loads(r1.stdout)
        primary = domain_data.get("primary_domain", "unknown")

        # 3. spawn_reviewers
        agents_out = tmp / "agents"
        spawn = review_skill / "scripts" / "spawn_reviewers.py"
        r2 = subprocess.run(
            [sys.executable, str(spawn),
             "--plan", str(plan),
             "--slug", "smoke",
             "--primary-domain", primary if primary != "unknown" else "memory-layer",
             "--output-dir", str(agents_out),
             "--skill-dir", str(review_skill)],
            capture_output=True, text=True,
        )
        if r2.returncode != 0:
            issues.append(f"  spawn_reviewers exit {r2.returncode}: {r2.stderr[:200]}")
            return False, issues

        # 4. Write one synthetic findings file
        findings_dir = agents_out / "findings"
        findings_dir.mkdir(parents=True, exist_ok=True)
        (findings_dir / "smoke.yml").write_text(
            "agent: smoke\nfindings: []\n",
            encoding="utf-8",
        )

        # 5. consolidate_findings
        report = tmp / "report.md"
        consolidate = review_skill / "scripts" / "consolidate_findings.py"
        r3 = subprocess.run(
            [sys.executable, str(consolidate),
             "--findings-dir", str(findings_dir),
             "--output", str(report),
             "--edge-case-coverage-ratio", "1.0"],
            capture_output=True, text=True,
        )
        if r3.returncode != 0:
            issues.append(f"  consolidate_findings exit {r3.returncode}: {r3.stderr[:200]}")
            return False, issues

        if not report.exists():
            issues.append("  consolidated report not written")
            return False, issues

    return True, []


def main() -> int:
    try:
        project_root = _find_project_root()
    except FileNotFoundError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2

    checks = [
        ("Python syntax", check_python_syntax),
        ("Shell hooks syntax", check_shell_syntax),
        ("settings.json validity", check_settings_json),
        ("Cross-references", check_xrefs),
        ("Cycle rules schema", check_cycle_rules),
        ("Skill frontmatter", check_skill_frontmatter),
        ("Smoke chain (detect_domain → spawn_reviewers → consolidate)", check_smoke_chain),
    ]

    print(f"=== E2E smoke test — project: {project_root} ===\n")

    all_pass = True
    for name, check in checks:
        try:
            ok, issues = check(project_root)
        except Exception as exc:
            ok, issues = False, [f"  exception: {exc}"]
        if ok:
            print(f"✓ {name}")
        else:
            all_pass = False
            print(f"✗ {name}")
            for issue in issues[:5]:
                print(issue)
            if len(issues) > 5:
                print(f"  ... and {len(issues) - 5} more")

    print()
    if all_pass:
        print("=== ALL CHECKS PASSED ===")
        return 0
    print("=== SOME CHECKS FAILED ===")
    return 1


if __name__ == "__main__":
    sys.exit(main())
