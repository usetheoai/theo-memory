# SOTA Memory System — Executable Plan

**Source:** `outputs/agent-memory-sota.md` (research, 3800 words)
**Approval minutes:** `.claude/meetings/20260420-134446-agent-memory-sota.md` (16 agents, REVISED VERDICT with 20 decisions)
**Date:** 2026-04-20
**Target branch:** `evolution/memory-*` (create per phase)

---

## 0. Goal, success metrics, non-goals

**Goal.** Multi-layer memory system (STM/WM/LTM-semantic/LTM-episodic/LTM-procedural/Retrieval/MemoryLesson/Meta) with Karpathy LLM Wiki as LTM-semantic, coordinated by `MemoryEngine` as a decision engine — not storage. The agent remembers projects/preferences across sessions with auditable recovery.

**Success metrics (measured in `benchmark` + `agent memory lint`):**

| Metric | Baseline | Target (after RM5b) |
|---|---|---|
| Wiki-to-recall ratio | N/A | ≥ 30% of pages returned in prefetch |
| Reflections-per-compression | N/A | 2-5 (average) |
| Reflection-hit-rate 30d | N/A | ≥ 40% |
| Orphan episodes | N/A | 0 |
| Wiki manifest staleness | N/A | < 2h in active repos |
| Recall p50 latency | N/A | < 500ms |
| Memory compromise recovery | impossible (edit .md manually) | ≤ 3 clicks in agent-desktop |
| Workspace tests | 2788 | ≥ 2788 |
| Harness score | 75.150 | ≥ 75.150 |

**Explicit non-goals:**

- Continuous fine-tuning (Karpathy end-game): out of MVP. RM7+ potential.
- Sharing memory between users/teams: single-user per user/repo. Multi-tenancy future.
- Integration with commercial providers (Mem0 / Zep hosted): only trait-ready; concrete impl optional.
- Advanced UI (visual knowledge graph Graphiti-style): 3 MVP routes sufficient.
- A-MEM Zettelkasten-style (arXiv:2502.12110): optional post-MVP (RM7).
- Hard budget enforcement: router reports cost; enforcement in separate feature.

---

## 1. Global Definition of Done

Each PR MUST satisfy the 10 gates below before merge:

1. `cargo test --workspace` exits 0 (currently 2788).
2. `cargo check --workspace --tests` emits 0 warnings.
3. Pre-commit hook (`.githooks/pre-commit` + `commit-msg`) passes without `--no-verify`.
4. **No trailer** `Co-Authored-By:` or `Generated-with` (hook enforces).
5. `domain → (nothing)` inviolable; `infra-memory → domain only`.
6. **TDD**: commit body cites the RED test first; implementation comes after.
7. Each phase ≤ 200 LOC (test-runner enforces split if exceeded).
8. Harness score ≥ 75.150.
9. Zero `unwrap()` in production; typed errors via `thiserror`.
10. Doc updated: ADR/`docs/current/memory-architecture.md` + `.agent/evolution_research.md`.

**Extras inherited from the minutes:**

- `tokio::sync::RwLock` (not `std`) in all async concurrency.
- Atomic write via `infra-memory::fs_util::atomic_write` (temp + rename) for all markdown.
- Kill switches + feature flags mandatory before self-evolving (`agent.memory_enabled`, `WIKI_COMPILE_ENABLED`).
- `.gitignore` has `.agent/memory/` + `.agent/wiki/memory/` + `.agent/reflections.jsonl` (personal).

---

## 2. Pre-requisites (RM-pre)

Before any RM starts, 5 blocking items:

### RM-pre-1 — `.gitignore` protects personal data

**Files**: `.gitignore`

