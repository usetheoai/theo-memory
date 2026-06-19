# Blueprint: skills-write-surface

> Discovery output for the programmatic skills WRITE surface (REST `POST` + MCP `add_skill` + forget curation). Source plan: `.claude/knowledge-base/discoveries/plans/skills-write-surface-plan.md`. Executed in-context (6 questions / 2 references — fits one context per `loop-engine-convention.md § most-constrained-mechanism`).

## Context

The read-only skills browse shipped (theo-memory v0.8.0 + theo-cloud v0.2.0). The CTO `/goal` (2026-06-19) extends the unfreeze to the WRITE surface so an **agent** can author its own skills (the Voyager flow), not just read them. Skills are executable code, so the write boundary is security-load-bearing — this discovery de-risks the validation/governance posture before code. Evidence that triggered it: the design discussion 2026-06-19 concluded "UI-create of code is the wrong move; the agent authors via REST/MCP, the human curates (delete)".

## Objective

Lock, for the implementation plan: (1) the dedup-collision HTTP status (→ 409), (2) the code size cap + the reused domain validation, (3) the MCP `add_skill`/`forget_skill` tool shape, (4) the store-only/no-sandbox line with Letta's modal sandbox as cited rejected prior art, (5) the integration-test shape to mirror. Success = all four corners populated with resolving citations + the decisions above are unambiguous for `/to-plan`.

## Summary

