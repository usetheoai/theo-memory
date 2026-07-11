# Dogfood unified runner+gate — first real run (T5.1, 2026-07-11)

**Verdict: `EVIDENCE_INSUFFICIENT`** — 1 journey green (J-MCP-3), 31 red.

## This is the HONEST, CORRECT outcome (a success of the gate, not a plan failure)

The runner+gate machinery (ADR-0019) is proven END-TO-END:
- `run_journey_audit.py` runs on the REAL catalog + REAL evidence dir and emits an honest verdict.
- A REAL journey was executed: **J-MCP-3** (OpenMemory compat) — `tests/integration/openmemory` 4/4
  green (exit 0) vs the live `themem_pgvector`; recorded as real § 5 evidence with a genuine
  `oracle_result`. The audit counts it green (proving run → real-evidence → audit works).
- The other 31 journeys have no fresh § 5-format evidence (the legacy `claude-code-auto-memory`
  files use the OLD anchor-scenario frontmatter without `outcome`/`oracle_result`, so they are
  correctly NOT counted). The gate honestly reports INSUFFICIENT, naming each.

Per the plan's Final Phase "If Validation Fails" #3: the 31 un-evidenced journeys are **dogfood
FINDINGS**, not plan failures. They do NOT block plan completion — but they DO block any
`production-ready`/v1.0 claim until each journey is driven green (the ongoing dogfood work, now
possible via `/dogfood run`).

## Integration-validation defect fixed in T5.1
- `J-CLI-1` used a `J-CLI-` id prefix not matched by the scripts' `J-(SDK|API|MCP|UI)-` regex →
  silently untracked. Renamed to `J-API-7` (API surface, per Q2). The audit now sees all 32 journeys.

## Next (dogfood usage, not implementation)
Run `/dogfood run` per surface to drive the remaining 31 journeys green (SDK/API integration suites,
MCP native, UI via the dev-stack + Chrome runbook in `drivers/ui.md`). When all 32 are fresh+green,
the audit flips to `EVIDENCE_SUFFICIENT` — the honest bar for the "100% functional" claim.
