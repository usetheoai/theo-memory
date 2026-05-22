"""Rust detector — wraps cargo-udeps (D1) + crates.io registry lookup (D2).

Stub at T0.3. Implementations:
- detect_dead_code → T1.3 (cargo-udeps wrapper, requires +nightly)
- detect_symbol_fabrication → T2.4 (crates.io + cargo metadata)
- detect_orphan_exports → T3.1 (shared cross-package wiring)
- detect_mutation_score → T4.3 (DEFERRED to v0.2 — graceful INFO skip)
"""
from __future__ import annotations

from pathlib import Path

from . import BaseDetector


class RustDetector(BaseDetector):
    language = "rust"
    manifest_marker = "Cargo.toml"

    def detect_dead_code(self, repo_root: Path) -> list:
        raise NotImplementedError("T1.3: cargo-udeps wrapper not yet implemented")

    def detect_symbol_fabrication(self, changed_files: list[Path]) -> list:
        raise NotImplementedError("T2.4: crates.io symbol fabrication detector not yet implemented")

    def detect_orphan_exports(self, repo_root: Path) -> list:
        raise NotImplementedError("T3.1: cross-package wiring detector not yet implemented")

    def detect_mutation_score(self, critical_paths: list[Path]) -> list:
        # T4.3 — DEFERRED to v0.2 (evaluate cargo-mutants vs gremlins first)
        raise NotImplementedError("T4.3: Rust mutation testing DEFERRED to v0.2 (graceful skip)")
