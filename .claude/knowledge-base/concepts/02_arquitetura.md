# Memory Systems Architecture

> **Based on:** cross-validation of 12 production implementations + CoALA taxonomy (arXiv:2309.02427) + Anthropic Dreaming (May 2026)

---

## 1. Overview: 5 Components

A SOTA memory system is composed of 5 components that collaborate in a continuous cycle:

```
┌─────────────────────────────────────────────────────────────┐
│                       AGENT LOOP                             │
│                                                              │
│   ┌──────────────┐    recall blocks    ┌────────────────┐   │
│   │              │ ──────────────────► │                │   │
│   │   MEMORY     │                     │    CONTEXT     │   │
│   │  (durable)   │                     │  (ephemeral)   │   │
│   │              │ ◄────── NEVER ───── │                │   │
│   └──────┬───────┘                     └────────────────┘   │
│          │                                     │            │
│          │                                     ▼            │
│   ┌──────┴───────┐                       LLM Prompt        │
│   │ 5 components │                             │            │
│   │              │                             │            │
│   │ 1. Store     │     store_memory            │            │
│   │ 2. Write     │◄───(explicit via tool)──────┘            │
│   │ 3. Recall    │                                          │
│   │ 4. Dream     │         agent decides                    │
│   │ 5. Aux LLM   │         to store                         │
│   └──────────────┘                                          │
└─────────────────────────────────────────────────────────────┘
```

### Component Diagram

```mermaid
graph TB
    subgraph "Agent Loop"
        LLM["LLM<br/>(main model)"]
    end
    
    subgraph "Memory Domain"
        MS["Memory Store<br/>(persistence)"]
        WS["Write Strategy<br/>(writing)"]
        RM["Recall Mechanisms<br/>(retrieval)"]
        DC["Dream Consolidation<br/>(maintenance)"]
        AL["Auxiliary LLM<br/>(cheap model)"]
    end
    
    subgraph "Context Domain"
        CE["Context Engine<br/>(window)"]
    end
    
    LLM -->|"store_memory<br/>(tool call)"| WS
    WS -->|"persists"| MS
    RM -->|"queries"| MS
    RM -->|"recall blocks"| CE
    CE -->|"builds prompt"| LLM
    DC -->|"consolidates"| MS
    AL -->|"supports"| DC
    AL -->|"supports"| RM
    
    style MS fill:#e3f2fd
    style WS fill:#fff3e0
    style RM fill:#e8f5e9
    style DC fill:#f3e5f5
    style AL fill:#fce4ec
```

---

## 2. Component 1: Memory Store (Persistence)

The physical storage of memories. The choice of format impacts readability, versioning, and queryability.

### Storage Formats

| Format | Characteristics | Trade-offs |
|---|---|---|
| **Markdown with frontmatter** | Human-readable, versionable with git, categorized by YAML metadata | No complex queries, parsing required |
| **Flat markdown** | Simple, human-editable, size limits per file | No structured categorization |
| **SQLite** | SQL queries, ACID, indices | Not human-readable, binary in git |
| **JSONL append-only** | Fast append, streaming, immutable | Not editable, continuous growth |
| **Knowledge Graph** | Explicit relationships, semantic traversal | High complexity, additional infrastructure |

**Industry convergence:** Markdown files with YAML frontmatter are the dominant format in production implementations. Advantages: human-readable, versionable with git, no runtime dependency.

### Structure of a Memory Entry

```yaml
---
name: redis-pipeline-timeout
description: Redis timeout with large pipelines — chunking in batches of 500 resolves
type: failure_heuristic
status: active
confidence: 0.85
created_at: 2026-05-01T14:30:00Z
last_accessed: 2026-05-10T09:00:00Z
access_count: 3
ttl_days: 90
source_of_truth:
  - command: redis-cli INFO
  - file: src/cache/pipeline.rs
supersedes: []
superseded_by: []
---

Redis pipeline with >1000 keys causes timeout.
Solution: chunking in batches of 500.

**Evidence:** Observed 3x in cache module debugging sessions.
```

**Critical fields:**

