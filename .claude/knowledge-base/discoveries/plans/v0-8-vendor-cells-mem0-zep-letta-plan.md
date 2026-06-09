# Discovery Plan: v0-8-vendor-cells-mem0-zep-letta — production VendorClient wirings for benchmark adapters

> **Version 1.1** (2026-06-07) — Absorbs `/discover-edge-cases v0-8-vendor-cells-mem0-zep-letta` (7 edge cases: 1 MUST FIX + 4 SHOULD TEST + 2 DOCUMENT — VERDICT DISCOVERY PLAN PRECISA DE AJUSTE). **1 MUST FIX absorbed**: EC-1 (Q5 method referenced `routers/v1/memory.py` which does NOT exist in Letta clone; Letta's memory APIs live at `routers/v1/archives.py` + `routers/v1/blocks.py` — verified hoje). **4 SHOULD TEST absorbed inline**: EC-2 Q3 mem0-ts package.json#exports disambiguation step added FIRST; EC-3 Q6 extended to cover `letta/.github/workflows/` (verified present); EC-4 Q2 cross-check Mem0's Python `zep_cloud` snapshot version vs current `@getzep/zep-cloud` npm; EC-5 npm view retry policy on rate-limit (3 tries → partial-blocked marker). **2 DOCUMENT absorbed**: EC-6 Q3 1.5h budget tight (acceptable trade-off — multi-package mem0-ts); EC-7 Zep tools-corner not independently verified (acceptable per ADR D3).

> **Version 1.0** (2026-06-07) — Investigates how to wire production `VendorClient` implementations for the 3 third-party benchmark adapters shipped via Drift-T6.x-1 of `v0-8-independent-benchmark-reproduction`. The `Mem0BenchmarkAdapter`, `ZepBenchmarkAdapter`, and `LettaBenchmarkAdapter` at `src/benchmarks/{mem0,zep,letta}/adapter.ts` already implement the `BenchmarkAdapter` DIP and accept a vendor-specific client via DI. What's missing: the concrete `Mem0VendorClient` / `ZepVendorClient` / `LettaVendorClient` classes that compose each vendor's official SDK. This discovery resolves the SDK-shape questions (npm package, auth, API method names, mock strategy) so a follow-up `/to-plan v0-9-vendor-client-impls` can ship the 3 classes with confidence. Closing this unblocks the second half of Roadmap Item 11 (production-ready label) — the `/dogfood` gate cleared on 2026-06-07; independent vendor benchmark cells are the parallel requirement.

**Slug:** `v0-8-vendor-cells-mem0-zep-letta`
**Owner:** project owner (`paulohenriquevn@gmail.com`)
**Created:** 2026-06-07
**Time budget:** 4.5h (per-project breakdown in ADR D1)

## Context

What motivates this discovery NOW:

1. **`/dogfood` gate cleared today** (commit `7000147`, 2026-06-07) — S1 `running`, EVIDENCE_SUFFICIENT verdict. The dogfood half of Roadmap Item 11 is unblocked. The OTHER half — independent benchmark reproduction (Roadmap Item 10) — remains BLOCKED because v0.8 shipped 2026-06-02 with TheMemory smoke-validation only; Mem0/Zep/Letta vendor cells were DEFERRED per Drift-T6.x-1.
2. **`src/benchmarks/{mem0,zep,letta}/adapter.ts` is HALF-built**: the `BenchmarkAdapter` DIP impl + `VendorClient` interface seam shipped; the `Mem0VendorClient` / `ZepVendorClient` / `LettaVendorClient` concrete classes wrapping the official SDKs do NOT exist. Adapter constructors throw at runtime if instantiated without an injected client.
3. **PRIORITY 0 sub-goal 2 (SDKs functional)** — the BenchmarkAdapter DIP is a public surface; consumer-facing Drift-T6.x-1 caveat in JSDoc + CLAUDE.md is the honest disclosure, but it's also a real gap that blocks `production-ready` claims per Inquebrável Rule 3.
4. **Project rules govern this discovery**:
   - `architecture.md § 3` — DIP boundary: VendorClient impls live in `src/benchmarks/{vendor}/` per ADR D5, do NOT import from `src/local/` or `src/cloud/`.
   - `architecture.md § 9` (Não Reinvente a Roda — Inquebrável Rule 9) — use official vendor SDKs (mem0ai, @getzep/zep-cloud, @letta-ai/letta-client) instead of hand-rolling HTTP clients.
   - `testing.md § Pyramid` — unit tests mock the SDK; integration tests against real SaaS gated by env vars (paid API keys).

### Evidence (verified prior turn)

- `src/benchmarks/mem0/adapter.ts:30-36` declares `Mem0VendorClient { add, search, synthesize }` interface.
- `src/benchmarks/zep/adapter.ts:24-30` declares `ZepVendorClient { add, search, synthesize }` interface (same shape; sessionId vs userId is the per-vendor scope).
- `src/benchmarks/letta/adapter.ts` declares `LettaVendorClient` (similar shape — to be verified during execute).
- `.claude/knowledge-base/references/mem0/evaluation/src/zep/{add.py, search.py}` — Mem0's OWN canonical benchmark adapter for Zep (Python; uses `zep_cloud` SDK). Pattern translates directly to TS via `@getzep/zep-cloud`.
- `.claude/knowledge-base/references/mem0/mem0-ts/` — Mem0's TypeScript SDK (the one we'd wire for `Mem0VendorClient`).
- `.claude/knowledge-base/references/letta/` — Letta's full Python codebase (no TS client SDK in this clone; Letta ships `letta-client` Python package referenced in `tests/test_sdk_client.py`).
- **Zep is NOT cloned in `.claude/knowledge-base/references/`** — research relies on Mem0's eval adapter as canonical pattern + npm registry inspection for `@getzep/zep-cloud` TS API surface.

