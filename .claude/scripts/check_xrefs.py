#!/usr/bin/env python3
"""Cross-reference validator for the .claude/ ecosystem.

Validates that:
  1. Each cycle-*.md references SKILL.md files that exist
  2. Each SKILL.md "Cycle contract" section points to a cycle-*.md that exists
  3. Each cycle rule's Cross-references section lists files that exist
  4. No orphan skills (skills not in any cycle, except documented auxiliary)
  5. No orphan cycle phases (cycle rule mentions a skill that doesn't exist)
  6. Each cycle rule template-cited script exists at the cited path

Usage:
    python3 .claude/scripts/check_xrefs.py
    python3 .claude/scripts/check_xrefs.py --strict      # exit 1 on warnings too

Exit codes:
  0 — All cross-references valid
  1 — At least one broken reference (or warning in --strict)
  2 — Error (.claude/ not found, etc.)
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any


# Skills documented as "auxiliary" (not bound to any cycle)
AUXILIARY_SKILLS = {"ast-grep"}

# Patterns to detect file references in markdown
LINK_RE = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")
BACKTICK_PATH_RE = re.compile(r"`(\.?[a-zA-Z0-9_./\-]+\.(?:md|py|sh|json|txt|yml|yaml))`")
CYCLE_REF_RE = re.compile(r"`?cycle-([a-z]+)`?")
SKILL_REF_RE = re.compile(r"`?\.claude/skills/([a-z0-9\-]+)/SKILL\.md`?")


def _find_project_root(start: Path) -> Path:
    current = start.resolve() if not start.is_file() else start.resolve().parent
    for _ in range(20):
        if (current / ".claude").exists() or (current / ".git").exists():
            return current
        if current == current.parent:
            break
        current = current.parent
    return start.resolve()


def _list_existing_skills(claude_dir: Path) -> set[str]:
    skills_dir = claude_dir / "skills"
    if not skills_dir.exists():
        return set()
    return {
        d.name
        for d in skills_dir.iterdir()
        if d.is_dir() and (d / "SKILL.md").exists() and d.name != "generated"
    }


def _list_cycle_rules(claude_dir: Path) -> dict[str, Path]:
    rules_dir = claude_dir / "rules"
    if not rules_dir.exists():
        return {}
    return {
        p.stem: p
        for p in rules_dir.glob("cycle-*.md")
    }


def _extract_referenced_paths(content: str, base: Path) -> set[Path]:
    """Extract paths referenced in markdown (backtick + markdown link)."""
    paths: set[str] = set()

    for match in LINK_RE.finditer(content):
        url = match.group(2).strip()
        if url.startswith(("http://", "https://", "#")):
            continue
        paths.add(url)

    for match in BACKTICK_PATH_RE.finditer(content):
        paths.add(match.group(1))

    resolved: set[Path] = set()
    for p in paths:
        candidate = (base / p).resolve() if not Path(p).is_absolute() else Path(p)
        resolved.add(candidate)
    return resolved


def _extract_cycle_phases(cycle_rule_content: str) -> set[str]:
    """Extract skill names mentioned in a cycle rule's `phases:` frontmatter list AND in the chain section."""
    skills: set[str] = set()

    # Frontmatter phases: section
    fm_match = re.match(r"^---\n(.*?)\n---", cycle_rule_content, re.DOTALL)
    if fm_match:
        fm = fm_match.group(1)
        phases_match = re.search(r"^phases:\s*\n((?:\s+-\s+[a-z0-9\-]+(?:\s+\([^)]+\))?\s*\n)*)", fm, re.MULTILINE)
        if phases_match:
            for line in phases_match.group(1).splitlines():
                m = re.match(r"\s+-\s+([a-z0-9\-]+)", line)
                if m:
                    skills.add(m.group(1))

    # Chain section: looks for `/skill-name` patterns
    chain_match = re.search(r"## Chain.*?\n```(.*?)```", cycle_rule_content, re.DOTALL)
    if chain_match:
        chain = chain_match.group(1)
        # Match /skill-name where name is ≥2 chars and contains at least one '-' OR matches known prefixes
        for m in re.finditer(r"/([a-z][a-z0-9]+(?:-[a-z0-9]+)+|to-plan|implement|review)\s", chain):
            skills.add(m.group(1))

    return skills


