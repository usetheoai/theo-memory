# T0.0 Pre-cycle Verification — dogfood-anchor-scenario-launch

**Date:** 2026-06-04
**Plan:** `dogfood-anchor-scenario-launch` v1.1
**Task:** T0.0 (Phase Pre-T0 — EC-5 absorption verification gate)
**Status:** COMPLETE — **CASE A**: `Write` tool IS the canonical path for Claude Code auto-memory writes. ADR D1 hybrid strategy is structurally valid. Cycle proceeds to T0.1.

## Why this verification exists

EC-5 absorption (from `/edge-case-plan dogfood-anchor-scenario-launch` 2026-06-04): ADR D1's hybrid strategy assumes that Claude Code's auto-memory writes (the BACKGROUND save mechanism that creates `memory/*.md` files) invoke the `Write` tool — which is what PostToolUse hooks intercept. If this assumption is wrong, hook-FS-mirror catches only USER-driven memory edits, not auto-saves; ADR D1 hybrid loses ~50% of its dependency coverage and must amend BEFORE T1.1 implementation lands.

T0.0 verifies the assumption empirically against Claude Code's own transcript history for this project (~/.claude/projects/-home-paulo-Projetos-usetheo-theo-memory/*.jsonl).

## Grep commands run

```bash
# Count Write tool calls targeting memory/*.md across all transcripts
grep -h '"name":"Write"' ~/.claude/projects/-home-paulo-Projetos-usetheo-theo-memory/*.jsonl \
  | grep -cE 'memory/[^"]+\.md'

# Enumerate distinct memory files saved via Write
grep -h '"name":"Write"' ~/.claude/projects/-home-paulo-Projetos-usetheo-theo-memory/*.jsonl \
  | grep -oE '"file_path":"[^"]*memory/[^"]*\.md"' | sort -u
```

## Empirical result

- **587 Write tool calls** targeting `memory/*.md` files across 14 distinct transcript JSONL files for this project.
- **9+ distinct memory files** verified as written via the `Write` tool:
  - `memory/dogfood_gate_locked_day0.md`
  - `memory/implement_runtime_pair_program_agent.md`
  - `memory/mem0_ts_exploration.md`
  - `memory/MEMORY.md`
  - `memory/no_coauthored_by_in_commits.md`
  - `memory/no_paper_names_in_code.md`
  - `memory/stance_go_to_cto.md`
  - `memory/themory_api_contract.md`
  - `memory/themory_positioning.md`
  - (plus additional files in the full output not enumerated here for brevity)

These are the EXACT memory files declared in the auto-memory MEMORY.md index — confirming that the auto-memory save path runs through the canonical `Write` tool interception point.

## Classification

**CASE A — Write tool IS the canonical path** ✓

Hook on PostToolUse + Write CAN intercept Claude Code auto-memory writes per ADR D1 hybrid assumption. The hook-FS-mirror secondary path is structurally valid:
1. Auto-memory save is initiated by Claude (the assistant) at session-end OR upon user remember-style prompts.
2. Save goes through the `Write` tool with `file_path` targeting `<project-slug>/memory/*.md`.
3. PostToolUse hook can intercept BOTH events identically.

Honest disclosure: this verification covers the path that has been EXERCISED in actual project sessions (587 confirmed Write calls). It does NOT rule out alternative paths that may exist but have not been triggered yet (e.g., a session-end auto-save mechanism that bypasses the tool system entirely). However, given the high volume of confirmed Write-tool-based saves AND the explicit auto-memory CLAUDE.md instruction ("write to it directly with the Write tool"), the alternative-path risk is judged LOW.

## Cycle gate decision

**PROCEED to T0.1.** ADR D1 hybrid strategy is structurally valid. NO ADR amendment required at this verification gate. Plan v1.1 holds.

## DoD verification

- [x] Audit report exists at declared path (`.claude/knowledge-base/audits/dogfood-anchor-precycle-write-tool-verification-2026-06-04.md`)
- [x] Grep command output recorded with concrete counts (587 calls, 9+ files)
- [x] Verification outcome classified (CASE A)
- [x] NEXT-STEPS section (cycle proceeds to T0.1, no plan amendment)
- [x] `npm test` baseline unchanged (no source edits at T0.0)

## Related

- Plan: `.claude/knowledge-base/plans/dogfood-anchor-scenario-launch-plan.md` § Phase Pre-T0 / T0.0
- Edge-case review: `.claude/knowledge-base/reviews/dogfood-anchor-scenario-launch-edge-cases-2026-06-04.md` § EC-5
- ADR D1: hybrid wiring strategy (MCP-explicit-skill primary + hook-FS-mirror secondary) — VALIDATED by this audit
