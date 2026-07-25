---
slug: system-llm-eval
generated_by: roadmap-feature
milestone_id: M21
date: 2026-07-25
status: completed
---

# Feature grill — system-llm-eval (M21)

## Q1 — What is this feature and why now?

**Answer:** An **LLM-stage evaluation harness** — focus on the pipeline steps that call an LLM:
fact **extraction**, **reflect** (consolidation), **distill** (episodic→semantic), and **conflict
resolution**. Measures precision/recall/accuracy against **hand-annotated golden fixtures**.
Requires a real LLM key to run → **conditional CI gate** (runs only when `OPENAI_API_KEY` /
`OPENROUTER_API_KEY` is present).

**Why now:** the LLM pipeline (extraction v0.1+, reflect v0.4a, distill v0.7, conflict-resolution
v0.7, LLM re-extraction M13/#111) is shipped and load-bearing, but its quality is only spot-checked
by hand-authored one-off fixtures inside unit tests. There is **no repeatable, versioned eval** that
tells us whether a prompt change or model swap regresses extraction/reflect/distill quality. This is
the missing regression guard for the highest-variance part of the system.

**Scope note (honesty / ADR-0020):** this is an INTERNAL quality eval, NOT a comparative
"faster-than" benchmark. It does NOT re-introduce the removed v0.8 comparative benchmark and does
NOT make any comparative public claim. `public-copy.md § 4` is untouched.

## Q3 out-of-scope cross-check

No overlap with declared out-of-scope items (graph-DB backend, wrapping competitors,
maintained-on-write summaries). No removal needed.

## Q2 — Dependencies
none blocking (M13 semantic anchor — LLM pipeline shipped and stable; eval is read-only over it).

## Q3 — Definition of Done
Full: golden datasets per LLM stage (extraction/reflect/distill/conflict) + runner emitting precision/recall/accuracy per stage + versioned baseline (regression fails gate, band tolerance) + conditional CI gate (runs with LLM key, honest SKIP without) + repro README. See ROADMAP.md M21.

## Q4 — Top 2 new risks
1. LLM non-determinism → flaky eval. Mitigate: temperature=0, tolerance band, N>=3 runs near threshold.
2. Cost/secret in CI + baseline-as-theatre. Mitigate: gate strictly conditional on key (honest SKIP), secret env-only, baseline changes require PR justification.

## Step 5 — SOTA delta
SKIPPED: DoD is self-contained golden-fixture eval (KISS); no framework adoption (RAGAS/promptfoo), so no new reference peer needed.
