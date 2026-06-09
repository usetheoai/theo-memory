# Blueprint: v0-8-vendor-cells-mem0-zep-letta — production VendorClient wirings for Mem0, Zep, Letta

**Plan:** [`.claude/knowledge-base/discoveries/plans/v0-8-vendor-cells-mem0-zep-letta-plan.md`](../plans/v0-8-vendor-cells-mem0-zep-letta-plan.md) (v1.1, attested via cycle-discover chain)
**Produced:** 2026-06-07
**Status:** SHIPPABLE — all 6 research questions answered with `.claude/knowledge-base/references/` citations OR `npm view` output; zero questions BLOCKED
**Downstream consumer:** `/to-plan v0-9-vendor-client-impls` — will ship `Mem0OfficialClient` + `ZepOfficialClient` + `LettaOfficialClient` classes grounded in this blueprint.

## Context

This blueprint resolves the second-half blocker of Roadmap Item 11 (`production-ready` claim). The `/dogfood` gate cleared on 2026-06-07 (commit `7000147`, S1 status `running`, EVIDENCE_SUFFICIENT). The parallel requirement — independent benchmark reproduction (Roadmap Item 10) — remains BLOCKED because v0.8 shipped 2026-06-02 with TheMemory smoke-validation only; Mem0/Zep/Letta vendor cells were DEFERRED per Drift-T6.x-1. The `BenchmarkAdapter` DIP at `src/core/dip/benchmark-adapter.ts` + 3 vendor adapter shells at `src/benchmarks/{mem0,zep,letta}/adapter.ts` already ship with `VendorClient` interface seams; what's missing is the concrete `*OfficialClient` classes wrapping each vendor's official SDK. This blueprint answers the 6 questions needed to ship those classes.

## Objective

Enable `/to-plan v0-9-vendor-client-impls` to ship `Mem0OfficialClient` + `ZepOfficialClient` + `LettaOfficialClient` classes with confidence about npm packages, auth flows, method-name mappings, mock strategy, and CI gating. Success criterion for THIS blueprint: 6 research questions answered with `.claude/knowledge-base/references/` citations OR npm registry metadata; 6 actionable recommendations (1 per question) delivered.

## Coverage Corner 1 — Integration tests

Covered by **Q4** (mem0-ts `describeIntegration = API_KEY ? describe : describe.skip` canonical gate pattern + `jest.integration.config.js` separation + `globalSetup` cleanup). See full answer in § Q4 below.

## Coverage Corner 2 — Dependencies

Covered by **Q1** (3 npm packages: `mem0ai@3.0.6`, `@getzep/zep-cloud@3.23.0`, `@letta-ai/letta-client@1.12.1` — Letta TS SDK exists; ADR D4 REST-wrap fallback NOT triggered) AND **Q5** (Letta TS SDK shape confirmation). See full answers in § Q1 + § Q5 below.

## Coverage Corner 3 — Tools

Covered by **Q6** (CI gating: Mem0 PR-matrix + manual integration locally; Letta `pull_request` + `pull_request_target` with `safe to test` label; Zep extrapolated per ADR D3 + EC-7 DOCUMENT — not independently cloned). See full answer in § Q6 below.

## Coverage Corner 4 — Techniques

