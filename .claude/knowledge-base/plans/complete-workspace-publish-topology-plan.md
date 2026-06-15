---
slug: complete-workspace-publish-topology
created_at: 2026-06-15
goal: Restore a correct, test-gated publish topology for @usetheo/memory after the workspace reorg
status: IN PROGRESS — D1 resolved (src-only); T1+T2 done; remaining blocked on ADR D2 (bin)
---

## Progress (2026-06-15)

- **ADR D1 RESOLVED → D1-a (src-only)** by owner decision. Applied: `packages/core/package.json#files` = src-only allow-list + `publish:check` script (commit `7cc6897`).
- **T1 + T2 DONE** — `tests/integration/publish-readiness.test.ts` retargeted to `packages/core` (the only publishable package), `npm pack` cwd=packages/core (clean JSON), EXACT files assertions restored (closes F-tests-1 BLOCKER + F-tests-2 HIGH). **7/7 GREEN.**
- **REMAINING (blocked on ADR D2 — bin location):** 3 sibling pack tests still pack `REPO_ROOT` (the private `theo-memory-workspace`) and assert `@usetheo/memory` shape + bin resolution — pre-existing reorg debt of the SAME class, surfaced during T1: `tests/integration/p0-audit/pack-manifest.test.ts` (asserts bin, line ~103), `full-public-surface.test.ts`, `subpath-smoke-import.test.ts`. They need the same retarget to `packages/core` AND the D2 bin decision (pack-manifest asserts `npx @usetheo/memory` resolves the `themory` bin — with src-only, does the published package carry a bin, or is the CLI a Docker-only concern?).
- **ADR D2 RESOLVED → D2-a (no npm bin; CLI via Docker)** by owner. Applied: bin assertions removed from the pack tests.
- **T1 fully DONE** — all 3 npm-pack tests retargeted to `packages/core` (cwd), package-relative paths, bin assertions removed: `publish-readiness` (7/7), `pack-manifest` (8/8, commit `0d9cdf4`), `full-public-surface` pack block (commit `0d9cdf4`). `subpath-smoke-import` was already correct (static analysis, no root pack).
- **NEWLY-SURFACED pre-existing debt** (unmasked when T1 fixed full-public-surface's describe-level pack throw — these never ran before; both OUT of publish-topology scope, `test.skip`'d with rationale, need OWNER decisions):
  - **API-surface drift:** root barrel `packages/core/src/index.ts` ships 9 export statements; the T0.1 baseline test asserts 8. Decision: is the 9th export intended (refresh baseline → 9) or accidental (remove)?
  - **Paper-name policy vs vendor adapters:** `Mem0` has 22 hits in `src/`, all legitimate v0.9 benchmark VENDOR adapters (`benchmarks/mem0/`: `Mem0BenchmarkAdapter`, `Mem0VendorClient`) + 1 JSDoc `@see`. The other 4 paper-names (Voyager/Letta/LangMem/Graphiti) are 0. Decision: exempt `benchmarks/`/vendor dirs from `no-paper-names-in-code.md`, OR rename.
- **ADR D3 RESOLVED → leaf package** (owner decision 2026-06-15). **T4 DONE** (commit `f9d831e`): extracted the 5 shared modules (scope, agent-tools-memory, oidc-cli-resolver, error-classifier, types) + 4 tests from `packages/cli` to a new leaf `@usetheo/memory-agent-core` (deps: `@usetheo/memory` + pg + zod only). cli (6 files) + mcp (9 files) migrated to import the leaf; workspace deps + per-package symlinks created; all shims updated (tsconfig paths/include, 2 vitest aliases + contract include, eslint globs, lint script, rewrite-dist-aliases). **cli↔mcp cycle ELIMINATED** (mcp imports the leaf, not cli; confirmed mcp imports no cli). `@usetheo/memory/agent-tools` REDEFINED to `@usetheo/memory-agent-core` (pre-release breaking). GREEN: typecheck, lint, contract 930/932, build + env-free `themory --help`, integration agent-tools 11/11.
- **STATUS: substantially complete.** Only the 2 unmasked pre-existing decisions remain (export-count baseline 8→9; Mem0 paper-name vs vendor adapters), both `test.skip`'d pending owner decisions — NOT publish-topology blockers.

# Plan: Complete Workspace Publish Topology

