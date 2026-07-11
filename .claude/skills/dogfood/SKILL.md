---
name: dogfood
version: 0.2.0
requires: []
description: Unified honesty gate + journey runner (ADR-0019). Blocks any 'production-ready' / 'production-grade' / v1.0 claim without executed evidence that the system is 100% functional. `run` drives EVERY catalogued user journey across all four surfaces (SDK / REST API / MCP / theo-cloud dashboard UI) AS A HUMAN — via the surface drivers, on the real dev-stack + real Chrome — recording one evidence file per journey; `audit` then evaluates catalog x evidence and emits EVIDENCE_SUFFICIENT / EVIDENCE_WITH_CAVEATS / EVIDENCE_INSUFFICIENT. Per Q1 every journey is anchor: SUFFICIENT requires every journey fresh+green. Invoke before any production claim, milestone promotion targeting v1.0, README/CHANGELOG status edit, or release decision.
user-invocable: true
allowed-tools: Read Glob Grep Bash Write Edit
argument-hint: "[run|audit|log-evidence|status]"
---

# Skill: dogfood — unified journey runner + honesty gate

Rewritten per [ADR-0019](../../knowledge-base/adrs/ADR-0019-dogfood-unified-journey-suite.md) from
an evidence-*evaluator* into a **runner+gate**. Claude Code, behaving as a real human user, drives
every catalogued journey across the four surfaces, records evidence, then evaluates. The contract
is the LOCKED [`rules/dogfood-golden-rule.md`](../../rules/dogfood-golden-rule.md) — read it first.

## Sources of truth

- **Journey catalog** — `knowledge-base/dogfood/journeys.md` (§ 9 of the golden rule). One row per
  journey (`id | surface | title | anchor | oracle`); **every journey is `anchor: true`** (Q1).
- **Surface drivers** — how to execute each journey AS A HUMAN + record its `oracle_result`:
  [`drivers/sdk.md`](./drivers/sdk.md), [`drivers/api.md`](./drivers/api.md),
  [`drivers/mcp.md`](./drivers/mcp.md), [`drivers/ui.md`](./drivers/ui.md).
- **Evidence** — append-only `knowledge-base/dogfood/evidence/*.md` (frontmatter per golden rule § 5:
  `journey`/`date`/`operator`/`outcome`/`oracle_result`/`summary`).

## Modes

### `run [surface?]` — execute journeys AS A HUMAN (generate evidence)

1. Validate the catalog first:
   ```bash
   python3 .claude/skills/dogfood/scripts/check_journey_catalog.py --catalog .claude/knowledge-base/dogfood/journeys.md
   ```
   Any issue → fix the catalog before running (all four surfaces covered, every journey anchor).
2. For each journey of the requested surface (or all four), open the matching driver
   (`drivers/{sdk,api,mcp,ui}.md`) and **execute its steps as a human** — run the SDK integration
   suite, `curl` the REST API, drive the MCP client, or drive real Chrome via chrome-devtools MCP
   for the dashboard (the UI driver carries the cross-repo dev-stack runbook).
3. Record ONE evidence file per journey via `log-evidence`, with `oracle_result` = the
   machine-observable proof (suite exit code / HTTP status+shape / Chrome `evaluate_script` return).
   On an unresolvable oracle or a genuinely-red journey, write `outcome: fail reason=…` — **never a
   silent skip** (EC-8). A red journey is a FINDING, not a plan failure.
   **Redact secrets** to `theo_live_`/`sk-or-` + ≤4 chars (EC-2).

### `audit` (default) — evaluate catalog x evidence → verdict

```bash
python3 .claude/skills/dogfood/scripts/run_journey_audit.py \
  --catalog .claude/knowledge-base/dogfood/journeys.md \
  --evidence-dir .claude/knowledge-base/dogfood/evidence \
  --golden-rule .claude/rules/dogfood-golden-rule.md
```

The evaluator applies the golden rule § 3 hard-cap order (zero-anchor structural → per-journey
newest evidence → oracle_result gate → secret gate → freshness) and prints JSON:

```
EVIDENCE_SUFFICIENT     — every anchor journey fresh + green (outcome:pass + non-empty oracle_result)
EVIDENCE_WITH_CAVEATS   — all anchor journeys green; a non-anchor journey is red (thin-evidence soft caps)
EVIDENCE_INSUFFICIENT   — ≥1 anchor journey missing / red / stale / oracle-less / secret-bearing (named)
```

Exit code non-zero on `EVIDENCE_INSUFFICIENT`. Verdict tokens are LOCKED (golden rule § 1).

### `log-evidence` — record one journey's evidence

Interactive: writes `knowledge-base/dogfood/evidence/{journey}-{YYYY-MM-DD-HHMMSS}.md` with the § 5
frontmatter (including the REQUIRED `oracle_result` when `outcome: pass`). No verdict.

### `status` — quick summary

Counts evidence per journey + the age of the most recent; one-line summary. No verdict.

## Anti-patterns

- Treating `EVIDENCE_WITH_CAVEATS` as `SUFFICIENT`. Caveats are explicit — read them.
- Emitting a `pass` whose `oracle_result` merely paraphrases "the journey worked" — the gate rejects
  it (`outcome_pass_requires_oracle_result`). The oracle is a machine observation, not prose.
- Recording fixture evidence (`tests/fixtures/…`) as if it were a real run. Evidence lives in
  `knowledge-base/dogfood/evidence/` and is fresh-dated from an actual `run`.
- A full secret literal in any evidence file (the gate rejects it). Redact to a ≤4-char prefix.
- Running dogfood as theatre. The point is to actually drive the product through its front door.

## Cross-references

- Golden rule (contract): [`rules/dogfood-golden-rule.md`](../../rules/dogfood-golden-rule.md)
- ADR: [`ADR-0019`](../../knowledge-base/adrs/ADR-0019-dogfood-unified-journey-suite.md)
- Catalog: `knowledge-base/dogfood/journeys.md`
- Evaluator: `scripts/run_journey_audit.py` · Validator: `scripts/check_journey_catalog.py`
- Drivers: `drivers/{sdk,api,mcp,ui}.md`
