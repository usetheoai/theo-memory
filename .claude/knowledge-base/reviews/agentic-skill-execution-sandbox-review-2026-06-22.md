# Review: agentic-skill-execution-sandbox (M1)

**Date:** 2026-06-22
**Reviewers (spawned agents):** 7 — architecture, tests, wiring, cross-validation, domain-security, domain-memory-layer, domain-concurrency
**Findings:** BLOCKER 0 · HIGH 2 · MEDIUM 3 · LOW 8 · INFO many
**Verdict:** READY_TO_MERGE (2 HIGH + 3 MEDIUM + LOW security items fixed inline `18cd4d3`; re-gated all green; see § Fix log)

> **Aggregator note (meta-defect):** `consolidate_findings.py` parsed only 1 of 7 finding files (reported `agents_count:1`, 4 findings) — the known silent-drop bug the judge-codex `:final` stage exists to catch. This report is hand-consolidated from all 7 agents' actual outputs (each `findings/*.yaml` persisted in the run dir). Do NOT trust the script's `READY_TO_MERGE` — it saw only tests.yaml.

## BLOCKER findings
None. The mandatory RCE-surface security review found NO host-escape: fresh isolated-vm isolate has zero Node bindings; classic-script compile (no ESM import resolution); v1 injects zero host callbacks; args structured (no source-concat); dispose guaranteed; existence-leak-safe (404 uniform); opt-in default-off; prototype-pollution contained in the disposable isolate.

## HIGH findings (fixed inline — see Fix log)

### F-dom-conc-1 — synchronous `runSync` blocks the Node event loop on a server surface
- Found by: domain-concurrency. File: `sandboxed-skill-executor.ts` (runSync path).
- `runSync(ctx,{timeout})` runs untrusted skill code synchronously on the main Node thread; a skill spinning for its full timeout window stalls every concurrent request. Wired into a REST endpoint + MCP tool → cross-request/cross-tenant availability hazard. DEC-1's "no async benefit" weighed only throughput, not event-loop responsiveness.
- Action: switch to the async isolated-vm API (`createContext`/`compileScript`/`script.run`) which executes off the main thread.

### F-dom-conc-2 — `timeoutMs` has no upper bound (amplifies F-dom-conc-1)
- Found by: domain-concurrency + domain-security (F-sec-3). Executor rejects only `<= 0`; zod `.positive()` with no `.max()`.
- A client can request `timeoutMs: 600000` → 10-min client-controlled stall.
- Action: MAX clamp in the executor + `.max()` in REST + MCP zod (mirror `MIN_MEMORY_LIMIT_MB`); same for `memoryLimitMb` (F-sec-2).

## MEDIUM findings (addressed)

### F-arch-1 / F-arch-2 / F-tests-1 — `tool-call-cap` / `maxToolCalls` declared-but-unimplemented (dead public surface)
- Found by: architecture (2×) + tests. The reason literal + option are in the errors union, the port, and BOTH zod schemas, with ZERO implementation/test. DEC-7 promised a private cap helper + test; neither exists. Public option that silently no-ops (Rule 3 honesty gap). (cross-validation rated LOW "reserved seam"; architecture+tests MEDIUM.)
- Action (YAGNI+honesty): REMOVE `maxToolCalls` from `SkillExecutionOptions` + both zod schemas + `tool-call-cap` from the reason union + errors.test reason list. The Q3 host-callback-bridge follow-up re-introduces them WITH backing code.

### F-sec-1 — output cap enforced AFTER the value is copied into host memory
- Found by: domain-security. With a large `memoryLimitMb` the transient host alloc is unbounded by `maxOutputBytes`.
- Action: mitigated by the new `memoryLimitMb` MAX clamp (isolate cannot produce a result larger than its capped heap). Accepted-documented for opt-in v1; a pre-copy in-isolate size check is a follow-up.

## LOW findings
- F-sec-4: `IDENTIFIER_RE` admits `__proto__`/`constructor`/`prototype` arg keys (isolate-contained) → denylist. **Fixed.**
- F-sec-2 / F-sec-3: no MAX on memoryLimitMb / timeoutMs → **Fixed** (clamps).
- F-tests-2: cross-workspace isolation deferred to integration but not asserted there → cross-workspace assertion added to GOAL test (real pg persists workspace_id). **Fixed.**
- F-arch-3: `EXECUTE_SKILL_NAME` vs local `TOOL_NAME` (sibling tools consistent). Accepted.
- F-arch-4: import-order in list-handler.ts (mcp outside root lint). Accepted.
- F-tests-3: `mkSkill` fixture `as Skill` omits derivedFrom (behavior unaffected). Accepted.
- F-wire-1: `ExecuteSkillInput` export no consumers (parity with `AddSkillInput`). Accepted.

