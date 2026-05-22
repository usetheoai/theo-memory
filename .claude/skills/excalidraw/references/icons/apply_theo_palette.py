"""Recolor SVGs using theo_palette_map.json.

Reads each <lib>/_raw/<name>.svg and writes a recolored version to <lib>/<name>.svg.
The recoloring rules:
  - Lucide / Tabler: stroke="currentColor" -> stroke="<color>"
  - Simple Icons / Phosphor Duotone: fill values replaced where appropriate

The category for each icon comes from curated_icons.txt.

Usage:
    cd .claude/skills/excalidraw/references/icons
    python3 apply_theo_palette.py [--color-override <hex>]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent
PALETTE_FILE = ROOT / "theo_palette_map.json"
CURATED_FILE = ROOT / "curated_icons.txt"


def load_palette() -> dict[str, str]:
    data = json.loads(PALETTE_FILE.read_text(encoding="utf-8"))
    return {name: spec["color"] for name, spec in data["categories"].items()}


def parse_curated() -> list[tuple[str, str, str]]:
    entries: list[tuple[str, str, str]] = []
    for raw in CURATED_FILE.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        if len(parts) < 2:
            continue
        lib_name, category = parts[0], parts[1]
        if "/" not in lib_name:
            continue
        lib, name = lib_name.split("/", 1)
        entries.append((lib, name, category))
    return entries


def recolor_lucide_tabler(svg: str, color: str) -> str:
    svg = svg.replace('stroke="currentColor"', f'stroke="{color}"')
    svg = svg.replace("stroke='currentColor'", f"stroke='{color}'")
    return svg


def recolor_simple_icons(svg: str, color: str) -> str:
    """Simple Icons SVGs have <path> with no explicit fill (inherits black).

    We inject fill on the root <svg> tag so all paths inherit it, unless the
    file already has fill on <svg>.
    """
    if re.search(r"<svg[^>]*\bfill=", svg):
        svg = re.sub(r'(<svg[^>]*?)\bfill="[^"]*"', rf'\1fill="{color}"', svg, count=1)
    else:
        svg = re.sub(r"<svg\b", f'<svg fill="{color}"', svg, count=1)
    return svg


def recolor_phosphor_duotone(svg: str, color: str) -> str:
    """Phosphor duotone has two layers (filled + outline) using opacity 0.2 + 1.0.

    Original SVG sets fill="currentColor" on root <svg>. Both <path>s inherit it;
    the duotone effect comes from opacity, which we preserve.
    """
    svg = svg.replace('fill="currentColor"', f'fill="{color}"')
    svg = re.sub(r'fill="#[0-9A-Fa-f]{3,8}"', f'fill="{color}"', svg)
    return svg


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--color-override", help="Single hex color applied to ALL icons (debug)")
    args = ap.parse_args()

    palette = load_palette()
    entries = parse_curated()

    stats = {"recolored": 0, "missing_raw": 0, "unknown_category": 0}

    for lib, name, category in entries:
        raw_path = ROOT / lib / "_raw" / f"{name}.svg"
        out_path = ROOT / lib / f"{name}.svg"

        if not raw_path.exists():
            stats["missing_raw"] += 1
            print(f"  ! missing raw: {lib}/{name}", file=sys.stderr)
            continue

        if args.color_override:
            color = args.color_override
        elif category in palette:
            color = palette[category]
        elif category == "brand":
            color = palette["neutral"]
        else:
            stats["unknown_category"] += 1
            print(f"  ! unknown category {category!r} for {lib}/{name}", file=sys.stderr)
            continue

        svg = raw_path.read_text(encoding="utf-8")
        if lib in ("lucide", "tabler"):
            svg = recolor_lucide_tabler(svg, color)
        elif lib == "simple-icons":
            svg = recolor_simple_icons(svg, color)
        elif lib == "phosphor-duotone":
            svg = recolor_phosphor_duotone(svg, color)
        else:
            continue

        out_path.write_text(svg, encoding="utf-8")
        stats["recolored"] += 1

    print(f"Recolored: {stats['recolored']}")
    print(f"Missing raw (run download_icons.py): {stats['missing_raw']}")
    print(f"Unknown category: {stats['unknown_category']}")
    return 0 if stats["missing_raw"] == 0 and stats["unknown_category"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
