# SEPA — Iteration 3 / Task T2.2 / Phase Post-GREEN

## Plan recap
- T2.2 wires `resolveAuthMode` as Tier-3 `THEMEMORY_API_KEY` heuristic via `resolveMcpModes` composer; `runMcpServer` consumes `{transport, auth}` pair.

## Findings
- INFO — clean.
- SOLID: resolveAuthMode 14 LoC, resolveMcpModes 5 LoC — both well under 20.
- SRP clean: precedence resolution / composition / orchestration cleanly separated.
- ADR-D2 invariant: `transport === 'streamable-http'` guard present (L127) before Tier-3 heuristic.
- DRY: resolveAuthMode mirrors resolveTransport precedence shape — INTENTIONAL symmetry per ADR-D2, not coupling.
- Banned-token grep: 0 hits.
- EC-2 verified: only resolveMcpModes exported; barrel index.ts zero hits; `@internal` JSDoc tag present.
- EC-1 trim discipline symmetric with resolveTransport.
- Test shape covers ADR-D2 explicit-opt-out invariant via T1.2 regression test.

## F3 followup (R4 opt-out env)
- DEFERRED — no THEMEMORY_MCP_NO_AUTO_AUTH env opt-out in T2.2 diff. Plan classifies R4 as SHOULD TEST (deferrable). Document in commit body footer.

## Recommended action
- PROCEED to COMMIT.
- Commit subject: `feat(mcp): resolveAuthMode Tier-3 api-keys heuristic + resolveMcpModes composer (T2.2)`
- PRIORITY 0 body cite + F3/R4 deferral footer + no Co-Authored-By trailer.
