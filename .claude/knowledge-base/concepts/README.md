# Module 05 — Memory Systems (Deep Dive)

> Durable cross-session memory — what the agent "knows" when it starts a new session.

## Objective

Master memory systems for code agents: cognitive concepts, component architecture, write strategies, recall mechanisms, automatic consolidation, efficient use of auxiliary models, and security. All without commitment to any specific language or implementation.

## The Central Problem

How to persist and retrieve knowledge that survives the end of a session? What the agent learned, what failed, recurring patterns, lessons from sub-agents — all of this needs to be available in the next session without polluting the context window.

**Principle:** high-quality memory with controlled recall > voluminous memory with indiscriminate recall.

## Chapters

| # | Chapter | Focus |
|---|---|---|
| 1 | [Fundamental Concepts](01_conceitos_fundamentais.md) | The problem, CoALA taxonomy, knowledge categories, invariants |
| 2 | [Architecture](02_arquitetura.md) | 5 components, UML diagrams, main flows |
| 3 | [Write Strategies](03_estrategias_escrita.md) | Explicit vs automatic vs hybrid, ADR-02, ADR-09 |
| 4 | [Recall Mechanisms](04_mecanismos_recall.md) | 4 mechanisms, no embeddings, scoring, budget, ADR-01, ADR-15 |
| 5 | [Consolidation (Dream)](05_consolidacao_dream.md) | 10-step pipeline, lifecycle, forgetting curve, ADR-14 |
| 6 | [Tiered Auxiliary LLM](06_llm_auxiliar.md) | Tiered system, fallback, cooldown, savings, ADR-11 |
| 7 | [Security](07_seguranca.md) | Threat model, defense in depth, attack scenarios |
| 8 | [Emerging Paradigms](08_fronteira.md) | BeliefMem, MAGMA, AgeMem, MemMachine, A-MEM, and more |

## Reference Architecture

→ [ARCHITECTURE.md](ARCHITECTURE.md) — Complete architectural document with class, component, state, and sequence diagrams (UML/Mermaid).

## Governing ADRs

| ADR | Decision |
|---|---|
| **ADR-01** | No embeddings for recall — substring + Jaccard + BM25 |
| **ADR-02** | Explicit (agent-driven) writes, not automatic |
| **ADR-09** | Pre-compaction hook notifies, never extracts |
| **ADR-11** | Tiered auxiliary LLM (cheap for volume, intermediate for reasoning) |
| **ADR-14** | Dream consolidation with protection of atomic types |
| **ADR-15** | 4 complementary recall mechanisms |

## Supporting Research

- [pesquisa/INDEX.md](pesquisa/INDEX.md) — Index of 30+ SOTA sources on agent memory
- [pesquisa/agent-memory-sota.md](pesquisa/agent-memory-sota.md) — Complete report on the SOTA architecture

## Prerequisites

- [00_fundamentos/](../00_fundamentos/) — What an agent is
- [02_ferramentas/](../02_ferramentas/) — Tool use (required to understand store_memory/recall_memory)
- [05_context_engineering/](../05_context_engineering/) — Context Engine (required to understand the Memory ↔ Context boundary)

## Next module

→ [07_conexao_memory_context/](../07_conexao_memory_context/) — How Memory and Context connect: unidirectional flow, 15 ADRs, session model
