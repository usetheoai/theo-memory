# OneContext — Shared Memory Across Code Agents

> Video summary pAIF7vZm5k0
> Channel: Jason (AI Jason)

---

## 1. Central Problem

Code agents (Claude Code, Cursor, Codex) get "dumber" as the session progresses. Even with 1M token windows, the **effective window** is ~120-200k tokens. Compaction loses context. Claude Code's native memory (per-project `.md` files) is limited and **does not share** between different agents.

**The ideal:** accumulated knowledge accessible by any agent, in any session, in real time.

---

## 2. Solution: Git Context Controller (OneContext)

A framework called **Git Context Controller** that treats memory as git — with branches, commits, and merges of knowledge.

### 2.1 File Structure

```
.context/
├── main.md          ← global project context (roadmap)
└── branches/
    ├── playwright/
    │   ├── commit.md    ← achieved milestones
    │   ├── log.md       ← complete history (OTAA: observations, thoughts, actions)
    │   └── metadata     ← branch metadata
    └── api/
        ├── commit.md
        ├── log.md
        └── metadata
```

### 2.2 Four Agent Actions

| Action | When it is triggered |
|---|---|
| **branch** | The agent decides to explore an alternative strategy |
| **commit** | The agent reaches a milestone or completes a subtask |
| **merge** | The agent concludes the exploration and consolidates into main |
| **search** | Progressive search: main → branch → commit → log |

### 2.3 Practical Example (LinkedIn Scraper)

1. The agent creates `main.md` with global roadmap
2. Creates `playwright` branch to explore approach with Playwright
3. Works, reaches milestone → **commit** (logs into `commit.md`)
4. Discovers Playwright does not work → creates `api` branch
5. Finishes → **merge** consolidates learnings into `main.md`

### 2.4 Progressive Retrieval

When asked "where are we in the project?":

1. Reads `main.md` → overview
2. If needs more → reads `commit.md` of a specific branch
3. If needs details → reads `log.md` (raw history)

---

## 3. Tool: OneContext CLI

- Installation: `npm i -g onecontext-ai`
- Split interface: session panel (left) + agent (right)
- **Contexts** = memory groups (e.g., one per project)
- **Sessions** = individual conversations within the context
- Works with Claude Code, Codex, etc.

### 3.1 Internal Mechanism

- Stop hook captures each session automatically
- Saves conversation in local DB (`align.db`)
- GPT-4 Mini generates summaries automatically
- Hierarchical search: broad search → session → turn → raw conversation

### 3.2 Shared Memory Demo

1. Session 1: research OpenClaw memory
2. Session 2: research Letta Context Repositories
3. Session 3: research OneContext
4. **Session 4 (new):** "compare the three" → searches across all previous sessions and returns comparison with pros/cons

### 3.3 Sharing

- Share button generates URL with chatbot loaded with the accumulated context
- Allows other team members to consult the knowledge without needing access to the agent

---

## 4. Cited Results

- **+13-14%** Claude Code performance on software engineering tasks
- Smaller models (Gemini 2.5 Air) perform at the level of frontier models with this setup

---

## 5. Observed Limitations

- Retrieval may confuse information when Claude Code uses its own memory in parallel
- Sharing interface (web chatbot) still rudimentary
- Depends on GPT-4 Mini for summarization (additional cost, external dependency)