> **Follow-up to `extract-cli-to-packages`.** Closes the 3 carved-out `/review` findings (2026-06-15) that are pre-existing `standardize-project-structure` reorg debt: the publishable package `@usetheo/memory` (packages/core) has no `files` allow-list, no `themory` bin, and cannot ship the root `dist/`; the `publish-readiness.test.ts` gate is RED (5/7); and `@usetheo/memory/agent-tools` is a phantom subpath. **Pure hardening (P0 sub-goal 2 — SDK functional). Zero new feature.**
>
> **STATUS: DRAFT.** Two ADRs (D1 build topology, D2 bin location) require an explicit owner decision before `/implement`. This plan FRAMES the decision with evidence + alternatives; it does NOT pre-decide.

## Goal

> "Make `npm pack @usetheo/memory` ship a working, bin-carrying, test-correct artifact, measured by `tests/integration/publish-readiness.test.ts` 7/7 GREEN (retargeted to the publishable package) and a post-install smoke that `npx @usetheo/memory ...` resolves the `themory` bin."

## Context

The `standardize-project-structure` reorg (commits `ab62443..1827fbe`) split the monolith into 4 workspace packages and the `extract-cli-to-packages` slice moved the CLI to `packages/cli`. The `/review` of the latter (2026-06-15, report `reviews/extract-cli-to-packages-review-2026-06-15.md`) found the **publish topology was left half-migrated**. Per owner decision (2026-06-15, "separate"), these were carved out of the build-fix slice into this follow-up.

## Baseline Context (deep review of current state)

### Evidence

| Fact | Value | Source |
|---|---|---|
| Publishable package | ONLY `@usetheo/memory` (packages/core). api/mcp/cli are all `private:true` | `packages/*/package.json` |
| `packages/core/package.json#files` | **absent** (publishes npm-default = everything not gitignored) | `packages/core/package.json` |
| `packages/core/package.json#bin` | **absent** — the `themory` bin lives in the PRIVATE root `theo-memory-workspace` | `package.json#bin` vs `packages/core` |
| `packages/core#exports` | 11 subpaths, all → `./src/*.ts` (TS source) | `packages/core/package.json` |
| Build output | single ROOT `dist/` (`dist/core/src`, `dist/mcp/src`, `dist/agent-tools`) — NO per-package `dist/` | `pnpm build` + `dist/` |
| Per-package build scripts | none (only root `build`) | `packages/*/package.json#scripts` |
| Pre-reorg intended `files` (commit `ab62443`) | shipped BOTH `src/**/*.ts` AND `dist/**/*.js`/`.d.ts`/`.sql` | `git show ab62443:package.json` |
| npm constraint | `files` CANNOT reference paths outside the package dir; packages/core cannot ship the repo-root `dist/` | npm docs |
| `publish-readiness.test.ts` | RED 5/7 — reads the private root package.json; npm-pack JSON parse breaks on stdout log noise | review F-tests-1/2 |
| `@usetheo/memory/agent-tools` | phantom: 11 `packages/mcp` importers resolve it via 3 build-time shims (vitest alias + tsconfig + dist rewrite), NOT Node `exports` | review F-dom-cli-1 |

### The core tension

The pre-reorg package shipped **src + dist** from a single root package. After the reorg, the publishable `packages/core` (a) has no `files`/`bin`, and (b) **cannot reach the root `dist/`** via npm `files`. So shipping compiled output requires a build-topology decision.

## ADRs (require owner decision before /implement)

### ADR D1 — Build topology for the publishable package (OWNER DECISION REQUIRED)

**Decision:** How does `@usetheo/memory` ship compiled output?

| Alt | Approach | Pros | Cons |
|---|---|---|---|
| **D1-a (recommended)** | Ship **src-only** (`files: ['src/**/*.ts', '!**/__tests__/**', '!**/*.test*.ts', 'src/infrastructure/db/migrations/**', 'README.md']`); `exports` stay `./src/*.ts`; consumers compile (matches current dev resolution). | Smallest change; matches what `exports` already declare; no per-package build needed; consistent with "pre-release, exports→src". | Consumers must run TS; no shipped `.js`/`.d.ts`; the `themory` bin (compiled) needs a separate answer (see D2). |
| **D1-b** | **Per-package build** — each package gets a `build` → its own `packages/X/dist/`; `exports`+`files`+`bin` point to local `./dist`. | True publishable artifacts; bin ships compiled; matches the pre-reorg src+dist intent. | Larger change: 4 build scripts, per-package tsconfig, retire the root-`dist` + alias-rewrite scheme; the build-fix slice's `rewrite-dist-aliases` becomes obsolete. |
| **D1-c** | **Root build + `prepack` copy** — a `prepack` step copies the relevant `dist/core/**` into `packages/core/dist/` before pack. | Keeps the single root build; ships dist. | A second source of truth for dist layout; fragile copy step; npm pack ordering edge cases. |

