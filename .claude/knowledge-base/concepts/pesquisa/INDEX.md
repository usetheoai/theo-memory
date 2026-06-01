# Memory — SOTA Research

## Scope
Multi-layer memory system: STM, WM, LTM-semantic (builtin + wiki), LTM-episodic, LTM-procedural, Reflection/MemoryLesson, Meta-Memory, Retrieval-backed.

**Current lens:** integration with our Context Engineering stack (`CompactedMessages`, `CollapseLog`, `SessionState`, `ArtifactIndex`, `subagent_fold`).

## Target crates
- `domain` — traits (`MemoryProvider`, `WikiBackend`), types (`Reflection`, `EpisodeSummary`, `MemoryLifecycle`, `ErrorClass`, `RecallReport`, `recall_score`)
- `infra-memory` — concrete implementations (`MemoryEngine`, `BuiltinMemoryProvider`, `RetrievalBackedMemory`, `WikiMemoryProvider` + compiler/lint, `security`)
- `application` — use-case coordination (`memory_factory`, `autodream_executor`, `memory_reviewer_llm`, `scouts`, `scout_recaller`)
- `tooling` — tools (`store_memory`, `recall_memory`)
- `agent-runtime` — lifecycle (`memory_lifecycle/`, `autodream.rs`), wiring (`bootstrap.rs`, `execution.rs`, `iteration_prelude.rs`)

## Key references
| Source | What to extract |
|-------|---------------|
| CoALA (arXiv:2309.02427) — TMLR 2024 | Taxonomy of 6 memory types |
| MemGPT (arXiv:2310.08560) | Virtual context, paging tool calls |
| Mem0 (arXiv:2504.19413) | ADD-only extraction, 91.6 LoCoMo, dense retrieval |
| Zep/Graphiti (arXiv:2501.13956) | Temporal KG bi-temporal, LongMemEval +18.5%, 29s→2.5s latency |
| MemoryBank (arXiv:2305.10250) | Ebbinghaus forgetting curve |
| **A-MEM (arXiv:2502.12110)** — NeurIPS 2025 poster | Zettelkasten atomic notes + dynamic linking + memory evolution. Caveat: evolution mutates history → versioning concern. |
| **Reflective Memory Management (arXiv:2503.08026)** | Prospective + Retrospective two-stage reflection |
| **Hindsight (arXiv:2512.12818)** | Tempr (retain/recall) + Cara (reflect) split. World/experience/opinion/observation networks. |
| **ERL: Experiential Reflective Learning (arXiv:2603.24639)** | Failure heuristics > success heuristics (+14.3% on search) |
| **Memory for Autonomous LLM Agents survey (arXiv:2603.07670)** | 5 mechanism families |
| **MAR: Multi-Agent Reflexion (arXiv:2512.20845)** | Single-agent Reflexion confirmation bias overcome (+6.2 HumanEval) |
| **SAMULE (EMNLP 2025)** | Reflexion limitations; failure clustering |
| Karpathy LLM Wiki | raw → compile → query, hash-based incremental |
| llm-wiki-compiler | Two-phase pipeline, SHA-256 incremental |
| **Cloudflare Agent Memory (April 2026)** | "Bulk ingestion at compaction" pattern |
| **Claude Code memory docs (April 2026)** | 5-stage compaction, MEMORY.md 200-line index, sub-agent notes every 5k tokens |
| **Claude Managed Agents memory API** | Immutable memory versions + audit trail + point-in-time recovery |
| **Auto Dream cleanup pattern** | Relative-date resolution, contradiction merging, deleted-file cleanup |
| **Anthropic Dreaming (shipped, May 2026)** | Dream consolidation in production. API `dreaming-2026-04-21`. Scheduled review of past sessions, extracts cross-session patterns, merges duplicates, replaces stale entries. Harvey reports 6x task completion improvement. Validates ADR-14. | **NEW 05-11** |
| **arXiv:2605.08060 "The Memory Curse" (May 2026)** | Expanding accessible history DEGRADES cooperation in 18/28 model-game combinations. The trigger is memory content, not size. Memory sanitization (replacing with synthetic cooperative records) restores cooperation. More memory ≠ better. | **NEW 05-11** |
| **arXiv:2605.06716 "Storage→Experience" survey (May 2026)** | Evolutionary framework: Storage (trajectory preservation) → Reflection (refinement) → Experience (abstraction). Bridge between OS engineering and cognitive science. | **NEW 05-11** |
| **arXiv:2605.05583 "BeliefMem" (May 2026)** | Probabilistic memory: multiple candidate conclusions with probabilities, updated via Noisy-OR. Alternative to deterministic reflections. | **NEW 05-11** |
| **arXiv:2605.01567 "Feedback-Normalized Dev Memory" (May 2026)** | MCP-native memory. Memory selection as a logged decision process with telemetry and bounded rewards. First paper linking MCP to developer memory for coding agents. | **NEW 05-11** |
| **Memori Labs (May 2026)** | Agent-native memory infrastructure. Creates structured memory of the agent trace (execution paths, tool results, decisions), not the conversation. OpenClaw plugin v0.0.10. | **NEW 05-11** |
| **Gemini CLI Auto Memory + inbox (v0.41, May 2026)** | Auto-extraction in background from idle sessions >3h. Proposes memory updates as `.patch` files and `SKILL.md`. Inbox with approval gate. Middle-ground between explicit writes (ADR-02) and full auto-extraction. | **NEW 05-11** |
| **MemMachine (arXiv:2604.04853, April 2026)** | STM summary + selective raw episodes. 0.9169 LoCoMo (SOTA). Summary-only loses factual detail for temporal/factual queries. | **NEW 05-11** |
| **MAGMA (arXiv:2601.03236)** | Multi-graph memory: semantic/temporal/causal/entity graphs. Policy-guided traversal for retrieval. | **NEW 05-11** |
| **AgeMem (arXiv:2601.01885, updated April 2026)** | Three-stage progressive RL for unified STM/LTM management via tool-based actions. Step-wise GRPO for sparse rewards. | **NEW 05-11** |
| hermes-agent `memory_provider.py` | MemoryProvider lifecycle (prefetch/sync_turn/on_pre_compress) — already absorbed |
| hermes-agent `memory_manager.py` | Fan-out, error isolation, one-external rule — implemented in `MemoryEngine` |
| hermes-agent `memory_tool.py` | Security scan, frozen snapshot, MEMORY.md/USER.md — security ported |

