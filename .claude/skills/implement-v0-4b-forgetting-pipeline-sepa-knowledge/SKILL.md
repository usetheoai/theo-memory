---
name: implement-v0-4b-forgetting-pipeline-sepa-knowledge
description: Domain knowledge skill paired with the SEPA agent for plan v0-4b-forgetting-pipeline. Consult during /implement halt-loop when reasoning about additive vs multiplicative scoring composition, exponential half-life decay forms, Postgres advisory-lock patterns for concurrent eviction, pgvector cosine-distance operator semantics, OTel Counter best practices, or the long-tail preservation guardrail (rare-but-isolated memory protection multiplier). Triggering phrases. "is additive scoring idiomatic", "what's the canonical Postgres advisory lock pattern", "pgvector cosine operator semantics", "OTel Counter vs Histogram", "long-tail eviction protection", "half-life regression formula", "isolation distance signal".
allowed-tools: Read, Glob, Grep, WebSearch, WebFetch
model: opus
---

# Knowledge skill paired with SEPA — v0-4b-forgetting-pipeline

Hydrates plan-specific context + refreshes community best practices on demand. Invoked via `Skill` tool by the SEPA agent when reasoning needs canonical evidence beyond the plan/ADRs/blueprint.

## Plan-specific context (frozen at generation 2026-05-30)

### Goal (verbatim)

> "Enable `@usetheo/memory` consumers to opt into AUTOMATED triadic-scored forgetting (capacity-based OR cron-based triggers) with long-tail preservation, soft-deleting low-value memories via `t_invalid` while protecting rare-but-isolated ones, measured by `tests/integration/forgetting/triadic-eviction.test.ts` passing (seed 1000 memories with 50 rare-query targets in one scope + invoke eviction removing 30% by triadic score + assert `recall@10` on rare-query set ≥ 0.70 against real `ankane/pgvector:v0.5.1` AND the guardrail: rare-isolated memory survives ≥ 5 consecutive `CapacityBasedTrigger` eviction passes)."

### ADRs (blueprint D7-D11 + plan D1, D12-D18)

