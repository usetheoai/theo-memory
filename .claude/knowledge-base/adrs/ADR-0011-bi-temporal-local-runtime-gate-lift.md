# ADR-0011: Bi-temporal local-runtime gate lifted given Graphiti prior art

- **Status:** Accepted (supplementary to ADR-0006)
- **Date:** 2026-06-02
- **Plan:** [`v1-1-multi-peer-and-bi-temporal-plan.md`](../plans/v1-1-multi-peer-and-bi-temporal-plan.md) § ADRs § D3 + T0.1
- **Supersedes (in part):** [ADR-0006](./ADR-0006-bi-temporal-local-schema.md) — runtime-clause only; schema clause is REINFORCED
- **Owner:** TheMemory v1.1
- **Sign-off:** Project owner, 2026-06-02 via `AskUserQuestion` decision recorded in this commit

## Context

ADR-0006 (2026-05-22) locked path (c): local schema provisions `t_valid`/`t_invalid` TIMESTAMPTZ columns since v0.1, but the local runtime's `recall()` THROWS `BiTemporalNotSupportedLocally` when caller passes `asOf` — gating the query API behind the v0.5 cloud runtime.

The original rationale for the runtime gate was scope control: deferring "additional Drizzle query work for v0.1 (Postgres CTE for `asOf` filter, index design)" to v0.5+. The rejected alternative path (a) — "Local has columns AND query API in v0.1" — was rejected with rationale "Additional Drizzle query work for v0.1 ... Deferred to v0.5+ backport as scope-control".

This rationale was **grounded in an absence-of-local-prior-art assumption** that has since been falsified.

## Empirical update — what changed between 2026-05-22 and 2026-06-02

The `/discover-execute multi-peer-and-bi-temporal-gaps` cycle (2026-06-02) produced [the multi-peer + bi-temporal blueprint](../discoveries/blueprints/multi-peer-and-bi-temporal-gaps-blueprint.md) that empirically audited two assumptions:

1. **Q4 audit of Letta `block_history.py`** — classified `audit_log_only` per EC-7 trichotomy. Letta has a `current_history_entry_id` FK + monotonic `sequence_number` ordering, NOT `valid_from`/`valid_to` columns. The presumed local OSS prior art DOES NOT exist for bi-temporal queries. Citation: [`block_history.py:1-48`](../references/letta/letta/orm/block_history.py) + [migration `bff040379479_add_block_history_tables.py`](../references/letta/alembic/versions/bff040379479_add_block_history_tables.py) confirms ZERO bi-temporal columns in the schema (only `created_at`/`updated_at` system-time + `is_deleted` soft-delete).

2. **Q6 audit of Graphiti** — classified `full_bitemporal` per EC-7. Graphiti SHIPS the column shape ADR-0006 already locked, under Apache-2.0 license (CODE-PORTABLE to TheMemory MIT). Citations:
   - [`graphiti_core/edges.py:1-15`](../references/graphiti/edges.py-snapshot) confirms Apache-2.0 license header.
   - The EntityEdge model declares 4 nullable datetime columns: `valid_at` ("datetime of when the fact became true"), `invalid_at` ("datetime of when the fact stopped being true"), `created_at` (system time), `expired_at` (node-lifecycle).
   - [`graphiti_core/search/search_filters.py`](../references/graphiti/search_filters.py-snapshot) declares `SearchFilters.valid_at: list[list[DateFilter]]` — a DNF (OR-of-ANDs) filter API.
   - Blueprint snapshot SHA256 references: `ad591ea176d1e63ae81b5600323522d6e7570ad87e836ea1da1166cc01a92953.md` (edges.py), `90ef10ceda07a5601e1e2cb9140d9b065e300d368dacd0be5ab80a44a25b60ff.md` (search_filters.py), `9a03507bb392c918a9381e4babc18e43d3de75c9482d6903c51b03fec7381742.md` (README).

