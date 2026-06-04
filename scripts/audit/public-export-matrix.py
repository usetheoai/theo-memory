#!/usr/bin/env python3
"""T0.2 — public-export-matrix.py — enumerate all public exports of TheMemory.

Generates a JSON matrix consumed by Phase T1 tasks (T1.1 + T1.2) as their
closure tracker. The matrix records for each export: canonical source file,
JSDoc presence, `@see` cross-reference presence, and list of contract-test
files exercising the export.

EC-4 absorption (MUST FIX): handles 3 export forms:
  - `export { NAME, NAME2 } from './path';`
  - `export type { NAME, NAME2 } from './path';`
  - `export * from './path';`  (recursive walk on target until fixed-point)

Also handles inline declarations:
  - `export const NAME = ...;`
  - `export function NAME(...) ...`
  - `export class NAME ...`
  - `export interface NAME ...`
  - `export type NAME = ...;`

Exit code: always 0; output JSON to stdout matching the schema asserted by
tests/integration/p0-audit/matrix.test.ts.

@see .claude/knowledge-base/plans/p0-api-sdk-mcp-correctness-audit-plan.md § T0.2
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

SCHEMA_VERSION = "0.1.0"

REPO_ROOT = Path(__file__).resolve().parent.parent.parent

ENTRY_FILES = [
    REPO_ROOT / "src" / "index.ts",
    REPO_ROOT / "src" / "core" / "index.ts",
]

# Regex patterns for export extraction (sufficient for barrel files).
RE_EXPORT_NAMED = re.compile(
    r"^\s*export\s+(?:type\s+)?\{([^}]*)\}\s*(?:from\s+['\"]([^'\"]+)['\"])?\s*;?",
    re.MULTILINE,
)
RE_EXPORT_WILDCARD = re.compile(
    r"^\s*export\s+\*\s+from\s+['\"]([^'\"]+)['\"]\s*;?",
    re.MULTILINE,
)
RE_EXPORT_INLINE = re.compile(
    r"^\s*export\s+(?:async\s+)?(?:const|let|var|function\s*\*?|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)",
    re.MULTILINE,
)

# Test file roots to grep for contract test detection.
TEST_ROOTS = [
    REPO_ROOT / "src",  # collocated __tests__
    REPO_ROOT / "tests",  # tests/integration + tests/e2e + tests/unit
]


def resolve_spec(source_dir: Path, spec: str) -> Path | None:
    """Resolve a `./x.js` import spec to the source `.ts` path under repo_root."""
    if not spec.startswith("."):
        return None  # external dep — not relevant for matrix
    candidate = source_dir / spec
    # ESM `.js` extensions point at `.ts` source.
    if candidate.suffix == ".js":
        ts_path = candidate.with_suffix(".ts")
        if ts_path.exists():
            return ts_path.resolve()
    if candidate.is_dir():
        idx = candidate / "index.ts"
        if idx.exists():
            return idx.resolve()
    if candidate.exists():
        return candidate.resolve()
    return None


def split_names(group: str) -> list[str]:
    """Split a `{A, B as C, type D}` group into the EXPORTED names (after `as`)."""
    names: list[str] = []
    for raw in group.split(","):
        token = raw.strip()
        if not token:
            continue
        # Strip leading `type ` for type-only specifier
        if token.startswith("type "):
            token = token[5:].strip()
        # `Original as Exported` — keep Exported
        if " as " in token:
            token = token.split(" as ", 1)[1].strip()
        # Drop trailing comments / type annotations defensively
        token = token.split("//")[0].strip()
        if token and re.match(r"^[A-Za-z_$][\w$]*$", token):
            names.append(token)
    return names


def find_jsdoc_block(content: str, line_no: int) -> tuple[bool, bool]:
    """Walk backward from line_no to find a JSDoc block. Return (has_jsdoc, has_see)."""
    lines = content.splitlines()
    idx = line_no - 1
    has_jsdoc = False
    has_see = False
    # Walk up past blank lines
    while idx > 0 and lines[idx - 1].strip() == "":
        idx -= 1
    # Now look for `*/` ending a JSDoc block
    if idx > 0 and "*/" in lines[idx - 1]:
        has_jsdoc = True
        # Walk up to find `/**` start, collecting `@see` references
        j = idx - 1
        while j >= 0:
            if "@see" in lines[j]:
                has_see = True
            if "/**" in lines[j]:
                break
            j -= 1
    return has_jsdoc, has_see


def walk_export_file(
    path: Path,
    visited: set[Path],
    found: dict[str, dict],
) -> None:
    """Extract exports from `path`; recurse into `export * from` targets.

    Mutates `found`: name → {source_file, jsdoc_present, see_ref_present}.
    First write wins (canonical declaration is closest to source).
    """
    if path in visited:
        return
    visited.add(path)
    if not path.exists():
        return

    content = path.read_text(encoding="utf-8")

    # Inline single-name exports (export const/function/class/interface/type)
    for m in RE_EXPORT_INLINE.finditer(content):
        name = m.group(1)
        if name in found:
            continue
        line_no = content[: m.start()].count("\n") + 1
        has_jsdoc, has_see = find_jsdoc_block(content, line_no)
        found[name] = {
            "source_file": str(path.relative_to(REPO_ROOT)),
            "jsdoc_present": has_jsdoc,
            "see_ref_present": has_see,
        }

    # Named `export { A, B } from './x'` (with or without `from`)
    for m in RE_EXPORT_NAMED.finditer(content):
        group, spec = m.group(1), m.group(2)
        names = split_names(group)
        line_no = content[: m.start()].count("\n") + 1
        has_jsdoc, has_see = find_jsdoc_block(content, line_no)
        if spec:
            # Re-export — recurse into target for canonical declaration site
            target = resolve_spec(path.parent, spec)
            if target is not None and target not in visited:
                walk_export_file(target, visited, found)
            for name in names:
                if name not in found:
                    if target is not None:
                        found[name] = {
                            "source_file": str(target.relative_to(REPO_ROOT)),
                            "jsdoc_present": has_jsdoc,
                            "see_ref_present": has_see,
                        }
                    else:
                        found[name] = {
                            "source_file": str(path.relative_to(REPO_ROOT)),
                            "jsdoc_present": has_jsdoc,
                            "see_ref_present": has_see,
                        }
        else:
            # Local re-export — canonical site is THIS file
            for name in names:
                if name not in found:
                    found[name] = {
                        "source_file": str(path.relative_to(REPO_ROOT)),
                        "jsdoc_present": has_jsdoc,
                        "see_ref_present": has_see,
                    }

    # Wildcard `export * from './x'` — recurse
    for m in RE_EXPORT_WILDCARD.finditer(content):
        spec = m.group(1)
        target = resolve_spec(path.parent, spec)
        if target is not None:
            walk_export_file(target, visited, found)


def find_contract_tests(name: str) -> list[str]:
    """grep test roots for `name` occurrences. Returns repo-relative paths."""
    hits: set[str] = set()
    for root in TEST_ROOTS:
        if not root.exists():
            continue
        try:
            result = subprocess.run(
                [
                    "grep", "-rlE",
                    rf"\b{re.escape(name)}\b",
                    str(root),
                    "--include=*.test.ts",
                    "--include=*.test-d.ts",
                ],
                capture_output=True,
                text=True,
                timeout=20,
            )
        except (FileNotFoundError, subprocess.TimeoutExpired):
            continue
        for line in result.stdout.splitlines():
            p = Path(line.strip())
            if p.exists():
                hits.add(str(p.relative_to(REPO_ROOT)))
    return sorted(hits)


def main() -> int:
    found: dict[str, dict] = {}
    visited: set[Path] = set()
    for entry in ENTRY_FILES:
        walk_export_file(entry, visited, found)

    # Filter: drop names that look like internal helpers (lowercase + leading underscore).
    # Keep PascalCase + camelCase + UPPER_SNAKE_CASE (TypeScript public-export convention).
    exports = []
    for name in sorted(found.keys()):
        if name.startswith("_"):
            continue
        meta = found[name]
        meta["name"] = name
        meta["contract_test_files"] = find_contract_tests(name)
        exports.append({
            "name": name,
            "source_file": meta["source_file"],
            "jsdoc_present": meta["jsdoc_present"],
            "see_ref_present": meta["see_ref_present"],
            "contract_test_files": meta["contract_test_files"],
        })

    print(json.dumps({
        "schema_version": SCHEMA_VERSION,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "exports": exports,
    }, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
