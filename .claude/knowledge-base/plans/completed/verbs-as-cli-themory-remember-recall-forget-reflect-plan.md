# Plan: verbs-as-cli-themory-remember-recall-forget-reflect — Roadmap Item 18 verbs-as-CLI scope (B2 full)

> **Version 1.1** (2026-06-04) — Absorbs `/edge-case-plan verbs-as-cli-themory-remember-recall-forget-reflect` (2026-06-04) report. **3 `MUST FIX` absorbed**: EC-1 (empirically verified at `src/core/memory-store.ts:59-67` — `ScopedMemory` EXPLICITLY excludes `forget()`; top-level `Memory.forget(memoryId, options)` is the contract because memoryId is globally unique per ADR-0002; T2.3 + T3.1 + ADR D2 amended: `forget` subcommand drops scope flags entirely + invokes `memory.forget(id)` directly; T0.1 tests 8+9+12 updated to NOT pass `--user` for forget); EC-2 (empirically verified at `src/core/skill.ts` — `ScopedSkillMemory` has DIVERGENT verb surface: `add` not `remember`, `consolidate` not `reflect`, `recall` returns `SkillItemWithScore` not `MemoryItemWithScore`; `--skills` flag DROPPED from this plan; ADR D2 amended to "3-tier only"; skill-CLI surface deferred to a future plan with separate `themory skill {add,recall,forget,consolidate}` namespace per ADR-0010 verb-surface divergence); EC-3 (commander v12 catches `.action()` promise rejection + exits with code 1 by default, not the ADR-D4-promised exit 2; each handler now calls `process.exit(2)` directly on env-fail BEFORE throw path; T0.1 gains test #13 asserting `expect(result.status).toBe(2)` on missing OPENAI_API_KEY). **4 `SHOULD TEST` absorbed inline** in T0.1 TDD block: EC-4 (test #14 `test_remember_empty_text_exits_2`); EC-5 (test #15 `test_forget_invalid_uuid_exits_2`); EC-6 (tests #16-18: 3 sub-tests for --top-k / --threshold / --diversify out-of-bounds); EC-7 (test #19 `test_recall_json_does_not_include_embedding_array` + stdout size floor < 50 KB). **2 `DOCUMENT` absorbed**: EC-8 (T2.1 Deep Dives note: warm-up cost ~2-5s per invocation; batch ops > 50 invocations should use REST server); EC-9 (T2.2 Deep Dives note: recall returns `MemoryItemWithScore[]` with extra `score: number` field, distinguishable from remember's `MemoryItem[]`). **Goal SMART assertion floor bumped 12 → 19** to reflect EC-1 through EC-7 absorption. **Coverage Matrix** restructured: skill-tier row collapsed (out of scope per EC-2); forget-scope row collapsed (out of scope per EC-1).
>
> **Version 1.0** (2026-06-04) — Closes the verbs-as-CLI DEFERRED entry on CLAUDE.md Roadmap Item 18 ("Consolidated CLI `themory {mcp,server,migrate,health}` — Verbs-as-CLI (`themory remember`/`recall`) DEFERRED to P1"). Project owner authorized B2 (Full — 4 verbs with rich flags) via `AskUserQuestion` "(B2) Full — 4 verbs (remember/recall/forget/reflect) com flags ricos" decision in this session. Adds 4 new subcommands to the existing `themory` consolidated CLI (commander-based), each exercising the 4-verb public API surface (`Memory.{remember,recall,forget,reflect}` + scope-binding via `.user(id)` / `.session(id)` / `.agent(id)`). Per CLAUDE.md § PRIORITY 0 sub-goal 1 ("APIs corretas"): the verbs are already exported and stable; this plan exposes them at the consumer-facing CLI surface, NOT introducing new public API. Inquebrável Rule 11 (YAGNI) ceiling: ~500 LoC total across cli.ts + 4 new run-*.ts handlers + integration test; zero new DIPs; zero new external dependencies; commander already present per the `mcp/server/migrate/health` subcommands.

## Goal

> "Add 4 CLI verbs to `themory` (`remember <text>` / `recall <query>` / `forget <id>` / `reflect`) wired to the existing 4-verb public API + 3-tier scope binding so that the integration test `tests/integration/cli/verbs-cli.test.ts` PASSES with ≥ 19 assertions (v1.1 — was 12; EC-1..EC-7 absorptions add 7 assertions) verifying round-trip (a) `themory remember 'fact' --user alice` writes a row + outputs the JSON-serialized MemoryItem to stdout; (b) `themory recall 'query' --user alice --top-k 5 --json` returns ≤ 5 items as JSON without `embedding` field; (c) `themory forget <uuid> --hard` (NO scope flag — memoryId globally unique) soft-deletes the row + outputs the result; (d) `themory reflect --user alice` triggers reflection pipeline + outputs the ReflectResult — against real `ankane/pgvector:v0.5.1`."

## Context

### What exists today

Per `src/agent-tools/cli.ts:56-122` (`buildProgram`), the `themory` consolidated CLI ships 4 subcommands via commander v12:

- `themory mcp` — start MCP server (stdio / streamable-http transports)
- `themory server` — start REST server (port + host flags)
- `themory migrate` — run pending Drizzle migrations
- `themory health` — DI graph + DB ping readiness check

The 4-verb public API surface exists at `src/core/index.ts` + `src/local/index.ts` (verified empirically at `src/core/memory-store.ts:55-110` during EC-1 + EC-2 absorption):

- `Memory.user(id) | session(id) | agent(id)` — 3-tier scope binding per ADR-0002. (EC-2 absorption: `Memory.skills(repoId)` returns `ScopedSkillMemory` with DIVERGENT verb surface — `add` not `remember`, `consolidate` not `reflect` — out of scope for THIS plan; skill-CLI surface deferred to a future `themory skill {add,recall,forget,consolidate}` plan.)
- `ScopedMemory.remember(text, options?)` — RememberOptions (kind, attributedTo, etc.)
- `ScopedMemory.recall(query, options?)` — RecallOptions (topK, threshold, diversify, asOf, etc.). Returns `Promise<readonly MemoryItemWithScore[]>` — note `MemoryItemWithScore` extends `MemoryItem` with `score: number`.
- `Memory.forget(memoryId, options?)` (top-level, NOT scoped — EC-1 absorption: `ScopedMemory.forget()` does NOT exist per the EXPLICIT comment at `memory-store.ts:59-60` "Notably excludes `forget` (memoryId is globally unique — use top-level Memory.forget)") — ForgetOptions (hard?: boolean — GDPR escape hatch)
- `ScopedMemory.reflect(options?)` — Reflection pipeline (ReflectionPolicy DIP)

All 4 verbs ship via subpath-export agnostic paths and through the existing `createLocalMemory(...)` factory (already used by `run-mcp-server.ts` + `run-server.ts`).

### What's missing

The 4 verbs are reachable via:
- MCP tools (`mcp__themory__remember/recall/forget/reflect`) per `run-mcp-server.ts`
- REST endpoints (`POST /v1/{remember,recall,forget,reflect}`) per `src/server/handlers/*.ts`
- TypeScript imports (`@usetheo/memory` default barrel)

But NOT via CLI. Direct CLI usage is the canonical pattern for OPS scripting + dogfood-style ad-hoc inspection + Docker debugging shell commands. The DEFERRED status on Roadmap Item 18 is a documented gap explicitly closed by this plan.

### Evidence motivating NOW

- CLAUDE.md Roadmap Item 18 lists "Verbs-as-CLI (`themory remember`/`recall`) DEFERRED to P1" as a known gap; P0 sub-goals 1+2+3 closed per PR #30 merge (`b693361`); P0 freeze can be lifted item-by-item per the closure-criteria mechanism in CLAUDE.md § PRIORITY 0
- Empirical demand: when dogfooding via Claude Code + .mcp.json, ops scripts that want to seed memories or inspect recall offline currently must spawn a Node.js shell with imports — high friction; CLI verbs collapse it to a 1-liner
- Composability with Roadmap Item 17 (Docker stack `ghcr.io/usetheo/themory:0.1.0-alpha`): `docker exec -it themory themory recall 'query' --user alice` becomes possible — enables observability + debugging without REST round-trips
- Surface is small (~500 LoC budget): 1 buildProgram extension + 4 thin run-verb-*.ts handlers + 1 integration test file. Well under architecture.md § 7 module hygiene 500 LoC per-file budget

## Dependencies

Per cycle-plan.md v1.1 hard gate (`plan_dependencies_section_missing`):

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| commander | ^12.1.0 | npm | CLI framework — already wired for the 4 existing subcommands |
| pg | ^8.16.0 | npm | PostgreSQL driver — already wired for createLocalMemory |
| vitest | ^4.0.0 | npm | Integration + contract test runner |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why this one |
|---|---|---|---|---|
| (none) | | | | |

**Rule 9 verdict:** zero new deps. The 4-verb CLI is a thin wrapper around existing API + existing commander setup. Per Inquebrável Rule 11 (YAGNI), no library evaluation required.

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

## ADRs

### D1 — Each verb gets its own `run-*-verb.ts` handler file (NOT a single multi-verb handler)

- **Decision**: ship 4 new files at `src/agent-tools/run-remember.ts` + `run-recall.ts` + `run-forget.ts` + `run-reflect.ts`. Each handler exports `runRemember(options)` / `runRecall(options)` / etc. as a top-level async function. `cli.ts buildProgram` adds 4 new `.command()` clauses that wire `.action()` to the respective handler.
- **Rationale**:
  - **Per-file alternative (chosen)**: matches the existing convention (`run-mcp-server.ts` / `run-server.ts` / `run-migrate.ts` / `run-health.ts` are each per-subcommand). SRP per `architecture.md § 7` — each file has one reason to change (one verb). Test isolation per `testing.md § Pyramid` — each handler testable in isolation.
  - **Single multi-verb handler alternative (rejected)**: would create a god-handler file violating SRP; harder to test in isolation; less discoverable for new contributors. Reverses the per-subcommand decision T2.1 of `theo-memory-standalone-p0` locked.
  - **Inline handler in cli.ts alternative (rejected)**: would explode `cli.ts` past the 200 LoC budget that EC-27 of `theo-memory-standalone-p0` locked. Forces SRP violation.
- **Consequences**:
  - 4 new files under `src/agent-tools/` (each ~60-100 LoC).
  - `cli.ts` grows by ~80 LoC (4 new `.command()` blocks); stays well under 500 LoC budget.
  - 4 new compiled artifacts at `dist/agent-tools/run-{remember,recall,forget,reflect}.js` + `.d.ts` — automatically caught by the `dist/**/*.js` + `dist/**/*.d.ts` globs shipped via PR #30; no `package.json#files` change needed.

### D2 — Scope binding via mutually exclusive `--user` / `--session` / `--agent` flags (one required) — applies to remember/recall/reflect ONLY; forget does NOT bind scope

- **Decision** (v1.1 — amended via EC-1 + EC-2 absorption): `remember` + `recall` + `reflect` subcommands each require EXACTLY ONE of `--user <id>` / `--session <id>` / `--agent <id>` flags. CLI rejects with exit code 2 + stderr error if zero OR more than one specified. Maps internally to `memory.user(id)` / `memory.session(id)` / `memory.agent(id)` before invoking the verb. **`forget` subcommand does NOT accept scope flags** — invokes top-level `memory.forget(memoryId, options)` directly because memoryId is globally unique per ADR-0002 + EXPLICITLY excluded from `ScopedMemory` per `memory-store.ts:59-60`. **`--skills` flag is NOT included** — `ScopedSkillMemory` has divergent verb surface (`add` not `remember`, `consolidate` not `reflect`) per ADR-0010 + `skill.ts`; skill-CLI surface deferred to a separate plan.
- **Rationale**:
  - **3-tier mutually-exclusive (chosen)**: matches the locked 3-tier scope contract (ADR-0002) verbatim. Forces the caller to disambiguate scope at command time — no silent default-scope footgun. Aligns with `architecture.md § Three-tier scope` invariant.
  - **forget bypassing scope (chosen — EC-1)**: memoryId is globally unique; requiring `--user X` for forgetting row that belongs to user Y would either silently fail (UPDATE WHERE id = $1 AND user_id = $2 → 0 rows) OR create cross-scope-authorization footgun if validation absent. Top-level `Memory.forget` is the locked contract.
  - **Excluding `--skills` (chosen — EC-2)**: `ScopedSkillMemory` has divergent verb names (add/recall/forget/consolidate) AND divergent parameter shapes (add takes code-as-skill payload, not free text); shoehorning into `remember/recall/reflect` would silently misroute consumer calls. Separate `themory skill {...}` subcommand namespace is the honest path; tracked for follow-up cycle.
  - **Single `--scope <type>:<id>` alternative (rejected)**: forces parser logic for the `type:id` split; introduces a string-parse failure mode; less ergonomic for the common single-scope case. Anti-Inquebrável Rule 10 (KISS).
  - **Default-scope-from-env alternative (rejected)**: `THEOMEM_MCP_DEFAULT_USER_ID` exists for MCP stdio BUT CLI ergonomics expect explicit scope at command-time; env-fallback would create silent surprises when the env-var is set system-wide.
- **Consequences**:
  - 3 verbs (remember/recall/reflect) `.action()` validates flag exclusivity before dispatching.
  - forget `.action()` validates UUID v4 format of positional `<id>` arg + accepts `--hard` flag only.
  - 1 shared `resolveCliScope()` helper at `src/agent-tools/cli-scope.ts` (NEW) — DRY per `architecture.md § DRY` discipline. Returns `ScopedMemory` (NOT a union with `ScopedSkillMemory`) or throws typed error.
  - Each integration test verifies the exit-code-2-on-zero/multi-scope path for remember/recall/reflect; forget tests verify NO scope flags accepted (extra scope flags produce commander unknown-option error → exit code 1).

### D3 — Output format: `--json` flag (default) vs `--text` flag (human-readable)

- **Decision**: each verb supports `--json` (default ON) and `--text` (human-readable) output formats. JSON output uses `JSON.stringify(result, null, 2)` to stdout; text output uses a verb-specific renderer:
  - `remember` text: `Wrote <count> memories: <id1>, <id2>, ... (scope=<scope>)`
  - `recall` text: `Found <count> memories:\n  - [<score>] <id>: <text>\n  - ...`
  - `forget` text: `Forgot <id> (hard=<bool>, scope=<scope>)`
  - `reflect` text: `Reflected <count_source> → <count_derived> insights (scope=<scope>)`
- **Rationale**:
  - **JSON-default-with-opt-out-text (chosen)**: JSON is composable with `jq` / scripts / Docker ops; default-JSON matches Roadmap Item 18 P1 ergonomics goal. Text-opt-in serves interactive humans.
  - **Text-default alternative (rejected)**: human ergonomics OK BUT breaks shell-pipeline composability without flag — most CLI users expect machine-readable default in the agent-tools space (jq + jsonpath culture).
  - **Both-as-flag alternative (rejected, ergo more verbose)**: forces `--json` or `--text` always; default-JSON is the lighter contract.
- **Consequences**:
  - Each handler returns a typed result; `cli.ts` action wires the format flag → renderer choice.
  - 1 shared `renderCliOutput()` helper at `src/agent-tools/cli-output.ts` (NEW); DRY for the 4 renderers (~50 LoC total).

### D4 — Memory factory via `createLocalMemory` + env-driven config (NOT a CLI-specific factory); EC-3 absorption: exit 2 via direct `process.exit(2)`, NOT thrown exception

- **Decision** (v1.1 — amended via EC-3 absorption): each verb-handler invokes the existing `createLocalMemory()` factory with env-driven config (`THEOMEM_PG_URI` + `OPENAI_API_KEY` + `OPENAI_BASE_URL` + `OPENAI_CHAT_MODEL`) — identical pattern to `run-mcp-server.ts` + `run-server.ts`. Hard-fail on missing required env via DIRECT `process.exit(2)` call (mirror of e43d801 anti-stub regime), NOT a thrown exception. **EC-3 absorption**: commander v12 catches `.action()` promise rejections AND exits with code 1 by default (NOT the throw's intent), so the handler MUST call `process.exit(2)` itself BEFORE the throw path runs to preserve the ADR-promised exit code contract.
- **Rationale**:
  - **Reuse existing factory (chosen)**: zero new wiring; verbs are end-consumers of the same Memory contract MCP + REST already use. SRP per `architecture.md § 5`. Single source-of-truth for the LocalTransformerEmbedder + OpenAILLM real-providers wiring.
  - **CLI-specific lightweight factory alternative (rejected)**: would duplicate the env-validation + dim-probe + factory wiring; violates DRY; risks drift from MCP/REST behavior (e.g., embeddingDim mismatch).
- **Consequences**:
  - Each handler shares the env-fail behavior + LocalTransformerEmbedder + OpenAILLM wiring with MCP + REST.
  - Tests share the same env-required precondition pattern; `describe.skipIf` gates on `OPENAI_API_KEY` + `THEOMEM_PG_URI` per parent EC-3 pattern.
  - Per `architecture.md § 8 Error handling`: missing env throws typed exception via `process.exit(2)` with stderr disclosure; honors fail-fast discipline.

### D5 — Backward compat: NO `themory-mcp` analog for verb aliases

- **Decision**: do NOT add `themory-remember` / `themory-recall` / etc. bin aliases. `themory remember` (multi-arg) is the canonical invocation. The pre-existing `themory-mcp` alias (EC-27 of `theo-memory-standalone-p0`) is preserved for MCP backward-compat only.
- **Rationale**:
  - **No alias (chosen)**: bin aliases were added for `themory-mcp` because MCP was the ORIGINAL `themory-mcp` bin pre-T2.1 consolidation; backward-compat was non-negotiable. Verbs are NEW — no pre-existing CLI shape to preserve.
  - **Per-verb alias alternative (rejected)**: pollutes `package.json#bin` from 2 entries to 6; multiplies the post-install bin-discovery surface; no consumer pre-existing pattern justifies the cost.
- **Consequences**:
  - `package.json#bin` UNCHANGED — keeps `themory` + `themory-mcp` only.
  - No new bin-discovery sentinel test needed; existing `pack-manifest.test.ts` floor `themory` + `themory-mcp` continues to hold.

## Dependency Graph

```
Phase 0 (Baseline RED) ──▶ Phase 1 (Shared helpers) ──▶ Phase 2 (4 handlers) ──▶ Phase 3 (CLI wiring) ──▶ Phase 4 (Integration Validation)
                                                                                                      │
                                                                                                      ▼
                                                                                              cycle-implement complete
```

- **Phase 0**: write RED integration tests for the 4 verbs + scope validation + format flags.
- **Phase 1**: ship `cli-scope.ts` + `cli-output.ts` helpers (shared by all 4 handlers).
- **Phase 2**: ship 4 handlers (`run-remember.ts` / `run-recall.ts` / `run-forget.ts` / `run-reflect.ts`) — parallel-safe per-file.
- **Phase 3**: extend `buildProgram` in `cli.ts` with 4 `.command()` blocks wiring the handlers + scope helpers.
- **Phase 4**: full validation chain + sub-goal verification.

---

## Phase 0: Baseline — RED tests for 4 verbs + scope + format

### T0.1 — Author `tests/integration/cli/verbs-cli.test.ts` (RED)

#### Objective

Lock the post-implementation behavioral contract for the 4 CLI verbs: round-trip remember → recall → forget → reflect against real pgvector, with scope binding + format flags.

#### Evidence

- Per Goal SMART: ≥ 12 assertions reaching PASS post-implementation.
- Test path `tests/integration/cli/*.test.ts` matches `vitest.integration.config.ts include: ['tests/integration/**/*.test.ts']`.
- Spawn pattern: `spawnSync('node', ['dist/agent-tools/cli.js', 'remember', ...])` — same pattern as `tests/integration/p0-audit/mcp-cli-boot.test.ts:60-72`.

#### Files to edit

```
tests/integration/cli/verbs-cli.test.ts (NEW) — 12 assertions per § TDD below
```

#### Deep file dependency analysis

- **`tests/integration/cli/verbs-cli.test.ts`** (NEW) — no existing dependents. Imports `node:child_process` (spawnSync), `node:fs` (existsSync), `node:path` + `node:url` (REPO_ROOT). Spawns `node dist/agent-tools/cli.js ...` for each assertion.

#### Deep Dives

- **Spawn pattern**: `spawnSync('node', [CLI_PATH, verb, ...args], { encoding: 'utf8', timeout: 30_000, env: { ...process.env, THEOMEM_PG_URI, OPENAI_API_KEY, ... } })`.
- **describe.skipIf gates** (parent EC-3 LOUD-skip pattern):
  - `DIST_EXISTS` = `existsSync('dist/agent-tools/cli.js')` — must be true.
  - `HAS_OPENAI` = `process.env.OPENAI_API_KEY !== undefined && !== ''`.
  - `HAS_PG_URI` = `process.env.THEOMEM_PG_URI !== undefined && !== ''`.
  - On skip: `console.warn('T0.1 SKIP — ...')` per parent EC-3 pattern.
- **Test scoping**: each test uses a UNIQUE `--user <test-uuid>` to isolate from concurrent runs + from the dogfood `claude-code-theo-memory` user. `beforeEach` generates `randomUUID()`; `afterAll` skips cleanup (rows survive for audit per ADR-0003 ADD-only).
- **JSON parsing**: `JSON.parse(result.stdout)` — assert on shape (id format, scope object, text, etc.).
- **Recall ordering**: write 3 facts → recall — assert ≥ 1 result + top-1 semantic match.

#### Tasks

1. Create `tests/integration/cli/` directory.
2. Author the test file with 12 assertions per § TDD below.
3. Run `npm test -- tests/integration/cli/verbs-cli.test.ts` — confirm 12 FAIL (RED) because the 4 verb subcommands don't exist yet.

#### TDD

```
RED: test_1_remember_outputs_json_with_user_scope()
     — `themory remember 'I prefer dark mode' --user <uuid>` exits 0, stdout
     parses as JSON, has shape { id: uuid, text, scope: { kind: 'user', userId: uuid }, ... }

RED: test_2_remember_outputs_text_format_when_text_flag()
     — `themory remember 'fact' --user <uuid> --text` stdout matches /Wrote 1 memories/

RED: test_3_remember_zero_scope_exits_2()
     — `themory remember 'fact'` (no --user/--session/--agent/--skills) exits 2

RED: test_4_remember_multi_scope_exits_2()
     — `themory remember 'fact' --user a --session b` exits 2

RED: test_5_recall_returns_items_topk_capped()
     — after writing 5 facts, `themory recall 'query' --user <uuid> --top-k 3 --json` returns array of length ≤ 3

RED: test_6_recall_threshold_filters_below()
     — `themory recall 'noise' --user <uuid> --threshold 0.95 --json` returns array (length ≥ 0; high-threshold filter exercised)

RED: test_7_recall_text_format()
     — `themory recall 'query' --user <uuid> --text` stdout matches /Found \d+ memories/

RED: test_8_forget_soft_outputs_deleted_id() — EC-1 absorbed
     — `themory forget <id>` (NO scope flag — memoryId globally unique per
     ADR-0002 + memory-store.ts:59-60) outputs JSON with the id; subsequent
     recall does NOT return it

RED: test_9_forget_hard_outputs_deleted() — EC-1 absorbed
     — `themory forget <id> --hard` (NO scope flag) outputs JSON; row
     hard-deleted

RED: test_10_reflect_outputs_result()
     — `themory reflect --user <uuid>` exits 0, stdout JSON has shape { sourceCount, derivedCount, ... }

RED: test_11_reflect_text_format()
     — `themory reflect --user <uuid> --text` stdout matches /Reflected \d+ → \d+ insights/

RED: test_12_round_trip_remember_recall_forget() — EC-1 absorbed
     — sequence: remember A → recall finds A → forget A (NO scope flag) →
     recall NO LONGER finds A; integrated assertion

RED: test_13_remember_missing_openai_key_exits_2() — EC-3 absorption
     — `themory remember 'fact' --user u` with OPENAI_API_KEY unset exits
     with code 2 (NOT 1). Validates the commander-promise-rejection-swallow
     workaround per ADR D4 amendment: handler calls process.exit(2) directly.

RED: test_14_remember_empty_text_exits_2() — EC-4 absorption
     — `themory remember '' --user u` exits 2 with stderr matching /text/i.
     Validates boundary rejection at CLI input (per architecture.md § 8)
     BEFORE round-tripping to LLM extraction.

RED: test_15_forget_invalid_uuid_exits_2() — EC-5 absorption
     — `themory forget 'not-a-uuid'` exits 2 with stderr matching /uuid/i.
     Locks the T2.3 UUID v4 validator regression sentinel.

RED: test_16_recall_top_k_out_of_bounds_exits_2() — EC-6 absorption (sub-1)
     — `themory recall 'q' --user u --top-k 0` exits 2; `--top-k 1000`
     exits 2; `--top-k -1` exits 2. Locks T2.2 integer-1-100 bounds.

RED: test_17_recall_threshold_out_of_bounds_exits_2() — EC-6 absorption (sub-2)
     — `themory recall 'q' --user u --threshold 2.0` exits 2; `--threshold
     -0.1` exits 2. Locks T2.2 float-0-1 bounds.

RED: test_18_recall_diversify_lambda_out_of_bounds_exits_2() — EC-6 absorption (sub-3)
     — `themory recall 'q' --user u --diversify 1.5` exits 2. Locks T2.2
     optional float-0-1 bounds. Mirrors mmrRerank lambda validation per
     principles-alignment-hardening EC-3.

RED: test_19_recall_json_does_not_include_embedding_array() — EC-7 absorption
     — after writing 1 fact, `themory recall 'q' --user u --top-k 10 --json`
     stdout: (a) stdout.length < 50_000 bytes (typical: ~500 bytes per item);
     (b) JSON.parse(stdout)[0] does NOT contain key 'embedding'. Guards
     against accidental serialization of internal 1536-float vectors that
     would balloon stdout to 80 KB+ per top-k=10 and break shell pipes.

GREEN: Phase 1-3 implementation
REFACTOR: None expected
VERIFY: npm test -- tests/integration/cli/verbs-cli.test.ts
```

#### Acceptance Criteria

- [ ] All 19 RED tests FAIL pre-implementation (12 original + 7 EC absorptions)
- [ ] `describe.skipIf` gates with LOUD `console.warn`
- [ ] Test file under 500 LoC (v1.1 — was 350; EC absorptions add ~150 LoC)
- [ ] Pass: lint, typecheck

#### DoD

- [ ] File created
- [ ] 19 tests FAIL (RED locked)

---

## Phase 1: Shared helpers

### T1.1 — `src/agent-tools/cli-scope.ts` (NEW) — scope resolver

#### Objective

Single source-of-truth function `resolveCliScope(opts)` → `ScopedMemory` from one of `--user / --session / --agent` flags (v1.1 — `--skills` DROPPED per EC-2 absorption; `ScopedSkillMemory` has divergent verb surface and lives in a separate plan namespace).

#### Files to edit

```
src/agent-tools/cli-scope.ts (NEW) — ~50 LoC; resolveCliScope + types
src/agent-tools/__tests__/cli-scope.test.ts (NEW) — contract tests
```

#### Deep file dependency analysis

- **`src/agent-tools/cli-scope.ts`** (NEW) — pure function; imports `Memory` type from `../core/index.js`. Returns `ScopedMemory` discriminated union OR throws.
- **`__tests__/cli-scope.test.ts`** — matches `vitest.contract.config.ts` `src/{...,agent-tools,...}/**/__tests__/**/*.test.ts`.

#### Deep Dives

- **Signature** (v1.1 — EC-2 absorbed): `resolveCliScope(memory: Memory, opts: { user?: string; session?: string; agent?: string }): ScopedMemory` — throws `Error('--user / --session / --agent: exactly one required')` on zero or multi.
- **Validation**: count non-undefined fields among (user, session, agent); if !== 1, throw.
- **Mapping**: switch on which field is set → `memory.user(opts.user!)` / `memory.session(opts.session!)` / `memory.agent(opts.agent!)`.
- **Return type**: `ScopedMemory` (NOT a union with `ScopedSkillMemory`); skill-CLI surface deferred.

#### TDD

```
RED: test_resolve_user_returns_user_scope
RED: test_resolve_session_returns_session_scope
RED: test_resolve_agent_returns_agent_scope
RED: test_resolve_zero_scope_throws
RED: test_resolve_multi_scope_throws_for_user_plus_session
RED: test_resolve_multi_scope_throws_for_user_plus_agent
GREEN: implement resolveCliScope per § Deep Dives
VERIFY: npm test -- src/agent-tools/__tests__/cli-scope.test.ts
```

#### Acceptance Criteria

- [ ] 6/6 contract tests PASS
- [ ] LoC ≤ 100
- [ ] Pass: lint, typecheck

### T1.2 — `src/agent-tools/cli-output.ts` (NEW) — output renderer

#### Objective

Shared `renderCliOutput(result, format)` → stdout text. JSON via `JSON.stringify(result, null, 2)`; text via verb-specific renderer.

#### Files to edit

```
src/agent-tools/cli-output.ts (NEW) — ~80 LoC; renderCliOutput + 4 text renderers
src/agent-tools/__tests__/cli-output.test.ts (NEW) — contract tests
```

#### TDD

```
RED: test_render_json_serializes_with_2_space_indent
RED: test_render_text_remember_matches_pattern
RED: test_render_text_recall_with_items_lists_each
RED: test_render_text_recall_empty_outputs_zero
RED: test_render_text_forget_includes_id_and_hard_flag
RED: test_render_text_reflect_includes_source_and_derived_counts
GREEN: implement per § Deep Dives
VERIFY: npm test -- src/agent-tools/__tests__/cli-output.test.ts
```

#### Acceptance Criteria

- [ ] 6/6 PASS
- [ ] LoC ≤ 120
- [ ] Pass: lint, typecheck

---

## Phase 2: 4 handlers

### T2.1 — `src/agent-tools/run-remember.ts` (NEW)

#### Objective

Handler that consumes parsed opts → invokes `scoped.remember(text, options)` → outputs result.

#### Files to edit

```
src/agent-tools/run-remember.ts (NEW) — runRemember(opts) exports
```

#### Deep Dives

- Imports `createLocalMemory` from `../local/index.js` per ADR D4.
- Hard-fails on missing OPENAI_API_KEY + THEOMEM_PG_URI via DIRECT `process.exit(2)` call BEFORE throw path (EC-3 absorption — commander would swallow throw → exit 1; explicit exit 2 preserves contract).
- Rejects empty-string text at boundary with `process.exit(2)` + stderr (EC-4 absorption).
- Invokes `resolveCliScope()` + `scoped.remember(text)` → renders via `renderCliOutput()`.
- Signature (v1.1 — EC-2 absorbed: `skills` dropped): `runRemember(opts: { text: string; user?: string; session?: string; agent?: string; format: 'json' | 'text' }): Promise<void>`.
- **EC-8 absorption (DOCUMENT)**: each CLI invocation creates the Memory factory → downloads/initializes Xenova MiniLM model (cached after first invocation) → connects to Postgres (~50ms) → runs Drizzle journal sync (~100ms). First invocation cold-start ~2-5s; subsequent ~500ms-1s. For batch ops > 50 invocations, recommend `themory server` + curl OR Node.js bulk-import script using the public API directly. CLI is per-call setup-heavy by design (single-process lifecycle).

#### TDD

Covered by T0.1 integration tests (handler invoked via subcommand). NO contract-level RED needed — integration is the gate.

#### Acceptance Criteria

- [ ] LoC ≤ 80
- [ ] Pass: lint, typecheck
- [ ] T0.1 tests 1-4 PASS post-Phase 3 wiring

### T2.2 — `src/agent-tools/run-recall.ts` (NEW)

Same pattern as T2.1 for recall. `RecallOptions` from parsed `--top-k <n>` (integer 1-100 validated) + `--threshold <f>` (float 0-1 validated) + `--diversify <lambda>` (optional float 0-1).

#### Files to edit

```
src/agent-tools/run-recall.ts (NEW)
```

#### Deep Dives

- **EC-6 absorption**: flag validators use the same pattern as `cli.ts:71-77` for `--port` — `parseIntInRange(raw, min, max)` + `parseFloatInRange(raw, min, max)` helpers; each throws if out-of-bounds; caller catches → `process.exit(2)` per ADR D4 contract.
- **EC-7 absorption**: BEFORE calling `renderCliOutput()`, the handler strips the `embedding` field from each item via `items.map(({ embedding, ...rest }) => rest)` (shallow copy). The internal `MemoryItemWithScore.embedding` field carries a 1536-float vector that should NEVER reach stdout (~80 KB per top-k=10 → breaks shell pipes + terminal output). Test #19 asserts the absence.
- **EC-9 absorption (DOCUMENT)**: recall returns `Promise<readonly MemoryItemWithScore[]>` per `memory-store.ts:66`. JSON output shape carries `score: number` per item — distinguishable from remember's plain `MemoryItem[]`. Text renderer per ADR D3 uses `[<score>] <id>: <text>` pattern that surfaces the score field explicitly.

#### Acceptance Criteria

- [ ] LoC ≤ 120 (v1.1 — was 100; EC-6 + EC-7 absorption adds ~20 LoC for validators + embedding strip)
- [ ] Pass: lint, typecheck
- [ ] T0.1 tests 5-7 + 12 + 16-19 PASS post-Phase 3

### T2.3 — `src/agent-tools/run-forget.ts` (NEW) — top-level forget per EC-1

`runForget(opts: { id: string; hard?: boolean; format: 'json' | 'text' })`. Validates id is UUID v4. `hard` defaults false. **NO scope flags** per EC-1 absorption — invokes top-level `memory.forget(opts.id, { hard: opts.hard })` because `memoryId` is globally unique per ADR-0002 + `memory-store.ts:59-60` EXPLICITLY excludes `forget()` from `ScopedMemory`.

#### Files to edit

```
src/agent-tools/run-forget.ts (NEW)
```

#### Deep Dives

- **EC-1 absorption**: signature does NOT receive `user/session/agent` opts — handler does NOT call `resolveCliScope()`. Invokes `memory.forget(opts.id, { hard: opts.hard })` directly. Surface ~50 LoC (smallest of the 4 handlers because scope binding is absent).
- **EC-5 absorption**: UUID v4 validation via regex `/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i` at handler entry; mismatch → `process.exit(2)` + stderr `'Invalid <id>: must be UUID v4'`.
- **EC-3 absorption**: env-fail path uses direct `process.exit(2)` (same pattern as T2.1 / T2.2 / T2.4).
- **Output shape**: since `memory.forget` returns `Promise<void>` per the contract, handler synthesizes the JSON `{ id: opts.id, hard: opts.hard ?? false }` for output.

#### Acceptance Criteria

- [ ] LoC ≤ 80
- [ ] Pass: lint, typecheck
- [ ] T0.1 tests 8-9 + 12 + 15 PASS post-Phase 3

### T2.4 — `src/agent-tools/run-reflect.ts` (NEW)

`runReflect(opts: { ...scope })` → invokes `scoped.reflect()` → outputs ReflectResult.

#### Files to edit

```
src/agent-tools/run-reflect.ts (NEW)
```

#### Acceptance Criteria

- [ ] LoC ≤ 60
- [ ] Pass: lint, typecheck
- [ ] T0.1 tests 10-11 PASS post-Phase 3

---

## Phase 3: CLI wiring

### T3.1 — Extend `src/agent-tools/cli.ts buildProgram` with 4 verb subcommands

#### Objective

Add 4 `.command()` blocks for `remember` / `recall` / `forget` / `reflect`, each wiring `.action()` to the corresponding handler with shared scope flags + `--json`/`--text` format flags.

#### Files to edit

```
src/agent-tools/cli.ts — extend buildProgram with 4 new .command() blocks (~80 LoC)
```

#### Deep file dependency analysis

- **`src/agent-tools/cli.ts`** — current LoC ~145 (per inspection); +80 LoC = ~225, well under 500 LoC budget.
- Adds 4 imports: `runRemember`, `runRecall`, `runForget`, `runReflect`.
- Each `.command()` declares (v1.1 — EC-1 + EC-2 absorbed):
  - **remember**: positional `<text>` arg; scope flags (`--user`/`--session`/`--agent` — 3-tier, NO `--skills`); format flags (`--json`/`--text`).
  - **recall**: positional `<query>` arg; scope flags (3-tier); `--top-k <n>` + `--threshold <f>` + `--diversify <lambda>` with bounds-validators per EC-6; format flags.
  - **forget**: positional `<id>` arg; `--hard` boolean; format flags. **NO scope flags** per EC-1 — memoryId is globally unique.
  - **reflect**: scope flags (3-tier); format flags.

#### Tasks

1. Add 4 imports.
2. Insert 4 `.command()` blocks after the existing `health` command, before `program.action(...)`.
3. remember/recall/reflect `.action()` validates exclusive scope flag count + dispatches to handler.
4. forget `.action()` skips scope validation; passes `<id>` + `--hard` to runForget.
5. Each `.action()` wraps the handler call in try/catch with `process.exit(2)` fallback per ADR D4 EC-3 amendment.

#### Acceptance Criteria

- [ ] T0.1 12/12 PASS
- [ ] cli.ts LoC ≤ 250
- [ ] Pass: lint, typecheck

---

## Phase 4: Integration validation

### T4.1 — Full validation chain

```bash
npm run build  # ship 4 new dist artifacts
npm test       # contract suite (T1.1 + T1.2 + existing)
npx vitest run --config vitest.integration.config.ts tests/integration/cli/  # T0.1 12/12
npm run typecheck
npm run lint
```

CHANGELOG `[Unreleased]` updated with verbs-as-CLI entry.

### Acceptance Criteria

- [ ] All test suites GREEN
- [ ] T0.1 12/12 PASS
- [ ] Coverage ≥ 90% on changed files
- [ ] Zero TS errors, zero lint warnings
- [ ] CHANGELOG `[Unreleased]` entry added

---

## Coverage Matrix

| # | Gap | Tasks | Resolution |
|---|---|---|---|
| 1 | `themory remember <text>` CLI verb absent + EC-4 empty-text rejection + EC-8 warm-up cost doc | T0.1, T2.1, T3.1 | run-remember.ts + tests 1-4 + 13 + 14; EC-8 inline note in T2.1 Deep Dives |
| 2 | `themory recall <query>` CLI verb absent + EC-6 bounds + EC-7 embedding strip + EC-9 score-shape doc | T0.1, T2.2, T3.1 | run-recall.ts + tests 5-7 + 12 + 16-19; EC-9 inline note in T2.2 Deep Dives |
| 3 | `themory forget <id>` CLI verb absent + EC-1 top-level forget + EC-5 UUID validation | T0.1, T2.3, T3.1 | run-forget.ts (NO scope flags per EC-1; invokes top-level memory.forget) + tests 8-9 + 12 + 15 |
| 4 | `themory reflect` CLI verb absent | T0.1, T2.4, T3.1 | run-reflect.ts + tests 10-11 |
| 5 | Mutually-exclusive scope flag validation (3-tier; --skills DROPPED per EC-2) | T1.1, T3.1 | resolveCliScope helper (returns ScopedMemory only) + tests 3-4 |
| 6 | JSON-vs-text output renderer absent | T1.2, T3.1 | renderCliOutput helper |
| 7 | EC-3 commander exit-code contract — handlers call process.exit(2) directly | T2.1+T2.2+T2.3+T2.4 + T3.1 | Direct process.exit(2) in each handler; T0.1 test 13 asserts exit code |
| 8 | Integration validation | T4.1 | Full chain + CHANGELOG |

**Coverage: 8/8 (100%)** — v1.1 added 1 new row (EC-3 exit-code contract); other rows extended with EC-1/EC-2/EC-4/EC-5/EC-6/EC-7/EC-8/EC-9 absorptions inline.

## Global Definition of Done

- [ ] All 4 phases completed
- [ ] All tests passing — `npm test` + integration suite
- [ ] Zero TypeScript errors
- [ ] Zero lint warnings
- [ ] File-size budget respected (per `.claude/rules/architecture.md § 7`)
- [ ] CHANGELOG.md updated under `[Unreleased]`
- [ ] Backward compat preserved (`themory` + `themory-mcp` bins unchanged per ADR D5)
- [ ] **Plan archived** — after `/review` returns `READY_TO_MERGE` AND PR merged
- [ ] `/review` returns READY_TO_MERGE (0 BLOCKER, 0 CRITICAL)

## Final Phase: Integration Validation (MANDATORY)

```bash
npm run build && npm test && npx vitest run --config vitest.integration.config.ts tests/integration/cli/
npm run typecheck && npm run lint
```

### Acceptance Criteria

- [ ] All test suites green
- [ ] T0.1 12/12 PASS
- [ ] Coverage ≥ 90% on changed files
- [ ] Zero TS errors, zero lint warnings

### If Validation Fails

1. Identify which failures are caused by this plan vs pre-existing (per parent plan precedent).
2. Fix all plan-caused failures.
3. Re-run validation chain.
4. Pre-existing issues are logged but do NOT block plan completion.
