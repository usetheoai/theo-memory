# Plan: p0-api-sdk-mcp-correctness-audit — close PRIORITY 0 sub-goals 1+2+3 (APIs, SDKs, MCP)

> **Version 1.1** (2026-06-04) — Absorbs `/edge-case-plan p0-api-sdk-mcp-correctness-audit` (2026-06-04) report. **4 `MUST FIX` absorbed**: EC-1 (NEW `## Dependencies` section between Context and ADRs — cycle-plan.md v1.1 hard gate); EC-2 (T3.2 Files to edit + Acceptance Criteria extended to update `tests/integration/docker-stack.test.ts` injection of `OPENAI_API_KEY=fake-test-key` OR `describe.skipIf` pattern so REST stub removal does not break the pre-existing green suite); EC-3 (T3.3 RED tests preceded by `beforeAll` skip checks for `dist/agent-tools/cli.js` existence AND `process.env.OPENAI_API_KEY` + `THEOMEM_PG_URI` presence — closes ENOENT-cryptic-CI-failure mode); EC-4 (T0.2 ast-grep patterns expanded from 1 to 3 — `export { $$NAMES }`, `export type { $$NAMES }`, `export * from $SPEC` — with recursive walk on re-export targets; without this the matrix undercounts and THE GOAL TEST 49-export count fails). **6 `SHOULD TEST` absorbed inline** in TDD blocks: EC-5 (T1.3 grep pattern widened from `: any\b|as any\b` to `\bany\b` with explicit allowlist — catches `Array<any>`, `Promise<any>`, `Record<string, any>`); EC-6 (T2.1 subtest for `./embedders/local` AND `./embedders/openai` AND `./llms/openai` MUST `describe.skipIf(!isXenovaInstalled() && !isOpenAIInstalled())` per optionalDependencies precedent); EC-7 (T2.2 walk explicitly RECURSIVE through transitive imports until fixed-point — depth-1 walk is insufficient); EC-8 (T3.1 regression test against StubLLM for `src/core/reflection/prompt.ts` rename — prompt text changes must be SHAPE-stable on stub output); EC-9 (T3.3 child_process JSON-RPC over stdio uses `readline.createInterface` for line-delimited parsing, NOT raw `Buffer.toString()` concat); EC-10 (T4.1 81 assertions organized in 6 `describe` blocks per sub-goal for failure attribution). **4 `DOCUMENT` absorbed**: EC-11 (T0.1 script header comment notes GNU grep dependency — project primary dev OS is Linux per CLAUDE.md); EC-12 (T2.3 test file header records `npm --version` at audit time + uses tolerant `toBeGreaterThan(N)` assertions); EC-13 (T1.1 `@see` reference acceptance widened — exports pre-dating plans MAY reference ADR-0001 or `CLAUDE.md § Locked names` instead of a plan slug); EC-14 (T2.1 test file header documents subpath resolution path — relative imports `import('../../src/{subpath}/index.js')` validate SOURCE; post-`npm pack` extract validates `exports` MAP at install time). **Scorer false-positive precaution**: zero retrospective `T{N}.{M}` references to other plans introduced — orphan-task regex clean.
>
> **Version 1.0** (2026-06-04) — First plan authored after the `/dogfood` gate cleared this session (ADR-0012, commit `3767e69`). Closes the remaining 3 PRIORITY 0 sub-goals (CLAUDE.md § PRIORITY 0 — HARDENING, locked 2026-06-04) in a single coherent cycle: (1) APIs corretas — every public export documented + cross-referenced + contract-tested; (2) SDKs 100% funcionais — every `package.json#exports` subpath smoke-imports + bundle isolation gates pass + `npm pack --dry-run` ships every needed file; (3) MCP server available + reliable — `themory mcp` boots from the `dist/` artifact and responds to MCP `tools/list` via stdio. Out-of-scope: P0.2 (independent benchmark reproduction, Roadmap Item 11) — calendar-locked on external reproducer recruitment, tracked separately. Per CLAUDE.md § PRIORITY 0, this plan IS the hardening surface; it does NOT introduce new features. Inquebrável Rule 11 (YAGNI) ceiling: every task closes a documented gap, no speculative additions. Inquebrável Rule 3 (extreme honesty): npm publish itself is DEFERRED to a separate sign-off moment AFTER this audit cycle clears — this plan validates the package is publish-ready, not publishes it.

## Goal

> "Enable safe pre-release publish of `@usetheo/memory` so that `tests/integration/p0-audit/full-public-surface.test.ts` reaches ≥ 30 assertions PASS — covering 13 subpath smoke imports, default-barrel bundle isolation against 9 subpath impl files, zero paper-name violations in `src/**/*.ts`, and `themory mcp` CLI stdio boot from `dist/` — measured by `npm test -- tests/integration/p0-audit/` exit code 0."

## Context

### What exists today

Per CLAUDE.md § PRIORITY 0 (locked 2026-06-04 with GO-TO CTO sign-off), the production-ready label is blocked by 3 sub-goals plus the parallel benchmark reproduction gate. `/dogfood` cleared in this session via ADR-0012 (commit `3767e69`). The 3 P0 sub-goals remain open as documented audit deliverables, with no systematic prior closure. Empirical state captured 2026-06-04 prior to this plan:

#### Public surface inventory (read 2026-06-04)

- `src/index.ts` declares **8 root exports** (verified via `grep -cE '^export ' src/index.ts`).
- `src/core/index.ts` declares **41 contract exports** (verified via `grep -cE '^export ' src/core/index.ts`).
- `package.json#exports` declares **13 subpaths**: `.`, `./agent-tools`, `./cache-pg`, `./contract`, `./embedders`, `./embedders/{local,openai,stub}`, `./llms`, `./llms/{openai,stub}`, `./server`, `./theokit`.
- `package.json#bin` declares **2 binaries**: `themory` + `themory-mcp` (alias) → `./dist/agent-tools/cli.js`. CLI has 4 subcommands: `mcp`, `server`, `migrate`, `health`.
- `package.json#files` declares: `src/**/*.ts` minus `__tests__/**`, `*.test.ts`, `*.test-d.ts`, plus `src/local/migrations/**`. `dist/**` is consumed only by the bin entries; published artifact is source-only (consumer compiles).

#### Existing audit coverage (partial)

`tests/integration/subpath-isolation.test.ts` ships **11 tests** today, but coverage is asymmetric:

- Bundle isolation gates ship for `./server` (per prior `theo-memory-standalone-p0` cycle EC-26) + `./cache-pg` (per prior `semantic-recall-cache-v1-5` cycle) — **2 of 9** subpath impl files audited.
- `npm pack` manifest assertions ship for the same 2 subpaths only.
- Remaining 7 subpaths (`./agent-tools`, `./embedders`, `./embedders/{local,openai,stub}`, `./llms`, `./llms/{openai,stub}`, `./theokit`) have NO bundle-isolation test, NO pack-manifest assertion, NO smoke-import gate.

#### Paper-name violations (`no-paper-names-in-code.md` rule)

Strict grep (excluding `.claude/knowledge-base/` references, which the rule allows) reveals **74 violations across `src/**/*.ts`**:

- `Mem0`: 56 lines (highest density)
- `Letta`: 9 lines
- `LangMem`: 4 lines
- `Graphiti`: 4 lines
- `Voyager`: 1 line

Sample violations: JSDoc references like `* @see Mem0 blueprint Q5`, error messages like `'memoryId xxx not found (EC-12: divergence from Mem0)'`, code comments like `// Mem0 parity`. Per the rule, these MUST be replaced with neutral wording in `src/**` and tests; knowledge-base docs MAY cite the paper names directly.

#### REST server (`run-server.ts`) stub state

`src/agent-tools/run-server.ts` still imports + wires `DeterministicStubEmbedder` + `StubLLM` as defaults — empirically verified via `grep "Stub" src/agent-tools/run-server.ts`. The REST server is the sibling of the MCP server (`run-mcp-server.ts`) which was hardened in commit `e43d801` of this session. The FOLLOW-UP comment at line 110-118 of `run-server.ts` explicitly cites this as deferred work. Per CLAUDE.md PRIORITY 0 sub-goal 2 ("SDKs 100% funcionais"), shipping with `StubLLM` in production paths violates the bar.

#### README MCP setup guide currency

`README.md` lines 191-275 document the MCP setup, but a SECTION at line 273 explicitly states *"Wiring real providers (alpha default uses stubs)"* — referring to BOTH `themory server` and `themory mcp`. With `themory mcp` now using real providers post-`e43d801`, that paragraph is empirically wrong for the MCP path.

### What's missing or broken (concretely)