## Objective

Produce a blueprint that lets `/to-plan v0-9-vendor-client-impls` ship 3 concrete `VendorClient` classes (`Mem0OfficialClient`, `ZepOfficialClient`, `LettaOfficialClient`) without ambiguity about npm package name, import path, auth flow, method-name mapping to our `VendorClient` interface, or mock strategy for unit tests.

Measurable success criteria:

- [ ] All 6 research questions in this plan answered with citations to `.claude/knowledge-base/references/` OR `npm view` output (allowlisted for vendor-package metadata).
- [ ] Cross-cutting comparison table populated covering: npm package, auth env var, add-method signature, search-method signature, mock-strategy recommendation, paid-credentials requirement.
- [ ] Recommendations section provides at least one concrete decision proposal per question (e.g., "use `mem0ai@^2.x` not `@mem0/sdk`"; "Letta has no TS SDK — wrap REST via fetch + zod schemas").
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS (target SHIPPABLE — soft caps acceptable per Drift-T6.x-1 lineage).

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `.claude/knowledge-base/references/mem0/` | `mem0-ts/src/`, `mem0-ts/tests/`, `mem0-ts/package.json`, `evaluation/src/zep/`, `evaluation/src/memzero/` | mem0-ts is the official TS SDK we'd consume for `Mem0OfficialClient`. `evaluation/src/zep/` is the canonical pattern Mem0 uses to benchmark Zep — directly applicable to our `ZepOfficialClient`. |
| `.claude/knowledge-base/references/letta/` | `letta/server/rest_api/`, `tests/test_sdk_client.py`, `tests/integration_test_summarizer.py` | letta's REST API shape defines what we'd wrap if no TS client SDK exists. SDK client tests show the canonical Python usage we'd mirror in TS. |
| **npm registry (allowlisted via `npm view`)** | `mem0ai`, `@getzep/zep-cloud`, `@letta-ai/letta-client` package manifests | Zep is NOT cloned locally; registry query is the next-best canonical source. The discover-execute halt-loop will use `npm view <pkg> versions/dependencies/repository` (read-only metadata, not install). |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| `.claude/knowledge-base/references/mem0/docs/` | Marketing docs, not source of truth |
| `.claude/knowledge-base/references/mem0/evaluation/src/openai/`, `evaluation/src/rag/` | Not vendors we're benchmarking against |
| `.claude/knowledge-base/references/letta/letta/server/agent.py` and AGENT-WIRING code | Letta's agent loop is out of scope; we only consume their MEMORY API surface |
| Actual VendorClient implementation code | That's `/to-plan` after this discovery; discovery answers HOW, doesn't WRITE the impls |
| Paid vendor SaaS calls during discovery | No API keys consumed during discovery phase; we only inspect SDK shapes |
| Performance benchmarking, latency comparison | Already done for TheMemory in v0.8; vendor cells get the same harness once impls land |