## Files in this folder
- `agent-memory-sota.md` — Complete report on the SOTA architecture (2026-04-20)
- `agent-memory-plan.md` — Roadmap RM0-RM5b with acceptance criteria
- `improvement-roadmap.md` — **NEW (2026-05-05)** context-engine-aware roadmap with gaps filled + 3 proposed SOTA gates (MEM-G01/G02/G03)
- `karpathy-llm-wiki-tutorial.md` — Karpathy walkthrough
- `How AI Agents Remember Things.md` — primer

## Current implementation (verified 2026-05-11)
- ✅ `MemoryProvider` trait (12 methods: prefetch, sync_turn, on_pre_compress, on_session_end, write_reflection, reflection_recall, failure_heuristic_recall, promote_quarantined, take_last_recall_report...)
- ✅ `NullMemoryProvider`
- ✅ `MemoryEngine` coordinator (fan-out, error isolation, one-external rule)
- ✅ `BuiltinMemoryProvider` (dual-path: OnceLock snapshot + AtomicU64 generation counter)
- ✅ `RetrievalBackedMemory` via tantivy adapter (feature-gated `tantivy-backend`)
- ✅ `WikiMemoryProvider` (compiler + hash + lint)
- ✅ `security.rs` (543 LOC) — injection-pattern scan
- ✅ `ReflectionStore` (395 LOC) — append-only JSONL, hit tracking, contradiction scan
- ✅ `Reflection` type (4 categories, 7-gate validation, Quarantine→Confirmed→Invalidated lifecycle)
- ✅ `store_memory` tool — explicit, registered in DefaultRegistry
- ✅ `recall_memory` tool — dual-path (prefetch + reflections) + scout mode (RRF 4×)
- ✅ `LlmAutodreamExecutor` (916 LOC) — Dream consolidation with backup, atomic type protection, 24h cooldown
- ✅ `LlmMemoryReviewer` (259 LOC) — periodic review via aux LLM
- ✅ `ErrorClass` classifier (8 buckets) + `failure_heuristic_recall` (ERL pattern)
- ✅ 4/4 recall mechanisms (ADR-15): per-N-turns, recall_memory tool, loop reload, JIT file-access
- ✅ `MemoryLifecycleEnforcer` — passive decay (Active→Cooling→Archived)
- ✅ `CausalLink` tracking — episode usefulness (Used/Unused/Failed)
- ✅ RRF 4× scout orchestrator (SubstringScout, GlobScout, Bm25Scout, SymbolScout)
- ✅ Wired into agent loop via `memory_lifecycle/`, `bootstrap.rs`, `execution.rs`, `iteration_prelude.rs`
- ✅ 270+ tests covering the Memory domain (161 infra-memory + 23 tools + 50+ runtime + 39 application)

