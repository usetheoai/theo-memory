# Memory Improvement Roadmap — Context-Engine-Aware

**Research date:** 2026-05-05 (updated 2026-05-11)
**Researcher:** Claude (SOTA Research Skill)
**Current SOTA score:** 4.7/5 (synced with implementation 2026-05-11)
**Previous score:** 4.0/5
**Lens:** memory ↔ context engineering integration
**Gaps filled this session:** 3 of 3 from INDEX.md (A-MEM, Graphiti, recall-latency benchmark)
**Implementation sync (05-11):** 6 gaps closed by Evolution Phases 1-4 + memory remediation

## Executive Summary

**Updated 2026-05-11:** The memory subsystem has evolved significantly since this roadmap was written. The major gaps identified (Reflection pipeline, ERL failure recall, Dream consolidation, subagent fold persistence, ArtifactIndex tracking) have been **implemented and tested** across Evolution Phases 1-4 and the memory remediation plan. The remaining gaps are CollapseLog→Memory bridge, bi-temporal validity, versioned writes, and recall quality telemetry. Context-engine integration is now **deep** — CausalLink tracking, episode usefulness, and SessionState are wired. The system has 270+ tests across 5 crates.

## Reference Evolution

| Reference | Status | Update |
|-----------|--------|--------|
| CoALA (arXiv:2309.02427) | Current | Still the canonical taxonomy. TMLR 2024 (not NeurIPS — original SOTA doc has the correction). |
| MemGPT (arXiv:2310.08560) | Current | Letta is the production framework. Pattern still relevant. |
| Mem0 (arXiv:2504.19413) | UPDATED | "State of AI Agent Memory 2026" blog confirms graph memory in production by early 2026 (was experimental in 2024). |
| Zep/Graphiti (arXiv:2501.13956) | UPDATED | LongMemEval results: +18.5% accuracy, context drops 115k→1.6k tokens, latency 29-31s→2.5-3.2s. Bi-temporal model now production-grade. |
| MemoryBank (arXiv:2305.10250) | Current | Forgetting curve pattern unchanged. |
| **A-MEM (arXiv:2502.12110)** | **NEW (gap filled)** | Zettelkasten-inspired atomic notes + LLM-generated links + memory evolution. NeurIPS 2025 poster. **Risk noted:** memory-evolution mutates historical notes — versioning/audit concern. |
| Karpathy LLM Wiki | Current | Already implemented in `infra-memory/src/wiki/`. |
| **Cloudflare Agent Memory (April 2026)** | **NEW** | "Bulk ingestion at compaction" — exact pattern our code agent `on_pre_compress` hook should drive. |
| **Reflective Memory Management RMM (arXiv:2503.08026)** | **NEW** | Two-stage reflection — Prospective + Retrospective. Decomposed topics. |
| **Hindsight (arXiv:2512.12818)** | **NEW** | Tempr (retain/recall) + Cara (reflect) split. World/experience/opinion/observation networks. |
| **AgeMem / Memory-R1** | **NEW** | RL-trained memory policies treating store/retrieve/update/summarize/discard as learned tools. Frontier — defer. |
| **ERL: Experiential Reflective Learning (arXiv:2603.24639)** | **NEW** | Failure-derived heuristics outperform success-derived (+14.3% on search). 2026 successor to ExpeL. |
| **SAMULE / MAR (EMNLP 2025, Dec 2025)** | **NEW** | Reflexion limitations on hard benchmarks. Multi-agent reflection. |
| **Claude Code memory model (April 2026)** | **NEW** | 5-stage compaction pipeline. Sub-agents update Markdown notes every 5k tokens after 3 tool calls. ~/.claude/projects/.../memory/ FS-based, MEMORY.md as 200-line index. Auto Dream cleanup. |
| llm-wiki-compiler | Current | Two-phase hash-based pipeline already ported into `infra-memory/src/wiki/compiler.rs`. |
| hermes-agent memory_*.py | Current | Patterns already mostly absorbed into `MemoryEngine`. |

## Gaps Filled