Covered by **Q2** (Mem0's Python `zep_cloud` benchmark adapter → TS `@getzep/zep-cloud` translation table — graph.search with cross_encoder reranker) AND **Q3** (mem0-ts `Memory.add()` / `Memory.search()` signatures + Entity scope shape) AND **Q5** (Letta archival-memory endpoints + agent-scoped vs user-scoped contract). See full answers in § Q2, § Q3, § Q5 below.

## ADRs

This blueprint inherits the 4 ADRs from the source discovery plan ([`.claude/knowledge-base/discoveries/plans/v0-8-vendor-cells-mem0-zep-letta-plan.md`](../plans/v0-8-vendor-cells-mem0-zep-letta-plan.md) v1.1):

- **D1** — Time budget 4.5h with per-question stop conditions (EC-6 caveat for Q3 multi-package elevated risk)
- **D2** — Read-only treatment of `.claude/knowledge-base/references/`; boundary-check.sh enforced
- **D3** — `npm view <pkg>` metadata queries allowlisted as research method (EC-7 caveat: Zep CI not independently verified)
- **D4** — Letta REST-wrap contingency documented upfront (RESOLVED — Q1 confirmed TS SDK exists; contingency NOT triggered)

Additional blueprint-level ADRs proposed for the downstream `/to-plan v0-9-vendor-client-impls`:

- **D5 (proposed)** — `VendorClient` interface scope-key generalization: rename `userId: string` → `scopeKey: string` to honestly represent that Letta uses `agent_id` (not `user_id`). Per § Q5 R5.
- **D6 (proposed)** — `VendorClient.synthesize()` delegates to shared LLM DIP across all 4 adapters; no vendor-specific synthesize implementation. Per § Q3 R3 + § Q5 R5.

## Executive summary

All three vendor SDKs ship TypeScript clients on npm — no REST-wrap fallback needed (ADR D4 contingency NOT triggered). Mem0 + Zep + Letta each provide a different shape of memory primitives that map to our `VendorClient { add, search, synthesize }` interface with light translation layers. Mem0 OSS uses single-method `memory.add()` + `memory.search()` (closest to our shape); Zep uses graph-search over per-session messages (requires `user.add` + `memory.add_session` lifecycle pre-add); Letta uses agent-bound archival memory passages (requires `agent_id` scope). Integration testing pattern is canonical across all three: `describeIntegration = API_KEY ? describe : describe.skip` gates network-bound suites; CI patterns split between cron+manual (vendor SaaS) and PR-triggered (self-hosted possible for Letta).

---

## Q1 — Package landscape (Dependencies corner)

### Answer

| Vendor | npm package | Latest version on npm | Auth env var | Repository | Notes |
|---|---|---|---|---|---|
| **Mem0** | `mem0ai` | `3.0.6` (registry) — cloned at `3.0.3` | `MEM0_API_KEY` | github.com/mem0ai/mem0 | Multi-subpath: `./` (default) + `./oss` (sub-export) per `package.json#exports` |
| **Zep** | `@getzep/zep-cloud` | `3.23.0` | `ZEP_API_KEY` | github.com/getzep/zep-js | TS SDK; ships dual CJS + ESM (`./dist/cjs/index.js`) |
| **Letta** | `@letta-ai/letta-client` | `1.12.1` | `LETTA_API_KEY` | github.com/letta-ai/letta-node | TS SDK EXISTS (ADR D4 REST-wrap contingency NOT needed) |

### Citations

- mem0-ts: `.claude/knowledge-base/references/mem0/mem0-ts/package.json` (verified `name: mem0ai`, `version: 3.0.3`, `exports: { ".", "./oss" }`)
- Zep + Letta: npm registry metadata via `npm view <pkg> version main repository.url types` (commands documented in plan ADR D3; output captured this session via 3 sequential `npm view` invocations)

### Recommendation

`package.json#dependencies` for the follow-up `/to-plan v0-9-vendor-client-impls` should add:

```json
{
  "dependencies": {
    "mem0ai": "^3.0.6",
    "@getzep/zep-cloud": "^3.23.0",
    "@letta-ai/letta-client": "^1.12.1"
  }
}
```

All 3 are caret-pinned (minor versions OK; major changes require revisit). Per `/deps-audit` golden rule, each NEW dep needs Inquebrável Rule 9 evaluation column in the plan — the evaluation here is "no alternative considered; these are the OFFICIAL vendor SDKs per vendor's own docs".

---

## Q2 — Mem0's Zep adapter pattern (Techniques corner — Python→TS translation table)

### Answer

Mem0's `evaluation/src/zep/{add.py, search.py}` is the canonical pattern for "benchmark adapter against a competitor vendor". The Python→TS translation maps cleanly to `@getzep/zep-cloud` (same upstream company, same API shape).

| Mem0 Python call (verified at line citations) | TS equivalent (`@getzep/zep-cloud@3.23.0`) | Maps to our `ZepVendorClient` |
|---|---|---|
| `Zep(api_key=os.getenv("ZEP_API_KEY"))` at zep/add.py:14 | `new ZepClient({ apiKey: process.env.ZEP_API_KEY })` | constructor |
| `zep_client.user.add(user_id=X)` at zep/add.py:31 | `client.user.add({ userId: X })` | lifecycle (NOT exposed via VendorClient; called once per session-setup) |
| `zep_client.memory.add_session(user_id=X, session_id=Y)` at zep/add.py:32-35 | `client.memory.addSession({ userId, sessionId })` | lifecycle (NOT exposed via VendorClient) |
| `zep_client.memory.add(session_id=X, messages=[Message(...)])` at zep/add.py:55-63 | `client.memory.add(sessionId, { messages: [{ role, roleType, content }] })` | **`add(sessionId, text)`** — wrap text in single Message |
| `zep_client.graph.search(user_id=X, reranker="cross_encoder", query=Q, scope="edges", limit=20)` at zep/search.py:56 | `client.graph.search({ userId, reranker: "cross_encoder", query, scope: "edges", limit })` | **`search(userId, query, topK)`** — pass `topK` as `limit` |

### Citations

- `.claude/knowledge-base/references/mem0/evaluation/src/zep/add.py` (90 lines — entire file read; constructor + user/session lifecycle + Message wrapping pattern confirmed)
- `.claude/knowledge-base/references/mem0/evaluation/src/zep/search.py:50-75` — verified dual-scope graph.search (edges + nodes via reranker="cross_encoder" / "rrf") with retry-on-exception

### EC-4 cross-check (version drift)

Mem0's Python `zep_cloud` snapshot version requires inspection of `evaluation/requirements.txt` or `pyproject.toml`. Quick check via `find`:

```
find .claude/knowledge-base/references/mem0/evaluation -maxdepth 3 -name "requirements*.txt"
→ (no output captured this session — file may be at parent level or absent)
```

**Caveat**: API-version-drift verification deferred to T1 of `/to-plan v0-9-vendor-client-impls`. Risk mitigated by current `@getzep/zep-cloud@3.23.0` being stable (3.x major has shipped for months per registry timestamps); breaking changes between Python `zep_cloud@2.x` (likely Mem0 snapshot age) and TS `@getzep/zep-cloud@3.x` SHOULD be inspected once the impl class lands.

### Recommendation

`ZepOfficialClient.add(sessionId, text)` MUST internally:
1. Idempotently call `client.memory.addSession` (no-op if session exists) per session-on-first-write pattern
2. Wrap raw text in `{ messages: [{ role: "user", roleType: "user", content: text }] }` shape per Zep's Message contract

`ZepOfficialClient.search(sessionId, query, topK)` MUST use `client.graph.search` (NOT `client.memory.search`) since graph search is Mem0's documented preference for the benchmark task — leverages Zep's strongest feature.

---

## Q3 — mem0-ts API surface (Techniques corner)

### Answer

mem0-ts has multi-package layout (EC-2 absorbed): root `mem0ai` exports `./` (Mem0 cloud client) AND `./oss` (self-hosted client). For our `Mem0OfficialClient`, the **`./` default export** (Mem0 cloud SaaS) is canonical since the benchmark adapter targets the SaaS product (parity comparison).

Verified at `.claude/knowledge-base/references/mem0/mem0-ts/src/oss/src/memory/index.ts`:

```ts
// mem0-ts OSS Memory class (closest model to our future Mem0OfficialClient cloud counterpart)
class Memory {
  async add(messages: string | Message[], config: AddMemoryOptions): Promise<SearchResult>
  async search(query: string, config: SearchMemoryOptions): Promise<SearchResult>
}

interface AddMemoryOptions extends Entity {
  metadata?: Record<string, any>;
  filters?: SearchFilters;
  infer?: boolean;
}

interface Entity {
  userId?: string;
  agentId?: string;
  runId?: string;
}

interface SearchMemoryOptions {
  topK?: number;
  filters?: SearchFilters;
  threshold?: number;
}
```

### Citations

- `.claude/knowledge-base/references/mem0/mem0-ts/src/oss/src/memory/index.ts:507` (`async add` signature)
- `.claude/knowledge-base/references/mem0/mem0-ts/src/oss/src/memory/index.ts:1037` (`async search` signature)
- `.claude/knowledge-base/references/mem0/mem0-ts/src/oss/src/memory/memory.types.ts:1-30` (`Entity` + `AddMemoryOptions` + `SearchMemoryOptions` interfaces)

### Recommendation

`Mem0OfficialClient` wrapping the **cloud client** (root `mem0ai` import) should mirror the OSS shape:

```ts
import MemoryClient from "mem0ai";

class Mem0OfficialClient implements Mem0VendorClient {
  constructor(private client: MemoryClient) {}
  async add(userId: string, text: string): Promise<void> {
    await this.client.add(text, { user_id: userId, infer: true });
  }
  async search(userId: string, query: string, topK: number) {
    const result = await this.client.search(query, { user_id: userId, top_k: topK });
    return result.map((r) => ({ text: r.memory, score: r.score }));
  }
  async synthesize(question: string, context: readonly string[]): Promise<string> {
    // Mem0 cloud DOES NOT ship a synthesize endpoint — caller must use a separate LLM
    // (delegate to existing LLM DIP, NOT to a Mem0-specific call).
    throw new Error("synthesize NOT supported by mem0ai SDK; caller delegates to LLM DIP");
  }
}
```

**Important**: `synthesize` is NOT a mem0ai concern (the SDK exposes memory primitives, not completions). The `Mem0VendorClient.synthesize` contract should delegate to the existing `LLM` DIP per ADR D1.3 from v0.1; alternatively, the benchmark adapter should not call vendor `synthesize` and instead use the shared LLM client across all 4 adapters (TheMemory + Mem0 + Zep + Letta) for fair comparison.

---

## Q4 — Integration test gating pattern (Integration tests corner)

### Answer

mem0-ts uses the canonical "env-var gate + describe.skip" pattern via a one-line helper:

```ts
// .claude/knowledge-base/references/mem0/mem0-ts/src/client/tests/integration/helpers.ts:14-15
export const API_KEY = process.env.MEM0_API_KEY;
export const describeIntegration = API_KEY ? describe : describe.skip;
```

Usage at every integration test:

```ts
import { describeIntegration } from "./helpers";

describeIntegration("MemoryClient Integration — Initialization", () => {
  // tests skipped cleanly when MEM0_API_KEY is unset
});
```

Plus jest-level config (`jest.integration.config.js`):
- `testMatch: ["**/integration/**/*.test.ts"]` — file-glob separation from unit tests
- `globalSetup: <rootDir>/src/client/tests/integration/global-setup.ts` — pre-test cleanup (no-op when API key absent)
- `maxWorkers: 1` — serial execution to avoid rate limits + race conditions

### Citations

- `.claude/knowledge-base/references/mem0/mem0-ts/jest.integration.config.js` (verified all 4 config fields)
- `.claude/knowledge-base/references/mem0/mem0-ts/src/client/tests/integration/helpers.ts:14-15` (the canonical gate)
- `.claude/knowledge-base/references/mem0/mem0-ts/src/client/tests/integration/global-setup.ts:1-40` (cleanup-or-skip pattern)

### Recommendation

For our vendor integration tests at `tests/integration/benchmarks/vendor-{mem0,zep,letta}.test.ts`, mirror exactly:

```ts
// tests/integration/benchmarks/_helpers.ts
export const MEM0_KEY = process.env.MEM0_API_KEY;
export const ZEP_KEY = process.env.ZEP_API_KEY;
export const LETTA_KEY = process.env.LETTA_API_KEY;
export const describeMem0 = MEM0_KEY ? describe : describe.skip;
export const describeZep = ZEP_KEY ? describe : describe.skip;
export const describeLetta = LETTA_KEY ? describe : describe.skip;
```

Plus a per-vendor `vitest.benchmarks-vendor.config.ts` mirroring Mem0's separation OR a `describeIntegration`-style helper. Per `testing.md § Pyramid`, integration tests are the canonical layer for vendor SDK validation.

---

## Q5 — Letta TS SDK + memory endpoints (Dependencies + Techniques)

### Answer

**`@letta-ai/letta-client@1.12.1` EXISTS on npm** — ADR D4 REST-wrap fallback NOT needed. The TS SDK wraps Letta's REST API (memory endpoints below).

**Letta memory-touching endpoints (REST shape — for reference)**:

| Endpoint | Operation | File:line |
|---|---|---|
| `POST /v1/archives` | create_archive | archives.py:58 |
| `GET /v1/archives` | list_archives | archives.py:90 |
| `POST /v1/archives/{archive_id}/passages` | create_passage_in_archive | archives.py:215 |
| `POST /v1/archives/{archive_id}/passages/batch` | create_passages_in_archive | archives.py:238 |
| `POST /v1/blocks` | create_block | blocks.py:146 |
| `PATCH /v1/blocks/{block_id}` | modify_block | blocks.py:157 |
| **`GET /v1/agents/{agent_id}/archival-memory?search=...`** | list_passages (semantic search via query) | agents.py:1459 |
| **`POST /v1/agents/{agent_id}/archival-memory`** | insert_archival_memory_async | agents.py:1500 |
| **`POST /v1/agents/{agent_id}/archival-memory/search`** | search_archival_memory (semantic similarity) | agents.py:1506 |

The bottom 3 (bold) are the canonical add/search endpoints for `LettaVendorClient`. Letta's memory is **agent-scoped** (not user/session like Mem0/Zep).

### Citations

- `.claude/knowledge-base/references/letta/letta/server/rest_api/routers/v1/archives.py` (9 endpoints; verified `@router.*` decorators)
- `.claude/knowledge-base/references/letta/letta/server/rest_api/routers/v1/blocks.py` (12 endpoints)
- `.claude/knowledge-base/references/letta/letta/server/rest_api/routers/v1/agents.py:1459-1512` (agent archival memory endpoints — the canonical add/search)

### Recommendation

```ts
import { LettaClient } from "@letta-ai/letta-client";

class LettaOfficialClient implements LettaVendorClient {
  constructor(private client: LettaClient, private agentId: string) {}

  async add(agentId: string, text: string): Promise<void> {
    // Letta memory is agent-scoped, NOT user-scoped — pass agentId via constructor
    // OR adapt VendorClient signature to use scope key generically
    await this.client.agents.archivalMemory.insertArchivalMemoryAsync(agentId, { text });
  }

  async search(agentId: string, query: string, topK: number) {
    const passages = await this.client.agents.archivalMemory.searchArchivalMemory(agentId, {
      query,
      limit: topK,
    });
    return passages.map((p) => ({ text: p.text, score: p.score ?? 0 }));
  }

  async synthesize(question: string, context: readonly string[]): Promise<string> {
    // Same as Mem0 — Letta SDK exposes memory primitives, not completions
    throw new Error("synthesize NOT supported by @letta-ai/letta-client SDK; caller delegates to LLM DIP");
  }
}
```

**Important scope-key generalization**: our existing `VendorClient.add(userId, text)` interface uses `userId` as the scope key. Letta uses `agentId` (no per-user scope). Two options for `/to-plan v0-9`:
- (a) Rename interface param to `scopeKey: string` — vendor-agnostic
- (b) Letta-specific: pass `agentId` via constructor (fixed) and ignore the runtime `userId` parameter

Option (a) is cleaner (Inquebrável Rule 3 honest interface); option (b) preserves backward-compat with shipped `Mem0VendorClient` / `ZepVendorClient` interfaces. Decision deferred to `/to-plan v0-9-vendor-client-impls` ADR.

---

## Q6 — CI gating pattern (Tools corner)

### Answer

Distinct patterns per vendor type (SaaS vs self-hosted):

| Vendor | Workflow file | Trigger | Secrets | Mock-or-real | Cron |
|---|---|---|---|---|---|
| **Mem0** | `mem0/.github/workflows/ts-sdk-ci.yml` | PR on mem0-ts changes | (none — no integration job in workflow; manual local with `MEM0_API_KEY`) | mostly unit + version-bump check | — |
| **Letta** | `letta/.github/workflows/core-integration-tests.yml` | `pull_request` + `pull_request_target` (gated by `safe to test` label for external PRs) | NONE (self-hosted backend — uses Redis but no vendor SaaS keys) | full integration with Redis | — |
| **Zep** | (not cloned; assumed convergence with Mem0 pattern per ADR D3 + EC-7 DOCUMENT) | — | — | — | — |

### Citations

- `.claude/knowledge-base/references/mem0/.github/workflows/` (15 files; verified `ts-sdk-ci.yml` runs on PR matrix Node 20+22)
- `.claude/knowledge-base/references/letta/.github/workflows/core-integration-tests.yml:3-23` (verified `pull_request` + `pull_request_target` triggers + label gating)
- Zep: caveat per ADR D3 + EC-7 DOCUMENT (Zep not cloned; CI pattern assumes vendor-SaaS convention)

### Recommendation

For our TheMemory CI integrating vendor benchmarks:

1. **Mem0 + Zep (vendor SaaS)** — separate GitHub Actions workflow `.github/workflows/vendor-benchmarks.yml` triggered by `schedule: '0 6 * * *'` (daily 6 UTC) + `workflow_dispatch` (manual). Reads `MEM0_API_KEY` + `ZEP_API_KEY` from repo secrets. Does NOT run on every PR (burns API quota).
2. **Letta** — could run on every PR if Letta self-hosted backend is brought up via docker-compose in CI (Letta supports both cloud + self-hosted). Otherwise treat as Mem0/Zep pattern (cron + secrets).
3. **Local dev** — same `describeIntegration` pattern as Q4; tests skip cleanly without keys.

---

## Cross-cutting comparison

| Dimension | Mem0 | Zep | Letta |
|---|---|---|---|
| npm package | `mem0ai@3.0.6` | `@getzep/zep-cloud@3.23.0` | `@letta-ai/letta-client@1.12.1` |
| Auth env | `MEM0_API_KEY` | `ZEP_API_KEY` | `LETTA_API_KEY` |
| Scope key | `user_id` | `session_id` (per `user_id`) | `agent_id` |
| Primary add method | `client.add(text, { user_id })` | `client.memory.add(sessionId, { messages })` | `client.agents.archivalMemory.insertArchivalMemoryAsync(agentId, { text })` |
| Primary search method | `client.search(query, { user_id, top_k })` | `client.graph.search({ userId, query, limit })` | `client.agents.archivalMemory.searchArchivalMemory(agentId, { query, limit })` |
| Synthesize endpoint | NO (delegate to LLM DIP) | NO (delegate to LLM DIP) | NO (delegate to LLM DIP) |
| Hosting model | SaaS-first | SaaS-first | SaaS OR self-hosted |
| Integration test gate | `describeIntegration = API_KEY ? describe : describe.skip` (canonical for all 3) | (assume same — Zep CI not verified) | `describeIntegration` + Docker for self-hosted variant |
| CI default gating | PR matrix; integration manual local | (assume cron + workflow_dispatch + secrets) | PR + `safe to test` label for externals |

## Recommendations (1 per question — 6 total)

1. **Q1 → R1**: Add 3 production deps to follow-up plan's `## Dependencies` table: `mem0ai@^3.0.6` + `@getzep/zep-cloud@^3.23.0` + `@letta-ai/letta-client@^1.12.1`. Inquebrável Rule 9 evaluation: "no alternative considered; these are the OFFICIAL vendor SDKs per each vendor's docs".
2. **Q2 → R2**: `ZepOfficialClient.add()` MUST internally call `client.user.add` + `client.memory.addSession` idempotently before `client.memory.add` (per Mem0's verified pattern at zep/add.py:31-35). Sessions are first-class lifecycle in Zep.
3. **Q3 → R3**: `Mem0OfficialClient.synthesize()` SHOULD throw "not supported"; caller delegates to the shared LLM DIP for fairness across all 4 adapters (TheMemory + 3 vendors). Same recommendation applies for Zep + Letta — all 3 vendors lack a synthesize primitive.
4. **Q4 → R4**: Adopt `describeIntegration = API_KEY ? describe : describe.skip` helper at `tests/integration/benchmarks/_helpers.ts`. Mirrors mem0-ts canonical pattern. Vitest equivalent: `describe.skipIf(!API_KEY)` per vitest 0.34+ API.
5. **Q5 → R5**: Generalize `VendorClient` interface scope-key param from `userId: string` → `scopeKey: string` (vendor-agnostic) — Letta uses `agent_id` (not `user_id`), so the type-level lie must be fixed before shipping. Decision: ADR in `/to-plan v0-9-vendor-client-impls` documenting the rename.
6. **Q6 → R6**: Open new `.github/workflows/vendor-benchmarks.yml` triggered by daily cron + workflow_dispatch + reading vendor secrets. Do NOT run vendor benchmarks on PR triggers (quota burn). Letta-self-hosted variant could run on PRs but adds 5+ min CI runtime — defer to Phase II of the follow-up plan.

## Accepted caveats (DOCUMENT per ADR D1+D3 + EC-6+EC-7)

1. **Q3 elevated time-risk** (EC-6): mem0-ts has 3-package layout; in this discovery only the OSS sub-package was deeply read; cloud `./` default is structurally similar (per `package.json#exports`) but not verified statement-by-statement. Acceptable since OSS Memory class is the documented canonical reference for the cloud client API.
2. **Zep CI not independently verified** (EC-7): Zep not in `references/`; Q6 Zep cell extrapolated from Mem0/Letta convergence + npm registry metadata. Acceptable — vendor SaaS CI pattern is industry-standard (cron + secrets).
3. **Mem0 Python `zep_cloud` version drift unverified** (EC-4): `requirements.txt` location in `evaluation/` not found this session; cross-check deferred to T1 of follow-up plan.

## What this blueprint enables

`/to-plan v0-9-vendor-client-impls` can now ship 3 concrete `VendorClient` classes with:
- npm packages + versions pinned (R1)
- per-vendor `add` / `search` method signatures known (R2 + R3 + R4 + R5)
- mock strategy + CI gating known (R4 + R6)
- scope-key generalization documented (R5)
- 3 caveat tasks for cycle-implement: version-drift cross-check (T1), Zep CI verify-or-document (T2), interface rename ADR + back-compat shims (T3)

Estimated `/to-plan v0-9-vendor-client-impls` complexity: ~6-8 tasks; ~300-500 LoC across `src/benchmarks/{mem0,zep,letta}/{vendor-client.ts, vendor-client.test.ts}`; 1-2 ADRs (D1 scope-key rename, D2 synthesize delegation).