## Gaps to research (updated 2026-05-05)

### Gaps filled (session 05-05)
- ~~A-MEM Zettelkasten (arXiv:2502.12110)~~ → covered in `improvement-roadmap.md`. Decision: **defer** (memory-evolution risk + Rust impl cost) until reflection store grows.
- ~~Graphiti temporal KG integration detail~~ → covered. Decision: **MCP-only path** if needed (no Rust SDK).
- ~~Recall latency benchmark Rust p50<500ms~~ → covered. Achievable without LLM in the hot path.

### Gaps filled (session 05-11)
- ~~Anthropic Dreaming in production~~ → API shipped. Validates ADR-14 (scheduled trigger, backup, auxiliary LLM, index regen). Harvey 6x improvement.
- ~~Memory Curse (2605.08060)~~ → Empirical evidence: more recall can degrade. Validates ADR-15 (controlled frequency).
- ~~Storage→Experience taxonomy (2605.06716)~~ → New evolutionary taxonomy. Our domain is in Reflection; Experience = abstraction of trajectories.
- ~~BeliefMem (2605.05583)~~ → Probabilistic memory. New paradigm, does not contradict ADRs but opens future option.
- ~~Feedback-Normalized Dev Memory (2605.01567)~~ → MCP-native with recall quality telemetry.
- ~~Memori Labs~~ → Memory of the execution trace (not the conversation). Complementary pattern.
- ~~Gemini CLI Auto Memory~~ → Auto-extraction with inbox approval. Middle-ground vs ADR-02.
- ~~MemMachine (2604.04853)~~ → SOTA LoCoMo (0.9169). Raw episodes + summaries > summaries-only.
- ~~MAGMA multi-graph~~ → 4 types of graphs (semantic/temporal/causal/entity).
- ~~AgeMem RL~~ → Progressive RL for unified STM/LTM.

### Gaps resolved (implemented since 05-05)
- ~~Reflection extraction pipeline~~ → `Reflection` type (4 categories, 7-gate), `ReflectionStore` (395 LOC), `aggregate_failure_heuristics_from_episodes` in autodream
- ~~Subagent fold → Reflection~~ → `delegate_handler::fold_subagent_summary` persists as `Reflection { SubagentLesson }` with 3 filters
- ~~ArtifactIndex as procedural memory~~ → `record_artifact_op` on each tool call, `drifted` flag, summary renderer
- ~~Failure-heuristic separate store (ERL)~~ → `failure_heuristic_recall(error_class)` on the trait + hook in `dispatch_one_tool_call` injects BEFORE retry
- ~~Auto Dream cleanup~~ → `LlmAutodreamExecutor` (916 LOC) with backup, atomic type protection, 24h cooldown, heuristic promotion
- ~~SessionState.relevant_files → recency boost~~ → SessionState seeds from ArtifactIndex + edits_files via iteration lifecycle

