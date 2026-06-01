# Memory Systems — Reference Architecture

> **Version:** 2.0 — 2026-05-11
> **Based on:** cross-validation of 12 production implementations + 20+ academic papers + CoALA taxonomy (TMLR 2024) + production validation (Anthropic Dreaming, May 2026)
> **Scope:** Complete language-agnostic architecture of SOTA Memory Systems for code agents

---

## 1. Context

This document is the architectural reference of the Memory Systems module. It defines components, interfaces, flows, and invariants without reference to any specific language or implementation. The diagrams use UML (Mermaid) and can be mapped to any stack.

For the concepts and evidence behind each decision, consult the individual chapters:

| Chapter | Focus |
|---|---|
| [01_conceitos_fundamentais.md](01_conceitos_fundamentais.md) | Problem, taxonomy, invariants |
| [02_arquitetura.md](02_arquitetura.md) | Overview of the 5 components |
| [03_estrategias_escrita.md](03_estrategias_escrita.md) | Explicit vs automatic writes |
| [04_mecanismos_recall.md](04_mecanismos_recall.md) | 4 recall mechanisms |
| [05_consolidacao_dream.md](05_consolidacao_dream.md) | Dream consolidation |
| [06_llm_auxiliar.md](06_llm_auxiliar.md) | Tiered model system |
| [07_seguranca.md](07_seguranca.md) | Threat model and defenses |
| [08_fronteira.md](08_fronteira.md) | Emerging paradigms |

---

## 2. Component Diagram (C4 Level 2)

```mermaid
graph TB
    subgraph "Agent Runtime"
        AL["Agent Loop"]
        TC["Tool Coordinator"]
    end
    
    subgraph "Memory Domain"
        ME["Memory Engine<br/>(coordinator)"]
        
        subgraph "Providers"
            BP["Built-in Provider<br/>(Markdown flat)"]
            WP["Wiki Provider<br/>(compiled knowledge)"]
            RP["Retrieval Provider<br/>(BM25/hybrid)"]
        end
        
        subgraph "Core"
            MS["Memory Store"]
            RS["Reflection Store"]
            SS["Security Scanner"]
        end
        
        subgraph "Policies"
            WPol["Write Policy"]
            FPol["Forget Policy"]
            RPol["Rank Policy"]
        end
        
        subgraph "Maintenance"
            DC["Dream Consolidator"]
            MR["Memory Reviewer"]
            LC["Lifecycle Manager"]
        end
    end
    
    subgraph "Context Domain"
        CE["Context Engine"]
    end
    
    subgraph "Auxiliary"
        ALM["Auxiliary LLM<br/>(Haiku/Sonnet-class)"]
    end
    
    AL -->|"store_memory<br/>(tool call)"| TC
    TC -->|"write"| ME
    ME --> BP
    ME --> WP
    ME --> RP
    
    BP --> MS
    WP --> MS
    RP --> MS
    RS --> MS
    
    ME -->|"validate"| SS
    ME --> WPol
    ME --> FPol
    ME --> RPol
    
    ME -->|"recall blocks"| CE
    CE -->|"prompt"| AL
    
    DC --> MS
    DC --> ALM
    MR --> MS
    MR --> ALM
    LC --> MS
    
    style ME fill:#bbdefb
    style CE fill:#c8e6c9
    style ALM fill:#fff9c4
```

---

## 3. Class Diagram

### 3.1 Core Interfaces

