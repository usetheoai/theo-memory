#!/usr/bin/env python3
"""
Fix relative imports in .ts files after directory moves.

Usage:
    python3 scripts/fix-imports-after-move.py <mapping-file>

The mapping file has lines like:
    src/core -> packages/core/src/domain
    src/local -> packages/core/src/infrastructure/db

The script:
1. Finds all .ts files in the NEW locations
2. For each import like `from '../core/foo.js'`, computes the absolute OLD path
3. Maps it through the directory mapping to the NEW absolute path
4. Computes the correct new relative path from the importing file
"""
import os
import re
import sys
from pathlib import Path

IMPORT_RE = re.compile(r"""(from\s+['"])(\.[^'"]+)(['"])""")

def load_mappings(mapping_file: str) -> list[tuple[str, str]]:
    mappings = []
    with open(mapping_file) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            old, new = line.split(' -> ')
            mappings.append((old.strip().rstrip('/'), new.strip().rstrip('/')))
    return mappings

def resolve_old_path(importing_file: str, relative_import: str, mappings: list[tuple[str, str]]) -> str | None:
    """Given an importing file at its NEW location and a relative import,
    figure out what the OLD absolute path would have been."""
    # The relative import was written when the file was at its OLD location.
    # We need to figure out where the OLD location was.
    importing_dir_new = os.path.dirname(importing_file)

    # Find which mapping moved this file
    for old_prefix, new_prefix in mappings:
        if importing_file.startswith(new_prefix + '/') or importing_file.startswith(new_prefix):
            # This file was moved from old_prefix
            # Its old path was: old_prefix + (importing_file - new_prefix)
            suffix = importing_file[len(new_prefix):]
            old_file_path = old_prefix + suffix
            old_dir = os.path.dirname(old_file_path)

            # Resolve the relative import from the old dir
            resolved = os.path.normpath(os.path.join(old_dir, relative_import))
            return resolved

    return None

def find_new_path(old_resolved: str, mappings: list[tuple[str, str]]) -> str | None:
    """Map an old absolute path to its new absolute path."""
    for old_prefix, new_prefix in mappings:
        if old_resolved.startswith(old_prefix + '/') or old_resolved == old_prefix:
            suffix = old_resolved[len(old_prefix):]
            return new_prefix + suffix
    return None

def compute_relative(from_file: str, to_file: str) -> str:
    """Compute the relative path from from_file's dir to to_file."""
    from_dir = os.path.dirname(from_file)
    rel = os.path.relpath(to_file, from_dir)
    if not rel.startswith('.'):
        rel = './' + rel
    return rel

def fix_file(filepath: str, mappings: list[tuple[str, str]], dry_run: bool = False) -> int:
    with open(filepath) as f:
        content = f.read()

    changes = 0
    def replacer(m):
        nonlocal changes
        prefix = m.group(1)
        rel_path = m.group(2)
        suffix = m.group(3)

        # Only fix relative imports
        if not rel_path.startswith('.'):
            return m.group(0)

        # Resolve what the old absolute path was
        old_resolved = resolve_old_path(filepath, rel_path, mappings)
        if old_resolved is None:
            return m.group(0)

        # Find the new location
        new_resolved = find_new_path(old_resolved, mappings)
        if new_resolved is None:
            # Target wasn't moved, but source was - compute new relative
            # from the new source location to the old target location
            new_rel = compute_relative(filepath, old_resolved)
            if new_rel != rel_path:
                changes += 1
                return f"{prefix}{new_rel}{suffix}"
            return m.group(0)

        # Compute new relative path
        new_rel = compute_relative(filepath, new_resolved)
        if new_rel != rel_path:
            changes += 1
            return f"{prefix}{new_rel}{suffix}"
        return m.group(0)

    new_content = IMPORT_RE.sub(replacer, content)

    if changes > 0 and not dry_run:
        with open(filepath, 'w') as f:
            f.write(new_content)

    return changes

def main():
    if len(sys.argv) < 2:
        print("Usage: fix-imports-after-move.py <mapping-file>")
        sys.exit(1)

    mapping_file = sys.argv[1]
    dry_run = '--dry-run' in sys.argv
    mappings = load_mappings(mapping_file)

    print(f"Loaded {len(mappings)} mappings:")
    for old, new in mappings:
        print(f"  {old} -> {new}")

    # Find all .ts files in the NEW locations
    total_changes = 0
    files_changed = 0
    for _, new_prefix in mappings:
        for root, dirs, files in os.walk(new_prefix):
            for f in files:
                if f.endswith('.ts'):
                    filepath = os.path.join(root, f)
                    changes = fix_file(filepath, mappings, dry_run)
                    if changes > 0:
                        files_changed += 1
                        total_changes += changes
                        print(f"  {'[DRY] ' if dry_run else ''}Fixed {changes} import(s) in {filepath}")

    action = "Would fix" if dry_run else "Fixed"
    print(f"\n{action} {total_changes} imports across {files_changed} files")

if __name__ == '__main__':
    main()