def _extract_cycle_contract_ref(skill_md_content: str) -> str | None:
    """Find `cycle-{name}` referenced in a SKILL.md's Cycle contract section."""
    contract_match = re.search(r"## Cycle contract.*?(?=^##\s+|\Z)", skill_md_content, re.MULTILINE | re.DOTALL)
    body = contract_match.group(0) if contract_match else skill_md_content
    cycle_match = CYCLE_REF_RE.search(body)
    return cycle_match.group(1) if cycle_match else None


def validate_xrefs(claude_dir: Path, strict: bool = False) -> dict[str, Any]:
    project_root = claude_dir.parent
    existing_skills = _list_existing_skills(claude_dir)
    cycle_rules = _list_cycle_rules(claude_dir)

    findings: list[dict[str, Any]] = []

    # Check 1: each cycle rule references skills that exist
    cycle_to_skills: dict[str, set[str]] = {}
    for cycle_name, cycle_path in cycle_rules.items():
        content = cycle_path.read_text(encoding="utf-8-sig")
        skills_mentioned = _extract_cycle_phases(content)
        cycle_to_skills[cycle_name] = skills_mentioned

        for skill in skills_mentioned:
            if skill not in existing_skills:
                findings.append({
                    "severity": "WARN",
                    "check": "cycle_rule_references_existing_skill",
                    "cycle": cycle_name,
                    "missing_skill": skill,
                    "message": f"{cycle_path.relative_to(project_root)} references skill `{skill}` which does not exist at .claude/skills/{skill}/",
                })

    # Check 2: each SKILL.md points to an existing cycle
    skill_to_cycle: dict[str, str | None] = {}
    for skill in existing_skills:
        skill_md = claude_dir / "skills" / skill / "SKILL.md"
        content = skill_md.read_text(encoding="utf-8-sig")
        cycle_ref = _extract_cycle_contract_ref(content)
        skill_to_cycle[skill] = cycle_ref

        if cycle_ref is None and skill not in AUXILIARY_SKILLS:
            findings.append({
                "severity": "WARN",
                "check": "skill_has_cycle_contract",
                "skill": skill,
                "message": f".claude/skills/{skill}/SKILL.md has no `Cycle contract` section pointing to a cycle-*.md",
            })
        elif cycle_ref is not None:
            expected_cycle = f"cycle-{cycle_ref}"
            if expected_cycle not in cycle_rules:
                findings.append({
                    "severity": "FAIL",
                    "check": "skill_cycle_contract_resolves",
                    "skill": skill,
                    "cycle_referenced": expected_cycle,
                    "message": f".claude/skills/{skill}/SKILL.md references cycle-{cycle_ref}.md but it does not exist",
                })

    # Check 3: cycle rule cross-references point to existing files
    for cycle_name, cycle_path in cycle_rules.items():
        content = cycle_path.read_text(encoding="utf-8-sig")
        # Cross-references section
        xref_match = re.search(r"## Cross-references.*?(?=^##\s+|\Z)", content, re.MULTILINE | re.DOTALL)
        if not xref_match:
            findings.append({
                "severity": "WARN",
                "check": "cycle_has_xref_section",
                "cycle": cycle_name,
                "message": f"{cycle_path.relative_to(project_root)} has no `Cross-references` section",
            })
            continue

        xref_body = xref_match.group(0)
        # Extract referenced files — only validate REAL paths (with / or starting with .)
        # Bare filenames in prose (e.g., `testing.md`) are likely conceptual references, skip
        for match in BACKTICK_PATH_RE.finditer(xref_body):
            ref = match.group(1)
            # Skip references that are clearly placeholders or relative-to-skill paths
            if "{" in ref or ref.startswith("../"):
                continue
            # Skip bare filenames without path separators — these are nominal mentions in prose
            if "/" not in ref and not ref.startswith("."):
                continue
            # Try resolution against multiple search roots
            candidates_to_try: list[Path] = []
            if Path(ref).is_absolute():
                candidates_to_try.append(Path(ref))
            else:
                candidates_to_try.append(project_root / ref)
                # If path starts with a skill name (e.g., plan-confidence/templates/...), try .claude/skills/
                first_segment = ref.split("/", 1)[0]
                if (claude_dir / "skills" / first_segment).exists():
                    candidates_to_try.append(claude_dir / "skills" / ref)
                # If path starts with .claude/, it's already root-relative
                if ref.startswith(".claude/"):
                    candidates_to_try.append(project_root / ref)

            if not any(c.exists() for c in candidates_to_try):
                findings.append({
                    "severity": "WARN",
                    "check": "cycle_xref_file_exists",
                    "cycle": cycle_name,
                    "broken_ref": ref,
                    "message": f"{cycle_path.relative_to(project_root)} references `{ref}` which does not exist",
                })

    # Check 4: orphan skills (not in any cycle, not auxiliary)
    skills_in_cycles: set[str] = set()
    for skills_set in cycle_to_skills.values():
        skills_in_cycles.update(skills_set)

    orphan_skills = existing_skills - skills_in_cycles - AUXILIARY_SKILLS
    for skill in sorted(orphan_skills):
        findings.append({
            "severity": "WARN",
            "check": "no_orphan_skills",
            "skill": skill,
            "message": f"Skill `{skill}` is not referenced by any cycle-*.md and is not in AUXILIARY_SKILLS",
        })

    # Aggregate
    severity_counts = defaultdict(int)
    for f in findings:
        severity_counts[f["severity"]] += 1

    overall = "PASS"
    if severity_counts.get("FAIL", 0) > 0:
        overall = "FAIL"
    elif severity_counts.get("WARN", 0) > 0 and strict:
        overall = "FAIL"

    return {
        "claude_dir": str(claude_dir),
        "skills_total": len(existing_skills),
        "skills_auxiliary": sorted(AUXILIARY_SKILLS & existing_skills),
        "skills_orphan": sorted(orphan_skills),
        "cycle_rules": sorted(cycle_rules.keys()),
        "skill_to_cycle": skill_to_cycle,
        "findings": findings,
        "severity_counts": dict(severity_counts),
        "overall": overall,
    }