1. **Public-export documentation gap** — no enumeration confirms each of the 8+41 = 49 exports has JSDoc + `@see` cross-reference to its source plan/ADR. Per CLAUDE.md PRIORITY 0 sub-goal 1: "every public export has a `@see` cross-ref to the plan/blueprint that introduced it". Manual audit needed.
2. **Subpath smoke-import coverage** — only `./server` + `./cache-pg` are smoke-tested. The other 11 subpaths have NO regression sentinel for "importing this resolves to working code".
3. **Bundle isolation gates incomplete** — same 11 subpaths NOT verified to be excluded from the default barrel's static-import walk.
4. **`npm pack` manifest assertions incomplete** — same 11 subpaths NOT verified to ship via `npm pack --dry-run` and NOT verified to EXCLUDE `__tests__/**`.
5. **74 paper-name violations in `src/**/*.ts`** — fails `no-paper-names-in-code.md` rule. Sample classifications: JSDoc references citing paper names instead of knowledge-base coordinates; error messages naming source paper instead of describing BEHAVIOR; code comments naming inspiring paper instead of describing WHAT the code does.
6. **REST server (`run-server.ts`) still uses stubs** — `DeterministicStubEmbedder` + `StubLLM` wired by default. MCP equivalent fix shipped in `e43d801`; REST sibling needs same treatment.
7. **MCP CLI dist-artifact boot test missing** — there is no regression sentinel asserting `node dist/agent-tools/cli.js mcp` boots successfully + responds to `tools/list`. Today's session validated MCP works via Claude Code, but that's not a CI-reproducible gate.
8. **README MCP setup guide stale** — the "alpha default uses stubs" disclaimer now ONLY applies to `themory server` (REST), not `themory mcp` (MCP). Needs surgical edit + verification that the consumer-facing setup recipe is reproducible by a third-party reader.

### Evidence motivating NOW (not later)

- **CLAUDE.md § PRIORITY 0 (locked 2026-06-04)** is the source of truth: "Stop shipping new features. The only work that ships from this date forward is HARDENING." This plan IS hardening.
- **`/dogfood` cleared THIS session** (ADR-0012, commit `3767e69`). The dogfood-side blocker is gone. The remaining v1.0 blockers are the parallel sub-goals 1+2+3 in this plan PLUS Item 11 (benchmark reproduction, out of scope).
- **MCP wiring was VALIDATED end-to-end this session** with real Claude Code session → real OpenRouter LLM → real Xenova MiniLM embedder → 4 facts extracted into pgvector. The success exposes the gap: the validation was AD-HOC, not encoded as a regression test. Without a CI sentinel, a future commit to `run-mcp-server.ts` could break the boot path silently.
- **`/dogfood` evidence file at `2026-06-04-anchor-claude-code-real-providers-wired.md` § DX pains` documents 3 concrete pains** surfaced during the live validation — those pains map directly to gaps this plan closes (config discoverability, scope binding indirection, schema dim coupling).
- **The fixes are mostly mechanical**: paper-name remediation is grep + sed-aware edits (74 lines); subpath smoke + bundle isolation tests follow an existing pattern (extend `subpath-isolation.test.ts`); REST stub removal is a verbatim port of `e43d801` MCP fix. Total budget estimate: ~400 LoC across ~12-15 files. Under `architecture.md § Module hygiene` 500 LoC per-file budget; no new modules.
- **No new DIPs, no new dependencies, no contract-shape break.** Per Inquebrável Rule 11 (YAGNI).

## Dependencies

> **EC-1 absorption (cycle-plan.md v1.1 hard gate).** Per `deps-audit-golden-rule.md` § "The Rule", every plan declares its dependency surface explicitly. The plan introduces **zero new runtime or optional dependencies** (Inquebrável Rule 11 YAGNI ceiling). All work uses existing tooling already declared in `package.json`. The tables below capture the consumed surface.

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `@modelcontextprotocol/sdk` | `^1.29.0` | npm runtime | T3.3 MCP CLI boot test sends JSON-RPC `tools/list` via this SDK's stdio transport (same surface used by `dist/agent-tools/cli.js`) |
| `pg` | `^8.13.0` | npm runtime | T3.2 REST stub removal preserves existing `Pool` usage; tests against real pgvector continue |
| `commander` | `^12.1.0` | npm runtime | T3.3 boot test exercises the CLI router; no version change |
| `vitest` | dev dep (latest 3.x) | npm dev | All new `tests/integration/p0-audit/**/*.test.ts` use existing vitest config (`vitest.integration.config.ts` glob already includes the new subdir) |
| `@xenova/transformers` | `^2.17.2` (optional) | npm optional | T3.2 REST + T2.1 `./embedders/local` smoke import; both gracefully skip when absent via EC-6 absorption |
| `openai` | `^4.77.0` (optional) | npm optional | T3.2 REST + T2.1 `./embedders/openai` + `./llms/openai` smoke imports; same skip-when-absent pattern |
| `python3` | system tool (3.11+) | n/a | T0.2 `scripts/audit/public-export-matrix.py` runs Python for ast-grep orchestration; documented in script shebang |
| `ast-grep` (`sg` bin) | external CLI (latest) | n/a | T0.2 ast-grep patterns for `export {...}` extraction; falls back to regex if absent per script header |
| `npm` CLI | latest | system | T2.3 invokes `npm pack --dry-run --json`; EC-12 absorption documents version-tolerance |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale (libs evaluated) | Why this one |
|---|---|---|---|---|
| (none) | — | — | Per Inquebrável Rule 11 (YAGNI), this audit cycle introduces ZERO new dependencies. Every check leverages existing tooling. | n/a |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | — | T3.2 REST stub removal touches IMPORTS within `src/agent-tools/run-server.ts` but does NOT remove `pg` / `@modelcontextprotocol/sdk` / `commander` from package.json — the unused-by-REST `StubLLM` + `DeterministicStubEmbedder` classes REMAIN in `src/local/stubs.ts` + `src/embedders/stub.ts` because they are still consumed by test fixtures via `@usetheo/memory/embedders/stub` + `@usetheo/memory/llms/stub` subpaths. No package.json line removed. |

## Objective

- [ ] Sub-goal 1 — **APIs correctness**: every export in `src/index.ts` (8) + `src/core/index.ts` (41) has JSDoc with `@see` cross-reference + at least one contract test exercising the export. Zero `any` in public surface (verify + sentinel).
- [ ] Sub-goal 2 — **SDKs functional**: 13 subpaths smoke-import; default barrel bundle isolation verified against 9 subpath impl files (`./agent-tools`, `./cache-pg`, `./embedders`, `./embedders/{local,openai,stub}`, `./llms`, `./llms/{openai,stub}`, `./server`, `./theokit`); `npm pack --dry-run` ships 100% of `files:` globs and EXCLUDES 100% of `__tests__/**` paths.
- [ ] Sub-goal 3 — **Paper-name policy compliance**: 0 violations in `src/**/*.ts` per `no-paper-names-in-code.md` (down from 74 lines across 5 paper-name tokens).
- [ ] Sub-goal 4 — **MCP availability**: `themory mcp` CLI boots from compiled `dist/` artifact + responds to MCP `tools/list` over stdio with all 4 verbs (`remember`, `recall`, `forget`, `reflect`) registered. README MCP setup section currency-checked post-`e43d801`.
- [ ] Sub-goal 5 — **REST stub removal**: `src/agent-tools/run-server.ts` mirrors `run-mcp-server.ts` provider wiring (real `LocalTransformerEmbedder` + `OpenAILLM`, hard-fail on missing `OPENAI_API_KEY`, no stubs in production code path).

## ADRs

### D1 — Single mega-plan vs split into 3-4 separate plans

**Decision:** ONE mega-plan covering all 3 P0 sub-goals + P1.3 REST stub removal.

**Rationale:** Phase T0 enumeration produces a single audit matrix consumed by Phases T1+T2+T3. Splitting into 3 plans would duplicate Phase T0 three times. Shared discovery work, shared file inventory, shared test infrastructure (extend `subpath-isolation.test.ts` rather than create 3 sibling files). Sub-goals are interdependent: bundle isolation tests (sub-goal 2) require the subpath enumeration from sub-goal 1's matrix. The user explicitly authorized "all in one plan" in session conversation.

**Alternatives considered:**
- Split into `(a) p0-api-correctness-audit` + `(b) p0-sdk-functional-audit` + `(c) p0-mcp-availability-audit` (rejected: 3× Phase T0 enumeration overhead; shared test file would still need coordination across 3 plans).
- Hybrid: do just sub-goal 2 first (SDK audit) which is the minimum for pre-release publish, defer sub-goals 1+3+4+5 (rejected by user reasoning: full audit before publish is the safer path).

**Consequences:**
- Larger plan (5 phases, ~14-16 tasks); /implement halt-loop ~50-80 iterations.
- Single coverage matrix easier to track end-to-end.
- All audit work lands as a coherent commit chain on `develop`.
- Risk: if /plan-confidence INVALID due to Coverage Matrix scope, /plan-improve cycle adds 2-3 iterations; falls back to split if no convergence (Stop Condition #1).

### D2 — Test path placement: `tests/integration/p0-audit/` vs extending `tests/integration/subpath-isolation.test.ts`

**Decision:** NEW directory `tests/integration/p0-audit/` housing the THE GOAL TEST + supporting sibling tests; the existing `tests/integration/subpath-isolation.test.ts` STAYS (refactor out of scope — it's already integrated with `subpath-isolation` semantics from prior cycles).

**Rationale:** Per `vitest.integration.config.ts` include glob (`tests/integration/**/*.test.ts`), any subdirectory is reachable. Co-locating the P0 audit suite under `tests/integration/p0-audit/` makes the cycle's deliverable distinct and rotatable (per `audit-trail-rotation.md` semantics — audit artifacts could move to `_archive/` long after the plan is merged). Avoids polluting `subpath-isolation.test.ts` which already has 11 tests; growth to ~30 tests there would push file size past readability.

**Alternatives considered:**
- Extend `subpath-isolation.test.ts` to ~30 tests (rejected: file size, cross-cycle archaeology harder).
- One test file per subpath, e.g., `tests/integration/p0-audit/subpath-agent-tools.test.ts` etc. (rejected as YAGNI; one matrix file is sufficient for a single THE GOAL TEST).

**Consequences:**
- New directory needs zero config update (`vitest.integration.config.ts` glob already includes it).
- Future cycles can add files to `p0-audit/` for follow-up audits without contaminating sibling test directories.
- Pre-flight path validation: confirmed `vitest.integration.config.ts` include `tests/integration/**/*.test.ts` matches.

### D3 — REST server provider wiring strategy: match MCP exactly vs softer fallback

**Decision:** Verbatim port of the MCP fix (`e43d801`) to `run-server.ts`. Hard-fail on missing `OPENAI_API_KEY`; wire `LocalTransformerEmbedder` (384-dim, no API key) + `OpenAILLM` (OpenAI-compatible via `OPENAI_BASE_URL`); identical 3-line stderr "real providers wired" disclosure; remove the `DeterministicStubEmbedder` + `StubLLM` imports.

**Rationale:** Consistency. Two startup paths (`themory server` REST + `themory mcp` MCP) sharing the SAME provider-wiring discipline minimizes cognitive load for operators. Inquebrável Rule 3 (extreme honesty): the current "alpha default uses stubs" message at line 273 of README is increasingly dishonest as the MCP path no longer uses stubs. Closing the REST path matches the README into truth. Per the FOLLOW-UP comment at `run-server.ts:97-103`, this work was explicitly anticipated.

**Alternatives considered:**
- Keep `StubLLM` as default + add `--embedder` / `--llm` CLI flags (rejected: introduces new CLI surface area; new flag is a feature; PRIORITY 0 freezes new features).
- Add an env-var switch `THEMEMORY_REST_USE_STUBS=1` for backward-compat (rejected: silent fallback violates Inquebrável Rule 3; ops must explicitly know which providers they are running).

**Consequences:**
- Tightens the REST contract symmetrically with MCP.
- One regression test sentinel in `run-server.test.ts` to assert the production path no longer imports `Stub*`.
- README line 273 updated from "Both `themory server` (REST) and `themory mcp` (MCP) wire ... by default" to honest current state.

### D4 — Paper-name remediation strategy: mechanical replace vs per-file judgment

**Decision:** **Per-file judgment** with mechanical assist. For each of the 74 lines, classify into one of three categories:
- **(a) JSDoc `@see` reference** → replace `* @see Mem0 blueprint Q5` with `* @see .claude/knowledge-base/discoveries/blueprints/{slug}-blueprint.md § Q5` (filesystem coordinate).
- **(b) Behavioral description** → reword to describe WHAT the code does, not which paper. Example: `// Mem0 parity` → `// 9-step retrieval pipeline (semantic + BM25 + entity boost + threshold gate + topK truncation)`.
- **(c) Error message containing paper name** → reword to describe the BEHAVIOR. Example: `'memoryId xxx not found (EC-12: divergence from Mem0)'` → `'memoryId xxx not found (per EC-12 contract: not-found returns error, not silent no-op)'`.

