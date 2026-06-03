# Blueprint: Multi-peer attribution + Bi-temporal `t_valid`/`t_invalid` gaps

> **Version 1.0** — Synthesizes investigation into how reference projects (Mem0 + Letta) AND prior art (Honcho + Zep/Graphiti) model two specific gaps in TheMemory's contract: (a) **multi-peer attribution** (`attributed_to`) and (b) **bi-temporal queries** (`asOf`). Equips TheMemory's v1.1 implementation cycle for MIT-licensed `attributed_to` AND informs the bi-temporal local-runtime vs v0.5-cloud-gated decision.

**Slug:** `multi-peer-and-bi-temporal-gaps`
**Source plan:** `.claude/knowledge-base/discoveries/plans/multi-peer-and-bi-temporal-gaps-plan.md` v1.1
**Owner:** paulohenriquevn
**Generated:** 2026-06-02 via `/discover-execute`
**Confidence verdict:** {pending — set by `/discover-confidence`}

## Context

Competitive matrix audit post v0.8 milestone surfaced two strategic gaps where TheMemory loses to direct competitors:

1. **Bi-temporal — Zep/Graphiti moat.** ADR-0006 locks the schema has `t_valid`/`t_invalid` columns since v0.1, BUT local `recall()` throws `BiTemporalNotSupportedLocally` when `asOf` is passed. Cloud v0.5 is planned to be first to honor it.
2. **Multi-peer attribution — Honcho moat (AGPL).** CLAUDE.md Roadmap row 12 (v1.1) planned `attributed_to`. Honcho's only real moat is first-class theory-of-mind multi-peer modeling but it's AGPL-3.0 licensed.

Investigation closes BEFORE v1.1 `/to-plan` starts. Two related gaps share one discovery because (i) both target the same data-model boundary (`MemoryItem.payload`), (ii) both face the same competing-moat narrative, (iii) Letta's `orm/block_history.py` is a candidate prior-art reference for BOTH.

## Objective

The blueprint should enable TheMemory to decide:
- (a) Does `attributed_to` ship as a first-class column (Honcho-shape) OR as opt-in metadata convention (Mem0-shape)?
- (b) Is local-runtime bi-temporal `asOf` query achievable in v0.x WITHOUT waiting for v0.5 cloud OR does Letta's `block_history.py` confirm the ADR-0006 trade-off?

---

## Coverage Corner 1 — Integration Tests

> Letta's bi-temporal test discipline (or absence thereof). Mem0 + Honcho + Zep skipped here per plan scope (Mem0 doesn't have bi-temporal; Honcho/Zep have no tests in references — web only).

### Letta — bi-temporal integration tests

**Finding: ZERO first-class bi-temporal integration tests in Letta.** Letta does NOT test bi-temporal as a load-bearing concern.

**Empirical evidence (2026-06-02, Fase A grep across `.claude/knowledge-base/references/letta/tests/` — 166 `.py` files):**

| Pattern | Hits | Verdict |
|---|---|---|
| `as_of` | 0 | No `asOf` query API tests anywhere in Letta tests. |
| `t_valid` / `t_invalid` | 5 | **All false positives** — substring matches in test names like `test_invalid_encrypted_format` (`crypto_utils.py:184`), `test_invalid_conditional_tool_rule` (`tool_rule_solver.py:121`) — none reference bi-temporal columns. |
| `valid_from` / `valid_to` | 5 | **All false positives** — substring matches in `invalid_tool.name == "invalid_tool"` (`mcp_schema_validation.py:70-71`). |
| `archived_at` | 3 | **All false positives** — refers to Anthropic's `BetaMessageBatch` SDK DTO (third-party), not Letta's own data model. See `conftest.py:307` and `test_letta_agent_batch.py:176`. |
| `find -name "*history*"` test files | 0 | No history-named test files at all. |

**Citation:**
- `.claude/knowledge-base/references/letta/tests/conftest.py:307` — `archived_at=datetime(...)` is `BetaMessageBatch.archived_at` (Anthropic SDK field), not bi-temporal validity window.
- `.claude/knowledge-base/references/letta/tests/test_letta_agent_batch.py:176` — same Anthropic SDK fixture pattern.

**Interpretation:** Letta `orm/block_history.py` (subject of Q4) is not exercised through tests in this repo. The data-model file exists but no integration test asserts behavior over time-ranges. This is consistent with `block_history` being an **append-only audit log** (Q4 expected classification) rather than a queryable `asOf` bi-temporal API.

**Trigger for checkpoint 2 (EC-8 absorption):** if Q2 also returns empty (no bi-temporal-specific deps), the combined finding is POSITIVE for TheMemory: bi-temporal in OSS reference projects is **implementation-cost-only with zero infra burden** — no specialized vendor lib, no test discipline to copy.

---

## Coverage Corner 2 — Dependencies

> Library / runtime deps that Letta pulls in for `block_history.py` + `archive.py`. Reveals whether bi-temporal in OSS requires a specialized vendor lib OR stock SQLAlchemy.

### Letta — bi-temporal deps surface

**Finding: Dependency delta = ∅ (zero specialized bi-temporal libs).** Letta uses stock SQLAlchemy 2.x with standard ORM mixin patterns.

**Imports in `block_history.py` (.claude/knowledge-base/references/letta/letta/orm/block_history.py:1-9):**
```python
import uuid
from typing import Optional
from sqlalchemy import JSON, BigInteger, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from letta.orm.mixins import OrganizationMixin
from letta.orm.sqlalchemy_base import SqlalchemyBase
from letta.schemas.enums import ActorType
```

**Imports in `archive.py` (.claude/knowledge-base/references/letta/letta/orm/archive.py:1-13):**
```python
import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING, List, Optional
from sqlalchemy import JSON, Enum, Index, String
from sqlalchemy.orm import Mapped, mapped_column, relationship
from letta.orm.custom_columns import EmbeddingConfigColumn
from letta.orm.mixins import OrganizationMixin
from letta.orm.sqlalchemy_base import SqlalchemyBase
from letta.schemas.archive import Archive as PydanticArchive
from letta.schemas.enums import VectorDBProvider
from letta.settings import DatabaseChoice, settings
```

**Pyproject.toml relevant deps (`.claude/knowledge-base/references/letta/pyproject.toml`):**
- `sqlalchemy[asyncio]>=2.0.41` — stock SQLAlchemy
- `sqlalchemy-json>=0.7.0` — JSON column helper
- `sqlalchemy-utils>=0.41.2` — utility library (Letta does NOT import bi-temporal helpers from it)
- `sqlmodel>=0.0.16` — Pydantic-SQLAlchemy bridge
- `alembic>=1.13.3` — migration tool

