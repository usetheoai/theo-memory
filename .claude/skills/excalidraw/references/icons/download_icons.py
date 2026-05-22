"""Download curated icons from upstream GitHub repos.

Reads curated_icons.txt and fetches each icon's SVG from the appropriate
raw.githubusercontent.com URL. Idempotent: skips files that already exist.

Usage:
    cd .claude/skills/excalidraw/references/icons
    python3 download_icons.py [--force]
"""

from __future__ import annotations

import argparse
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).parent
CURATED_FILE = ROOT / "curated_icons.txt"

URL_TEMPLATES: dict[str, str] = {
    "lucide": "https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/{name}.svg",
    "tabler": "https://raw.githubusercontent.com/tabler/tabler-icons/main/icons/outline/{name}.svg",
    "simple-icons": "https://raw.githubusercontent.com/simple-icons/simple-icons/develop/icons/{name}.svg",
    "phosphor-duotone": "https://raw.githubusercontent.com/phosphor-icons/core/main/assets/duotone/{name}-duotone.svg",
}


def parse_curated() -> list[tuple[str, str, str]]:
    """Returns list of (lib, name, category). Skips comments and blank lines."""
    entries: list[tuple[str, str, str]] = []
    for raw in CURATED_FILE.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        if len(parts) < 2:
            print(f"WARN: malformed line skipped: {raw!r}", file=sys.stderr)
            continue
        lib_name, category = parts[0], parts[1]
        if "/" not in lib_name:
            print(f"WARN: expected <lib>/<name>, got {lib_name!r}", file=sys.stderr)
            continue
        lib, name = lib_name.split("/", 1)
        if lib not in URL_TEMPLATES:
            print(f"WARN: unknown lib {lib!r}", file=sys.stderr)
            continue
        entries.append((lib, name, category))
    return entries


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "specs-icons-fetcher/1.0"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return resp.read()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--force", action="store_true", help="Re-download even if file exists")
    args = ap.parse_args()

    entries = parse_curated()
    print(f"Found {len(entries)} curated icons")

    stats = {"downloaded": 0, "skipped": 0, "failed": 0}
    failures: list[tuple[str, str]] = []

    for lib, name, _category in entries:
        out_dir = ROOT / lib / "_raw"
        out_dir.mkdir(parents=True, exist_ok=True)
        out_path = out_dir / f"{name}.svg"

        if out_path.exists() and not args.force:
            stats["skipped"] += 1
            continue

        url = URL_TEMPLATES[lib].format(name=name)
        try:
            content = fetch(url)
            out_path.write_bytes(content)
            stats["downloaded"] += 1
            print(f"  + {lib}/{name}")
        except urllib.error.HTTPError as e:
            stats["failed"] += 1
            failures.append((f"{lib}/{name}", f"HTTP {e.code} {e.reason}"))
            print(f"  ! {lib}/{name}: HTTP {e.code}", file=sys.stderr)
        except (urllib.error.URLError, TimeoutError) as e:
            stats["failed"] += 1
            failures.append((f"{lib}/{name}", str(e)))
            print(f"  ! {lib}/{name}: {e}", file=sys.stderr)

        time.sleep(0.05)

    print()
    print(f"Downloaded: {stats['downloaded']}")
    print(f"Skipped (already present): {stats['skipped']}")
    print(f"Failed: {stats['failed']}")

    if failures:
        print("\nFailures (likely renamed/removed upstream — update curated_icons.txt):")
        for icon, reason in failures:
            print(f"  - {icon}: {reason}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
