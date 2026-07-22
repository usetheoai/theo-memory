# Discover Edge Case Review — m12-themory-import-cli

Date: 2026-07-22
Discovery plan analyzed: `.claude/knowledge-base/discoveries/plans/m12-themory-import-cli-plan.md`
Research questions analyzed: 6
Edge cases found: 3 (MUST FIX: 1, SHOULD TEST: 1, DOCUMENT: 1)

## MUST FIX

### EC-1: Q2/Q6 cite a directory (`docs/migration`) and a multi-file dir (`docs/claude-code-kit/`)
- **Affected question:** Q2 (mem0 `docs/migration`), Q6 (kit dir)
- **Family:** Method
- **Suggested fix:** `/discover-execute` MUST `ls` the directory first, then Read the concrete file(s) — never Read a dir (same fix as M11 EC-1).

## SHOULD TEST

### EC-2: `install.sh` may have NO skills-copy mechanism today (skills/ dir does not exist in the kit)
- **Affected question:** Q6
- **Suggested halt-loop checkpoint:** if absent, the blueprint records "absent — M12 ADDS the mechanism" and proposes the copy semantics (mirroring how hooks are copied) rather than fabricating an existing one. Absence is a valid, honest answer.

## DOCUMENT

### EC-3: mem0's migrate tool is a SHELL script; ours is node
- **Accepted risk:** the comparison extracts CONCEPTS (dry-run posture, batching, limits, error reporting), never code shape. Language mismatch does not invalidate the pattern comparison (Q2's purpose is ergonomics validation).

## Summary

| Question | MUST FIX | SHOULD TEST | DOCUMENT |
|---|---|---|---|
| Q2 | EC-1 | — | EC-3 |
| Q6 | EC-1 | EC-2 | — |

**Verdict:** DISCOVERY PLAN OK (EC-1 absorbed as ls-first method; EC-2 checkpoint; EC-3 accepted).
