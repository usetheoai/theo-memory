"""TypeScript detector — wraps knip (D1) + npm registry lookup (D2) + stryker (D4).

T1.2 implementation: detect_dead_code via knip subprocess.
T2.3 implementation: detect_symbol_fabrication via tree-sitter + npm lookup.
Other methods still stubs (T3.1 / T4.2).
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

from scripts import _registry
from scripts._shared import Finding, safe_parse_json, sanitize_symbol, to_rel_path
from scripts.check_symbol_fab import extract_imports_and_calls

from . import BaseDetector

_TS_NODE_BUILTINS = frozenset(
    {
        "fs", "path", "os", "util", "crypto", "http", "https", "url", "stream",
        "events", "buffer", "child_process", "cluster", "dgram", "dns", "net",
        "querystring", "readline", "tls", "tty", "vm", "zlib", "assert",
        "string_decoder", "process", "module", "perf_hooks", "worker_threads",
        "console", "timers", "domain", "punycode", "v8", "inspector",
    }
)

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

    def _find_self_package_name(self, changed_files: list[Path]) -> str | None:
        """Walk up from any changed file to find the repo's package.json#name.

        Used to skip self-reference imports (`@scope/pkg-name` and its subpaths) when the
        codebase is the package being imported — pre-publication code legitimately self-references
        via workspace links (file:..) before the package ships to the npm registry. Cached on
        the detector instance after first lookup.
        """
        if hasattr(self, "_cached_self_name"):
            return self._cached_self_name
        self._cached_self_name = None
        for src_file in changed_files:
            try:
                cur = src_file.resolve().parent if src_file.exists() else Path.cwd()
            except OSError:
                continue
            for parent in [cur, *cur.parents]:
                pkg_json = parent / "package.json"
                if pkg_json.is_file():
                    try:
                        data = json.loads(pkg_json.read_text(encoding="utf-8"))
                        name = data.get("name")
                        # We want the OUTERMOST (root) name when nested workspaces exist —
                        # keep walking up after finding a name. A demo subdir's package name
                        # is shadowed by the root package's name.
                        if isinstance(name, str) and name:
                            self._cached_self_name = name
                    except (json.JSONDecodeError, OSError):
                        pass
            if self._cached_self_name:
                break
        return self._cached_self_name

    @staticmethod
    def _is_self_reference(module: str, self_name: str | None) -> bool:
        if not self_name:
            return False
        return module == self_name or module.startswith(self_name + "/")

    @staticmethod
    def _is_local_reference(module: str, local_names: set[str]) -> bool:
        """True when `module` is one of the repo's local (workspace) package names or a subpath of one."""
        return any(module == n or module.startswith(n + "/") for n in local_names)

    def _find_workspace_package_names(self, changed_files: list[Path]) -> set[str]:
        """Collect ALL local (unpublished) package names in a pnpm/npm monorepo.

        The original `_find_self_package_name` only recognized ONE self name (the
        outermost root package.json#name), so sibling workspace packages — e.g.
        `@scope/pkg-a` importing `@scope/pkg-b` — were queried against the npm
        registry and flagged HARD 'fabricated'. This walks to the workspace root
        and enumerates every workspace package via (a) the workspace globs declared
        in `pnpm-workspace.yaml` / `package.json#workspaces`, and (b) node_modules
        symlinks that resolve back inside the repo (the authoritative record of
        what pnpm linked). Cached on the instance.
        """
        if hasattr(self, "_cached_ws_names"):
            return self._cached_ws_names
        names: set[str] = set()
        self_name = self._find_self_package_name(changed_files)
        if self_name:
            names.add(self_name)
        repo_root = self._find_repo_root(changed_files)
        if repo_root is not None:
            self._collect_pkg_name(repo_root / "package.json", names)
            for pkg_dir in self._iter_workspace_pkg_dirs(repo_root):
                self._collect_pkg_name(pkg_dir / "package.json", names)
            self._collect_symlinked_local_names(repo_root, names)
        self._cached_ws_names = names
        return names

    def _find_repo_root(self, changed_files: list[Path]) -> Path | None:
        """Walk up to the workspace root (dir with pnpm-workspace.yaml OR package.json#workspaces)."""
        starts: list[Path] = []
        for src_file in changed_files:
            try:
                starts.append(src_file.resolve().parent if src_file.exists() else Path.cwd())
            except OSError:
                continue
        if not starts:
            starts.append(Path.cwd())
        for start in starts:
            for parent in [start, *start.parents]:
                if (parent / "pnpm-workspace.yaml").is_file():
                    return parent
                pkg = parent / "package.json"
                if pkg.is_file():
                    try:
                        if json.loads(pkg.read_text(encoding="utf-8")).get("workspaces"):
                            return parent
                    except (json.JSONDecodeError, OSError):
                        pass
        return None

    @staticmethod
    def _collect_pkg_name(pkg_json: Path, names: set[str]) -> None:
        if pkg_json.is_file():
            try:
                name = json.loads(pkg_json.read_text(encoding="utf-8")).get("name")
                if isinstance(name, str) and name:
                    names.add(name)
            except (json.JSONDecodeError, OSError):
                pass

    def _iter_workspace_pkg_dirs(self, repo_root: Path):
        for pattern in self._read_workspace_globs(repo_root):
            pat = pattern.rstrip("/")
            try:
                for match in repo_root.glob(pat):
                    if match.is_dir():
                        yield match
            except (OSError, ValueError):
                continue

    @staticmethod
    def _read_workspace_globs(repo_root: Path) -> list[str]:
        globs: list[str] = []
        pkg = repo_root / "package.json"
        if pkg.is_file():
            try:
                ws = json.loads(pkg.read_text(encoding="utf-8")).get("workspaces")
                if isinstance(ws, list):
                    globs.extend(g for g in ws if isinstance(g, str))
                elif isinstance(ws, dict) and isinstance(ws.get("packages"), list):
                    globs.extend(g for g in ws["packages"] if isinstance(g, str))
            except (json.JSONDecodeError, OSError):
                pass
        pnpm = repo_root / "pnpm-workspace.yaml"
        if pnpm.is_file():
            try:
                in_packages = False
                for raw in pnpm.read_text(encoding="utf-8").splitlines():
                    line = raw.rstrip()
                    if not line or line.lstrip().startswith("#"):
                        continue
                    if not line.startswith((" ", "\t", "-")):
                        in_packages = line.strip().rstrip(":") == "packages"
                        continue
                    stripped = line.strip()
                    if in_packages and stripped.startswith("-"):
                        val = stripped[1:].strip().strip("'\"")
                        if val:
                            globs.append(val)
            except OSError:
                pass
        return globs

    @staticmethod
    def _collect_symlinked_local_names(repo_root: Path, names: set[str]) -> None:
        nm = repo_root / "node_modules"
        if not nm.is_dir():
            return
        try:
            entries = list(nm.iterdir())
        except OSError:
            return
        root_resolved = repo_root.resolve()
        for entry in entries:
            candidates = []
            try:
                if entry.name.startswith("@") and entry.is_dir() and not entry.is_symlink():
                    candidates = list(entry.iterdir())
                else:
                    candidates = [entry]
            except OSError:
                continue
            for cand in candidates:
                try:
                    if not cand.is_symlink():
                        continue
                    target = cand.resolve()
                    if target == root_resolved or root_resolved in target.parents:
                        TypescriptDetector._collect_pkg_name(target / "package.json", names)
                except OSError:
                    continue

    def detect_symbol_fabrication(self, changed_files: list[Path]) -> list[Finding]:
        """T2.3 — Validate imports against npm. Skip relative + node: builtins + monorepo subpath (EC-16) + self-references (patch 2026-05-30) + sibling workspace packages (patch 2026-06-15)."""
        findings: list[Finding] = []
        local_names = self._find_workspace_package_names(changed_files)
        for src_file in changed_files:
            if not src_file.exists():
                continue
            rel = to_rel_path(src_file)
            for sym in extract_imports_and_calls(src_file, "typescript"):
                if sym.kind != "import":
                    continue
                module = sym.module
                if not module:
                    continue
                # Relative imports
                if module.startswith("./") or module.startswith("../") or module == "." or module == "..":
                    continue
                # Node builtins
                if module.startswith("node:"):
                    continue
                top = module.split("/")[0] if not module.startswith("@") else "/".join(module.split("/")[:2])
                if top in _TS_NODE_BUILTINS:
                    continue
                # Patch 2026-05-30 + 2026-06-15 — Local workspace package (self OR a
                # sibling pnpm/npm workspace package; unpublished, not on the registry).
                if self._is_local_reference(module, local_names):
                    continue
                # Package name for npm lookup
                pkg = module if module.startswith("@") else module.split("/")[0]
                exists = _registry.package_exists_on_npm(pkg)
                if exists is True:
                    continue
                sanitized = sanitize_symbol(pkg)
                if exists is False:
                    findings.append(
                        Finding(
                            detector="d2_symbol_fab",
                            language="typescript",
                            severity="HARD",
                            file_path=rel,
                            symbol_or_line=f"import from '{module}'",
                            message=f"Fabricated npm package '{pkg}' (not found on registry)",
                            allowlist_key=f"typescript|{rel}|symbol_fab|{sanitized}",
                        )
                    )
                else:
                    findings.append(
                        Finding(
                            detector="d2_symbol_fab",
                            language="typescript",
                            severity="SOFT_FLOOR",
                            file_path=rel,
                            symbol_or_line=f"import from '{module}'",
                            message=f"Could not verify npm package '{pkg}' (ambiguous response)",
                            allowlist_key=f"typescript|{rel}|symbol_fab|symbol_fab_unverifiable_{sanitized}",
                        )
                    )
        return findings

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
