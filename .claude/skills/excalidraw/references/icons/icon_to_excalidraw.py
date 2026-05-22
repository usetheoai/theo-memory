"""Generate Excalidraw JSON snippet for embedding an icon as image element.

Given an icon name from the catalog, emits a JSON object that can be merged
into the `elements` and `files` of an .excalidraw scene.

Usage:
    python3 icon_to_excalidraw.py <lib>/<name> [--x 100] [--y 100] [--size 48]
                                                [--color <hex>] [--id <id>]

Examples:
    # Default: position 0,0, size 48x48, color from catalog category
    python3 icon_to_excalidraw.py lucide/brain

    # Custom position + size, color override
    python3 icon_to_excalidraw.py lucide/database --x 200 --y 150 --size 64 --color "#a855f7"

The output is JSON with two keys: `element` (push into elements[]) and
`file` (merge into files{}). Both share a deterministic fileId.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).parent
PALETTE_FILE = ROOT / "theo_palette_map.json"
CURATED_FILE = ROOT / "curated_icons.txt"


def load_palette() -> dict[str, str]:
    data = json.loads(PALETTE_FILE.read_text(encoding="utf-8"))
    return {name: spec["color"] for name, spec in data["categories"].items()}


def lookup_category(lib_slash_name: str) -> str | None:
    for raw in CURATED_FILE.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        if len(parts) >= 2 and parts[0] == lib_slash_name:
            return parts[1]
    return None


def recolor_for_lib(svg: str, lib: str, color: str) -> str:
    if lib in ("lucide", "tabler"):
        svg = svg.replace('stroke="currentColor"', f'stroke="{color}"')
        svg = svg.replace("stroke='currentColor'", f"stroke='{color}'")
    elif lib == "simple-icons":
        if re.search(r"<svg[^>]*\bfill=", svg):
            svg = re.sub(r'(<svg[^>]*?)\bfill="[^"]*"', rf'\1fill="{color}"', svg, count=1)
        else:
            svg = re.sub(r"<svg\b", f'<svg fill="{color}"', svg, count=1)
    elif lib == "phosphor-duotone":
        svg = svg.replace('fill="currentColor"', f'fill="{color}"')
        svg = re.sub(r'fill="#[0-9A-Fa-f]{3,8}"', f'fill="{color}"', svg)
    return svg


def deterministic_id(prefix: str, *parts: str) -> str:
    h = hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()[:16]
    return f"{prefix}-{h}"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("icon", help="Format: <lib>/<name>, e.g. lucide/brain")
    ap.add_argument("--x", type=float, default=0)
    ap.add_argument("--y", type=float, default=0)
    ap.add_argument("--size", type=float, default=48, help="Width and height in px")
    ap.add_argument("--color", help="Hex color override (e.g. #a855f7)")
    ap.add_argument("--id", help="Element id override (default: auto)")
    ap.add_argument("--pretty", action="store_true", help="Pretty-print JSON")
    args = ap.parse_args()

    if "/" not in args.icon:
        print(f"ERROR: expected <lib>/<name>, got {args.icon!r}", file=sys.stderr)
        return 2
    lib, name = args.icon.split("/", 1)

    raw_path = ROOT / lib / "_raw" / f"{name}.svg"
    if not raw_path.exists():
        print(f"ERROR: not found: {raw_path}", file=sys.stderr)
        print("Run: python3 download_icons.py", file=sys.stderr)
        return 1

    if args.color:
        color = args.color
    else:
        palette = load_palette()
        category = lookup_category(args.icon) or "neutral"
        color = palette.get(category, palette["neutral"]) if category != "brand" else palette["neutral"]

    svg = raw_path.read_text(encoding="utf-8")
    svg = recolor_for_lib(svg, lib, color)

    data_url = "data:image/svg+xml;base64," + base64.b64encode(svg.encode("utf-8")).decode("ascii")

    file_id = deterministic_id("icon", lib, name, color)
    element_id = args.id or deterministic_id("img", lib, name, str(args.x), str(args.y))
    now_ms = int(time.time() * 1000)

    element = {
        "type": "image",
        "version": 1,
        "versionNonce": 0,
        "isDeleted": False,
        "id": element_id,
        "fillStyle": "solid",
        "strokeWidth": 1,
        "strokeStyle": "solid",
        "roughness": 0,
        "opacity": 100,
        "angle": 0,
        "x": args.x,
        "y": args.y,
        "strokeColor": "transparent",
        "backgroundColor": "transparent",
        "width": args.size,
        "height": args.size,
        "seed": int(hashlib.sha1(element_id.encode()).hexdigest()[:8], 16),
        "groupIds": [],
        "frameId": None,
        "roundness": None,
        "boundElements": [],
        "updated": now_ms,
        "link": None,
        "locked": False,
        "status": "saved",
        "fileId": file_id,
        "scale": [1, 1],
    }

    file_entry = {
        "mimeType": "image/svg+xml",
        "id": file_id,
        "dataURL": data_url,
        "created": now_ms,
        "lastRetrieved": now_ms,
    }

    output = {"element": element, "file": file_entry}
    indent = 2 if args.pretty else None
    print(json.dumps(output, indent=indent))
    return 0


if __name__ == "__main__":
    sys.exit(main())