## ADRs

### D1 — Time budget + per-question stop conditions

- **Decision:** Total 4.5h budget: Mem0=2.5h (4 questions intersect Mem0), Zep=1h (relies on Mem0's eval pattern + npm registry), Letta=1h (lightest — likely REST-only wrap).
- **Per-question stop condition:** if a single question consumes > 1.5h with no progress, halt that question and mark BLOCKED in the blueprint. Move to next question. The blueprint will surface the BLOCKED items honestly per Inquebrável Rule 3 — partial answers > false confidence.
- **Rationale:** Mem0 has the most material (cloned TS SDK + cloned Python eval adapters for Zep), so it gets the lion's share. Zep + Letta are "thin" — Zep relies on Mem0's pattern + npm metadata; Letta likely has no TS SDK at all (REST wrap).
- **EC-6 DOCUMENT (v1.1)**: Q3 (mem0-ts API surface) has ELEVATED risk of hitting the 1.5h budget because mem0-ts has 3-package layout (oss + client + community per the verified `src/{oss,client,community}/package.json`). The disambiguation step added by EC-2 absorption (read `package.json#exports` first) mitigates by avoiding wasted reads of the wrong sub-package. Acceptable trade-off: partial answer about the canonical entry (e.g., `oss/`) is more valuable than 0 answer; halt-loop should not stall the entire blueprint on Q3 alone.

### D2 — Read-only treatment of `.claude/knowledge-base/references/`

- **Decision:** NEVER `cd` into the references directory; NEVER run `npm install`, `pip install`, `pnpm install` against the clones; NEVER edit any file there.
- **Rationale:** Enforced by `.claude/hooks/boundary-check.sh`. The clones are read-only reference material; mutating them would corrupt the audit trail and the next `/discover-execute` would see drifted state. Use `Read`, `Glob`, `Grep`, `find`, `git log --no-pager` from outside the directory.

### D3 — `npm view <pkg>` is allowlisted as a research method

- **Decision:** The `/discover-execute` halt-loop MAY invoke `npm view <pkg> versions/dependencies/repository.url/main/types` to inspect vendor package metadata when local clones are absent. NEVER `npm install <pkg>` during discovery — only metadata queries.
- **Rationale:** Inquebrável Rule 9 (Não Reinvente a Roda) requires us to use canonical SDK shapes; without local clones for Zep, the npm registry is the next-best source. `npm view` is a read-only metadata query (no installation, no node_modules touch); the discovery boundary stays clean. Documented as an allowlist exception in the deps-audit chain for this plan only.
- **EC-7 DOCUMENT (v1.1)**: Zep's CI/dev tooling pattern (Q6 Tools corner) is NOT independently verified by this discovery — only Mem0 + Letta CI workflows are read (both cloned). Zep CI assumption is "convergence with Mem0/Letta vendor SaaS gating pattern" (cron + workflow_dispatch + secrets-injected `ZEP_API_KEY`). Acceptable risk because: (a) all 3 vendors face the same paid-API-quota problem with the same canonical solution (gate behind env var + nightly cron), (b) verifying Zep CI would require cloning Zep (out of scope), (c) the follow-up `/to-plan v0-9-vendor-client-impls` will mirror Mem0/Letta pattern for Zep — if the actual Zep CI is materially different, surface during real Zep integration testing.

### D4 — Letta likely has no TS SDK; REST-wrap strategy noted upfront

- **Decision:** If Q5 confirms Letta has no published TS client SDK on npm, the recommendation will be a thin `fetch`-based REST client wrapping Letta's API surface (verifiable from `references/letta/letta/server/rest_api/`).
- **Rationale:** Letta is Python-first (the `letta_client` package on PyPI is Python-only). Per Inquebrável Rule 9, we still don't reinvent the protocol — we wrap Letta's documented REST endpoints with zod schemas for type-safety. The wrap is ≤ 200 LoC by estimation; if Q5 surprises us with an existing TS SDK, the recommendation flips.

## Dependency Graph

```
Q1 (Dependencies) ──┬──▶ Q2 (Techniques — Mem0's Zep adapter pattern)
                    │
                    ├──▶ Q3 (Techniques — mem0-ts API surface)
                    │
                    ├──▶ Q4 (Integration tests — mem0-ts test scaffolding)
                    │
                    ├──▶ Q5 (Letta SDK existence + REST shape)
                    │
                    └──▶ Q6 (Tools — CI / dev gating for paid vendor APIs)
```

Q1 establishes the package landscape (3 npm packages or 2 + REST-wrap); subsequent questions deepen each axis. No question depends on another's answer to START, but Q1's output frames the analysis paths.

---

## Research Questions

### Q1 — Package landscape: npm name + auth pattern for each of (Mem0, Zep, Letta)

- **Corner:** Dependencies
- **Project:** Mem0 (local clone) + Zep + Letta (npm registry)
- **Why this question NOW:** the `package.json` of any `/to-plan v0-9-vendor-client-impls` needs to declare the right packages. Plan v0.8 cited generic names; we need the actual `name@version-range` for each.
- **Planned method:**
  1. `Read .claude/knowledge-base/references/mem0/mem0-ts/package.json` → get the SDK's own name + version
  2. `npm view mem0ai version dependencies repository.url main types`
  3. `npm view @getzep/zep-cloud version dependencies repository.url main types`
  4. `npm view @letta-ai/letta-client version 2>&1 | head` (might 404 if no TS package)
  5. Cross-reference each `repository.url` with the canonical vendor docs (URLs documented in answer)
  6. **EC-5 absorption** — npm view rate-limit retry policy: each `npm view` call has 3-attempt backoff (1s, 3s, 9s). On 3 consecutive failures (non-200 or stderr non-empty), mark this Q1 sub-step as `partial-blocked` in `.progress-{slug}.json` with attempt log; do NOT halt the entire loop. Blueprint surfaces honestly which packages weren't verifiable via registry today.
- **Expected answer shape:** a 3-row table:
  | Vendor | npm package | Latest version | Auth env var | Repository |
  |---|---|---|---|---|
  | Mem0 | `mem0ai` | ... | `MEM0_API_KEY` | github.com/mem0ai/mem0-ts |
  | Zep | `@getzep/zep-cloud` | ... | `ZEP_API_KEY` | ... |
  | Letta | `@letta-ai/letta-client` OR absent | ... | `LETTA_API_KEY` | ... |

### Q2 — Mem0's canonical Zep benchmark adapter shape (techniques pattern transfer)

- **Corner:** Techniques
- **Project:** Mem0 (`evaluation/src/zep/`)
- **Why this question NOW:** Mem0 already solved the exact problem we're solving (benchmark adapter for a competitor vendor) for ZEP specifically. Their `evaluation/src/zep/add.py` + `search.py` show: client init, scope binding (userId + sessionId), batched corpus loading, search response parsing. Pattern-matching this saves us hours.
- **Planned method:**
  1. `Read .claude/knowledge-base/references/mem0/evaluation/src/zep/add.py` (entire file)
  2. `Read .claude/knowledge-base/references/mem0/evaluation/src/zep/search.py` (entire file)
  3. `Grep "zep_client\\." .claude/knowledge-base/references/mem0/evaluation/src/zep/` to enumerate every Zep SDK call site
  4. **EC-4 absorption** — version drift cross-check: `find .claude/knowledge-base/references/mem0/evaluation -maxdepth 3 -name "requirements*.txt" -o -name "pyproject.toml"` to capture the `zep_cloud` Python version Mem0 pinned. Cross-reference with `npm view @getzep/zep-cloud version` from Q1. If major versions differ (e.g., Python `zep_cloud@1.x` vs TS `@getzep/zep-cloud@3.x`), document in blueprint § Recommendations as "API drift risk — manual TS surface validation needed before wiring".
- **Expected answer shape:** a Python→TS translation table:
  | Mem0 Python call | TS equivalent (`@getzep/zep-cloud`) | Maps to our `ZepVendorClient` method |
  |---|---|---|
  | `Zep(api_key=...)` | `new ZepClient({ apiKey: ... })` | constructor |
  | `zep_client.user.add(user_id=X)` | `client.user.add({ userId: X })` | n/a (lifecycle, not exposed via VendorClient) |
  | `zep_client.memory.add(session_id=X, messages=[...])` | `client.memory.add(sessionId, { messages })` | `add(sessionId, text)` |
  | `zep_client.memory.search_sessions(...)` | `client.memory.searchSessions({...})` | `search(sessionId, query, topK)` |

### Q3 — mem0-ts API surface: what's the TS shape that satisfies our `Mem0VendorClient`?

- **Corner:** Techniques
- **Project:** Mem0 (`mem0-ts/src/`)
- **Why this question NOW:** the `Mem0VendorClient` interface declares `add(userId, text)` + `search(userId, query, topK)` + `synthesize(question, context)`. We need to confirm the mem0-ts SDK exposes equivalents (likely `memory.add()` + `memory.search()` + something for synthesis).
- **Planned method:**
  1. **EC-2 absorption (v1.1) — FIRST step**: `Read .claude/knowledge-base/references/mem0/mem0-ts/package.json` to enumerate `#exports` entry points. mem0-ts has multi-package layout (verified hoje: `src/oss/`, `src/client/`, `src/community/` — 3 sub-packages each with own `package.json`). Identify which sub-package is the canonical TS SDK consumers use for Mem0 OSS (probably `oss/` based on naming convention; verify via the root package.json `main`/`types`/`exports` fields BEFORE diving deeper).
  2. `Read .claude/knowledge-base/references/mem0/mem0-ts/src/oss/index.ts` (OR the canonical entry from step 1 if different — common alternatives: `src/oss/src/index.ts` per the verified `mem0-ts/src/oss/src/` subdirectory)
  3. `Grep -rn "memory\\.add\\|memory\\.search" .claude/knowledge-base/references/mem0/mem0-ts/src/` to find method declarations
  4. `Read` the file(s) where `add` and `search` are defined to confirm method signatures
  5. `Grep -rn "synth\\|complet" .claude/knowledge-base/references/mem0/mem0-ts/src/` — confirm if Mem0 ships a built-in `synthesize` OR if we call its `.complete()` / chat method directly
- **Expected answer shape:** a TS snippet showing how `Mem0OfficialClient implements Mem0VendorClient` composes the SDK, with the canonical SDK call for each of the 3 methods.

### Q4 — Integration test pattern: how does mem0-ts itself test against real Mem0?

- **Corner:** Integration tests
- **Project:** Mem0 (`mem0-ts/tests/`)
- **Why this question NOW:** our test pyramid (`testing.md`) requires integration tests against real boundaries. For paid vendor SaaS, the canonical pattern is "gated by env var; skip cleanly when absent". mem0-ts should demonstrate this. We need to mirror it for our `Mem0OfficialClient` tests so CI doesn't burn API quota on every commit.
- **Planned method:**
  1. `Read .claude/knowledge-base/references/mem0/mem0-ts/jest.integration.config.js` (already enumerated in `ls`) — confirm the env-gate
  2. `Read .claude/knowledge-base/references/mem0/mem0-ts/jest.setup.ts` — global setup including env validation
  3. `Grep -rn "MEM0_API_KEY\\|describe\\.skip\\|skipIf" .claude/knowledge-base/references/mem0/mem0-ts/tests/` — find the skip-without-key pattern
  4. `find .claude/knowledge-base/references/mem0/mem0-ts/tests/ -name "*.integration.*"` — list integration test files
- **Expected answer shape:** a `describe.skipIf(!process.env.MEM0_API_KEY)` (or equivalent jest skip-conditional) snippet + a "what mocks for unit tests" recommendation.

### Q5 — Letta TS client SDK: does it exist? If not, what's the REST shape?

- **Corner:** Dependencies + Techniques (split-spanning question per Step 3 budget rule justification: this is ONE existence question with a fallback contingency, not two independent questions)
- **Project:** Letta (`letta/server/rest_api/` if no TS SDK)
- **Why this question NOW:** if `@letta-ai/letta-client` exists on npm, we wire it (same pattern as Q3 for Mem0). If it doesn't, we need to write a `fetch`-based REST wrapper, which requires knowing Letta's API endpoints, auth, request/response shapes. Q1's `npm view @letta-ai/letta-client` already gives the first answer; this question deepens it.
- **Planned method:**
  1. If Q1 found a TS package: `npm view @letta-ai/letta-client repository.url main types` then follow to repo if cloned, OR document the SDK shape from `npm view <pkg> --json | jq` metadata
  2. If Q1 found NO TS package: **EC-1 absorption (v1.1 fix)** — Letta has NO `memory.py` router. Letta's memory APIs live at: `Read .claude/knowledge-base/references/letta/letta/server/rest_api/routers/v1/archives.py` (archival memory — long-term semantic store) + `Read .claude/knowledge-base/references/letta/letta/server/rest_api/routers/v1/blocks.py` (block memory — agent's working-memory chunks) + cross-reference relevant `agents.py` endpoints that mutate memory. Enumerate the memory-touching endpoints from these 3 files; ignore agent-loop / tool-execution routers.
  3. `Read .claude/knowledge-base/references/letta/tests/test_sdk_client.py` for the canonical Python usage pattern; translate the memory-touching methods to REST calls.
  4. **EC-6/scope-creep guard:** stop criterion — ONLY memory-touching endpoints (archives + blocks + agent memory mutations). Do NOT enumerate Letta's full REST surface (agent execution, tool calls, run streaming) — out of scope for `LettaVendorClient`.