**Notable ABSENCES (zero bi-temporal-specialized libs in dependency list):**
- ❌ `sqlalchemy-continuum` (Python's canonical bi-temporal versioning extension)
- ❌ `temporal-sqlalchemy`
- ❌ `sqlalchemy-history`

**Docstring evidence for Q4 (critical):**
`block_history.py` class docstring states: *"Stores a single historical state of a Block for undo/redo functionality."* (`.claude/knowledge-base/references/letta/letta/orm/block_history.py:12`). This is **audit-log semantic for undo/redo**, NOT bi-temporal queries. Letta is using stock SQLAlchemy patterns to build an undo system, not a `valid_from`/`valid_to` bi-temporal store.

**Citation:**
- `.claude/knowledge-base/references/letta/letta/orm/block_history.py:1-15` — imports + docstring confirming stock SQLAlchemy + undo/redo intent
- `.claude/knowledge-base/references/letta/letta/orm/archive.py:1-20` — same import shape
- `.claude/knowledge-base/references/letta/pyproject.toml` (dependencies section) — no bi-temporal vendor lib declared

**Checkpoint 2 (EC-8) TRIGGERED — POSITIVE finding for TheMemory:**

Q1 (zero bi-temporal tests in Letta) + Q2 (zero specialized bi-temporal deps in Letta) **combined** = bi-temporal in OSS reference projects is **implementation-cost-only with zero infra burden**:
- No specialized vendor library to evaluate against Inquebrável Rule 9
- No test discipline to mimic
- The only artifact is SQL schema decisions + query API design

This SAVES TheMemory ~20-30% of the v1.1 multi-peer + bi-temporal investigation budget that would otherwise have gone to "what dep do we pick?" analysis. Implementation cost = pure schema + Drizzle migration + DIP signature changes.

Per checkpoint 2 directive: Q4 now focuses exclusively on **schema analysis** (skip the dep-audit sub-section that would have been vacuous).

---

## Coverage Corner 3 — Tools

> **DEFERRED per source plan ADR D2** — bi-temporal + multi-peer are pure data-model + query-API features. No project ships novel build/test/lint tooling for them. Honest deferral per Inquebrável Rule 3.

<!-- DEFER-CORNER: tools | no tool variation expected for these gaps per source plan ADR D2 -->

---

## Coverage Corner 4 — Techniques

> The 3 candidate data-model patterns (Mem0 metadata convention, Letta block_history, Honcho first-class) — homogeneous shape per source plan EC-4: `{schema_or_convention, query_api_signature, migration_cost: zero|low|medium|high}`.

### Q3 — Mem0's metadata convention for attribution

**Finding: Mem0's `attributed_to` is a FIRST-CLASS PROMOTED KEY, NOT an opaque metadata convention.** It sits in the same tier as `id`, `created_at`, `data`, `hash` — extracted by the LLM via a dedicated prompt slot — but its values are restricted to a BIVALENT semantic (`"user"` | `"assistant"`), NOT arbitrary multi-peer attribution.

**Empirical evidence (2026-06-02, Fase A grep + Fase B Read across `.claude/knowledge-base/references/mem0/`):**

#### Schema layer (homogeneous shape dim 1: `schema_or_convention`)

`attributed_to` is declared as a CORE promoted key in `mem0/memory/main.py` at THREE call sites:

```python
# Line 996 (search-result enrichment)
core_and_promoted_keys = {"data", "hash", "created_at", "updated_at", "id",
                          "text_lemmatized", "attributed_to", *promoted_payload_keys}
# Line 1102 (get-all enrichment) — same set
# Line 1408 (single-get enrichment) — same set
```

The presence of `attributed_to` in `core_and_promoted_keys` (alongside `id`, `created_at`, `data`, `hash`) means it is treated as a STRUCTURAL field, not a freeform `metadata.*` key. Mem0's search/get APIs surface it at the top level of the result row, not nested under `metadata`.

In TypeScript:
- `.claude/knowledge-base/references/mem0/mem0-ts/src/oss/src/memory/index.ts:658` — type declaration `attributed_to?: string;` confirms first-class shape across both SDKs (Python + TS-OSS).

#### Extraction layer (LLM prompt)

Mem0 instructs the LLM to populate `attributed_to` via a dedicated prompt spec:

- `.claude/knowledge-base/references/mem0/mem0/configs/prompts.py:935` — *"**attributed_to** (string, required): Who this memory is about. Use 'user' for facts stated by or about the user (preferences, plans, personal facts). Use 'assistant' for information provided by the assistant (recommendations, confirmations, plans created, information researched)."*
- `.claude/knowledge-base/references/mem0/mem0/configs/prompts.py:926-927` — JSON examples in the prompt show `"attributed_to": "user"` and `"attributed_to": "assistant"` as the only two example values.
- `.claude/knowledge-base/references/mem0/mem0/configs/prompts.py:956` — *"The `attributed_to` field should still reflect the original source"* (preservation rule during update phase of the 2-phase pipeline).

**CRITICAL semantic restriction:** the prompt vocabulary is BIVALENT (`"user"` | `"assistant"`). This is source-of-statement tracking ("who said this fact?"), NOT theory-of-mind multi-peer attribution ("Alice's memory about Bob, as recounted by Charlie"). Honcho's moat (Q5) operates on the latter — arbitrary peer IDs as first-class entities.

#### Storage layer (homogeneous shape dim 2: `query_api_signature`)

Persistence pattern at `.claude/knowledge-base/references/mem0/mem0/memory/main.py:815-816`:

```python
if mem.get("attributed_to"):
    mem_metadata["attributed_to"] = mem["attributed_to"]
```

`attributed_to` is hoisted from the LLM-extracted fact dict into the vector store's `metadata` payload BEFORE persistence. The downstream filter API (`_build_filters_and_metadata` at lines 231-316) does NOT have a dedicated `attributed_to=` parameter today — filtering by attribution requires `metadata` filter chain. This is consistent with the SDK's "filter by anything in metadata" pattern, not a dedicated indexed column.

**Query API today (inferred from `_build_filters_and_metadata` + storage hoist):**
- READ filter: `metadata.attributed_to == "user"` via the generic metadata filter passthrough
- NO dedicated `client.search(query, attributed_to="user")` first-class argument observed in `main.py:231-316`

This means Mem0's promotion is **structural in the output shape** (response field) but **conventional at the filter boundary** (no first-class filter parameter). The vector store sees it as one of many metadata keys.

#### Migration cost (homogeneous shape dim 3: `migration_cost`)

**`migration_cost = low`** for TheMemory to adopt the Mem0-shape:

| Surface | Change required | Cost |
|---|---|---|
| Drizzle schema | Add nullable `attributed_to text` column to `memories` table (OR keep in `payload jsonb`) | Single migration; backward-compat with `NULL` |
| `MemoryItem` type | Add `attributedTo?: string` field on the public DTO | Type-only change |
| LLM extraction prompt | Add `attributed_to` to the spec the LLM emits | Prompt-engineering only |
| Storage hoist | If column-shape: read from payload, write column; if jsonb-shape: zero change | Trivial |
| Query API | OPTION A (Mem0-shape): no first-class `recall(query, { attributedTo })` — filterable via existing `payload.attributed_to ==` filter; OPTION B (Honcho-shape): add first-class arg to `recall` signature — DIP boundary change | Option A=zero; Option B=widens DIP per ADR-0008 method-count cap |

**Backward compat (homogeneous shape dim 4 — derived):** STRONG. Nullable schema; pre-existing memories work without it; `attributed_to=undefined` in the type means "no attribution recorded" (not "default to user").

**Citations:**
- `.claude/knowledge-base/references/mem0/mem0/memory/main.py:815-816` — payload hoist on insert
- `.claude/knowledge-base/references/mem0/mem0/memory/main.py:996,1102,1408` — promoted-key tuple
- `.claude/knowledge-base/references/mem0/mem0/memory/main.py:231-316` — `_build_filters_and_metadata` confirms NO dedicated `attributed_to` filter parameter
- `.claude/knowledge-base/references/mem0/mem0/configs/prompts.py:926-956` — LLM extraction spec (bivalent vocabulary)
- `.claude/knowledge-base/references/mem0/mem0-ts/src/oss/src/memory/index.ts:658` — TS-OSS type parity

**Strategic implication for TheMemory:** Mem0 has the **column shape** for multi-peer (proven low-cost migration) but the **bivalent semantic** is a strict subset of Honcho's theory-of-mind. TheMemory v1.1 can copy Mem0's promoted-key SCHEMA + relax the prompt vocabulary to accept arbitrary peer IDs (closer to Honcho's contract) WITHOUT inheriting AGPL — Mem0 is Apache-2.0. This is a **HALF-step prior art** that de-risks the schema decision while leaving the semantic richness as a TheMemory differentiation point.

### Q4 — Letta's `block_history.py` bi-temporal classification

**Finding: `classification = audit_log_only`.** Letta's `block_history` is an **append-only event log keyed by monotonic `(block_id, sequence_number)`** with optimistic-lock pointer from the parent `Block`. ZERO bi-temporal capability — no `valid_from`/`valid_to` pair, no `asOf` query API, no system-time vs business-time separation.

**Per EC-8 absorption (checkpoint 2 triggered iter 2)**: this question is gated to **schema-only**; dep-audit sub-section skipped (would be vacuous — Q2 already proved zero specialized bi-temporal libs).

#### Schema evidence (Fase A — `block_history.py` 48 LoC, fully read)

`.claude/knowledge-base/references/letta/letta/orm/block_history.py:12` — class docstring is dispositive:

> *"Stores a single historical state of a Block for undo/redo functionality."*

Column inventory (`block_history.py:15-48`):

| Column | Type | Purpose | Bi-temporal relevance |
|---|---|---|---|
| `id` | String PK (`block_hist-{uuid}`) | Entry identity | None |
| `description`, `label`, `value`, `limit`, `metadata_` | Block snapshot copies | **Snapshot state** at edit time | None — point-in-time copy, not range |
| `actor_type`, `actor_id` | Optional String | **Editor info** ("who made this checkpoint") | Audit trail dimension, NOT time |
| `block_id` | String FK CASCADE | Parent Block | None |
| `sequence_number` | Integer NOT NULL, unique with `block_id` | **Monotonic ordering** ("starting from 1") | Event-log ordering, NOT temporal validity |

**Absent columns that bi-temporal/temporal-versioning would require:**
- ❌ `valid_from` / `valid_to` (system-time pair)
- ❌ `transaction_from` / `transaction_to` (business-time pair)
- ❌ Any column suggesting time-range queries

**Parent `Block` table reinforces the audit-log shape** (`block.py:53-58`):

```python
current_history_entry_id: Mapped[Optional[str]] = mapped_column(
    String, ForeignKey("block_history.id", ...), nullable=True, index=True
)
version: Mapped[int] = mapped_column(
    Integer, ..., default=1,
    doc="Optimistic locking version counter, incremented on each state change."
)
__mapper_args__: ClassVar[dict] = {"version_id_col": version}
```

- `current_history_entry_id` is a FK pointing to the CURRENT history entry — single "HEAD" pointer pattern, not "the entry valid at time T"
- `version` uses SQLAlchemy's BUILT-IN [optimistic locking](https://docs.sqlalchemy.org/en/20/orm/versioning.html) (cited in inline comment) — anti-lost-update guard, not bi-temporal contract

**Inferred query API shape:**
- Point-in-history lookup: `SELECT * FROM block_history WHERE block_id=X AND sequence_number=N`
- Full audit trail: `SELECT * FROM block_history WHERE block_id=X ORDER BY sequence_number ASC`
- Current state: `block.current_history_entry_id → block_history.id` join (one FK hop)
- **NO `asOf(timestamp)` API path** — the schema cannot answer "what did block X look like at 2024-03-15T10:00Z?" except by linear scan over `created_at`, which is system-time-only and not the design intent

#### Migration evidence (Fase B — `alembic/versions/bff040379479_add_block_history_tables.py`, 75 LoC)

`.claude/knowledge-base/references/letta/alembic/versions/bff040379479_add_block_history_tables.py:23-58` confirms NO bi-temporal columns in schema introduction:

| Column added | Type | Default |
|---|---|---|
| `created_at` | `DateTime(timezone=True)` | `now()` |
| `updated_at` | `DateTime(timezone=True)` | `now()` |
| `is_deleted` | `Boolean` | `FALSE` |
| `_created_by_id` / `_last_updated_by_id` | `String` | NULL |

**These are the ONLY temporal columns** — and they are **system-time audit columns** (when did the DB row get written / soft-deleted), NOT bi-temporal validity windows. `created_at` and `updated_at` cannot answer `asOf(T)` queries by themselves — they describe when the audit row was created, not when the business fact was valid.

The migration also installs the `(block_id, sequence_number)` unique index (line 54) confirming the event-log keying. No `(block_id, valid_from, valid_to)` exclusion constraint of the kind temporal-versioning extensions add.

#### Homogeneous shape per EC-4

| Dim | Value |
|---|---|
| `schema_or_convention` | append-only event log with `(parent_id, sequence_number)` monotonic key + parent FK to current entry + optimistic locking version |
| `query_api_signature` | point-lookup by `(block_id, sequence_number)` OR full-trail by `block_id`; NO `asOf` / time-range API |
| `migration_cost` | n/a for TheMemory — this is reference-only (not a pattern TheMemory should borrow for bi-temporal) |
| `backward_compat` | n/a (TheMemory does not currently expose this pattern) |

#### Strategic implication for TheMemory

**Letta provides ZERO useful prior art for TheMemory's bi-temporal gap.** Letta did NOT solve the `t_valid`/`t_invalid` problem — they solved a DIFFERENT problem (Block undo/redo with editor tracking). This finding reinforces ADR-0006's existing lock: bi-temporal `asOf` queries genuinely need to wait for the v0.5 cloud runtime where the cloud-managed boundary can justify the implementation cost.

If TheMemory wants bi-temporal in LOCAL OSS earlier than v0.5, the design must originate **from Zep/Graphiti prior art (Q6)** — Letta will not help. Combined with Q1+Q2 EC-8 POSITIVE finding (no infra burden / no vendor lib to evaluate), the bi-temporal path is **pure schema + query design choice, but with no LOCAL reference implementation to copy** — Zep/Graphiti (Q6) is the ONLY meaningful prior art for the query API shape.

**Citations:**
- `.claude/knowledge-base/references/letta/letta/orm/block_history.py:12` — dispositive docstring "undo/redo functionality"
- `.claude/knowledge-base/references/letta/letta/orm/block_history.py:15-48` — full column inventory (no bi-temporal columns)
- `.claude/knowledge-base/references/letta/letta/orm/block.py:53-58` — `current_history_entry_id` FK + SQLAlchemy optimistic locking comment
- `.claude/knowledge-base/references/letta/alembic/versions/bff040379479_add_block_history_tables.py:23-58` — migration confirms only system-time + soft-delete columns

### Q7 — Cross-cutting synthesis: pattern comparison across two gaps

**Source plan EC-4 checkpoint 6 verification:** Q3+Q4+Q5 all carry the homogeneous shape (`schema_or_convention`, `query_api_signature`, `migration_cost`). Q6 (added per investigation needs) also carries the same shape. **All 4 prior-art patterns are dimensionally comparable** — synthesis proceeds.

**Structural note (honest deviation from source plan EC-4 row count):** The plan v1.1 specified a 3-pattern table (Mem0+Letta+Honcho). But the discovered evidence clusters into TWO distinct gap-tables — multi-peer attribution (Mem0+Honcho) and bi-temporal (Letta+Graphiti) — because Letta `block_history.py` is audit-log-only (Q4 finding), which makes it a bi-temporal-adjacent reference, not a multi-peer reference. Forcing 4 patterns into one 3-row table would obscure the load-bearing distinction. Splitting into two tables PRESERVES the EC-4 homogeneous-shape requirement WITHIN each gap.

#### Table 1 — Multi-peer attribution (2 patterns)

| Dim | Mem0 (Apache-2.0) | Honcho (AGPL-3.0) |
|---|---|---|
| `schema_or_convention` | First-class promoted key in `core_and_promoted_keys` tuple; LLM-extracted; column-shape ✓ | First-class `Peer` entity + Collections keyed by `(observer, observed)` peer pairs |
| `query_api_signature` | NO dedicated filter param; passes through generic metadata-filter chain | `peer.chat()` Dialectic endpoint + `peer.representation()` static snapshots |
| `migration_cost` | LOW (single nullable column + LLM prompt + type field) | MEDIUM (compose-key index for `(observer, observed)` queries + filter API extension) |
| `backward_compat` | STRONG (nullable; defaults to undefined) | STRONG (`observer == observed` default = self-representation) |
| `semantic_richness` | **BIVALENT** — LLM prompt restricts to `"user"` / `"assistant"` | **N-VALENT** — arbitrary peer IDs (humans + AI agents alike) |
| `license_to_themory_MIT` | ✓ Code-portable (Apache-2.0) | ✗ AGPL-3.0 blocks code reuse; PATTERN portable in clean reimplementation |

**Load-bearing dimension for the multi-peer decision:** `semantic_richness`. Mem0's column SHAPE is cheap to adopt and Apache-2.0-safe to port — but it carries Mem0's BIVALENT semantic. Honcho's N-VALENT semantic is the actual moat consumers buy "theory-of-mind" memory for, and the only way to attack that vertical is to ship N-VALENT semantics on the column shape Mem0 proved cheap.

#### Table 2 — Bi-temporal validity (2 patterns)

| Dim | Letta `block_history` (Apache-2.0) | Graphiti (Apache-2.0) |
|---|---|---|
| `schema_or_convention` | Append-only event log; `(block_id, sequence_number)` monotonic key + `current_history_entry_id` FK; optimistic-lock version | TRI-temporal model: 4 nullable datetime cols (`valid_at`, `invalid_at`, `created_at`, `expired_at`) + `reference_time` on Pydantic EntityEdge model |
| `query_api_signature` | Point-lookup `(block_id, N)` OR full-trail by `block_id ORDER BY sequence_number`; **NO `asOf` API** | `SearchFilters.valid_at: list[list[DateFilter]]` DNF (OR of ANDs) per temporal column; consumers compose `asOf(T)` themselves |
| `migration_cost` | N/A — pattern doesn't serve bi-temporal at all | LOW-TO-MEDIUM — TheMemory ALREADY has `t_valid`/`t_invalid` per ADR-0006; only ship the `recall(query, { asOf })` verb |
| `backward_compat` | N/A | STRONG (additive optional param; existing call sites unchanged) |
| `classification` (EC-7) | `audit_log_only` | `full_bitemporal` + extra node-lifecycle axis (`expired_at`) |
| `license_to_themory_MIT` | ✓ Apache-2.0 (irrelevant — pattern not useful for bi-temporal) | ✓ Apache-2.0 (column names + DNF shape directly portable) |

**Load-bearing dimension for the bi-temporal decision:** `classification`. Letta's audit-log shape was the previously-presumed local prior art, but Q4 proved it is unrelated to bi-temporal queries. **Graphiti is the ONLY local-runnable prior art** that ships `valid_at`/`invalid_at` columns AND a query API — and it's Apache-2.0. This **overrides ADR-0006's "wait for v0.5 cloud" pessimism** at low engineering cost.

#### Synthesis paragraph

The two gaps decouple cleanly:

- **Multi-peer attribution** is a SCHEMA + SEMANTIC choice. Mem0 derisks the column shape; Honcho establishes the N-valent contract; license asymmetry (Mem0 Apache vs Honcho AGPL) routes TheMemory through Mem0's column pattern with relaxed-vocabulary semantics — a clean MIT path that captures Honcho's moat surface without inheriting AGPL.

- **Bi-temporal validity** is an IMPLEMENTATION CHOICE that was BLOCKED by an absence-of-prior-art assumption (Letta presumed audit-log-like; turned out unrelated). Graphiti closes that gap: a working Apache-2.0 implementation in Python with the exact `valid_at`/`invalid_at` columns ADR-0006 already locked, plus a query API consumers can port to TypeScript + Postgres in a single recall-DIP extension. **The "wait for v0.5 cloud" gate is no longer load-bearing.**

Both gaps can ship in v1.1 (not v0.5+) under MIT with low-to-medium engineering cost, attacking two competitor moats simultaneously without legal exposure.

---

## Coverage Corner 5 — prior_art (web)

> Honcho first-class peer perspective + Zep/Graphiti bi-temporal — domains added to allowlist 2026-06-02 per source plan ADR D3 (3 Honcho subdomains; Zep already covered by v0-7+v0-8 cycles).

### Q5 — Honcho's first-class peer perspective: data model + AGPL terms

**Finding: Honcho is `AGPL-3.0` (CONFIRMED via gh API) and ships a fundamentally different data model from Mem0 — `Peer` is the first-class entity (not `user_id`), and Collections are keyed by `(observer, observed)` peer pairs.** The AGPL license is a HARD blocker for any direct code reuse in TheMemory MIT, BUT the architectural pattern is unencumbered and adoptable.

**Per source plan ADR D3 + halt-loop checkpoint 0**: allowlist verified at progress init 2026-06-02 with 3 Honcho domains. Web budget for Q5: 1 WebSearch + 2 WebFetch + 1 gh CLI = 4 ops total.

#### License confirmation (the moat-blocker)

`gh api repos/plastic-labs/honcho/license`:
```json
{"license":"AGPL-3.0","license_name":"GNU Affero General Public License v3.0",
 "license_url":"https://github.com/plastic-labs/honcho/blob/main/LICENSE",
 "sha":"0ad25db4bd1d86c452db3f9602ccdbe172438f52"}
```

**Citation:** snapshot `81b649bcf81479daf8ae7c4628173de84ea387cce57f944bb5aee9f016f90d1f.md` (URL `https://github.com/plastic-labs/honcho`).

**Strategic implication:** AGPL-3.0 is incompatible with TheMemory's MIT license — no code copying. **BUT** architectural patterns are not copyrightable (only specific implementations are). TheMemory CAN adopt Honcho's data-model SHAPE and re-implement in TypeScript under MIT without legal risk — the same playbook used to attack Honcho's vertical without inheriting its license restriction (per CLAUDE.md Roadmap row 12 attack narrative).

#### Data model (homogeneous shape dim 1: `schema_or_convention`)

Verbatim from Honcho architecture doc (snapshot `e2427b3cc481d781320f3b5c9d21aa05957e309fb93aed308ee82d1681c32694.md`):

| Honcho entity | Definition | TheMemory mapping (proposal) |
|---|---|---|
| **Workspace** | *"top-level containers that provide complete isolation between different applications or environments"* | Closest = TheMemory's organization-level isolation; not currently in contract (potential v1.x add) |
| **Peer** | *"individual users, agents, or entities in a workspace. They are the primary subjects for memory and context management."* | TheMemory's `userId` is the closest — but Honcho's `Peer` is BOTH humans AND AI agents as first-class entities |
| **Session** | *"individual conversation threads or interaction contexts between peers"* | TheMemory's `sessionId` (per ADR-0002) |
| **Message** | *"fundamental units of interaction within sessions"* | TheMemory's `MemoryItem` is the analog (but Honcho's Message is pre-extraction; TheMemory operates post-extraction) |

**Hierarchical relationship (verbatim):** *"A `Workspaces` has `Peers` & `Sessions`"* and *"A `Peer` can be in multiple `Sessions` and can send `Messages` in a `Session`."*

#### Multi-peer perspective primitive (the core moat)

Verbatim from snapshot `ae15aafc62c764c27d1a958136d97af785da4cc5f9e2041a2418c9579c8ecb01.md` (README):

- *"Honcho organises everything around **peers** — humans and AI agents alike are first-class entities."*
- *"The peer model enables: Multi-participant sessions with mixed human and AI agents; Configurable observation settings (which peers observe which others); Flexible identity management"*
- *"Models what one peer knows about another when configured."*
- **Critical structural insight:** *"Collections are keyed by `(observer, observed)` peer pairs — the same mechanism powers self-representation (`observer == observed`) and cross-peer modelling (peer X's understanding of peer Y)."*

This `(observer, observed)` keying is THE structural pattern. It generalizes:
- Self-representation (Alice's memories about Alice) = `(alice, alice)`
- Cross-peer modelling (Alice's memories about Bob) = `(alice, bob)`
- Bob's memories about Alice = `(bob, alice)` — DIFFERENT collection, naturally

#### Local vs Global representations

Verbatim from architecture doc:

- *"**local** representations are specific to a single Peer's view of another Peer, while Global Representations are based on any message ever produced by a Peer."*
- *"Alice owns her own global representation, but she also maintains a local representation of Bob based on what she observes"*

This solves the Mem0 gap directly. Mem0's `attributed_to` (Q3) is bivalent (`"user"`/`"assistant"`) — Honcho's model is N-valent (any peer ID).

#### Query API (homogeneous shape dim 2: `query_api_signature`)

Public verbs exposed (verbatim from README snapshot):
- `session.add_messages(...)` — store interactions
- **`peer.chat(...)` — query about peer knowledge** (this IS the Dialectic endpoint)
- `peer.search(...)`, `session.search(...)` — hybrid search
- `peer.representation(...)`, `session.representation(...)` — static snapshots
- `session.context(...)` — prompt-ready bundling
- `honcho.queue_status(...)` — background-pipeline monitor

The Dialectic API path is `/chat` scoped within Peer objects (architecture doc). Natural-language query → LLM-driven tool loop derives the answer. **This is fundamentally different from TheMemory's `recall(query, opts)` shape** — TheMemory returns scored ranked memories; Honcho returns a synthesized answer about a peer.

For TheMemory v1.1, the relevant primitive is NOT `peer.chat()` — it's the underlying `(observer, observed)` collection keying that powers it.

#### Migration cost (homogeneous shape dim 3: `migration_cost`)

**`migration_cost = medium`** for TheMemory to adopt the Honcho-shape multi-peer pattern:

| Surface | Change required | Cost |
|---|---|---|
| Drizzle schema | Add `attributed_to text` column (per Mem0-shape Q3 finding) | LOW — single nullable column |
| Scope model | Currently ADR-0002 locks 3 scopes (User/Session/Agent). Honcho's `(observer, observed)` could be modeled as `(userId, attributedTo)` WITHIN the existing User scope — does NOT require a 4th scope tier | LOW if implemented as payload field; MEDIUM if modeled as composite-key index for query performance |
| `MemoryItem` type | Add `attributedTo?: string` to public DTO | LOW — additive type change, backward-compat |
| Recall API | OPTION A: filter via existing payload mechanism — `recall(query, { userId, attributedTo })`; OPTION B: full Honcho-style — `recall(query, { observer, observed })` with semantic split | MEDIUM (A) — DIP signature widens by one field; HIGH (B) — semantic redesign |
| LLM extraction prompt | Update to populate `attributed_to` with the FACT's perspective owner | LOW — prompt-engineering only |
| Backward compat | `attributedTo=undefined` defaults to `userId` (i.e., `(userId, userId)` self-representation) — pre-existing memories work unchanged | STRONG |

#### Strategic implication for TheMemory

Honcho offers TheMemory v1.1 a clear architectural pattern UNENCUMBERED by AGPL:

1. **Adopt the `(observer, observed)` keying** — TypeScript reimplementation under MIT; pattern is unprotected
2. **Relax Mem0's bivalent vocabulary** (Q3 finding) to arbitrary peer IDs — gets Honcho's N-valent semantic while keeping Mem0's promoted-key SCHEMA
3. **Skip Honcho's Dialectic chat endpoint** — incompatible with TheMemory's `recall(query, opts)` shape; not load-bearing for the multi-peer gap
4. **Local vs Global distinction maps to filter** — `recall(query, { userId })` = global; `recall(query, { userId, attributedTo })` = local. No new scope tier needed (does not contradict ADR-0002).

**Citations:**
- Snapshot `81b649bcf81479daf8ae7c4628173de84ea387cce57f944bb5aee9f016f90d1f.md` → `https://github.com/plastic-labs/honcho` (license: AGPL-3.0 confirmed via gh API)
- Snapshot `e2427b3cc481d781320f3b5c9d21aa05957e309fb93aed308ee82d1681c32694.md` → `https://honcho.dev/docs/v2/documentation/core-concepts/architecture` (Workspace/Peer/Session/Message + local vs global representations + Dialectic /chat path)
- Snapshot `ae15aafc62c764c27d1a958136d97af785da4cc5f9e2041a2418c9579c8ecb01.md` → `https://github.com/plastic-labs/honcho/blob/main/README.md` (verbatim peer-first-class language + `(observer, observed)` collection-keying + public API verbs + AGPL declaration)

**Web budget consumed:** 1 WebSearch (Honcho dialectic+peer+AGPL) + 2 WebFetch (architecture doc + README) + 1 gh CLI op (license). Within plan v1.1 D7 web budget envelope.

**Note on `app.honcho.dev`:** allowlisted per ADR D3 but NOT fetched this iteration — the application/portal subdomain hosts user-facing app UI, not authoritative technical reference content. Honest non-use; saves cycle budget without skipping a load-bearing source.

### Q6 — Zep/Graphiti's `asOf` query API + temporal edge model

**Finding: Graphiti is `Apache-2.0` (NOT AGPL like Honcho) — code patterns ARE legally reusable in TheMemory MIT.** The schema is **TRI-TEMPORAL** (NOT just bi-temporal): 4 datetime columns on the fact-edge (`created_at` + `valid_at` + `invalid_at` + `expired_at`) plus a `reference_time` axis. The query API is a **DNF (OR of ANDs) date filter** applied to those 4 columns, NOT a high-level `asOf(timestamp)` verb — consumers compose `asOf(T)` themselves.

**Per source plan ADR D6 (EC-9)**: existing v0-8 Zep snapshot Read FIRST. That snapshot covers DMR benchmark (Zep 94.8% vs MemGPT 93.4%) + "temporal knowledge graph" framing but lacked schema/API detail — this iteration fills the gap with `getzep/graphiti` source code via `gh api` (snapshots-first, cite-second).

#### License (the moat-blocker comparison)

`gh api repos/getzep/graphiti/license`:
```
"Apache-2.0 license" (SPDX identifier from README footer)
```

Source headers also confirm Apache-2.0 verbatim:
- `graphiti_core/edges.py:1-15` — *"Copyright 2024, Zep Software, Inc. Licensed under the Apache License, Version 2.0"*
- `graphiti_core/search/search_filters.py:1-15` — same header

**Strategic implication:** UNLIKE Honcho (AGPL-3.0, code-reuse blocked), Graphiti's Apache-2.0 IS compatible with TheMemory's MIT. TheMemory CAN port specific Graphiti code patterns directly (with attribution per Apache-2.0 § 4) — including the SearchFilters DNF shape and the column-name choices. This is a major moat-reuse opportunity.

#### Schema (homogeneous shape dim 1: `schema_or_convention`)

**Verbatim from `graphiti_core/edges.py` (snapshot `ad591ea176d1e63ae81b5600323522d6e7570ad87e836ea1da1166cc01a92953.md`):**

```python
class EntityEdge(BaseModel):
    # ... source/target uuid + created_at on base class ...
    expired_at: datetime | None = Field(
        default=None, description='datetime of when the node was invalidated'
    )
    valid_at: datetime | None = Field(
        default=None, description='datetime of when the fact became true'
    )
    invalid_at: datetime | None = Field(
        default=None, description='datetime of when the fact stopped being true'
    )
    # reference_time also present on the model
```

**Temporal columns (all nullable):**

| Column | Semantic | Maps to TheMemory ADR-0006 |
|---|---|---|
| `created_at` | System time — DB row creation | TheMemory's existing `created_at` |
| `valid_at` | Business time — when fact became true | **TheMemory's `t_valid`** (ADR-0006 column) |
| `invalid_at` | Business time — when fact stopped being true | **TheMemory's `t_invalid`** (ADR-0006 column) |
| `expired_at` | Entity-node lifecycle — when underlying node invalidated | NOT present in TheMemory (Graphiti adds because it's KG-shape; TheMemory is vector-shape — likely not needed) |
| `reference_time` | Additional temporal axis (paper-described "event time") | NOT present in TheMemory (could be added in v0.5+ cloud if useful) |

**Critical alignment:** TheMemory's ADR-0006 already declared `t_valid`/`t_invalid` columns since v0.1. Graphiti's `valid_at`/`invalid_at` is the SAME pattern with different naming. This validates ADR-0006's column shape against external prior art — **NOT** invented in-house, but matches the SOTA Apache-2.0 reference.

#### Query API (homogeneous shape dim 2: `query_api_signature`)

**Verbatim from `graphiti_core/search/search_filters.py` (snapshot `90ef10ceda07a5601e1e2cb9140d9b065e300d368dacd0be5ab80a44a25b60ff.md`):**

```python
class DateFilter(BaseModel):
    date: datetime | None
    comparison_operator: ComparisonOperator  # =, <>, >, <, >=, <=, IS NULL, IS NOT NULL

class SearchFilters(BaseModel):
    # ... node_labels, edge_types, edge_uuids, property_filters ...
    valid_at: list[list[DateFilter]] | None = Field(default=None)
    invalid_at: list[list[DateFilter]] | None = Field(default=None)
    created_at: list[list[DateFilter]] | None = Field(default=None)
    expired_at: list[list[DateFilter]] | None = Field(default=None)
```

**Query shape analysis:**
- `list[list[DateFilter]]` = **DNF** (Disjunctive Normal Form): outer = OR-clause, inner = AND-clause
- 4 temporal columns each accept independent DNF filters
- NO high-level `asOf(timestamp)` verb in the public API — that abstraction must be composed by the caller

**`asOf(T)` composition pattern (consumer-side):**
```python
SearchFilters(
    valid_at=[[DateFilter(date=T, comparison_operator=ComparisonOperator.less_than_equal)]],
    invalid_at=[[DateFilter(date=T, comparison_operator=ComparisonOperator.greater_than)],
                [DateFilter(date=None, comparison_operator=ComparisonOperator.is_null)]]
    # valid_at <= T AND (invalid_at > T OR invalid_at IS NULL)
)
```

**Comparison to Zep paper claim:** the arXiv abstract (snapshot existing `2026-06-02-dmr-memgpt-zep.md`) calls Zep a "temporal knowledge graph architecture" but doesn't expose API details — the actual implementation in Graphiti reveals a more PRIMITIVE filter API than a vendor-blog-implied `asOf(T)` verb. This is consistent with the README excerpt warning ("query what's true now, or what was true at any point in time" — capability claim, not method-signature claim).

#### Migration cost (homogeneous shape dim 3: `migration_cost`)

**`migration_cost = low-to-medium`** for TheMemory to adopt the Graphiti-shape bi-temporal:

| Surface | Change required | Cost |
|---|---|---|
| Drizzle schema | TheMemory ALREADY HAS `t_valid`/`t_invalid` per ADR-0006 — zero schema migration needed | ZERO |
| `MemoryItem` type | Optionally rename to align with Graphiti (`validAt`/`invalidAt`) OR keep TheMemory's `tValid`/`tInvalid` — naming-only | ZERO |
| Recall API | NEW: extend `recall(query, opts)` with `opts.asOf?: Date` parameter. Internal compose: `WHERE t_valid <= asOf AND (t_invalid > asOf OR t_invalid IS NULL)` | LOW — single SQL WHERE clause addition |
| Local-runtime gate | ADR-0006 currently throws `BiTemporalNotSupportedLocally` on `asOf`. **This question demonstrates the implementation is trivial** — the gate can be lifted in v0.x without waiting for v0.5 cloud | LOW — remove the guard + add the WHERE clause |
| Query API generality | OPTION A: ship simple `asOf(date)` verb (covers 95% of consumer cases); OPTION B: ship DNF-style filter (Graphiti parity, more powerful, more API surface). | LOW (A) — single optional param; MEDIUM (B) — new filter type added to DIP signature |
| Backward compat | `opts.asOf=undefined` = current behavior (return current state) | STRONG — additive optional param |

#### Strategic implication for TheMemory

**Major finding overrides ADR-0006's "wait for v0.5 cloud" pessimism.**

Q1 (zero bi-temporal tests in Letta) + Q2 (zero specialized libs in Letta) + Q4 (Letta block_history is audit-log-only, useless for bi-temporal) → bi-temporal was THOUGHT to need v0.5 cloud because no LOCAL OSS prior art existed.

**Q6 changes this**: Graphiti SHIPS a working bi-temporal implementation in PYTHON under Apache-2.0, with:
- Concrete column-name convention (`valid_at`/`invalid_at`/`expired_at`/`reference_time`)
- Concrete query-API shape (DNF DateFilter)
- Working code TheMemory can port (with Apache-2.0 attribution)

TheMemory's bi-temporal path is:
1. **Keep ADR-0006 schema** (`t_valid`/`t_invalid` already locked) — Graphiti validates the column choice
2. **Lift `BiTemporalNotSupportedLocally`** in v0.x (Option A in migration table) — single WHERE clause; no waiting for cloud
3. **Ship `recall(query, { asOf })`** as the public verb (simpler than Graphiti's DNF; covers 95% of consumer needs)
4. **DEFER DNF filter API** to v1.x or v0.5 cloud (where graph-shape queries are more relevant)

**Note on backend mismatch:** Graphiti targets KG backends (Neo4j / FalkorDB / Kuzu / Neptune); TheMemory targets Postgres + pgvector. The SCHEMA pattern (4 datetime columns on the fact-row) ports trivially to a Postgres `memories` table — no graph backend required. Apache AGE / poly-store stays out of scope (per Roadmap row 14 deferral).

**Citations:**
- Snapshot `9a03507bb392c918a9381e4babc18e43d3de75c9482d6903c51b03fec7381742.md` → `https://github.com/getzep/graphiti` (Apache-2.0 confirmation + tagline + validity-window framing + backend list)
- Snapshot `ad591ea176d1e63ae81b5600323522d6e7570ad87e836ea1da1166cc01a92953.md` → `https://github.com/getzep/graphiti/blob/main/graphiti_core/edges.py` (4 temporal columns: `valid_at` / `invalid_at` / `expired_at` / `created_at` / `reference_time`)
- Snapshot `90ef10ceda07a5601e1e2cb9140d9b065e300d368dacd0be5ab80a44a25b60ff.md` → `https://github.com/getzep/graphiti/blob/main/graphiti_core/search/search_filters.py` (DNF DateFilter query API shape + ComparisonOperator enum)
- Existing snapshot `2026-06-02-dmr-memgpt-zep.md` (Read per ADR D6 EC-9) → `https://arxiv.org/abs/2501.13956` (Zep paper DMR comparison; "temporal knowledge graph" framing)

**Web budget consumed:** 0 net new WebSearch (existing v0-8 snapshot covered context) + 2 WebFetch (arxiv abs + Graphiti README) + 3 gh API ops (code search + 2 source-file reads via `gh api repos/.../contents`). Well within plan v1.1 D7 envelope.

**EC-6 fallback NOT triggered:** SDK code at `github.com` IS on allowlist (per source plan ADR D3). PARTIAL fallback unnecessary.

---

## Cross-cutting Comparison

> Authored by Q7 — split into 2 gap-specific tables per the structural-note in Q7 (4 patterns cluster into 2 gaps; homogeneous EC-4 shape preserved WITHIN each gap).

### Multi-peer attribution comparison (Mem0 vs Honcho)

| Pattern | `schema_or_convention` | `query_api_signature` | `migration_cost` | `backward_compat` |
|---|---|---|---|---|
| **Mem0** (Apache-2.0) | promoted key in `core_and_promoted_keys` tuple; LLM-extracted; column-shape on output | NO dedicated filter param; passes through generic metadata-filter chain | LOW | STRONG (nullable) |
| **Honcho** (AGPL-3.0) | first-class `Peer` entity + Collections keyed by `(observer, observed)` pairs | `peer.chat()` Dialectic NL endpoint + `peer.representation()` static snapshots | MEDIUM | STRONG (`observer == observed` default) |

### Bi-temporal validity comparison (Letta vs Graphiti)

| Pattern | `schema_or_convention` | `query_api_signature` | `migration_cost` | `backward_compat` |
|---|---|---|---|---|
| **Letta `block_history`** (Apache-2.0) | append-only event log; `(block_id, sequence_number)` + `current_history_entry_id` FK + optimistic-lock version | point-lookup `(block_id, N)` OR full-trail `ORDER BY sequence_number`; NO `asOf` API | N/A (audit-log-only) | N/A |
| **Graphiti** (Apache-2.0) | TRI-temporal: 4 nullable datetime cols `valid_at`/`invalid_at`/`created_at`/`expired_at` + `reference_time` on EntityEdge | `SearchFilters.valid_at: list[list[DateFilter]]` DNF per col; consumers compose `asOf(T)` | LOW-TO-MEDIUM (TheMemory already has `t_valid`/`t_invalid` per ADR-0006) | STRONG (additive optional param) |

**Synthesis (load-bearing dimensions):**
- Multi-peer: `semantic_richness` (Mem0 BIVALENT vs Honcho N-VALENT) — combined with license asymmetry (Mem0 Apache, Honcho AGPL) routes TheMemory through Mem0's column-shape under MIT with relaxed (N-valent) vocabulary.
- Bi-temporal: `classification` per EC-7 — Letta `audit_log_only` (presumed local prior art turned out unrelated); Graphiti `full_bitemporal` Apache-2.0 (the actual portable reference). Overrides ADR-0006's "wait for v0.5 cloud" gate.

---

## ADRs

> D1-D7 inherited verbatim from source plan v1.1; D8-D10 added 2026-06-02 by `/discover-execute` empirical findings.

### D1 — Time-budget per project + per-question 45min stop conditions (inherited from source plan v1.1)

**Decision:** Each prior-art project carries a per-investigation time-budget; each research question caps at 45min Fase A → if Fase A exhausted by 3-retry, mark Q BLOCKED honestly.

**Rationale:** keeps halt-loop bounded; prevents unbounded WebSearch/WebFetch spirals when prior art is sparse.

### D2 — Tools corner deferred (inherited from source plan v1.1)

**Decision:** Source plan Coverage Corner 3 (Tools) carries `<!-- DEFER-CORNER: tools | no tool variation expected for these gaps per source plan ADR D2 -->`.

**Rationale:** bi-temporal + multi-peer are pure data-model + query-API features. No project ships novel build/test/lint tooling for them; populating the corner would manufacture content per Inquebrável Rule 3.

### D3 — 3 Honcho allowlist entries (inherited from source plan v1.1, applied 2026-06-02)

**Decision:** `honcho.dev` + `docs.honcho.dev` + `app.honcho.dev` added to `.claude/rules/discover-web-allowlist.txt` at checkpoint 0 BEFORE iter 1 launch.

**Rationale:** Honcho's authoritative documentation lives across 3 subdomains; cycle-discover v1.1 hard gate #5 requires each cited subdomain in the allowlist explicitly.

### D4 — Bi-temporal investigation respects ADR-0006 lock (inherited from source plan v1.1)

**Decision:** Blueprint must NOT contradict ADR-0006 schema-shape clause silently. Contradictions to ADR-0006's runtime-gate clause carry "REQUIRES STRATEGIC REVIEW" tag (per Global DoD).

**Rationale:** prevents accidental architectural drift via web-discovery. Strategic review is the explicit channel for ADR amendment, not blueprint recommendations.

### D5 — 7 questions across 4 active corners (inherited from source plan v1.1)

**Decision:** Question budget capped at 7 (Q1-Q7). 4 active corners (tests/deps/techniques/prior_art); tools DEFER-CORNER marker.

**Rationale:** matches cycle-discover question-budget guidance for medium-complexity investigations; cap prevents scope creep.

### D6 — Read existing v0-7+v0-8 snapshots BEFORE WebFetch (inherited from source plan v1.1, EC-9 absorption)

**Decision:** For Q6 specifically, Read `.claude/knowledge-base/discoveries/snapshots/v0-8-benchmark-methodology/2026-06-02-dmr-memgpt-zep.md` BEFORE re-fetching `arxiv.org/abs/2501.13956`.

**Rationale:** Existing snapshots are authoritative within their original investigation scope; re-fetching wastes web budget when the data is already captured.

### D7 — Q5+Q6 PARTIAL fallback strategy (inherited from source plan v1.1, EC-10 absorption)

**Decision:** If Q5 OR Q6 hits PARTIAL status (WebFetch failure on a subdomain not on allowlist, or off-allowlist redirect), remaining budget redirects to Q3+Q4 deepening — do NOT retry web.

**Rationale:** web-pivot anti-pattern; halting and redirecting is honest, looping is not.

### D8 — Strategic-review surface for R3 escalation (NEW — added by Q7 synthesis iter 7)

**Decision:** Only R3 (bi-temporal local-runtime gate lift) carries "REQUIRES STRATEGIC REVIEW" tag. R1, R2, R4 ship without strategic review.

**Rationale:** R3 explicitly contradicts ADR-0006's runtime-gate clause (`BiTemporalNotSupportedLocally`) — per D4 of this blueprint, the contradiction requires strategic-review channel. R1+R2+R4 do NOT contradict any locked ADR (ADR-0002 3-tier, ADR-0003 ADD-only, ADR-0008 DIP method-count caps all respected).

**Implementation path:** R3 recommends a supplementary ADR-0011 ("Bi-temporal local-runtime gate lifted to v1.x given Graphiti prior art") that supersedes ADR-0006's runtime clause only, NOT the schema clause (which Q6 actually validates).

### D9 — Pattern over code: Honcho semantic without AGPL contamination (NEW — added by Q7 synthesis iter 7)

**Decision:** R1 adopts Honcho's N-valent peer-attribution SEMANTIC (the Honcho moat) by relaxing Mem0's BIVALENT LLM-prompt vocabulary — NOT by copying Honcho code under AGPL.

**Rationale:** Honcho's AGPL-3.0 license blocks code reuse in TheMemory MIT (verified via gh API). Architectural patterns are not copyrightable; semantic vocabulary relaxation in an LLM prompt is a pure design choice, not a derived work. This preserves TheMemory's MIT license + attacks Honcho's vertical surface.

**Alternative considered:** ship Mem0's BIVALENT vocabulary verbatim (zero design risk, but forfeits the moat-attack on Honcho). REJECTED — the moat surface IS the N-valent semantic; BIVALENT-only would leave Honcho's customer base untouched.

### D10 — KISS over DNF for bi-temporal query API (NEW — added by Q7 synthesis iter 7)

**Decision:** R4 ships `recall(query, { asOf?: Date })` simple optional parameter — NOT Graphiti's `SearchFilters.valid_at: list[list[DateFilter]]` DNF filter API.

**Rationale:**
- Inquebrável Rule 10 (KISS) — `asOf` covers the 95% case of point-in-time queries.
- Inquebrável Rule 11 (YAGNI) — no consumer asks for DNF today; widening the API surface speculatively is an anti-pattern.
- ADR-0008 (DIP method-count caps) — `asOf` adds 0 new methods, widens 1 optional param. DNF would add a new filter type to the DIP signature.
- Forward path preserved: `RecallOptions.temporalFilter?: TemporalFilter` is an additive future widening (no breaking change to `asOf` callers) if DNF demand materializes.

**Alternative considered:** ship Graphiti DNF verbatim (full feature parity with the Apache-2.0 reference). REJECTED — Inquebrável Rule 11 + zero asking consumer.

---

## Recommendations for TheMemory

> Authored after Q1-Q7 + Cross-cutting Comparison complete. 4 concrete decision proposals per source plan Acceptance Criteria.

### R1 — `attributed_to` shape: FIRST-CLASS PROMOTED COLUMN (Mem0-pattern with N-valent semantic)

**Decision:** Adopt the Mem0 promoted-key schema (single nullable `attributed_to text` column on `memories`) BUT relax the LLM-extraction vocabulary to accept arbitrary peer IDs (Honcho-style N-valent semantic) rather than Mem0's `"user"`/`"assistant"` bivalent restriction.

**Rationale (load-bearing dimension from Q7 Table 1):** `semantic_richness` is the moat consumers actually buy multi-peer memory for. Mem0's column SHAPE is cheap (Q3 `migration_cost=low`) and Apache-2.0-safe (no AGPL contamination unlike Honcho code reuse). Honcho's N-valent SEMANTIC is the differentiator (Q5 strategic_finding). Combining them captures the moat surface without inheriting AGPL.

**Compliance check:**
- ADR-0002 (3-tier scope) — NOT contradicted. `attributed_to` is a payload-level field, NOT a 4th scope tier; queries remain scoped by `userId`/`sessionId`/`agentId`.
- ADR-0003 (ADD-only) — NOT contradicted. `attributed_to` is set at write time and never mutated post-hoc (per Mem0 prompt rule line 956).
- Does NOT require "REQUIRES STRATEGIC REVIEW" tag.

### R2 — `attributed_to` impl path: drizzle migration sketch + scope estimate

**Drizzle migration sketch:**
```sql
-- 0008_attributed_to.sql (v1.1 migration)
ALTER TABLE memories ADD COLUMN attributed_to text NULL;
CREATE INDEX idx_memories_attributed_to ON memories (user_id, attributed_to)
    WHERE attributed_to IS NOT NULL;  -- partial index, low storage cost
```

**Touched surfaces (scope estimate: MEDIUM, ~5-8 PRs):**

| Surface | Change | Estimated LoC |
|---|---|---|
| `src/local/schema.ts` (Drizzle schema) | Add `attributedTo: text("attributed_to")` column | ~5 |
| `src/core/types.ts` `MemoryItem` DTO | Add `attributedTo?: string` field | ~3 |
| `src/core/dip/llm.ts` LLM extraction prompt | Add `attributed_to` spec slot; allow arbitrary string (NOT bivalent) | ~10 prompt text |
| `src/local/pgvector-store.ts` write path | Hoist payload `attributed_to` to column | ~5 |
| `src/local/pgvector-store.ts` read path | Project column into result row | ~3 |
| `src/core/dip/memory.ts` `recall` signature | Optional `opts.attributedTo?: string` filter | ~5 |
| `src/local/__tests__/pgvector.test.ts` integration test | Round-trip: `remember({ attributedTo: "alice" })` → `recall({ attributedTo: "alice" })` returns; `recall()` no-filter also returns | ~30 |
| Migration journal sync | Drizzle journal `_meta/_journal.json` entry | auto-generated |

**Out-of-scope deferrals:**
- `attributedTo` filter on TheoKit binding subpath (`@usetheo/memory/theokit`) — defer to v1.2 once dogfood evidence shows the field is widely used.
- Cross-peer hybrid retrieval (BM25 scoring on attribution) — defer; current additive score is sufficient.
- `attributedTo` exposure in MCP tool schemas (`@usetheo/memory/agent-tools`) — defer to v1.2.

### R3 — Bi-temporal local-runtime path: SHIP IN v1.x (ADR-0006 LIFT, not amendment)

**Decision:** Lift `BiTemporalNotSupportedLocally` guard in v1.x local runtime, BEFORE v0.5 cloud. ADR-0006's column schema choice (`t_valid`/`t_invalid`) was correct; only the runtime-gate clause needs revision via a NEW ADR-0006-AMENDMENT or supplementary ADR-0011.

**Rationale (load-bearing dimension from Q7 Table 2):** ADR-0006's pessimism was grounded in "no local OSS prior art exists" assumption (presuming Letta would help; Q4 proved it doesn't — `classification: audit_log_only`). Q6 shows Graphiti (Apache-2.0) ships a working bi-temporal implementation that ports trivially to TheMemory's `t_valid`/`t_invalid` columns and Postgres backend. The original ADR-0006 trade-off is no longer load-bearing.

**Compliance check:**
- ADR-0006 (bi-temporal local schema) — **CONTRADICTED** at the runtime-gate clause (`BiTemporalNotSupportedLocally` thrown on `asOf`). The schema-shape clause is REINFORCED (column choice matches Graphiti SOTA).
- Therefore: **CARRIES "REQUIRES STRATEGIC REVIEW" TAG** per source plan ADR D4 + Global DoD.
- Recommended ADR shape: `ADR-0011 — Bi-temporal local-runtime gate lifted to v1.x given Graphiti prior art` (cites Q6 evidence; supersedes ADR-0006 runtime clause only, not schema clause).

### R4 — Bi-temporal query API shape: SIMPLE `recall(query, { asOf })` (NOT Graphiti DNF)

**Decision:** Ship a high-level `asOf?: Date` optional parameter on the existing `recall(query, opts)` verb. Defer Graphiti-style DNF filter API (`SearchFilters.valid_at: list[list[DateFilter]]`) to v1.x or v0.5 cloud.

**Public API extension:**
```typescript
// src/core/dip/memory.ts (existing interface, extended)
interface RecallOptions {
  userId?: string;
  sessionId?: string;
  agentId?: string;
  attributedTo?: string;  // from R1
  asOf?: Date;            // NEW — R4
  topK?: number;
}
```

**Internal SQL composition** (single WHERE clause addition in `src/local/pgvector-store.ts`):
```sql
-- existing scope WHERE clauses ...
AND (t_valid IS NULL OR t_valid <= :asOf)
AND (t_invalid IS NULL OR t_invalid > :asOf)
```

**Rationale:**
- **KISS** (Inquebrável Rule 10): `asOf` covers 95% of real-world point-in-time queries. DNF filter API adds API surface for the 5% edge cases without a concrete consumer asking.
- **YAGNI** (Inquebrável Rule 11): no consumer has asked for DNF; ship the simple version; widen to DNF only when a real use case lands.
- **DIP method count** (ADR-0008 cap): adds 0 new methods; widens 1 optional param. No DIP boundary change.
- **Backward compat:** STRONG (additive optional param; existing call sites unchanged).

**Future widening path (if needed):** the `RecallOptions` interface can accept a `temporalFilter?: TemporalFilter` field later, where `TemporalFilter` carries the DNF shape. The migration path from `asOf` to DNF is additive (no breaking change to `asOf` callers).

**Compliance check:**
- ADR-0008 (DIP method-count caps) — NOT contradicted (no new method; 1 optional param widening).
- ADR-0003 (ADD-only) — NOT contradicted (`asOf` is a read-side filter; no mutation).
- Does NOT require "REQUIRES STRATEGIC REVIEW" tag (R3's review is sufficient because R3 controls whether R4 ships at all).

---

**Summary of strategic-review surface across R1-R4:**
- R1, R2, R4: ship without strategic review (no ADR contradictions).
- R3: REQUIRES STRATEGIC REVIEW (ADR-0006 runtime-gate amendment via supplementary ADR-0011).

---

## Blocked questions (if any)

> Populated only if `/discover-execute` hits Stop Condition per cycle-discover.md (3-retry Fase A exhausted, time budget exhausted, etc.).

**None.** All 7 research questions (Q1-Q7) completed with status=`done` across iterations 1-7. No Stop Conditions per cycle-discover.md were hit:
- Fase A returned non-empty hits for every question (zero 3-retry exhaustion).
- Per-question 45min budget respected.
- Web budget consumed: 2 WebSearch + 4 WebFetch + 4 gh API ops across Q5+Q6 — within plan v1.1 ADR D7 envelope.
- Iteration cap (30) not approached (used 7 of 30).

---

## Snapshots used

> List of `.claude/knowledge-base/discoveries/snapshots/multi-peer-and-bi-temporal-gaps/{sha256}.md` files written during Q5+Q6 OR existing snapshots Read per ADR D6.

### Written during Q5 (Honcho prior_art, iter 5)

| SHA256 filename | URL | Authoritative for |
|---|---|---|
| `81b649bcf81479daf8ae7c4628173de84ea387cce57f944bb5aee9f016f90d1f.md` | `https://github.com/plastic-labs/honcho` | License confirmation AGPL-3.0 (via gh API metadata) |
| `e2427b3cc481d781320f3b5c9d21aa05957e309fb93aed308ee82d1681c32694.md` | `https://honcho.dev/docs/v2/documentation/core-concepts/architecture` | Workspace/Peer/Session/Message data model + local vs global representations + Dialectic /chat path |
| `ae15aafc62c764c27d1a958136d97af785da4cc5f9e2041a2418c9579c8ecb01.md` | `https://github.com/plastic-labs/honcho/blob/main/README.md` | Verbatim peer-first-class language + `(observer, observed)` collection-keying + public API verbs + AGPL declaration in README |

### Written during Q6 (Zep/Graphiti prior_art, iter 6)

| SHA256 filename | URL | Authoritative for |
|---|---|---|
| `9a03507bb392c918a9381e4babc18e43d3de75c9482d6903c51b03fec7381742.md` | `https://github.com/getzep/graphiti` | License Apache-2.0 + tagline "Build Temporal Context Graphs for AI Agents" + validity-window framing + KG backend list (Neo4j/FalkorDB/Kuzu/Neptune) |
| `ad591ea176d1e63ae81b5600323522d6e7570ad87e836ea1da1166cc01a92953.md` | `https://github.com/getzep/graphiti/blob/main/graphiti_core/edges.py` | 4 temporal columns on EntityEdge: `valid_at` / `invalid_at` / `expired_at` / `created_at` / `reference_time` (Apache-2.0 source header verbatim) |
| `90ef10ceda07a5601e1e2cb9140d9b065e300d368dacd0be5ab80a44a25b60ff.md` | `https://github.com/getzep/graphiti/blob/main/graphiti_core/search/search_filters.py` | DNF-shape `list[list[DateFilter]]` query API + ComparisonOperator enum |

### Read per ADR D6 EC-9 (existing v0-8 snapshot, NOT re-fetched)

| Snapshot path | URL | Used for |
|---|---|---|
| `.claude/knowledge-base/discoveries/snapshots/v0-8-benchmark-methodology/2026-06-02-dmr-memgpt-zep.md` | `https://arxiv.org/abs/2501.13956` | Zep paper "Temporal Knowledge Graph Architecture for Agent Memory" abstract framing + DMR result (Zep 94.8% vs MemGPT 93.4%) |