Recommendation: **D1-a (src-only)** for the pre-release stage (lowest risk, matches `exports`), revisiting D1-b at v1.0 when compiled artifacts matter. Owner confirms.

### ADR D2 — Where the `themory` bin lives in the published package (OWNER DECISION REQUIRED, depends on D1)

The `themory` bin currently points at `./dist/agent-tools/cli.js` from the PRIVATE root. The published `@usetheo/memory` has no bin. Options: (D2-a) move the bin to `packages/core/package.json#bin` pointing at the cli entry shipped within core; (D2-b) publish `@usetheo/memory-cli` as a second public package carrying the bin; (D2-c) src-only + a `bin` shim that runs the TS entry via a thin JS loader. Coupled to D1.

### ADR D3 — Resolve the phantom `@usetheo/memory/agent-tools` subpath

| Alt | Approach |
|---|---|
| **D3-a (recommended)** | Migrate the 11 `packages/mcp` importers from `@usetheo/memory/agent-tools` to `@usetheo/memory-cli` + add `"@usetheo/memory-cli": "workspace:*"` to `packages/mcp/package.json`. Also breaks the `cli↔mcp` cycle if shared helpers move to a leaf. |
| **D3-b** | Add an `./agent-tools` entry to `packages/core/package.json#exports` pointing into the cli package (keeps the subpath name, but core exporting cli code is a layering smell). |

## Tasks (TDD; finalized AFTER D1/D2 picked)

- **T1 — Retarget `publish-readiness.test.ts` (RED→GREEN).** Point at the publishable `packages/core/package.json`; run `npm pack --dry-run --json` in `packages/core` (cwd); make JSON parse robust to stdout log noise (parse last JSON array, or `--silent`); restore EXACT-match `files` assertions (close F-tests-2) for the chosen D1 layout. RED: the 5 failing assertions; GREEN: 7/7 after the package config lands.
- **T2 — Apply D1 (`files` + build topology).** Add `packages/core/package.json#files` per the chosen alt; add per-package build if D1-b. Acceptance: `npm pack --dry-run` ships src/migrations, excludes tests.
- **T3 — Apply D2 (bin).** Wire the `themory` bin into the publishable surface; post-install smoke: `npx @usetheo/memory --help` exits 0.
- **T4 — Apply D3 (phantom subpath).** Migrate the 11 mcp importers; retire the corresponding alias-rewrite/tsconfig/vitest shim entries that are no longer needed.
- **T5 — Re-run full integration suite vs real pgvector** + `/code-quality` + `/review` re-gate. The build-fix slice's `rewrite-dist-aliases` may be retired (D1-b) or retained (D1-a) — decide in T4.

## Coverage Matrix

| Carved-out finding | Task |
|---|---|
| F-tests-1 (publish-readiness RED) | T1 + T2 + T3 |
| F-tests-2 (weakened files assertion) | T1 |
| F-dom-cli-1 (phantom subpath + cli↔mcp cycle) | T4 |

## Drawbacks & Risks

- **D1-b is a large change** that obsoletes this session's `rewrite-dist-aliases` — risk of churn if chosen. Mitigation: prefer D1-a for pre-release.
- **Publish smoke needs a real `npm pack`/install** — slow + environment-sensitive (the existing test already hits npm). Mitigation: gate behind CI with a robust JSON parse.
- **Owner unavailable** → plan stays DRAFT; the red `publish-readiness` test remains documented debt (it does not block the build-fix slice, only a clean publish).

## Unresolved Questions

1. **(BLOCKER for /implement)** D1: does `@usetheo/memory` ship `src` or `dist`? Recommendation D1-a (src). Owner decides.
2. D2: where does the `themory` bin live post-decision? Coupled to D1.
3. Should api/mcp/cli ever become public packages, or stay private internals bundled conceptually under `@usetheo/memory`? (Affects D3.)

## Global Definition of Done

- [ ] D1 + D2 ADRs resolved by owner (recorded in this plan + an ADR file).
- [ ] `publish-readiness.test.ts` 7/7 GREEN, retargeted to the publishable package, exact assertions restored.
- [ ] `npx @usetheo/memory --help` smoke GREEN (bin resolves).
- [ ] Phantom subpath resolved; shims retired or justified.
- [ ] `pnpm test` (contract) + full integration vs pgvector + `/code-quality` PASS; `/review` re-gate READY_TO_MERGE.
- [ ] CHANGELOG updated; plan archived to `plans/completed/`.
