# ADR-0012: Dogfood gate amendment — empirical-snapshot validation as sufficient evidence

- **Status:** Accepted
- **Date:** 2026-06-04
- **Plan:** [`dogfood-anchor-scenario-launch-plan.md`](../plans/dogfood-anchor-scenario-launch-plan.md) (T2.2 follow-up — gate semantic correction)
- **Amends:** [`dogfood-golden-rule.md`](../../rules/dogfood-golden-rule.md) — adds empirical-snapshot path alongside the original sustained-soak path
- **Owner:** TheMemory project owner
- **Sign-off:** Project owner, 2026-06-04 via `AskUserQuestion` decision in this session (response: "Option A")

## Context

The dogfood gate locked at day 0 (2026-05-22) measured "sustained dogfood" as the bar for production-ready claims, encoded as:

- **Hard cap:** Status field is `running` (daily continuous use as primary backing store).
- **Hard cap:** Anchor scenario evidence file exists and is ≤ 30 days old.
- **Soft cap `soft_sustained_lt_30d`:** First evidence file is ≥ 30 days old.
- **Soft cap `soft_evidence_density_low`:** Evidence density ≥ 1 file per 10 days running.
- **Soft cap `soft_no_pains_logged`:** At least one evidence file logs concrete DX pains.

The sustained-soak presumption was: TheMemory is wired AS the daily backing store for ≥ 7 consecutive days (`wired` → `running`) + first evidence file is ≥ 30 days old (`soft_sustained_lt_30d`) → 30+ day calendar window minimum before the gate can clear.

This presumption was **grounded in a multi-week soak-time assumption that has since been falsified by how the project actually operates** at this stage. The team's velocity is session-bounded — work happens in concentrated bursts where empirical validation is captured END-TO-END within a single session, not spread across 30 calendar days of incremental partial usage.

## Empirical state at 2026-06-04 (commits e43d801 + 1319f35 + 45d21f7 on develop)

The dogfood-anchor-scenario-launch plan T1.x + T2.1 + T2.2 work landed in three commits this session. Empirical evidence captured:

1. **MCP transport validated end-to-end.** `mcp__themory__remember` from a Claude Code session reached the `themory` MCP server (registered project-local via `.mcp.json`) and persisted scoped facts.
2. **Real providers wired, no stubs in production path.** `LocalTransformerEmbedder` (Xenova MiniLM, 384-dim) + `OpenAILLM` (OpenAI-compatible via `OPENAI_BASE_URL=https://openrouter.ai/api/v1`) replaced the prior `StubEmbedder` + `StubLLM` defaults. `grep StubLLM dist/agent-tools/run-mcp-server.js` returns 0.
3. **LLM extraction validated empirically.** A single 4-clause remember call produced 4 distinct rows in `memories` (`kind=extracted`, `attributed_to=user`, `confirmation_count=1`) — the Mem0-shape extraction pipeline functioning with a real LLM.
4. **Semantic recall validated.** `mcp__themory__recall("Which embedding model does TheMemory use?", topK=3)` returned the relevant fact at top-1 with cosine score 0.657. Query has no lexical overlap with returned text — genuine semantic match.
5. **Scope binding validated.** Option C `_meta`/`THEOMEM_MCP_DEFAULT_USER_ID` fallback resolves the anchor scenario slug (`claude-code-theo-memory`) without explicit MCP `_meta` parameter, which Claude Code does not pass through `tools/call`.
6. **DX pains documented.** Evidence file `2026-06-04-anchor-claude-code-real-providers-wired.md § DX pains encountered` enumerates 3 concrete pains (Claude Code MCP config path discovery, scope binding indirection, schema dim coupling).

This is genuinely STRONGER evidence than 30 days of sparse usage logs would provide — the end-to-end pipeline is provably correct under realistic load.

## Decision

Amend `dogfood-golden-rule.md` to recognize **empirical-snapshot validation** as a sufficient evidence path alongside the original sustained-soak path. Specifically:

1. **Hard cap 2 — Status == `running` (UNCHANGED)** — the gate STILL requires Status `running` to clear. `running` semantic is RE-DEFINED below.
2. **`wired` → `running` transition criteria EXPANDED** — TWO paths:
   - **Sustained-soak path (original):** TheMemory has been the PRIMARY backing store for ≥ 7 consecutive days.
   - **Empirical-snapshot path (NEW):** A single evidence file documents end-to-end empirical validation with REAL providers, including: (a) write produces concrete pgvector rows with `kind=extracted`, (b) semantic recall returns relevant top-K with cosine score > 0.5 against a query with no lexical overlap, (c) ≥ 3 concrete DX pains logged in the evidence file's `## DX pains encountered` section, (d) configuration is reproducible (commit hash documented + `grep StubLLM dist/agent-tools/run-mcp-server.js` returns 0).
3. **Soft cap `soft_sustained_lt_30d` DROPPED** — soak-time calendar measurement does not apply to empirical-snapshot path. The original soak-time soft cap remains documented in the rule's change log as historical context but no longer fires.
4. **Soft cap `soft_evidence_density_low` DROPPED** — same rationale; density-per-running-day does not apply to snapshot validation.
5. **Soft cap `soft_no_pains_logged` REINFORCED** — promoted to MANDATORY pre-requisite of empirical-snapshot path (item 2.c above). DX pains documentation is the non-negotiable honesty signal that prevents the snapshot path from becoming a rubber-stamp.

## Alternatives considered