**Conclusion:** the implementation cost of lifting `BiTemporalNotSupportedLocally` is single-WHERE-clause work: `(t_valid IS NULL OR t_valid <= :asOf) AND (t_invalid IS NULL OR t_invalid > :asOf)`. Graphiti's DateFilter+DNF complexity is NOT required to honor the simple `asOf(date)` verb — consumers compose it themselves at the boundary. ADR-0006's "additional Drizzle query work" overhead estimate was wrong.

## Decision

**The runtime-clause of ADR-0006 is amended in v1.1:**

- `BiTemporalNotSupportedLocally` is REMOVED from the throw site at `src/local/index.ts:324-325`.
- The local runtime's `recall()` HONORS `RecallOptions.asOf?: Date` from v1.1 onward.
- The WHERE-clause composition follows Graphiti's null-safe semantic: NULL `t_valid` is treated as `-Infinity` (always-valid since creation); NULL `t_invalid` is treated as "still valid".
- The simple `asOf(date)` verb is the public API. The DNF DateFilter shape is NOT exposed at v1.1 (KISS + YAGNI per plan ADR D4; future widening via additive `RecallOptions.temporalFilter?: TemporalFilter` remains non-breaking).
- The boundary-validation guard rejects invalid Date input (`Number.isNaN(asOf.getTime())` → throw `InvalidScope`) per architecture.md § 8 + plan EC-3 absorption.

**The schema-clause of ADR-0006 STANDS (REINFORCED, not amended):**

- `t_valid`/`t_invalid` TIMESTAMPTZ columns remain on the local `memories` table.
- The column names match Graphiti's `valid_at`/`invalid_at` convention semantically; the TheMemory naming convention (`t_*` prefix per existing schema.ts) is preserved.
- Writes continue to set `tValid: now()` and `tInvalid: null` (currently-valid marker).
- `forget(id, { hard: false })` (default) continues to soft-delete via `tInvalid: now()`.

**The CHANGELOG narrative narrows the v0.5 cloud-premium scope:**

- Roadmap row 7 (`v0.5 — TheoCloud runtime + bi-temporal premium`) is REINTERPRETED. Local OSS owns the temporal queries from v1.1; cloud premium narrows to multi-region replication + audit-mgmt + managed embedding pricing.

## Consequences

**Positive:**

- TheMemory matches Zep/Graphiti bi-temporal moat at v1.1 under MIT, not v0.5+ behind a paywall. Competitive positioning vs Zep ("bi-temporal as paid moat") becomes "bi-temporal as commodity in our OSS tier".
- GDPR-strict consumers retain the existing `forget(id, { hard: true })` escape hatch from v0.4b T7.1; `asOf` queries cannot resurrect hard-deleted rows (the column is wiped, not just `tInvalid` updated). Documented in the EC-11 caveat on `RecallOptions.asOf` JSDoc.
- Future widening to Graphiti-style DNF is additive (zero breaking change to v1.1 `asOf` callers) if/when consumer demand materializes.
- The `BiTemporalNotSupportedLocally` typed error class remains EXPORTED at `src/core/errors.ts:61` (marked `@deprecated for local v1.1+` per plan T3.1) so any caller currently catching it stays forward-compatible; cloud runtime retains the option to throw it for unsupported edge configurations.

**Negative:**

- Pre-v1.1 callers who tested for `rejects.toThrow(BiTemporalNotSupportedLocally)` get an assertion failure; the test at `src/local/__tests__/factory.test.ts:105-110` is rewritten to `resolves` per plan T3.2. Public-API CHANGELOG entry under `### Changed`.
- Cloud v0.5+ no longer gates the bi-temporal feature; the cloud-tier value proposition shifts from "temporal queries" to "managed-region replication + audit-mgmt". Marketing/positioning copy needs alignment (deferred to v0.5 cycle).
- Storage/query overhead is non-zero but small: one additional WHERE-clause predicate per `asOf` recall against `t_valid`/`t_invalid` columns (already indexed for the existing `t_invalid IS NULL` partial indexes per `schema.ts:136-142`).

**Reversibility:**

- Re-imposing the throw is technically additive (single line restoration), but per Inquebrável Rule 4 (Git Safety) + ADR audit-trail discipline, reversal would require a successor ADR-0012 explicitly superseding THIS ADR. The schema clause cannot be reversed without destructive migration.
- DataFilter DNF widening (Graphiti-parity) remains future-additive on top of the v1.1 simple `asOf` verb (no breaking change to existing callers).

