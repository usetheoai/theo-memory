# Discovery Plan: Multi-peer attribution + Bi-temporal `t_valid`/`t_invalid` gaps

> **Version 1.1** (2026-06-02) — Absorbs `/discover-edge-cases` report (`.claude/knowledge-base/reviews/multi-peer-and-bi-temporal-gaps-edge-cases-2026-06-02.md`; verdict DISCOVERY PLAN PRECISA DE AJUSTE — 10 edge cases: 5 MUST FIX + 3 SHOULD TEST + 2 DOCUMENT). **FIVE MUST FIX ABSORBED:** (a) **EC-1** ADR D3 expanded to 3 allowlist entries (`honcho.dev` + `docs.honcho.dev` + `app.honcho.dev`) — subdomains NOT auto-allowed per allowlist rule; (b) **EC-2** Q3 method changed from hardcoded line range `231-300` to `grep-then-Read until next ^def boundary` — empirical verification 2026-06-02 confirmed `_build_filters_and_metadata` spans 231-316 (next def at 317); old range cut ~17 LoC; (c) **EC-3** Q4 `find -name "*block*"` refined to `-name "*block_history*"` — Letta `alembic/versions/` has 167 migrations; over-inclusive find would explode the 45-min stop budget; (d) **EC-4** Q3+Q4+Q5 Expected answer shape now requires homogeneous `{schema_or_convention, query_api_signature, migration_cost: zero|low|medium|high}` dimensions so Q7 synthesis comparison table is well-typed; (e) **EC-5** NEW halt-loop checkpoint 0 (pre-iteration-1) verifies allowlist contains `honcho.dev` AND `docs.honcho.dev` AND `app.honcho.dev` — mechanizes ADR D3 pre-condition that was previously a human-gated step. **THREE SHOULD TEST CHECKPOINTS** added (EC-6 Zep subdomain probe with honest-BLOCKED fallback, EC-7 Q4 returns categorical spectrum not Y/N binary, EC-8 Q1+Q2 both-empty case treated as POSITIVE finding "bi-temporal cheap to implement"). **TWO DOCUMENT NOTES** absorbed as ADR D6 (Read existing v0-7+v0-8 snapshots BEFORE WebFetch — EC-9 re-fetch avoidance) and ADR D7 (Q5+Q6 PARTIAL fallback — redirect remaining web budget to deeper Q3+Q4 code analysis — EC-10).
>
> **Version 1.0** (2026-06-02) — Initial plan. Investigate how reference projects (Mem0 + Letta) AND prior art (Honcho, Zep/Graphiti, academic papers) model two specific gaps in TheMemory's current contract: (a) **multi-peer attribution** (`attributed_to` — memory about user X said by user Y; planned v1.1 per CLAUDE.md row 12; Honcho's only moat is AGPL-licensed first-class support), and (b) **bi-temporal queries** (`t_valid`/`t_invalid` — `asOf` query support; Zep/Graphiti's only real moat). The blueprint should equip the implementation cycle for v1.1 (`attributed_to` MIT-licensed implementation) AND inform whether bi-temporal queries can be implemented in the local runtime ahead of v0.5 cloud (or honestly stay gated). Two related but distinct gaps share one discovery because (i) both target the same data-model boundary (`MemoryItem.payload`), (ii) both face the same competing-moat narrative (Honcho/Zep), and (iii) Letta's `orm/block_history.py` is a candidate prior-art reference for BOTH (multi-peer attribution semantics + bi-temporal `archived_at` columns).

**Slug:** `multi-peer-and-bi-temporal-gaps`
**Owner:** paulohenriquevn
**Created:** 2026-06-02
**Time budget:** 7h total (Mem0: 2h; Letta: 2h; prior_art web research: 3h)

## Context

**Motivation:** Competitive matrix audit (just-published v0.8 milestone surfaced the strategic picture; see `CLAUDE.md` § Roadmap competitive superiority matrix lines 145-161). Two specific gaps where TheMemory loses to direct competitors:

1. **Bi-temporal — Zep/Graphiti moat.** Per ADR-0006 (`.claude/knowledge-base/adrs/ADR-0006-bi-temporal-local-schema.md`), TheMemory schema has `t_valid`/`t_invalid` columns since v0.1, but the local `recall()` throws `BiTemporalNotSupportedLocally` when `asOf` is passed. Cloud v0.5 is planned to be first to honor it. Question: is there a path to local-runtime bi-temporal queries without waiting for cloud GA? What does Letta's `orm/block_history.py` suggest (the name implies bi-temporal block versioning)?

2. **Multi-peer attribution — Honcho moat (AGPL).** Per `CLAUDE.md § Open questions for the contract design` item 1 (resolved 2026-05-22) and Roadmap row 12 (v1.1), `attributed_to` was DEFERRED to v1.1. Honcho's only real moat is first-class theory-of-mind multi-peer modeling, but it's AGPL-licensed — proprietary commercial systems can't link without exposing source. TheMemory MIT + `attributed_to` would directly steal that vertical. Question: what's the minimum-viable schema + API surface? How does Mem0's `metadata.attributed_to` convention compare to a first-class field? Is `attributed_to` a peer-pair (single user) or set (1-N)?

**Evidence triggering this discovery NOW:**
- v0.8 fix-up cycle just shipped (commit `2341426`); v0.7 distillation + v0.6 Voyager skills + v0.4b forgetting all done. Pre-v1.0 strategic question now front-and-center: which roadmap row to attack next?
- `CLAUDE.md` Roadmap rows 12 (v1.1 multi-peer) and 7 (v0.5 cloud + bi-temporal) are both LOAD-BEARING for the "best OSS memory primitive" pitch.
- Investigation closes BEFORE v1.1 `/to-plan` starts.

**Cited project rules:**
- `.claude/rules/architecture.md` § 1 Three-tier scope — locked at 3 tiers (User/Session/Agent) + 4th RepoScope; `attributed_to` MUST NOT widen the tier model. Any borrowed pattern from Mem0/Letta/Honcho must respect this boundary.
- `.claude/rules/architecture.md` § 2 ADD-only by design — locked decision. Bi-temporal `forget()` semantics must preserve ADD-only (`t_invalid` UPDATE is the closest we go to mutation).
- `.claude/rules/testing.md` § Pyramid — Letta's bi-temporal integration tests (if any) are anchor evidence for our future test shape.

## Objective

The produced blueprint should enable TheMemory to decide:
- (a) Does `attributed_to` ship as a first-class column on `memories` (Honcho-shape, denormalized) OR as an opt-in metadata convention with a documented key (Mem0-shape)?
- (b) Is local-runtime bi-temporal `asOf` query achievable in TheMemory v0.x WITHOUT waiting for v0.5 cloud — or does Letta's `block_history.py` confirm the trade-off ADR-0006 already locked?

Measurable success criteria:
- [ ] All 7 research questions answered with citations to `.claude/knowledge-base/references/` (for Mem0/Letta) AND `.claude/knowledge-base/discoveries/snapshots/multi-peer-and-bi-temporal-gaps/` (for web prior_art)
- [ ] Cross-cutting comparison table populated for 5 vendors (TheMemory, Mem0, Letta, Honcho, Zep/Graphiti) across both gaps
- [ ] Recommendations section provides at least one concrete decision proposal per gap (4 total: shape + impl path for each)
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `.claude/knowledge-base/references/mem0/` | `mem0/memory/main.py`, `mem0/memory/storage.py`, `mem0/memory/utils.py`, `mem0-ts/src/oss/`, `evaluation/src/` | Mem0-shape `_build_filters_and_metadata` is the canonical "attribution via metadata" reference per CLAUDE.md § Architectural Decisions Locked. v0.8 cycle already mapped `mem0-ts/`. |
| `.claude/knowledge-base/references/letta/` | `letta/orm/block_history.py`, `letta/orm/archive.py`, `letta/schemas/agent.py`, `letta/schemas/block.py`, `alembic/versions/` (migrations naming bi-temporal columns) | Letta's `block_history` name suggests bi-temporal block versioning. The migration history reveals when/how the schema evolved. |
| **prior_art (web)** | Honcho official docs, Honcho GitHub repo README, Zep/Graphiti official docs, academic papers (Generative Agents § identity modeling) | Honcho + Zep are NOT clones (Honcho proprietary AGPL trap; Zep cloud-first). Web research with snapshots is mandatory per `cycle-discover.md` v1.1. |

### Out-of-Scope (explicit)

| Excluded | Reason |
|---|---|
| `.claude/knowledge-base/references/langmem/` | Directory does NOT exist on disk (verified `ls`). Not relevant to either gap (LangMem is prompt-rewriting procedural memory). |
| `.claude/knowledge-base/references/mem0/embedchain/` + `cookbooks/` + `examples/` | Application-level integrations; orthogonal to the data-model gaps. |
| `.claude/knowledge-base/references/letta/letta/llm_api/` + `letta/services/agents/` | LLM provider + agent loop wiring; orthogonal to bi-temporal/multi-peer schema. |
| Cognee's poly-store ontology system | Different data-model paradigm; matrix already notes "Cognee partial bi-temporal" and we explicitly rejected their poly-store complexity per CLAUDE.md row 15 framing. |
| Performance/scale of bi-temporal queries at >1M rows | Premature optimization; v1.x design intentionally precedes scale validation. |
| Honcho's commercial-license terms or pricing | Out of scope — we only care about the technical data model + AGPL legal envelope, not their business model. |

## ADRs

### D1 — Time-budget per project + per-question stop conditions

**Decision:** Total 7h budget. Mem0 = 2h (re-use v0.7 + v0.8 cycle prior context — already mapped `mem0/memory/main.py` + `mem0-ts/src/oss/`). Letta = 2h (NEW area: `orm/block_history.py` + alembic migrations). Web prior_art = 3h (Honcho + Zep are higher-risk because we don't have clones; allowlist additions may be needed inline).

**Per-question stop condition:** if any question takes > 45 min, the halt-loop iteration MUST mark BLOCKED with reason "time budget exhausted at Qx" and move on. Per `cycle-discover.md § Stop conditions` #3.

**Rationale:** Mem0/Letta are well-explored already; web research is the high-variance bucket. 3h budget accounts for snapshot writes + WebFetch retries.

### D2 — Tools corner deferred (no Test/Build/Tool variation expected for these gaps)

**Decision:** Skip the `tools` corner. ADR justification: bi-temporal + multi-peer are pure data-model + query-API features. They don't require new build pipelines, CI shape, or test runners beyond what's already in use (Postgres + pgvector). No project — Mem0, Letta, Honcho — ships novel tooling for these features.

**Rationale:** Per `cycle-discover.md § Step 3 Question budget` "min 1 per corner OR ADR-deferred". Forcing a question here would produce vacuous answers ("Letta uses the same pytest config it uses for everything else"). Honest deferral per Inquebrável Rule 3.

**Consequence:** Coverage Matrix shows `tools` corner with `<!-- DEFER-CORNER: tools | no tool variation expected per ADR D2 -->` marker.

### D3 — `honcho.dev` + `docs.honcho.dev` + `app.honcho.dev` MUST be added to `.claude/rules/discover-web-allowlist.txt` BEFORE invoking `/discover-execute` (EC-1 absorption)

**Decision:** Add THREE entries to the allowlist (subdomains NOT auto-allowed per the allowlist file's own rules) with rationale for each:
1. `honcho.dev` — root domain (marketing + landing page)
2. `docs.honcho.dev` — technical documentation subdomain (most likely location of the data-model spec we need for Q5)
3. `app.honcho.dev` — application subdomain (may host live API docs / playground)

Each entry carries rationale: "Honcho official docs domain ({purpose}); needed for Q5 prior_art on multi-peer attribution; added 2026-06-02 for `multi-peer-and-bi-temporal-gaps`".

**Rationale:** Per `cycle-discover.md` § Hard gates #5, citing a URL from a non-allowlisted domain caps confidence at 49. The allowlist's "Subdomains are NOT auto-allowed" rule means a single `honcho.dev` entry does NOT cover `docs.honcho.dev` — Q5 Fase B explicitly fetches `https://docs.honcho.dev/` so that subdomain MUST have its own entry. Same applies to `app.honcho.dev`. Adding all three at once avoids mid-execute halt-loop interruption (EC-1 + EC-5 combined absorption).

**Consequence:** This plan declares the allowlist edit as a pre-condition for `/discover-execute`; the edit is a 3-line change to `discover-web-allowlist.txt`. Halt-loop checkpoint 0 (per § Halt-loop checkpoints, NEW EC-5 entry) mechanizes the verification.

### D4 — Bi-temporal investigation respects ADR-0006 lock

**Decision:** The blueprint's bi-temporal Recommendations section MUST NOT propose changes that contradict ADR-0006 (locked 2026-05-22) — local schema HAS the columns; local `recall()` throws on `asOf` until v0.5+. The investigation only asks: is there a path SHORTER than waiting for cloud GA?

**Rationale:** Strategic review required to change ADR-0006. The discovery does NOT have authority to override locked architectural decisions; only to surface possibilities for a future strategic review.

**Consequence:** Recommendations section flags any path that would require ADR-0006 amendment with explicit "REQUIRES STRATEGIC REVIEW" tag.

### D5 — Question budget: 7 questions across 4 active corners (tools deferred per D2)

**Decision:** 7 total. Distribution: tests=1, deps=1, techniques=3, prior_art=2. Within `cycle-discover.md` Step 3 budget (5-10 total, max 3 per corner).

**Rationale:** `techniques` justifies 3 because there are 3 candidate patterns to compare (Mem0 metadata convention, Letta block_history pattern, Honcho first-class). `prior_art` 2 because both Honcho + Zep need separate WebFetch trails. `tests` and `deps` 1 each (Letta is the only candidate with relevant tests/deps).

### D6 — Read existing snapshots BEFORE WebFetch (EC-9 absorption)

**Decision:** Before any WebFetch call in Q5 / Q6, `/discover-execute` MUST first Read existing snapshots that may already cover the same narrative:
- For Q3 (Mem0 attribution): no prior snapshot specifically on attribution; proceed normally.
- For Q5 (Honcho data model): no prior snapshot; proceed normally.
- For Q6 (Zep bi-temporal): `.claude/knowledge-base/discoveries/snapshots/v0-8-benchmark-methodology/2026-06-02-dmr-memgpt-zep.md` contains Zep narrative in benchmark-comparison context. Read THIS file FIRST; only WebFetch `zep.ai` + `www.getzep.com/blog/` if the existing snapshot lacks SDK example with `as_of=...` syntax.

**Rationale:** Token saving + faster halt-loop iteration. Snapshots committed for v0-7 + v0-8 are audit-trail content; re-reading them within `/discover-execute` is cheaper than re-WebFetching.

**Consequence:** Q6 method (Fase B) gains preceding step "Read v0-8-benchmark-methodology/2026-06-02-dmr-memgpt-zep.md first; only WebFetch new URLs if existing snapshot insufficient for Q6 Expected answer shape".

### D7 — Q5+Q6 PARTIAL fallback strategy (EC-10 absorption)

**Decision:** If after ~2h total spent on Q5 + Q6 BOTH come back PARTIAL (e.g., Honcho landing page is pure marketing AND Zep SDK docs gated behind sign-up), the remaining ~1h budget for prior_art DOES NOT get spent on retry. Instead, redirect to deeper Q3 + Q4 code analysis — extracting MORE evidence from Mem0 + Letta source code to compensate for the partial prior_art coverage.

**Rationale:** Honest BLOCKED on web research is acceptable per `cycle-discover.md § Stop conditions` #5+#6. The blueprint can still ship with PARTIAL Q5+Q6 IF Q3+Q4 (code-based answers) are deeper. Inquebrável Rule 3: half-investigation is better than wasted retry.

**Consequence:** Halt-loop checkpoint 5 (NEW, post-Q6) decides budget allocation: if both Q5+Q6 PARTIAL, gate remaining iteration count to Q3+Q4 deepening rather than Q5+Q6 retry. Blueprint Recommendations section acknowledges the web-research thinness explicitly.

## Research Questions

### Q1 — Integration tests for bi-temporal in Letta

**Corner:** Tests
**Method (Fase A):** `Grep -rn "t_valid\|t_invalid\|archived_at\|valid_from\|valid_to\|asOf\|as_of" .claude/knowledge-base/references/letta/tests/`
**Method (Fase B):** Read top 3 hits + `letta/orm/block_history.py` Read + `find letta/tests -name "*history*"` to surface block-history tests
**Expected answer shape:** table of (test file path : test name : pattern asserted : seeding strategy). If Letta has zero bi-temporal tests → that's a finding too (means bi-temporal isn't load-bearing for them either).
**Stop:** if no hits in Fase A AND no `block_history*` tests, mark BLOCKED with reason "Letta does not test bi-temporal as a first-class concern" — move on.

### Q2 — Dependencies Letta adds for `block_history.py` and `archive.py`

**Corner:** Dependencies
**Method (Fase A):** Read `.claude/knowledge-base/references/letta/letta/orm/block_history.py` Read + `letta/orm/archive.py` Read; grep their imports
**Method (Fase B):** Cross-reference imports against `.claude/knowledge-base/references/letta/pyproject.toml` (or setup.py); identify if they pull anything beyond stock SQLAlchemy + pydantic
**Expected answer shape:** dependency delta = ∅ (Letta uses stock SQLAlchemy bi-temporal helpers) OR list of specialized libs (e.g., `sqlalchemy-continuum`). The answer tells us if bi-temporal is "cheap to implement" or "requires a new vendor dep".
**Stop:** if Letta doesn't have these files OR they exist but import only stdlib + sqlalchemy + pydantic, mark "deps overhead = zero" and conclude bi-temporal is implementation-cost-only.

### Q3 — Mem0's metadata convention for attribution (`_build_filters_and_metadata`)

**Corner:** Techniques
**Method (Fase A):** Grep `^def _build_filters_and_metadata` in `.claude/knowledge-base/references/mem0/mem0/memory/main.py` to confirm start line; identify next `^def` (empirical verification 2026-06-02: starts line 231, next def `_build_session_scope` at line 317, so function spans 231-316). Read that exact range (NOT the old hardcoded `231-300` which missed ~17 LoC per EC-2). Grep `attributed_to` + `attribution` across `mem0/`.
**Method (Fase B):** Cross-reference with `mem0-ts/src/oss/` TypeScript port (same convention?); inspect `mem0/memory/storage.py` for how metadata is persisted and queried
**Expected answer shape (homogeneous per EC-4):**
- `schema_or_convention`: e.g., `metadata.{key_name}: {value_type}` OR explicit column name
- `query_api_signature`: code snippet of how a caller queries by this field
- `migration_cost`: `zero` (Mem0 case if pure metadata convention — no schema change)
- Free-form: caller pseudo-code + key name discovery
**Stop:** if grep returns zero `attributed_to` hits — answer Mem0's convention is fully ad-hoc (callers can put anything in `metadata`); skip the cross-reference, save the 30 min budget.

### Q4 — Letta's `block_history.py` design — bi-temporal spectrum classification

**Corner:** Techniques
**Method (Fase A):** Read `.claude/knowledge-base/references/letta/letta/orm/block_history.py` (full file — empirical verified 48 LoC at 2026-06-02; real SQLAlchemy code, not stub) + `letta/orm/block.py` for the parent table relationship
**Method (Fase B):** Locate migration via `find letta/alembic/versions/ -name "*block_history*"` (REFINED per EC-3 — generic `*block*` would explode since Letta has 167 migrations and many touch block-prefixed tables: block_history, block, blocks_agents, blocks_tags, blocks_conversations etc); diff against parent block migration to reveal the schema delta
**Expected answer shape (homogeneous per EC-4 + categorical per EC-7):**
- Classification: pick exactly ONE of `audit_log_only` (only `created_at`-style timestamp; no temporal semantics) / `temporal_versioning` (valid_from + valid_to columns BUT no query API exposing them) / `full_bitemporal` (storage + queryable `asOf` API)
- `schema_or_convention`: the actual SQL column names + types (excerpt)
- `query_api_signature`: code snippet of Letta's API to query historical state (or `n/a` if classification is audit_log_only)
- `migration_cost`: `zero` / `low` / `medium` / `high` based on schema delta + trigger complexity
**Stop:** any classification is acceptable; honest BLOCKED if migration files don't exist or are too sparse to interpret.

### Q5 — Honcho's first-class peer perspective: data model + AGPL terms

**Corner:** prior_art (web)
**Method (Fase A):** `WebSearch "honcho dialectic api docs peer perspective"` (or similar)
**Method (Fase B):** `WebFetch https://honcho.dev/` for their landing page; `WebFetch https://docs.honcho.dev/` for technical docs (subdomain ADDED to allowlist per EC-1 absorption); `WebFetch https://app.honcho.dev/` if surfaced (subdomain ADDED to allowlist); `WebFetch https://github.com/plastic-labs/honcho/blob/main/README.md` for the canonical README; Snapshot all to `.claude/knowledge-base/discoveries/snapshots/multi-peer-and-bi-temporal-gaps/`
**Expected answer shape (homogeneous per EC-4):**
- `schema_or_convention`: Honcho's data model excerpt (peer relation, attribution semantics) — verbatim from docs or repo
- `query_api_signature`: code snippet of Honcho's SDK call for multi-peer query
- `migration_cost`: `high` (first-class column requires SQL migration in TheMemory) — pre-judged because Honcho's pattern IS first-class
- License: AGPL-3.0 confirmation (from LICENSE file) + commercial-license offer mention (if surfaced)
**Stop:** if `honcho.dev` is unreachable OR rate-limited OR `docs.honcho.dev` returns 404, fall back to GitHub README only — document the partial answer and move on. Honest BLOCKED is acceptable per ADR D7.
**Pre-condition:** ADR D3 + halt-loop checkpoint 0 — all 3 honcho subdomains must be in allowlist before Q5 runs.

### Q6 — Zep/Graphiti's `asOf` query API + temporal edge model

**Corner:** prior_art (web)
**Method (Fase A — pre-step EC-9):** FIRST Read `.claude/knowledge-base/discoveries/snapshots/v0-8-benchmark-methodology/2026-06-02-dmr-memgpt-zep.md` (existing snapshot covers Zep narrative in v0.8 benchmark context). If it contains SDK example with `as_of=...` syntax, skip Fase B entirely. THEN `WebSearch "zep graphiti bi-temporal asOf python sdk"` (and variants) if snapshot insufficient.
**Method (Fase B):** `WebFetch https://zep.ai/` for landing page + temporal claims; `WebFetch https://www.getzep.com/blog/` (historical blog) — `zep.ai` AND `www.getzep.com` already in allowlist per v0-7 cycle. EC-6 fallback: if neither root surfaces the SDK code, search for `help.getzep.com` / `docs.zep.ai` URLs in WebSearch results — if found, register `<!-- BLOCKED: zep technical docs at subdomain X — extend allowlist if pursuing this gap further -->` in iteration log AND mark Q6 PARTIAL. Do NOT extend allowlist mid-cycle (out-of-band action). If a specific Graphiti repo URL surfaces, snapshot the README.
**Expected answer shape (homogeneous per EC-4):**
- `schema_or_convention`: Zep schema sketch (graph nodes + temporal edges OR PostgreSQL columns)
- `query_api_signature`: SDK code example verbatim (e.g., `session.get_facts(as_of=...)` or equivalent)
- `migration_cost`: `high` (requires graph backend OR new column infrastructure)
- Free-form: whether moat is API discipline OR storage architecture
**Stop:** if `zep.ai` only ships landing-page marketing AND the actual query API requires sign-up to read SDK docs AND EC-6 subdomain fallback fails, mark Q6 PARTIAL with explicit reason — note that the moat is gated behind their funnel. Per ADR D7, remaining budget redirects to Q3+Q4 deepening.

### Q7 — Cross-cutting: how do the 3 patterns compare on the 4 pre-defined homogeneous dimensions?

**Corner:** Techniques (synthesis question)
**Method (Fase A):** Synthesize from Q3 + Q4 + Q5 (their Expected answer shapes are now homogeneous per EC-4 — `schema_or_convention` + `query_api_signature` + `migration_cost`). Build a 3-row × 4-col comparison table.
**Method (Fase B):** If discrepancies emerge between Fase A synthesis and actual code, return to Q3/Q4/Q5 source files to resolve
**Expected answer shape:** Markdown table with 3 rows (Mem0 metadata / Letta block_history / Honcho first-class) × 4 cols enforced from upstream:
1. `schema_or_convention` — verbatim excerpts from Q3/Q4/Q5
2. `query_api_signature` — verbatim SDK code examples from Q3/Q4/Q5
3. `migration_cost` — exactly one of `zero | low | medium | high` from Q3/Q4/Q5
4. `backward_compat` — derived from Q3/Q4/Q5 (Mem0 metadata = breaks nothing; Honcho first-class = requires migration of existing rows)

Plus one-paragraph synthesis recommending which pattern TheMemory should borrow for `attributed_to` v1.1 implementation. The recommendation MUST cite which of `schema_or_convention` / `query_api_signature` / `migration_cost` / `backward_compat` was the load-bearing factor.

## Coverage Matrix

| Question | Corner | Method (Fase A) | Method (Fase B) | Expected answer shape |
|---|---|---|---|---|
| Q1 | Tests | Grep `t_valid\|t_invalid\|archived_at\|asOf\|as_of` in `references/letta/tests/` | Read top 3 hits + `block_history.py` + `find letta/tests -name "*history*"` | Test file map (path : assertion : seeding) OR honest "no bi-temporal tests" finding |
| Q2 | Deps | Read `letta/orm/block_history.py` + `letta/orm/archive.py` imports | Cross-ref against `letta/pyproject.toml` | Dependency delta or ∅ (stock SQLAlchemy) |
| Q3 | Techniques | Grep `^def _build_filters_and_metadata` → Read 231-316 (NOT 231-300 per EC-2) + grep `attributed_to` across `mem0/` | Cross-ref `mem0-ts/src/oss/` + `mem0/memory/storage.py` | **Homogeneous (EC-4):** `{schema_or_convention, query_api_signature, migration_cost: zero}` + caller pseudo-code |
| Q4 | Techniques | Read `letta/orm/block_history.py` (48 LoC empirical) + `letta/orm/block.py` | `find letta/alembic/versions/ -name "*block_history*"` (NARROW per EC-3) | **Homogeneous (EC-4) + categorical (EC-7):** classification ∈ {audit_log_only, temporal_versioning, full_bitemporal} + `{schema_or_convention, query_api_signature, migration_cost}` |
| Q5 | prior_art | WebSearch Honcho dialectic API | WebFetch honcho.dev + docs.honcho.dev + app.honcho.dev (3 entries per EC-1) + github plastic-labs/honcho/README — snapshot all | **Homogeneous (EC-4):** `{schema_or_convention, query_api_signature, migration_cost: high}` + AGPL license confirmation |
| Q6 | prior_art | EC-9 first: Read v0-8 dmr-memgpt-zep snapshot. Then WebSearch zep graphiti asOf if needed | WebFetch zep.ai + www.getzep.com/blog. EC-6 fallback: if SDK code at help.getzep.com/docs.zep.ai subdomain, mark Q6 PARTIAL (no out-of-band allowlist edit) | **Homogeneous (EC-4):** `{schema_or_convention, query_api_signature, migration_cost: high}` + moat-type (API discipline vs storage architecture) |
| Q7 | Techniques | Synthesize Q3 + Q4 + Q5 (homogeneous dims enforced upstream per EC-4) | Resolve discrepancies in source files | 3-row × 4-col table (Mem0/Letta/Honcho) × (schema_or_convention, query_api_signature, migration_cost, backward_compat) + recommendation paragraph citing load-bearing factor |

<!-- DEFER-CORNER: tools | no tool variation expected for these gaps per ADR D2; bi-temporal + multi-peer are pure data-model + query-API features. -->

**Coverage:** 7/7 questions mapped to methods. 4 of 5 corners populated (tests/deps/techniques/prior_art). 1 corner (tools) explicitly DEFERRED via ADR D2.

## Halt-loop checkpoints

For `/discover-execute`:

0. **BEFORE iteration 1 (NEW per EC-5 absorption — ADR D3 mechanization):** verify allowlist contains the 3 Honcho entries:
   ```bash
   grep -q "^honcho.dev " .claude/rules/discover-web-allowlist.txt && \
   grep -q "^docs.honcho.dev " .claude/rules/discover-web-allowlist.txt && \
   grep -q "^app.honcho.dev " .claude/rules/discover-web-allowlist.txt
   ```
   If any returns non-zero, HALT with reason "ADR D3 pre-condition: honcho subdomains not in allowlist; human MUST edit `.claude/rules/discover-web-allowlist.txt` before re-running /discover-execute". Does NOT enter Q1 work until satisfied. Mechanizes the previously-human-gated pre-condition.

1. **After Q1:** state file `.progress-multi-peer-and-bi-temporal-gaps.json` MUST record `bi-temporal-test-hits: N` (0 is acceptable + means "Letta does not test bi-temporal first-class").
2. **After Q1 + Q2 (NEW per EC-8):** if BOTH `bi-temporal-test-hits = 0` AND `deps_delta = ∅`, treat as POSITIVE finding "bi-temporal in Letta is implementation-cost-only + zero infra burden". Gate Q4 to focus exclusively on schema analysis (skip the dep-audit sub-section that would now be vacuous). This SAVES ~20 min of budget vs the original sequential path.
3. **After Q3 + Q4:** before advancing to Q5/Q6 (web research expensive), the blueprint MUST have BOTH technique answers OR mark BLOCKED honestly. Web prior_art is the budget-sink; gate it behind code answers.
4. **After Q5:** if `honcho.dev` snapshot file exists at `.claude/knowledge-base/discoveries/snapshots/multi-peer-and-bi-temporal-gaps/{sha256}.md`, mark Q5 DONE. If fallback to github plastic-labs/honcho/README, mark Q5 PARTIAL with reason.
5. **After Q6 (NEW per ADR D7 + EC-10):** if BOTH Q5 AND Q6 returned PARTIAL after ~2h total prior_art spend, redirect remaining ~1h budget to Q3+Q4 deepening (deeper code analysis on Mem0 + Letta to compensate for thin web evidence) — do NOT retry Q5/Q6 WebFetch loops.
6. **Before Q7 synthesis:** the cross-cutting comparison table cannot be authored until Q3 + Q4 + Q5 are all DONE or PARTIAL with explicit BLOCKED reasons AND ALL three carry the homogeneous shape (`schema_or_convention`, `query_api_signature`, `migration_cost: zero|low|medium|high`) per EC-4. If any of Q3/Q4/Q5 lacks one of those keys, HALT — synthesis cannot proceed cleanly. Q7 is forbidden as the FIRST question answered.

## Acceptance Criteria

- [ ] All 7 research questions answered (with citations to `.claude/knowledge-base/references/` for Q1-Q4 + snapshot SHA256s for Q5-Q6 + synthesis-only for Q7)
- [ ] Cross-cutting comparison table populated across 5 vendors (TheMemory current, Mem0 convention, Letta block_history, Honcho first-class AGPL, Zep/Graphiti)
- [ ] Recommendations section provides exactly 4 concrete decision proposals: (a) `attributed_to` shape (first-class column vs metadata convention), (b) `attributed_to` impl path (drizzle migration sketch), (c) bi-temporal local-runtime path (or honest "stay gated per ADR-0006"), (d) bi-temporal query API shape (mirrors Zep's `asOf` or invents new)
- [ ] All 3 Honcho entries added to `discover-web-allowlist.txt` (`honcho.dev` + `docs.honcho.dev` + `app.honcho.dev`) with inline rationale per ADR D3 (EC-1 absorption)
- [ ] Halt-loop checkpoint 0 mechanization confirmed — `/discover-execute` does NOT enter Q1 until the 3 entries are verified present (EC-5 absorption)
- [ ] Q3 + Q4 + Q5 answers carry homogeneous `{schema_or_convention, query_api_signature, migration_cost}` shape so Q7 synthesis is well-typed (EC-4 absorption)
- [ ] Q4 classification ∈ `{audit_log_only, temporal_versioning, full_bitemporal}` (NOT binary Y/N — EC-7 absorption)
- [ ] Every web citation has a snapshot file at `.claude/knowledge-base/discoveries/snapshots/multi-peer-and-bi-temporal-gaps/`
- [ ] Tools corner explicitly DEFER-CORNER marker preserved (ADR D2)
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS

## Global Definition of Done

- [ ] All Acceptance Criteria above checked
- [ ] Blueprint saved at `.claude/knowledge-base/discoveries/blueprints/multi-peer-and-bi-temporal-gaps-blueprint.md`
- [ ] `/discover-confidence` re-run after `/discover-improve` (if needed) and verdict ≥ SHIPPABLE_WITH_CAVEATS
- [ ] Recommendations section links back to CLAUDE.md Roadmap rows 7 (v0.5 cloud + bi-temporal) and 12 (v1.1 multi-peer) so the implementation `/to-plan` cycles can cite this blueprint as upstream evidence
- [ ] Blueprint cites `.claude/rules/architecture.md § 1` (3-tier scope) AND `§ 2` (ADD-only) constraints — any recommendation that contradicts them MUST be flagged "REQUIRES STRATEGIC REVIEW"
- [ ] Discovery plan (this file) referenced from blueprint header