**Rationale:** Mechanical sed would produce incoherent output. JSDoc references that point to internal blueprints can use filesystem coordinates; behavioral comments need NEW prose; error messages need a non-paper rationale that survives a future reader who has no paper context. Per `no-paper-names-in-code.md` rule body: "Neutral wording — `supersession chain`, `code-as-skill payload`, `consolidation orchestrator`, `4-phase Orient-Gather-Consolidate-Report` — describes what the code DOES without claiming what it IS."

**Alternatives considered:**
- Single-pass sed replace `Mem0` → `the source pattern` (rejected: produces incoherent comments; reader loses meaning).
- Bulk-add inline ESLint disable + revisit later (rejected: violates Inquebrável Rule 3 — hiding the violation behind a disable is the anti-pattern the rule was promoted to prevent).
- Allowlist with sunset (per `code-quality-allowlist.txt` precedent) (rejected: 74 entries is a flood; the rule does not have allowlist semantics declared; addition would be a strategic-review-level change of its own).

**Consequences:**
- Per-file judgment is the highest-effort path (~15-20 LoC of judgment per file × ~15-20 files) but produces a clean repo state.
- Each commit can be small (1-3 files per commit) so audit trail stays reviewable.
- Final regression sentinel grep MUST return 0 across all 5 paper-name tokens in `src/**/*.ts`.

### D5 — npm publish DEFER vs include in plan

**Decision:** `npm publish` is **OUT OF SCOPE** for this plan. The plan validates the package is publish-ready; the publish itself is a separate sign-off moment.

**Rationale:** Per CLAUDE.md INVIOLABLE rules: "Pre-release status — NEVER publish to npm without v1.0 authorization." Even a pre-release tag (`0.0.0-rc.3` under `next` dist-tag) requires explicit project-owner sign-off. Including publish in this plan would push the gate into automation, which the user has not authorized. Also: npm policy disallows unpublishing after 72 hours, so the gate must be conservative.

**Alternatives considered:**
- Include `npm publish --tag next --dry-run` as final task validation (this is essentially what `npm pack --dry-run` already provides — no additional value).
- Include actual `npm publish --tag next` in T4.1 conditional on owner-confirmation (rejected: confirmation flow is a workflow concern, not a plan task; defers to separate cycle).

**Consequences:**
- Plan ends with `READY_FOR_PUBLISH_REVIEW` state; publish itself triggered by separate ADR-tracked moment.
- T3.4 README update covers a hypothetical future install scenario WITHOUT publishing today.
- /dogfood gate semantic from ADR-0012 is preserved: empirical-snapshot path already cleared; benchmark reproduction (P0.2) remains the parallel blocker.

## Dependency Graph

```
Phase T0: Enumeration (audit deliverable, no code change)
    ↓
    ├─────────────────┬──────────────────┬─────────────────┐
    ▼                 ▼                  ▼                 ▼
Phase T1:         Phase T2:          Phase T3:         (parallelizable
API correctness   SDK functional     Paper names +     after T0 completes)
closures          closures           REST + MCP
                                     availability
    │                 │                  │
    └─────────────────┴──────────────────┘
                      ▼
            Phase T4: Integration Validation
                      ▼
              Phase T5: Cycle close
```

Phase T0 enumeration is the ONLY sequential gate before T1/T2/T3 (those three phases can interleave commits but Coverage Matrix entries depend on T0 inventory). Phase T4 + T5 are sequential terminators.

---

## Phase T0: Enumeration (audit deliverable)

**Objective:** Produce a single audit matrix mapping every public surface element to its closure-gate status.

### T0.1 — Pre-flight grep audit (paper names + any + subpath inventory)

#### Objective

Capture the empirical baseline of the 3 hard sentinel grep audits BEFORE any closure tasks land. Counts published here become the regression sentinels Coverage Matrix references.

#### Evidence

Section "What exists today" of this Context section already documents the baseline counts (74 paper-name lines; 8+41 = 49 exports; 13 subpaths). T0.1 reproduces those counts in a script that LATER tasks re-run as their regression check.

#### Files to edit

```
scripts/audit/p0-baseline.sh — NEW; runs the 5 grep audits + emits one-line JSON summary
.claude/knowledge-base/audits/p0-baseline-2026-06-04.md — NEW; captures the audit output as audit artifact
```

#### Deep file dependency analysis

`scripts/audit/p0-baseline.sh` is a NEW Bash script. Has no consumer dependencies. Invoked manually by humans + by Phase T4 validation. Output JSON shape: `{"paper_names": {"Mem0": 56, "Letta": 9, "LangMem": 4, "Graphiti": 4, "Voyager": 1}, "exports": {"src/index.ts": 8, "src/core/index.ts": 41}, "subpaths": 13, "any_in_public": 0}`.

The audit md file goes under `.claude/knowledge-base/audits/` — already established directory for `/deps-audit` output. Reuses the rotation policy from `audit-trail-rotation.md`.

#### Deep Dives

- The **6 grep audits** (EC-1 absorption adds the 6th): (1) paper names per token; (2) `any` in `src/index.ts` + `src/core/index.ts`; (3) subpath count from `package.json#exports`; (4) export count from `src/index.ts` + `src/core/index.ts`; (5) `dist/agent-tools/cli.js` existence; (6) plan file contains literal `## Dependencies` header line — sentinel check that the plan-level absorption stays in place even if a future cycle edits the plan file.
- Exit code 0 always (audit-only task, no gating); reporting only.
- JSON output to stdout; md file captures human-readable summary.
- **EC-11 absorption (DOCUMENT)**: script header comment documents that grep regex semantics target GNU grep (Linux primary dev OS per CLAUDE.md). BSD-grep (macOS default) produces slightly different word-boundary behavior; script is NOT cross-OS-tested beyond Linux.

#### Tasks

1. Write `scripts/audit/p0-baseline.sh` with 5 grep commands + JSON aggregation via `python3 -c`.
2. Run script + capture stdout to `.claude/knowledge-base/audits/p0-baseline-2026-06-04.md`.
3. Document the empirical baseline in the md (each count + which command produced it).

#### TDD

