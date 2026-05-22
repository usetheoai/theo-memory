# Discovery Plan: Mem0 — Extraction-Pipeline Prompt Engineering

> **FIXTURE — NOT A REAL PLAN.** Used as a positive reference example for `/discover-plan` skill validation. Structurally complete, demonstrates good practice. Citations point to plausible (not verified) paths.
>
> **Version 1.0** — Plan a focused investigation into how Mem0 engineers the LLM-extraction prompt at the heart of its six-phase write pipeline. The blueprint produced would inform TheMemory's `src/core/extraction/` prompt design.

**Slug:** `mem0-extraction-prompt`
**Owner:** TheMemory team
**Created:** 2026-05-21
**Time budget:** 3h (Mem0-only)

## Context

`docs/exploration-reports/mem0-ts.md` § 4 documented Mem0's six-phase write pipeline architecturally but did not pin down the actual extraction prompt template — the LLM call that converts "user mentioned dark mode preference" into structured Fact entries. Without the prompt, `src/core/extraction/` will be re-derived from scratch, risking divergence from Mem0's tested shape.

## Objective

Capture the exact prompt template Mem0 uses for fact extraction, identify the post-processing applied to LLM output, and surface any prompt-versioning discipline Mem0 has across model providers.

Success criteria for the blueprint:

- [ ] Verbatim quote of the extraction prompt (with citation)
- [ ] Diagram of the LLM-output → Fact conversion logic
- [ ] List of model-specific prompt overrides (if any)
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `referencia/mem0/mem0-ts/` | `src/oss/src/memory/`, `src/oss/src/llms/`, `src/oss/src/prompts/` (if exists) | Where extraction happens |

### Out-of-Scope

| Project / Subdir | Why excluded |
|---|---|
| `referencia/mem0/mem0-ts/src/client/` | API client, not extraction logic |
| `referencia/letta/`, `referencia/langmem/` | Different write architectures — separate discoveries |
| Mem0 docs and marketing | Not authoritative — code is source of truth |

## ADRs

### D1 — Time budget + stop conditions

**Decision:** 3h total, all on Mem0.

**Rationale:** Tight scope (one project, one feature). Mem0 is the locked Mem0-shape reference.

**Alternatives considered:** also include Letta extraction (rejected — separate discovery scope).

**Stop condition — per question:** 3 Fase A retries before BLOCKED.

**Stop condition — per project:** all 3h budget on this single project; if exhausted, mark remaining BLOCKED.

**Consequences:** Cross-project comparison limited; future discovery may add Letta side-by-side.

## Research Questions

| # | Question | Corner | Reference project(s) | Fase A (broad — ast-grep map) | Fase B (deep — Read at each hotspot) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | Where is the extraction prompt defined? | techniques | `referencia/mem0/mem0-ts/` | `ast-grep run --pattern 'const $NAME = `$$$`' --lang typescript referencia/mem0/mem0-ts/src/` for template literals; OR Grep `EXTRACTION_PROMPT` | Read the file(s) holding the prompt verbatim | Prompt body + citation `mem0-ts/src/.../prompts.ts:N` |
| Q2 | How is the prompt rendered with conversation context? | techniques | `referencia/mem0/mem0-ts/` | Reuse Q1 hotspots; `ast-grep run --pattern 'replace($$$)' --lang typescript` | Read the call site of the prompt render | Diagram: input → render → output |
| Q3 | What model parameters (temperature, max_tokens, etc.) does Mem0 use for extraction? | deps | `referencia/mem0/mem0-ts/` | `ast-grep run --pattern '$OBJ.generateResponse($$$)' --lang typescript referencia/mem0/mem0-ts/src/` | Read each call site for params | Table: param → value → rationale (if commented) |
| Q4 | How is extraction integration-tested? Real LLM? Stubs? | tests | `referencia/mem0/mem0-ts/` | `ast-grep run --pattern 'describe($$$, ($$$) => { $$$ })' --lang typescript referencia/mem0/mem0-ts/tests/` | Read 2-3 extraction-related test blocks | Fixture pattern + assertion style |
| Q5 | Are there test commands or local-dev scripts specific to extraction? | tools | `referencia/mem0/mem0-ts/` | SKIP Fase A — text-shape. Read `package.json` scripts; Glob for `*extraction*` | Read each found file | Step list: how to run extraction tests locally |

## Coverage Matrix

| Corner | Questions mapped | Status |
|---|---|---|
| Integration tests | Q4 | Covered |
| Dependencies | Q3 | Covered |
| Tools | Q5 | Covered |
| Techniques | Q1, Q2 | Covered |

**Coverage: 4/4 corners covered (100%)**

## Halt-loop Checkpoints

| Checkpoint | Assertion | Action if fails |
|---|---|---|
| Before answering any Q | `referencia/mem0/mem0-ts/src/` exists | Mark Q BLOCKED with reason "path not found" |
| Per-question Fase A budget | At least one hotspot OR 3 retries | BLOCKED with reason "Fase A exhausted" |
| Per-project time budget | 3h not exhausted | Mark remaining BLOCKED with reason "budget exhausted" |
| Before promising complete | All 4 corners populated AND verbatim prompt captured (Q1) | Refuse promise |

## Acceptance Criteria

- [ ] Q1-Q5 all `done` or `blocked` (with reason)
- [ ] Verbatim extraction prompt captured in blueprint
- [ ] All citations resolve via `Path.exists()`
- [ ] `/discover-confidence` ≥ SHIPPABLE_WITH_CAVEATS
- [ ] Blueprint saved at `.claude/knowledge-base/discoveries/blueprints/mem0-extraction-prompt-blueprint.md`

## Global Definition of Done

- [ ] Chain complete (plan → edge-cases → execute → confidence → improve if needed)
- [ ] No fabricated citations
- [ ] Coverage 4/4
- [ ] ADRs reference principles from `.claude/rules/`
- [ ] Recommendation surfaces prompt-template adoption decision for `src/core/extraction/`
