# Discover Edge Case Review — agentic-skill-execution-sandbox

Date: 2026-06-21
Discovery plan analyzed: .claude/knowledge-base/discoveries/plans/agentic-skill-execution-sandbox-plan.md
Research questions analyzed: 6
Edge cases found: 5 (MUST FIX: 2, SHOULD TEST: 1, DOCUMENT: 2)

## MUST FIX

### EC-1: Q5 cites a non-existent Dockerfile path
- **Affected question:** Q5 (tools — distroless fit)
- **Family:** Reference path / Citation
- **Scenario:** Q5 says read "local `packages/*/Dockerfile`". There is NO `packages/*/Dockerfile` — the distroless Docker build is at the repo ROOT `./Dockerfile`. Fase A glob returns empty → wasted retries.
- **Impact:** the distroless-fit answer (in-process native build vs network) loses its target; Q5 may BLOCK falsely.
- **Suggested fix:** change Q5's target from `packages/*/Dockerfile` to `./Dockerfile` (root, distroless Node 22 per CLAUDE.md Item 17).

### EC-2: Q3 targets the wrong file for the TS execution path
- **Affected question:** Q3 (techniques — TypeScript execution)
- **Family:** Reference path / Interpretation
- **Scenario:** Q3 implies the TS path is reachable via `local_sandbox.py` / e2b / modal. In fact Letta's `local_sandbox.py` is **Python-only** (no TS); the TS path lives in `tool_sandbox/typescript_generator.py` + `tool_sandbox/e2b_sandbox.py` (+ `base.py`). Reading `local_sandbox.py` for TS finds nothing.
- **Impact:** Q3 answers the wrong file; the real TS mechanics (codegen + e2b) are missed.
- **Suggested fix:** Q3 Fase B targets become `tool_sandbox/typescript_generator.py` + `tool_sandbox/e2b_sandbox.py` (+ the TS integration test), and explicitly note "Letta's local sandbox does NOT run TS — TS is e2b/modal-backed".

## SHOULD TEST

### EC-3: Q4 web fetch (isolated-vm / @e2b npm) may fail or return marketing
- **Affected question:** Q4 (deps — in-process option)
- **Suggested halt-loop checkpoint:** if WebFetch of `npmjs.com/package/isolated-vm` (or `@e2b/code-interpreter`) is blocked/empty after 2 tries, mark ONLY the in-process column "needs follow-up" and still answer Q4 from Letta's local e2b/modal deps — do NOT BLOCK the whole question (the out-of-process columns are answerable from the local clone).

## DOCUMENT

### EC-4: Letta's local sandbox is Python-only → in-process TS is web-only prior art
- **Accepted risk:** Letta proves OUT-of-process (subprocess/e2b/modal) execution incl. TS-via-e2b, but has NO in-process JS-isolate exemplar. The in-process option (`isolated-vm`) is therefore decision-grade from web only (per ADR D2). The blueprint MUST distinguish "Letta's cloud/subprocess TS" from "our possible offline in-process TS" — they are different threat models. This makes Q4's web research load-bearing, not merely supplementary.

### EC-5: Letta's guard mechanisms are Python-venv-shaped — not 1:1 portable to a JS executor
- **Accepted risk:** Q2's guard→mechanism table will read Python-venv/subprocess mechanisms. The 6 guards (metachar reject / shlex split / whitelist / path-confinement / timeout / output-cap / tool-call cap) must be RE-EXPRESSED for the chosen JS sandbox (e.g. isolated-vm has no shell at all → "reject shell metachars" becomes "no child_process binding"), not copied from Letta. The blueprint's guard table is a TARGET mapping, not a Letta transcription.

## Summary

| Question | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|---|---|---|---|---|
| Q1 | 0 | 0 | 0 | 0 |
| Q2 | 1 | 0 | 0 | 1 (EC-5) |
| Q3 | 1 | 1 (EC-2) | 0 | 0 |
| Q4 | 2 | 0 | 1 (EC-3) | 1 (EC-4) |
| Q5 | 1 | 1 (EC-1) | 0 | 0 |
| Q6 | 0 | 0 | 0 | 0 |

**Verdict:** DISCOVERY PLAN NEEDS ADJUSTMENT (2 MUST FIX — both citation/target corrections; absorb into v1.1, then /discover-plan-confidence).