```
RED:     test_audit_baseline_emits_valid_json — invokes scripts/audit/p0-baseline.sh, parses stdout as JSON; MUST fail before script exists.
GREEN:   Implement scripts/audit/p0-baseline.sh.
REFACTOR: None expected (single-purpose audit script).
VERIFY:  npm test -- tests/integration/p0-audit/baseline.test.ts (NEW)
```

#### Acceptance Criteria

- [ ] `scripts/audit/p0-baseline.sh` executable + emits valid JSON to stdout.
- [ ] `.claude/knowledge-base/audits/p0-baseline-2026-06-04.md` captures: paper-name counts per token, export counts per index file, subpath count, `any` count.
- [ ] `tests/integration/p0-audit/baseline.test.ts` (NEW) asserts script exits 0 + JSON parseable.
- [ ] Pass: complexity — script under 50 LoC, single function.
- [ ] Pass: size — script ≤ 100 lines.

#### DoD

- [ ] Script committed; audit md committed.
- [ ] `npm test -- tests/integration/p0-audit/baseline.test.ts` green.
- [ ] Baseline numbers cited inline in Phase T1/T2/T3 task descriptions match script output.

### T0.2 — Public-surface inventory matrix

#### Objective

Generate the `public-exports.json` matrix that Phase T1+T2 tasks consume. Maps every export name to: source file path + line, JSDoc presence (boolean), `@see` cross-ref presence (boolean), contract test presence (which test file + line).

#### Evidence

Public-export documentation status is not currently audited. Without an inventory matrix, Phase T1 closures would be ad-hoc and might miss exports. The matrix becomes the closure tracker.

#### Files to edit

```
scripts/audit/public-export-matrix.py — NEW; reads src/index.ts + src/core/index.ts via ast-grep, emits JSON matrix
.claude/knowledge-base/audits/public-export-matrix-2026-06-04.json — NEW; generated matrix
```

#### Deep file dependency analysis

`scripts/audit/public-export-matrix.py` is a NEW Python script. Uses `ast-grep` (available per `package.json` indirectly) to extract `export {Foo, Bar}` and `export type {...}` patterns. For each export, walks the file backward to find JSDoc block + checks for `@see` token.

Contract test detection uses `grep -rEn "import.*\\b{exportName}\\b.*@usetheo/memory"` against `src/**/*.test.ts` and `tests/**/*.test.ts`.

#### Deep Dives

- **EC-4 absorption (MUST FIX)**: ast-grep patterns expanded to **3** (one alone is insufficient — undercounts the matrix):
  1. `export { $$NAMES }` — named value exports
  2. `export type { $$NAMES }` — named type-only exports (separate TS keyword; NOT matched by pattern 1)
  3. `export * from $SPEC` — re-export wildcard. When matched, the script RECURSES into `$SPEC` (resolves `.js` → `.ts` source file) and walks until fixed-point (no new files added). Re-exported names are flattened into the matrix.
- JSDoc detection: look at the lines preceding the `export` keyword. If the block contains `/**` and `*/`, JSDoc present. If contains `@see`, cross-ref present.
- Contract test detection: each export name gets searched for in `src/**/__tests__/**` + `tests/integration/**` + `tests/e2e/**`.

#### Tasks

1. Write `scripts/audit/public-export-matrix.py` (uses `subprocess.run(["sg", ...])` for ast-grep; falls back to regex if ast-grep absent).
2. Run script → write JSON to `.claude/knowledge-base/audits/public-export-matrix-2026-06-04.json`.
3. Audit the JSON manually — list of exports MISSING JSDoc, MISSING `@see`, MISSING contract test becomes Phase T1 closure list.

#### TDD

```
RED:     test_matrix_includes_all_8_root_exports — assert matrix has entries for createMemory, createLocalMemory, etc.; MUST fail before script exists.
RED:     test_matrix_jsdoc_field_boolean — assert matrix entries have boolean `jsdoc_present` + `see_ref_present` fields.
RED:     test_matrix_contract_test_paths_list — assert matrix entries have a list of test file paths exercising each export.
GREEN:   Implement scripts/audit/public-export-matrix.py.
REFACTOR: Extract JSON shape into a separate module if file > 200 LoC; otherwise none.
VERIFY:  npm test -- tests/integration/p0-audit/matrix.test.ts (NEW)
```

#### Acceptance Criteria

- [ ] Matrix JSON includes all 49 exports (8 root + 41 contract); count assertion in test.
- [ ] Each matrix entry has 4 fields: `name`, `source_file`, `jsdoc_present: bool`, `see_ref_present: bool`, `contract_test_files: string[]`.
- [ ] Pass: complexity — script under 150 LoC, modules ≤ 3 functions.
- [ ] Pass: size — script ≤ 250 lines.

#### DoD

- [ ] Matrix JSON committed.
- [ ] `npm test -- tests/integration/p0-audit/matrix.test.ts` green.
- [ ] Phase T1 task descriptions reference the matrix by name when listing closure candidates.

---

## Phase T1: API correctness closures

**Objective:** Close every JSDoc + `@see` cross-ref + contract test gap surfaced by the T0.2 matrix; lock the `any` floor at 0.

### T1.1 — JSDoc + @see cross-ref pass on `src/index.ts` (8 exports)

#### Objective

For each of the 8 exports in `src/index.ts`, ensure JSDoc with `@see` pointing to the source plan/ADR. Append `@see` lines for exports that have JSDoc but no cross-ref.

#### Evidence

`src/index.ts` declares 8 exports; the T0.2 matrix identifies which have JSDoc and which have `@see`. Sample audit (regenerated post-T0.2): exports like `createLocalMemory`, `runMigrations`, `PgvectorStore` have JSDoc from prior cycles but lack systematic `@see` cross-references.

#### Files to edit

```
src/index.ts — for each export missing @see, append `@see .claude/knowledge-base/{plan|adr|blueprint}/...` reference
src/index.ts — for each export missing JSDoc, add minimal block describing role + cross-ref
```

#### Deep file dependency analysis

`src/index.ts` is the public barrel. Edits are JSDoc additions only — no behavior change. Consumers of `src/index.ts` (tests, examples) are not affected.

#### Deep Dives

- For exports that re-export from `./local/index.js` etc.: the JSDoc can live AT the export site in `src/index.ts` OR at the original declaration. Per architecture.md § 6 module hygiene, the canonical home is the DECLARATION site; the barrel re-export gets a one-line JSDoc pointing to the canonical declaration.
- `@see` cross-references use the filesystem coordinate (`.claude/knowledge-base/plans/{slug}-plan.md § T{N}.{M}`) per `no-paper-names-in-code.md` discipline. NEVER cite a paper name.

#### Tasks

1. Read T0.2 matrix; enumerate the 8 exports' status.
2. For each export MISSING `@see`: identify the canonical reference. **EC-13 absorption (DOCUMENT)**: acceptance is widened — exports that pre-date the plans system (v0.0/v0.1 contract design era) MAY reference `ADR-0001-mem0-shape-architecture.md` OR `CLAUDE.md § Locked names` OR `README.md § How it works` instead of a `plans/` slug. The reference is "canonical home for the export's design rationale", not strictly a plan task ID. Use `git log --follow` on the export's declaration site to find the first commit; the commit message usually cites the source.
3. Append `@see` line to the export's JSDoc block.
4. For exports MISSING JSDoc entirely: add a minimal block.

#### TDD

```
RED:     test_all_root_exports_have_jsdoc — re-run T0.2 matrix; assert `jsdoc_present: true` for all 8 root exports; MUST fail before edits.
RED:     test_all_root_exports_have_see_ref — assert `see_ref_present: true` for all 8.
GREEN:   Edit src/index.ts JSDoc per task.
REFACTOR: None expected (mechanical edits).
VERIFY:  npm test -- tests/integration/p0-audit/exports-root.test.ts (NEW)
```

#### Acceptance Criteria

- [ ] All 8 exports in `src/index.ts` have JSDoc + `@see` cross-reference.
- [ ] `@see` references resolve to existing files (not fabricated).
- [ ] Pass: lint — no new warnings.
- [ ] Pass: size — `src/index.ts` ≤ 500 LoC.

#### DoD

- [ ] Matrix regenerated post-edit; all 8 root exports show JSDoc + see-ref present.
- [ ] `npm test -- tests/integration/p0-audit/exports-root.test.ts` green.

### T1.2 — JSDoc + @see cross-ref pass on `src/core/index.ts` (41 exports)

#### Objective

Same as T1.1 but for the 41 contract exports in `src/core/index.ts`.

#### Evidence

T0.2 matrix will enumerate; 41 is the largest export surface in the codebase. Likely some entries have JSDoc, others don't — closure list driven by matrix.

#### Files to edit

```
src/core/index.ts — JSDoc additions per matrix-identified gaps
src/core/**/*.ts — IF the canonical declaration site for an export lacks JSDoc, add there (per architecture.md § 6)
```

#### Deep file dependency analysis

`src/core/index.ts` is the contract barrel re-exporting from `src/core/{memory-item, options, memory-event, errors, dip/*, ...}.ts`. Each export's canonical declaration lives in a sibling file. Edits MAY touch up to ~10-15 sibling files for inline JSDoc additions.

#### Tasks