```mermaid
classDiagram
    class MemoryProvider {
        <<interface>>
        +prefetch(query: String, session_id: String) RecallBlock
        +sync_turn(user_msg: Message, assistant_msg: Message, session_id: String) void
        +on_pre_compress(messages: List~Message~) void
        +on_session_end(session_id: String) void
        +write_reflection(reflection: Reflection) Result
        +reflection_recall(query: String) List~Reflection~
        +failure_heuristic_recall(error_class: ErrorClass) List~Reflection~
        +promote_quarantined(id: String) Result
        +take_last_recall_report() RecallReport
    }
    
    class MemoryStore {
        <<interface>>
        +write(entry: MemoryEntry) Result
        +read(id: String) Optional~MemoryEntry~
        +query(filter: QueryFilter) List~MemoryEntry~
        +delete(id: String) Result
        +list_all() List~MemoryEntry~
        +backup(target_path: String) Result
        +count() int
    }
    
    class WritePolicy {
        <<interface>>
        +plan(context: WriteContext) List~WriteAction~
    }
    
    class ForgetPolicy {
        <<interface>>
        +plan(context: ForgetContext) List~ForgetAction~
    }
    
    class RankPolicy {
        <<interface>>
        +score(entries: List~MemoryEntry~, context: RankContext) List~ScoredEntry~
    }
    
    class SecurityScanner {
        <<interface>>
        +scan(content: String) ScanResult
        +is_safe(entry: MemoryEntry) bool
    }
```

### 3.2 Data Types

```mermaid
classDiagram
    class MemoryEntry {
        +String id
        +String name
        +String description
        +MemoryType type
        +LifecycleStatus status
        +String content
        +float confidence
        +DateTime created_at
        +DateTime last_accessed
        +DateTime last_verified_at
        +int access_count
        +int ttl_days
        +List~String~ source_of_truth
        +List~String~ supersedes
        +List~String~ superseded_by
        +validate() bool
        +is_stale() bool
    }
    
    class MemoryType {
        <<enumeration>>
        Procedural
        Semantic
        FailureHeuristic
        SubagentLesson
    }
    
    class LifecycleStatus {
        <<enumeration>>
        Active
        Cooling
        Superseded
        Archived
    }
    
    class Reflection {
        +String id
        +String lesson
        +String trigger
        +float confidence
        +List~String~ evidence_ids
        +ReflectionCategory category
        +ReflectionState state
        +DateTime created_at
    }
    
    class ReflectionCategory {
        <<enumeration>>
        Procedural
        Semantic
        FailureHeuristic
        SubagentLesson
    }
    
    class ReflectionState {
        <<enumeration>>
        Quarantine
        Confirmed
        Invalidated
    }
    
    class RecallBlock {
        +String content
        +float relevance_score
        +String source_id
        +DateTime retrieved_at
        +bool is_fenced
    }
    
    class RecallReport {
        +int entries_scanned
        +int entries_returned
        +int budget_used_bytes
        +Duration latency
        +String mechanism_type
    }
    
    class ErrorClass {
        <<enumeration>>
        CompilationError
        TestFailure
        Timeout
        PermissionDenied
        NetworkError
        ParseError
        ResourceExhausted
        Unknown
    }
    
    MemoryEntry --> MemoryType
    MemoryEntry --> LifecycleState
    Reflection --> ReflectionCategory
    Reflection --> ReflectionState
```

### 3.3 Coordinator and Providers

