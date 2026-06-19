# Discovery Plan: skills-write-surface

> **Version 1.0** — slug `skills-write-surface` — owner: project owner (CTO `/goal` 2026-06-19) — created 2026-06-19.

## Context

The read-only skills browse just shipped (theo-memory v0.8.0 + theo-cloud v0.2.0). The CTO directive (`/goal` 2026-06-19) extends the skills unfreeze to the **programmatic WRITE surface** (CLAUDE.md Amendment 2026-06-19 (II)): REST `POST /v1/scopes/skill/:repoId/skills`, MCP `add_skill`, and forget curation through the gateway + a delete control in the dashboard. The closed loop it enables is the canonical Voyager flow: an **agent** (against TheoCloud/MCP) authors its own skills, instead of skills being SDK-in-process-only.

The plumbing (client triad, BFF mint→delegate, `{subject}:{repoId}` namespacing, `RequireScope`) is ESTABLISHED by the read cycle. What is genuinely unknown and worth investigating BEFORE writing code: the **write-boundary validation/security posture** (what to validate, dedup-collision UX, how competitors govern skill *authoring* + *deletion*, and the firm "store-only, no sandbox" line). Skills are **executable code**, so the write boundary is security-load-bearing — this discovery de-risks it.

## Objective

Produce a blueprint that locks: (1) the skill-write-boundary validation contract (what `assertSkillArgs` already covers + what the REST/MCP layer must add — size cap, dedup-collision HTTP status), (2) the borrow-vs-reject decision against Letta's tool-authoring governance (upsert + name-lock + **sandbox**, which we reject), (3) the MCP `add_skill` tool shape, (4) the integration-test shape to mirror. Success = every research question answered with a citation resolving in `.claude/knowledge-base/references/` or the local `packages/**` tree, all four corners populated.

## In-scope / Out-of-scope

**Reference projects (read-only study):**
- `.claude/knowledge-base/references/letta/` — IN: `letta/services/tool_manager.py` (tool authoring/governance: create_or_update, name-conflict lock, delete), `tests/managers/test_tool_manager.py`. OUT: everything else under `letta/` (agent loop, summarizer, etc. — not authoring).
- `.claude/knowledge-base/references/mem0/` — IN: only as a secondary check that Mem0 has NO executable-skill concept (negative evidence for the competitive claim). OUT: the rest.
- **langmem — DEFERRED** (not cloned locally; see ADR D3).

**Local TheMemory code (not a reference clone, but the integration target):** `packages/core/src/infrastructure/db/skill-store-args.ts`, `packages/core/src/domain/errors.ts` (InvalidSkillError), `packages/api/src/server/handlers/{remember,forget,skills}.ts`, `packages/mcp/src/tools/` (existing tool shape). These are read to anchor the mirror.

## ADRs

### D1 — Time budget + per-question stop condition

- **Decision:** total budget ~2h; per reference project — Letta 1h, Mem0 15min (negative-evidence only), local code 45min. Per-question stop: if a cited path does not yield the answer after 2 read/grep passes, mark the question `blocked` with reason and move on (do NOT spelunk indefinitely).
- **Rationale:** the plumbing is already known; this discovery targets a few novel decisions, not a greenfield survey. A tight budget prevents over-research of a mostly-symmetric feature.
- **Alternatives considered:** (a) full multi-project survey — REJECTED (most of the surface is established by the read cycle; YAGNI); (b) skip discovery entirely and go straight to plan — REJECTED (the directive mandates discover, and the write-boundary security posture genuinely benefits from the Letta governance study).
- **Consequences:** the blueprint is focused (write-boundary + governance + MCP shape + tests), not exhaustive.

### D2 — Investigation depth: governance + validation, not execution

