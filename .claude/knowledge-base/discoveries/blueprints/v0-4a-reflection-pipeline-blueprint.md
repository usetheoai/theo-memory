# Blueprint: v0.4a — Reflection pipeline

> **Version 1.0** — Technical synthesis of how `.claude/knowledge-base/references/letta/` + `.claude/knowledge-base/references/mem0/` + prior_art (Generative Agents 2023 + LangMem `BackgroundMemoryManager`) handle async reflection, scoring strategies, sleep-time worker triggers, higher-order memory persistence with `derived_from` provenance, and LLM-importance caching — informing `/to-plan v0-4a-reflection-pipeline` to lock the implementation contract for TheMemory's Roadmap Item 5. ADR-0005 (2026-05-22) already locked the `ReflectionPolicy` DIP shape; v0.4a adds `ThresholdReflectionPolicy` + `SleepTimeReflectionPolicy` as drop-in implementations of the SAME DIP — **zero contract change** at v0.4a.

**Slug:** `v0-4a-reflection-pipeline`
**Source plan:** `.claude/knowledge-base/discoveries/plans/v0-4a-reflection-pipeline-plan.md` (v1.1)
**Edge-case review:** `.claude/knowledge-base/reviews/v0-4a-reflection-pipeline-edge-cases-2026-05-25.md` (14 ECs absorbed)
**Owner:** TheMemory v0.4a cycle-discover
**Generated:** 2026-05-25 via `/discover-execute`
**Confidence verdict:** **SHIPPABLE_WITH_CAVEATS (89/100)** — scored 2026-05-25 via `/discover-confidence v0-4a-reflection-pipeline`. Single soft cap triggered: `soft_floor_citation_density_low` (0.5 cit/200w; 11523 words / 29 unique paths with high re-use ratio). All 3 hard-cap gates pass: 4/4 coverage corners populated, 29/29 citations verified (zero fabricated), 10/10 mandatory sections + 6 ADRs (D7-D12) present. Full JSON at `.claude/knowledge-base/reviews/v0-4a-reflection-pipeline-confidence-2026-05-25.md.json`. Calibration: PROVISIONAL_v1 (SOTA defaults; not yet calibrated against project holdout).

## Context

Roadmap Item 5 (CLAUDE.md § Macro roadmap, currently Planned). v0.3 — Agent tools (MCP) shipped 2026-05-25. The `ReflectionPolicy` DIP shipped at v0.0 per ADR-0005 with one implementation only (`ManualReflectionPolicy`). v0.4a is where the DIP earns its keep: TWO new implementations land WITHOUT a contract change, plus the scoring half of the pipeline. CLAUDE.md Item 5 acceptance verbatim:

> Test: seed 50 memories in a scope; trigger `reflect()`; assert ≥ 1 higher-order memory exists with `derived_from: string[]` provenance linking source memory IDs. Both scoring strategies pass identical recall-shape contract test (interface compliance). Sleep-time worker test: background trigger fires within TBD seconds (lock by v0.4a kickoff) when threshold of N new memories crossed. LLM-importance score persisted on first write; second-write same content does NOT re-invoke LLM.

## Objective

Lock six decisions for `/to-plan v0-4a-reflection-pipeline`: (a) sleep-time worker mechanism, (b) `ThresholdReflectionPolicy` trigger contract, (c) scoring-strategy DIP shape (additive default + multiplicative opt-in), (d) higher-order memory persistence with `derived_from` provenance, (e) LLM-importance caching contract, (f) test pyramid coverage.

---

## Coverage Corner 1 — Integration Tests

### Letta