**Acceptance criteria**:
| ID | Test | Behavior |
|---|---|---|
| PRE1-AC-1 | `test_gitignore_excludes_theo_memory` | `git check-ignore .agent/memory/test.md` returns 0 |
| PRE1-AC-2 | `test_gitignore_excludes_memory_wiki` | `.agent/wiki/memory/foo.md` ignored |
| PRE1-AC-3 | `test_gitignore_includes_code_wiki` | `.agent/wiki/code/foo.md` NOT ignored |
| PRE1-AC-4 | `test_gitignore_excludes_reflections` | `.agent/reflections.jsonl` ignored |

**DoD**: `.gitignore` committed before any RM writes personal data. **LOC**: 10. **Risk**: Very low.

### RM-pre-2 — `MemoryError` typed enum

**Files**: `crates/domain/src/memory/error.rs` (new, `memory.rs` becomes `memory/mod.rs`)

**Acceptance criteria**:
| ID | Test | Behavior |
|---|---|---|
| PRE2-AC-1 | `test_memory_error_variants_serde_roundtrip` | All variants round-trip |
| PRE2-AC-2 | `test_memory_error_carries_source` | `StoreFailed { key, source }` preserves io::Error |
| PRE2-AC-3 | `test_memory_error_implements_std_error` | `Box<dyn std::error::Error>` accepts MemoryError |

**Schema**:
```rust
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum MemoryError {
    #[error("store write failed for key `{key}`: {source}")]
    StoreFailed { key: String, #[source] source: std::io::Error },
    #[error("wiki compilation failed: {reason}")]
    CompileFailed { reason: String },
    #[error("recall query failed: {source}")]
    RetrieveFailed { #[source] source: Box<dyn std::error::Error + Send + Sync> },
    #[error("lesson gate rejected: {reason}")]
    GateRejected { reason: String },
}
```

**DoD**: enum in domain, 3 tests, exported. **LOC**: ~40. **Risk**: Low.

### RM-pre-3 — Fix `unwrap()` at `run_engine.rs:786`

**Files**: `crates/agent-runtime/src/run_engine.rs`

**Acceptance criteria**:
| ID | Test | Behavior |
|---|---|---|
| PRE3-AC-1 | `test_llm_result_none_returns_typed_error` | `llm_result = None` returns `LlmError::NoResponse` instead of panic |

**DoD**: zero `.unwrap()` in hot path of run_engine. **LOC**: ~20. **Risk**: Low.

### RM-pre-4 — ADR 008 `infra-memory` crate

**Files**: `docs/adr/008-infra-memory.md` (new)

**Acceptance criteria**:
| ID | Test | Behavior |
|---|---|---|
| PRE4-AC-1 | `test_workspace_cargo_toml_lists_12_crates` | `Cargo.toml` members = 12 |
| PRE4-AC-2 | `test_adr_008_exists` | ADR file present and signed |

**ADR content**: justifies the 12th crate by symmetry with `infra-llm`/`infra-auth` (adapters for external services). Documents allowed imports and direction of dependency.

**DoD**: ADR reviewed by arch-validator; CLAUDE.md updates count from 11 to 12 crates. **LOC**: ~80 ADR markdown. **Risk**: Zero (doc only).

### RM-pre-5 — Feature flag `agent.memory_enabled`

**Files**: `crates/agent-runtime/src/config.rs`

**Acceptance criteria**:
| ID | Test | Behavior |
|---|---|---|
| PRE5-AC-1 | `test_memory_enabled_default_false` | `AgentConfig::default().memory_enabled == false` |
| PRE5-AC-2 | `test_memory_enabled_toml_roundtrip` | TOML parse preserves flag |

**DoD**: flag in AgentConfig; default false; documented in `.agent/config.toml.example`. **LOC**: ~15. **Risk**: Very low.

---

## 3. Roadmap (RM0 → RM5b)

Reordered per decision C3 of the minutes: RM3a before RM2.

---

### RM0 — Wire MemoryProvider into agent_loop

**Objective.** Invoke the 4 hooks (`prefetch`, `sync_turn`, `on_pre_compress`, `on_session_end`) in `agent_loop.rs`, gated by `config.memory_enabled`. No active provider → NullMemoryProvider (behavior-preserving).