```mermaid
classDiagram
    class MemoryEngine {
        -List~MemoryProvider~ providers
        -WritePolicy write_policy
        -ForgetPolicy forget_policy
        -RankPolicy rank_policy
        -SecurityScanner scanner
        +register_provider(provider: MemoryProvider) Result
        +prefetch(query: String, session_id: String) RecallBlock
        +sync_turn(user: Message, assistant: Message, session_id: String) void
        +on_pre_compress(messages: List~Message~) void
        +on_session_end(session_id: String) void
        +write(entry: MemoryEntry) Result
    }
    
    class BuiltinProvider {
        -MemoryStore store
        -snapshot: Frozen~List~MemoryEntry~~
        +prefetch(query, session_id) RecallBlock
        +load_snapshot() void
        +write(entry) Result
    }
    
    class WikiProvider {
        -MemoryStore store
        -compiler: WikiCompiler
        +prefetch(query, session_id) RecallBlock
        +compile(sources: List~Source~) Result
        +lint() List~Issue~
    }
    
    class RetrievalProvider {
        -index: SearchIndex
        +prefetch(query, session_id) RecallBlock
        +reindex() void
    }
    
    class NullProvider {
        +prefetch(query, session_id) EmptyRecallBlock
    }
    
    class DreamConsolidator {
        -MemoryStore store
        -AuxiliaryLLM llm
        -MemoryLinter linter
        -TriggerConfig config
        +check_trigger() bool
        +consolidate() ConsolidationResult
        +backup() BackupResult
        -is_protected(entry: MemoryEntry) bool
        -merge(candidates: List~MemoryEntry~) MemoryEntry
    }
    
    class MemoryLinter {
        -MemoryStore store
        +lint() LintReport
        +fix(report: LintReport) FixResult
        -check_frontmatter(entry: MemoryEntry) List~LintIssue~
        -check_index_consistency() List~LintIssue~
        -check_duplicates() List~LintIssue~
        -check_staleness() List~LintIssue~
    }
    
    class LintReport {
        +int errors
        +int warnings
        +List~LintIssue~ issues
        +List~String~ blocked_entries
        +List~String~ suggestions
    }
    
    class LifecycleManager {
        -ForgetPolicy policy
        +decay(entries: List~MemoryEntry~) List~LifecycleTransition~
        +prune_eligible(entries: List~MemoryEntry~) List~MemoryEntry~
        +apply_ttl(entries: List~MemoryEntry~) List~LifecycleTransition~
    }
    
    class MemoryCLI {
        -MemoryEngine engine
        -MemoryLinter linter
        +store(type: MemoryType, name: String, content: String) Result
        +recall(query: String) List~RecallBlock~
        +lint(fix: bool) LintReport
    }
    
    MemoryEngine --> "1..*" MemoryProvider
    MemoryEngine --> WritePolicy
    MemoryEngine --> ForgetPolicy
    MemoryEngine --> RankPolicy
    MemoryEngine --> SecurityScanner
    
    MemoryProvider <|.. BuiltinProvider
    MemoryProvider <|.. WikiProvider
    MemoryProvider <|.. RetrievalProvider
    MemoryProvider <|.. NullProvider
    
    BuiltinProvider --> MemoryStore
    WikiProvider --> MemoryStore
    RetrievalProvider --> MemoryStore
    
    DreamConsolidator --> MemoryStore
    DreamConsolidator --> MemoryLinter
    MemoryLinter --> MemoryStore
    MemoryLinter --> LintReport
    LifecycleManager --> ForgetPolicy
    MemoryCLI --> MemoryEngine
    MemoryCLI --> MemoryLinter
```

---

## 4. State Diagrams

### 4.1 Memory Entry Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Active : store_memory()
    
    Active --> Active : access (refresh TTL)
    Active --> Cooling : no access > ttl_days
    Active --> Superseded : new entry supersedes this
    
    Cooling --> Active : access (reactivation)
    Cooling --> Archived : no access > 2× ttl_days
    Cooling --> Superseded : new entry supersedes this
    
    Superseded --> [*] : Dream prune
    
    Archived --> Cooling : access (reactivation)
    Archived --> [*] : Dream prune
    
    state Active {
        [*] --> HighRelevance
        HighRelevance --> MediumRelevance : score decay
        MediumRelevance --> LowRelevance : score decay
    }
```

**Superseded** is different from Archived: a superseded entry has been **replaced** by another more current one (via the `superseded_by` field). Recall ignores superseded entries. Dream removes them in the next cycle.

### 4.2 Reflection Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Quarantine : write_reflection()
    
    Quarantine --> Confirmed : additional evidence<br/>(≥2 observations)
    Quarantine --> Invalidated : contradiction detected
    Quarantine --> [*] : timeout (>30 days without confirmation)
    
    Confirmed --> Confirmed : access (strengthen)
    Confirmed --> Invalidated : stronger contradiction
    
    Invalidated --> [*] : Dream prune
```

### 4.3 Dream Consolidation States

```mermaid
stateDiagram-v2
    [*] --> Idle : system start
    
    Idle --> Checking : timer tick
    Checking --> Idle : conditions not met
    Checking --> Locked : acquire lock
    
    Locked --> Scanning : lock acquired
    Scanning --> BackingUp : files found
    BackingUp --> Filtering : backup complete
    Filtering --> Merging : candidates identified
    Merging --> Writing : LLM merge complete
    Writing --> Pruning : consolidated file written
    Pruning --> Indexing : originals deleted
    Indexing --> Idle : index regenerated + lock released
    
    Locked --> Idle : lock unavailable
    BackingUp --> Idle : backup failed (abort)
    Merging --> Idle : LLM failed (abort, backup intact)
```