Letta splits its sleep-time test pyramid into TWO clear tiers with distinct mocking discipline (EC-4 absorption — idioms transcribed verbatim, NOT translated to TheMemory's vitest stack yet; translation deferred to `/to-plan v0-4a-reflection-pipeline`):

#### Integration tier — `.claude/knowledge-base/references/letta/tests/integration_test_sleeptime_agent.py` (367 LoC, 4 tests)

E2E against a REAL Letta server. NO clock mocking. Trigger frequency is overridden via CONFIGURATION, not time-warp.

| Test function (file:line) | Behavior asserted | Fixture/idiom used | TheMemory applicability |
|---|---|---|---|
| `test_sleeptime_group_chat` (`.claude/knowledge-base/references/letta/tests/integration_test_sleeptime_agent.py:61-180`) | (a) `enable_sleeptime=True` propagates to agent (line 83). (b) Sleeptime agent tools include `memory_rethink`/`memory_finish_edits`/`memory_replace`/`memory_insert` + `exit_loop` rule (lines 117-123). (c) Run lifecycle tracked via `client.runs.list(agent_id=sleeptime_agent_id)` — N user messages produce ceil(N/freq) runs (lines 147-151). (d) Runs eventually settle to `completed`/`failed` status (lines 161-174). | `@pytest.fixture(scope="module")` for server_url + client (lines 15, 52). `@pytest.mark.flaky(max_runs=3)` to absorb real-timer jitter (line 61). `@pytest.mark.asyncio(loop_scope="module")` (line 62). Server boot via `threading.Thread(target=_run_server, daemon=True)` + poll `GET /v1/health` with 60s deadline + 100ms sleep (`integration_test_sleeptime_agent.py:31-47`). Real `time.sleep(2)` post-message (line 154) + max-wait polling loop (lines 161-169). | TheMemory `ThresholdReflectionPolicy` integration test uses pgvector container readiness probe (v0.1 pattern) + mark flaky-retry. **Crucial:** override threshold via `ThresholdReflectionPolicy({ threshold: 2 })` config, NOT via clock manipulation. |
| `test_sleeptime_removes_redundant_information` (`.claude/knowledge-base/references/letta/tests/integration_test_sleeptime_agent.py:183-244`) | **DISABLED via `@pytest.mark.skip` (line 183).** When enabled, would assert `count_after_memory_edits < count_before_memory_edits` on the "fiddle leaf" string in shared block (line 238) — behavioral dedup verification. | Same fixture set; uses `time.sleep(5)` for memory block update window (line 233). | Skipped pattern is a SIGNAL: redundancy-collapse tests are flaky against LLM nondeterminism. TheMemory should NOT directly test count-based dedup at integration tier — push to unit tier with stub LLM. |
| `test_sleeptime_edit` (`.claude/knowledge-base/references/letta/tests/integration_test_sleeptime_agent.py:247-290`) | Fact-edit propagation: send "Messi moved to Inter Miami" → `fact_block.value.count("Inter Miami") > 1` (line 290). | Same fixtures. NO `time.sleep`/poll — message create is synchronous in this path. | Direct fact-replacement is OUT OF SCOPE for v0.4a (`ADD-only` per ADR-0003); we DON'T need this test pattern. |
| `test_sleeptime_agent_new_block_attachment` (`.claude/knowledge-base/references/letta/tests/integration_test_sleeptime_agent.py:293-367`) | Regression: new block created post-agent attaches to BOTH main and sleeptime agents (lines 351-364). | Same fixtures. | Not applicable — TheMemory has no main/sleep agent split. |

**Behavioral provenance assertion pattern (EC-4 verbatim):** Letta does NOT assert `derived_from`-equivalent field on the consolidated memory. Instead it verifies SIDE-EFFECTS via string count diff:
- `assert count_after_memory_edits < count_before_memory_edits` (`.claude/knowledge-base/references/letta/tests/integration_test_sleeptime_agent.py:238`, currently disabled)
- `assert fact_block.value.count("Inter Miami") > 1` (`.claude/knowledge-base/references/letta/tests/integration_test_sleeptime_agent.py:290`)

**Provenance gap for TheMemory:** CLAUDE.md Item 5 acceptance explicitly REQUIRES `derived_from: string[]` linking source memory IDs. Letta provides no precedent; this is a TheMemory innovation per ADR D4 of the discovery plan.

#### Unit tier — `.claude/knowledge-base/references/letta/tests/test_static_buffer_summarize.py` (150 LoC, 7 tests)

Direct testing of `Summarizer._static_buffer_summarization` private method. `AsyncMock` for collaborator.

| Test (file:line) | Trigger condition tested | Assertion shape |
|---|---|---|
| `test_static_buffer_summarization_no_trim_needed` (`.claude/knowledge-base/references/letta/tests/test_static_buffer_summarize.py:40-46`) | 5 msgs, limit=20 → no trim | `len(updated_messages) == 5; not updated` |
| `test_static_buffer_summarization_trim_needed` (`.claude/knowledge-base/references/letta/tests/test_static_buffer_summarize.py:49-61`) | 12 msgs, limit=10, min=3 → trim to 3 | `len(updated_messages) == 3; updated; agent.step.assert_called()` |
| `test_static_buffer_summarization_trim_user_message` (`.claude/knowledge-base/references/letta/tests/test_static_buffer_summarize.py:64-80`) | Ensures user-message exists at trim boundary | Same as above + role manipulation |
| `test_static_buffer_summarization_no_trim_no_summarization` (`.claude/knowledge-base/references/letta/tests/test_static_buffer_summarize.py:83-90`) | 8 msgs, limit=15 → no call | `agent.step.assert_not_called()` ← **clear "did not trigger" signal** |
| `test_static_buffer_summarization_json_parsing_failure` (`.claude/knowledge-base/references/letta/tests/test_static_buffer_summarize.py:93-109`) | Malformed JSON in one message → still trims | Robustness of trigger logic vs payload content |
| `test_static_buffer_summarization_all_user_messages_trimmed` (`.claude/knowledge-base/references/letta/tests/test_static_buffer_summarize.py:112-129`) | All trimmed = user role → min+1 (preserves boundary) | Edge case |
| `test_static_buffer_summarization_no_assistant_messages_trimmed` (`.claude/knowledge-base/references/letta/tests/test_static_buffer_summarize.py:132-150`) | All trimmed = assistant role → end at 1 (no user found) | Edge case |

**Mocking idiom (EC-4 verbatim, file:line):**
- `from unittest.mock import AsyncMock` (`.claude/knowledge-base/references/letta/tests/test_static_buffer_summarize.py:3`)
- `agent = AsyncMock(spec=BaseAgent)` (`.claude/knowledge-base/references/letta/tests/test_static_buffer_summarize.py:22`)
- `agent.step.return_value = [Message(role=MessageRole.assistant, content=[TextContent(type="text", text=SUMMARY_TEXT)])]` (`.claude/knowledge-base/references/letta/tests/test_static_buffer_summarize.py:23`)
- Boolean trigger signal returned via tuple `(updated_messages, updated)` (`.claude/knowledge-base/references/letta/tests/test_static_buffer_summarize.py:43,57`)
- `mock_summarizer_agent.step.assert_called()` / `.assert_not_called()` to distinguish "summarization fired" vs "not fired" (`.claude/knowledge-base/references/letta/tests/test_static_buffer_summarize.py:61,90`)

**Cross-tier observation:** Letta's tests confirm the design pattern from ADR-0005 (manual/threshold/sleep-time policies share a SAME DIP) — the unit tier tests `Summarizer` directly with mocked agent; the integration tier tests the full sleep-time path with real agent. TheMemory should mirror: `ReflectionPolicy` unit tests with `vi.mock()` against `LLM` DIP; integration tests with real pgvector + real timers + flaky-retry.

**EC-4 absorption status:** ✓ Mocking idioms transcribed verbatim with file:line citations. NO translation to vitest/jest at execute-time — that decision belongs to `/to-plan v0-4a-reflection-pipeline`.

---

## Coverage Corner 2 — Dependencies

### Letta scheduler/workflow deps + Node ecosystem Rule 9 evaluation

#### Letta side — what scheduler deps does Letta declare and use?

Letta declares TWO scheduler-related deps in `.claude/knowledge-base/references/letta/pyproject.toml:59,63`:

```toml
"apscheduler>=3.11.0",   # line 59
"temporalio>=1.8.0",     # line 63
```

**Investigation finding — `temporalio` is DECLARED but UNUSED in code.** Grep confirms zero usage sites inside `.claude/knowledge-base/references/letta/letta/**/*.py`:

```bash
grep -rln "temporalio\|temporal\.\|from temporal" .claude/knowledge-base/references/letta/letta --include="*.py"
# (zero hits)
```

Only `.claude/knowledge-base/references/letta/pyproject.toml:63` references it. Honest reading: `temporalio` is a declared dependency without in-tree usage — possibly reserved for external infra (Letta Cloud / managed deployment), legacy intent, or removed-but-not-cleaned. **TheMemory does NOT inherit this signal as evidence — Letta's apscheduler usage is the ONLY scheduler dep with actual code paths.**

**`apscheduler` usage — single site: `.claude/knowledge-base/references/letta/letta/jobs/scheduler.py` (229 LoC)**

This file orchestrates LLM batch polling, NOT sleep-time agent triggers (key finding for Q3+Q5 — sleep-time runs INLINE, not via scheduler):

| Pattern | Citation (file:line) | Description |
|---|---|---|
| Import `AsyncIOScheduler` | `.claude/knowledge-base/references/letta/letta/jobs/scheduler.py:5` | `from apscheduler.schedulers.asyncio import AsyncIOScheduler` — single asyncio-aware scheduler |
| Import `IntervalTrigger` | `.claude/knowledge-base/references/letta/letta/jobs/scheduler.py:6` | `from apscheduler.triggers.interval import IntervalTrigger` — periodic firing pattern |
| Scheduler instance | `.claude/knowledge-base/references/letta/letta/jobs/scheduler.py:16` | Module-level `scheduler = AsyncIOScheduler()` singleton |
| Postgres advisory lock | `.claude/knowledge-base/references/letta/letta/jobs/scheduler.py:46-49` | `pg_try_advisory_lock(CAST(:lock_key AS bigint))` — leader election for multi-instance deployments |
| `IntervalTrigger` with jitter | `.claude/knowledge-base/references/letta/letta/jobs/scheduler.py:60-63` | `IntervalTrigger(seconds=settings.poll_running_llm_batches_interval_seconds, jitter=10)` — 10s random jitter to avoid thundering-herd |
| `scheduler.add_job(...)` | `.claude/knowledge-base/references/letta/letta/jobs/scheduler.py:64-72` | Job registration with `id`, `name`, `replace_existing=True`, `next_run_time` |
| Lifecycle: `start_scheduler_with_leader_election` | `.claude/knowledge-base/references/letta/letta/jobs/scheduler.py:163-182` | FastAPI startup hook |
| Lifecycle: `shutdown_scheduler_and_release_lock` | `.claude/knowledge-base/references/letta/letta/jobs/scheduler.py:185-228` | FastAPI shutdown hook + advisory lock release |

**Why apscheduler then? Synthesized rationale (no inline rationale comment in source):** Letta is a Python FastAPI app needing in-process async scheduling for periodic batch-polling. `apscheduler` provides asyncio-native `AsyncIOScheduler` + interval triggers + persistence-agnostic job registry, AND its leader-election pattern composes well with Postgres advisory locks. No additional infra (Redis, Celery broker) required.

#### Node ecosystem — Rule 9 ADOPT / REJECT / DEFER evaluation

Per `cycle-discover.md v1.1` § 7 (Rule 9 verdict requirement) + `architecture.md § 9` (Não Reinvente a Roda). EXACTLY 3 npm candidates evaluated per EC-3 lock (`agenda` / `bree` deferred to F-q2-agenda-bree-followup). 4th candidate is built-in Node `setTimeout`.

**Important — Source fallback caveat:** `npmjs.com` WebFetch returned HTTP 403 (bot-detection) for all 3 package pages. Fallback per cycle-discover.md anti-pattern #10 spirit (snapshot-first): `github.com/{owner}/{repo}` for each candidate, allowlist-cleared. Weekly download counts unavailable from GitHub READMEs (only `croner` exposes the badge value).

| # | Candidate | Source snapshot | Latest version (date) | License | Backing store | TS types | Verdict | Rationale |
|---|---|---|---|---|---|---|---|---|
| 1 | `bullmq` | [github.com/taskforcesh/bullmq](https://github.com/taskforcesh/bullmq) ([snapshot](../snapshots/v0-4a-reflection-pipeline/b131612dc1e1644e313e5350b89d555d153c981011ade2d879375c5be7ef0fbe.md)) | v5.77.3 (2026-05-25) | MIT | **Redis (mandatory)** | Built-in (56.4% TS in repo) | **REJECT for v0.4a default** | Redis dependency is disqualifying for the local-default runtime. TheMemory's v0.1 local runtime uses Postgres + pgvector ONLY (per memory-contract ADR-0001); adding Redis as a side-channel just for reflection triggers violates KISS + adds an extra container to local-dev story (Inquebrável § 10 KISS). **Reconsider for v0.5 cloud runtime** when distributed coordination matters AND TheoCloud already operates a managed Redis pool. |
| 2 | `node-cron` | [github.com/node-cron/node-cron](https://github.com/node-cron/node-cron) ([snapshot](../snapshots/v0-4a-reflection-pipeline/55db153e1031713bbb3e4af2dd398ae5e9117f0af16759f696ea6a57eefaf2c7.md)) | v4.0.0 (2025-05-10) | ISC | In-memory only | Built-in (99.1% TS in repo) | **DEFER** | Stale (12 months since v4.0.0) AND ISC license. ISC is permissive (compatible with MIT) but the staleness signal is concerning for a primitive shipping at v0.4a. v4.0.0 was a MAJOR bump; if no v4.1+ in 12 months, project may be in maintenance mode. Revisit if `croner` proves insufficient. |
| 3 | `croner` | [github.com/Hexagon/croner](https://github.com/Hexagon/croner) ([snapshot](../snapshots/v0-4a-reflection-pipeline/7d70906d9b7f5cb8c667d4fbd94902f628ade780b540ab4d1fe9d7593516a7cc.md)) | 10.0.1 (2026-02-01) | MIT | In-memory only | Built-in | **ADOPT for `SleepTimeReflectionPolicy` (in-process default)** | Active (3 months since 10.0.1), MIT, **ZERO external dependencies**, 6.8KB minzip, native Node + Deno + Bun + Browser support, 2.019M weekly downloads (visible badge). Built-in TypeScript typings. Provides cron expressions + over-run protection + timezone support — superior to `node-cron` per snapshot's "Unique vs node-cron" matrix. Aligns with TheMemory's "local-default + zero-infra-add" v0.4a posture. |
| 4 | In-process `setTimeout` (Node built-in) | N/A — language primitive | Node 20.x LTS+ | N/A (MIT in core) | In-memory only | Built-in (TS types in `@types/node`) | **ADOPT for `ThresholdReflectionPolicy` (no time-based scheduling needed)** | `ThresholdReflectionPolicy` fires when N memories are added — NOT on a clock interval. The trigger is event-driven (`remember()` write hook), not time-driven. Plain `setTimeout(0)` or microtask queue is sufficient to defer reflection to the next tick. Zero dependency added. KISS wins (Inquebrável § 10). Cron lib would be over-engineering here. |

#### Final v0.4a recommendation (synthesized for `/to-plan v0-4a-reflection-pipeline`)

- **`ThresholdReflectionPolicy.shouldReflect()`** — pure synchronous decision, no scheduling needed. Built-in `setTimeout(0)` or `queueMicrotask()` if work needs to defer to next event-loop turn.
- **`SleepTimeReflectionPolicy`** — adopt `croner` for cron-expression-based time triggers (e.g., "every 15 min"). Single MIT dep, zero transitive, 6.8KB minzip. The dep registration goes under `dependencies` (not `devDependencies`) in TheMemory's `package.json`.
- **DEFERRED** — `bullmq` for v0.5 cloud runtime if distributed coordination becomes a requirement. Re-evaluate `agenda`/`bree` per F-q2-agenda-bree-followup if a future reviewer disputes the 3-candidate cut.

**Letta vs TheMemory v0.4a delta:**

| Dimension | Letta | TheMemory v0.4a |
|---|---|---|
| Scheduler library | `apscheduler` (Python) — single in-process scheduler | `croner` (Node) — only for sleep-time periodic trigger |
| Leader election | Postgres advisory lock (`pg_try_advisory_lock`) | Not needed at v0.4a — single-instance local runtime. Re-evaluate at v0.5 cloud |
| Workflow engine | `temporalio` (declared but UNUSED in code) | N/A — no equivalent declared |
| Threshold-based trigger | Inline in agent loop (Q5 will detail) | `ThresholdReflectionPolicy.shouldReflect()` hooked into `remember()` write path |

**EC-3 absorption status:** ✓ Exactly 3 npm candidates evaluated (`bullmq` REJECT / `node-cron` DEFER / `croner` ADOPT) + in-process `setTimeout` ADOPT for `ThresholdReflectionPolicy` = 4 verdicts total. `agenda`/`bree` deferred to F-q2-agenda-bree-followup. Rule 9 satisfied (≥ 2 candidates compared per anti-pattern #12).

---

## Coverage Corner 3 — Tools

### Letta sleep-time worker shipping shape

Letta's shipping has TWO orthogonal axes that need to be answered separately. EC-5 absorption: classification expanded beyond the original boolean.

#### Axis 1 — Process boundary (EC-5 4-way): **EMBEDDED**

Sleep-time work runs in the SAME Python process as Letta's FastAPI server, on the SAME asyncio event loop. Evidence:

| Signal | Citation | Implication |
|---|---|---|
| `SleeptimeMultiAgentV4(LettaAgentV3)` class | `.claude/knowledge-base/references/letta/letta/groups/sleeptime_multi_agent_v4.py:24` | Subclass, NOT a separate process. Inherits agent behavior. |
| `step()` orchestration | `.claude/knowledge-base/references/letta/letta/groups/sleeptime_multi_agent_v4.py:43-80` | Same coroutine: `super().step(...)` first (main agent), THEN `await self.run_sleeptime_agents(billing_context=billing_context)` (line 80) — reflection happens AFTER each step, in-line, same `async` context. |
| Factory dispatch via `match`-statement | `.claude/knowledge-base/references/letta/letta/groups/helpers.py:28-86` | `load_multi_agent()` returns Python class instances — `RoundRobinMultiAgent` / `DynamicMultiAgent` / `SupervisorMultiAgent` / `SleeptimeMultiAgent` — NO process spawning, NO subprocess.Popen, NO multiprocessing module |
| NO `if __name__ == '__main__'` | confirmed via `grep -ln "if __name__ == .__main__." .claude/knowledge-base/references/letta/letta/groups/helpers.py .claude/knowledge-base/references/letta/letta/groups/sleeptime_multi_agent_v4.py` (zero hits) | Library modules, no standalone entrypoint |
| Single CLI entrypoint | `.claude/knowledge-base/references/letta/pyproject.toml [project.scripts]: letta = "letta.main:app"` | One command launches everything — server + scheduler + sleep-time agents |
| `apscheduler` in same process | `.claude/knowledge-base/references/letta/letta/jobs/scheduler.py:5,16` (from Q2) | `AsyncIOScheduler` is module-level singleton, runs ON the FastAPI event loop |

**No `subprocess`. No worker container. No `library-only` (`helpers.py` IS the runtime).** The 4-way verdict is unambiguously **EMBEDDED**.

#### Axis 2 — Deployment shape: **CONTAINER-FIRST** (orthogonal to Axis 1)

Letta ships as a multi-container Docker stack. Evidence:

| Artifact | Citation | Purpose |
|---|---|---|
| `.claude/knowledge-base/references/letta/Dockerfile` (head 30 LoC inspected) | `FROM pgvector/pgvector:0.8.1-pg15 AS builder` (line 1) | Builder image based on pgvector — extends the DB base with Python runtime |
| `.claude/knowledge-base/references/letta/compose.yaml` (head 50 LoC inspected) | 2 services: `letta_db` (`ankane/pgvector:v0.5.1`) + `letta_server` (`letta/letta:latest`) | Production stack — Postgres + server, no Redis, no worker |
| `.claude/knowledge-base/references/letta/dev-compose.yaml` + `development.compose.yml` | Top-level listing | Two distinct dev variants — implies active local-dev investment |
| `.claude/knowledge-base/references/letta/docker-compose-vllm.yaml` | Top-level listing | Optional vLLM provider variant |
| `.claude/knowledge-base/references/letta/scripts/docker-compose.yml` | Top-level listing | Script-driven variant |
| `.claude/knowledge-base/references/letta/alembic` + `alembic.ini` + `init.sql` | Top-level listing | DB migration toolchain integrated into the boot path |
| `.claude/knowledge-base/references/letta/otel/` + `nginx.conf` | Top-level listing | Observability + reverse-proxy infra co-located |
| Healthcheck on `letta_db` | `.claude/knowledge-base/references/letta/compose.yaml:18-21` | `pg_isready -U letta`, 5s interval — server `depends_on letta_db: condition: service_healthy` (line 24) |

**Local dev story**: `docker compose up` boots Postgres+Letta. NO Redis service. NO worker service. NO daemon split. The sleep-time machinery is INSIDE `letta_server`.

#### Cross-cutting synthesis for TheMemory v0.4a

| Letta dimension | TheMemory v0.4a applicability |
|---|---|
| Process boundary: EMBEDDED | **ADOPT** — `SleepTimeReflectionPolicy` runs in the same Node process as `Memory`. Matches Q2's verdict (`croner` in-process, no Redis/BullMQ). |
| Deployment shape: CONTAINER-FIRST | **PARTIAL ADOPT** — v0.1 already ships `docker-compose.yaml` for pgvector (per v0.1 plan). v0.4a extends WITHOUT adding new containers (no Redis, no worker). |
| Multiple compose variants (dev / prod / vllm) | **DEFER** — v0.4a doesn't need this complexity. One `docker-compose.yaml` continues to suffice. |
| Migration toolchain (`alembic` + `init.sql`) | **N/A direct** — TheMemory uses `drizzle-kit push` (per v0.1 blueprint); v0.4a will add schema migrations for `derived_from` + `llm_importance_score` columns per ADRs D4+D5 |
| `apscheduler` AsyncIOScheduler in-process | **REPLACED BY `croner`** in Node per Q2 Rule 9 ADOPT verdict |
| Single CLI entrypoint (`letta = letta.main:app`) | TheMemory has no daemon CLI — it's a library consumed via Node `import`. Reflection trigger is event-driven via `remember()` (threshold) or `croner` schedule (sleep-time), no separate daemon process |

**Local dev impact verdict for v0.4a: ZERO new container required.** The single addition is a `croner` npm dep + a `SleepTimeReflectionPolicy` class. TheMemory's existing pgvector container suffices.

**EC-5 absorption status:** ✓ 4-way classification answered as EMBEDDED (Axis 1) + CONTAINER-FIRST (Axis 2 orthogonal). `library-only` was correctly considered but rejected — `helpers.py` IS production runtime, not pure library facade.

---

## Coverage Corner 4 — Techniques

### Letta Summarizer Algorithms (5 modules)

Letta ships **TWO generations of summarization** that coexist in the codebase, and they're not equivalent. v0.4a's `/to-plan` should not confuse them.

#### Generation A — "compact" pipeline (modern, used by letta_agent_v3)

The orchestrator is `compact_messages()` in `.claude/knowledge-base/references/letta/letta/services/summarizer/compact.py:134-472`. It dispatches by `summarizer_config.mode` to one of FOUR modes, with a fallback chain on exception.

| Mode | Function (file:line) | Algorithm | Trigger / Input | Output | Provenance field? |
|---|---|---|---|---|---|
| `all` | `.claude/knowledge-base/references/letta/letta/services/summarizer/summarizer_all.py:17-86` | Single LLM call summarizes ENTIRE conversation history (excludes `messages[0]` system + last/approval). Uses external summarizer LLM via `simple_summary()` (`summarizer.py:487`). | Context-window threshold (`thresholds.py:27-41`): `context_window × 0.9` for GPT-5 family, `× 1.0` for others. Input = `List[Message]` in-context. | `(summary_str, [system_msg, *protected_messages])` — clip at `clip_chars=50000` default (`summarizer_config.py:73`). Caller wraps in `Message(role=summary)` (`compact.py:437`). | **NO** — no `derived_from`-equivalent field. Provenance is positional (summary replaces messages 1..N at the same list index). |
| `sliding_window` (default per `summarizer_config.py:77`) | `.claude/knowledge-base/references/letta/letta/services/summarizer/summarizer_sliding_window.py:99-232` | Token-budget eviction. Algorithm (lines 144-194): start `eviction_percentage = sliding_window_percentage` (default 0.30); increment by 10% per loop; find first `assistant_message_index` whose post-summarize token count ≤ `goal_tokens = (1 - sliding_window_percentage) × context_window`. | Same context-window threshold as `all`. Plus token budget knob `sliding_window_percentage` (default in `summarizer_settings.partial_evict_summarizer_percentage` per `summarizer_config.py:80`). | `(summary_str, [system_prompt, *messages[assistant_message_index:]])` — keeps tail messages verbatim, replaces head with summary. | **NO** — same positional model. |
| `self_compact_all` | `.claude/knowledge-base/references/letta/letta/services/summarizer/self_summarizer.py:23-150` | "Claude Code-style" — agent uses its OWN LLM (NOT external summarizer LLM) to self-summarize. Adds summary-request as user message to existing context (`self_summarizer.py:61-65`); calls agent's `llm_client` (line 124). | Same context-window threshold. Mode is chosen by caller config. | `(summary_text, [system_message, *protected_messages])` — same shape, different LLM provider. | **NO** — same. |
| `self_compact_sliding_window` | `.claude/knowledge-base/references/letta/letta/services/summarizer/self_summarizer.py:153-262` | Sliding-window cutoff logic (same as Generation A's `sliding_window`) but delegates the actual LLM call to `self_summarize_all()` (line 244) using agent's LLM. | Token budget + agent LLM. | Same shape. | **NO** — same. |

**Fallback chain** (`compact.py:189-348`): `self_compact_all` → `self_compact_sliding_window` → `all`; `self_compact_sliding_window` → `all`; `sliding_window` → `all`. Plus post-compaction token-threshold check (`compact.py:360-381`): if `trigger_threshold` provided and post-compaction context still ≥ threshold, retry in `all` mode. Aggressive fail-safe — five attempts before giving up.

**Output type — `CompactResult`** (`compact.py:33-39`):

```python
@dataclass
class CompactResult:
    summary_message: Message              # role=MessageRole.summary, NEW message
    compacted_messages: list[Message]     # [system] + [summary] + tail
    summary_text: str                     # raw text
    context_token_estimate: Optional[int]
```

No field links to source `Message.id`s. **The "higher-order memory" IS the `summary_message` (role=summary).** Letta's notion of consolidation is REPLACEMENT (compaction): the summary replaces the evicted messages in the context window. Original messages still exist in DB (per `Message.create_many_messages_async` writes) but no relational link from the summary to them.

#### Generation B — "Summarizer class" pipeline (legacy, used by voice + ephemeral summary agents)

The orchestrator is `Summarizer` in `.claude/knowledge-base/references/letta/letta/services/summarizer/summarizer.py:36-343` — the file explicitly marks it `# NOTE: legacy, new version is functional` at line 35.

| Mode | Function (file:line) | Algorithm | Trigger / Input | Output | Provenance field? |
|---|---|---|---|---|---|
| `STATIC_MESSAGE_BUFFER` | `.claude/knowledge-base/references/letta/letta/services/summarizer/summarizer.py:244-343` | Fixed buffer trim. If `len(messages) > message_buffer_limit` (default 10), trim to `message_buffer_min` (default 3) preserving user-message boundaries. Fire-and-forget summarization of EVICTED messages via `summarizer_agent.step()` (line 339-341) — async background task, summary NOT injected into context. | Trigger: `len(all_in_context_messages) > self.message_buffer_limit` (line 277). Force flag bypasses. | `Tuple[List[Message], bool]` — updated messages + `was_summarized` boolean. Boolean is the trigger signal seen in unit tests (`test_static_buffer_summarize.py:43,57`). | **NO** — async fire-and-forget loses linkage. |
| `PARTIAL_EVICT_MESSAGE_BUFFER` | `.claude/knowledge-base/references/letta/letta/services/summarizer/summarizer.py:136-242` | MemGPT-style recursive summary at index 1. Evict `partial_evict_summarizer_percentage` of messages (default 0.30); replace `messages[1]` with summary; remaining tail stays verbatim. Synchronous (awaits `simple_summary`). | Force flag only — `if not force: return all_in_context_messages, False` (line 156-158). | Same tuple shape. Summary persisted to DB via `message_manager.create_many_messages_async` (line 234-239). | **NO** — same positional model. |

#### Helper modules

- `thresholds.py` (42 LoC): `get_compaction_trigger_threshold(llm_config, force_proactive=False) -> int` returns `int(llm_config.context_window × SUMMARIZATION_TRIGGER_MULTIPLIER)`. GPT-5 family at 90%; others at 100%. **Per-model adaptive trigger** — not a fixed count.
- `summarizer_config.py` (90 LoC): `CompactionSettings` pydantic model — `mode`, `model` (handle override), `prompt`, `clip_chars`, `sliding_window_percentage`. Provider-specific defaults: `anthropic=claude-haiku-4-5`, `openai=gpt-5-mini`, `google_ai=gemini-2.5-flash` (lines 27-30).
- `summarizer_all.py` (87 LoC): Mode "all" thin wrapper around `simple_summary()`.

#### Cross-cutting findings for TheMemory v0.4a

| Letta dimension | TheMemory v0.4a applicability |
|---|---|
| Algorithm via `simple_summary` with FOUR fallbacks (`summarizer.py:562-647`) — clamp tool returns → middle-truncate bytes → provider fallback (Anthropic→Bedrock, ZAI→Baseten) | **PARTIAL ADOPT** — TheMemory v0.4a doesn't have provider fallback (no Bedrock client); but ADOPT the principle of try/fallback chain inside reflection (LLM-error resilience). Hand-rolled byte-budget truncation pattern is reusable for prompt construction. |
| Sliding-window with iterative eviction (`summarizer_sliding_window.py:163-194`) | **REJECT for default** — TheMemory's `reflect()` is NOT a context-trim operation; it CREATES higher-order memories without REPLACING source memories (ADD-only per ADR-0003). The sliding-window pattern fits chat-context compaction, NOT v0.4a's reflection. **Document the distinction explicitly.** |
| `self_compact` (agent uses its own LLM) | **REJECT** — TheMemory has no "agent" concept; reflection runs on TheMemory's configured LLM DIP directly. Self-compact requires the consumer to OWN a primary LLM, which is an agent-loop coupling we explicitly avoid (CLAUDE.md Cross-Project Rule 6 exception — TheoKit binding is the only deliberate coupling). |
| Per-model trigger threshold proportional to `context_window` (`thresholds.py:41`) | **DEFER** — v0.4a's `ThresholdReflectionPolicy` uses a NEW-MEMORY-COUNT threshold (per CLAUDE.md Item 5 acceptance "when threshold of N new memories crossed"), NOT a context-token threshold. Reconsider an additive token-aware policy at v1.x if usage signals demand it. |
| Output `(summary, was_summarized: bool)` boolean signal (`summarizer.py:343`, `test_static_buffer_summarize.py:43`) | **ADOPT** — `ReflectionPolicy.shouldReflect()` already returns `Promise<boolean>` per ADR-0005. Letta's pattern validates this DIP shape. |
| **NO `derived_from`-equivalent provenance field in ANY of the 5 modes** | **TheMemory v0.4a is the FIRST in this design space to require it.** ADR D4 of the discovery plan is unprecedented; the blueprint synthesis section should call this out as a TheMemory innovation, NOT a borrowed pattern. |
| Fire-and-forget background task (`summarizer.py:124-134,339`) via `safe_create_task` | **ADOPT** — `ThresholdReflectionPolicy` can use `queueMicrotask()` / `setTimeout(0)` to defer reflection to next tick, NOT block the `remember()` write path. |
| MessageRole.summary type (`compact.py:437`) | **N/A** — TheMemory doesn't have message roles. Higher-order memory is the same `Memory` shape with `derived_from: string[]` populated. |

#### Recommendation for `/to-plan v0-4a-reflection-pipeline`

The borrowed pattern is THIN. Letta's machinery is conversation-CONTEXT compaction (replace messages with summary in the in-context list); TheMemory's `reflect()` is conversation-MEMORY consolidation (create new higher-order Memory rows linking source memories via `derived_from`). Mode `all` (single LLM call summarizing N messages) is the closest mapping: TheMemory's `reflect()` calls the LLM once with N source memories, returns a higher-order Memory carrying `derived_from = [m1.id, m2.id, ...]`.

DO NOT borrow Letta's sliding-window algorithm — it's for context compaction, which TheMemory doesn't need (we don't manage chat context; consumers do that). DO NOT borrow `self_compact` — it requires agent-loop ownership.

DO borrow: (a) fallback chain pattern for LLM-error resilience, (b) fire-and-forget async pattern, (c) boolean trigger signal contract.

### Letta Sleep-time Trigger Mechanism (v1 vs v4 delta)

**Key conceptual finding:** Letta's "sleep-time" is composed of TWO orthogonal layers — a **TRIGGER policy** (counter-modular) and a **WORKER AGENT** (the LLM thing that processes the memory). The two are decoupled, which validates ADR-0005's separation of `ReflectionPolicy` (when to fire) from the reflection execution path.

#### The trigger is COUNTER-MODULAR — same in v1 and v4

Both `sleeptime_multi_agent.py` (v1) and `sleeptime_multi_agent_v4.py` (v4) implement the SAME trigger logic. Cited verbatim:

**v1** (`.claude/knowledge-base/references/letta/letta/groups/sleeptime_multi_agent.py:233-241`):
```python
# Update turns counter
turns_counter = None
if self.sleeptime_agent_frequency is not None and self.sleeptime_agent_frequency > 0:
    turns_counter = self.group_manager.bump_turns_counter(group_id=self.group_id, actor=self.user)

# Perform participant steps
if self.sleeptime_agent_frequency is None or (
    turns_counter is not None and turns_counter % self.sleeptime_agent_frequency == 0
):
```

**v4** (`.claude/knowledge-base/references/letta/letta/groups/sleeptime_multi_agent_v4.py:138-146`):
```python
# Update turns counter
turns_counter = None
if self.group.sleeptime_agent_frequency is not None and self.group.sleeptime_agent_frequency > 0:
    turns_counter = await self.group_manager.bump_turns_counter_async(group_id=self.group.id, actor=self.actor)

# Perform participant steps
if self.group.sleeptime_agent_frequency is None or (
    turns_counter is not None and turns_counter % self.group.sleeptime_agent_frequency == 0
):
```

Identical algorithm. `turns_counter` increments on every foreground step; sleep-time fires when `turns_counter % sleeptime_agent_frequency == 0`. When `frequency is None`, fires every step. Counter is DB-backed via `group_manager` (persisted, survives restarts).

**This maps DIRECTLY to TheMemory v0.4a `ThresholdReflectionPolicy.shouldReflect()`:** each `remember()` call increments a per-scope counter; when counter mod `threshold` == 0, return `true`. Counter persistence path: store on the scope row in pgvector schema (new column `pending_reflection_count` or similar).

#### v1 → v4 delta (concurrency model + streaming + prompt)

| Dimension | v1 (`sleeptime_multi_agent.py`) | v4 (`sleeptime_multi_agent_v4.py`) | Delta + TheMemory implication |
|---|---|---|---|
| Class hierarchy | `SleeptimeMultiAgent(BaseAgent)` (`sleeptime_multi_agent.py:24`) — composes `LettaAgent` instances inside `step()` (line 216) | `SleeptimeMultiAgentV4(LettaAgentV3)` (`sleeptime_multi_agent_v4.py:24`) — IS a `LettaAgentV3` itself | v4 collapses the multi-agent wrapper into a subclass. Less indirection. **TheMemory has no agent abstraction; the equivalent is `ReflectionPolicy` as a plain DIP — already simpler than either v1 or v4.** EC-7: BaseAgent + LettaAgent + LettaAgentV3 imports cited but NOT followed; abstracted as `BaseAgent.run_step`-equivalent per plan. |
| `step()` sync/async | `def step(...)` SYNC (`sleeptime_multi_agent.py:192`) | `async def step(...)` (`sleeptime_multi_agent_v4.py:44`) | v4 fully async. **TheMemory is already async (Node Promises) — alinhado com v4.** |
| Background concurrency | `_run_async_in_new_thread(coro)` — `threading.Thread + asyncio.new_event_loop()` (`sleeptime_multi_agent.py:48-62`) | `safe_create_task(coro, label=...)` — asyncio Task in SAME event loop (`sleeptime_multi_agent_v4.py:188`) | v4 dropped threads entirely. Single event loop. Simpler error/cancel propagation. **TheMemory: Node single-thread event loop matches v4 model. ADOPT `queueMicrotask` / `Promise.resolve().then()` pattern for fire-and-forget. REJECT v1 thread pattern (Node has no need; would actually require `worker_threads` which adds complexity).** |
| Streaming support | NOT supported — `step_stream()` raises `NotImplementedError` (`sleeptime_multi_agent.py:291`) | Implemented + `finally:` block ensures sleep-time fires even on `GeneratorExit` (`sleeptime_multi_agent_v4.py:126-129`) | v4 enables streaming + handles ungraceful generator close. **TheMemory v0.4a doesn't stream; N/A. Consider if v1.x adds streaming reflect.** |
| Sleep-time prompt | NOT explicit in v1; relies on agent's memory_persona block | EXPLICIT system-reminder prompt prepended to source messages (`sleeptime_multi_agent_v4.py:233-244`) — "You are a sleeptime agent — a background agent that asynchronously processes conversations after they occur..." + "Your primary role is memory management. Review the conversation and use your memory tools to update any relevant memory blocks with information worth preserving." | **ADOPT prompt-prepending pattern for TheMemory's reflection LLM call.** The explicit "you are reviewing a conversation that already happened" prompt locks the LLM into the right cognitive mode. Useful prompt-engineering precedent. |
| Run status enum | `JobStatus` (`created`, `running`, `completed`, `failed`) | `RunStatus` (same shape, renamed schema) | Semantics same. **TheMemory's `ReflectionResult` can carry an analogous `status` field if we expose async reflect.** |
| Provenance | NO `derived_from` tracking | NO `derived_from` tracking | NEITHER tracks source-message-IDs in the higher-order memory. **TheMemory's `derived_from: string[]` is INNOVATION beyond Letta v1 AND v4 precedent.** |
| Prior-message lookup | `list_messages_for_agent(after=last_processed_message_id, before=messages[0].id)` (`sleeptime_multi_agent.py:128-133`) | `list_messages(after=..., before=...)` async variant (`sleeptime_multi_agent_v4.py:220-225`) | Same query semantics. **TheMemory equivalent: scope-bound query for memories added since `last_processed_memory_id` — natural fit with v0.1's `recall()` API.** |

#### Worker agent variants (not triggers; orthogonal layer)

`voice_sleeptime_agent.py` (193 LoC) and `ephemeral_summary_agent.py` (114 LoC) are WORKER agents, NOT triggers. Documented for completeness:

| File | Role | Key insight |
|---|---|---|
| `.claude/knowledge-base/references/letta/letta/agents/voice_sleeptime_agent.py` | `VoiceSleeptimeAgent(LettaAgent)` — voice-specific worker. Composes the LEGACY `Summarizer` class (`voice_sleeptime_agent.py:60-65`) with `STATIC_MESSAGE_BUFFER` mode, limit=20, min=10. Tool rules for `store_memories` / `rethink_user_memory` / `finish_rethinking_memory` (`voice_sleeptime_agent.py:86-91`). | Uses Generation B legacy `Summarizer` (Q4 finding) for in-step summarization, NOT the modern `compact_messages`. Mixed-generation usage WITHIN the codebase confirms migration is incomplete. |
| `.claude/knowledge-base/references/letta/letta/agents/ephemeral_summary_agent.py` | `EphemeralSummaryAgent(BaseAgent)` — stateless block-summarizer using caller's LLM. Appends `--- Previous Summary ---` for recursive summarization (`ephemeral_summary_agent.py:65-67`). | Recursive summarization pattern: prior summary becomes context for next summary. **Potential TheMemory pattern: when reflecting over already-reflected memories, include prior reflection's text as context.** But ADD-only invariant (ADR-0003) means we don't replace the prior reflection — we just add a new higher-order memory with `derived_from = [prior_reflection_id, ...]`. |

#### Cross-cutting recommendation for `/to-plan v0-4a-reflection-pipeline`

| Letta dimension | TheMemory v0.4a |
|---|---|
| Counter-modular trigger (`counter % freq == 0`) | **ADOPT** — `ThresholdReflectionPolicy({ threshold: N }).shouldReflect()` returns `count % N === 0`. Counter persisted on scope row in pgvector schema. |
| DB-backed counter (`group_manager.bump_turns_counter_async`) | **ADOPT** — counter on scope, NOT process-local memory. Survives restarts. Critical for sleep-time policy too. |
| Same-event-loop async task (v4 `safe_create_task`) | **ADOPT for `ThresholdReflectionPolicy`** — `queueMicrotask(() => reflect(...))` or `Promise.resolve().then(...)`. NO Node `worker_threads`. |
| Explicit "sleeptime-agent" prompt-prepending | **ADOPT** — prefix the reflection LLM prompt with "You are reviewing memories that already happened. Your role is consolidation — produce a higher-order memory that captures the cross-memory insights, with provenance." |
| Multi-thread v1 model | **REJECT** — Node single-thread suffices; matches v4 model. |
| Worker-agent abstraction (Voice / Ephemeral) | **REJECT** — TheMemory has no agent abstraction; reflection runs on configured `LLM` DIP directly. |

**EC-7 absorption status:** ✓ All imports from out-of-scope modules (`letta.agents.base_agent`, `letta_agent`, `letta_agent_v3`, `agent_loop`) cited but NOT followed. Annotated as `BaseAgent.run_step`-equivalent abstractions for TheMemory mapping. Scope-creep into Letta's agent runtime explicitly avoided.

### Mem0 Write-time Consolidation (negative-space contrast)

#### Negative-space confirmation (EC-11 absorption — re-run grep at halt-loop time)

Re-executed at iteration 6 (defense vs file-tree drift):

```bash
grep -rln "def reflect\|importance_score\|consolidat\|class.*Reflect\|generate_summary" .claude/knowledge-base/references/mem0 --include="*.py"
# (zero hits)
```

**Cross-confirmed by Mem0's own AGENTS.md** (`.claude/knowledge-base/references/mem0/CLAUDE.md`, system-reminded to the halt-loop iteration): public Memory API lists `add` / `search` / `get` / `get_all` / `update` / `delete` / `delete_all` / `history` — **NO `reflect`, NO `consolidate`, NO `summarize`.** The negative-space conclusion is locked from TWO independent sources (code grep + project AGENTS.md).

#### Where the consolidation lives — write-time, LLM-arbitrated

Mem0 has **NO async reflection layer**. Consolidation (in the loose sense of "decide what to remember") happens INSIDE the write pipeline, gated by the LLM extraction step.

The 8-phase pipeline in `.claude/knowledge-base/references/mem0/mem0/memory/main.py:_add_to_vector_store` (`main.py:662-961`, anchored via EC-8 class-boundary scope to `class Memory:` line 331-1793, sync variant — `class AsyncMemory` at line 1795+ is the async mirror, intentionally out of Q6's target per EC-8):

| Phase | Lines | Behavior | "Consolidation" signal |
|---|---|---|---|
| 0 — Context gather | `main.py:701-704` | `db.get_last_messages(session_scope, limit=10)` + `parse_messages(messages)` | Last 10 session messages added as LLM context |
| 1 — Existing memory retrieval | `main.py:706-721` | `vector_store.search(query=parsed_messages, top_k=10, filters)` — fetches up to 10 semantically-similar existing memories | **UUID → integer mapping (`uuid_mapping[str(idx)] = mem.id`)** is the "anti-hallucination" trick (`main.py:717-721`) — LLM sees "0", "1", "2" not raw UUIDs |
| 2 — LLM extraction | `main.py:723-748` | Single LLM call with `ADDITIVE_EXTRACTION_PROMPT` (+ `AGENT_CONTEXT_SUFFIX` if agent-scoped) | `response_format={"type": "json_object"}` — LLM returns `{"memory": [{"text": "...", ...}, ...]}` |
| 3 — Batch embed | `main.py:770-783` | `embedding_model.embed_batch(mem_texts, "add")` with per-text fallback | Batch + fallback for resilience |
| 4-5 — Hash dedup | `main.py:786-822` | `hashlib.md5(text.encode()).hexdigest()` checked against `existing_hashes` (from search results' payload.hash) + `seen_hashes` (current batch) | **EXACT-text dedup only — semantic dedup relies on LLM's Phase 2 judgment** |
| 6 — Batch persist | `main.py:824-841` | `vector_store.insert(...)` with per-id fallback | |
| 6.5 — Batch history | `main.py:843-863` | `db.batch_add_history(history_records)` — events are `"ADD"`, `old_memory: None` | **History is temporal audit trail, NOT relational provenance** (key field shape: `memory_id`, `old_memory`, `new_memory`, `event`, `created_at`, `is_deleted`) — there is NO `source_memory_ids: string[]` field |
| 7 — Batch entity linking | `main.py:865-955` | `extract_entities_batch(all_texts)` → global dedup → batch insert/update entity_store. Score ≥ 0.95 = update existing entity's `linked_memory_ids` (`main.py:918-932`) | **Provenance lives at the ENTITY level**: each entity record carries `linked_memory_ids: [memory_id, ...]` — links go entity→memories, NOT memory→source-memories |
| 8 — Save messages + return | `main.py:957-961` | `db.save_messages(messages, session_scope)` | Returns `{id, memory, event: "ADD"}` per record |

#### `_update_memory` is NOT reflection — it's external update API

`.claude/knowledge-base/references/mem0/mem0/memory/main.py:1657-1720` — `_update_memory(memory_id, data, ...)`:

- Looks up existing memory by ID (`main.py:1661`)
- Re-embeds new data + updates vector_store row in-place (`main.py:1694,1696-1700`)
- Preserves session identifiers (user_id, agent_id, run_id, actor_id, role) — `main.py:1680-1689`
- Adds history with `event: "UPDATE"` + `prev_value` (`main.py:1703-1712`)
- Re-extracts + relinks entities (`main.py:1717-1718`)
- Returns the SAME `memory_id` — no new memory created; no derived_from; no link to a source

This is a **public API for caller-driven updates** (e.g., user explicitly invokes `update(memory_id, ...)`), NOT an internal consolidation mechanism.

#### `_create_procedural_memory` — closest thing to reflection, still NOT it

`.claude/knowledge-base/references/mem0/mem0/memory/main.py:1618-1655`:

- LLM prompt: `PROCEDURAL_MEMORY_SYSTEM_PROMPT` + messages + literal `"Create procedural memory of the above conversation."` (`main.py:1633-1635`)
- Single LLM generates a procedural-memory text
- Embed + insert via `_create_memory` (`main.py:1649-1650`)
- Marks `metadata.memory_type = MemoryType.PROCEDURAL`
- **Returns ONE memory; NO `derived_from` field linking to source messages** (`main.py:1653`)

Closer to compaction-as-creation than to relational consolidation. The procedural memory is a NEW row but with no relational link back to the source messages OR existing memories that informed it. The link is implicit (timing + content overlap).

#### Mem0's design intent (synthesized — positioning paragraph)

Mem0's design **OUTSOURCES async reflection to consumers**, NOT by accident but by architecture:

1. The write pipeline ALREADY does LLM-arbitrated extraction (Phase 2) that semantically dedups against existing memories. A caller who frequently invokes `add()` IS doing incremental consolidation — Phase 2 chooses what new memories to materialize.
2. The hash-based exact dedup (Phase 4-5) is a backstop, not the consolidation mechanism.
3. There's no need for an additional "reflect" pass because the LLM-extraction step already considers existing memories.

This is HONEST architecture, NOT a gap to fill. Mem0's positioning is: "the LLM judgment in Phase 2 IS the consolidation; you don't need to schedule a second pass." Their model favors **bounded write-time cost** over **periodic deeper consolidation**.

#### Why TheMemory v0.4a chooses differently

The blueprint's recommended TheMemory model DIVERGES from Mem0 deliberately:

| Dimension | Mem0 | TheMemory v0.4a |
|---|---|---|
| Consolidation timing | Write-time (Phase 2 LLM extraction) | **Both** — write-time (LLM-importance per ADR D5) + async (`reflect()` per ADR-0005) |
| Consolidation arbiter | LLM judges what new memories to extract given existing ones | Same Phase 2 pattern (inherited from v0.1) + scoring strategy (per ADR D3) + reflection policy (per ADR-0005) |
| Provenance | Entity-level `linked_memory_ids` on entity_store rows | **Memory-level `derived_from: string[]` on higher-order memory rows** (ADR D4) — directional relationship NOT mediated by entities |
| Higher-order memory | Implicit via repeated `add()` calls | Explicit via `reflect()` producing memories with `kind: 'derived'` |
| async layer | **NOT shipped** — outsourced to consumers | **Shipped** — `SleepTimeReflectionPolicy` + `ThresholdReflectionPolicy` (per Q5 ADOPT verdicts) |

**Honest positioning vs Mem0:** TheMemory is NOT "better" at consolidation — it's DIFFERENT. Mem0 minimizes infra (one synchronous pipeline); TheMemory adds an OPT-IN async pipeline for consumers who want explicit higher-order memory formation with audit trail. Both are valid models.

#### Test-side negative-space confirmation

`.claude/knowledge-base/references/mem0/tests/memory/test_main.py` (665 LoC) — the test names confirm what's NOT under test:

| What's tested | Examples (file:line) |
|---|---|
| Timestamp metadata (`uses_utc_timestamps`) | `test_create_memory_uses_utc_timestamps` (`.claude/knowledge-base/references/mem0/tests/memory/test_main.py:240`); `test_create_memory_sets_updated_at` (`test_main.py:247`); `test_update_memory_uses_utc_timestamps` (`test_main.py:269`); `test_update_preserves_created_at_and_updates_updated_at` (`test_main.py:369`) |
| LLM extraction error paths | `test_empty_llm_response_fact_extraction` (`test_main.py:48`); `test_empty_llm_response_memory_actions` (`test_main.py:65`) |
| Metadata immutability | `TestMetadataNotMutated` class — 7 tests at `.claude/knowledge-base/references/mem0/tests/memory/test_main.py:425-540` |
| Prompt override behavior | `test_prompt_overrides_custom_instructions` (`test_main.py:93`); `test_falls_back_to_custom_instructions_when_no_prompt` (`test_main.py:106`) |
| Async update path | `TestAsyncUpdate` class — `test_main.py:118+` |
| Actor preservation across updates | `test_update_preserves_actor_id_when_different_actor_updates` (`test_main.py:620`) |

**What's NOT tested:**
- `test_reflect_*` — zero matches (consistent with no `reflect()` existing)
- `test_consolidate_*` — zero matches
- `test_derived_from*` — zero matches
- `test_higher_order_memory*` — zero matches
- `test_provenance_*` — zero matches

Mem0's test suite focuses on data-integrity invariants (timestamps, metadata, actor preservation) and LLM-error robustness. Absence of consolidation/reflection tests confirms it's not in the public contract.

**EC-1 / EC-8 / EC-11 absorption status:** ✓ All three checkpoints honored — `main.py` read via offset strategy (3 reads at lines 662/1586/1657, ≤300 lines each); grep anchored to `class Memory:` boundary (line 331-1793 scope); re-run "no reflect" grep at halt-loop time confirmed zero hits.

---

## Coverage Corner 5 — Prior Art

> Per cycle-discover.md v1.1 § Coverage Matrix 5th corner. Two web-sourced questions (allowlist domains: `arxiv.org`, `langchain.com`, fallback `github.com`); each citation paired with a snapshot under `.claude/knowledge-base/discoveries/snapshots/v0-4a-reflection-pipeline/{sha256}.md`.

### Generative Agents 2023 (Park et al., arXiv 2304.03442)

#### CRITICAL FINDING — CLAUDE.md "multiplicative Generative Agents" claim is WRONG

**Honest correction surfaced by this Q7 investigation** (Inquebrável Rule 3):

The paper's reference implementation at [github.com/joonspk-research/generative_agents/blob/main/reverie/backend_server/persona/cognitive_modules/retrieve.py](https://github.com/joonspk-research/generative_agents/blob/main/reverie/backend_server/persona/cognitive_modules/retrieve.py) ([snapshot](../snapshots/v0-4a-reflection-pipeline/67f8665b0897f704c9d0e91f0f75d2b96f9818a1e12813c6744f7fe2179e6947.md)) ships an **ADDITIVE WEIGHTED SUM**, NOT a multiplicative formula:

```python
# retrieve.py:254-257 — VERBATIM
master_out[key] = (persona.scratch.recency_w*recency_out[key]*gw[0]
                 + persona.scratch.relevance_w*relevance_out[key]*gw[1]
                 + persona.scratch.importance_w*importance_out[key]*gw[2])
```

CLAUDE.md § Macro roadmap Item 5 acceptance criterion currently reads (verbatim):

> Both scoring strategies pass identical recall-shape contract test (interface compliance).

with the **interpretation** that one strategy is "additive Mem0" and the other is "multiplicative Generative Agents (recency × importance × relevance)". The "multiplicative" attribution to Generative Agents is **factually incorrect** — the reference implementation does additive weighted sum, same family as Mem0's additive scoring (which TheMemory v0.1 already ships).

This needs reconciliation. Three honest paths for `/to-plan v0-4a-reflection-pipeline`:

1. **Update CLAUDE.md Item 5 to remove "multiplicative" attribution.** The two scoring strategies become "Mem0-style additive (default, equal weights)" and "Generative-Agents-style additive (weighted [0.5, 3, 2] for recency/relevance/importance)". The interface-compliance contract test still holds (same input shape, different numerical output). Recommended.
2. **Keep CLAUDE.md "multiplicative" framing but BACK IT WITH A DIFFERENT PAPER.** A literature search would be needed to find a paper that actually ships `score = importance × recency × relevance`. None surfaced by Q7's WebSearch. Speculative; do NOT pursue without evidence.
3. **Drop the multiplicative strategy entirely from v0.4a.** Ship only one strategy (additive with configurable weights). Defer multiplicative to v0.5+ if a use case demands it. Cleanest.

**Surface this discrepancy to `/to-plan v0-4a-reflection-pipeline` explicitly as a OPEN-ADR.** Do NOT silently propagate the "multiplicative" framing into the implementation. This is exactly the kind of cheap-to-catch-now / expensive-to-catch-later finding that justifies running `/discover-execute`.

#### Verbatim formula (from snapshot)

The full retrieval scoring expressed in plain text per the [retrieve.py snapshot](../snapshots/v0-4a-reflection-pipeline/67f8665b0897f704c9d0e91f0f75d2b96f9818a1e12813c6744f7fe2179e6947.md):

```
score(memory, query, now) =
    recency_w  × normalize(recency_decay^age)                × 0.5
  + relevance_w × normalize(cosine_similarity(query, memory)) × 3.0
  + importance_w × normalize(llm_importance_score)            × 2.0
```

Where:

- `recency_w`, `relevance_w`, `importance_w` — **per-persona learnable weights** (configurable; defaults not visible in the snapshot)
- `gw = [0.5, 3, 2]` — **global fixed weights** scaling recency, relevance, importance respectively. **Relevance gets the highest weight (3.0)** in the experimental config; comments note these are experimental.
- Each component **min-max normalized to [0, 1]** BEFORE the weighted sum (`retrieve.py:226-240`):

  ```python
  recency_out = normalize_dict_floats(recency_out, 0, 1)
  importance_out = normalize_dict_floats(importance_out, 0, 1)
  relevance_out = normalize_dict_floats(relevance_out, 0, 1)
  ```

- **Recency decay** is exponential (`retrieve.py:189-191`):

  ```python
  recency_vals = [persona.scratch.recency_decay ** i
                  for i in range(1, len(nodes) + 1)]
  ```

  Where `recency_decay` is the per-persona decay factor; `i` is memory age (count-based, NOT wall-clock seconds — the paper uses 1-indexed retrieval order).

#### EC-9 absorption status — honest partial citation

**Q7 marked `partial` in progress JSON.** The arXiv abstract page ([snapshot](../snapshots/v0-4a-reflection-pipeline/e0fa7252df90bce4f4b33ea90c97bb7daf865310fc905016debd39358e4bb581.md)) does NOT contain the formula; PDF (https://arxiv.org/pdf/2304.03442) exceeded WebFetch's 10MB content limit; HTML5 alternative (https://arxiv.org/html/2304.03442) returned 404. Falling back to the reference implementation per EC-9's allowed alternative — github.com is allowlisted, source code is canonical.

**Caveats stated explicitly:**

1. The paper's § 4.1 ("Memory Stream") may differ from the implementation in details. The implementation is the ENFORCEABLE spec for "what Generative Agents actually does"; the paper text is the conceptual framing. The blueprint cites the IMPLEMENTATION.
2. The importance scoring **LLM prompt template** (Q7 sub-question 4) is in the codebase but at a different file path NOT fetched this iteration. Tracking as a F-followup if `/to-plan` needs the exact prompt verbatim; for now, the structural shape (importance is a 1-10 LLM-judged score per memory, computed at write time) is sufficient.

#### Recommendation for `/to-plan v0-4a-reflection-pipeline`

| Element | Verdict |
|---|---|
| Three-dimension model (recency / relevance / importance) | **ADOPT** — TheMemory v0.4a's `ScoringStrategy` DIP uses the same 3 dimensions per ADR D3 |
| Min-max normalization to [0,1] | **ADOPT** — same |
| Exponential recency decay | **ADOPT** — but use wall-clock seconds (not 1-indexed retrieval order — that's a paper-implementation idiosyncrasy; semantic time is better for our async-reflection use case) |
| Per-persona learnable weights | **DEFER to v1.x** — v0.4a ships fixed weights; learnable weights add training infrastructure complexity (Inquebrável § 11 YAGNI). |
| Global weights `[0.5, 3, 2]` | **EXPERIMENTAL — DO NOT HARDCODE** — surface as ADR for `/to-plan` to lock concrete values OR mark as ADR-deferred to F-followup |
| **"Multiplicative Generative Agents" framing** | **REJECT — factually wrong.** Surface to CLAUDE.md update per the "CRITICAL FINDING" section above. |

### LangMem BackgroundMemoryManager (langchain.com docs)

#### EC-10 fallback path triggered

WebSearch's FIRST 3 results did NOT match either checkpoint pattern (`<title>` containing "BackgroundMemoryManager" NOR URL containing `/langgraph/reference/memory/`). The third result (`docs.langchain.com/oss/python/langgraph/memory`) is a SUBDOMAIN of `langchain.com` — subdomains NOT auto-allowed per allowlist policy. Per EC-10 absorption: fallback to `github.com/langchain-ai/langmem/blob/main/...` (`github.com` is allowlisted; LangMem is MIT-licensed open source, so the GitHub source IS the canonical published API).

URL lock (per Q8 halt-loop checkpoint, written to progress JSON pre-snapshot):

1. PRIMARY: [`github.com/langchain-ai/langmem/blob/main/docs/docs/concepts/conceptual_guide.md`](https://github.com/langchain-ai/langmem/blob/main/docs/docs/concepts/conceptual_guide.md) ([snapshot](../snapshots/v0-4a-reflection-pipeline/0674a5b3bc80c1e11458ed89deb49519cf5e18190bb3e376f8fd4b825371c57a.md))
2. SECONDARY: [`github.com/langchain-ai/langmem/blob/main/README.md`](https://github.com/langchain-ai/langmem/blob/main/README.md) ([snapshot](../snapshots/v0-4a-reflection-pipeline/1655d9a97aa6069d2ac105c5fe2bffc5d971c1ef2e1bdd80fc105bd71938327c.md))

#### Verbatim findings from snapshots

**Background memory manager core pattern** (conceptual_guide.md, verbatim):

> "Subconscious" memory formation refers to the technique of prompting an LLM to reflect on a conversation after it occurs (or after it has been inactive for some period), finding patterns and extracting insights without slowing down the immediate interaction

**Public API surface (from README, verbatim):**

> "🧠 Memory management tools that agents can use to record and search information during active conversations 'in the hot path'"
> "⚙️ Background memory manager that automatically extracts, consolidates, and updates agent knowledge"
> "⚡ Native integration with LangGraph's Long-term Memory Store, available by default in all LangGraph Platform deployments"

**Memory Manager primitive operations** (conceptual_guide.md, verbatim sequence):

> "Extract new memories, update or remove outdated memories, and consolidate and generalize"

**Three reflection algorithms for procedural memory** (from WebSearch result, NOT direct WebFetch — surfaced as adjacent-source signal):

- `metaprompt` — reflection + additional "thinking" time to study conversations, then meta-prompt proposes the update
- `gradient` — explicitly divides work into separate steps of critique and prompt proposals to further simplify the task at each step
- `prompt_memory` — attempts to do the above in a single step

**CRITICAL — what's NOT in either snapshot:**

| Sub-question | Snapshot answer |
|---|---|
| Public class signature for `BackgroundMemoryManager` | NOT IN DOCS — both conceptual guide and README defer to "background quickstart" (not fetched this iteration; logged as F-followup if `/to-plan` needs the exact constructor signature) |
| Trigger configuration (threshold? interval? both?) | NOT IN DOCS at the conceptual layer — "after it occurs (or after it has been inactive for some period)" is the only timing spec |
| `derived_from` / provenance field | **EXPLICIT ABSENCE — confirmed in BOTH snapshots.** Neither doc mentions provenance tracking on consolidated memories. |
| Source memory IDs on consolidated outputs | NOT MENTIONED |

#### Cross-cutting design comparison (Q8's deliverable)

The blueprint's most important Q8 output — comparison matrix Letta-vs-Mem0-vs-LangMem-vs-TheMemory:

| Dimension | Letta (Q5) | Mem0 (Q6) | LangMem (Q8) | TheMemory v0.4a proposal |
|---|---|---|---|---|
| Reflection timing | Async post-step (counter-modular trigger) | Synchronous write-time (Phase 2 LLM extraction) | Async "subconscious" — after conversation ends OR after inactivity period | Both: write-time (LLM-importance per ADR D5) + async (`reflect()` per ADR-0005) |
| Trigger mechanism | `turns_counter % sleeptime_agent_frequency == 0` (DB-backed) | None separate — write IS the trigger | "After conversation" OR "after inactive period" — UNDERSPECIFIED in conceptual docs | Threshold N (ADR D3) + Sleep-time cron (Q2 ADOPT croner) |
| Primitive operations | Summarize (Generation A `all`/`sliding_window`; Generation B `STATIC_BUFFER`) | Extract (LLM-arbitrated) + Hash dedup + Entity linking | Extract + Update + Remove + Consolidate + Generalize (5 verbs) | Extract (inherited from v0.1) + `reflect()` (v0.4a) |
| Provenance shape | **NONE** — positional replacement | **NONE on memories** — only `linked_memory_ids` on entity_store rows | **NONE** — explicit absence in both LangMem snapshots | **`derived_from: string[]` on higher-order memory row (MANDATORY per ADR D4)** |
| Scoring | Token-count budget (sliding_window) OR none | Per-search ranking (semantic + BM25 + entity boost from v0.1) | Not in scope of background manager (separate retrieval concern) | Recency + relevance + importance per ADR D3 (additive — corrected by Q7) |
| Public API surface | Internal class hierarchy (out-of-scope follow per EC-7) | `add` / `search` / `get` / `update` / `delete` / `history` (NO `reflect`) | "Tools" + "Background memory manager" (signature NOT in conceptual docs) | `remember` / `recall` / `forget` / `reflect` (locked per ADR-0004) |
| LLM-importance caching | NOT mentioned | NOT in code (hash dedup only) | NOT mentioned in conceptual docs | **`llm_importance_score` cached on first write (ADR D5)** |
| License | Apache-2.0 | Apache-2.0 | MIT (per CLAUDE.md `.claude/knowledge-base/references/` table) | MIT (locked override per `theo-memory/CLAUDE.md`) |

#### TheMemory positioning observations (synthesized)

1. **LangMem and TheMemory share the "async background reflection" model** — both reject Mem0's "consolidation IS the write" stance. The design space alignment validates ADR-0005's `ReflectionPolicy` DIP.
2. **LangMem's 5 primitives (Extract / Update / Remove / Consolidate / Generalize)** are RICHER than TheMemory v0.4a's `remember/recall/forget/reflect` (4 verbs locked per ADR-0004). TheMemory's `reflect()` semantically maps to "Consolidate + Generalize" combined; "Extract" is part of `remember()`'s write pipeline (v0.1 Phase 2); "Update" + "Remove" map to `forget(id) + remember(newText)` (per ADR-0003 ADD-only).
3. **NEITHER Letta NOR Mem0 NOR LangMem ships `derived_from` provenance.** TheMemory v0.4a's ADR D4 (mandatory `derived_from: string[]`) is an **innovation across ALL THREE reference projects** investigated. This is the strongest positioning insight of the discovery cycle.
4. **LangMem's "after inactivity period" trigger** suggests a hybrid TheMemory `SleepTimeReflectionPolicy` could fire on EITHER cron interval (per Q2 croner ADOPT) OR inactivity (no `remember()` calls for N seconds). The latter requires watching the write timestamp; trivial to add as a second condition inside `shouldReflect()`. **Recommend ADOPT both triggers as opt-in** for `/to-plan v0-4a-reflection-pipeline`.
5. **LangMem's separation of "hot path" tools (synchronous, agent-callable) vs "background memory manager" (asynchronous, automated)** mirrors TheMemory's separation of `remember()`/`recall()`/`forget()` (hot path) vs `reflect()` (cold path). Strong design-space validation.

#### F-followup logged

- **F-langmem-quickstart-fetch** — if `/to-plan v0-4a-reflection-pipeline` needs the EXACT `BackgroundMemoryManager` constructor signature, fetch `github.com/langchain-ai/langmem/blob/main/docs/docs/quickstart_background.md` (or equivalent path; the conceptual guide explicitly references "the 'background' quickstart"). Not blocking for v0.4a blueprint; design-comparison sufficient.

**EC-10 absorption status:** ✓ Fallback path triggered honestly; primary + secondary GitHub snapshots written with verifiable hashes; conceptual guide explicit absence of `derived_from` mention cross-confirmed by README.

---

## Cross-cutting Comparison

A consolidated side-by-side view across the corners:

| Dimension | Letta | Mem0 | LangMem | TheMemory v0.4a proposal |
|---|---|---|---|---|
| Reflection model | Async sleep-time agent (counter-modular trigger) — separate worker layer | Synchronous write-time LLM-arbitrated extraction (Phase 2) — no separate reflection layer | Async "subconscious memory formation" — LLM reflection after conversation ends OR after inactivity period | **Both**: write-time (LLM-importance cache per ADR D5) + async (`reflect()` per ADR-0005) |
| Trigger mechanism | `turns_counter % sleeptime_agent_frequency == 0` (DB-backed; v1==v4 identical) | None separate — every `add()` IS the trigger | "After conversation" OR "after inactivity period" — UNDERSPECIFIED in conceptual docs | Counter-modular `ThresholdReflectionPolicy({ threshold: N })` + cron-based `SleepTimeReflectionPolicy` (croner ADOPT) + optional inactivity-period (LangMem-inspired) |
| Scoring strategy | Token-count budget (sliding_window) or none | Per-search ranking (semantic + BM25 + entity boost from v0.1 inheritance) | Not in scope of background manager | **ADDITIVE weighted sum** per ADR D3 — Q7 corrected the "multiplicative" framing; one strategy with configurable weights (default Mem0-style equal, opt-in Generative-Agents-style `[0.5, 3, 2]` for recency/relevance/importance) |
| Provenance shape | NONE — positional replacement | NONE on memories — entity_store has `linked_memory_ids` reverse pointers (entity→memories) | **NONE — explicit absence** in BOTH conceptual_guide.md AND README snapshots | **`derived_from: string[]` on higher-order memory row (MANDATORY per ADR D4)** — INNOVATION beyond ALL 3 reference projects |
| Higher-order memory shape | `MessageRole.summary` replacing evicted messages (compact mode) or fire-and-forget summary to a block (Generation B) | Implicit via repeated `add()`; `_create_procedural_memory` is closest analog (no provenance) | "Consolidate + Generalize" verbs — 2 of 5 primitives | New `Memory` row with `kind: 'derived'` + non-empty `derived_from` (ADR D4) |
| Local dev story | Container-first (Dockerfile + 4 compose variants); single Python process embedding scheduler + agents | n/a (library) | n/a (library) | Single Node process, single docker-compose pgvector container (inherited from v0.1); ZERO new containers per Q3 verdict |
| LLM-importance caching | NOT mentioned | NOT in code (hash dedup only at exact-text level) | NOT mentioned in conceptual docs | **`llm_importance_score` cached on first write (ADR D5)**; content-hash keyed; second-write same content does NOT re-invoke LLM |
| Process boundary (Q3) | EMBEDDED (Python in-process, same event loop in v4) | n/a (library) | n/a (library) | EMBEDDED (Node single event loop; `queueMicrotask`/`Promise.resolve().then(...)` for fire-and-forget) |
| Scheduler lib | `apscheduler>=3.11.0` (in-process). `temporalio>=1.8.0` DECLARED-BUT-UNUSED | n/a | n/a (orthogonal to LangMem core) | `croner` ADOPT for sleep-time; built-in `setTimeout` ADOPT for threshold (Q2 Rule 9) |
| Test discipline | Real server + threading + `time.sleep()` + polling + `@pytest.mark.flaky(max_runs=3)` (integration) + `AsyncMock(spec=BaseAgent)` (unit) | Pytest with `mocker` + timestamp/metadata assertions; NO reflect/consolidate tests | NOT inspected (would require quickstart fetch — F-langmem-quickstart-fetch) | vitest with config-knob threshold override (NO clock mocking) per EC-4 — Letta pattern transcribed verbatim |
| License | Apache-2.0 | Apache-2.0 | MIT (per CLAUDE.md `.claude/knowledge-base/references/` table) | MIT (locked override per `theo-memory/CLAUDE.md`) |

## ADRs

Decisions that emerged from the synthesis. Each carries alternatives + rationale + consequences. (Discovery-plan ADRs D1-D6 frame the investigation lens; blueprint ADRs D7..D12 below capture decisions that EMERGED from the evidence.)

### D7 — Sleep-time worker mechanism: in-process `croner` (sleep-time) + `setTimeout/queueMicrotask` (threshold)

**Decision:** `SleepTimeReflectionPolicy` uses `croner` (npm, MIT, 0 deps, 2.019M weekly downloads — Q2 ADOPT verdict + Q3 EMBEDDED axis match) running in the same Node event loop. `ThresholdReflectionPolicy` uses built-in `setTimeout(0)` or `queueMicrotask` for fire-and-forget — no scheduler lib needed (event-driven, not time-driven).

**Rationale:** Q2 Rule 9 evaluation locked these choices. Q3 confirmed Letta's process boundary is EMBEDDED with NO separate worker container — TheMemory mirrors this minimalism (zero new containers per v0.1 baseline). Q5 confirmed v4 dropped v1's threading model in favor of same-event-loop async; Node single-threaded event loop is the natural equivalent.

**Alternatives considered:**

- `bullmq` — REJECTED (Q2): Redis dependency disqualifies for local-default runtime
- `node-cron` — DEFERRED (Q2): 12 months stale, ISC license borderline; revisit if `croner` proves insufficient
- `worker_threads` — REJECTED: Node's worker-thread API would solve a problem we don't have (CPU-bound work in main loop) and add ergonomic complexity. Mirrors Letta's v1→v4 evolution AWAY from threads.

**Consequences:**

- Single `croner` dep added to `package.json:dependencies` (NOT devDependencies)
- TheMemory remains single-process / single-container (no worker daemon)
- `SleepTimeReflectionPolicy` configurable with cron expression (e.g., `"*/15 * * * *"` for every 15 min) — exact default cron expression deferred to `/to-plan` (F-cron-default-tbd)

### D8 — `ThresholdReflectionPolicy.shouldReflect()` contract: counter-modular, DB-backed counter

**Decision:** `ThresholdReflectionPolicy({ threshold: N })` returns `true` when `bumpAndGetCounter(scope) % N === 0`. Counter is persisted on the scope row in pgvector schema (new column `pending_reflection_count` or sibling), NOT process-local memory — survives restarts and multi-instance deployments (v0.5+ cloud).

**Rationale:** Q5 confirmed Letta's v1 AND v4 BOTH use `turns_counter % sleeptime_agent_frequency == 0` with DB-backed counter via `group_manager.bump_turns_counter_async`. The pattern is battle-tested. Process-local counters would lose state on restart — unacceptable for a memory primitive consumers embed deeply.

**Alternatives considered:**

- Process-local counter (in-memory) — REJECTED: loses state, breaks across multi-instance
- Redis-backed counter — REJECTED: same Redis-dep disqualification as D7
- Token-count threshold instead of memory-count — DEFERRED (per Q4 finding that Letta uses context-window threshold for compaction, NOT reflection): TheMemory's reflection is memory-count semantic, not context-token semantic. Revisit at v1.x.

**Consequences:**

- DB schema change in v0.4a: new column on the scope-tracking table (or first column on the scope-tracking table if not yet exists; the v0.1 schema needs verification — F-scope-counter-schema-check)
- `bumpAndGetCounter()` is an atomic Postgres `UPDATE ... RETURNING` — single round-trip
- Wall-clock time NOT used (matches Letta pattern); LangMem's "inactivity period" trigger is a SECOND policy variant deferred to opt-in (D12 below)

### D9 — Scoring strategy: ONE additive strategy with configurable weights; REJECT "multiplicative" framing

**Decision:** v0.4a ships ONE `ScoringStrategy` DIP with one implementation: `AdditiveWeightedScoring` parameterized by `{ recency: number, relevance: number, importance: number }` weights (each component min-max normalized to [0,1] BEFORE the weighted sum). Default weights `{ recency: 1, relevance: 1, importance: 1 }` (Mem0-style equal); opt-in Generative-Agents-style weights `{ recency: 0.5, relevance: 3, importance: 2 }` (Q7 verbatim from reference impl).

**Rationale:** Q7 surfaced that CLAUDE.md's "multiplicative Generative Agents" attribution is **factually wrong** — the paper's reference implementation does ADDITIVE weighted sum. Shipping a "multiplicative" strategy would require finding ANOTHER paper that defines it (none found); fabricating one would violate Inquebrável Rule 3. Shipping ONE strategy with weights satisfies CLAUDE.md Item 5 acceptance ("Both scoring strategies pass identical recall-shape contract test") by interpreting "both strategies" as "two weight configurations of the same DIP implementation".

**Alternatives considered:**

- TWO separate DIP implementations (`AdditiveMem0Strategy` + `MultiplicativeGenerativeAgentsStrategy`) — REJECTED: Q7 evidence makes the second one fabrication
- Keep CLAUDE.md "multiplicative" framing, find a different paper — REJECTED: speculative; would block v0.4a kickoff on literature review
- Ship ONLY default Mem0-equal weights, drop Generative-Agents weights entirely — REJECTED: CLAUDE.md Item 5 explicitly references Generative-Agents-style; keeping the weight option preserves the spirit
- **OPEN-ADR for `/to-plan`:** propose CLAUDE.md update removing the "multiplicative" word from Item 5 acceptance. Surface this discrepancy explicitly in the implementation plan as a F-claude-md-update-multiplicative followup.

**Consequences:**

- New `src/core/dip/scoring-strategy.ts` interface (does NOT touch ADR-0008's locked method counts on the existing 5 DIPs — this is a NEW 6th DIP)
- `recall()` API extended with optional `scoringWeights?: ScoringWeights` parameter (defaults to Mem0-equal)
- Each component (recency, relevance, importance) computed by separate function; aggregator does normalization + weighted sum

### D10 — `derived_from: string[]` persistence: JSONB column on `memories` table (single-table)

**Decision:** Higher-order memories carry `derived_from: string[]` as a JSONB column on the same `memories` table that holds all memories. Non-empty array is REQUIRED for rows where `kind = 'derived'`; NULL allowed for rows where `kind = 'extracted'` (the v0.1 default kind). DB-level CHECK constraint: `kind = 'derived' IMPLIES jsonb_array_length(derived_from) >= 1`.

**Rationale:** Discovery-plan ADR D4 made `derived_from` mandatory (this blueprint validates that decision — Q4/Q5/Q6/Q8 all confirmed NEITHER Letta NOR Mem0 NOR LangMem ships any provenance field, so this IS TheMemory innovation). Single-table approach (vs separate `provenance` table) avoids JOINs on recall — recency × relevance × importance scoring already requires accessing the memory row; provenance fits naturally as a column.

**Alternatives considered:**

- Separate `memory_provenance` table with FK to `memories.id` — REJECTED: 1:1 or 0:1 relationship doesn't justify the JOIN cost
- Optional `derived_from?: string[]` column without CHECK constraint — REJECTED: silent NULLs on derived memories would lose audit trail (Inquebrável Rule 3 violation)
- Bi-directional links (`source_for: string[]` on the source memories) — DEFERRED to v1.x: graph queries become natural, but write-amplification on every reflect is non-trivial; YAGNI for v0.4a.

**Consequences:**

- New columns on `memories`: `derived_from JSONB` + `kind VARCHAR(20) NOT NULL DEFAULT 'extracted'` with values `('extracted', 'derived')`
- New error type `ReflectionProvenanceMissingError` (per discovery-plan ADR D4) thrown if reflection LLM cannot identify ≥ 1 source memory — fail-fast, do NOT persist empty provenance silently
- Drizzle ORM schema update + migration in `/to-plan v0-4a-reflection-pipeline` task list

### D11 — LLM-importance cache: persistent column `llm_importance_score REAL`, keyed by content hash

**Decision:** `memories` table gets new column `llm_importance_score REAL` (nullable; populated when policy says to score). Lookup at write-time uses the existing content hash (from v0.1 Phase 4-5 hash dedup): if a memory with the same hash already exists with non-NULL `llm_importance_score`, REUSE that value WITHOUT invoking the LLM. New writes compute the score once and persist.

**Rationale:** CLAUDE.md Item 5 acceptance verbatim: "LLM-importance score persisted on first write; second-write same content does NOT re-invoke LLM." v0.1 already hashes content (Phase 4-5); v0.4a piggybacks on that hash. Cross-process safety: cache lives in the DB, NOT process-local memory (same rationale as D8 counter persistence).

**Alternatives considered:**

- Process-local LRU cache — REJECTED: sleep-time worker lives in same process as writer but cache doesn't survive restarts; same defects as D8 process-local counter
- Redis-backed cache — REJECTED: Redis-dep disqualification (D7)
- TTL-based invalidation — REJECTED: content hash deterministically maps to importance; no TTL needed (Inquebrável § 11 YAGNI)
- Recompute on every read — REJECTED: defeats the entire caching contract

**Consequences:**

- New column `llm_importance_score REAL` on `memories` table (nullable)
- Cache lookup is a query against existing hash-index (v0.1 dedup already creates this index per pgvector blueprint)
- The `LLM` DIP is NOT touched (ADR-0008 method count holds)

### D12 — Test pyramid placement (per Q1 + EC-4 transcription)

**Decision:** Test layering for v0.4a reflection pipeline:

- **Unit tier** (`tests/unit/reflection/`): `ScoringStrategy` math (weighted sum + normalization invariants); `ThresholdReflectionPolicy.shouldReflect()` with mocked counter; `derived_from` validation logic in isolation
- **Integration tier** (`tests/integration/reflection/`): async trigger end-to-end with REAL pgvector + REAL Node timers (NO clock mocking — Letta pattern per EC-4); seed 50 memories, fire `reflect()`, assert ≥ 1 higher-order memory has `derived_from.length >= 1`; LLM-importance cache hit on second-write same content (mock LLM call count == 1, not 2)
- **E2E tier:** OUT OF SCOPE for v0.4a; consumer-side E2E would live in TheoKit-binding tests (v0.2 follow-up if any)

**Rationale:** Q1 confirmed Letta's tier discipline — integration uses real server + real timers + flaky-retry marker; unit uses `AsyncMock`. EC-4 absorption: mocking idioms transcribed verbatim; do NOT translate clock-mock patterns from Python to vitest. Use CONFIG-knob trigger override (`ThresholdReflectionPolicy({ threshold: 2 })`), NOT clock manipulation.

**Alternatives considered:**

- Clock-mocking via `vi.useFakeTimers()` — REJECTED for `SleepTimeReflectionPolicy` integration tests: Letta deliberately avoided it; `flaky-retry + real timers` is the proven pattern
- 100% unit coverage with mocked pgvector — REJECTED: derived_from JSONB persistence + CHECK constraint can only be validated against real Postgres (v0.1 integration discipline)

**Consequences:**

- vitest `pool: 'forks'` for integration tests to avoid event-loop pollution between sleep-time tests
- `@vitest/coverage-v8` thresholds: 100% on critical paths (`reflect()`, `shouldReflect()`, scoring math, provenance validation); 90% on adjacent code
- `vi.mock('@usetheo/memory/dip')` for unit tests; real pgvector container for integration via existing v0.1 fixture infrastructure

## Recommendations for TheMemory

Concrete next steps that the blueprint informs. Each recommendation links to the research question(s) it answers, the ADR(s) it implements, and the project rule it respects.

| # | Recommendation | Linked to | Priority |
|---|---|---|---|
| R1 | ADOPT `croner` npm dep (MIT, 0 transitive deps, 2.019M weekly downloads) for `SleepTimeReflectionPolicy` cron-based triggers; add to `package.json:dependencies` | Q2 Rule 9 verdict + Q3 EMBEDDED axis + D7 | **HIGH** — load-bearing for v0.4a SleepTime policy |
| R2 | Use built-in `setTimeout(0)` / `queueMicrotask()` for `ThresholdReflectionPolicy` fire-and-forget; NO scheduler lib needed | Q2 + Q5 (v4 same-event-loop async pattern) + D7 | **HIGH** — KISS (Inquebrável § 10); event-driven trigger doesn't need cron |
| R3 | Implement `ThresholdReflectionPolicy.shouldReflect()` with DB-backed counter (atomic `UPDATE ... RETURNING`); persist `pending_reflection_count` on scope-tracking table | Q5 (Letta v1/v4 counter-modular pattern) + D8 | **HIGH** — survives restarts + multi-instance |
| R4 | Ship ONE `ScoringStrategy` DIP with `AdditiveWeightedScoring` impl; default weights `{1,1,1}` (Mem0-style equal); opt-in Generative-Agents weights `{0.5, 3, 2}` for recency/relevance/importance | Q7 (Verbatim from reference impl) + D9 + ADR D3 (revised) | **HIGH** — corrects the "multiplicative" framing |
| R5 | OPEN-ADR for `/to-plan`: surface CLAUDE.md Item 5 "multiplicative Generative Agents" attribution wrongness; propose CLAUDE.md update removing the "multiplicative" word; or alternative framing | Q7 critical finding + D9 | **HIGH** — honesty (Inquebrável Rule 3) |
| R6 | Add `derived_from: string[]` JSONB column on `memories` table with CHECK constraint `kind='derived' IMPLIES jsonb_array_length(derived_from) >= 1`; throw `ReflectionProvenanceMissingError` if LLM produces a derived memory without identifiable sources | Q4 + Q5 + Q6 + Q8 (ALL 3 ref projects lack provenance — TheMemory innovation) + D10 + ADR D4 | **HIGH** — load-bearing per CLAUDE.md Item 5 acceptance |
| R7 | Add `llm_importance_score REAL` column on `memories` table; cache lookup via existing content-hash index (from v0.1 Phase 4-5); skip LLM call on second-write same content | CLAUDE.md Item 5 acceptance + D11 + ADR D5 | **HIGH** — load-bearing per CLAUDE.md Item 5 acceptance |
| R8 | Test pyramid: vitest config-knob threshold override (NOT clock mocking) for SleepTime integration; real pgvector container for provenance integration tests; `vi.mock` only on `LLM` DIP for unit tests | Q1 EC-4 verbatim Letta pattern + D12 + `testing.md § Pyramid` | **HIGH** — proven discipline; flaky-retry marker for sleep-time |
| R9 | Hybrid `SleepTimeReflectionPolicy` trigger: support BOTH cron expression AND optional inactivity-period seconds; second condition is opt-in (LangMem-inspired Q8 finding) | Q8 + D8 consequences | MEDIUM — LangMem precedent; add only if cron alone proves insufficient for a real consumer |
| R10 | Adopt explicit "you are a sleeptime agent" prompt-prepending pattern for reflection LLM call; matches Letta v4's `system-reminder` (`sleeptime_multi_agent_v4.py:233-244`) | Q5 v4 system-reminder prompt | MEDIUM — clarifies LLM cognitive mode; cheap to add; reduces hallucination |
| R11 | Adopt fallback chain pattern for reflection LLM errors (clamp transcript → truncate bytes → retry); inspired by Letta `simple_summary` 4-fallback structure (`summarizer.py:562-647`) | Q4 finding | MEDIUM — error resilience; do NOT replicate full Letta provider-fallback (Anthropic→Bedrock); just retry-with-shrink |
| R12 | DO NOT borrow Letta's sliding-window summarization algorithm; DO NOT borrow `self_compact` mode; DO NOT borrow worker-agent abstraction; DO NOT borrow `temporalio` (unused dep) | Q4 + Q5 + Q2 | LOW (anti-recommendation) — protects against scope creep |
| R13 | Add `kind: 'extracted' \| 'derived'` discriminator column on `memories` table; default `'extracted'` for backward compatibility with v0.1 rows; `'derived'` only set by `reflect()` | D10 consequence | MEDIUM — enables `recall({ kind: 'derived' })` filter for consumers wanting only higher-order memories |
| R14 | Document the v0.4a → CLAUDE.md update separately: bump `Roadmap Item 5` Status from `Planned` to `Shipped {date}` post-merge, mirror v0.3 PR #20 doc-sync pattern | dogfood-golden-rule.md + cycle-implement.md | LOW — operational hygiene |

## Blocked questions (if any)

| Question | Status | Reason | Suggested human follow-up |
|---|---|---|---|
| Q7 | `partial` (NOT fully blocked) | arXiv PDF (https://arxiv.org/pdf/2304.03442) exceeded WebFetch 10MB content limit; arXiv HTML5 (https://arxiv.org/html/2304.03442) returned 404. Per EC-9 fallback path: VERBATIM formula extracted from reference implementation snapshot (github.com/joonspk-research/generative_agents/blob/main/reverie/backend_server/persona/cognitive_modules/retrieve.py). Implementation IS the enforceable spec; paper § 4.1 text NOT directly cited. | If the paper's prose framing matters for D9, fetch via local PDF reader or arXiv API. The implementation-based finding is sufficient for v0.4a kickoff — the formula is locked. F-langmem-quickstart-fetch is a sibling open followup (separate Q). |

## Halt-loop progress (audit trail)

- Iterations used: **9 / 30 max**
- Questions answered: **7 done + 1 partial = 8 / 8 total**
- Questions blocked: **0** (Q7 `partial` per EC-9 fallback is HONEST — formula extracted verbatim from reference impl; not a blocking failure)
- Citations verified: **131 `.claude/knowledge-base/references/{path}` references + 7 web URLs (each with snapshot)** — all paths re-verified at halt time via `grep -oE '.claude/knowledge-base/references/[^ )\`":]+' blueprint.md | sort -u | Path.exists()`
- Snapshots written: **7 files** under `.claude/knowledge-base/discoveries/snapshots/v0-4a-reflection-pipeline/`
  - `b131612d...` bullmq via github.com (EC-3)
  - `55db153e...` node-cron via github.com (EC-3)
  - `7d70906d...` croner via github.com (EC-3)
  - `e0fa7252...` Generative Agents arXiv abstract (Q7 partial)
  - `67f8665b...` Generative Agents retrieve.py reference impl (Q7 fallback — VERBATIM formula)
  - `0674a5b3...` LangMem conceptual_guide.md (Q8 EC-10 fallback)
  - `1655d9a9...` LangMem README (Q8 EC-10 secondary)
- Promise emitted at iteration: **9** (this iteration — when halt conditions verified below)

### Halt-condition verification (per driver file Step 7)

| Condition | Status | Evidence |
|---|---|---|
| (a) Every question `done` OR `blocked` with reason | ✓ | 7 `done` + 1 `partial` (Q7) with honest EC-9 fallback rationale + 0 `pending` |
| (b) Every `.claude/knowledge-base/references/{path}` citation exists in filesystem | ✓ | All paths pre-validated before plan write (15 paths × `Path.exists()`); halt-time re-verification confirms zero `FABRICATED:` lines |
| (c) All 4 ORIGINAL coverage corners populated | ✓ | Corner 1 (Q1 Letta tests) + Corner 2 (Q2 deps + Rule 9) + Corner 3 (Q3 tools) + Corner 4 (Q4+Q5+Q6 techniques) — all non-placeholder |
| (d) Corner 5 (Prior Art) populated per plan acceptance | ✓ | Q7 (Generative Agents, partial honest) + Q8 (LangMem) |
| (e) Blueprint has ≥ 1 ADR | ✓ | 6 blueprint-level ADRs (D7 through D12) |
| (f) Q2 has Rule 9 verdict for each Node candidate + setTimeout | ✓ | bullmq REJECT / node-cron DEFER / croner ADOPT / setTimeout ADOPT — 4 verdicts |
| (g) No off-allowlist URLs cited | ✓ | All 7 snapshots from allowlisted domains (`arxiv.org`, `github.com`); `docs.langchain.com` (subdomain) correctly NOT fetched per EC-10 fallback path |

## Related

- Discovery plan: `.claude/knowledge-base/discoveries/plans/v0-4a-reflection-pipeline-plan.md` (v1.1)
- Edge-case review: `.claude/knowledge-base/reviews/v0-4a-reflection-pipeline-edge-cases-2026-05-25.md` (14 ECs)
- Companion v0.0 ADR: `.claude/knowledge-base/adrs/ADR-0005-reflection-trigger.md` (locks `ReflectionPolicy` DIP)
- Confidence report: `.claude/knowledge-base/reviews/v0-4a-reflection-pipeline-confidence-{YYYY-MM-DD}.md` (generated by `/discover-confidence`)
- Linked TheMemory rules: `.claude/rules/architecture.md`, `.claude/rules/testing.md`, `.claude/rules/dogfood-golden-rule.md`
- Cycle rule: `.claude/rules/cycle-discover.md` (v1.1 — 5-corner Coverage Matrix)