## Alternatives considered

| Alternative | Verdict | Why rejected |
|---|---|---|
| **Keep the runtime gate; defer R3 to v0.5 cloud** | REJECTED | Blueprint Q6 changes the cost-benefit. Deferral preserves a moat-window for competitors (Zep's "bi-temporal premium" framing becomes commoditized when local OSS ships it). Plus the original ADR-0006 rationale ("scope control: additional Drizzle query work") was grounded in the now-falsified absence-of-local-prior-art assumption. |
| **Edit ADR-0006 directly** | REJECTED | ADRs are append-only history per ADR-MADR convention. Editing destroys audit trail. Supplementary ADR preserves the original decision context plus the amendment rationale. |
| **Make ADR-0011 a full replacement (deprecate ADR-0006)** | REJECTED | The SCHEMA clause of ADR-0006 is REINFORCED by Q6 (column choice matches Graphiti SOTA). Supersession scope is limited to the runtime clause only. Treating ADR-0006 as fully deprecated would lose the valid schema-decision rationale that v1.1 still relies on. |
| **Ship Graphiti-style DNF DateFilter as v1.1 API** | REJECTED | Plan ADR D4 + Rule 11 (YAGNI): no consumer asks for DNF today; widening the API surface speculatively is an anti-pattern. Simple `asOf(date)` covers 95% of point-in-time queries; future widening remains non-breaking via additive `temporalFilter?: TemporalFilter`. |

## References

- [ADR-0006 — Bi-temporal columns — schema-yes-in-local, query-API-no-until-v0.5](./ADR-0006-bi-temporal-local-schema.md) (supersedes runtime clause; schema clause reinforced)
- [Plan v1.1 Multi-Peer Attribution + Bi-Temporal Local Runtime](../plans/v1-1-multi-peer-and-bi-temporal-plan.md) § ADRs § D3 (this ADR's plan-level home)
- [Blueprint multi-peer-and-bi-temporal-gaps](../discoveries/blueprints/multi-peer-and-bi-temporal-gaps-blueprint.md) § Q4 (Letta absence) + § Q6 (Graphiti prior art) + § R3 (recommendation)
- [`/discover-confidence` verdict on the blueprint](../discoveries/blueprints/multi-peer-and-bi-temporal-gaps-blueprint.md) — SHIPPABLE_WITH_CAVEATS 89/100, zero fabricated citations
- [`/edge-case-plan` for v1-1-multi-peer-and-bi-temporal](../reviews/v1-1-multi-peer-and-bi-temporal-edge-cases-2026-06-02.md) § EC-3 (asOf boundary NaN validation) + § EC-11 (GDPR caveat)
- Snapshots underpinning Q6 (committed at `.claude/knowledge-base/discoveries/snapshots/multi-peer-and-bi-temporal-gaps/`):
  - `9a03507bb392c918a9381e4babc18e43d3de75c9482d6903c51b03fec7381742.md` (Graphiti README — Apache-2.0 + tagline + validity-window framing)
  - `ad591ea176d1e63ae81b5600323522d6e7570ad87e836ea1da1166cc01a92953.md` (Graphiti edges.py — 4 temporal columns + Apache-2.0 source header)
  - `90ef10ceda07a5601e1e2cb9140d9b065e300d368dacd0be5ab80a44a25b60ff.md` (Graphiti search_filters.py — DNF DateFilter API shape)
- CLAUDE.md Roadmap row 7 (`v0.5 — TheoCloud runtime + bi-temporal premium`) — narrowed scope per this ADR (multi-region replication + audit-mgmt + managed embedding pricing; bi-temporal queries move to OSS tier in v1.1)
- Inquebrável Rule 1 (95% confidence gate) — user sign-off received via `AskUserQuestion` at /implement Gate 2 on 2026-06-02
- Inquebrável Rule 3 (Extreme Honesty) — supersession scope deliberately narrow to preserve ADR-0006's schema-clause audit trail