---

## 5. Sequence Diagrams

### 5.1 Complete Session Lifecycle

```mermaid
sequenceDiagram
    participant User
    participant Agent as Agent Loop
    participant ME as Memory Engine
    participant BP as Built-in Provider
    participant WP as Wiki Provider
    participant CE as Context Engine
    participant Store as Memory Store
    
    Note over Agent: === BOOTSTRAP ===
    Agent->>ME: prefetch(session_context)
    par Fan-out to providers
        ME->>BP: prefetch()
        ME->>WP: prefetch()
    end
    BP->>Store: load snapshot
    Store-->>BP: entries[]
    BP-->>ME: recall_block_1
    WP-->>ME: recall_block_2
    ME->>ME: rank + merge + budget
    ME-->>CE: fenced recall blocks
    
    Note over Agent: === MAIN LOOP ===
    loop Each Turn
        User->>Agent: message
        CE->>Agent: build prompt (messages + recall)
        Agent->>Agent: LLM inference
        Agent-->>User: response
        
        Agent->>ME: sync_turn(user_msg, assistant_msg)
        
        opt Every N turns (auto recall)
            ME->>Store: query(context_hints)
            Store-->>ME: new candidates
            ME-->>CE: updated recall blocks
        end
        
        opt Agent decides to save
            Agent->>ME: store_memory(entry)
            ME->>ME: security scan
            ME->>Store: write(entry)
        end
        
        opt Context pressure (compaction)
            CE->>ME: on_pre_compress(messages)
            Note over ME: NOTIFY only,<br/>no auto-extract
        end
    end
    
    Note over Agent: === SESSION END ===
    Agent->>ME: on_session_end()
    ME->>Store: flush pending writes
```

### 5.2 Recall with 4 Mechanisms

```mermaid
sequenceDiagram
    participant Agent as Agent Loop
    participant RE as Recall Engine
    participant Store as Memory Store
    participant CE as Context Engine
    
    Note over Agent: Mechanism 1: Auto per-N-turns
    Agent->>RE: auto_trigger(turn_count=5)
    RE->>RE: check hash(manifest)
    alt Hash changed
        RE->>Store: query(context_hints)
        RE-->>CE: recall blocks
    else Hash unchanged
        RE-->>Agent: SKIP
    end
    
    Note over Agent: Mechanism 2: On-demand tool
    Agent->>RE: recall_memory("redis timeout")
    RE->>Store: query("redis timeout")
    RE-->>CE: recall blocks
    
    Note over Agent: Mechanism 3: Loop reload
    Agent->>RE: reload_diff()
    RE->>Store: get_since(last_recall_timestamp)
    RE-->>CE: new entries only
    
    Note over Agent: Mechanism 4: JIT file-access
    Agent->>Agent: read_file("src/cache/redis.rs")
    Agent->>RE: jit_recall("src/cache/redis")
    RE->>Store: query_by_path("cache", "redis")
    RE-->>CE: associated memories
```

### 5.3 Write with Security Scan

```mermaid
sequenceDiagram
    participant Agent as Agent (LLM)
    participant ME as Memory Engine
    participant SS as Security Scanner
    participant WP as Write Policy
    participant Store as Memory Store
    participant Idx as Index
    
    Agent->>ME: store_memory(type, name, content)
    
    ME->>SS: scan(content)
    alt Injection Pattern
        SS-->>ME: REJECT("prompt injection detected")
        ME-->>Agent: Error: content rejected
    else Exfiltration Pattern
        SS-->>ME: REJECT("exfiltration attempt")
        ME-->>Agent: Error: content rejected
    else Clean
        SS-->>ME: PASS
        ME->>ME: validate_frontmatter(type, name)
        ME->>WP: plan(write_context)
        WP-->>ME: WriteAction(store, entry)
        ME->>Store: write(entry)
        Store->>Idx: update_index(entry)
        Store-->>ME: OK
        ME-->>Agent: Memory saved successfully
    end
```