1. **A-MEM Zettelkasten (INDEX gap)** → arXiv:2502.12110 + 2 GitHub repos (agiresearch/A-mem MIT, WujiangXu/A-mem author repo). Atomic notes + dynamic linking + memory evolution. Caveat: evolution mutates history (versioning concern).
2. **Graphiti temporal KG integration detail (INDEX gap)** → bi-temporal model with t_valid + t_invalid intervals; LongMemEval +18.5% acc, 115k→1.6k tokens, 29s→2.5s latency. Backends: Neo4j 5.26 / FalkorDB / Kuzu / Neptune. **NO official Rust SDK** — would need REST/MCP integration.
3. **Recall latency benchmark (INDEX gap)** → Mem0 reports p50 < 100ms with their dense retrieval; Graphiti reports 2.5-3.2s end-to-end (incl. LLM verification). For our code agent Rust impl, p50 < 500ms target is achievable but only without LLM verification in the hot path.

## Competitive Position (updated 2026-05-11)

| Dimension | Theo Code | Best-in-class | Gap | Effort |
|-----------|-----:|---------------|-----|-------:|
| **Trait surface** | 4.5/5 | 5/5 (hermes) | 12 methods implemented. Missing: `is_available`, `queue_prefetch`, `get_tool_schemas` (MemGPT surface) | S |
| **Lifecycle wiring** | 5/5 | 5/5 (Cloudflare) | Fully wired: prefetch, sync_turn, on_pre_compress, on_session_end, failure_heuristic_recall, promote_quarantined. Per-N-turns + JIT + loop reload. | — |
| **Context-engine integration** | 3.5/5 | 4.5/5 (Hindsight) | CausalLink tracking, episode usefulness, ArtifactIndex drift detection WIRED. Missing: CollapseLog→Memory bridge (on_collapse_action). | S |
| **Reflection pipeline** | 4.5/5 | 4.5/5 (ERL) | `Reflection` type (4 categories, 7-gate, lifecycle), `ReflectionStore` (395 LOC), ERL `failure_heuristic_recall` wired, autodream heuristic promotion. **AT PARITY with ERL.** | — |
| **Forgetting / pruning** | 3.5/5 | 4/5 (MemoryBank) | `MemoryLifecycleEnforcer` (decay.rs), `LlmAutodreamExecutor` (916 LOC, backup, atomic protection). Missing: Ebbinghaus curve, explicit usefulness-threshold tuning. | S |
| **Storage versioning** | 2/5 | 4.5/5 (Claude Managed Agents) | No immutable memory versions. Audit trail / rollback absent. | M |
| **Wiki compiler** | 4/5 | 4.5/5 (llm-wiki-compiler) | Hash-based incremental compiler ported (`wiki/compiler.rs`). Missing: prompt-injection scan in lint phase. | S |
| **Security** | 4/5 | 4.5/5 (hermes) | `security.rs` 543 LOC has injection-pattern scan. Missing: cross-fence-sanitize between memory blocks and tool results. | S |

## Quick Wins — Status (updated 2026-05-11)

1. ~~**Reflection type + extraction at compaction**~~ → **DONE.** `Reflection` type in `theo-domain/src/reflection.rs` (4 categories, 7-gate). `ReflectionStore` in `theo-infra-memory/src/reflection_store.rs` (395 LOC). `aggregate_failure_heuristics_from_episodes` in autodream executor promotes recurring patterns. 270+ tests.

2. **CollapseLog → Memory bridge** → **OPEN.** `on_pre_compress` exists in the `MemoryProvider` trait but has no caller in the compaction pipeline. Proposed `on_collapse_action` hook does not exist. This is the most important remaining gap.

3. ~~**SessionState.relevant_files → recency boost**~~ → **DONE.** SessionState seeds from `ArtifactIndex` + `edits_files` via iteration lifecycle. `CausalLink` tracking feeds `compute_episode_usefulness`.

## Sprint Targets — Status (updated 2026-05-11)

1. ~~**Failure-heuristic store (ERL pattern)**~~ → **DONE.** `Reflection.category` includes `FailureHeuristic { error_class, action_class }`. `ErrorClass::classify_from_tool_error` (8 buckets). `failure_heuristic_recall(error_class)` on the trait + hook in `dispatch_one_tool_call` injects BEFORE retry. 9 unit tests.