- **Decision:** investigate skill AUTHORING + DELETION governance + write-boundary VALIDATION only. Explicitly do NOT investigate skill EXECUTION/sandboxing (Letta's modal/e2b wrappers) beyond confirming they exist as the thing we reject.
- **Rationale:** the scope guardrail is STORE-only (CLAUDE.md Amendment II — no executor/sandbox). Researching execution depth would be researching a non-goal.
- **Alternatives considered:** (a) investigate sandbox options (e2b/modal) for a future executor — REJECTED (out of scope; YAGNI; the security line is firm).
- **Consequences:** the blueprint will cite Letta's sandbox as rejected prior art, not as a borrow.

### D3 — langmem corner deferral

<!-- DEFER-CORNER: none — all 4 corners are populated; langmem is simply not cloned -->
- **Decision:** langmem is not used as a reference (not cloned at `.claude/knowledge-base/references/`). Letta + Mem0 + local code cover all four corners.
- **Rationale:** citing a non-existent clone path would trip the fabricated-citation hard cap. Letta is the load-bearing authoring reference; langmem (procedural-via-prompt-rewrite) is not about executable-code authoring.
- **Alternatives considered:** clone langmem — REJECTED (out of scope; Letta suffices for the authoring/governance question).
- **Consequences:** no langmem citations appear in the blueprint.

## Research Questions

| # | Question | Corner | Fase A (method) | Fase B (deeper) | Expected answer shape |
|---|---|---|---|---|---|
| Q1 | How does Letta govern tool/skill AUTHORING (create vs upsert-by-name) and what conflict/locking semantics does it use? | techniques | Read `.claude/knowledge-base/references/letta/letta/services/tool_manager.py` (`create_or_update_tool_async`, `create_tool_async`, `_check_tool_name_conflict_with_lock_async`) | Grep `name_exists`/`conflict`/`lock` in the same file | Prose + cited line refs: upsert-by-name vs create-distinct + how conflicts resolve → informs our dedup-collision decision |
| Q2 | How does Letta govern tool DELETION, and does authoring pull a sandbox (the thing we reject)? | techniques | Read `tool_manager.py` (`delete_tool`/`modal_tool_wrapper`) | Grep `modal`/`e2b`/`sandbox` in `tool_manager.py` | Prose + line refs: delete semantics + confirmation that execution uses a sandbox we explicitly will NOT add |
| Q3 | What validation does TheMemory's skill-write boundary ALREADY enforce, and what must the REST/MCP layer add (size cap, dedup-collision → HTTP status)? | techniques | Read `packages/core/src/infrastructure/db/skill-store-args.ts` + `packages/core/src/domain/errors.ts` (InvalidSkillError reasons) + `scoped-skill-memory.ts:add` (UNIQUE(hash) collision) | Grep `UNIQUE`/`hashFact`/`code` length in core | Table: validation already covered (empty-description, invalid-code-language) vs to-add (code size cap; dedup-collision → 409 vs 200-idempotent) |
| Q4 | What is the registration shape for a new MCP tool, to mirror for `add_skill`? | tools | Read `packages/mcp/src/tools/dispatch.ts` + `remember-handler.ts` + `forget-handler.ts` + `packages/mcp/src/server.ts` (static tool list, ADR D2) | Grep `TOOL_NAME`/`inputSchema`/`HANDLERS` in `packages/mcp/src` | Step list: add handler + schema + dispatch entry + list-handler entry; static list invariant |
| Q5 | How are the existing `POST /v1/remember` + skills `getAll` tested against real pgvector, to mirror for skill POST + skill forget? | tests | Read `tests/integration/skills/listing.test.ts` + grep existing remember/forget integration tests | Read the api unit-test stub shape in `packages/api/src/server/__tests__/skills.test.ts` | Test plan: real-pgvector add→list→forget round-trip + api unit stub for POST/delete |
| Q6 | Confirm zero new dependencies (does the write path need anything Letta pulls, e.g. modal/e2b)? | deps | Grep `modal`/`e2b`/`sandbox`/`import` in `letta/services/tool_manager.py` | Read TheMemory `package.json` deps (pg/zod/hono already present) | Confirmation: STORE-only path reuses pg/zod/hono/chi/pgx; NO new dep; Letta's sandbox deps are the rejected delta |

## Coverage Matrix

| Corner | Questions | Status |
|---|---|---|
| techniques | Q1, Q2, Q3 | covered (3 — at cap) |
| tools | Q4 | covered |
| tests | Q5 | covered |
| deps | Q6 | covered |

All 4 corners populated; 6 questions total (within [5,10]); ≤3 per corner. No DEFER-CORNER needed.

## Halt-loop checkpoints

- Before marking Q1/Q2 done: the cited `tool_manager.py` line refs must resolve (the symbol exists at the cited line ±20).
- Before marking Q3 done: the InvalidSkillError reasons + the UNIQUE(hash) collision path must be quoted from the local tree.
- Before marking Q4 done: the dispatch HANDLERS map + a concrete existing handler (remember) must be quoted as the mirror template.
- Before marking Q6 done: a grep for `modal|e2b|sandbox` in `tool_manager.py` must return hits (confirming Letta's sandbox) AND TheMemory `package.json` must be confirmed to need none.

## Acceptance Criteria

- All 6 questions answered OR honestly `blocked` with reason.
- Every citation resolves (a real path under the letta reference clone or the local `packages/**` tree).
- All four coverage corners populated.
- The blueprint locks: dedup-collision HTTP-status decision (409 vs idempotent), code size cap value, MCP `add_skill` shape, and the store-only/no-sandbox line with Letta sandbox cited as rejected prior art.
- ≥ 1 ADR in the resulting blueprint.

## Global Definition of Done

Per `.claude/rules/discover-blueprint-golden-rule.md` + `discover-plan-golden-rule.md`: blueprint reaches `/discover-confidence` ≥ SHIPPABLE_WITH_CAVEATS; no fabricated citation; 4 corners non-empty.