---

## 6. Architectural Invariants

| # | Invariant | Consequence |
|---|---|---|
| **I1** | Memory → Context (unidirectional) | Context Engine NEVER writes to Memory |
| **I2** | Explicit writes | Only the agent (LLM) decides what to persist |
| **I3** | No embeddings | Recall uses substring, Jaccard, BM25 — never dense vectors |
| **I4** | Compaction does not persist to Memory | Summaries are ephemeral, do not enter the memory store |
| **I5** | Atomic types protected | user, feedback, reference NEVER consolidated |
| **I6** | Backup before mutation | Dream NEVER modifies without prior backup |
| **I7** | Error isolation | Provider failure does not crash the agent loop |
| **I8** | Frozen snapshot | System prompt memory does not change mid-session |
| **I9** | Recall budget | Recall never exceeds cumulative budget (60KB default) |
| **I10** | Auxiliary model for volume | Compaction and selection use cheap model, not main |
| **I11** | Index is router, not memory | Index is injected at bootstrap; payloads are lazy-loaded on demand |
| **I12** | Do not duplicate sources of truth | Anything code, Git, tests, or docs prove should not be saved as memory |

---

## 7. Governing ADRs

| ADR | Title | Chapter |
|---|---|---|
| **ADR-01** | No Embeddings — Recall by Substring + Relevance Score | [Ch. 04](04_mecanismos_recall.md) |
| **ADR-02** | Explicit (Agent-Driven) Writes, Not Automatic | [Ch. 03](03_estrategias_escrita.md) |
| **ADR-09** | Pre-Compaction Hook (Notify, Not Extract) | [Ch. 03](03_estrategias_escrita.md) |
| **ADR-11** | Auxiliary LLM — Cheap Model for Volume | [Ch. 06](06_llm_auxiliar.md) |
| **ADR-14** | Dream Consolidation with Atomic Types Protection | [Ch. 05](05_consolidacao_dream.md) |
| **ADR-15** | Recall Frequency — 4 Complementary Mechanisms | [Ch. 04](04_mecanismos_recall.md) |

---

## 8. Comparative of Approaches (Industry)

| Dimension | Explicit Write | Automatic Write | Hybrid Write |
|---|---|---|---|
| **Write strategy** | Agent tool call | Heuristic extraction | Agent + inbox approval |
| **Categories** | 4-5 typed types | 0-1 (flat) | 3-4 (hierarchical) |
| **Recall** | Multi-mechanism + budget | Sequential/full dump | File-system glob + JIT |
| **Consolidation** | Automatic Dream | Manual/none | Auto + inbox |
| **Security** | Threat scan + fence + frozen | None/minimal | Approval gate |
| **Auxiliary LLM** | Tiered (cheap/intermediate) | Tiered | Background |

| Dimension | Markdown Store | SQLite Store | Knowledge Graph |
|---|---|---|---|
| **Human-readable** | Yes | No | Partial |
| **Git-friendly** | Yes | No | No |
| **Query power** | Low (substring) | High (SQL) | High (traversal) |
| **Infrastructure** | None | SQLite runtime | Graph DB |
| **Scalability** | Hundreds of entries | Thousands | Thousands+ |

---

## 9. References

| Paper | Venue | Contribution to the architecture |
|---|---|---|
| CoALA (arXiv:2309.02427) | TMLR 2024 | Base taxonomy: 4 memory types |
| MemGPT (arXiv:2310.08560) | 2023 | Agent-driven paging — the agent manages its own memory |
| The Memory Curse (arXiv:2605.08060) | 2026 | Controlled volume is essential — indiscriminate recall degrades |
| MemMachine (arXiv:2604.04853) | 2026 | Summaries + raw episodes > summaries-only |
| Anthropic Dreaming | Production, May 2026 | Dream consolidation validated with 6x improvement |
| MemoryBank (arXiv:2305.10250) | AAAI 2024 | Forgetting curve for lifecycle management |
| ERL (arXiv:2603.24639) | 2026 | Failure heuristics > success heuristics |
| Storage→Experience (arXiv:2605.06716) | 2026 | Evolutionary maturity taxonomy |
