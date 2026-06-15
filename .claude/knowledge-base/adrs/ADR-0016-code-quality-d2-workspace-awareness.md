# ADR-0016: `/code-quality` D2 symbol-fabrication recognizes pnpm workspace packages as local

- **Status:** Accepted
- **Date:** 2026-06-15
- **Plan:** [`extract-cli-to-packages-plan.md`](../plans/extract-cli-to-packages-plan.md) (workspace uniformization; this ADR closes a code-quality false-positive the reorg exposed)
- **Owner:** TheMemory `extract-cli-to-packages` cycle (P0 hardening — sub-goals 1 + 2)
- **Sign-off:** Project owner authorization 2026-06-15 via `AskUserQuestion` ("Corrigir o detector D2 (com ADR)")
- **Governs:** [`code-quality-golden-rule.md`](../../rules/code-quality-golden-rule.md) § `symbol_fabrication_{language}`

## Context

The `extract-cli-to-packages` reorg moved the codebase into a pnpm workspace with **four** local packages: `@usetheo/memory` (packages/core), `@usetheo/memory-api` (packages/api), `@usetheo/memory-mcp` (packages/mcp), `@usetheo/memory-cli` (packages/cli). These packages import each other by package name (`import { runMcpServer } from '@usetheo/memory-mcp'`).

`/code-quality`'s D2 symbol-fabrication detector (`detectors/typescript.py`) validates each non-relative import against the **npm registry**. Workspace packages are unpublished (pre-release), so the registry returns "not found" → the detector emitted `Finding(severity=HARD, "Fabricated npm package")` → verdict `FAIL_HARD`. This is a **false positive**: the packages are real, local, and resolved correctly by `tsc` (green typecheck) + 930 passing tests (node_modules/@usetheo/memory-api → ../../packages/api symlinks confirm the workspace links).

The detector already had a `_find_self_package_name` patch (2026-05-30) to skip self-references, but it recognized only **one** name (the outermost root `package.json#name`). In a multi-package workspace it could not see sibling packages, so `@usetheo/memory-api` / `@usetheo/memory-mcp` were flagged.

The allowlist-with-sunset mechanism could only downgrade HARD → SOFT_CAP (cap 70 = `FAIL_SOFT`), still blocking `/review`. The root cause is the detector, not the code.

## Decision

Extend the TypeScript D2 detector to recognize **all** local workspace package names, not just one self name. `detect_symbol_fabrication` now skips any import whose package is a local workspace package or a subpath of one.

Local workspace package names are discovered (cached per run) via:

1. The outermost root `package.json#name` (prior behavior, retained).
2. **Workspace globs** declared in `pnpm-workspace.yaml` (`packages:` list) and/or `package.json#workspaces` — each matched `*/package.json#name` is collected.
3. **node_modules symlinks** that resolve back inside the repo (the authoritative record of what the package manager linked) — each symlinked package's `package.json#name` is collected.

The check is `module === name || module.startsWith(name + '/')`, so subpath exports (`@usetheo/memory/contract`, `@usetheo/memory/embedders/local`, …) are covered.

This **does not soften** fabrication detection: a genuinely fabricated package (`doesnotexist-xyz-123`) is still flagged HARD (pinned by `test_typescript_symbol_fab_flags_fabricated_package`). It removes a false-positive class only.

## Alternatives considered

- **Allowlist the workspace packages (rejected).** Allowlisting a HARD finding downgrades to SOFT_CAP (cap 70), so the verdict stays `FAIL_SOFT` — it cannot reach PASS. It also masks the real detector gap and the sunset would expire, re-firing the false positive. Allowlist is for genuine known-debt, not redundant suppression.
- **`--no-network` (rejected).** Disables D2 entirely (single INFO per language), losing real fabrication detection across the whole repo to suppress a localized false positive. Disproportionate.
- **Re-classify @xenova/openai etc. (n/a).** Those are real optional deps, unrelated to this workspace-name issue.

## Consequences

- D2 verdict for `extract-cli-to-packages`: `FAIL_HARD` → **PASS** (0 findings), with no loss of real fabrication coverage.
- The three stopgap allowlist entries added during triage (`@usetheo/memory-api`, `@usetheo/memory-mcp`, `@usetheo/memory/*`) are **removed** as redundant; the detector now skips them natively. The `@modelcontextprotocol/sdk/*` entry (a real EXTERNAL package whose nested subpath exports the registry-root check cannot verify) is retained, broadened to the reorganized `tests/**` + `scripts/**` paths.
- Regression guard: `test_typescript_symbol_fab_skips_pnpm_workspace_packages` (sibling-package import must NOT query the registry).
- Stable identifier `symbol_fabrication_typescript` is UNCHANGED. No enforcement was weakened; a false-positive source was corrected.

## Rollback

Revert the `detectors/typescript.py` change (the `_find_workspace_package_names` + `_is_local_reference` methods) and its test; the detector reverts to single-self-name behavior. Re-add the workspace allowlist entries if a stopgap is needed.