1. Read T0.2 matrix; enumerate the 41 exports' status.
2. Group exports by canonical declaration file; batch JSDoc edits per file.
3. Append `@see` line to each export's JSDoc.
4. Verify each `@see` reference resolves.

#### TDD

```
RED:     test_all_contract_exports_have_jsdoc — assert `jsdoc_present: true` for all 41; MUST fail before edits.
RED:     test_all_contract_exports_have_see_ref — assert `see_ref_present: true` for all 41.
GREEN:   Edit JSDoc per task across `src/core/index.ts` + sibling declaration files.
REFACTOR: None expected.
VERIFY:  npm test -- tests/integration/p0-audit/exports-contract.test.ts (NEW)
```

#### Acceptance Criteria

- [ ] All 41 contract exports have JSDoc + `@see` cross-reference.
- [ ] All `@see` paths exist (regression sentinel: `find {referenced-files} | wc -l` == count of refs).
- [ ] Pass: lint — no new warnings.
- [ ] Pass: size — every touched file under 500 LoC.

#### DoD

- [ ] Matrix regenerated post-edit; all 41 contract exports show JSDoc + see-ref present.
- [ ] `npm test -- tests/integration/p0-audit/exports-contract.test.ts` green.

### T1.3 — `any` floor sentinel

#### Objective

Lock the `any` count at 0 in `src/index.ts` + `src/core/index.ts` (the consumer-facing public surface). Regression sentinel test asserts the floor cannot regress without explicit allowlist.

#### Evidence

Current grep verifies 0 `any` in public-facing files. Sentinel makes this regression-protected.

#### Files to edit

```
tests/integration/p0-audit/no-any-in-public.test.ts — NEW; greps src/index.ts + src/core/index.ts for `: any`, `as any`; asserts 0 hits
```

#### Deep file dependency analysis

NEW test file. No source-code changes (lock the existing floor). If a future commit introduces `any` in public surface, the test FAILs and forces revision.

#### Tasks

1. Write the regression sentinel test.

#### TDD

```
RED:     test_no_any_in_src_index_or_core_index — read both files; assert no `\bany\b` patterns (EC-5 absorption widens from `: any\b|as any\b` to catch `Array<any>`, `Promise<any>`, `Record<string, any>`, and bare `any` in generic positions); MUST PASS on first run (floor is already 0).
RED:     test_any_grep_catches_generic_args — sentinel synthetic file `tests/integration/p0-audit/fixtures/with-any-generics.ts.skip` (not included in any build/test glob; pure pattern fixture) contains `Array<any>` + `Promise<any>` + `Record<string, any>` + `as any`; assert the same grep regex applied to it returns 4 hits. Locks the pattern semantics.
GREEN:   N/A (lock-the-floor task; widening the pattern from v1.0 catches more without code change).
REFACTOR: None expected.
VERIFY:  npm test -- tests/integration/p0-audit/no-any-in-public.test.ts
```

#### Acceptance Criteria

- [ ] Test exists + passes on current baseline.
- [ ] Future regressions surface as failed test in CI.

#### DoD

- [ ] Test committed + green.

---

## Phase T2: SDK functional closures

**Objective:** Close subpath smoke-import, bundle isolation, and `npm pack` manifest gaps across the 13 declared subpaths.

### T2.1 — Subpath smoke-import gate (13 subpaths)

#### Objective

For each of the 13 `package.json#exports` subpaths, verify a dynamic import resolves to a non-empty module object.

#### Evidence

Only `./server` + `./cache-pg` currently have smoke-import gates. The remaining 11 subpaths have no regression sentinel.

#### Files to edit

```
tests/integration/p0-audit/subpath-smoke-import.test.ts — NEW; one test per subpath, total 13
```

#### Deep file dependency analysis

NEW test file. Uses `await import('@usetheo/memory/{subpath}')` for each entry. Asserts the returned module has at least one named export. No source-code changes.

#### Deep Dives

- The 13 subpaths: `.`, `./agent-tools`, `./cache-pg`, `./contract`, `./embedders`, `./embedders/local`, `./embedders/openai`, `./embedders/stub`, `./llms`, `./llms/openai`, `./llms/stub`, `./server`, `./theokit`.
- For `.` (root) AND `./contract`, use Object.keys to confirm > 0 exports.
- **EC-6 absorption (SHOULD TEST)**: provider-specific subpaths (`./embedders/local`, `./embedders/openai`, `./llms/openai`) consume `@xenova/transformers` (~200MB on first run) and `openai` SDK — both optional dependencies. Pre-flight helpers `isXenovaInstalled()` + `isOpenAIInstalled()` (boolean checks via `try { require.resolve(name); return true } catch { return false }`) guard those subtests via `describe.skipIf(...)`. CI without optional deps installed → tests skip with LOUD message naming which dep is missing, NOT silently green.
- **EC-14 absorption (DOCUMENT)**: test file header documents the subpath resolution path. In DEV (no `node_modules/@usetheo/memory` self-install), `await import('@usetheo/memory/{subpath}')` fails because Node ESM cannot resolve a self-reference. Workaround: tests use RELATIVE imports `await import('../../src/{subpath}/index.js')` which validate the SOURCE composition. The `exports` MAP at install time is validated separately by T2.3 (`npm pack --dry-run`) + a future post-publish smoke test (out of scope for this cycle per ADR D5).

#### Tasks

1. Write the smoke-import test with 13 subtests.
2. Run; verify all 13 pass.

#### TDD

```
RED:     test_subpath_X_smoke_import — for each of 13, assert dynamic import resolves to module with >0 exports; MUST fail before test exists.
GREEN:   Write the test. No source changes.
REFACTOR: None expected.
VERIFY:  npm test -- tests/integration/p0-audit/subpath-smoke-import.test.ts
```

#### Acceptance Criteria

- [ ] All 13 subtests pass (or skip cleanly for optional-dep subpaths with documented rationale).
- [ ] Test file ≤ 200 LoC.

#### DoD

- [ ] Test committed + green.

### T2.2 — Default barrel bundle isolation (9 subpath impl files)

#### Objective

Verify that statically importing `@usetheo/memory` (default barrel `src/index.ts`) does NOT transitively pull in the impl files of 9 subpaths.

#### Evidence

`subpath-isolation.test.ts` covers `./server` + `./cache-pg` only (2 of 9). The remaining 7 subpath impl files have no isolation gate.

#### Files to edit

```
tests/integration/p0-audit/bundle-isolation.test.ts — NEW; one test per subpath impl file, total 9 (or fewer if some subpaths re-use existing tests)
```

#### Deep file dependency analysis

NEW test file. Pattern: use Node's `--experimental-vm-modules` or a similar bundler-simulation to walk the static-import graph of `src/index.ts`. Assert that 9 designated paths are NOT in the reachable set.

Alternative: use `madge` or `dependency-cruiser` to extract the graph (requires the dep, which we lack today). Simpler: parse `src/index.ts` + walk `import` declarations recursively, asserting target paths are not in the reachable set.

#### Deep Dives

- The 9 impl files (consumer reaches ONLY via subpath, not via default barrel):
  1. `src/local/recall-cache/pgvector-recall-cache-store.ts` (./cache-pg) — already tested
  2. `src/server/index.ts` (./server) — already tested
  3. `src/agent-tools/index.ts` (./agent-tools)
  4. `src/embedders/index.ts` (./embedders)
  5. `src/embedders/local.ts` (./embedders/local) — KEY: `@xenova/transformers` heavy dep MUST NOT load
  6. `src/embedders/openai.ts` (./embedders/openai) — KEY: `openai` SDK MUST NOT load
  7. `src/llms/index.ts` (./llms)
  8. `src/llms/openai.ts` (./llms/openai) — KEY: `openai` SDK MUST NOT load
  9. `src/theokit/index.ts` (./theokit)