The write surface is **store-only** exposure of the already-shipped `ScopedSkillMemory.add()`/`forget()` over REST + MCP + gateway + a dashboard delete control. The plumbing is symmetric to the just-shipped read cycle; the genuinely novel decisions are (1) the **dedup-collision HTTP status** (→ **409**, first-write-wins), (2) a **code size cap** at the write boundary, (3) the **store-only / no-sandbox** line (Letta's modal sandbox is cited as rejected prior art), (4) the **MCP `add_skill` (+ `forget_skill`)** tool extension to the static list. Zero new dependencies.

## Coverage Corner 1 — Integration Tests

**Q5 — How to test skill POST + forget against real pgvector?** Mirror the read cycle's `tests/integration/skills/listing.test.ts` (real `ankane/pgvector:v0.5.1`, gated by `THEOMEM_PG_URI`, EC-17 loud-fail). The write tests:
- **POST round-trip:** `POST /v1/scopes/skill/:repoId/skills` (via `createServer`) → assert 201 + the skill appears in a subsequent `getAll()` with the right fields.
- **Dedup-collision:** POST the same `description` twice → second returns **409** (not 500-raw-PG).
- **Validation:** empty `description` → 422; `codeLanguage` not in `{typescript,javascript}` → 422; oversized `code` → 413/422.
- **Forget round-trip:** add skill → `forget` → `getAll()` no longer returns it; cross-repo forget of another repo's skill → `MemoryNotFound` (404).
- **api unit:** mirror `packages/api/src/server/__tests__/skills.test.ts` stub shape (stub `memory.skills(repoId).add`/`forget`) for handler-level 201/409/422/404 + workspace-bound resolution (EC-1 parity).

Citations: `tests/integration/skills/listing.test.ts`, `packages/api/src/server/__tests__/skills.test.ts`.

## Coverage Corner 2 — Dependencies

**Q6 — Any new dep?** NO. The store-only path reuses `pg` + `zod` + `hono` (theo-memory) and `chi/v5` + `pgx` (theo-cloud) — all already present. Letta's authoring path imports a sandbox stack (`letta/letta/services/tool_manager.py:58` `import modal`; `:28` `generate_modal_function_name`; `:35` `SandboxType`) for **execution** — exactly the delta we REJECT (store-only, no executor). Confirming the rejection keeps our dependency tree unchanged and avoids the e2b/modal blast radius.

Citations: `.claude/knowledge-base/references/letta/letta/services/tool_manager.py:28,35,58`.

## Coverage Corner 3 — Tools

**Q4 — MCP `add_skill` registration shape.** The MCP server ships a static tool list (`packages/mcp/src/tools/list-handler.ts` — "4 locked tools remember/recall/forget/reflect in declaration order", `listChanged:false`, ADR D2). A new tool mirrors `remember-handler.ts`: a `{TOOL_NAME, INPUT_SCHEMA}` schema module + a handler module + a `HANDLERS` map entry in `dispatch.ts` (`packages/mcp/src/tools/dispatch.ts:25` `[REMEMBER, rememberHandler]`) + a list-handler entry. For skills:
- **`add_skill`** — input `{ repoId, code, description, codeLanguage }`; calls `memory.skills(repoId).add(draft)`; returns the created skill id/hash. Dedup-collision → a typed MCP error (not a raw throw).
- **`forget_skill`** (curation) — input `{ repoId, skillId }`; calls `memory.skills(repoId).forget(skillId)`.

These EXTEND the static list (5-6 tools). Honest contract note: the "4 locked tools" set grows — pre-release acceptable, and the server already supports tool-set variation (the OpenMemory compat alternate set). Per ADR D2's `listChanged:false`, the list stays static (no dynamic registration).

Citations: `packages/mcp/src/tools/dispatch.ts:20,25`, `packages/mcp/src/tools/remember-handler.ts:20,34`, `packages/mcp/src/tools/list-handler.ts:4-8`, `packages/mcp/src/server.ts`.

## Coverage Corner 4 — Techniques

**Q1 — Letta tool authoring governance.** `create_or_update_tool_async` (`tool_manager.py:211`) is **upsert-by-name** with a `bypass_name_check` flag, delegating to `_atomic_upsert_tool_postgresql` (`:246`) and a name-conflict lock (`_check_tool_name_conflict_with_lock_async`, `:583`). Letta resolves "same name" as UPDATE-in-place (last-write-wins on name).

**Q2 — Letta deletion + sandbox.** Authoring marks `metadata_["sandbox"]="modal"` (`:303`) and execution runs through `modal_tool_wrapper` (`:50`, `import modal` `:58`, `sandbox_env_vars` `:75`). Letta's model = author code → execute in a **modal sandbox**. We adopt the *authoring/upsert governance idea* but REJECT the sandbox/execution (store-only).

**Q3 — TheMemory's skill-write boundary (what exists vs to-add).** Existing domain validation (`packages/core/src/domain/errors.ts:340-356` `InvalidSkillError`): `empty-description`, `invalid-code-language`. The `add()` derives identity from `hashFact(description)` and **same-description collides on `UNIQUE(hash)`** (`packages/core/src/infrastructure/db/scoped-skill-memory.ts:96-101`) — surfacing a **raw Postgres unique-violation** (no domain wrapper today).

**Decision matrix (what the write boundary must do):**

| Concern | Already covered | To add at REST/MCP boundary |
|---|---|---|
| empty description | `InvalidSkillError('empty-description')` (store) | map → **422** at REST |
| invalid codeLanguage | `InvalidSkillError('invalid-code-language')` (store) | map → **422** at REST |
| code size | — | **MAX_SKILL_CODE_BYTES cap** (e.g. 64 KiB) → **413/422** (DOS guard, mirrors remember's body-limit) |
| dedup-collision (same description) | raw PG unique-violation (23505) | catch → **409 SKILL_ALREADY_EXISTS** (first-write-wins; honest — caller knows it collided). NOT 200-idempotent, because the codes may differ and silently dropping the new code would be dishonest. |
| workspace isolation | `this.filters` workspace_id (EC-1) | resolve via `workspaceBoundMemory` (parity with read handler) |
| multi-tenant repoId | D3 `{subject}:{repoId}` namespacing | reuse gateway namespacing from read cycle |

Citations: `.claude/knowledge-base/references/letta/letta/services/tool_manager.py:50,211,246,303,583`, `packages/core/src/domain/errors.ts:340-356`, `packages/core/src/infrastructure/db/scoped-skill-memory.ts:96-101`.

## Cross-cutting Comparison

How skill/tool AUTHORING + GOVERNANCE differs across the references vs the TheMemory direction:

| Dimension | Letta | Mem0 | TheMemory (this blueprint) |
|---|---|---|---|
| Has executable-skill concept? | Yes (tools) | **No** (facts/memories only) | Yes (Repo-tier skills) |
| Authoring conflict policy | upsert-by-name, last-write-wins (`tool_manager.py:211,583`) | n/a | ADD-only; same-description → **409** (first-write-wins); replace = forget+add (D1) |
| Execution | **modal sandbox** (`tool_manager.py:50,58`) | n/a | **none — store-only** (D2; sandbox rejected) |
| Deletion/curation | delete by id | delete memory | `skills(repoId).forget(skillId)` + UI delete control (D2) |
| New deps for authoring | modal/e2b sandbox stack | — | **zero** (reuse pg/zod/hono/chi/pgx) |

The competitive takeaway: Mem0/Zep have no executable-skill authoring at all; Letta has it but couples it to a sandbox runtime. TheMemory offers skill authoring **decoupled from execution** (store-only) — the agent owns its own runtime. This is the differentiator, kept honest by the no-sandbox line.

## ADRs

### D1 — Dedup-collision → 409, NOT idempotent-200

- **Decision:** `POST` with a `description` that collides on `UNIQUE(hash)` returns **409 SKILL_ALREADY_EXISTS** (first-write-wins; the existing skill is unchanged).
- **Rationale:** the hash is derived from `description` only; two posts with the same description but DIFFERENT code would, under idempotent-200, silently drop the new code — dishonest (Rule 3). 409 tells the caller "a skill with this description exists; revise the description to store a variant" (matches the SDK's documented contract).
- **Alternatives:** (a) 200-idempotent — REJECTED (silent code drop); (b) upsert/overwrite (Letta's last-write-wins) — REJECTED (skills are ADD-only per architecture; overwrite loses provenance; use forget+add to replace).
- **Consequences:** the REST handler must catch the raw PG unique-violation (code 23505) and map to 409. A small domain wrapper (`SkillAlreadyExists`) MAY be added at the store for clean typing.

### D2 — Store-only; NO executor/sandbox (Letta modal cited as rejected prior art)

- **Decision:** the write surface STORES code-as-skill; it never executes it. No e2b/modal/sandbox dependency, no UI code editor.
- **Rationale:** scope guardrail (CLAUDE.md Amendment II); skills execute inside the consuming AGENT's own runtime, not TheMemory. Adding execution = RCE surface + heavy deps.
- **Alternatives:** Letta's modal sandbox (`tool_manager.py:50`) — REJECTED (out of scope; security line).
- **Consequences:** TheMemory remains a store; the agent owns execution.

### D3 — MCP adds `add_skill` + `forget_skill` to the static list (no dynamic registration)

- **Decision:** extend the static MCP tool list with `add_skill` + `forget_skill`; keep `listChanged:false`.
- **Rationale:** mirrors the existing 4-verb static shape (ADR D2); dynamic registration is unnecessary (YAGNI).
- **Alternatives:** dynamic tool registration — REJECTED (YAGNI, contract churn).
- **Consequences:** the "4 locked tools" descriptor grows; pre-release acceptable; document in locked-names.

## Recommendations for TheMemory

| # | Recommendation | Linked to | Priority |
|---|---|---|---|
| 1 | REST `POST /v1/scopes/skill/:repoId/skills` reusing the read handler's workspace-bound + namespacing path; body=`SkillDraft`; 201/409/422/413. | Q3, D1, D2 | HIGH |
| 2 | Catch PG unique-violation → 409 `SKILL_ALREADY_EXISTS` (optionally a `SkillAlreadyExists` domain wrapper at the store). | Q3, D1 | HIGH |
| 3 | MCP `add_skill` + `forget_skill` mirroring `remember-handler`/`forget-handler` + dispatch + list-handler. | Q4, D3 | HIGH |
| 4 | Gateway: `POST /v1/memory/skills` (memory:write) + BFF `POST /v1/dashboard/memory/skills`; skill-forget path (memory:delete). Reuse D3 namespacing. | Q4 | HIGH |
| 5 | Dashboard: a **delete (forget) curation** control on the Skills tab (ConfirmDialog, like Entities cascade). NO code editor. | D2 | MEDIUM |
| 6 | `MAX_SKILL_CODE_BYTES` cap (e.g. 64 KiB) at the write boundary (DOS guard). | Q3 | MEDIUM |

## Blocked questions

(none — all 6 answered with verified citations)

## Halt-loop progress (audit trail)

- Execution mode: in-context (not ralph-loop) per `loop-engine-convention.md`.
- Questions answered: 6 / 6. Blocked: 0.
- Citations verified: all letta reference-clone + local `packages/**` paths confirmed on disk (the line refs resolve within ±20).
- Coverage corners populated: 4 / 4 (tests, deps, tools, techniques).

## Related

- Discovery plan: `.claude/knowledge-base/discoveries/plans/skills-write-surface-plan.md`
- Predecessor (read cycle): `.claude/knowledge-base/plans/dashboard-phase2b-skills-browse-plan.md`
- Linked rules: `.claude/rules/architecture.md` (ADD-only, HTTP-seam), CLAUDE.md Amendment 2026-06-19 (II)
