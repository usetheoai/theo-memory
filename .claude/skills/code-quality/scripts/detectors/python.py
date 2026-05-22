"""Python detector — wraps vulture (D1) + PyPI registry lookup (D2) + mutmut (D4).

T1.1 implementation: detect_dead_code via vulture subprocess.
Other methods still stubs (T2.2 / T3.1 / T4.1).
"""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

from scripts._shared import Finding, sanitize_symbol

from . import BaseDetector

_VULTURE_LINE_RE = re.compile(
    r"^(?P<path>[^:]+):(?P<line>\d+):\s+(?P<kind>\S+\s+\S+)\s+'(?P<symbol>[^']+)'.*\((?P<confidence>\d+)%\s+confidence\)"
)

_VULTURE_TIMEOUT_SEC = 120


class PythonDetector(BaseDetector):
    language = "python"
    manifest_marker = "pyproject.toml"

    def __init__(self, min_confidence: int = 80) -> None:
        self.min_confidence = min_confidence

    def detect_dead_code(self, repo_root: Path) -> list[Finding]:
        """Run vulture against `repo_root` and parse stdout into Findings.

        Returns:
            list[Finding] — one per detected dead-code item, severity=HARD.
            If vulture is unavailable, returns a single SOFT_CAP Finding with
            allowlist_key containing `auditor_unavailable_vulture`.
        """
        cmd = [
            "vulture",
            "--min-confidence",
            str(self.min_confidence),
            str(repo_root),
        ]
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=_VULTURE_TIMEOUT_SEC,
                check=False,
            )
        except FileNotFoundError:
            return [self._auditor_unavailable("vulture not found in PATH")]
        except subprocess.TimeoutExpired:
            return [self._auditor_unavailable(f"vulture timed out after {_VULTURE_TIMEOUT_SEC}s")]
        except (subprocess.SubprocessError, OSError) as e:
            return [self._auditor_unavailable(f"vulture invocation failed: {e}")]

        return self._parse_vulture_output(result.stdout, repo_root)

    def detect_symbol_fabrication(self, changed_files: list[Path]) -> list[Finding]:
        # T2.2 — PyPI registry lookup + inspect introspection
        raise NotImplementedError("T2.2: PyPI symbol fabrication detector not yet implemented")

    def detect_orphan_exports(self, repo_root: Path) -> list[Finding]:
        # T3.1 — shared cross-package wiring (delegates to check_wiring_cross_package.py)
        raise NotImplementedError("T3.1: cross-package wiring detector not yet implemented")

    def detect_mutation_score(self, critical_paths: list[Path]) -> list[Finding]:
        # T4.1 — mutmut wrapper (mutmut 3.x — CLI revalidation note in plan)
        raise NotImplementedError("T4.1: mutmut wrapper not yet implemented")

    # ------------------------------------------------------------------
    # internal helpers
    # ------------------------------------------------------------------

    def _parse_vulture_output(self, stdout: str, repo_root: Path) -> list[Finding]:
        findings: list[Finding] = []
        for line in stdout.splitlines():
            match = _VULTURE_LINE_RE.match(line.strip())
            if not match:
                continue
            try:
                file_rel = self._relativize(Path(match["path"]), repo_root)
            except ValueError:
                continue
            symbol = sanitize_symbol(match["symbol"])
            findings.append(
                Finding(
                    detector="d1_dead_code",
                    language="python",
                    severity="HARD",
                    file_path=file_rel,
                    symbol_or_line=f"{match['symbol']} (line {match['line']})",
                    message=f"Unused {match['kind']} '{match['symbol']}' "
                    f"({match['confidence']}% confidence)",
                    allowlist_key=f"python|{file_rel}|dead_code|{symbol}",
                )
            )
        return findings

    @staticmethod
    def _relativize(path: Path, repo_root: Path) -> str:
        resolved = path.resolve() if path.is_absolute() else (repo_root / path).resolve()
        return resolved.relative_to(repo_root.resolve()).as_posix()

    def _auditor_unavailable(self, reason: str) -> Finding:
        return Finding(
            detector="d1_dead_code",
            language="python",
            severity="SOFT_CAP",
            file_path=".",
            symbol_or_line="vulture",
            message=f"Vulture auditor unavailable: {reason}",
            allowlist_key="python|.|dead_code|auditor_unavailable_vulture",
        )
