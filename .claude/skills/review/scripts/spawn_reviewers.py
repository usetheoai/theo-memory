#!/usr/bin/env python3
"""Spawn specialized review agents by instantiating templates with plan-specific context.

For each agent template at `templates/agent-*.md`, perform substitution and write the
result to `.claude/agents/review-{slug}-{date}/{role}.md`. These files are the agent
definitions consumed by the Agent tool (general-purpose subagent_type + prompt content).

Outputs:
  - N files at the output dir
  - JSON to stdout listing the file paths + roles

Exit codes:
  0 — All agent files generated
  1 — At least one template missing or write failed
  2 — Error (plan not found, etc.)
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path


TEMPLATES = {
    "architecture": "agent-architecture-reviewer.md",
    "tests": "agent-test-reviewer.md",
    "wiring": "agent-wiring-reviewer.md",
    "cross-validation": "agent-cross-validation-reviewer.md",
    "domain": "agent-domain-reviewer.md",
}

BASELINE_ROLES = ["architecture", "tests", "wiring", "cross-validation"]


def _find_skill_dir(start: Path) -> Path:
    """Find the review skill directory (where templates live)."""
    current = start.resolve()
    for _ in range(20):
        candidate = current / ".claude" / "skills" / "review"
        if candidate.exists():
            return candidate
        if current == current.parent:
            break
        current = current.parent
    raise FileNotFoundError("Could not find .claude/skills/review/")


def substitute(template_content: str, mapping: dict[str, str]) -> str:
    """Replace {KEY} markers with values from mapping."""
    result = template_content
    for key, value in mapping.items():
        result = result.replace("{" + key + "}", value)
    return result


def write_agent_file(skill_dir: Path, template_name: str, output_dir: Path, role: str, mapping: dict[str, str]) -> Path:
    template_path = skill_dir / "templates" / template_name
    if not template_path.exists():
        raise FileNotFoundError(f"Template not found: {template_path}")

    content = template_path.read_text(encoding="utf-8-sig")
    substituted = substitute(content, mapping)

    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{role}.md"
    output_path.write_text(substituted, encoding="utf-8")
    return output_path


def main() -> int:
    parser = argparse.ArgumentParser(description="Spawn specialized review agents for a plan.")
    parser.add_argument("--plan", type=Path, required=True, help="Path to plan markdown")
    parser.add_argument("--slug", required=True, help="Plan slug (used in agent file names)")
    parser.add_argument("--date", default=None, help="Date string (default: today UTC)")
    parser.add_argument("--primary-domain", required=True, help="Primary domain detected")
    parser.add_argument(
        "--secondary-domains",
        default="",
        help="Comma-separated list of secondary domains (max 3)",
    )
    parser.add_argument("--diff-base", default="main", help="Git diff base (default: main)")
    parser.add_argument("--output-dir", type=Path, default=None, help="Where to write agent files")
    parser.add_argument("--domain-keywords", default="", help="Comma-separated keywords (audit)")
    parser.add_argument("--skill-dir", type=Path, default=None, help="Override skill dir lookup (for tests)")
    args = parser.parse_args()

    if not args.plan.exists():
        print(json.dumps({"error": f"Plan not found: {args.plan}"}), file=sys.stderr)
        return 2

    # Resolve skill dir: explicit override, then walk-up from plan, then walk-up from this script
    if args.skill_dir:
        skill_dir = args.skill_dir
    else:
        try:
            skill_dir = _find_skill_dir(args.plan.resolve().parent)
        except FileNotFoundError:
            skill_dir = _find_skill_dir(Path(__file__).resolve().parent)
    date_str = args.date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    output_dir = args.output_dir or (skill_dir.parent.parent / "agents" / f"review-{args.slug}-{date_str}")

    base_mapping = {
        "SLUG": args.slug,
        "DATE": date_str,
        "PLAN_PATH": str(args.plan),
        "DIFF_BASE": args.diff_base,
        "DOMAIN_KEYWORDS": args.domain_keywords,
    }

    generated: list[dict[str, str]] = []
    errors: list[str] = []

    # Baseline agents (always)
    for role in BASELINE_ROLES:
        try:
            mapping = dict(base_mapping)
            template_name = TEMPLATES[role]
            path = write_agent_file(skill_dir, template_name, output_dir, role, mapping)
            generated.append({"role": role, "path": str(path)})
        except FileNotFoundError as exc:
            errors.append(f"Failed to spawn {role}: {exc}")
        except OSError as exc:
            errors.append(f"Failed to write {role}: {exc}")

    # Domain-specific agents
    domains_to_spawn: list[str] = [args.primary_domain]
    if args.secondary_domains:
        domains_to_spawn.extend(d.strip() for d in args.secondary_domains.split(",") if d.strip())
    # Cap at 4 total domain agents (primary + 3 secondary)
    domains_to_spawn = [d for d in domains_to_spawn if d and d != "unknown"][:4]

    for domain in domains_to_spawn:
        try:
            mapping = dict(base_mapping)
            mapping["DOMAIN"] = domain
            role = f"domain-{domain}"
            path = write_agent_file(skill_dir, TEMPLATES["domain"], output_dir, role, mapping)
            generated.append({"role": role, "domain": domain, "path": str(path)})
        except FileNotFoundError as exc:
            errors.append(f"Failed to spawn domain-{domain}: {exc}")
        except OSError as exc:
            errors.append(f"Failed to write domain-{domain}: {exc}")

    # Findings directory placeholder so agents have a place to write
    findings_dir = output_dir / "findings"
    findings_dir.mkdir(parents=True, exist_ok=True)
    (findings_dir / ".gitkeep").touch(exist_ok=True)

    output = {
        "plan": str(args.plan),
        "slug": args.slug,
        "date": date_str,
        "primary_domain": args.primary_domain,
        "secondary_domains": [d.strip() for d in args.secondary_domains.split(",") if d.strip()],
        "output_dir": str(output_dir),
        "findings_dir": str(findings_dir),
        "agents_generated": generated,
        "agents_count": len(generated),
        "errors": errors,
    }
    print(json.dumps(output, indent=2))

    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