2. **Bi-temporal validity on memory entries (Graphiti pattern, lite)** → **OPEN.** No `t_valid`/`t_recorded` field on current types.
   - Crates: `theo-domain::memory` (add fields), `theo-infra-memory::builtin` + `wiki` (carry through).

3. **Versioned memory writes (Claude Managed Agents pattern)** → **OPEN.** No audit trail for writes.
   - Crates: `theo-infra-memory::builtin` (commit on write), `apps/theo-cli::cmd::memory` (new `theo memory log <id>`).

4. ~~**Auto Dream cleanup pass (Claude Code pattern)**~~ → **DONE.** `LlmAutodreamExecutor` (916 LOC) in `theo-application`. Trigger: >24h + ≥5 sessions + no lock. Mandatory backup. Atomic types protected. Heuristic promotion of cross-episode patterns (threshold=3). Wired via `memory_factory::attach_memory_to_config`.

## Post-Launch

1. **Two-pass extraction + verification (Hindsight pattern)** — replace single-pass LLM extraction with parallel broad-pass + detail-pass. Multi-axis verifier (entity, temporal, relational, support). Higher quality but ~2× LLM cost. Defer until reflection volume justifies it.
2. **Graphiti integration via MCP** — Graphiti has no Rust SDK; integration is via MCP server. Worth it ONLY if the user explicitly opts into temporal KG (Neo4j infra cost).
3. **AgeMem RL-trained memory policies** — frontier; defer until we have a reward signal.

## New SOTA Gates Proposed

### Gate MEM-G01: Reflection extraction at compaction

**Objective:** Every compaction event that produces `CollapseAction::Dropped` or `CollapseAction::Truncated` MUST trigger a reflection-extraction pass before the messages are lost. Compaction without extraction is a defect.

**Approval criteria:**
- `Reflection` type exists in `domain`
- `MemoryEngine::on_pre_compress` extracts at least 1 reflection per compaction event in 80%+ of runs that produced `Dropped`/`Truncated` actions
- `.agent/reflections.jsonl` non-empty after a 50+ iteration run

**Expected evidence:** integration test asserting reflection count > 0 after a session where `CollapseLog.entries().any(|e| e.actions.iter().any(|a| matches!(a, Truncated|Dropped)))` is true.

**FAANG reference:** Cloudflare Agent Memory (April 2026) — "Bulk ingestion at compaction" with two-pass extraction + verification. Anthropic's compaction beta (`compact-2026-01-12`) preserves on compaction.

### Gate MEM-G02: Versioned memory writes (audit trail)

**Objective:** Every mutation to MEMORY.md / USER.md / wiki page produces an immutable version readable via CLI.

**Approval criteria:**
- New `agent memory log <id>` CLI subcommand prints the version history
- Shadow git repo at `~/.agent/memory-versions/<sha16>/` mirrors writes
- A-MEM-style memory evolution (note rewrites) is recorded as a NEW version, not an in-place edit

**Expected evidence:** integration test that writes the same memory key 3 times; `agent memory log <key>` shows 3 versions in chronological order.

**FAANG reference:** Claude Managed Agents API "memory stores immutable memory versions, audit trail and point-in-time recovery" (platform.claude.com/docs/en/managed-agents/memory).

### Gate MEM-G03: Failure-heuristic recall before LLM call

**Objective:** When the agent enters an iteration with a known `ErrorClass` from the last failed turn, the memory layer MUST recall failure-heuristics matching that class and inject them BEFORE the LLM call.

**Approval criteria:**
- `MemoryEngine::prefetch_for_failure(error_class)` method exists
- Wired in `iteration_prelude` after the previous turn's tool result if it had `ErrorClass != Solved`
- Test fixture: scenario where iteration N produces `LlmHallucination`, iteration N+1 prefetches the failure heuristic from a prior session

**FAANG reference:** ERL (arXiv:2603.24639) — failure heuristics +14.3% over baseline on search benchmarks; ExpeL (Reflexion successor).

