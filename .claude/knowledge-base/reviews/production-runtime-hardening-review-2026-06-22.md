# Review: production-runtime-hardening

**Date:** 2026-06-22
**Branch:** develop
**Reviewers (spawned agents):** 6 — architecture, tests, wiring, cross-validation, domain-infrastructure, domain-security
**Findings:** 0 BLOCKER · 1 HIGH (fixed) · 4 MEDIUM (fixed/documented) · LOW/INFO (fixed/accepted)
**Verdict:** READY_TO_MERGE

> Hand-consolidated from `.claude/agents/review-production-runtime-hardening-2026-06-22/findings/` (6 agent YAMLs). The `consolidate_findings.py` aggregator meta-defect (M1 backlog) means manual consolidation per Inquebrável Rule 3.

## BLOCKER
None.

## HIGH (fixed inline — commit `00131d2`)

### F-tests-1 / F-wire-1 — GOAL test re-implemented the wire inline instead of exercising the real `wireMemoryFromPool` env→executor seam
- Found by: tests, wiring, architecture (F-arch-4).
- The integration GOAL proved real-executor→real-execute (isolated-vm) + SDK-layer 501, and the unit test proved the real `wireMemoryFromPool` reads the real env — but with `createLocalMemory` AND `SandboxedSkillExecutor` mocked, so "the real wire constructs a REAL executor" was uncovered.
- **FIXED:** the unit mock now uses `vi.importActual` to keep the REAL `SandboxedSkillExecutor` (its constructor is addon-free), and the env-on test asserts `cfg.skillExecutor` `toBeInstanceOf(SandboxedSkillExecutor)`. The chain is now fully covered by real components: real wire reads real env → constructs a real executor (unit) → real executor executes via real isolated-vm + real pg (integration GOAL) → end-to-end in the distroless image (live HTTP 200 evidence). Note: a single test driving real-wire→real-execute is impossible without a real OpenAI key (createLocalMemory probes the embedder at construction); the split-but-all-real coverage is the honest maximum.

## MEDIUM

| ID | Found by | Disposition |
|---|---|---|
| F-arch-5 | architecture | **FIXED** — added ADR D6 (node-linker=hoisted distroless flat-layout) + Coverage Matrix row 12 |
| F-tests-3 | tests | **FIXED** — env-on test now asserts a real `SandboxedSkillExecutor` instance (toBeInstanceOf) |
| F-tests-2 | tests | **ACCEPTED** — TDD RED-before-GREEN unauditable (slice landed in one commit); matches this repo's established squash pattern; behavior is fully tested |
| F-xval-1 | cross-validation | **DOCUMENTED** — the two prior Docker fixes (`3344f2d` isolated-vm pin, `22c3ad8` toolchain) are ANCESTORS of the review base `b06e1df`, so a diff-bounded review window doesn't re-diff them; they are present + correct at HEAD and were validated by the M1 GOAL 8/8 + M2 9/9 regression at commit time. A release-gate re-build re-verifies the full image. |

## LOW / INFO
- F-arch-3 / F-xval-3 — **FIXED** stale "type-only import" comment (it's a value import whose module's isolated-vm import is type-only).
- F-dom-infra-3 — **FIXED** retry cap uses a `MAX` var (range + literal coupled; no fail-loud→silent-success footgun).
- F-dom-infra-8 — **FIXED** Dockerfile header corrected: image ~476MB (the `<200MB` claim was false post-hoist); documented the `INCLUDE_OPTIONAL=false` lean profile.
- F-dom-sec-1 / F-arch retry-sleep / F-dom-infra-10 (published-tag re-verify) — **ACCEPTED** (lazy-load gated; cosmetic; release-gate re-verify recommended).

## Domain-security verdict (priority gate): PASS
`resolveSkillExecutionEnabled()` is exact-match `=== 'true'` (no truthy leak; EC-2 test proves `'1'`/`'TRUE'`/`'yes'`/`' true '`/`''`/unset → DISABLED). No `THEOMEM_SKILL_EXECUTION` default anywhere (Dockerfile/compose grepped clean). M1 sandbox impl byte-unchanged (only WIRED). Auth not bypassed (REST execute still bearer-gated; default path 501).

## Domain-infrastructure verdict: SOUND
`--config.node-linker=hoisted` is layout-only (frozen-lockfile honored, no phantom deps), the genuine fix for the distroless 503; bounded retry fails loud; toolchain discarded with the build stages; distroless nonroot/no-shell invariants preserved.

## Cross-validation summary
Tasks 4/4 fully implemented; ADRs 6/6 (D5 gateway-proxy correctly DEFERRED to theo-cloud, not dropped); Coverage 12/12; no plan drift; no fabrication.

## Quality gates
- `npm run typecheck` PASS (0) · `npm run lint` PASS (0) · `npm test` 1087 passed · integration 19 (wiring 2 + M1 8 + M2 9) · `docker build` green · distroless execute HTTP 200 · `/code-quality` PASS 100.

## Spawned agents (audit trail)
`.claude/agents/review-production-runtime-hardening-2026-06-22/{architecture,tests,wiring,cross-validation,domain-infrastructure,domain-security}.md` (+ findings/*.yaml)

## Handoff decision
**READY_TO_MERGE.** 0 BLOCKER; the 1 HIGH fixed inline (real-wire→real-executor seam now covered); all actionable MEDIUM/LOW fixed; accepted items documented. The three production-runtime defects the M2 live-test surfaced (isolated-vm@7/Node22, Docker toolchain, distroless flat-layout 503) are all fixed + verified (skill execute on the distroless image = HTTP 200). Gateway episodes proxy remains a documented theo-cloud cross-repo follow-up (ADR D5).
