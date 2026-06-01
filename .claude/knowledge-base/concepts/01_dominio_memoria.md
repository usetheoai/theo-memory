# Memory Domain — ADRs

> **This file has been restructured.** The content has been expanded into 8 dedicated chapters.
> Kept as an ADR reference for existing links.

---

## Chapters

| Chapter | What it covers |
|---|---|
| [01_conceitos_fundamentais.md](01_conceitos_fundamentais.md) | Problem, taxonomy, categories, invariants |
| [02_arquitetura.md](02_arquitetura.md) | 5 components, UML diagrams, flows |
| [03_estrategias_escrita.md](03_estrategias_escrita.md) | Explicit vs automatic, ADR-02, ADR-09 |
| [04_mecanismos_recall.md](04_mecanismos_recall.md) | 4 mechanisms, ADR-01, ADR-15 |
| [05_consolidacao_dream.md](05_consolidacao_dream.md) | Dream Pipeline, ADR-14 |
| [06_llm_auxiliar.md](06_llm_auxiliar.md) | Tiered system, ADR-11 |
| [07_seguranca.md](07_seguranca.md) | Threat model, defenses |
| [08_fronteira.md](08_fronteira.md) | Emerging paradigms |

---

## Memory Domain ADRs

### ADR-01: No Embeddings — Recall by Substring + Relevance Score

**Status:** Accepted
**Decision:** Do not use embeddings for agent memory recall. Recall uses substring matching + Jaccard-on-words + dedup.
→ Details: [04_mecanismos_recall.md](04_mecanismos_recall.md)

### ADR-02: Explicit (Agent-Driven) Writes, Not Automatic

**Status:** Accepted
**Decision:** The agent decides what to persist via the `store_memory` tool. Sub-agent folds are persisted automatically.
→ Details: [03_estrategias_escrita.md](03_estrategias_escrita.md)

### ADR-09: Pre-Compaction Hook (Notify, Not Extract)

**Status:** Accepted
**Decision:** The `on_pre_compress` hook notifies the memory domain but **does not extract automatically**.
→ Details: [03_estrategias_escrita.md](03_estrategias_escrita.md)

### ADR-11: Auxiliary LLM — Cheap Model for Compaction and Memory Selection

**Status:** Accepted
**Decision:** Tiered system: cheap (Haiku-class) for volume, intermediate (Sonnet-class) for consolidation.
→ Details: [06_llm_auxiliar.md](06_llm_auxiliar.md)

### ADR-14: Consolidation — Automatic Dream with Protection of Atomic Types

**Status:** Accepted — **VALIDATED IN PRODUCTION** (Anthropic Dreaming, May 2026)
**Decision:** Automatic Dream with trigger >24h + ≥5 sessions, mandatory backup, atomic types protected.
→ Details: [05_consolidacao_dream.md](05_consolidacao_dream.md)

### ADR-15: Recall Frequency — 4 Complementary Mechanisms

**Status:** Accepted — **REINFORCED by empirical evidence** (Memory Curse, arXiv:2605.08060)
**Decision:** 4 mechanisms: automatic per-N-turns, on-demand tool, loop reload, JIT file-access.
→ Details: [04_mecanismos_recall.md](04_mecanismos_recall.md)