| Field | Function | Why it matters |
|---|---|---|
| `description` | **Retrieval key** — semantic hook for index match | Generic description kills recall; specific activates at the right moments |
| `status` | Explicit state in the lifecycle | Distinguishes active/stale/superseded/archived |
| `source_of_truth` | Where to validate whether the memory is still true | The agent verifies before acting based on memory |
| `ttl_days` | Time-to-live differentiated by type | Failure heuristics last longer than project status |
| `supersedes` / `superseded_by` | Supersession chain | Traceability when memory is rewritten |

### Class Diagram: Memory Store

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
    
    class MemoryStore {
        <<interface>>
        +write(entry: MemoryEntry) Result
        +read(id: String) MemoryEntry
        +query(filter: Filter) List~MemoryEntry~
        +delete(id: String) Result
        +list_all() List~MemoryEntry~
        +backup(path: String) Result
    }
    
    class MarkdownStore {
        +base_path: String
        +index_path: String
        +write(entry) Result
        +read(id) MemoryEntry
        +rebuild_index() Result
    }
    
    class SQLiteStore {
        +db_path: String
        +write(entry) Result
        +read(id) MemoryEntry
    }
    
    MemoryEntry --> MemoryType
    MemoryStore <|.. MarkdownStore
    MemoryStore <|.. SQLiteStore
    MarkdownStore --> MemoryEntry
    SQLiteStore --> MemoryEntry
```

---

## 3. Component 2: Write Strategy

Defines **who** decides what to persist and **when**.

→ Details in [03_estrategias_escrita.md](03_estrategias_escrita.md)

### Summary of Approaches

```mermaid
graph LR
    subgraph "Explicit"
        A1["Agent decides"] -->|"store_memory"| A2["Memory Store"]
    end
    
    subgraph "Automatic"
        B1["Heuristic extracts"] -->|"auto-extract"| B2["Memory Store"]
    end
    
    subgraph "Hybrid"
        C1["Agent decides"] -->|"store_memory"| C2["Memory Store"]
        C3["Auto-extract<br/>+ approval gate"] -->|"inbox"| C2
    end
```

---

## 4. Component 3: Recall Mechanisms

Defines **how** and **when** memories are brought into the context window.

→ Details in [04_mecanismos_recall.md](04_mecanismos_recall.md)

### Recall Flow

```mermaid
sequenceDiagram
    participant Agent as Agent Loop
    participant Recall as Recall Engine
    participant Store as Memory Store
    participant Context as Context Engine
    
    Note over Agent: Turn N (trigger: every 5 turns)
    Agent->>Recall: automatic trigger
    Recall->>Store: query(context_hints)
    Store-->>Recall: candidates[]
    Recall->>Recall: score + dedup + budget check
    Recall-->>Context: recall_blocks (≤60KB)
    Context->>Context: injects into prompt
    
    Note over Agent: Turn M (agent needs context)
    Agent->>Recall: recall_memory("how to configure Redis?")
    Recall->>Store: query("Redis")
    Store-->>Recall: candidates[]
    Recall-->>Context: recall_blocks
```

---

## 5. Component 4: Dream Consolidation (Maintenance)

Automatic process that keeps the memory store clean and useful over time.

→ Details in [05_consolidacao_dream.md](05_consolidacao_dream.md)

### Simplified Pipeline

```mermaid
graph TD
    T["Trigger:<br/>>24h + ≥5 sessions<br/>+ no lock"] --> S["SCAN<br/>Collect memories"]
    S --> B["BACKUP<br/>Copy originals"]
    B --> P["PROTECT<br/>user/feedback/reference<br/>NEVER consolidated"]
    P --> M["MERGE<br/>Auxiliary LLM combines<br/>overlapping"]
    M --> W["WRITE<br/>consolidated-{date}"]
    W --> PR["PRUNE<br/>Delete originals<br/>(backup preserved)"]
    PR --> I["INDEX<br/>Regenerate index"]