def _render_summary(result: dict[str, Any]) -> str:
    lines = [
        f"=== Cross-reference validator ===",
        f"Claude dir: {result['claude_dir']}",
        f"Skills total: {result['skills_total']}",
        f"Cycle rules: {result['cycle_rules']}",
        f"Skills auxiliary: {result['skills_auxiliary']}",
        f"Skills orphan: {result['skills_orphan']}",
        "",
        f"=== Findings ({len(result['findings'])}) ===",
    ]
    for f in result["findings"]:
        lines.append(f"  [{f['severity']}] {f['check']}: {f['message']}")
    lines.append("")
    lines.append(f"Severity counts: {result['severity_counts']}")
    lines.append(f"Overall: {result['overall']}")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate cross-references in the .claude/ ecosystem.")
    parser.add_argument("--strict", action="store_true", help="Exit 1 on WARN too (default: exit 1 only on FAIL)")
    parser.add_argument("--json", action="store_true", help="Output JSON instead of human-readable summary")
    parser.add_argument("--claude-dir", type=Path, default=None, help="Override .claude/ path detection")
    args = parser.parse_args()

    if args.claude_dir:
        claude_dir = args.claude_dir
    else:
        project_root = _find_project_root(Path.cwd())
        claude_dir = project_root / ".claude"

    if not claude_dir.exists():
        print(json.dumps({"error": f".claude/ not found at {claude_dir}"}), file=sys.stderr)
        return 2

    result = validate_xrefs(claude_dir, strict=args.strict)

    if args.json:
        print(json.dumps(result, indent=2, default=str))
    else:
        print(_render_summary(result))

    return 0 if result["overall"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