**Files**:
- `crates/agent-runtime/src/agent_loop.rs` (wire 4 hooks)
- `crates/agent-runtime/src/memory_lifecycle.rs` (new helper)
- `crates/domain/src/memory/null.rs` (may already exist; ensure NullMemoryProvider)
- `crates/agent-runtime/tests/memory_integration_rm0.rs` (new)

**Acceptance criteria**:
| ID | Test | Behavior |
|---|---|---|
| RM0-AC-1 | `test_prefetch_called_before_llm` | `MockProvider` receives `prefetch` before the LLM call |
| RM0-AC-2 | `test_sync_turn_called_after_llm` | `sync_turn(&CompletedTurn)` called after response |
| RM0-AC-3 | `test_on_pre_compress_called` | Hook fires on compaction callback |
| RM0-AC-4 | `test_on_session_end_called` | Hook fires on convergence/abort |
| RM0-AC-5 | `test_memory_disabled_skips_all_hooks` | `memory_enabled=false` → zero invocations |
| RM0-AC-6 | `test_null_provider_preserves_behavior` | Regression: all 2788 tests pass with NullMemoryProvider |
| RM0-AC-7 (integration) | `test_memory_hooks_invoked_in_order` | Sequence recorded: prefetch → llm → sync_turn → [compaction? on_pre_compress] → on_session_end |

**DoD extras**: `MemoryLifecycle` helper extracted; integration test uses `MockProvider` that records sequence; feature flag enforcement tested. **LOC target**: ~120. **Risk**: Medium (hot path). **Dependencies**: RM-pre 1-5.

---

### RM1 — MemoryEngine coordinator

