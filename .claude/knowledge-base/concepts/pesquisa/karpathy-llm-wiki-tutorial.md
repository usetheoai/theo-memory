# LLM Wiki: The Complete Guide to Karpathy's Pattern for AI-Powered Knowledge Bases

> Based on the video "Karpathy's LLM Wiki: What It Means & How to Build One"
> Complete tutorial to understand and implement the LLM Wiki concept

---

## Summary

1. [The Problem the LLM Wiki Solves](#1-the-problem-the-llm-wiki-solves)
2. [What the LLM Wiki Is](#2-what-the-llm-wiki-is)
3. [Architecture: The Three Layers](#3-architecture-the-three-layers)
4. [The Three Fundamental Operations](#4-the-three-fundamental-operations)
5. [The Ingestion Process in Detail](#5-the-ingestion-process-in-detail)
6. [Division of Work: Human vs LLM](#6-division-of-work-human-vs-llm)
7. [The Four Principles That Make This Powerful](#7-the-four-principles-that-make-this-powerful)
8. [Practical Use Cases](#8-practical-use-cases)
9. [How to Build Yours: Step by Step](#9-how-to-build-yours-step-by-step)
10. [The Compound Effect: How the Wiki Becomes Smarter](#10-the-compound-effect-how-the-wiki-becomes-smarter)
11. [Tools and Visualization](#11-tools-and-visualization)
12. [Conclusion and Next Steps](#12-conclusion-and-next-steps)

---

## 1. The Problem the LLM Wiki Solves

### The current scenario: RAG and its limitations

Most people today use LLMs with documents as follows: they upload files to ChatGPT, NotebookLM, or some similar tool, ask a question, and the tool retrieves some chunks and generates a response. This is the **RAG (Retrieval Augmented Generation)** pattern.

**RAG works well for simple questions.** But it has a fundamental problem:

> **Nothing accumulates.** Every time you ask a question, the LLM is rediscovering knowledge from scratch. It is reassembling fragments every time.

### The concrete problems with RAG

- **No memory**: The LLM does not remember previous analyses
- **No cross-references**: Does not automatically connect information between documents
- **No accumulated understanding**: If you ask something subtle that requires synthesizing 5 different documents, it needs to find and connect all the pieces in each query
- **Discarded knowledge**: After each conversation, all the synthesis work is thrown away

### Analogy

Imagine studying for an exam by rereading all your notes from scratch every time you need to answer a question, without ever making summaries, mind maps, or connections between topics. That is exactly what RAG does.

---

## 2. What the LLM Wiki Is

The LLM Wiki concept, proposed by Andrej Karpathy, **inverts the RAG logic**.

Instead of retrieving information at query time, the LLM **incrementally builds a persistent and interlinked wiki**.

### Karpathy's key quote

> *"The LLM incrementally builds and maintains a persistent, structured wiki — interlinked markdown files — that sits between you and your raw sources."*

### The critical point

**You never write the wiki.** The LLM writes and maintains everything.

- **You** are responsible for what matters: finding good sources, exploring, asking the right questions
- **The LLM** does the heavy lifting: summarizing, creating cross-references, archiving, maintaining organization — everything that makes knowledge bases useful, but that nobody wants to do manually

### Why this works

Humans abandon wikis because the maintenance effort grows faster than the value generated. But LLMs:

- Do not get bored
- Do not forget to update a cross-reference
- Can update 15 files in a single pass
- The maintenance cost falls to almost zero

**Result**: The wiki actually stays organized and updated.

---

## 3. Architecture: The Three Layers

The LLM Wiki architecture is clean and composed of three layers:

```
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│   RAW SOURCES    │    │      WIKI        │    │     SCHEMA       │
│   (Raw Sources)  │───▶│  (Knowledge      │◀───│  (Configuration) │
│                  │    │   Base)          │    │                  │
│ • Articles       │    │ • Summaries      │    │ • Structure      │
│ • Papers         │    │ • Entity         │    │ • Conventions    │
│ • Transcripts    │    │   pages          │    │ • Workflows      │
│ • Images         │    │ • Concept        │    │ • Rules          │
│ • Datasets       │    │   pages          │    │                  │
│ • Tweets         │    │ • Comparisons    │    │                  │
│ • GitHub Repos   │    │ • Syntheses      │    │                  │
└──────────────────┘    └──────────────────┘    └──────────────────┘
     IMMUTABLE             LLM MANAGES          CO-EVOLVED
  (never modify)        (read + write)        (human + LLM)
```

### Layer 1: Raw Sources

These are your original materials: articles, papers, images, datasets, tweets, GitHub repositories — everything you collect during your research.

**Fundamental rule**: These sources are **immutable**. The LLM reads them but never modifies them. They are your source of truth.

### Layer 2: Wiki (Knowledge Base)

This is the directory of markdown files that the LLM **manages entirely**:

- **Summary pages** of each ingested source
- **Entity pages** (people, organizations, tools)
- **Concept pages** (ideas, techniques, frameworks)
- **Comparison pages** (trade-offs between approaches)
- **Synthesis pages** (analyses that cross multiple sources)
- **Master index** (catalog of everything in the wiki)
- **Change log** (temporal record of changes)

### Layer 3: Schema (Configuration)

It is the configuration file (such as a `CLAUDE.md`) that defines:

- How the wiki is structured
- What the formatting conventions are
- What workflows to follow
- What organization rules to apply

**This file is co-evolved** between you and the LLM over time, as you discover what works best for your domain.

### Karpathy's Analogy

| Element | Analogy |
|----------|----------|
| Wiki | Codebase |
| Obsidian | IDE |
| LLM | Programmer |
| Schema | Style Guide |

---

## 4. The Three Fundamental Operations

The LLM Wiki operates with three core operations:

### Operation 1: Ingest

You place a new source in the `raw/` folder and ask the LLM to process it.

**What happens:**
1. LLM reads the source
2. Writes a summary page
3. Updates the index
4. Creates cross-references with all relevant existing pages

> A single source can touch 10 to 15 pages of the wiki.

### Operation 2: Query

You ask questions against the wiki.

**What happens:**
1. LLM searches the index
2. Reads relevant pages
3. Synthesizes a response

**The smart part**: Good answers can be **saved back to the wiki** as new pages. Thus, your explorations accumulate in the knowledge base the same way ingested sources do.

If the LLM does not find the answer in the wiki, it can:
- Do web searches
- Find additional information
- **Automatically update the wiki** with the new knowledge found

### Operation 3: Lint (Maintenance)

You ask the LLM to do a "health check" of the wiki.

**What it looks for:**
- **Contradictions**: conflicting information between pages
- **Outdated claims**: assertions that may be obsolete
- **Orphan pages**: with no links pointing to them
- **Missing cross-references**: connections that should exist
- **Gaps**: gaps that could be filled with a web search

The LLM also **suggests new questions to investigate**, keeping the wiki healthy as it grows.

---

## 5. The Ingestion Process in Detail

This is the most important operation, where the true power of the system manifests. Here is what happens step by step when you ingest a new source:

```
NEW SOURCE ADDED
        │
        ▼
┌─────────────────────────────┐
│ STEP 1: Source Reading      │  The LLM reads the complete raw content
└──────────────┬──────────────┘
               ▼
┌─────────────────────────────┐
│ STEP 2: Extraction          │  Extracts concepts, entities,
│                             │  claims, data points
└──────────────┬──────────────┘
               ▼
┌─────────────────────────────┐
│ STEP 3: Summary Page        │  Creates a page in the wiki with
│                             │  metadata and tags
└──────────────┬──────────────┘
               ▼
┌─────────────────────────────┐
│ STEP 4: Update of           │  Integrates new information into
│ Existing Pages              │  existing entity and concept pages
│                             │  
└──────────────┬──────────────┘
               ▼
┌─────────────────────────────┐
│ STEP 5: Contradiction       │  Marks when new data
│ Flag                        │  conflicts with existing claims
└──────────────┬──────────────┘
               ▼
┌─────────────────────────────┐
│ STEP 6: Index               │  Updates the master catalog
│ Update                      │  of everything in the wiki
└──────────────┬──────────────┘
               ▼
┌─────────────────────────────┐
│ STEP 7: Log                 │  Records with timestamp what
│                             │  changed and when
└─────────────────────────────┘
               │
               ▼
     WIKI GOT SMARTER
```

> **One source enters, and the entire wiki gets a little smarter. This is the compound effect.**

---

## 6. Division of Work: Human vs LLM

The division of responsibilities is clean and well-defined:

### What the HUMAN does

| Responsibility | Description |
|-----------------|-----------|
| **Curate sources** | Find relevant articles, papers, tweets, repos |
| **Direct analysis** | Decide what to investigate and at what depth |
| **Ask good questions** | The right questions guide the evolution of the wiki |
| **Decide what matters** | Prioritize themes and research directions |
| **Co-evolve the schema** | Adjust rules and structure as needed |

### What the LLM does

| Responsibility | Description |
|-----------------|-----------|
| **Summarize** | Create structured summaries of each source |
| **Reference** | Keep all cross-references up to date |
| **Maintain** | Update pages when new information arrives |
| **Flag** | Identify contradictions and inconsistencies |
| **Organize** | Maintain indexes, logs, and structure of the wiki |
| **Search** | Look up complementary information when necessary |

### Why this division works

Karpathy puts it this way: humans abandon wikis because the **maintenance burden grows faster than the value**. Maintenance becomes hard work as soon as the wiki reaches a certain size.

The LLM eliminates this bottleneck — the maintenance cost falls to almost zero, so the wiki **actually stays organized**.

---

## 7. The Four Principles That Make This Powerful

### Principle 1: Explicit

The knowledge is all **visible** in a navigable wiki. You can see exactly what the AI knows and what it does not know.

- No hidden embeddings
- No opaque memory system
- Everything is in readable markdown files

### Principle 2: It's Yours

They are **local files on your computer**. You:

- Are not locked into any provider
- Have total control over your data
- Can back up, version, migrate as you like

### Principle 3: File Over App

Everything is in **universal formats** — markdown and images.

- Interoperable with any tool
- Works with any CLI, any editor
- All of Unix toolkit works with your data
- Does not depend on any proprietary software

### Principle 4: Bring Your Own AI

You can use **any LLM**:

- Claude (Opus, Sonnet)
- ChatGPT
- Codex
- Open source models (Llama, Hermes, etc.)
- Any agent that does research and writing

You can even **fine-tune a model on your wiki** so it knows your data in the network's weights, not just in the context.

---

## 8. Practical Use Cases

The LLM Wiki pattern applies to various domains:

### Academic/Technical Research

- Go deep into a topic over weeks and months
- Read papers and build a comprehensive wiki
- Develop a thesis that evolves over time
- Track the state of the art in a field

### Personal Use

- Track goals, health, self-improvement
- Build a structured view of yourself over time
- Organize personal learnings and insights

### Business

- Internal wiki fed by Slack, meetings, customer calls
- Always up to date because the LLM does the maintenance
- Automatic onboarding of new members

### Reading and Study

- Process each chapter of a book
- Build character and theme pages
- Create connections between different works

### Due Diligence and Analysis

- Research on companies, markets, technologies
- Structured comparisons between alternatives
- Tracking of trade-offs

---

## 9. How to Build Yours: Step by Step

### Directory Structure

```
my-wiki/
├── raw/                    # Raw sources (IMMUTABLE)
│   ├── article-01.md
│   ├── paper-xyz.pdf
│   ├── video-transcript.txt
│   └── tweet-thread.md
│
├── wiki/                   # Wiki managed by the LLM
│   ├── index.md            # Master index
│   ├── log.md              # Change log
│   │
│   ├── summaries/          # Summaries of each source
│   │   ├── article-01.md
│   │   └── paper-xyz.md
│   │
│   ├── concepts/           # Concept pages
│   │   ├── concept-a.md
│   │   └── concept-b.md
│   │
│   ├── entities/           # Entity pages
│   │   ├── person-x.md
│   │   └── tool-y.md
│   │
│   └── synthesis/          # Syntheses and comparisons
│       ├── comparison-ab.md
│       └── topic-evolution.md
│
└── CLAUDE.md               # Schema: rules and workflows
```

### Step 1: Create the Structure

Create the directories above in your project.

### Step 2: Write the Schema (CLAUDE.md)

This is the most important file. It tells the LLM **how** to manage the wiki. Example:

```markdown
# Wiki Schema

## Structure
- Use Obsidian-style links: [[page-name]]
- Each concept page must have: definition, examples, related links
- Each summary must have: metadata (source, date, author), key points, extracted concepts

## Conventions
- File names in kebab-case
- Tags in YAML frontmatter
- Contradictions marked with > ⚠️ CONTRADICTION

## Workflows

### Ingestion
1. Read the full raw source
2. Create summary page in wiki/summaries/
3. Extract concepts and entities
4. Create or update pages in wiki/concepts/ and wiki/entities/
5. Update wiki/index.md
6. Update wiki/log.md with timestamp
7. Check contradictions with existing pages

### Query
1. Search the index
2. Read relevant pages
3. Synthesize response
4. If the answer brings new knowledge, create/update pages

### Lint
1. Check broken links
2. Find orphan pages
3. Identify contradictions
4. Suggest gaps to investigate
```

### Step 3: Add Raw Sources

Place your materials in the `raw/` folder:
- Video transcripts
- Copied articles
- Text papers
- Twitter threads
- Meeting notes

### Step 4: Ingest the Sources

Ask the LLM (via Claude Code, ChatGPT, etc.) to process each source following the ingestion workflow defined in the schema.

Example prompt:

```
Ingest the file raw/article-01.md following the ingestion workflow
defined in CLAUDE.md. Create the summary, extract concepts and entities,
update the index and the log.
```

### Step 5: Query and Expand

Ask questions. When the LLM does not find the answer in the wiki, it can search the web and **automatically update the wiki** with the new knowledge.

### Step 6: Periodic Maintenance

Periodically, ask the LLM to do a lint of the wiki:

```
Do a complete health check of the wiki. Find contradictions,
orphan pages, missing cross-references and suggest gaps
to investigate.
```

---

## 10. The Compound Effect: How the Wiki Becomes Smarter

This is the central concept that differentiates the LLM Wiki from RAG:

```
Time ──────────────────────────────────────────────▶

RAG:
  Question 1 → [search] → response (discarded)
  Question 2 → [search] → response (discarded)
  Question 3 → [search] → response (discarded)
  → No accumulation. Always starting from scratch.

LLM Wiki:
  Source 1    → [ingestion] → wiki updated (5 pages)
  Source 2    → [ingestion] → wiki updated (12 pages, cross-references)
  Question 1  → [query] → response + wiki updated (14 pages)
  Source 3    → [ingestion] → wiki updated (20 pages, contradiction flagged)
  Question 2  → [query + web] → response + wiki updated (25 pages)
  → COMPOUND knowledge. Each interaction enriches the base.
```

### How it works in practice

1. You ask about concept X
2. The LLM responds using the wiki
3. You ask something the wiki does not cover
4. The LLM does a web search
5. Finds additional information
6. **Automatically creates new pages** with that knowledge
7. Future questions about this topic use the new pages
8. No longer needs to search the web — the knowledge is already in the wiki

> *"The wiki gets smarter on its own as you ask questions and, when there is information it cannot find internally, makes quick searches and fills in the gaps to have all answers in the future."*

---

## 11. Tools and Visualization

### Obsidian as IDE

Karpathy recommends using [Obsidian](https://obsidian.md/) as the wiki visualizer:

- **Wiki links** (`[[page]]`) work natively
- **Knowledge graph** shows visual connections between pages
- **Navigation** between pages with one click
- **Preview** of rendered markdown
- It is light and free

### Compatible LLMs

Any LLM that can read files and write markdown works:

| Tool | How to use |
|-----------|-----------|
| **Claude Code** (with Opus) | Ideal — reads/writes files, does web search, uses subagents |
| **ChatGPT** | File upload + instructions in system prompt |
| **Open source** (Llama, Hermes) | Via frameworks like LangChain or custom agents |
| **Cursor / Windsurf** | AI IDEs that manipulate files directly |

### Additional Outputs

In addition to markdown pages, you can configure the LLM to create:

- **Slideshows** in markdown (presentations)
- **Graphs** with matplotlib/mermaid
- **Diagrams** viewable in Obsidian
- **Comparison tables** between concepts

---

## 12. Conclusion and Next Steps

### Concept Summary

The LLM Wiki is a pattern where:

1. **You** collect sources and ask questions
2. **The LLM** builds and maintains an interconnected wiki of markdown files
3. **Knowledge accumulates** instead of being discarded after each conversation
4. **Cross-references exist beforehand**, do not need to be reconstructed at each query
5. **Contradictions are flagged** automatically
6. **Maintenance is almost free** because the LLM does everything

### What makes this different from RAG

| Aspect | RAG | LLM Wiki |
|---------|-----|----------|
| Knowledge | Reconstructed at each query | Persistent and cumulative |
| Cross-references | Non-existent | Automatic and maintained |
| Contradictions | Invisible | Explicitly flagged |
| Maintenance | Manual (human) | Automatic (LLM) |
| Transparency | Opaque embeddings | Readable markdown |
| Portability | Locked to provider | Universal local files |
| Cost per query | High (re-search always) | Low (pre-built wiki) |

### Next steps for you

1. **Choose a domain** you want to deepen
2. **Collect 5-10 sources** initial (articles, videos, papers)
3. **Create the directory structure** as described above
4. **Write your schema** (CLAUDE.md) with the wiki rules
5. **Ingest the sources** using your preferred LLM
6. **Start asking** and watch the wiki grow organically
7. **Do periodic lints** to maintain quality

### The next level

Karpathy suggests that the natural next step is to **fine-tune a model on your wiki**, so it knows your data in the neural network's weights — not just in the conversation context. This would create a personalized model that is an expert in your specific domain.

---

> *"Knowledge accumulates instead of being discarded after each conversation."*
> — Andrej Karpathy
