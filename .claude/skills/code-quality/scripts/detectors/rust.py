"""Rust detector — wraps cargo-udeps (D1) + crates.io registry lookup (D2).

T1.3 implementation: detect_dead_code via cargo-udeps subprocess.
Other methods still stubs (T2.4 / T3.1) — T4.3 ADR DEFER for mutation.
"""
from __future__ import annotations

import subprocess
from pathlib import Path

from scripts._shared import Finding, safe_parse_json, sanitize_symbol

from . import BaseDetector

_CARGO_UDEPS_TIMEOUT_SEC = 180


class RustDetector(BaseDetector):
    language = "rust"
    manifest_marker = "Cargo.toml"

    def detect_dead_code(self, repo_root: Path) -> list[Finding]:
        """Run `cargo +nightly udeps --output json` and parse unused deps."""
        cmd = ["cargo", "+nightly", "udeps", "--output", "json", "--all-targets"]
        try:
            result = subprocess.run(
                cmd,
                cwd=str(repo_root),
                capture_output=True,
                text=True,
                timeout=_CARGO_UDEPS_TIMEOUT_SEC,
                check=False,
            )
        except FileNotFoundError:
            return [self._auditor_unavailable("cargo +nightly udeps not found (install nightly + cargo-udeps)")]
        except subprocess.TimeoutExpired:
            return [self._auditor_unavailable(f"cargo-udeps timed out after {_CARGO_UDEPS_TIMEOUT_SEC}s")]
        except (subprocess.SubprocessError, OSError) as e:
            return [self._auditor_unavailable(f"cargo-udeps invocation failed: {e}")]

        if not result.stdout.strip():
            # No JSON output — likely no Cargo.toml or build error
            if result.returncode != 0:
                return [
                    self._auditor_unavailable(
                        f"cargo-udeps exit {result.returncode}: {result.stderr.strip()[:200]}"
                    )
                ]
            return []

        data, parse_finding = safe_parse_json(result.stdout, "cargo-udeps")
        if parse_finding is not None:
            return [
                Finding(
                    detector="d1_dead_code",
                    language="rust",
                    severity="SOFT_CAP",
                    file_path=".",
                    symbol_or_line="cargo-udeps",
                    message=f"cargo-udeps JSON output failed to parse: {parse_finding.message}",
                    allowlist_key="rust|.|dead_code|auditor_output_malformed_cargo-udeps",
                )
            ]
        return self._parse_udeps_json(data)

    def detect_symbol_fabrication(self, changed_files: list[Path]) -> list[Finding]:
        raise NotImplementedError("T2.4: crates.io symbol fabrication detector not yet implemented")

    def detect_orphan_exports(self, repo_root: Path) -> list[Finding]:
        raise NotImplementedError("T3.1: cross-package wiring detector not yet implemented")

    def detect_mutation_score(self, critical_paths: list[Path]) -> list[Finding]:
        # T4.3 — DEFERRED to v0.2 (evaluate cargo-mutants vs gremlins first)
        raise NotImplementedError("T4.3: Rust mutation testing DEFERRED to v0.2 (graceful skip)")

    # ------------------------------------------------------------------

    def _parse_udeps_json(self, data: dict) -> list[Finding]:
        findings: list[Finding] = []
        unused = data.get("unused_deps", {}) or {}
        for crate_id, sections in unused.items():
            for section_name in ("normal", "development", "build"):
                for dep_name in sections.get(section_name, []) or []:
                    sanitized = sanitize_symbol(dep_name)
                    findings.append(
                        Finding(
                            detector="d1_dead_code",
                            language="rust",
                            severity="HARD",
                            file_path="Cargo.toml",
                            symbol_or_line=f"{dep_name} ({section_name}, crate={crate_id})",
                            message=f"Unused {section_name} dependency '{dep_name}' "
                            f"in crate {crate_id}",
                            allowlist_key=f"rust|Cargo.toml|dead_code|{sanitized}",
                        )
                    )
        return findings

    def _auditor_unavailable(self, reason: str) -> Finding:
        return Finding(
            detector="d1_dead_code",
            language="rust",
            severity="SOFT_CAP",
            file_path=".",
            symbol_or_line="cargo-udeps",
            message=f"cargo-udeps auditor unavailable: {reason}",
            allowlist_key="rust|.|dead_code|auditor_unavailable_cargo-udeps",
        )
