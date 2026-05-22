"""Go detector — wraps deadcode (D1) + Go proxy registry lookup (D2).

Stub at T0.3. Implementations:
- detect_dead_code → T1.4 (deadcode wrapper, v0.45.0)
- detect_symbol_fabrication → T2.5 (Go proxy + self-module skip + vendor/ skip)
- detect_orphan_exports → T3.1 (shared cross-package wiring)
- detect_mutation_score → T4.3 (DEFERRED to v0.2 — graceful INFO skip)
"""
from __future__ import annotations

from pathlib import Path

from . import BaseDetector


class GoDetector(BaseDetector):
    language = "go"
    manifest_marker = "go.mod"

    def detect_dead_code(self, repo_root: Path) -> list:
        raise NotImplementedError("T1.4: deadcode wrapper not yet implemented")

    def detect_symbol_fabrication(self, changed_files: list[Path]) -> list:
        raise NotImplementedError("T2.5: Go proxy symbol fabrication detector not yet implemented")

    def detect_orphan_exports(self, repo_root: Path) -> list:
        raise NotImplementedError("T3.1: cross-package wiring detector not yet implemented")

    def detect_mutation_score(self, critical_paths: list[Path]) -> list:
        # T4.3 — DEFERRED to v0.2 (evaluate go-mutesting vs gremlins first)
        raise NotImplementedError("T4.3: Go mutation testing DEFERRED to v0.2 (graceful skip)")
