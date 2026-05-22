"""Python detector — wraps vulture (D1) + PyPI registry lookup (D2) + mutmut (D4).

Stub at T0.3. Implementations:
- detect_dead_code → T1.1 (vulture wrapper)
- detect_symbol_fabrication → T2.2 (PyPI + inspect)
- detect_orphan_exports → T3.1 (ast-grep cross-package, shared across langs)
- detect_mutation_score → T4.1 (mutmut wrapper, scoped to critical paths)
"""
from __future__ import annotations

from pathlib import Path

from . import BaseDetector


class PythonDetector(BaseDetector):
    language = "python"
    manifest_marker = "pyproject.toml"

    def detect_dead_code(self, repo_root: Path) -> list:
        # T1.1 — vulture wrapper
        raise NotImplementedError("T1.1: vulture wrapper not yet implemented")

    def detect_symbol_fabrication(self, changed_files: list[Path]) -> list:
        # T2.2 — PyPI registry lookup + inspect introspection
        raise NotImplementedError("T2.2: PyPI symbol fabrication detector not yet implemented")

    def detect_orphan_exports(self, repo_root: Path) -> list:
        # T3.1 — shared cross-package wiring (delegates to check_wiring_cross_package.py)
        raise NotImplementedError("T3.1: cross-package wiring detector not yet implemented")

    def detect_mutation_score(self, critical_paths: list[Path]) -> list:
        # T4.1 — mutmut wrapper (mutmut 3.x — CLI revalidation note in plan)
        raise NotImplementedError("T4.1: mutmut wrapper not yet implemented")
