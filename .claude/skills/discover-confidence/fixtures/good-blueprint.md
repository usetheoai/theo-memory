# Blueprint: Reference Implementations Survey — Memory Layer

> **Version 1.0** — A consolidated technical blueprint capturing how Mem0, Letta, and LangMem implement memory primitives. Output of `/discover-execute reference-memory-survey`.

**Slug:** `reference-memory-survey`
**Source plan:** `.claude/knowledge-base/discoveries/plans/reference-memory-survey-plan.md`
**Owner:** TheMemory team
**Generated:** 2026-05-21 via `/discover-execute`
**Confidence verdict:** PROVISIONAL (awaiting `/discover-confidence`)

## Context

TheMemory enters a market where three open-source players already implement memory primitives at different abstraction levels. This blueprint surveys their integration-test patterns, dependencies, tooling, and core techniques to feed concrete architectural decisions for `@usetheo/memory`. The investigation targets the three repos cloned under `referencia/` (`referencia/mem0/README.md`, `referencia/letta/README.md`, `referencia/langmem/README.md`).

## Objective

Produce a side-by-side reference that lets TheMemory decide which integration-test pattern, dependency profile, and dev-tooling story to adopt for v0.1 of the contract — informed by what already works in production-shaped projects.

## Coverage Corner 1 — Integration Tests

### Mem0

Mem0 ships a multi-package monorepo with the TypeScript surface under `vercel-ai-sdk`. The package metadata sits at `referencia/mem0/vercel-ai-sdk/package.json` and the contributor guide describes the integration setup at `referencia/mem0/CONTRIBUTING.md`. The migration guide at `referencia/mem0/MIGRATION_GUIDE_v1.0.md` documents how integration coverage evolved between v0 and v1.0.

### Letta

Letta lives as a single Python package. Its integration coverage is anchored at `referencia/letta/test_watchdog_hang.py` (a regression case for a specific concurrency hang) and the contributor guidance at `referencia/letta/CONTRIBUTING.md` is mandatory reading before any blueprint-level decision. Package surface is declared in `referencia/letta/pyproject.toml`.

### LangMem

LangMem uses pytest with property-based testing. Its test fixtures live under `referencia/langmem/tests/conftest.py` and at least one docstring-as-test pattern is captured at `referencia/langmem/tests/test_docstring_examples.py`. The project's test entrypoint contract is defined at `referencia/langmem/pytest.ini`.

## Coverage Corner 2 — Dependencies

### Mem0

Mem0's TypeScript surface dependencies live in `referencia/mem0/vercel-ai-sdk/package.json`. The Vercel AI SDK integration is the canonical example of how Mem0 wires into a host runtime — captured in the surface documentation at `referencia/mem0/vercel-ai-sdk/README.md`.

### Letta

Letta's runtime dependencies are pinned in `referencia/letta/pyproject.toml`. The lockfile-equivalent and JSON-side metadata appear at `referencia/letta/project.json` and `referencia/letta/package-lock.json` (for the auxiliary Node tooling).

### LangMem

LangMem uses `uv` as the lockfile manager. Runtime dependencies are pinned at `referencia/langmem/pyproject.toml` and the resolved set is locked at `referencia/langmem/uv.lock`. LangGraph integration metadata is at `referencia/langmem/langgraph.json`.

## Coverage Corner 3 — Tools

### Mem0

Local-dev story documented at `referencia/mem0/README.md`. Contributor tooling at `referencia/mem0/CONTRIBUTING.md`. Agent-mode operating notes at `referencia/mem0/AGENTS.md` and `referencia/mem0/LLM.md`.

### Letta

Letta dev-loop instructions at `referencia/letta/README.md`. Security policy at `referencia/letta/SECURITY.md` documents the supported attack surface. License terms at `referencia/letta/TERMS.md` (relevant when choosing what to borrow into a community-auxiliary MIT codebase).

### LangMem

LangMem uses a `Makefile` for the tool entry points — `referencia/langmem/Makefile` lists every dev command. README onboarding at `referencia/langmem/README.md`.

## Coverage Corner 4 — Techniques

### Memory write pipeline

The three projects diverge on how facts get into the store:

- Mem0 uses a multi-phase LLM-extraction pipeline (documented at high level in `referencia/mem0/README.md`).
- Letta operates on an agent state-machine model (documented in `referencia/letta/README.md`).
- LangMem treats procedural memory as graph nodes (documented in `referencia/langmem/README.md`).