- **Expected answer shape:** EITHER (a) a TS snippet using `@letta-ai/letta-client` (if exists), OR (b) a REST endpoint table covering only memory-touching routes (`POST /v1/archives/{id}/passages`, `GET /v1/archives/{id}/search`, `POST/PATCH /v1/blocks/{id}`, agent memory mutation endpoints) with request/response zod schemas sketched.

### Q6 — CI/dev gating for vendor SaaS — how does Mem0's CI prevent burning paid API quota?

- **Corner:** Tools
- **Project:** Mem0 (`mem0-ts/` + repo CI config)
- **Why this question NOW:** if our integration tests against real Mem0/Zep/Letta SaaS run on every PR, we'll burn $$ on API quota for each push. The canonical pattern is "integration tests run nightly on a dedicated CI job with secrets injected; unit tests with mocks run on every PR". We need confirmation Mem0 follows this and how.
- **Planned method:**
  1. `find .claude/knowledge-base/references/mem0 -name "*.yml" -path "*workflows*"` — list Mem0 GitHub Actions workflows
  2. **EC-3 absorption (v1.1)** — extend to Letta: `find .claude/knowledge-base/references/letta -name "*.yml" -path "*workflows*"` (verified hoje: Letta has `core-integration-tests.yml`, `alembic-validation.yml`, etc.). Dual-source comparison makes Tools corner genuine instead of Mem0-only.
  3. `Read` the integration workflow file from Mem0 (likely `.github/workflows/integration.yml` or similar) AND from Letta (`core-integration-tests.yml` likely candidate).
  4. `Grep "schedule\\|MEM0_API_KEY\\|LETTA_API_KEY\\|workflow_dispatch" .claude/knowledge-base/references/{mem0,letta}/.github/workflows/` — find the gating pattern (cron schedule vs PR trigger; secrets dispatch pattern). Cross-compare Mem0 vs Letta.