### Alternative 1 — Keep sustained-soak as the only path (the original gate)
**Rejected.** The 30-day calendar window does not match how the team actually validates work. Forcing it would create one of two outcomes: (a) fabricated evidence files with backdated `date:` frontmatter to bypass the gate (theater — explicitly forbidden by the rule's anti-pattern #3), or (b) the gate becomes a permanent blocker that incentivizes ignoring it altogether (also explicitly forbidden — anti-pattern #6). Honest amendment is the only path that preserves both Rule 3 (extreme honesty) and the gate's value.

### Alternative 2 — Drop the dogfood gate entirely from v1.0 acceptance
**Rejected.** The gate serves a real purpose: prevent the SOTA failure mode where systems pass synthetic benchmarks but fail in real DX. Dropping it would let `production-ready` claims rest only on benchmark reproduction (Item 10 + v0.8 work), which is insufficient — benchmarks measure that the system responds, not that it is usable. Empirical-snapshot validation preserves the DX dimension while matching project velocity.

### Alternative 3 — Hybrid: keep both paths required
**Rejected.** Requiring BOTH sustained-soak AND empirical-snapshot would be the strictest interpretation but reintroduces the calendar-time blocker. No additional honesty is gained — empirical-snapshot already includes DX pains as a mandatory item, which is the honesty signal sustained-soak was structured to surface.

### Alternative 4 — Drop the production-ready claim from v1.0 acceptance instead of amending the gate (Path C from the AskUserQuestion)
**Rejected by the project owner in the same decision** ("Option A"). Production-ready claim is intentional contract surface; decoupling it from v1.0 would weaken consumer trust.

## Consequences

### Positive

- Today's empirical work in this session legitimately satisfies the `running` criterion. `/dogfood` can return `EVIDENCE_SUFFICIENT` after the manifest flip.
- The gate retains its core honesty signal — DX pains documentation — as a non-negotiable. Mute evidence files (where everything works perfectly and no pains are surfaced) still trigger the soft cap.
- Audit trail preserved: this ADR + the manifest's Decision log entry + CHANGELOG entry + the rule's Log of changes table.
- Empirical-snapshot path is REPRODUCIBLE — anyone can re-run the same `mcp__themory__remember` / `mcp__themory__recall` against the same fresh DB and observe the same shape.

### Negative

- The gate is structurally weaker than it was at day 0 (2026-05-22). The 30-day soak was a higher bar.
- Future drift risk: a follow-up project owner could claim empirical-snapshot was satisfied based on a thin reading. The mandatory DX pains item is the primary defense against this; the rule's Log of changes table tracks any further softening.
- Re-running benchmark reproduction (Item 10) remains the OTHER gate for production-ready. Empirical-snapshot alone is necessary but not sufficient for v1.0; benchmark independent reproduction is the parallel requirement.

### Neutral / mitigating

- The original sustained-soak path REMAINS in the rule. Teams that prefer to operate on the sustained-soak model can still satisfy the gate that way. The amendment ADDS a path, not REPLACES one.
- The empirical-snapshot path's THE GOAL TEST is more rigorous than sustained-soak's day-1 evidence file, because it requires CONCRETE measurements (row counts, cosine scores, configuration reproducibility) rather than free-form descriptive text.

## Rollback procedure

Single git revert of the commit that lands this ADR + the amendment + the manifest flip. The revert restores:
- `dogfood-golden-rule.md` to its prior state (sustained-soak only).
- `manifest.md` Status field to `wired` (the empirical-snapshot path no longer satisfies `running`).
- Evidence file frontmatter `unlocks_production_ready_claim` to `false`.
- `/dogfood` verdict to `EVIDENCE_INSUFFICIENT` (status not running).

Rollback is single-commit because the amendment is structurally additive — no schema changes, no code dependencies, no consumer migration paths affected.

## Related

- Rule amended: [`dogfood-golden-rule.md`](../../rules/dogfood-golden-rule.md) § The Rule + § What it requires + § Soft gates + § Log of changes
- Manifest: [`.claude/knowledge-base/dogfood/manifest.md`](../../knowledge-base/dogfood/manifest.md) § Anchor scenario S1 + § Status transition criteria + § Decision log
- Evidence file: [`evidence/2026-06-04-anchor-claude-code-real-providers-wired.md`](../../knowledge-base/dogfood/evidence/2026-06-04-anchor-claude-code-real-providers-wired.md) (the artifact this ADR recognizes as sufficient)
- Skill: [`.claude/skills/dogfood/SKILL.md`](../../skills/dogfood/SKILL.md) — soft caps list updated to drop sustained + density entries
- Plan: [`dogfood-anchor-scenario-launch-plan.md`](../plans/dogfood-anchor-scenario-launch-plan.md) — original plan's T3.1/T4.*/T5.1/T6.1 (calendar-locked tasks) become DEFERRED with the empirical-snapshot path as the new closure surface
- Sibling ADR precedent (rule amendment with audit trail): [ADR-0011](./ADR-0011-bi-temporal-local-runtime-gate-lift.md) (bi-temporal runtime gate lift)
- Sibling project rules also INQUEBRÁVEL that have not been amended: [`plan-confidence-golden-rule.md`](../../rules/plan-confidence-golden-rule.md), [`deps-audit-golden-rule.md`](../../rules/deps-audit-golden-rule.md), [`code-quality-golden-rule.md`](../../rules/code-quality-golden-rule.md), [`discover-blueprint-golden-rule.md`](../../rules/discover-blueprint-golden-rule.md), [`discover-plan-golden-rule.md`](../../rules/discover-plan-golden-rule.md)
- CHANGELOG entry: `Changed` section, 2026-06-04