### Test discipline

Each project anchors its test discipline differently. Mem0's CONTRIBUTING (`referencia/mem0/CONTRIBUTING.md`) emphasises end-to-end smoke. Letta's CONTRIBUTING (`referencia/letta/CONTRIBUTING.md`) emphasises regression catches like the watchdog hang at `referencia/letta/test_watchdog_hang.py`. LangMem (`referencia/langmem/tests/test_docstring_examples.py`) leans on docstring-as-test which doubles as documentation.

## Cross-cutting Comparison

| Dimension | Mem0 | Letta | LangMem |
|---|---|---|---|
| Test pyramid anchor | smoke + e2e via `referencia/mem0/CONTRIBUTING.md` | regression-first per `referencia/letta/test_watchdog_hang.py` | property + docstring per `referencia/langmem/tests/conftest.py` |
| Primary deps file | `referencia/mem0/vercel-ai-sdk/package.json` | `referencia/letta/pyproject.toml` | `referencia/langmem/pyproject.toml` + `referencia/langmem/uv.lock` |
| Dev tooling entrypoint | npm scripts in `referencia/mem0/vercel-ai-sdk/package.json` | none unified (manual venv) | `referencia/langmem/Makefile` |
| Signature pattern | LLM-extraction multi-phase | agent-state machine | graph-based procedural memory |

## ADRs

### D1 — Adopt Mem0's multi-phase LLM-extraction shape

**Decision:** TheMemory v0.1 adopts Mem0's multi-phase write pipeline (context gathering → existing-memory retrieval → single LLM extraction → batch embed → hash dedup → batch persist) as documented in the exploration report at `referencia/mem0/README.md` and the lock summary in our `CLAUDE.md`.

**Rationale:** Mem0 has the closest shape to TheMemory's contract. Letta's agent-state model and LangMem's graph procedural model would force a re-architecture of `src/core/`. Going with Mem0-shape (not Mem0-clone) lets us absorb their pipeline without inheriting their dependency footprint.

**Alternatives considered:** (a) Letta's state-machine — rejected, too far from our three-tier contract; (b) LangMem's graph model — deferred to v0.4 (reflection).

**Consequences:** v0.1 implementation can lean on documented patterns; we must port the extraction prompt template into our own LLM provider abstraction.

### D2 — Pin pyproject.toml shape for our Python tool surface

**Decision:** The Python tools under `.claude/skills/` track a single `pyproject.toml` per skill, mirroring Letta's `referencia/letta/pyproject.toml` simplicity rather than uv-lock complexity from `referencia/langmem/uv.lock`.

**Rationale:** Our Python surface is small (plan-confidence + discover-confidence + discover-improve). uv.lock is overkill; `pyproject.toml` alone is sufficient and matches what plan-confidence already does.

**Alternatives considered:** (a) full uv.lock per skill — rejected as YAGNI; (b) no pyproject.toml, pip install on-the-fly — rejected, blocks `setup.sh` from doing version checks.

**Consequences:** Skill maintainers pin minimal deps in `pyproject.toml`; CI installs via `pip install -e`.

## Recommendations for TheMemory

| # | Recommendation | Linked to | Priority |
|---|---|---|---|
| 1 | Implement the Mem0 multi-phase write pipeline in `src/core/extraction/` | Q1, D1, architecture.md § DIP boundaries | HIGH |
| 2 | Adopt regression-first test discipline borrowed from Letta's pattern | Q5, testing.md § Pyramid | HIGH |
| 3 | Defer LangMem-style graph procedural memory to v0.4 (reflection) | D1 (alternatives), CLAUDE.md § Roadmap | MEDIUM |
| 4 | Skip uv.lock complexity; stay on plain pyproject.toml for skill Python surface | D2 | LOW |

## Blocked questions

None — every question in the source plan was answerable from the cloned repos.

## Halt-loop progress (audit trail)

- Iterations used: 6 / 30
- Questions answered: 8 / 8
- Questions blocked: 0
- Citations verified: 21 / 21
- Promise emitted at iteration: 6

## Related

- Discovery plan: `.claude/knowledge-base/discoveries/plans/reference-memory-survey-plan.md`
- Confidence report: `.claude/knowledge-base/reviews/reference-memory-survey-confidence-2026-05-21.md`
- Linked TheMemory rules: `.claude/rules/architecture.md`, `.claude/rules/testing.md`, `.claude/rules/public-copy.md`
