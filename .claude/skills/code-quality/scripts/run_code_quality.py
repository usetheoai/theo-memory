#!/usr/bin/env python3
"""Orchestrator entrypoint for /code-quality skill.

Stub at T0.3 — full implementation in T5.1 (CLI + auto-detect + detector orchestration)
plus T5.2 (verdict aggregator) plus T5.3 (Markdown report writer).

Per cycle-implement.md halt-loop, this file is incrementally filled by tasks
T5.1, T5.2, T5.3.
"""
from __future__ import annotations

import sys


def main() -> int:
    print("ERROR: /code-quality orchestrator not yet implemented (T5.1+)", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