**Objective.** Create `infra-memory` crate and `MemoryEngine` in `application`. Fan-out to multiple providers; error isolation (provider that panics doesn't bring down the loop).

**Files**:
- `crates/infra-memory/Cargo.toml` (new)
- `crates/infra-memory/src/lib.rs`
- `crates/infra-memory/src/fs_util.rs` (atomic_write util)
- `crates/application/src/memory/engine.rs` (new)
- `crates/application/tests/memory_engine.rs` (new)

**Acceptance criteria**:
| ID | Test | Behavior |
|---|---|---|
| RM1-AC-1 | `test_fanout_prefetch_concatenates_results` | 2 providers → results merged via XML fence |
| RM1-AC-2 | `test_panicking_provider_does_not_block_fanout` | Provider A panics → Provider B still runs, logs WARN |
| RM1-AC-3 | `test_only_one_external_provider_allowed` | Register 2 external → WARN + reject 2nd |
| RM1-AC-4 | `test_providers_dispatched_in_registration_order` | Deterministic order |
| RM1-AC-5 | `test_fence_wraps_each_provider_output` | `<memory-context source="provider_id">...</memory-context>` |
| RM1-AC-6 | `test_sync_turn_fans_out_to_all` | Write called on all (broadcast) |
| RM1-AC-7 | `test_tokio_rwlock_allows_concurrent_reads` | Two parallel prefetches complete without deadlock |
| RM1-AC-8 (integration) | `test_engine_end_to_end_with_2_providers` | `MemoryEngine::new(vec![A, B])` + complete cycle |

**DoD extras**: `fs_util::atomic_write` via temp+rename tested; `tokio::sync::RwLock` (not std); new crate cites `domain` only. **LOC target**: ~180. **Risk**: Low (isolated new code). **Dependencies**: RM0.

---

### RM3a — BuiltinMemoryProvider + security scan (reordered: before RM2)

**Objective.** Concrete impl of `MemoryProvider` backed by `.agent/memory/<user-hash>.md`. Security scan port from `hermes memory_tool.py:65-103`. Mandatory idempotency.

**Files**:
- `crates/infra-memory/src/builtin.rs`
- `crates/infra-memory/src/security.rs`
- `crates/infra-memory/src/security_test_cases.toml` (fixture)
- `crates/infra-memory/tests/builtin.rs` (new)

**Acceptance criteria**:
| ID | Test | Behavior |
|---|---|---|
| RM3a-AC-1 | `test_injection_pattern_prompt_rejected` | "ignore previous instructions" blocked |
| RM3a-AC-2 | `test_injection_pattern_exfil_rejected` | "curl.*\\$API_KEY" blocked |
| RM3a-AC-3 | `test_injection_pattern_shell_escape_rejected` | "; rm -rf" blocked |
| RM3a-AC-4 | `test_all_security_patterns_covered` | Iterate `security_test_cases.toml` and assert rejection |
| RM3a-AC-5 | `test_concurrent_writes_serialize` | 10 tokio::spawn writing → no race, file intact |
| RM3a-AC-6 | `test_snapshot_stable_mid_session` | Frozen snapshot preserves state during prefetch |
| RM3a-AC-7 | `test_idempotent_upsert_by_sha256_key` | Same turn 2x → 1 entry |
| RM3a-AC-8 | `test_user_hash_isolation` | user_a does not see user_b's memory |
| RM3a-AC-9 (integration) | `test_memory_md_written_and_recalled_across_sessions` | Session 1 writes; Session 2 prefetch retrieves |

**DoD extras**: `.agent/memory/<user-hash>.md` path resolution; mandatory SHA256 key; security scan test-coverage ≥ 85%; `tokio::fs` only (not std::fs). **LOC target**: ~200 (split if exceeded). **Risk**: Medium-High (security). **Dependencies**: RM1.

---

### RM2 — RetrievalBackedMemory

**Objective.** Provider that delegates `prefetch` to `engine-retrieval`. Namespace `source_type` in Tantivy; thresholds per type; memory_token_budget 15% of total.

**Files**:
- `crates/infra-memory/src/retrieval.rs`
- `crates/engine-retrieval/src/tantivy_search.rs` (add `source_type` field — surgical)
- `crates/engine-retrieval/src/assembly.rs` (add `memory_token_budget`)
- `crates/infra-memory/tests/retrieval.rs` (new)

**Feature flag**:
```toml
[features]
memory-retrieval = ["engine-retrieval"]
# default-off; enabled explicitly by tools/app
```

**Acceptance criteria**:
| ID | Test | Behavior |
|---|---|---|
| RM2-AC-1 | `test_prefetch_queries_retrieval` | MockRetrievalEngine → entries returned |
| RM2-AC-2 | `test_source_type_filter_in_tantivy` | Query with `source_type="memory"` ignores code docs |
| RM2-AC-3 | `test_threshold_per_type_calibrated` | code:0.35, wiki:0.50, reflection:0.60 |
| RM2-AC-4 | `test_memory_budget_15_percent` | Total 20k tokens → memory cap 3k |
| RM2-AC-5 | `test_code_ranking_not_cannibalized` | Memory results don't push code out of topk |
| RM2-AC-6 | `test_no_cross_encoder_for_memory` | Memory path skips reranker (latency) |
| RM2-AC-7 (integration) | `test_end_to_end_prefetch_returns_scored_entries` | Uses existing `three_community_fixture()` |

**DoD extras**: no new physical Tantivy index; filter at query time; test reuses existing fixture; feature gate tested compile-without. **LOC target**: ~150. **Risk**: Medium (touches retrieval). **Dependencies**: RM3a (Builtin must be stable).

---

### RM4 — MemoryLesson (renamed) + 7 gates

**Objective.** New `MemoryLesson` type (not "Reflection" — collides with `domain::evolution::Reflection`). 7 write-path gates: confidence bounds, evidence count, contradiction scan, provenance hash lock, semantic dedup, 7d quarantine, aging decay.

**Files**:
- `crates/domain/src/memory/lesson.rs` (new)
- `crates/domain/src/memory/gates.rs` (new — traits)
- `crates/infra-memory/src/lesson_store.rs` (concrete impl)
- `crates/agent-runtime/src/lesson_bridge.rs` (integrates with existing reflector.rs)
- `crates/agent-runtime/tests/lesson.rs` (new)

**Schema**:
```rust
pub struct MemoryLesson {
    pub id: Ulid,
    pub lesson: String,
    pub trigger: String,
    pub confidence: f32,                         // 0.6..0.95
    pub evidence_event_ids: Vec<String>,         // len >= 2
    pub evidence_hashes: Vec<[u8; 32]>,          // SHA256 on write
    pub category: LessonCategory,                // Semantic/Procedural/Meta
    pub status: LessonStatus,                    // Quarantine/Confirmed/Retracted
    pub created_at: DateTime<Utc>,
    pub promoted_at: Option<DateTime<Utc>>,
    pub last_hit_at: Option<DateTime<Utc>>,
    pub hit_count: u32,
}
```

**Acceptance criteria**:
| ID | Test | Behavior |
|---|---|---|
| RM4-AC-1 | `test_confidence_099_rejected` | confidence >= 0.95 → GateRejected |
| RM4-AC-2 | `test_confidence_below_06_rejected` | confidence < 0.6 → GateRejected |
| RM4-AC-3 | `test_single_evidence_rejected` | evidence_event_ids.len() < 2 → GateRejected |
| RM4-AC-4 | `test_contradiction_scan_rejects_cosine_0_85` | Semantic dup against existing store → reject |
| RM4-AC-5 | `test_provenance_hash_locked_on_write` | evidence_hashes recorded; prefetch validates existence |
| RM4-AC-6 | `test_semantic_dedup_by_normalized_lesson` | Fingerprint `hash(normalize(lesson))` prevents dup |
| RM4-AC-7 | `test_new_lesson_starts_quarantine` | status = Quarantine |
| RM4-AC-8 | `test_promote_after_7d_and_1_hit` | Quarantine → Confirmed after period + recall |
| RM4-AC-9 | `test_jsonl_roundtrip` | serde preserves |
| RM4-AC-10 (integration) | `test_repeated_error_pattern_generates_lesson` | `FailurePattern::RepeatedSameError` (reflector.rs) → Lesson created with source=repeated_error |

**DoD extras**: integrates with existing `reflector.rs::classify_failure()` (not parallel detector); quarantine prefix "unverified lesson:" in prefetch; `wiki_expunge` tool for auditable retraction. **LOC target**: ~200 (split if exceeded). **Risk**: Medium. **Dependencies**: RM3a + RM2.

---

### RM5a — Wiki hash + lint (pure, zero LLM)

**Objective.** Hash-based incremental trigger + `wiki_lint` with schema check (mandatory namespace) + broken-link + cross-namespace check. Zero LLM call.

**Files**:
- `crates/infra-memory/src/wiki/hash.rs`
- `crates/infra-memory/src/wiki/lint.rs`
- `crates/domain/src/memory/wiki_backend.rs` (trait `MemoryWikiBackend`)
- `crates/infra-memory/tests/wiki_lint.rs` (new)

**Disk files structure**:
```
.agent/wiki/memory/
  .hashes.json            # sha256 map per source
  .metadata.json          # last_compile_timestamp
  concepts/*.md           # compiled pages (namespace: memory)
  reflections/*.md        # compiled from lessons
  journal/*.jsonl         # raw events
```

**Acceptance criteria**:
| ID | Test | Behavior |
|---|---|---|
| RM5a-AC-1 | `test_unchanged_source_skip_recompile` | Hash manifest detects dirty; unchanged = zero work |
| RM5a-AC-2 | `test_dirty_source_marks_for_recompile` | SHA changes → marker in `.hashes.json` |
| RM5a-AC-3 | `test_lint_rejects_page_without_namespace` | Frontmatter without `namespace:` → LintError |
| RM5a-AC-4 | `test_lint_detects_broken_link` | `[[nonexistent]]` → LintError |
| RM5a-AC-5 | `test_lint_cross_namespace_link_resolves` | `[[code:domain]]` OK if code wiki exists |
| RM5a-AC-6 | `test_memory_wiki_mount_isolated_from_code_wiki` | Two paths physically separated |

**DoD extras**: `MemoryWikiBackend` trait separate from existing `WikiBackend` (don't reuse `WikiInsightInput`); 0 LLM calls in RM5a. **LOC target**: ~120. **Risk**: Low (pure). **Dependencies**: RM4 (lessons feed reflections page gen in 5b).

---

### RM5b — Wiki compiler with MockLLM (mandatory determinism)

**Objective.** 2-phase compiler (parallel extract + sequential generate) using `Compaction` routing layer (temperature 0 + fixed seed). Hard limits: `max_llm_calls_per_compile`, `max_cost_usd_per_compile`.

**Files**:
- `crates/infra-memory/src/wiki/compiler.rs`
- `crates/infra-memory/tests/wiki_compiler.rs` (with MockCompilerLLM)
- `crates/test-memory-fixtures/src/mock_llm.rs` (new crate)

**Acceptance criteria**:
| ID | Test | Behavior |
|---|---|---|
| RM5b-AC-1 | `test_two_compilations_produce_byte_identical_output` | Determinism: temp=0 + seed → identical |
| RM5b-AC-2 | `test_parallel_extract_phase_within_budget` | N sources parallel via `tokio::spawn`; generate sequential |
| RM5b-AC-3 | `test_max_llm_calls_hard_limit_enforced` | Exceeds limit → `CompileFailed { reason: "budget" }` |
| RM5b-AC-4 | `test_max_cost_hard_limit_enforced` | Exceeds $ cap → abort with typed error |
| RM5b-AC-5 | `test_frontmatter_contract_enforced` | Output has `source_events`, `evidence`, `confidence`, `schema_version` |
| RM5b-AC-6 | `test_kill_switch_blocks_compile` | `WIKI_COMPILE_ENABLED=false` → early return without calls |
| RM5b-AC-7 | `test_cache_hit_rate_above_80_percent_on_second_compile` | Rerun without change → >= 80% hash-skip |
| RM5b-AC-8 (integration) | `test_wiki_compile_tool_injects_manifest_in_system_prompt` | Tool invoked → next turn sees manifest in system prompt |

**DoD extras**: `Compaction` role routing layer; `mpsc::Sender<MemoryError>` for non-blocking logging; determinism ADR; integration with `test-memory-fixtures`. **LOC target**: ~200. **Risk**: High (LLM, cost, determinism). **Dependencies**: RM5a + `test-memory-fixtures` crate.

---

### UI — agent-desktop memory routes (parallel with RM3a+)

**Objective.** 3 MVP routes in `agent-desktop` for memory poisoning recovery.

**Files**:
- `apps/agent-desktop/src/commands/memory.rs` (Tauri commands)
- `apps/agent-ui/src/routes/memory/episodes.tsx` (new)
- `apps/agent-ui/src/routes/memory/wiki.tsx` (new)
- `apps/agent-ui/src/routes/memory/settings.tsx` (new)

**Tauri commands**:
- `get_episodes(limit, offset) -> Vec<EpisodeSummary>`
- `dismiss_episode(id) -> Result<(), MemoryError>`
- `list_wiki_pages() -> Vec<WikiPageMeta>`
- `get_wiki_page(slug) -> String`
- `run_wiki_lint() -> Vec<LintIssue>`
- `trigger_wiki_compile() -> Result<(), MemoryError>`
- `get_memory_settings() -> MemorySettings`
- `save_memory_settings(settings)`

**Acceptance criteria**:
| ID | Test | Behavior |
|---|---|---|
| UI-AC-1 | `episodes.spec.tsx` | Timeline renders with cards ordered by date |
| UI-AC-2 | `episodes.spec.tsx` | "Dismiss" button calls `dismiss_episode` Tauri command |
| UI-AC-3 | `wiki.spec.tsx` | Grid of pages with markdown syntax highlight |
| UI-AC-4 | `wiki.spec.tsx` | `[[links]]` clickable navigate between pages |
| UI-AC-5 | `settings.spec.tsx` | 3 sections: Retention, Forgetting, Privacy |
| UI-AC-6 | `settings.spec.tsx` | Save persists via `save_memory_settings` |
| UI-AC-7 (Tauri) | `test_get_episodes_command` | Rust side returns valid `Vec<EpisodeSummary>` |
| UI-AC-8 (Tauri) | `test_trigger_wiki_compile_respects_kill_switch` | Kill switch honored in UI too |

**DoD extras**: 3 routes tested with vitest; 2 Tauri commands tested in Rust; privacy checkbox respects `.gitignore` policy. **LOC target**: ~200 (React) + ~80 (Rust Tauri). **Risk**: Medium (UX). **Dependencies**: RM3a (can start). `/wiki` stays with placeholder until RM5b.

---

### Test infra — `test-memory-fixtures`

**Objective.** Test-only crate with deterministic mocks for RM2/RM5.

**Files**:
- `crates/test-memory-fixtures/Cargo.toml` (new)
- `crates/test-memory-fixtures/src/lib.rs`
- Exports: `MockCodeGraph::three_communities()`, `MockCompilerLLM::with_response(json)`, `MockRetrievalEngine::scored(entries)`

**DoD**: crate in `[dev-dependencies]` of RM2 and RM5b; does not enter production. **LOC target**: ~150. **Risk**: Very low. **Dependencies**: none.

---

### Health monitoring — `agent memory lint`

**Objective.** CLI command that reports memory health. 6 continuous metrics.

**Files**:
- `apps/agent-cli/src/commands/memory_lint.rs`
- `crates/infra-memory/src/lint.rs` (core logic)

**Acceptance criteria**:
| ID | Test | Behavior |
|---|---|---|
| LINT-AC-1 | `test_wiki_staleness_detected` | Fixture with manifest > 2h → warning |
| LINT-AC-2 | `test_reflection_zero_hit_flagged` | Reflection created 30d+ with 0 hits → concern |
| LINT-AC-3 | `test_orphan_episode_reported` | Episode without link/reflection → info |
| LINT-AC-4 | `test_broken_link_in_wiki_page_flagged` | `[[nonexistent]]` → warning |
| LINT-AC-5 | `test_recall_p50_exceeds_500ms_flagged` | Simulates high latency → warning |
| LINT-AC-6 | `test_json_output_parseable_by_jq` | `agent memory lint --output json \| jq .` passes |

**DoD extras**: 4 severity levels (critical/warning/concern/info); integrates with `MemoryProvider::on_metrics()` hook (RM0); optional weekly cron. **LOC target**: ~180. **Risk**: Low. **Dependencies**: RM5b.

---

## 4. Dependency graph

```
RM-pre (5 items, parallel)
   |
   v
RM0 (wiring) ─────────────┐
   |                       |
   v                       |
RM1 (MemoryEngine) ────────┤
   |                       |
   v                       v
RM3a (Builtin) ────────> UI (parallel, /wiki placeholder)
   |                       
   v                       
RM2 (retrieval) ──────┐    
   |                  |    
   v                  v    
RM4 (MemoryLesson) ──┤    
   |                  |    
   v                  v    
RM5a (hash + lint) ──┤    
   |                  |    
   v                  v    
RM5b (compiler) ─────┴───> Lint tool (health)
```

**Parallelizable**:
- RM-pre (5 items between them)
- UI starts after RM3a (without waiting for RM5)
- `test-memory-fixtures` before RM2

---

## 5. Rollout timeline

Assuming 1 phase ≈ 1 sprint (1 week of focus, pre-reqs smaller):

```
Sprint 0 (2-3 days)   RM-pre (all 5 in parallel)
Sprint 1              RM0 (wiring)
Sprint 2              RM1 (MemoryEngine)
Sprint 3              RM3a (Builtin + security) + UI start
Sprint 4              RM2 (retrieval) + UI (/episodes /settings ready)
Sprint 5              RM4 (MemoryLesson + 7 gates)
Sprint 6              RM5a (hash + lint)
Sprint 7              RM5b (compiler with MockLLM) + UI /wiki real
Sprint 8              Lint tool (health monitoring) + final docs
```

**Gate between sprints**: at the end of each, `cargo test --workspace` green + harness score >= 75.150. No upgrade → back to IMPLEMENT.

---

## 6. What this plan does NOT cover

- **Continuous fine-tuning** (Karpathy end-game). Requires training pipeline, dataset curation, model deployment — out of MVP scope.
- **Multi-user/multi-tenant sharing** of memory. Single-user assumed. Sharing requires policy engine + consent model separate.
- **A-MEM Zettelkasten** (arXiv:2502.12110). Research-agent flagged as omission. Optional RM7.
- **Graphiti temporal KG integration**. Overlay has basic cross-ref (stable IDs); full temporal graph stays for RM7+.
- **Learned classifier for when to compile wiki**. Today: hash-based dirty flag. Future: ML-based trigger.
- **Global hard budget enforcement**. Router reports; enforcement by dedicated feature.
- **Automatic memory export / backup**. User can `git commit .agent/wiki/memory/` if desired; dedicated tooling stays for 2nd wave.
- **Encryption at rest** for memory. MVP privacy scope is filesystem + gitignore. Encryption = RM8+.

---

## 7. Ready-to-execute checklist

Before starting **RM-pre**:

- [ ] Meeting minutes `.claude/meetings/20260420-134446-agent-memory-sota.md` merge-ready.
- [ ] Research `outputs/agent-memory-sota.md` referenceable.
- [ ] Branch `evolution/memory-pre` created from `develop`.
- [ ] Baseline snapshotted: harness score, test count, warnings count.
- [ ] Secrets scan confirmed (no key in `.agent/memory/` historical).

Before starting **RM0**:

- [ ] All 5 pre-reqs merged into `develop`.
- [ ] ADR 008 approved by arch-validator.
- [ ] `test-memory-fixtures` crate scaffolded.

Before activating **`memory_enabled=true` in production**:

- [ ] RM5b finished.
- [ ] Lint tool functional with 6 metrics.
- [ ] UI 3 routes available.
- [ ] 7d quarantine period validated in fixture.
- [ ] Kill switches tested (WIKI_COMPILE_ENABLED=false blocks).
- [ ] Release notes with privacy disclosure.

---

## 8. Traceability — phase → minutes decision

| Phase | Minutes decisions covered |
|---|---|
| RM-pre-1 (.gitignore) | #1, #2, blocker knowledge-compiler |
| RM-pre-2 (MemoryError) | #8, concern code-reviewer |
| RM-pre-3 (fix unwrap) | #8, concern code-reviewer |
| RM-pre-4 (ADR) | #1, #2, concern arch-validator |
| RM-pre-5 (feature flag) | #1, #2 |
| RM0 | #10, #16 (expanded sync_turn hooks) |
| RM1 | #8, #16, concern code-reviewer (RwLock, atomic write) |
| RM3a | #8, #11, #18, #19 (user-hash path) |
| RM2 | #12, concern retrieval-engineer (threshold per type) |
| RM4 | #3 (rename), #4 (7 gates), #16 (integrate reflector.rs), #20 (wiki_expunge) |
| RM5a | #5 (schema), #6 (two mounts), #7 (unidirectional) |
| RM5b | #9 (determinism), #18 (kill switch + hard limits), concern memory-synthesizer (parallelize extract) |
| UI | #13 (3 MVP routes after RM3a) |
| Lint tool | #14 (6 metrics + `agent memory lint`) |
| `test-memory-fixtures` | #15 (test infra) |

Each decision in the minutes has at least one phase that implements it. Each phase has at least one decision that justifies it.
