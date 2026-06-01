# SEPA — Initial Brief / examples-chat-with-memory-v0-4b-expansion

**Date:** 2026-05-31
**Mode:** VERBOSE
**Verdict:** proceed-to-halt-loop

## Plan recap
- Validate that `examples/chat-with-memory` survives v0.4b BREAKING (T7.1 soft-delete) AND exercises the new `createLocalMemory({ eviction })` factory end-to-end, measured by `/test-chat-with-memory` returning READY 33/33 (30 existing + 3 new Group H Eviction scenarios). 7 tasks total (T0.1 pre-flight → T1.1/T1.2/T1.3 demo wiring → T2.1 forget endpoints → T3.1 skill catalog → T4.1 e2e rerun → T5.1 process-dogfood evidence → T6.1 validation gate + push).

## Findings

- [INFO] — Plan ↔ implementation contract alignment: 7 tasks declared in plan = 7 task rows in implementation contract = 7 rows in Coverage Matrix. Dependency graph mirrored verbatim. No drift.

- [INFO] — EC-1 MUST FIX absorbed cleanly: plan v1.1 callout + plan line 336 (T1.3 deep file dependency analysis) specifies "EvictionTab receives userId via prop from MemorySidebar". Cross-reference chain intact (plan → impl contract → SEPA agent definition).

- [INFO] — Deps audit drift fixed in plan v1.2: `next ^14.x` → `next ^15.5.18`. Allowlist applied. Verdict moved FAIL_MEDIUM → PASS_WITH_CAVEATS.

- [INFO] — All 5 ADRs (D1-D5) inline with alternatives + rationale + consequences. ADR D4 honesty discipline triple-anchored.

- [INFO] — ADR D5 (no demo unit-test infra) consistently propagated across all TDD sections.

- [MINOR] — 4 SHOULD TEST items (EC-2 through EC-5) intentionally NOT absorbed into plan tasks. Main session watch-list:
  - EC-2 (T2.1): InMemoryVectorStore.forget({ hard }) behavior — verify no-throw
  - EC-3 (T4.1): 5th tab shift — confirm scenarios A1-G5 use accessible labels not index
  - EC-4 (T6.1): tsconfig.contract.json + tsconfig.lint.json must exclude examples/chat-with-memory/
  - EC-5 (T1.2): eviction-status route must wrap pgPool query in try/catch returning 500 JSON

- [MINOR] — Plan T1.3 line 344 mentions a deferred sibling endpoint `/api/memory/soft-deleted` — explicitly out of scope. T1.3 implementer should NOT scope-creep.

- [MINOR] — Plan-confidence soft signal: 3 weak_imperatives + 2 vague_pronouns (score 87.0). Plan SHIPPABLE at 94.8. Acceptable.

- [INFO] — Vocabulary lock + no-paper-names propagation triple-anchored.

- [INFO] — Environmental gotcha (Node PATH ~/.nvm/versions/node/v22.22.2/bin) documented across plan + impl contract + SEPA agent.

- [INFO] — Wiring triad scope correctly narrowed by ADR D5: pillar (a) applies; pillar (b) deferred to T4.1 E2E (honest, ADR-grounded); pillar (c) n/a.

## Recommended action

- **proceed-to-halt-loop.** Plan v1.2 + edge-case absorption v1.1 + deps-audit v1.2 drift fix are aligned. Implementation contract is a faithful rendering of the plan's task list with no drift detected. EC-1 MUST FIX absorbed cleanly. The 4 SHOULD TEST items (EC-2 through EC-5) are correctly surfaced as runtime concerns and will be re-flagged by SEPA pre-RED on the relevant tasks. ADR D4 honesty discipline (process-dogfood NOT S1) triple-anchored. No CRITICAL/MAJOR risk requires halt before T0.1.