| ID | Decision |
|---|---|
| D7 | Half-Life Regression exponential form: `p = 2^(-Δt/h)`. NOT raw `e^(-t)` Ebbinghaus. |
| D8 | **ADDITIVE** weighted sum (NOT multiplicative). Rejects Generative Agents shape. Default weights `[0.4, 0.3, 0.3]`. |
| D9 | Long-tail multiplier `clamp(0.1, 1.0, isolation_distance / mean_isolation_distance)`. Multiplicative on top of base. |
| D10 | Eviction triggers: `CapacityBasedTrigger` + `TimeBasedTrigger` (both ship; consumer picks). |
| D11 | Test pyramid: unit (math) + integration (recall@10 vs real pgvector). NO E2E. |
| D12 | `EvictionPolicy` is 8th DIP at `src/core/dip/eviction-policy.ts`. |
| D13 | Single Drizzle migration `0003_eviction_columns.sql` (v1.2 rename — collision with v0.6's 0002). |
| D14 | `half_life_seconds` lazy backfill from `llm_importance_score` at scoring time. |
| D15 | `recall()` write-back batched (single UPDATE per scope). |
| D16 | Long-tail multiplier uses pgvector `<=>` (cosine distance). |
| D17 | Soft-delete via `t_invalid = NOW()`. NEVER `DELETE`. |
| D18 | `InMemoryVectorStore` linear-scan cosine fallback for T7.2 (EC-3). |

### Edge cases absorbed (v1.1)

- EC-1 (T2.2): stale `half_life_seconds` on `llm_importance_score` update → lazy re-derive.
- EC-2 (T5.1): concurrent `remember()` race → Postgres advisory lock `pg_advisory_xact_lock(hash_text('eviction_' || scope))`.
- EC-3 (D18 + T7.2): `InMemoryVectorStore` cosine gap → linear-scan impl OR promote T7.2 to integration.
- EC-4 (T6.1 + T8.1): OTel counter `forgetting_evict_total` declared at T6.1, observed at T8.1.
- EC-5..EC-10 (RED tests): boundary conditions (zero weights, NULL half_life, all-frequent siblings).
- EC-11 + EC-12 (DOCUMENT): documented in plan.

### Project rules cited by plan ADRs

- `architecture.md` § 4 (Mem0-shape architecture; DIP boundaries)
- `testing.md` (TDD; 100% on critical paths)
- `no-paper-names-in-code.md` (NEVER paper names in code surfaces — JSDoc, comments, test names, error messages)
- `cycle-implement.md` (halt-loop invariants)
- ADR-0006 (bi-temporal local schema — `t_invalid` semantics)
- ADR-0008 (DIP method counts — original 5 locked)

### Domain keywords (for WebSearch query construction)

- additive triadic scoring memory eviction
- exponential half-life decay formula `p = 2^(-Δt/h)`
- isolation distance long-tail preservation
- pgvector cosine distance operator `<=>` semantics 2026
- Postgres advisory lock `pg_advisory_xact_lock` patterns
- OpenTelemetry Counter vs Histogram best practices Node 2026
- TypeScript pure function unit test patterns Vitest

## Invocation modes

### Mode A — Plan-context recap (zero-network, cheapest ~500 tokens)

SEPA needs to confirm what the plan ACTUALLY says vs what was implemented. Read the "Plan-specific context" section above + cross-reference SEPA's question. Return: 1-sentence recap + cite the relevant ADR/EC by ID.

### Mode B — Community knowledge refresh via WebSearch (~2-5k tokens)

SEPA needs current best-practice guidance for a domain pattern. Steps:

1. Verify domain term is in scope (matches `Domain keywords` above OR plan's ADR vocabulary). If unrelated, decline + tell SEPA to ask main session.
2. Construct WebSearch query: `<pattern-name> <language> best practices 2026` (use current year).
3. Prefer allowlisted canonical domains (`.claude/rules/discover-web-allowlist.txt`): `arxiv.org`, `martinfowler.com`, `refactoring.guru`, vendor docs (`postgresql.org`, `github.com/pgvector/pgvector`, `opentelemetry.io`), GitHub source.
4. WebFetch top 1-2 results; extract the relevant pattern/contract/rule.
5. Return: (a) canonical definition (verbatim quote), (b) URL, (c) verdict (matches plan / diverges / not applicable).

NEVER cite community knowledge from training-data recall — always WebSearch + WebFetch first.

### Mode C — Cross-reference check (~1k tokens)

SEPA needs to verify a cross-reference: "ADR D8 cited in plan T2.1 — does it appear in JSDoc?". Use Read + Grep on the staged diff path SEPA provides. Return: yes/no + file:line where citation lives (or its absence).

## High-risk areas (where SEPA WILL likely invoke this skill)

1. **T2.1 — Additive vs multiplicative scoring composition.** Generative Agents (Park 2023) uses multiplicative. D8 explicitly chose additive. SEPA may want to verify the math against canonical sources to confirm the chosen weights produce sensible orderings.

2. **T2.1 — Half-life regression formula.** D7 cites Settles & Meeder 2016 (ACL paper). SEPA may want canonical quote of the `p = 2^(-Δ/h)` form for JSDoc evidence (but JSDoc CANNOT cite paper names per `no-paper-names-in-code.md` — neutral wording).

3. **T4.1 — pgvector `<=>` operator semantics.** Returns `1 - cosine_similarity` (DISTANCE, not similarity). SEPA may want vendor doc URL to verify ordering semantics for nearest-neighbor.

4. **T5.1 — Postgres advisory lock patterns.** `pg_advisory_xact_lock(hash_text(...))` vs `pg_try_advisory_xact_lock` semantics; transaction-scoped vs session-scoped. SEPA may need canonical PostgreSQL doc URL.

5. **T6.1 — OTel Counter declaration.** Counter vs UpDownCounter vs Histogram for eviction events. Counter is monotonic; eviction count fits. SEPA may want OpenTelemetry doc to verify.

6. **T7.1 — `recall@10` definition.** Standard IR metric: of the 50 rare-query targets, what % appear in top-10 results? Locked at ≥ 0.70.

## Vocabulary lock (per `no-paper-names-in-code.md`)

When SEPA reviews JSDoc / comments / test names / error messages, FLAG MAJOR any of these tokens appearing in `src/` or `tests/`:

- `Voyager`, `Mem0`, `Letta`, `LangMem`, `MemGPT`, `Generative Agents`, `Park 2023`
- `MemoryBank`, `Zhong 2023`, `Settles`, `Meeder`, `ACL 2016`
- `Ebbinghaus`, `HLR`, `Half-Life Regression` (use neutral "exponential half-life decay")
- `Procedural memory`, `episodic-to-semantic distillation` (paper-specific framings)

Neutral wording acceptable:
- "additive weighted scoring" (not "Mem0-style additive")
- "exponential half-life decay" (not "Ebbinghaus" / "HLR")
- "isolation-distance multiplier" (not "long-tail-preservation guardrail")
- "soft-delete via bi-temporal invalidation" (cite ADR-0006, not paper)

## Output format to SEPA

Always respond in this exact shape:

```text
# Knowledge skill response — Mode {A|B|C}

## Sources consulted
- [verbatim] Plan context (frozen at generation 2026-05-30)
- [if Mode B] WebSearch query: "<query>"
- [if Mode B] WebFetch URLs (allowlisted): <url>

## Finding for SEPA
- (1-3 sentences with verbatim quote when citing canonical source)

## Confidence
- [HIGH | MEDIUM | LOW] — explicit per Inquebrável Rule 1
```

Empty finding = `## Finding for SEPA\n- INFO — no community-knowledge gap detected; SEPA may proceed on plan context alone.` Never fabricate findings.

## Boundaries

- NEVER edit files (knowledge-only).
- NEVER invoke side-effect commands beyond Read/Glob/Grep/WebSearch/WebFetch.
- NEVER recommend a pattern outside the plan's declared scope (no scope creep).
- NEVER cite from training-data recall when WebSearch is available — Inquebrável Rule 3 + Anti-pattern #10 from cycle-discover.md v1.1.
- NEVER over-engineer recommendations — KISS prevails.