- **Expected answer shape:** a comparison table covering Mem0 + Letta CI gating: `{ vendor, workflow file, trigger (cron/manual/push/PR), secrets used, mock-or-real split, runtime }`. Zep not independently verified per ADR D3 + EC-7 DOCUMENT — recommendation cell for Zep cites "assume convergence with Mem0/Letta pattern".

---

## Coverage Matrix

| Question | Corner | Reference project (in-scope path) | Method | Status |
|---|---|---|---|---|
| Q1 | Dependencies | mem0/mem0-ts/package.json + npm view (3 packages) | Read + Bash `npm view` | planned |
| Q2 | Techniques | mem0/evaluation/src/zep/{add.py, search.py} | Read + Grep | planned |
| Q3 | Techniques | mem0/mem0-ts/src/oss/index.ts + grep memory.add | Read + Grep | planned |
| Q4 | Integration tests | mem0/mem0-ts/jest.integration.config.js + tests/ | Read + Grep | planned |
| Q5 | Dependencies + Techniques | npm view @letta-ai/letta-client FALLBACK letta/letta/server/rest_api/ | Bash + Read | planned |
| Q6 | Tools | mem0/.github/workflows/ | find + Read + Grep | planned |

**Coverage corners status:**

| Corner | Question count (target 1-3) | Status |
|---|---|---|
| Dependencies | Q1 + Q5(partial) = 1.5 questions | ✓ within budget |
| Techniques | Q2, Q3, Q5(partial) = 2.5 questions | ✓ within budget |
| Integration tests | Q4 = 1 question | ✓ minimum met |
| Tools | Q6 = 1 question | ✓ minimum met |

