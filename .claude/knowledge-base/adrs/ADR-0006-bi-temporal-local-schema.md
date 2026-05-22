# ADR-0006: Bi-temporal columns — schema-yes-in-local, query-API-no-until-v0.5

- **Status:** Accepted
- **Date:** 2026-05-22
- **Plan:** [`memory-contract-v0-0-plan.md`](../plans/memory-contract-v0-0-plan.md) § ADRs § D6
- **Owner:** TheMemory v0.0 contract design
- **Resolves:** CLAUDE.md § Open questions Q4

## Context

Zep / Graphiti's only durable moat is **bi-temporal queries**: the ability to ask "what did the system believe at time T1?" by storing both `t_valid` (when the fact became true) and `t_invalid` (when it stopped being true). Without bi-temporal columns, deletes are destructive and the audit trail is shallow.

Roadmap Item 7 (`v0.5 — TheoCloud runtime + bi-temporal premium`) ships bi-temporal queries as a paid TheoCloud-tier feature. Question Q4 asked: should the LOCAL runtime's schema (v0.1) provision the bi-temporal columns now, or wait until v0.5?

Three positions:

- (a) Local schema HAS the columns; query API exposes `asOf` on both runtimes from day 1.
- (b) Local schema does NOT have the columns; only cloud schema diverges.
- (c) Local schema HAS the columns (cheap; just two TIMESTAMPTZ); local v0.1 `recall()` ignores or rejects `asOf` until v0.5+ backports the local query support.

## Decision

**Path (c)**: Local schema (v0.1) provisions `t_valid` and `t_invalid` as nullable `TIMESTAMPTZ` columns on the memory table from day 1. The local runtime's `recall()` does NOT accept an `asOf` parameter at v0.1 — when caller passes one, the local adapter throws `BiTemporalNotSupportedLocally` (typed error declared in T2.4).

The cloud runtime (v0.5) is the first to honor `asOf` in `recall()` queries.

The contract types declare `asOf?: Date` as an OPTIONAL parameter on `RecallOptions` (T2.3). Both runtimes accept the field at the TYPE level. The behavior divergence is a runtime error, not a type error.

Memory writes always set `tValid: now()` and `tInvalid: null` (currently-valid marker). `forget(id)` with `hard: false` (the default) sets `tInvalid: now()`. `forget(id, { hard: true })` removes the row entirely.

## Consequences

**Positive:**

- v0.5 cloud lights up `asOf` queries WITHOUT contract changes — same `RecallOptions` shape.
- Zep's bi-temporal moat is matched at v0.5 bundled inside TheoCloud (no Neo4j ops for consumers; see roadmap Item 7).
- Local schema migrations are not painful at v0.5: the columns already exist.
- Local-only users who want time-travel queries can write raw SQL against the columns (the data is there, even if `recall()` doesn't expose it).

**Negative:**

- Local v0.1 callers who try `asOf` get a runtime error. Test MUST assert this (`BiTemporalNotSupportedLocally` is part of the v0.1 contract surface).
- Documentation must flag `asOf` as cloud-only until v0.5+ backports the local query support. The IDE hover-tip JSDoc (EC-5 from edge-case review) makes this explicit:
  ```ts
  /** @throws BiTemporalNotSupportedLocally on the local runtime until v0.5+ */
  readonly asOf?: Date;
  ```
- Storage cost: two TIMESTAMPTZ columns per memory row. Trivial overhead, but non-zero.

**Reversibility:**

- Easy. Removing the columns later is a destructive migration (data loss). Adding `recall()` support for `asOf` on local at v0.5+ is purely additive (no contract change).
- Loosening the v0.1 runtime error to a `recall()` that ignores `asOf` would also be backward-compatible (no type change; just a behavior softening). Reverting from "ignore" back to "throw" would be breaking.

## Alternatives

| Alternative | Verdict | Why rejected |
|---|---|---|
| **Local has no bi-temporal columns; cloud schema diverges** (path b) | Rejected | Divergent schemas force divergent migrations and codebases. v0.5 would have to add the columns to local anyway — pain deferred, not avoided. |
| **Local has columns AND query API in v0.1** (path a) | Rejected | Additional Drizzle query work for v0.1 (Postgres CTE for `asOf` filter, index design). Deferred to v0.5+ backport as scope-control. |
| **Cloud-only contract for `asOf`** (different `RecallOptions` per runtime) | Rejected | Breaks the "two runtimes, one contract" anchor (`public-copy.md § 2`). Consumers can't write runtime-agnostic code that uses `asOf`. |
| **No bi-temporal at all; deletes are destructive** | Rejected | Loses Item 7's competitive parity with Zep. Bi-temporal is the highest-value paid-tier moat we have. |

## References

- `CLAUDE.md § Open questions Q4` (RESOLVED 2026-05-22 → this ADR).
- Roadmap Item 7 (`v0.5 — TheoCloud runtime + bi-temporal premium`).
- `CLAUDE.md § Competitive superiority matrix` row Zep/Graphiti.
- T2.2 `MemoryItem` shape (ships `tValid: Date | null` + `tInvalid: Date | null` fields).
- T2.4 `errors.ts` exports `BiTemporalNotSupportedLocally`.
- T2.3 `options.ts` ships `RecallOptions.asOf?: Date` with `@throws` JSDoc.
- `referencia/letta/letta/orm/` — Letta's schema does NOT have bi-temporal columns; Letta uses standard `created_at`/`updated_at` and tracks history via Alembic migrations. This ADR diverges from Letta's choice.
