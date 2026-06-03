# QUALITY GATES — Module 06 Memory Systems

> Validation checklist for PRs that touch the Memory domain. Mirrors the checklist in `/home/paulo/Projetos/specs/CLAUDE.md` filtered for Memory (Guardians 1 partial, 2, 3, 11, 14, 15) + one extra security question anchored in [07_seguranca.md](07_seguranca.md).
>
> **Application rule:** if the expected answer is different for any line, the PR **MUST** be reviewed against the corresponding Guardian / Rule before being approved.

---

## 1. Main Checklist

| # | Question | Expected answer | Guardian (CLAUDE.md) | Rule (RULES.md) | Chapter |
|---|---|---|---|---|---|
| 1 | Does the Context Engine write to Memory at any point (compaction, summary, persisted artifact)? | **NO** | G1 | Rule 1 | [02_arquitetura.md §1](02_arquitetura.md), [ARCHITECTURE.md §6 I1](ARCHITECTURE.md) |
| 2 | Is there an embedding model import or vector index creation in the recall path? | **NO** | G2 | Rule 2 | [04_mecanismos_recall.md §2 ADR-01](04_mecanismos_recall.md) |
| 3 | Is there automatic extraction of facts/lessons from messages to persist to memory? | **NO** | G3 | Rule 3 | [03_estrategias_escrita.md §5, §6](03_estrategias_escrita.md) |
| 4 | Is the main model (Opus-class) used for compaction summary, memory selection, session summaries, or Dream merge? | **NO** | G11 | Rule 4 | [06_llm_auxiliar.md §2 ADR-11](06_llm_auxiliar.md) |
| 5 | Does consolidation (Dream) touch atomic types (`user`, `feedback`, `reference`) or delete originals without backup? | **NO** | G14 | Rule 5 | [05_consolidacao_dream.md §3.2, §4](05_consolidacao_dream.md) |
| 6 | Is recall **only** single-shot at bootstrap **or only** per-turn? | **NO** | G15 | Rule 6 | [04_mecanismos_recall.md §4 ADR-15](04_mecanismos_recall.md) |
| 7 | Does the write path skip threat scanning, frontmatter validation, or content size limits? And does recall skip the memory context fence? | **NO** | — *(local extension)* | Rule 7 | [07_seguranca.md §2](07_seguranca.md) |

---

## 2. Per-Gate Detail

### Gate 1 — Domain Separation (Memory side)

Look for:
- Calls to `write_reflection`, `store_memory`, or any memory write path originating from the Context Engine.
- Compaction pipeline that persists summary/artifact to the memory store instead of keeping them ephemeral.
- "Special handling" of Memory by the Context Engine (separate budget, privileged ordering).

If found: review against **Guardian 1** in CLAUDE.md + Rule 1 in RULES.md.

### Gate 2 — No Embeddings

Look for:
- Imports of `sentence-transformers`, `openai.embeddings`, `cohere.embed`, etc., inside the agent recall path.
- Dependencies on FAISS, Annoy, ChromaDB, Qdrant, sqlite-vec, pgvector for the memory store.
- Cosine similarity computation over dense vectors in relevance scoring.

If found: review against **Guardian 2** in CLAUDE.md + Rule 2 in RULES.md.

### Gate 3 — Explicit Writes

Look for:
- Background workers that analyze recent turns and write to the memory store.
- `on_pre_compress` hooks that call write paths instead of just logging/notifying.
- Compaction that extracts structured "facts" and persists them to durable memory.

If found: review against **Guardian 3** in CLAUDE.md + Rule 3 in RULES.md.

### Gate 4 — Tiered Auxiliary LLM

Look for:
- Memory selection or compaction summary routes calling the main model by default.
- Absence of escalated fallback to the next tier.
- Absence of cooldown after auxiliary failure.
- Hardcoded model name without override via config.

If found: review against **Guardian 11** in CLAUDE.md + Rule 4 in RULES.md.

### Gate 5 — Dream Consolidation

Look for:
- Dream trigger firing outside the combined conditions (`>24h` AND `>=5 sessions` AND no lock).
- Mutation without prior backup.
- Merge logic that includes atomic types (`user`, `feedback`, `reference`).
- Configuration that keeps fewer than `N=3` last session files intact.
- Missing `consolidation_meta.json` or `MEMORY.md` regeneration after consolidation.

If found: review against **Guardian 14** in CLAUDE.md + Rule 5 in RULES.md.

### Gate 6 — Recall Frequency

Look for:
- Recall firing only at bootstrap (insufficient coverage).
- Recall firing every turn (pollution).
- Absence of any of the 4 mechanisms: auto-per-N-turns, on-demand tool, diff reload between pauses, JIT file-access.
- Automatic recall without hash-based dedup (re-runs identical queries unnecessarily).
- Cumulative budget absent or unlimited in the automatic mechanism.

If found: review against **Guardian 15** in CLAUDE.md + Rule 6 in RULES.md.

### Gate 7 — Memory Security (local extension)

Look for:
- Write path that does not go through threat scanner before persisting.
- Frontmatter without validation of `name` and recognized `type`.
- Recall blocks delivered to the Context Engine without `<memory-context>` fence + system note.
- Memory snapshot mutable mid-session (breaks prefix cache and opens hole for late injection).
- Provider failure that propagates exception and crashes the agent loop.
- Absence of content size limits on write (DoS vector via overflow).
- Persistence of strings matching credential/token/secret patterns without rejection.

If found: review against Rule 7 in RULES.md + [07_seguranca.md](07_seguranca.md). This is the only gate without an equivalent Guardian in CLAUDE.md — treated as an authorized local extension and anchored in the security chapter.

---

## 3. Blocking Criterion

- **Any violated gate** → PR blocked until explicit justification and/or correction.
- If the violation is intentional (proposal for ADR change), open a separate issue referencing the Guardian in CLAUDE.md and await decision before merging.
- Never merge with a violated gate and a "TODO: fix later" note — Memory is a persistent attack vector (Rule 7) and silent degradation (Memory Curse, Rule 3 / Rule 6).

---

## 4. Cross References

- Guardian source of truth: `/home/paulo/Projetos/specs/CLAUDE.md`
- Localized rules: [RULES.md](RULES.md)
- Reference architecture: [ARCHITECTURE.md](ARCHITECTURE.md)
- Domain and ADRs: [01_dominio_memoria.md](01_dominio_memoria.md)
