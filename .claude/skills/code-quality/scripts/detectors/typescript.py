"""TypeScript detector — wraps knip (D1) + npm registry lookup (D2) + stryker (D4).

Stub at T0.3. Implementations:
- detect_dead_code → T1.2 (knip v6.x wrapper)
- detect_symbol_fabrication → T2.3 (npm registry + type-only + subpath skip)
- detect_orphan_exports → T3.1 (shared cross-package wiring)
- detect_mutation_score → T4.2 (@stryker-mutator/core ^9.6 wrapper)
"""
from __future__ import annotations

from pathlib import Path

from . import BaseDetector


class TypescriptDetector(BaseDetector):
    language = "typescript"
    manifest_marker = "package.json"

    def detect_dead_code(self, repo_root: Path) -> list:
        raise NotImplementedError("T1.2: knip wrapper not yet implemented")

    def detect_symbol_fabrication(self, changed_files: list[Path]) -> list:
        raise NotImplementedError("T2.3: npm symbol fabrication detector not yet implemented")

    def detect_orphan_exports(self, repo_root: Path) -> list:
        raise NotImplementedError("T3.1: cross-package wiring detector not yet implemented")

    def detect_mutation_score(self, critical_paths: list[Path]) -> list:
        raise NotImplementedError("T4.2: stryker wrapper not yet implemented")