### Gaps filled (session 05-12)
- ~~Index as router (bootstrap + lazy)~~ → Specified as Invariant I11 in ARCHITECTURE.md + section 3 in Ch 04. Progressive disclosure: index at bootstrap, payloads on demand.
- ~~LifecycleStatus without Superseded~~ → Added `Superseded` to the enum in Ch 02 + ARCHITECTURE.md. Fields `supersedes`/`superseded_by` on MemoryEntry.
- ~~source_of_truth absent from frontmatter~~ → Field added to MemoryEntry + frontmatter example in Ch 02.
- ~~Memory Lint nonexistent~~ → Step 3 in the Dream pipeline (Ch 05 §4.1). 10 checks (L1-L10). `MemoryLinter` + `LintReport` in ARCHITECTURE.md.
- ~~Uniform TTL~~ → TTL differentiated by type (Ch 05 §7.1): procedural 180d, semantic 180d, failure_heuristic 90d, subagent_lesson 90d.
- ~~Golden rule was not an invariant~~ → Invariant I12 "Do not duplicate sources of truth" in ARCHITECTURE.md + section 4.6 in Ch 01.
- ~~Memory CLI nonexistent~~ → 3 v1 subcommands (store, recall, lint) + roadmap of 9 additional under YAGNI in Ch 02 §9. `MemoryCLI` in ARCHITECTURE.md.
- ~~Staleness verification on recall~~ → Section 8 in Ch 04 with on-read validation diagram (status check → age check → source_of_truth validation).

### Open gaps (priority order — updated 05-12)
1. **CollapseLog → Memory bridge** — Destructive actions do not trigger `on_collapse_action` hook. Cloudflare "bulk ingestion at compaction" pattern. `on_pre_compress` exists in the trait but with no caller in the compaction pipeline.
2. **Bi-temporal validity** — `t_valid` + `t_recorded` for staleness without deleting (Graphiti lite).
3. **Versioned memory writes** — Audit trail / rollback. Anthropic Dreaming does this in production.
4. **Memory from execution trace** — Memori Labs pattern: memory of the trace (paths, tool results, decisions), not the conversation.
5. **Probabilistic memory (BeliefMem)** — Multiple candidate conclusions with probabilities vs deterministic reflections.
6. **Recall quality telemetry** — Feedback-Normalized Dev Memory: log recall quality as a decision process.
7. **Raw episodes alongside summaries** — MemMachine pattern: summary-only loses factual detail.

## SOTA gates (updated 05-11)
- ~~**MEM-G01** Reflection extraction at compaction~~ → **IMPLEMENTED**: `ReflectionStore` + `aggregate_failure_heuristics_from_episodes` + 7-gate pipeline
- **MEM-G02** Versioned memory writes (audit trail) — Anthropic Dreaming validates in production. **OPEN.**
- ~~**MEM-G03** Failure-heuristic recall before LLM call~~ → **IMPLEMENTED**: `failure_heuristic_recall(error_class)` + hook in `dispatch_one_tool_call`
- **MEM-G04** Recall quality telemetry — feedback-normalization of recall. **OPEN.**
- **MEM-G05** Raw episode preservation alongside summaries. **OPEN.**

## Score history
- 2026-04: 4.0/5 (4 files, 1543 lines, RM0-RM5b roadmap)
- 2026-05-05: 4.0/5 unchanged; target 4.5 after Quick Wins #1-3.
- 2026-05-11: **4.5/5** — 10 new sources added. ADR-14 validated in production by Anthropic.
- 2026-05-11 (sync): **4.7/5** — Synced with real implementation. 6 gaps marked as resolved (Reflection pipeline, subagent fold, ArtifactIndex, ERL, Dream, SessionState boost). 2 SOTA gates closed (MEM-G01, MEM-G03). 7 open gaps remaining. 3 SOTA gates open.
- 2026-05-12: **4.85/5** — 8 spec gaps closed: index as router (I11), Superseded lifecycle, source_of_truth, Memory Lint (10 checks), TTL by type, golden rule (I12), Memory CLI (3 subcommands + YAGNI roadmap), staleness verification on-read. 7 implementation gaps remaining.
