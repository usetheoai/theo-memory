# Paper Surface: Memory Patterns for AI Agents

> Technical mapping of the memory techniques mentioned in the videos
> "Every Claude Code Memory Pattern Explained" (OMkdlwZxSt8) and
> "OneContext — Shared Memory Across Agents" (pAIF7vZm5k0)
> against the academic AI Agents literature.
>
> **Appendices:**
> - [Appendix A — Git Context Controller & OneContext](#appendix-a--git-context-controller--onecontext)
> - [Appendix B — Letta Context Repositories](#appendix-b--letta-context-repositories)

---

## 1. Overview

The video presents building blocks and mechanisms for building custom memory systems in AI agents (Claude Code). This document maps **each technique** to its academic foundation, with primary references and surveys.

---

## 2. Memory Building Blocks

### 2.1 Working Memory

**What the video says:** On-demand memory, "messy desk" of ongoing tasks, disposable when the task ends.

**Foundation:**

| Paper | Contribution | Link |
|---|---|---|
| Laird, Newell & Rosenbloom (1987). *SOAR: An Architecture for General Intelligence*. Artificial Intelligence, 33(1), 1-64. | Working memory as a central buffer in cognitive agent architectures. The agent maintains temporary working state that is consumed and discarded during problem solving. | [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/0004370287900506) |
| Anderson, J. R. (1993). *Rules of the Mind*. Erlbaum. (ACT-R) | Goal buffer and imaginal buffer as the agent's working memory — maintain temporary internal representations during processing. | [CMU ACT-R](https://act-r.psy.cmu.edu/about/) |
| Sumers et al. (2023). *Cognitive Architectures for Language Agents (CoALA)*. TMLR 2024. | Defines Working Memory as a "short-term scratchpad" that maintains the agent's immediate context, analogous to the prompt context in LLMs. | [arXiv:2309.02427](https://arxiv.org/abs/2309.02427) |
| Packer et al. (2023). *MemGPT: Towards LLMs as Operating Systems*. | Main context as the agent's "RAM" — limited buffer that the agent actively manages, moving data between main context and archival storage. | [arXiv:2310.08560](https://arxiv.org/abs/2310.08560) |

**Verdict:** Strongly grounded. Central concept in every agent architecture since SOAR (1987).

---

### 2.2 Long-term Memory

**What the video says:** Knowledge worth persisting over time — project results, significant events, important decisions.

**Foundation:**

| Paper | Contribution | Link |
|---|---|---|
| Laird et al. (1987). *SOAR*. | Long-term memory divided into procedural, semantic, and episodic — persistent across the agent's decision cycles. | [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/0004370287900506) |
| Anderson (1993). *ACT-R*. | Declarative memory as a long-term repository of factual chunks, with activation based on recency and frequency of use. | [CMU ACT-R](https://act-r.psy.cmu.edu/about/) |
| Park et al. (2023). *Generative Agents: Interactive Simulacra of Human Behavior*. UIST '23. | Memory stream — complete chronological record of agent experiences in natural language, persisted indefinitely. | [arXiv:2304.03442](https://arxiv.org/abs/2304.03442) |
| Zhang et al. (2024). *A Survey on the Memory Mechanism of LLM-based Agents*. ACM TOIS. | Formal taxonomy separating short-term vs long-term memory in LLM agents, with analysis of storage forms and operations. | [arXiv:2404.13501](https://arxiv.org/abs/2404.13501) |

**Verdict:** Strongly grounded. Fundamental distinction since classical cognitive architectures.

---

### 2.3 Episodic Memory

**What the video says:** Focuses on the "why" — not just what happened, but why it was important to store.

**Foundation:**

| Paper | Contribution | Link |
|---|---|---|
| Park et al. (2023). *Generative Agents*. | Memory stream is essentially episodic — each entry has a timestamp, event description, and context. The agent does **reflection** (high-level synthesis) on episodes to generate insights. | [arXiv:2304.03442](https://arxiv.org/abs/2304.03442) |
| Shinn et al. (2023). *Reflexion: Language Agents with Verbal Reinforcement Learning*. NeurIPS 2023. | Agents maintain a buffer of textual reflections about past attempts — explicit episodic memory used to learn from errors without updating weights. | [arXiv:2303.11366](https://arxiv.org/abs/2303.11366) |
| Sumers et al. (2023). *CoALA*. | Explicitly categorizes Episodic Memory as records of past experiences, distinct from Semantic Memory (facts) and Procedural Memory (how-to). | [arXiv:2309.02427](https://arxiv.org/abs/2309.02427) |
| Liu et al. (2023). *Think-in-Memory: Recalling and Post-thinking Enable LLMs with Long-Term Memory*. | Stores reasoning chains (thoughts) throughout the conversation — episodic memory of cognitive processes, not just events. | [arXiv:2311.08719](https://arxiv.org/abs/2311.08719) |

**Verdict:** Strongly grounded. Episodic memory is one of the three pillars of CoALA.

---

### 2.4 Identity

**What the video says:** Name, occupation, data that persist forever. First thing loaded in the session.

**Foundation:**

| Paper | Contribution | Link |
|---|---|---|
| Park et al. (2023). *Generative Agents*. | Each agent has a persistent **persona** (name, occupation, traits, relationships) that grounds all behavior. The persona is the first element of the prompt. | [arXiv:2304.03442](https://arxiv.org/abs/2304.03442) |
| Sumers et al. (2023). *CoALA*. | Procedural Memory includes fixed system instructions — agent identity and personality encoded as a permanent part of the architecture. | [arXiv:2309.02427](https://arxiv.org/abs/2309.02427) |

**Verdict:** Grounded as practice, no dedicated paper. It is a universal engineering pattern in agents, formalized indirectly by CoALA as part of Procedural Memory.

---

### 2.5 Critical Context

**What the video says:** Business/current position context — information relevant to the present moment that is not permanent identity.

**Foundation:**

| Paper | Contribution | Link |
|---|---|---|
| Wang et al. (2023). *SCM: Self-Controlled Memory Framework*. | The agent decides which context segments deserve verbatim retention vs. condensation. The cache-based "flash memory" preserves recent and contextually relevant observations. | [arXiv:2304.13343](https://arxiv.org/abs/2304.13343) |
| Packer et al. (2023). *MemGPT*. | The "working context" is an editable region within the main context where the agent maintains persistent session information — analogous to environment variables. | [arXiv:2310.08560](https://arxiv.org/abs/2310.08560) |

**Verdict:** Partially grounded. Does not exist as a named concept in the literature — it is a pragmatic category that emerges from the practice of separating session context from permanent identity.

---

## 3. Advanced Mechanisms

### 3.1 Decay

**What the video says:** Memories lose importance over time.

**Foundation:**

| Paper | Contribution | Link |
|---|---|---|
| Park et al. (2023). *Generative Agents*. | **Recency score** with exponential decay: `score = decay_factor ^ (hours_since_last_access)`. It is one of the three factors of retrieval (recency × importance × relevance). | [arXiv:2304.03442](https://arxiv.org/abs/2304.03442) |
| Anderson (1993). *ACT-R*. | Base-level activation decay: `B_i = ln(Σ t_j^-d)` — the activation of a chunk decays as a power function of time since each access. Direct cognitive foundation. | [CMU ACT-R](https://act-r.psy.cmu.edu/about/) |
| Liu et al. (2023). *Think-in-Memory*. | Explicit **forget** operation: old or redundant thoughts are removed from memory based on temporal relevance criteria. | [arXiv:2311.08719](https://arxiv.org/abs/2311.08719) |

**Verdict:** Strongly grounded. Present since ACT-R (1993) and explicitly implemented in Generative Agents.

---

### 3.2 Promotions

**What the video says:** Frequently accessed memories rise in priority and become persistent.

**Foundation:**

| Paper | Contribution | Link |
|---|---|---|
| Anderson (1993). *ACT-R*. | Retrieval strengthening: each access to a chunk **increases** its base-level activation. More accessed memories become faster and more likely to be retrieved. | [CMU ACT-R](https://act-r.psy.cmu.edu/about/) |
| Park et al. (2023). *Generative Agents*. | The recency score is recalculated based on the **last access**, not creation. Frequently retrieved memories maintain a high score — implicit promotion via use. | [arXiv:2304.03442](https://arxiv.org/abs/2304.03442) |
| Packer et al. (2023). *MemGPT*. | The agent explicitly moves data between memory tiers (main context ↔ archival storage). Frequently needed data is kept in the more accessible tier — active promotion. | [arXiv:2310.08560](https://arxiv.org/abs/2310.08560) |

**Verdict:** Strongly grounded. ACT-R's retrieval strengthening mechanism is the theoretical basis. The name "promotions" is invented by the video, but the phenomenon is real and implemented.

---

### 3.3 Salience

**What the video says:** Proxy for access frequency — heavily crossed vs. abandoned paths.

**Foundation:**

| Paper | Contribution | Link |
|---|---|---|
| Park et al. (2023). *Generative Agents*. | **Importance score** (1-10) assigned by the LLM itself to each memory. It is not pure frequency — it is an assessment of the event's intrinsic importance. Functions as a salience score. | [arXiv:2304.03442](https://arxiv.org/abs/2304.03442) |
| Anderson (1993). *ACT-R*. | Spreading activation: chunks associated with the current context receive an activation boost. Salience is contextual, not fixed. | [CMU ACT-R](https://act-r.psy.cmu.edu/about/) |
| Zhang et al. (2024). *Survey on Memory Mechanism*. | Categorizes memory scoring mechanisms: recency-based, importance-based, and relevance-based. Salience emerges from the combination of these. | [arXiv:2404.13501](https://arxiv.org/abs/2404.13501) |

**Verdict:** Grounded, but simplified in the video. The video reduces salience to access frequency. In the literature, salience is multifactorial (importance + contextual relevance + recency).

---

### 3.4 Progressive Disclosure

**What the video says:** Load identity first, then knowledge, and rarely the full history (~1-2% of the total).

**Foundation:**

| Paper | Contribution | Link |
|---|---|---|
| Packer et al. (2023). *MemGPT*. | Hierarchical OS-inspired memory architecture: main context (registers/RAM) → recall storage (recent disk) → archival storage (permanent disk). On-demand loading, not all at once. | [arXiv:2310.08560](https://arxiv.org/abs/2310.08560) |
| Sumers et al. (2023). *CoALA*. | Retrieval as an internal agent action — the agent decides when and what to fetch from long-term memory. Not everything is loaded at the start. | [arXiv:2309.02427](https://arxiv.org/abs/2309.02427) |
| Wang et al. (2023). *SCM*. | Flash memory (recent) loaded automatically; long-term memory accessed via selective retrieval. Explicit access hierarchy. | [arXiv:2304.13343](https://arxiv.org/abs/2304.13343) |

**Verdict:** Grounded as an engineering design pattern. The term "progressive disclosure" comes from UX (Carroll, 1980s), but the concept of memory hierarchy with on-demand loading is central in MemGPT.

---

### 3.5 Compaction Survival

**What the video says:** When compacting the session, auto-inject critical memories so as not to lose context.

**Foundation:**

| Paper | Contribution | Link |
|---|---|---|
| Packer et al. (2023). *MemGPT*. | Self-editing memory: the agent decides what to preserve when the context needs to be reduced. Uses functions to move critical data to archival before freeing space in the main context. | [arXiv:2310.08560](https://arxiv.org/abs/2310.08560) |
| Liu et al. (2023). *Think-in-Memory*. | Post-thinking: after each interaction, the agent synthesizes and updates thoughts in memory — merge and forget operations ensure that the essential survives. | [arXiv:2311.08719](https://arxiv.org/abs/2311.08719) |
| Tan et al. (2025). *Reflective Memory Management (RMM)*. ACL 2025. | Prospective Reflection: at the end of each session, the agent summarizes by topic and decides what to merge with existing memories vs. store as new. Ensures survival of context across sessions. | [arXiv:2503.08026](https://arxiv.org/abs/2503.08026) |

**Verdict:** Grounded in concept, not in name. "Compaction survival" is the video's term. The mechanism of automatic context preservation during window reduction is implemented in MemGPT and refined in later work.

---

### 3.6 Semantic + Keyword + Entity Search (Multi-layer)

**What the video says:** Combine semantic search, keyword matching, and entity matching to pre-filter memory and reduce tokens (~25k → ~7k).

**Foundation:**

| Paper | Contribution | Link |
|---|---|---|
| Park et al. (2023). *Generative Agents*. | Retrieval uses **three combined signals**: recency (temporal), importance (LLM-scored), relevance (embedding similarity). Multifactorial pre-filtering before injecting into the prompt. | [arXiv:2304.03442](https://arxiv.org/abs/2304.03442) |
| Xu et al. (2025). *A-MEM: Agentic Memory for LLM Agents*. | Organizes memories as interconnected notes (Zettelkasten method) with dynamic indexing. Retrieval through multiple paths: links, tags, embedding similarity. | [arXiv:2502.12110](https://arxiv.org/abs/2502.12110) |
| Zhang et al. (2024). *Survey on Memory Mechanism*. | Taxonomy of memory operations: retrieval by embedding, by keyword, by structure. Discusses trade-offs of each approach. | [arXiv:2404.13501](https://arxiv.org/abs/2404.13501) |

**Verdict:** Grounded. The combination of multiple retrieval signals is standard practice since Generative Agents.

---

## 4. Reflection — Concept implicit in the video

Although the video does not explicitly name it, the "synthesis roll-up" process mentioned is essentially **reflection**.

| Paper | Contribution | Link |
|---|---|---|
| Park et al. (2023). *Generative Agents*. | Reflection: periodically, the agent synthesizes recent memories into high-level insights (e.g., "John is interested in photography"), which are stored as new memories. | [arXiv:2304.03442](https://arxiv.org/abs/2304.03442) |
| Shinn et al. (2023). *Reflexion*. | The agent verbally reflects on past failures and stores lessons learned as text in an episodic buffer to guide future attempts. | [arXiv:2303.11366](https://arxiv.org/abs/2303.11366) |

---

## 5. Quick Reference Table

| Video Technique | Academic Name | Primary Paper | Year |
|---|---|---|---|
| Working Memory | Working Memory / Main Context | SOAR (Laird et al.) | 1987 |
| Long-term Memory | Long-term Memory / Memory Stream | Generative Agents (Park et al.) | 2023 |
| Episodic Memory | Episodic Memory | CoALA (Sumers et al.) | 2023 |
| Identity | Persona / Procedural Memory | Generative Agents (Park et al.) | 2023 |
| Critical Context | Working Context / Flash Memory | MemGPT (Packer et al.) | 2023 |
| Decay | Recency Decay / Base-level Activation | ACT-R (Anderson) / Generative Agents | 1993/2023 |
| Promotions | Retrieval Strengthening | ACT-R (Anderson) | 1993 |
| Salience | Importance Score / Spreading Activation | Generative Agents / ACT-R | 2023/1993 |
| Progressive Disclosure | Hierarchical Memory / On-demand Retrieval | MemGPT (Packer et al.) | 2023 |
| Compaction Survival | Self-editing Memory / Prospective Reflection | MemGPT / RMM (Tan et al.) | 2023/2025 |
| Multi-layer Search | Multi-signal Retrieval | Generative Agents (Park et al.) | 2023 |
| Synthesis Roll-up | Reflection | Generative Agents / Reflexion | 2023 |

---

## 6. Recommended Surveys

For those who want to go beyond pointwise references:

| Survey | Scope | Link |
|---|---|---|
| Zhang et al. (2024). *A Survey on the Memory Mechanism of LLM-based Agents*. ACM TOIS. | First survey dedicated to memory in LLM agents. Taxonomy of sources, forms, and operations. | [arXiv:2404.13501](https://arxiv.org/abs/2404.13501) |
| Sumers et al. (2023). *CoALA: Cognitive Architectures for Language Agents*. TMLR 2024. | Theoretical framework that organizes LLM agents using cognitive architecture concepts. Defines Working, Episodic, Semantic, and Procedural Memory. | [arXiv:2309.02427](https://arxiv.org/abs/2309.02427) |
| Liu et al. (2025). *Memory for Autonomous LLM Agents: Mechanisms, Evaluation, and Emerging Frontiers*. | Recent survey covering mechanisms, benchmarks, and research frontiers in agent memory. | [arXiv:2603.07670](https://arxiv.org/html/2603.07670v1) |
| Wang et al. (2025). *Rethinking Memory in LLM-based Agents: Representations, Operations, and Emerging Topics*. | Rethinking of representations and operations of memory in agents. | [arXiv:2505.00675](https://arxiv.org/abs/2505.00675) |

---

## 7. Conclusion

The video repackages real concepts from the AI Agents literature with more accessible names. The two most direct references are:

1. **Generative Agents** (Park et al., 2023) — decay, importance scoring, reflection, memory stream
2. **MemGPT** (Packer et al., 2023) — memory hierarchy, self-editing, progressive disclosure

The theoretical roots are in the classical cognitive architectures **SOAR** (1987) and **ACT-R** (1993), which already defined working memory, long-term memory, decay, and retrieval strengthening decades before LLMs.

The theoretical framework that best organizes everything is **CoALA** (Sumers et al., 2023), which explicitly maps Working Memory, Episodic Memory, Semantic Memory, and Procedural Memory to the context of language-based agents.

---
---

# APPENDICES — Practical Implementations (video pAIF7vZm5k0)

The appendices below document concrete implementations of the memory patterns cataloged above, referenced in the "OneContext" video (pAIF7vZm5k0).

---

## Appendix A — Git Context Controller & OneContext

### A.1 Paper

| Field | Detail |
|---|---|
| **Title** | Git Context Controller: Manage the Context of LLM-based Agents like Git |
| **Authors** | Junde Wu et al. (University of Oxford) |
| **arXiv** | [2508.00031](https://arxiv.org/abs/2508.00031) |
| **Code** | [github.com/theworldofagents/GCC](https://github.com/theworldofagents/GCC) |
| **Publication** | v1: Jul 2025, v2: Mar 2026 |

### A.2 Central Idea

Treats agent memory as a version control system. The agent manages its context using operations analogous to git:

| GCC Operation | Git Analog | Function |
|---|---|---|
| **COMMIT** | `git commit` | Saves milestone — summary of what has been done so far |
| **BRANCH** | `git branch` | Fork to explore alternative strategy |
| **MERGE** | `git merge` | Consolidates learnings from a branch into the main context |
| **CONTEXT** | `git log` | Progressive search in the context history |

### A.3 File Structure

```
.context/
├── main.md              ← global project roadmap
└── branches/
    ├── approach-A/
    │   ├── commit.md    ← milestones (high-level summaries)
    │   ├── log.md       ← OTAA: observations, thoughts, actions (raw)
    │   └── metadata     ← branch metadata
    └── approach-B/
        ├── commit.md
        ├── log.md
        └── metadata
```

### A.4 Progressive Retrieval

The agent searches information in growing layers of detail:

```
1. main.md          → project overview (few tokens)
2. commit.md        → milestones of a specific branch
3. log.md           → complete conversation history (many tokens)
```

This directly implements the **Progressive Disclosure** pattern (section 3.4 of the main document).

### A.5 Empirical Results

| Benchmark | Without GCC | With GCC | Improvement |
|---|---|---|---|
| SWE-Bench Lite | baseline | 48.00% resolution | Outperforms 26 competing systems |
| SWE-Bench Verified | baseline | 80%+ resolution | +13% relative to long-context baselines |
| Self-Replication | 11.7% | 40.7% | ~3.5x improvement |

### A.6 Mapping to Memory Patterns

| Pattern (main section) | Implementation in GCC |
|---|---|
| Working Memory (2.1) | Active branch = working memory of the agent |
| Long-term Memory (2.2) | `main.md` after merges = consolidated knowledge |
| Progressive Disclosure (3.4) | Hierarchical retrieval main → commit → log |
| Compaction Survival (3.5) | COMMIT preserves summaries before discarding details |
| Multi-layer Search (3.6) | CONTEXT searches across branches and levels |

### A.7 Tool: OneContext CLI

Practical implementation of the paper as a tool:

- **Installation:** `npm i -g onecontext-ai`
- **Mechanism:** Stop hooks capture sessions → local DB (`align.db`) → GPT-4 Mini generates summaries
- **Differentiator:** Shared memory between different agents (Claude Code, Codex, etc.) and between sessions
- **Sharing:** Generates URL with chatbot loaded with accumulated context

---

## Appendix B — Letta Context Repositories

### B.1 Origin

Letta (formerly MemGPT) — born from the MemGPT paper at UC Berkeley Sky Computing Lab (Packer et al., 2023, referenced in section 2.1 of the main document).

| Field | Detail |
|---|---|
| **Product** | Letta Code — coding agent with persistent memory |
| **Concept** | Context Repositories (MemFS) — memory as git-backed filesystem |
| **Blog** | [letta.com/blog/context-repositories](https://www.letta.com/blog/context-repositories) |
| **Docs** | [docs.letta.com/letta-code/memory](https://docs.letta.com/letta-code/memory/) |

### B.2 Architecture: MemFS

Memory designed as a filesystem with git versioning:

```
memfs/
├── system/              ← PINNED to context window (always loaded)
│   ├── identity.md      ← name, personality, style
│   └── working.md       ← current working context
└── reflections/         ← VISIBLE in the tree, content omitted (on-demand)
    ├── patterns.md
    └── observations.md
```

**Rule:** Everything in `system/` is always injected. Everything outside is visible as a file name but loaded on demand.

### B.3 Built-in Mechanisms

| Mechanism | What it does | Corresponding pattern |
|---|---|---|
| **Memory Initialization** | Subagents explore the codebase in parallel worktrees and create initial hierarchical memory | Working Memory (2.1) |
| **Memory Reflection** | Background process ("sleep-time") that reviews recent conversations and persists insights | Reflection (section 4), Promotions (3.2) |
| **Memory Defragmentation** | `/doctor` reorganizes memories that have become disorganized with prolonged use | Compaction Survival (3.5) |
| **Git-backed versioning** | Each change in memory generates a commit with an informative message | Analog to GCC's COMMIT |
| **Concurrent subagents** | Multiple subagents work in isolated worktrees and merge via git | Multi-agent sharing |

### B.4 Mapping to Memory Patterns

| Pattern (main section) | Implementation in Letta |
|---|---|
| Identity (2.4) | `system/identity.md` — always pinned |
| Critical Context (2.5) | `system/working.md` — active session context |
| Progressive Disclosure (3.4) | `system/` pinned vs. rest on-demand |
| Compaction Survival (3.5) | Memory Reflection persists before losing context |
| Decay (3.1) | Memory Defragmentation cleans obsolete memories |

### B.5 Architectural Evolution

```
MemGPT (2023)                    →  Letta Context Repos (2025)
─────────────────────────────────────────────────────────────
Specialized memory tools          →  Bash/terminal operating over files
  (core_memory_append, etc.)         (generalized, not limited to API)
Database (archival storage)       →  Git-backed filesystem (MemFS)
Single agent                      →  Concurrent subagents with worktrees
No versioning                     →  Each change is a git commit
```

---

## Appendix C — Comparative Table of Implementations

| Dimension | GCC / OneContext | Letta Context Repos |
|---|---|---|
| **Central metaphor** | Git (branch/commit/merge) | Filesystem + Git |
| **Storage** | Markdown files + SQLite | Git-backed markdown (MemFS) |
| **Retrieval** | Hierarchical: main → branch → log | Pinned (system/) + on-demand |
| **Multi-agent** | Sessions share the same context | Subagents in git worktrees |
| **Summarization** | GPT-4 Mini (external) | Sleep-time reflection (background) |
| **Versioning** | Implicit (branch structure) | Explicit (git commits with messages) |
| **Sharing** | URL with chatbot | Standard git push/pull |
| **Supported agents** | Claude Code, Codex, any CLI | Letta Code (proprietary) |
| **Academic paper** | [arXiv:2508.00031](https://arxiv.org/abs/2508.00031) | Evolution of [arXiv:2310.08560](https://arxiv.org/abs/2310.08560) (MemGPT) |
| **Benchmark** | SWE-Bench: +13% | Not published in paper |
