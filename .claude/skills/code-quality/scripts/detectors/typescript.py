"""TypeScript detector — wraps knip (D1) + npm registry lookup (D2) + stryker (D4).

T1.2 implementation: detect_dead_code via knip subprocess.
Other methods still stubs (T2.3 / T3.1 / T4.2).
"""
from __future__ import annotations

import subprocess
from pathlib import Path

from scripts._shared import Finding, safe_parse_json, sanitize_symbol

from . import BaseDetector

_KNIP_TIMEOUT_SEC = 120


class TypescriptDetector(BaseDetector):
    language = "typescript"
    manifest_marker = "package.json"

    def detect_dead_code(self, repo_root: Path) -> list[Finding]:
        """Run knip against `repo_root` and parse JSON into Findings.

        knip emits exit code 0 (no findings) or 1 (findings). Exit code > 1
        signals tool error and is treated as `auditor_unavailable_knip`.
        """
        cmd = ["npx", "--yes", "knip", "--reporter", "json"]
        try:
            result = subprocess.run(
                cmd,
                cwd=str(repo_root),
                capture_output=True,
                text=True,
                timeout=_KNIP_TIMEOUT_SEC,
                check=False,
            )
        except FileNotFoundError:
            return [self._auditor_unavailable("knip not found in PATH (install via npm i -g knip)")]
        except subprocess.TimeoutExpired:
            return [self._auditor_unavailable(f"knip timed out after {_KNIP_TIMEOUT_SEC}s")]
        except (subprocess.SubprocessError, OSError) as e:
            return [self._auditor_unavailable(f"knip invocation failed: {e}")]

        if result.returncode > 1:
            return [
                self._auditor_unavailable(
                    f"knip exit code {result.returncode}: {result.stderr.strip()[:200]}"
                )
            ]

        data, parse_finding = safe_parse_json(result.stdout, "knip")
        if parse_finding is not None:
            # Re-emit with TypeScript-specific language metadata + safe allowlist_key.
            return [
                Finding(
                    detector="d1_dead_code",
                    language="typescript",
                    severity="SOFT_CAP",
                    file_path=".",
                    symbol_or_line="knip",
                    message=f"knip JSON output failed to parse: {parse_finding.message}",
                    allowlist_key="typescript|.|dead_code|auditor_output_malformed_knip",
                )
            ]
        return self._parse_knip_json(data, repo_root)

    def detect_symbol_fabrication(self, changed_files: list[Path]) -> list[Finding]:
        raise NotImplementedError("T2.3: npm symbol fabrication detector not yet implemented")

    def detect_orphan_exports(self, repo_root: Path) -> list[Finding]:
        raise NotImplementedError("T3.1: cross-package wiring detector not yet implemented")

    def detect_mutation_score(self, critical_paths: list[Path]) -> list[Finding]:
        raise NotImplementedError("T4.2: stryker wrapper not yet implemented")

    # ------------------------------------------------------------------
    # internal helpers
    # ------------------------------------------------------------------

    def _parse_knip_json(self, data: dict, repo_root: Path) -> list[Finding]:
        findings: list[Finding] = []

        for file_path in data.get("files", []) or []:
            findings.append(self._make_finding(file_path, "unimported file", "file", repo_root))

        for export in data.get("exports", []) or []:
            file_path = export.get("file", "<unknown>")
            name = export.get("name", "<unknown>")
            findings.append(
                self._make_finding(file_path, f"unused export '{name}'", name, repo_root)
            )

        for dep in data.get("dependencies", []) or []:
            name = dep.get("name") if isinstance(dep, dict) else str(dep)
            findings.append(
                self._make_finding("package.json", f"unused dependency '{name}'", name, repo_root)
            )

        for dep in data.get("devDependencies", []) or []:
            name = dep.get("name") if isinstance(dep, dict) else str(dep)
            findings.append(
                self._make_finding(
                    "package.json", f"unused devDependency '{name}'", name, repo_root
                )
            )

        return findings

    def _make_finding(
        self, file_path: str, message: str, symbol: str, repo_root: Path
    ) -> Finding:
        rel = self._safe_relative(file_path, repo_root)
        sanitized = sanitize_symbol(symbol)
        return Finding(
            detector="d1_dead_code",
            language="typescript",
            severity="HARD",
            file_path=rel,
            symbol_or_line=f"{symbol} @ {rel}",
            message=message,
            allowlist_key=f"typescript|{rel}|dead_code|{sanitized}",
        )

    @staticmethod
    def _safe_relative(file_path: str, repo_root: Path) -> str:
        path = Path(file_path)
        if path.is_absolute():
            try:
                return path.relative_to(repo_root.resolve()).as_posix()
            except ValueError:
                return path.as_posix().lstrip("/")
        return path.as_posix()

    def _auditor_unavailable(self, reason: str) -> Finding:
        return Finding(
            detector="d1_dead_code",
            language="typescript",
            severity="SOFT_CAP",
            file_path=".",
            symbol_or_line="knip",
            message=f"Knip auditor unavailable: {reason}",
            allowlist_key="typescript|.|dead_code|auditor_unavailable_knip",
        )