**Total: 6 questions** (within budget 5-10). All 4 corners covered with ≥ 1 question each. Zero ADR-deferred corners.

## Halt-loop Checkpoints

For `/discover-execute`, the loop SHALL emit `<promise>BLUEPRINT_COMPLETE</promise>` only when ALL of:

1. Every Q1-Q6 has a non-empty `### Answer` section in the blueprint with at least one citation to `.claude/knowledge-base/references/` OR a recorded `npm view <pkg>` output (commit the output as a file under `.claude/knowledge-base/discoveries/raw/{slug}-npm-view-{pkg}.txt` for auditability).
2. The Cross-cutting comparison table is fully populated (no `TBD` cells in vendor rows for Mem0 + Zep + Letta).
3. The Recommendations section has at least one concrete proposal per question (≥ 6 recommendations total).
4. The Q5 contingency branch is resolved — either confirmed `@letta-ai/letta-client` exists with TS support OR documented as "REST-wrap recommended; sketch in answer".

Per-iteration checkpoint: each iteration of the loop SHOULD attack 1-2 questions max and persist intermediate findings to the blueprint before iterating. The loop NEVER emits the promise without all 4 conditions verified by re-reading the blueprint file.

## Acceptance Criteria

- [ ] All 6 research questions answered with `.claude/knowledge-base/references/` citations OR allowlisted `npm view` outputs (per ADR D3)
- [ ] Cross-cutting comparison table populated for Mem0 + Zep + Letta rows
- [ ] Recommendations section provides ≥ 1 concrete decision proposal per question
- [ ] All ADRs (D1, D2, D3, D4) are referenced in the blueprint's decision rationale
- [ ] Time budget respected: 4.5h total across the 3 vendor sections (escalate to human if exceeded)
- [ ] Zero fabricated citations (every cited path opens; every cited symbol grep-able)

