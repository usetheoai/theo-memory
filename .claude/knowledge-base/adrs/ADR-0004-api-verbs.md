# ADR-0004: API verbs (`remember / recall / forget / reflect` + parity helpers)

- **Status:** Accepted
- **Date:** 2026-05-22
- **Plan:** [`memory-contract-v0-0-plan.md`](../plans/memory-contract-v0-0-plan.md) § ADRs § D4
- **Owner:** TheMemory v0.0 contract design

## Context

The public verb vocabulary IS the user-facing copy of the library. Verb choices drive marketing language, IDE autocomplete discoverability, mental model, and downstream binding ergonomics. CLAUDE.md § Locked names ratified four headline verbs:

- `remember(text, options?)` — adds memory
- `recall(query, options?)` — retrieves memory
- `forget(memoryId)` — removes memory (soft or hard)
- `reflect(options?)` — runs consolidation cycle

These four are aspirational and align with cognitive-science framing ("remember + recall + forget + reflect"). They contrast with Mem0's developer-mechanical verbs (`add` / `search` / `delete`).

The remaining question is **parity helpers**: Mem0's `get / getAll / history / reset` are practical for Mem0 emigrants, but they don't fit the four-verb headline. Should they ship at v0.0?

## Decision

Public verbs are exactly:

1. `remember(text, options?)` — write new memory (extraction-driven; `infer: false` for caller-supplied)
2. `recall(query, options?)` — retrieve via semantic + BM25 + entity boost
3. `forget(memoryId, options?)` — remove (soft via `tInvalid` by default; hard via `{ hard: true }`)
4. `reflect(options?)` — run consolidation (explicit-call only at v0.0; see ADR-0005)

**Plus four parity helpers** (kept for Mem0 emigrants and admin paths, not headline copy):

5. `get(memoryId)` — fetch a single memory by id
6. `getAll(scope, options?)` — list all memories in scope (paginated)
7. `history(memoryId)` — audit trail for a memory (timestamps + actions)
8. `reset(scope)` — administrative wipe of a scope (requires explicit scope; no implicit cross-scope reset)

The four headline verbs appear on both `Memory` (top-level) and `ScopedMemory` (sub-objects). Parity helpers appear on `Memory` only (`forget`, `get`, `history`, `reset`) or both, depending on whether scope is required:

- `forget(memoryId)` — top-level only (memoryId is globally unique; scope inferred from data)
- `get(memoryId)` / `history(memoryId)` — top-level only (same reason)
- `getAll(scope, options?)` — top-level OR `ScopedMemory.getAll(options?)` (scoped variant inherits scope)
- `reset(scope)` — top-level only (explicit scope required)

## Consequences

**Positive:**

- Marketing copy aligns with API: "TheMemory remembers what your agent learned across sessions, automatically." No verb mismatch.
- Aspirational voice in HERO/BODY (per `public-copy.md § 1`) maps directly to the four headline verbs.
- Mem0 emigrants find familiar `get / getAll / history / reset` in DEEP DIVE docs; the API doesn't force them to learn a new vocabulary for admin paths.
- IDE autocomplete on `memory.user('alice').` surfaces only the relevant scoped verbs (no `delete` cluttering the namespace).

**Negative:**

- The four headline verbs cannot be renamed without strategic review (CLAUDE.md § Locked names — all four are marked "strategic? = yes").
- Documentation must teach the cognitive-science framing to users coming from Mem0/Letta. "Why is it `remember` and not `add`?" is a recurring FAQ.
- Slight verb-count bloat (8 verbs total) — but the headline four are highlighted in copy; the parity four live in DEEP DIVE.

**Reversibility:**

- Effectively NO after v1.0 publish. The verbs become contract.
- Adding new verbs at v1.1+ is forward-compatible (additive).

## Alternatives

| Alternative | Verdict | Why rejected |
|---|---|---|
| **Mem0 verbs verbatim** (`add` / `search` / `delete`) | Rejected | Public copy commitment is "remember / recall / forget / reflect". Mem0 framing is developer-mechanical; ours is aspirational-cognitive. Different value prop. |
| **CRUD-style** (`create` / `read` / `update` / `delete`) | Rejected | Collides with ADR-0003 (no `update`). Loses cognitive-science framing that justifies "Memory" branding. |
| **Drop parity helpers entirely** (`get` / `getAll` / `history` / `reset` removed) | Rejected | Admin paths (debugging, GDPR-style wipe, audit) need the helpers. Mem0 emigrants need familiar names. The headline verbs aren't enough for ops. |
| **Different cognitive verbs** (`recall` → `lookup` / `find`) | Rejected | "Recall" is the cognitive-science term that pairs with "remember". Drift loses the framing. |

## References

- `.claude/rules/public-copy.md § 5` — public copy headlines align with the locked verbs.
- `CLAUDE.md § Locked names` — all four headline verbs flagged strategic.
- ADR-0001 (Mem0-shape architecture — explicit verb divergence).
- ADR-0003 (no `update` — interacts with verb set).
- ADR-0005 (reflection trigger — `reflect` is explicit-only at v0.0).