## Anti-Patterns — Status (updated 2026-05-11)

1. **`MemoryProvider::prefetch(&str) -> String` is too narrow** — **PARTIALLY ADDRESSED.** `take_last_recall_report()` now returns `RecallReport` with provenance (hit_count, filter_dropped, dedup_dropped, pre_filter_count). `recall_memory` tool exposes dual-path + scout mode. Missing: `Vec<MemoryEntry>` with scores.

2. **`on_pre_compress` doesn't see the `CollapseLog`** — **OPEN.** Hook exists in the trait but with no caller. This is the most important remaining gap.

3. ~~**No coupling between `SessionState.relevant_files` and memory recall**~~ → **RESOLVED.** CausalLink tracking + `compute_episode_usefulness` + ArtifactIndex drift detection feed the lifecycle.

4. ~~**No cross-link between `subagent_fold_count` and memory**~~ → **RESOLVED.** `delegate_handler::fold_subagent_summary` persists as `Reflection { SubagentLesson }` with 3 filters (length ≥ 200, denylist, ≥ 5 events) + confidence capped at 0.85.

5. ~~**`ArtifactIndex` doesn't surface as memory**~~ → **RESOLVED.** `record_artifact_op` on each tool call, `drifted` flag with state machine (set on hash mismatch, clear on re-read match), `as_summary` renderer appends `[drifted]` marker.

## Sources (New + Updated)

- [A-MEM: Agentic Memory for LLM Agents (arXiv:2502.12110)](https://arxiv.org/abs/2502.12110) — Zettelkasten atomic notes + dynamic linking + memory evolution (NEW; NeurIPS 2025 poster)
- [agiresearch/A-mem](https://github.com/agiresearch/a-mem) — official MIT-licensed reference impl (NEW)
- [Reflective Memory Management (arXiv:2503.08026)](https://arxiv.org/pdf/2503.08026) — Prospective + Retrospective two-stage reflection (NEW)
- [Hindsight: Building Agent Memory (arXiv:2512.12818)](https://arxiv.org/html/2512.12818v1) — Tempr (retain/recall) + Cara (reflect) split (NEW)
- [Memory for Autonomous LLM Agents survey (arXiv:2603.07670)](https://arxiv.org/html/2603.07670v1) — 5 mechanism families: context-resident compression, retrieval-augmented stores, reflective self-improvement, hierarchical virtual context, policy-learned management (NEW)
- [ERL: Experiential Reflective Learning (arXiv:2603.24639)](https://arxiv.org/pdf/2603.24639) — failure heuristics outperform success heuristics +14.3% (NEW)
- [MAR: Multi-Agent Reflexion (arXiv:2512.20845)](https://arxiv.org/html/2512.20845) — single-agent Reflexion confirmation bias overcome (NEW)
- [SAMULE (EMNLP 2025)](https://aclanthology.org/2025.emnlp-main.839.pdf) — Reflexion limitations on hard benchmarks; failure clustering (NEW)
- [Cloudflare Agent Memory (April 2026)](https://blog.cloudflare.com/introducing-agent-memory/) — bulk ingestion at compaction pattern (NEW)
- [Mem0 State of AI Agent Memory 2026](https://mem0.ai/blog/state-of-ai-agent-memory-2026) — graph memory now in production (UPDATED from 2024 status)
- [Graphiti production guide](https://github.com/getzep/graphiti) — bi-temporal model, LongMemEval +18.5%, 29s→2.5s latency (UPDATED)
- [Claude Code memory docs](https://code.claude.com/docs/en/memory) — 5-stage compaction, MEMORY.md 200-line index, sub-agent notes every 5k tokens (NEW)
- [Claude Managed Agents memory API](https://platform.claude.com/docs/en/managed-agents/memory) — immutable versions, audit trail (NEW)
- [Auto Dream pattern (Mervin Praison May 2026)](https://mer.vin/2026/05/claude-memory-architecture-explained-how-persistent-context-makes-coding-agents-reliable/) — relative-date resolution, contradiction merging, deleted-file cleanup (NEW)