## Global Definition of Done

- [ ] All Acceptance Criteria items checked
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS (target SHIPPABLE; soft caps acceptable per Drift-T6.x-1 lineage)
- [ ] Blueprint saved to `.claude/knowledge-base/discoveries/blueprints/v0-8-vendor-cells-mem0-zep-letta-blueprint.md`
- [ ] Per-iteration progress persisted to `.claude/knowledge-base/discoveries/.progress-v0-8-vendor-cells-mem0-zep-letta.json`
- [ ] No `.claude/knowledge-base/references/` mutation occurred (boundary-check.sh would have refused; absent any hook-block log = invariant held)
- [ ] CHANGELOG.md `[Unreleased]` entry added under `### Added` documenting the discovery completion

## Related

- Upstream blueprint: `.claude/knowledge-base/discoveries/blueprints/v0-8-benchmark-methodology-blueprint.md` (the v0.8 methodology that motivated `BenchmarkAdapter` DIP)
- Upstream plan (completed): `.claude/knowledge-base/plans/completed/v0-8-independent-benchmark-reproduction-plan.md` — Drift-T6.x-1 origin
- Upstream plan (completed): `.claude/knowledge-base/plans/v0-8-fixes-cycle-1-plan.md` — fixes-cycle that locked the VendorClient seam
- Downstream consumer (planned, not yet written): `/to-plan v0-9-vendor-client-impls` — produces the 3 concrete `VendorClient` impl classes from THIS blueprint
- Project rules consumed: `architecture.md § 3` (DIP), `architecture.md § 9` (Não Reinvente Rule 9), `testing.md § Pyramid`
- Golden rule: `discover-blueprint-golden-rule.md` (gates the produced blueprint)
- Dogfood context: `.claude/knowledge-base/dogfood/evidence/2026-06-07-anchor-claude-code-post-pr32-relaunch.md` — established that S1 dogfood-side cleared; THIS discovery is the parallel-half unblock of Roadmap Item 11