```

---

## 6. Component 5: Auxiliary LLM (Cheap Model)

Volume tasks (compaction, selection, consolidation) don't justify the cost of the main model.

→ Details in [06_llm_auxiliar.md](06_llm_auxiliar.md)

### Task → Model Mapping

```mermaid
graph LR
    subgraph "Volume Tasks"
        T1["Compaction summary"]
        T2["Memory selection"]
    end
    
    subgraph "Reasoning Tasks"
        T3["Dream consolidation"]
    end
    
    subgraph "Complex Tasks"
        T4["Code generation"]
        T5["Reasoning"]
    end
    
    T1 --> M1["Cheap Model<br/>(Haiku-class)"]
    T2 --> M1
    T3 --> M2["Intermediate Model<br/>(Sonnet-class)"]
    T4 --> M3["Main Model<br/>(Opus-class)"]
    T5 --> M3
    
    style M1 fill:#e8f5e9
    style M2 fill:#fff3e0
    style M3 fill:#ffebee
```

---

## 7. Complete Class Diagram

```mermaid
classDiagram
    %% Core interfaces
    class MemoryProvider {
        <<interface>>
        +prefetch(query: String, session_id: String) RecallBlock
        +sync_turn(user_msg, assistant_msg, session_id) void
        +on_pre_compress(messages: List) void
        +on_session_end(session_id: String) void
        +write_reflection(reflection: Reflection) Result
        +reflection_recall(query: String) List~Reflection~
        +failure_heuristic_recall(error_class: ErrorClass) List~Reflection~
    }
    
    class MemoryStore {
        <<interface>>
        +write(entry: MemoryEntry) Result
        +read(id: String) MemoryEntry
        +query(filter: Filter) List~MemoryEntry~
        +delete(id: String) Result
        +backup(path: String) Result
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
        +score(entries: List~MemoryEntry~, context: RankContext) List~float~
    }
    
    %% Data types
    class MemoryEntry {
        +String id
        +String name
        +MemoryType type
        +String content
        +float confidence
        +DateTime created_at
    }
    
    class Reflection {
        +String id
        +String lesson
        +String trigger
        +float confidence
        +List~String~ evidence_ids
        +ReflectionCategory category
        +ReflectionState state
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
        +String source
        +DateTime retrieved_at
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
    
    %% Coordinator
    class MemoryEngine {
        +List~MemoryProvider~ providers
        +WritePolicy write_policy
        +ForgetPolicy forget_policy
        +RankPolicy rank_policy
        +prefetch(query, session_id) RecallBlock
        +sync_turn(user, assistant, session_id) void
        +register_provider(provider: MemoryProvider) void
    }
    
    %% Consolidation
    class DreamConsolidator {
        +trigger_conditions: TriggerConfig
        +consolidate() ConsolidationResult
        +backup() void
        +is_eligible(entry: MemoryEntry) bool
    }
    
    %% Relations
    MemoryEngine --> MemoryProvider : coordinates N providers
    MemoryEngine --> WritePolicy
    MemoryEngine --> ForgetPolicy
    MemoryEngine --> RankPolicy
    MemoryProvider --> MemoryStore : uses
    MemoryProvider --> Reflection : produces/consumes
    Reflection --> ReflectionCategory
    Reflection --> ReflectionState
    DreamConsolidator --> MemoryStore : consolidates
    MemoryStore --> MemoryEntry : stores
    MemoryProvider --> RecallBlock : returns
    MemoryProvider --> ErrorClass : classifies
```

---

## 8. Main Flows

### 8.1 Write Flow

```mermaid
sequenceDiagram
    participant LLM as Agent (LLM)
    participant Tool as store_memory Tool
    participant WP as WritePolicy
    participant Sec as Security Scanner
    participant Store as Memory Store
    participant Idx as Index
    
    LLM->>Tool: store_memory(type, content)
    Tool->>Sec: scan_content(content)
    alt Malicious content
        Sec-->>Tool: REJECTED (injection pattern)
        Tool-->>LLM: Error: content rejected
    else Valid content
        Sec-->>Tool: OK
        Tool->>WP: plan(write_context)
        WP-->>Tool: WriteAction(target_store, entry)
        Tool->>Store: write(entry)
        Store->>Idx: update_index(entry)
        Store-->>Tool: OK
        Tool-->>LLM: Memory saved successfully
    end
```

### 8.2 Complete Session Flow

```mermaid
sequenceDiagram
    participant User
    participant Agent as Agent Loop
    participant Recall as Recall Engine
    participant Store as Memory Store
    participant Context as Context Engine
    
    Note over Agent: BOOTSTRAP
    Agent->>Recall: prefetch(session_context)
    Recall->>Store: query(relevant_memories)
    Store-->>Recall: initial_memories[]
    Recall-->>Context: inject recall blocks
    
    loop Each Turn
        User->>Agent: message
        Agent->>Context: build_prompt(user_msg + recall)
        Context-->>Agent: complete prompt
        Agent->>Agent: LLM inference
        
        opt Every N turns
            Agent->>Recall: auto_recall(context_hints)
            Recall-->>Context: new recall blocks
        end
        
        opt Agent decides to save
            Agent->>Store: store_memory(lesson)
        end
        
        Agent-->>User: response
    end
    
    Note over Agent: SESSION END
    Agent->>Store: on_session_end()
    
    Note over Store: BACKGROUND (>24h later)
    Store->>Store: Dream consolidation
```

---

## 9. Memory CLI

The memory system exposes a CLI interface for operation and human maintenance. The design follows YAGNI: 3 initial subcommands covering the critical flows, with an explicit roadmap for the rest.

### 9.1 Initial Subcommands (v1)

| Command | What it does | Example |
|---|---|---|
| `memory store` | Creates new entry with validated frontmatter | `memory store --type failure_heuristic --name "redis-timeout"` |
| `memory recall` | Searches memories by query (substring + Jaccard + RRF) | `memory recall "redis pipeline timeout"` |
| `memory lint` | Validates store integrity (10 checks, see Ch 05 §4.1) | `memory lint --fix` |

### 9.2 Roadmap (added on demand, when there is proven need)

| Command | What it does | Criterion to add |
|---|---|---|
| `memory list` | Lists all entries with status and TTL | When store > 20 entries |
| `memory read <id>` | Reads complete entry | When lint detects frequent inconsistencies |
| `memory update <id>` | Updates existing entry (preserves `originSessionId`) | When manual supersession is frequent |
| `memory archive <id>` | Moves entry to Archived | When manual garbage collection is necessary |
| `memory gc` | Garbage collection: prune Archived + superseded entries | When store > 50 entries |
| `memory audit` | Staleness report: entries by status, remaining TTL, last verification | When multiple projects use memory |
| `memory promote <id>` | Moves memory to CLAUDE.md / public knowledge-base | When promotion pattern is recurring |
| `memory compact` | Forces Dream consolidation outside the automatic trigger | When store > 100 entries |
| `memory stale` | Lists entries with expired TTL or no recent access | When manual audit is frequent |

**YAGNI rule:** each roadmap subcommand is only implemented when there are ≥3 occurrences of real, non-speculative need.

---

## 10. Architectural Decisions (ADRs)

The memory system is governed by 6 ADRs that define the design boundaries:

| ADR | Decision | Chapter |
|---|---|---|
| **ADR-01** | No embeddings for recall | [04_mecanismos_recall.md](04_mecanismos_recall.md) |
| **ADR-02** | Explicit writes (agent-driven) | [03_estrategias_escrita.md](03_estrategias_escrita.md) |
| **ADR-09** | Pre-compression hook (notify, not extract) | [03_estrategias_escrita.md](03_estrategias_escrita.md) |
| **ADR-11** | Tiered auxiliary LLM | [06_llm_auxiliar.md](06_llm_auxiliar.md) |
| **ADR-14** | Dream consolidation with atomic types protection | [05_consolidacao_dream.md](05_consolidacao_dream.md) |
| **ADR-15** | Recall frequency: 4 complementary mechanisms | [04_mecanismos_recall.md](04_mecanismos_recall.md) |

→ Next: [03_estrategias_escrita.md](03_estrategias_escrita.md) — Write Strategies