## INFO (positives)
DIP/Strategy/lazy-load seam exemplary; façade SRP + gated wiring; GOAL satisfied+exceeded; wiring triad 8/8 (a) 8/8 (b) 2/2 (c); all 9 tasks traceable + DEC/EC absorbed; memory-layer invariants all PASS; dispose lifecycle correct + no leak.

## Cross-validation summary
Plan tasks 9 · fully implemented 9 · diverged 1 (DEC-7 tool-call-cap — resolved by removing the no-op surface) · factory-locus pointer stale (wiring correct).

## Quality gates summary (pre-fix)
Contract 1063/0 · API 205/0 · GOAL 7/7 · typecheck 0 · lint clean · /code-quality PASS 100 · /deps-audit PASS.

## Spawned agents (audit trail)
`.claude/agents/review-agentic-skill-execution-sandbox-2026-06-22/{architecture,tests,wiring,cross-validation,domain-security,domain-memory-layer,domain-concurrency}.md` + `findings/*.yaml`.

## Handoff decision
NEEDS_FIXES → fix the 2 HIGH + tool-call-cap MEDIUM + LOW security items inline, re-run gates, then READY_TO_MERGE.

---

## Fix log (2026-06-22) — commit `18cd4d3`

| Finding | Severity | Fix |
|---|---|---|
| F-dom-conc-1 | HIGH | Sync isolated-vm API → **async** (`createContext`/`compileScript`/`run`) — untrusted exec runs OFF the main thread; no event-loop block on REST/MCP. Supersedes DEC-1. |
| F-dom-conc-2 / F-sec-3 | HIGH/LOW | `timeoutMs` MAX clamp 30s (executor) + `.max(30_000)` (REST/MCP/OpenAPI zod). |
| F-sec-2 | LOW | `memoryLimitMb` MAX clamp 256 (executor) + `.max(256)` zod. |
| F-arch-1 / F-arch-2 / F-tests-1 | MEDIUM | **Removed** dead `maxToolCalls` option + `tool-call-cap` reason literal (port, both zod, OpenAPI, reason union 10→9, errors.test, test-d). Host-bridge follow-up re-adds with backing code. |
| F-sec-1 | MEDIUM | Output-cap-after-copy bounded by the new `memoryLimitMb` MAX clamp (isolate cannot produce a result larger than its capped heap). Documented; pre-copy in-isolate check is a follow-up. |
| F-sec-4 | LOW | Arg-key denylist for `__proto__`/`constructor`/`prototype`. |
| F-tests-2 | LOW | Cross-workspace isolation asserted in the GOAL test vs real pgvector (now 8/8). |
| F-arch-3/4, F-tests-3, F-wire-1 | LOW | Accepted (cosmetic / convention parity / behavior-unaffected). |

### Re-gate (post-fix, all green)
- Contract suite (core+mcp): **1063 passed / 0 failed** · API: **26/26** (skills) · GOAL integration: **8/8** (real pg + real isolated-vm, async API + cross-ws) · typecheck **0** · lint clean · **/code-quality PASS 100** (re-run post-fix).

### Follow-ups (post-merge backlog)
- Pre-copy in-isolate output size check (F-sec-1 hardening).
- `themory-inmemory-skill-workspace-parity` (in-memory adapter persists workspace_id).
- Direct by-id skill read if a repo's skill count grows large (F-dom-mem-1).
- Optional `Promise.all` parallel-execute isolation test (F-dom-conc-4).

### Meta
- `consolidate_findings.py` silently dropped 6/7 finding files (parsed only tests.yaml) — aggregator bug; report hand-consolidated. Recommend a follow-up fix to the aggregator (or run judge-codex `:final` as the cross-check).

**Final verdict: READY_TO_MERGE.** 0 BLOCKER, 0 unresolved HIGH, 0 unresolved MEDIUM. The mandatory RCE-surface security review found no host escape; the 2 HIGH availability hazards + the dead-surface MEDIUM are fixed and re-gated.