- The shape of `subpath-isolation.test.ts` already covers items 1+2; we extend with items 3-9.
- **EC-7 absorption (SHOULD TEST)**: walk MUST be RECURSIVE through transitive imports until fixed-point. Depth-1 walk (just `src/index.ts` direct imports) is insufficient because `src/index.ts` re-exports from `./local/index.js`, which transitively imports from sibling files. The walk algorithm: `visited = set()`; `queue = ['src/index.ts']`; pop, parse import statements (`import ... from './x.js'`), resolve `.js` → `.ts` source path, add to visited if not present + enqueue; repeat until queue empty. Then assert NONE of the 9 impl paths appear in `visited`. Implementation: helper function `walkStaticImports(entryPath: string): Set<string>` placed in `tests/integration/p0-audit/_helpers/static-walk.ts` (NEW).
- TypeScript `import type` declarations are erased at runtime AND skipped by the walk (so they DON'T count as bundle-pulling imports). Use a simple regex `^import\s+[^t]` OR parse out `import type` explicitly.

#### Tasks

1. Refactor `subpath-isolation.test.ts` helper to walk `src/index.ts` import graph (extract OR duplicate cleanly).
2. Add 7 new tests (items 3-9 above) to `tests/integration/p0-audit/bundle-isolation.test.ts`.

#### TDD

```
RED:     test_default_barrel_does_not_reach_{impl_path} — for each of 7 new impl files, assert path NOT in reachable set; MUST fail or PASS depending on current state.
GREEN:   If failing, investigate WHICH import in src/index.ts (or transitive) pulls the file. Possible outcomes:
         (a) src/index.ts contains a static import from the subpath impl → DELETE it + ensure subpath barrel handles export.
         (b) A transitive static import in src/local/* or src/core/* pulls a subpath impl → make it dynamic per EC-26 bundle isolation pattern.
REFACTOR: None expected.
VERIFY:  npm test -- tests/integration/p0-audit/bundle-isolation.test.ts
```

#### Acceptance Criteria

- [ ] All 7 new tests pass (default barrel does NOT statically import the impl).
- [ ] If a fix was needed: source change documented in commit body.
- [ ] Pass: size — tests ≤ 300 LoC; source changes (if any) ≤ 50 LoC.

#### DoD

- [ ] Test file committed + green.

### T2.3 — `npm pack --dry-run` manifest verification

#### Objective

Verify `npm pack --dry-run` ships 100% of declared `files:` glob entries AND excludes 100% of `__tests__/**` paths.

#### Evidence

`subpath-isolation.test.ts` includes pack-manifest assertions for `./server` + `./cache-pg` only. The whole-package manifest is not audited.

#### Files to edit

```
tests/integration/p0-audit/pack-manifest.test.ts — NEW; runs `npm pack --dry-run --json` once + asserts manifest properties
```

#### Deep file dependency analysis

NEW test. Spawns `npm pack --dry-run --json` (Node child_process); parses JSON output for the file list; runs 4 assertion classes:
- Every entry under `src/**/*.ts` (minus excludes) is present.
- Every entry under `src/local/migrations/**` is present.
- ZERO entries under `**/__tests__/**`.
- ZERO entries matching `**/*.test.ts` or `**/*.test-d.ts`.

#### Tasks

1. Write the pack-manifest test.
2. Run; capture failures (if any); fix `package.json#files` if mismatch (extreme unlikely — files glob is already correct).
3. **EC-12 absorption (DOCUMENT)**: test file header records `node --version` + `npm --version` at audit time (capture once via beforeAll into JSDoc); uses `toBeGreaterThan(N)` tolerant assertions instead of exact `toBe(N)` for file counts, so npm version drift across machines doesn't false-fail.

#### TDD

```
RED:     test_pack_manifest_ships_all_src_ts — assert presence of representative source files; MUST fail before test exists.
RED:     test_pack_manifest_excludes_all_tests — assert ZERO `__tests__/` or `.test.ts` entries.
RED:     test_pack_manifest_ships_migrations — assert `src/local/migrations/0000_*.sql` present.
GREEN:   Write test; no source changes expected (files glob already correct).
REFACTOR: None expected.
VERIFY:  npm test -- tests/integration/p0-audit/pack-manifest.test.ts
```

#### Acceptance Criteria

- [ ] All 3 assertion classes pass.
- [ ] Pack manifest count = expected number of source files (compute via `find src -name '*.ts' ! -path '*__tests__*' ! -name '*.test.ts' | wc -l`).
- [ ] Pass: complexity — test under 100 LoC.

#### DoD

- [ ] Test committed + green.

---

## Phase T3: Paper names + REST stub removal + MCP availability

**Objective:** Close paper-name violations in `src/**`, port the MCP stub-removal fix to REST server, add CI sentinel for MCP CLI dist boot, refresh README.

### T3.1 — Paper-name remediation in `src/**/*.ts` (74 lines)

#### Objective

Reduce the 74 paper-name violations (Mem0:56, Letta:9, LangMem:4, Graphiti:4, Voyager:1) in `src/**/*.ts` to 0, per the per-file judgment strategy in ADR D4.

#### Evidence

T0.1 grep audit produces the baseline. `no-paper-names-in-code.md` rule § "How to apply" specifies the 4 closure patterns; ADR D4 of THIS plan codifies the per-file judgment.

#### Files to edit

```
(per T0.1 audit output) — each .ts file under src/ that contains a paper-name violation
```

Concrete files inferred from prior grep (final list driven by T0.1 fresh count):
- `src/agent-tools/__tests__/streamable-http.test.ts` (`Mem0 Q5` JSDoc refs)
- `src/agent-tools/tools/__tests__/handlers.test.ts` (error message containing `Mem0`)
- `src/agent-tools/tools/__tests__/schemas.test.ts` (`Mem0 parity` comment)
- `src/local/in-memory-store.ts` (`Mem0 mockEmbedding pattern` JSDoc)
- `src/core/constants.ts` (`Mem0's test-suite mockEmbedding` JSDoc)
- `src/agent-tools/tools/remember-schema.ts` (`Mem0 parity` JSDoc)
- `src/core/reflection/prompt.ts` (`Mem0 anti-hallucination` comment)
- `src/local/schema.ts` (`Mem0's bivalent vocabulary` JSDoc)
- `src/core/scoring.ts` (`Ported verbatim from Mem0's` JSDoc)
- (additional files surfaced by T0.1 grep)

#### Deep file dependency analysis

Edits are JSDoc/comment-only — no behavior change. Some test files contain paper names in `describe`/`it` strings; these become user-facing in test reports → require reword.

#### Deep Dives

Per ADR D4, classify each line into one of 3 categories:
- **(a) JSDoc `@see` reference** → replace with knowledge-base filesystem coordinate.
- **(b) Behavioral comment** → describe WHAT the code does, not WHICH paper.
- **(c) Error message** → describe BEHAVIOR per EC contract reference.

#### Tasks

1. Re-run T0.1 audit → fresh list of files + lines.
2. Per file: read context; classify each violation into (a)/(b)/(c); edit.
3. Commit in batches of 3-5 files per commit for reviewability.
4. Re-run T0.1 audit; assert all 5 token counts = 0.

#### TDD

```
RED:     test_no_paper_names_in_src — grep all 5 tokens against src/**/*.ts; assert 0 hits; MUST fail at baseline (74 hits).
RED (EC-8 absorption): test_reflection_prompt_shape_stable_post_rename — instantiate ReflectionPipeline with StubLLM that captures the rendered prompt; assert prompt text contains zero of `[Mem0, Letta, LangMem, Voyager, MemGPT, CoALA, Honcho, Graphiti]` tokens AND assert the StubLLM-returned shape (drafts array length + structure) is identical to a frozen baseline captured before rename. Renaming JSDoc/comments is shape-safe; renaming text INSIDE the LLM prompt template (`src/core/reflection/prompt.ts`) could shift LLM output — this test guards against accidental prompt content drift.
GREEN:   Per-file judgment edits; iterate until grep returns 0.
REFACTOR: Some edits surface follow-up renames (e.g., `mem0MockEmbedding` variable name) — close those in the same commit.
VERIFY:  npm test -- tests/integration/p0-audit/no-paper-names.test.ts (NEW)
```

#### Acceptance Criteria

- [ ] T0.1 audit re-run shows 0 lines across all 5 tokens in `src/**/*.ts`.
- [ ] Pass: lint — no new warnings.
- [ ] Pass: size — no file exceeded 500 LoC.

#### DoD

- [ ] All paper-name remediation commits landed.
- [ ] `npm test -- tests/integration/p0-audit/no-paper-names.test.ts` green.

### T3.2 — REST server (`run-server.ts`) stub removal

#### Objective

Mirror the `e43d801` MCP fix in `src/agent-tools/run-server.ts`. Remove `DeterministicStubEmbedder` + `StubLLM` imports + wirings; require `OPENAI_API_KEY` hard-fail; wire `LocalTransformerEmbedder` + `OpenAILLM`.

#### Evidence

Empirically verified `run-server.ts` still imports `StubLLM` + `DeterministicStubEmbedder` (grep output in Context section). FOLLOW-UP comment at line 110-118 of the file explicitly cites this work as deferred.

#### Files to edit

```
src/agent-tools/run-server.ts — port e43d801 changes verbatim
README.md line 273 (the "alpha default uses stubs" paragraph) — update copy to honest current state
tests/integration/docker-stack.test.ts — EC-2 absorption (MUST FIX): inject `OPENAI_API_KEY=fake-test-key-for-boot-validation` in beforeAll OR add `describe.skipIf(!process.env.OPENAI_API_KEY)`. WHICH path depends on whether the docker-stack test actually exercises LLM/embedder behavior (skipIf) vs only validates boot semantics (inject fake key — boot succeeds, never calls OpenAI API). Inspection during /implement determines per-test which pattern applies.
tests/integration/docker-compose-prod.test.ts — same EC-2 treatment if it exercises REST server boot
tests/integration/dockerfile-entrypoint.test.ts — same EC-2 treatment if it exercises REST server boot
tests/integration/cli-consolidated.test.ts — same EC-2 treatment for `themory server` subcommand spawn
```

#### Deep file dependency analysis

`run-server.ts` is the REST composition root. Consumers are `themory server` CLI subcommand. No source files outside `src/agent-tools/` import from it.

#### Deep Dives

The mechanical port: same shape as the MCP fix.
- Add `OPENAI_API_KEY` hard-fail.
- Add `LOCAL_EMBEDDER_DIM = 384` constant.
- Replace `embedder: new DeterministicStubEmbedder()` with `embedder: new LocalTransformerEmbedder()`.
- Replace `llm: new StubLLM()` with `llm: new OpenAILLM()`.
- Pass `embeddingDim: LOCAL_EMBEDDER_DIM` to `runMigrations`, `PgvectorStore`, `createLocalMemory`.
- Replace 3-line stub-warning stderr with 1-line "real providers wired" disclosure.

README line 273 update: rephrase to acknowledge that BOTH `themory server` and `themory mcp` now wire real providers; remove the "alpha default uses stubs" claim.

#### Tasks

1. Read `run-mcp-server.ts` (committed in `e43d801`); copy structure.
2. Edit `run-server.ts` per the structure.
3. Edit README line 273 with honest current state.
4. Rebuild `dist/`; verify integration test `tests/integration/docker-stack.test.ts` still passes (it depends on REST server boot).

#### TDD

```
RED:     test_run_server_does_not_import_stubs — grep `src/agent-tools/run-server.ts` for `StubLLM|DeterministicStubEmbedder`; assert 0 hits; MUST fail at baseline.
RED:     test_run_server_hard_fails_without_openai_key — spawn `node dist/agent-tools/cli.js server` without OPENAI_API_KEY; assert exit code 2.
GREEN:   Port e43d801 to run-server.ts.
REFACTOR: None expected.
VERIFY:  npm test -- tests/integration/p0-audit/run-server-stub-removal.test.ts (NEW)
```

#### Acceptance Criteria

- [ ] `grep "Stub" src/agent-tools/run-server.ts` returns 0 hits (or only in inline comments referring to history).
- [ ] `node dist/agent-tools/cli.js server` exits 2 when `OPENAI_API_KEY` unset.
- [ ] README line 273 updated.
- [ ] **EC-2 regression check**: `npm test -- tests/integration/docker-stack.test.ts tests/integration/docker-compose-prod.test.ts tests/integration/dockerfile-entrypoint.test.ts tests/integration/cli-consolidated.test.ts` still green (4 files audited for fake-key-injection or skipIf as appropriate).
- [ ] Pass: lint — no new warnings.

#### DoD

- [ ] Commit message references `e43d801` as the source pattern.
- [ ] `npm test -- tests/integration/p0-audit/run-server-stub-removal.test.ts` green.
- [ ] `npm test -- tests/integration/docker-stack.test.ts` still green (REST server still works against pgvector + real OPENAI_API_KEY).

### T3.3 — MCP CLI dist-artifact boot test

#### Objective

CI-reproducible regression sentinel that asserts `node dist/agent-tools/cli.js mcp` boots + responds to MCP `tools/list` with 4 verbs registered.

#### Evidence

Today's session validated MCP works via real Claude Code call. The validation was ad-hoc. No CI sentinel exists.

#### Files to edit

```
tests/integration/p0-audit/mcp-cli-boot.test.ts — NEW; spawns dist CLI, sends MCP tools/list request, asserts 4 verbs registered
```

#### Deep file dependency analysis

NEW test. Uses Node `child_process.spawn` to start the CLI in stdio mode; sends a JSON-RPC `tools/list` request; reads response; asserts shape.

#### Deep Dives

- MCP stdio transport: read/write line-delimited JSON via `stdin`/`stdout`.
- Sample request: `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`.
- Sample response: `{"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"remember",...},...]}}`.
- Assertion: `result.tools.length === 4` AND every tool name in `['remember', 'recall', 'forget', 'reflect']`.
- **EC-3 absorption (MUST FIX)**: Pre-flight skip checks LOCKED via top-level `beforeAll` / `describe.skipIf` triad:
  - `describe.skipIf(!existsSync('dist/agent-tools/cli.js'))('mcp-cli-boot', () => { ... })` — fires if `npm run build` was not run before test invocation. Skip message: `"dist/agent-tools/cli.js missing — run \`npm run build\` first"`.
  - `describe.skipIf(!process.env.OPENAI_API_KEY)('mcp-cli-boot', () => { ... })` — fires if no API key in env. Skip message names the required env var.
  - `describe.skipIf(!process.env.THEOMEM_PG_URI)('mcp-cli-boot', () => { ... })` — fires if pg connection string absent. Skip message names the required env var.
  - All 3 skip conditions LOUD via stderr `console.warn` so CI logs show WHY the test skipped instead of silently green. Without these, child_process spawn fails with ENOENT or exit-2 silently → confusing debug session.
- **EC-9 absorption (SHOULD TEST)**: child_process JSON-RPC over stdio uses `readline.createInterface({ input: child.stdout })` with `rl.on('line', ...)` handler — line-delimited parsing per MCP spec. Raw `child.stdout.on('data', buf => ...)` concatenation splits JSON-RPC messages across buffer boundaries; readline handles framing correctly. Place helper `spawnMcpAndCall(method, params)` in `tests/integration/p0-audit/_helpers/mcp-stdio-client.ts` (NEW) so T3.3 + future MCP-boot tests share the implementation.

#### Tasks

1. Write the boot test.
2. Run locally; verify pass.

#### TDD

```
RED:     test_mcp_cli_lists_4_verbs — spawn dist CLI; send tools/list; assert 4 tools; MUST fail before test exists.
GREEN:   Write the test.
REFACTOR: Extract child_process spawn helper if reused in T3.2 + T3.3.
VERIFY:  npm test -- tests/integration/p0-audit/mcp-cli-boot.test.ts
```

#### Acceptance Criteria

- [ ] Test exists + passes when `OPENAI_API_KEY` + `THEOMEM_PG_URI` set.
- [ ] Test skips cleanly + LOUDLY when env vars absent.
- [ ] Pass: complexity — test under 200 LoC.

#### DoD

- [ ] Test committed + green.

### T3.4 — README MCP setup guide refresh

#### Objective

Update README § Agent loops via MCP to reflect the current state (real providers default, no stubs in MCP path) + provide reproducible setup recipe for a third-party reader.

#### Evidence

README lines 191-275 document MCP setup; line 273 explicitly mis-describes the current state ("alpha default uses stubs" for both REST + MCP — MCP no longer uses stubs).

#### Files to edit

```
README.md (lines ~191-275) — refresh MCP setup section
README.md (line ~273) — covered by T3.2 also, but coordinate edits to avoid conflict
```

#### Deep file dependency analysis

Public copy edit. No source code. Per `public-copy.md` rules, marketing tone applies to HERO + BODY sections; the DEEP DIVE section (where MCP setup lives) stays technical-direct.

#### Deep Dives

- Add concrete env-var checklist: `OPENAI_API_KEY` REQUIRED, `OPENAI_BASE_URL` optional (defaults to OpenAI; set for OpenRouter), `THEOMEM_PG_URI` REQUIRED, `THEOMEM_MCP_DEFAULT_USER_ID` optional (defaults to scope-binding via `_meta`).
- Include the `.mcp.json` example block (currently in `.mcp.json.example` template).
- Note: optional dep `@xenova/transformers` needed for embedder (subpath `./embedders/local`).

#### Tasks

1. Read current README § Agent loops via MCP.
2. Rewrite to reflect: stub removal, env-var requirements, `.mcp.json` registration, third-party reproducer notes.
3. Add cross-reference to the `.mcp.json.example` template file.

#### TDD

```
RED:     test_readme_mcp_section_mentions_openai_api_key — read README; assert `OPENAI_API_KEY` mentioned at least once in `## Agent loops via MCP` section; MUST fail before edit (currently absent from that section).
RED:     test_readme_does_not_claim_mcp_uses_stubs — assert that the phrase "MCP" within 50 chars of "stub" or "Stub" returns 0 hits in the section; MUST fail at baseline (line 273 ships the violation).
GREEN:   Edit README per task.
REFACTOR: None expected.
VERIFY:  npm test -- tests/integration/p0-audit/readme-mcp-section.test.ts (NEW)
```

#### Acceptance Criteria

- [ ] README § Agent loops via MCP documents `OPENAI_API_KEY` requirement + `.mcp.json` registration.
- [ ] No remaining "MCP uses stubs" claim.
- [ ] Pass: size — README under 1500 LoC (current is much smaller; non-issue).

#### DoD

- [ ] README edit committed.
- [ ] `npm test -- tests/integration/p0-audit/readme-mcp-section.test.ts` green.

---

## Phase T4: THE GOAL TEST

### T4.1 — THE GOAL TEST — `tests/integration/p0-audit/full-public-surface.test.ts`

#### Objective

Single test file consolidating ≥ 30 assertions covering THE GOAL of the entire plan: 13 subpath smoke imports + 9 bundle isolation gates + 5 paper-name token sentinels + 4 MCP tools register + 1 npm-pack manifest count + 8+41 = 49 export presence checks.

#### Evidence

THE GOAL of this plan (cited in `## Goal` above) names this test as the measurement.

#### Files to edit

```
tests/integration/p0-audit/full-public-surface.test.ts — NEW; orchestrates assertions across all 3 sub-goals
```

#### Deep file dependency analysis

NEW test. Composes assertions from T2.1 (smoke imports) + T2.2 (bundle isolation) + T2.3 (pack manifest) + T3.1 (paper names) + T3.3 (MCP boot).

#### Deep Dives

The 30+ assertion budget:
- 13 subpath smoke-import assertions
- 9 bundle isolation assertions
- 5 paper-name token grep assertions (each = 0)
- 4 MCP `tools/list` verb-presence assertions
- 1 `npm pack --dry-run` file-count assertion (= expected count)
- 49 export-presence assertions (8 root + 41 contract)

Total: 13 + 9 + 5 + 4 + 1 + 49 = **81 assertions**. Well over the ≥ 30 floor cited in the Goal.

**EC-10 absorption (SHOULD TEST)**: 81 assertions organized in 6 nested `describe` blocks for failure attribution:

```typescript
describe('THE GOAL TEST — p0-api-sdk-mcp-correctness-audit', () => {
  describe('Sub-goal 1: API correctness', () => { /* 49 export-presence */ });
  describe('Sub-goal 2: SDK functional / subpath smoke imports', () => { /* 13 */ });
  describe('Sub-goal 3: Bundle isolation', () => { /* 9 */ });
  describe('Sub-goal 4: Paper-name policy compliance', () => { /* 5 */ });
  describe('Sub-goal 5: MCP availability', () => { /* 4 tools/list */ });
  describe('npm pack manifest hygiene', () => { /* 1 file-count */ });
});
```

Failure surfaces the broken sub-goal in the first vitest output line instead of forcing a grep-the-stacktrace debug pass.

#### Tasks

1. Author the test orchestrating the assertions.
2. Run; verify all 81 pass.

#### TDD

```
RED:     test_goal_30_assertions_pass — single test that aggregates all 81 sub-assertions; MUST fail before T0-T3 land.
GREEN:   T0-T3 land all closures.
REFACTOR: Consolidate assertion helpers if file > 500 LoC.
VERIFY:  npm test -- tests/integration/p0-audit/full-public-surface.test.ts
```

#### Acceptance Criteria

- [ ] ≥ 30 assertions in the file (target: 81; floor: 30).
- [ ] All pass.
- [ ] Pass: size — file ≤ 500 LoC.

#### DoD

- [ ] THE GOAL TEST committed + green.

---

## Phase T5: Final Integration Validation + cycle close

### T5.1 — Quality gates + cycle close

#### Objective

Run full quality gates; verify nothing regressed; close cycle.

#### Files to edit

```
CHANGELOG.md — append [Unreleased] Changed entry describing the audit closure
```

#### Tasks

1. Run `npm test` (full suite).
2. Run `npm run typecheck`.
3. Run `npm run lint`.
4. Run `npm run test:coverage` on changed paths.
5. Run T0.1 audit script + verify paper-name baseline = 0.
6. Re-run `/dogfood` audit — verify EVIDENCE_SUFFICIENT preserved.
7. CHANGELOG entry.
8. (After /review READY_TO_MERGE) Move plan to `completed/`.

#### Acceptance Criteria

- [ ] `npm test` green (full suite).
- [ ] `npm run typecheck` zero errors.
- [ ] `npm run lint` zero warnings.
- [ ] Coverage on changed paths ≥ 90% (critical paths 100%).
- [ ] `/dogfood` still returns EVIDENCE_SUFFICIENT.
- [ ] CHANGELOG entry under [Unreleased] § Changed.

#### DoD

- [ ] All gates pass; plan moved to `completed/` after PR merge.

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Public-export documentation gap (`src/index.ts` 8 exports) | `T1.1` | JSDoc + @see for all 8 |
| 2 | Public-export documentation gap (`src/core/index.ts` 41 exports) | `T1.2` | JSDoc + @see for all 41 |
| 3 | `any` floor regression sentinel | `T1.3` | New test locks floor at 0 |
| 4 | Subpath smoke-import coverage incomplete (13 subpaths) | `T2.1` | Smoke test per subpath |
| 5 | Bundle isolation gates incomplete (9 subpath impls) | `T2.2` | Extend isolation test |
| 6 | `npm pack` manifest assertions incomplete | `T2.3` | Pack-manifest test |
| 7 | 74 paper-name violations in `src/**` | `T3.1` | Per-file judgment edits |
| 8 | REST server (`run-server.ts`) still uses stubs | `T3.2` | Port e43d801 fix |
| 9 | MCP CLI dist-artifact boot test missing | `T3.3` | New CI sentinel |
| 10 | README MCP setup guide stale | `T3.4` | Refresh section |
| 11 | Audit baseline emission | `T0.1` | Pre-flight grep script |
| 12 | Public-export inventory matrix | `T0.2` | Python ast-grep script |
| 13 | THE GOAL TEST (≥ 30 assertions) | `T4.1` | Consolidates Phases T1+T2+T3 |
| 14 | Quality gates + cycle close | `T5.1` | Full validation chain |
| 15 | **EC-1 (MUST FIX)** — Plan missing `## Dependencies` section (cycle-plan.md v1.1 hard gate) | `T0.1` | T0.1 baseline audit script gains 6th check: assert `## Dependencies` section header present in plan file; section content authored inline above Objective per cycle-plan.md v1.1 contract; zero new deps per Inquebrável Rule 11 |
| 16 | **EC-2 (MUST FIX)** — T3.2 REST stub removal breaks 4 docker/CLI integration tests | `T3.2` | Files to edit extended to 4 test files + Acceptance Criteria adds regression check |
| 17 | **EC-3 (MUST FIX)** — T3.3 MCP boot test cryptic failure without pre-flight | `T3.3` | 3-tier `describe.skipIf` locked into Deep Dives + RED tests |
| 18 | **EC-4 (MUST FIX)** — T0.2 export matrix misses `export type` + re-exports | `T0.2` | 3 ast-grep patterns + recursive walk on `export * from` targets |
| 19 | **EC-5 (SHOULD TEST)** — `any` grep too narrow | `T1.3` | RED widened to `\bany\b` + sentinel fixture test |
| 20 | **EC-6 (SHOULD TEST)** — `@xenova/transformers` heavy dep in T2.1 | `T2.1` | `describe.skipIf(!isXenovaInstalled())` + sibling for openai SDK |
| 21 | **EC-7 (SHOULD TEST)** — T2.2 walk depth-1 insufficient | `T2.2` | Recursive fixed-point walk + shared `_helpers/static-walk.ts` |
| 22 | **EC-8 (SHOULD TEST)** — T3.1 reflection prompt rename risks shifting LLM output | `T3.1` | RED test against StubLLM with frozen baseline |
| 23 | **EC-9 (SHOULD TEST)** — T3.3 stdio raw buffer concat splits JSON-RPC across boundaries | `T3.3` | `readline.createInterface` framing locked into Deep Dives |
| 24 | **EC-10 (SHOULD TEST)** — T4.1 81 assertions need failure attribution | `T4.1` | 6 nested `describe` blocks per sub-goal |
| 25 | **EC-11 (DOCUMENT)** — T0.1 GNU grep vs BSD grep | `T0.1` | Script header documents Linux primary OS |
| 26 | **EC-12 (DOCUMENT)** — `npm pack --json` shape varies | `T2.3` | Tolerant assertions + npm version captured in test header |
| 27 | **EC-13 (DOCUMENT)** — pre-plan-era exports `@see` target | `T1.1` | Acceptance widens to ADR-0001/CLAUDE.md/README.md |
| 28 | **EC-14 (DOCUMENT)** — subpath resolution dev vs install | `T2.1` | Test header documents relative-import workaround |

**Coverage: 28/28 gaps covered (100%)** — original 14 + 14 EC absorption rows from v1.1.

## Global Definition of Done

- [ ] All phases completed (T0 → T1 → T2 → T3 → T4 → T5).
- [ ] All tests passing — `npm test` green.
- [ ] Zero TypeScript errors — `npm run typecheck`.
- [ ] Zero lint warnings — `npm run lint`.
- [ ] File-size budget respected (per `.claude/rules/architecture.md § Module hygiene` — 500 LoC).
- [ ] CHANGELOG.md updated under `[Unreleased]` § Changed.
- [ ] Backward compatibility preserved across public API (no `src/index.ts` or subpath export removed).
- [ ] **Paper-name regression sentinel**: T0.1 audit re-run shows 0 lines across all 5 paper-name tokens in `src/**/*.ts`.
- [ ] **MCP boot sentinel**: `npm test -- tests/integration/p0-audit/mcp-cli-boot.test.ts` green against the freshly-built `dist/`.
- [ ] **`/dogfood` verdict preserved**: re-audit returns EVIDENCE_SUFFICIENT.
- [ ] **Plan archived** — after `/review` returns `READY_TO_MERGE` AND the PR has been merged to `main` (or to `develop` per Inquebrável Rule 4 — releases cut develop → main), move this plan to `.claude/knowledge-base/plans/completed/p0-api-sdk-mcp-correctness-audit-plan.md`.

## Final Phase: Integration Validation (MANDATORY)

Covered by Phase T5.1 (above).

### Execution

```
npm test
npm run test:coverage
npm run typecheck
npm run lint
bash scripts/audit/p0-baseline.sh   # T0.1 sentinel re-run
```

### Acceptance Criteria

- [ ] All test suites green (unit + integration).
- [ ] Coverage ≥ 90% on changed files (critical paths 100%).
- [ ] Zero TypeScript errors.
- [ ] Zero lint warnings.
- [ ] T0.1 paper-name counts = 0.
- [ ] THE GOAL TEST `tests/integration/p0-audit/full-public-surface.test.ts` passes with ≥ 30 assertions.

### If Validation Fails

1. Identify which failures are plan-caused vs pre-existing.
2. Fix plan-caused failures.
3. Re-run validation chain.
4. Pre-existing issues logged in PR description; do NOT block plan completion.
