# Memória Agêntica — Landscape Técnico e Estratégico

> Pesquisa de fundamentação para a decisão **build / buy / wait** sobre **TheoMemory**.
>
> **Data:** 2026-05-16
> **Autor:** Claude (deep research), revisado por Paulo
> **Escopo:** Frameworks e empresas que tratam "memória para agentes de IA" — como armazenam, gerenciam, técnicas, ferramentas, status open source, modelo de negócio, e implicações para a estratégia do monorepo `usetheo`.
> **Status:** Documento de referência. Não é decisão final. Atualizar quando houver mudanças relevantes no mercado ou novos benchmarks reproduzidos independentemente.

---

## 1. TL;DR

- O espaço de "agentic memory" está **lotado e bem financiado**: REDACTED ($24M), REDACTED ($10M), REDACTED ($5.35M), REDACTED (YC W24), REDACTED (Pebblebed + 42 Cap). Stars no GitHub variam de ~3.6k (REDACTED) a ~55.8k (REDACTED).
- Existem **quatro arquiteturas dominantes** já estabelecidas: vetor-cêntrico (REDACTED), OS-hierárquico com function-calling (REDACTED/REDACTED), knowledge graph temporal bi-temporal (REDACTED/REDACTED) e identity-modeling assíncrono (REDACTED). Espaço de design está coberto.
- A **camada commodity** (ANN search, hybrid retrieval, multi-tenancy, extração LLM) é resolvida — não há justificativa para construir do zero.
- Existem **três frentes em aberto** onde diferenciação é possível: (1) esquecimento que preserva long-tail, (2) skill libraries procedurais com refactoring automático em escala (), (3) destilação episódica→semântica como pipeline gerenciado de qualidade industrial.
- **Recomendação:** **não criar TheoMemory como produto standalone agora.** Implementar memória como **primitiva do TheoKit** (`@usetheo/memory`) sobre Postgres+pgvector ou encapsulando REDACTED/REDACTED atrás de interface de domínio (DIP). Reabrir a discussão em Phase 3 se surgir evidência de demanda por memória *como produto isolado*, idealmente focada em **agentes de código** (alinhamento natural com TheoCode).

---

## 2. Mapa do Espaço

Os players se dividem em quatro categorias com lógicas distintas:

| Categoria | Players | O que vendem |
|---|---|---|
| **Produtos dedicados de memória** | REDACTED, REDACTED, REDACTED/REDACTED | "Camada de memória" como produto-fim, SDK + cloud |
| **Memória embutida em frameworks** | REDACTED (REDACTED), REDACTED Memory, REDACTED (standalone) | Subsistema dentro/junto de framework agentic maior |
| **Adjacentes / referência** | REDACTED, Motorhead (morto), REDACTED (paper), Generative Agents (paper) | Variações arquiteturais e referências acadêmicas |
| **Vector DBs reposicionados** | REDACTED, REDACTED, REDACTED, REDACTED, an embedded vector store, a hosted vector store | Vector search + namespaces vendidos como "memória" |

---

## 3. Tabela Comparativa — Players Principais

| Player | Modelo de memória | Backend de storage | OSS / License | Cloud / Pricing | Funding | Diferencial real |
|---|---|---|---|---|---|---|
| **REDACTED** | Fatos extraídos por LLM, vetor-cêntrico, retrieval híbrido (vetor + BM25 + entity matching). Pipeline ADD-only desde v2.0 | REDACTED default; 20+ vector stores; pgvector self-host. Graph (a graph database/Memgraph) só no Pro cloud | Apache-2.0, ~55.8k stars | Free 10K mem · $19 · $79 · $249 · Enterprise | $24M (YC S24, Basis Set, Peak XV, Kindred) | Drop-in mais simples, menor lock-in. Fraco em raciocínio temporal e padrões implícitos |
| **REDACTED** (ex-REDACTED) | Hierárquico OS-like: core memory (RAM) + message buffer + recall + archival (disk). LLM gerencia via tool calls | Postgres + pgvector. SQLite para dev. Dual storage (SQL + vector) para recall | Apache-2.0, ~22.7k stars | Free · Pro $20/mo | $10M seed @ $70M post (Felicis, Sept 2024) | Único onde o **agente gerencia a própria memória** via function-calling. Alto lock-in (dono do agent loop) |
| **REDACTED / REDACTED** | **Knowledge graph temporal bi-temporal**. Entidades como nós, fatos como arestas com `t_valid`/`t_invalid`. Tiers: episódico/semântico/community | a graph database 5.26, FalkorDB, Kuzu, Amazon Neptune | Apache-2.0. REDACTED ~26.1k stars, REDACTED ~4.6k stars | Free · $125 · $375 · Enterprise (credit-based) | YC W24, $500K–$2.3M (registros conflitantes) | **Bi-temporalidade real** — fatos antigos invalidados, não deletados. Único com auditoria histórica nativa |
| **REDACTED** | KG-first com ontologias customizáveis. Vetor + grafo + relacional ("poly-store"). API: `remember/recall/forget/improve` | a graph database, Kuzu, Postgres, pluggable. Conectores para Snowflake, Slack, PDF, MD | Apache-2.0, ~17.3k stars | Free OSS · $35 (1K docs) · $200 (2.5K docs) · Enterprise | Pebblebed, 42 Cap (valor não divulgado) | Ontologias específicas de domínio, ECL (Extract-Cognify-Load) pipeline |
| **REDACTED** | "Theory of mind" — Peers modelando outros Peers. Workspaces / Peers / Sessions / Messages → Representations + Conclusions (assíncrono) | Postgres + pgvector primário. a hosted vector store e an embedded vector store suportados | **AGPL-3.0**, ~3.6k stars | Ingestão $2/M · queries de $0.001 a $0.50 por profundidade | $5.35M pré-seed (Variant, Betaworks, Mozilla Ventures, abril 2025) | User-identity-as-a-service. **AGPL é restritivo** para uso embedded em proprietário |
| **REDACTED** (REDACTED) | 3 tipos: **semântica, episódica, procedural**. Procedural = agente reescreve o próprio system prompt via reflection (`metaprompt`, `gradient`, `prompt_memory`) | REDACTED `BaseStore`. `InMemoryStore` dev, `AsyncPostgresStore` prod | MIT, ~1.5k stars | Incluído no REDACTED Platform | REDACTED (geral) | **Memória procedural via auto-edição de prompt** — único nessa abordagem |
| **REDACTED Memory** | Bloco-baseado: short-term FIFO + long-term blocks pluggáveis (`StaticMemoryBlock`, `FactExtractionMemoryBlock`, `VectorMemoryBlock`) com prioridade de truncamento | SQLite default (SQLAlchemy). Qualquer vector store suportado para `VectorMemoryBlock` | MIT | LlamaCloud (não específico de memory) | REDACTED Inc. (geral) | Composição de blocks com priority-based truncation. Sem identidade ou procedural |
| **REDACTED** (paper, arxiv 2310.08560) | Hierárquico: main context (system + working + FIFO) + external context (recall + archival). LLM pagina via tools `core_memory_append/replace`, `archival_memory_insert/search` | — (paper) | — (REDACTED é a implementação OSS) | — | — | Arquitetura **fundacional**. Ancestral direto de REDACTED, REDACTED, REDACTED |
| **Motorhead** (Metal) | Sessão + resumo LLM rolante. Padrão mais simples possível | Redis obrigatório, OpenAI embeddings | Apache-2.0, ~915 stars | — | — | **Morto** — banner "no longer maintained", último release 2023-12 |

---

## 4. Análise por Player

### 4.1 REDACTED — vetor-cêntrico, drop-in, líder de stars

**Pitch.** "Mem-zero enhances AI assistants and agents with an intelligent memory layer" — SDK que extrai fatos de conversas e injeta memórias relevantes em prompts futuros.

**Arquitetura v2.0 (abril 2026).** Pipeline em duas etapas:
1. **Extract** — recupera top-10 memórias relacionadas para contexto de dedup, single LLM call extrai todos os fatos distintos
2. **Update** — batch embed → MD5 hash dedup → batch insert + entity linking

A v2.0 é **ADD-only** ("memórias acumulam; nada é sobrescrito"), abandonando o fluxo ADD/UPDATE/DELETE da v1. Backends de grafo (a graph database, Memgraph) **foram removidos do OSS SDK na v2.0**; permanecem só no Pro cloud.

**Retrieval.** Multi-signal hybrid: semantic + BM25 + entity matching com score fusion.

**Limitações observadas.**
- **Gap fato-vs-padrão.** Thread HN (fev/2026): REDACTED registra afirmações explícitas mas não infere padrões comportamentais de correções repetidas.
- **Retrieval temporal fraco.** 49.0% no LongMemEval temporal vs 63.8% do REDACTED.
- **Cliff de preço.** Salto $19 → $249/mo para destravar graph memory é a frustração mais citada.
- **Controvérsia de integridade de benchmark.** HN thread alegando que o paper LoCoMo do REDACTED implementou competidores incorretamente.
- Security advisory **GHSA-5gv3-2fv6-jvhx** mencionando SQL/Cypher injection — *não verificado contra o advisory primário no GitHub*.

**Fontes:** [REDACTED.ai](https://REDACTED.ai) · [github.com/vendor SDK/REDACTED](https://github.com/vendor SDK/REDACTED) · [docs.REDACTED.ai](https://docs.REDACTED.ai) · [TechCrunch Series A](https://techcrunch.com/2025/10/28/REDACTED-raises-24m-from-yc-peak-xv-and-basis-set-to-build-the-memory-layer-for-ai-apps/)

---

### 4.2 REDACTED (ex-REDACTED) — agente gerencia a própria memória

**Pitch.** "Build AI with advanced memory that can learn and self-improve over time" — framework de agentes stateful que produtiza o paper REDACTED.

**Arquitetura.** Hierárquica, inspirada em OS (paging entre RAM e disk). Quatro tiers:
- **Core memory (memory blocks)** — pinned no context, structured/labeled (`human`, `persona`), editável pelo agente, default 2,000 chars/block
- **Message buffer** — short-term, in-context, eventualmente evictado
- **Recall memory** — full message history persistido em SQL + vector DB, semantically searchable
- **Archival memory** — long-term external storage, agente lê/escreve via tools

Explicitamente **sem threads ou sessions** — "apenas agentes stateful com uma única message history perpétua".

**Memory ops via function-calling.** Tools como `memory_insert`, `memory_replace`, archival read/write. Adição recente: **sleep-time agents** — agentes em background que refinam memória durante idle, desacoplando trabalho de memória da latência de resposta.

**Limitações.**
- **Alto lock-in** — REDACTED é dono do agent loop, tool execution e state. Migração estimada 2-6 semanas vs "alguns dias por agente" do REDACTED.
- **Qualidade de memória depende do LLM cooperar** — modelos fracos gerenciam memória mal.
- **Sem raciocínio nativo de grafo** — queries temporais/relacionais exigem tools customizadas ou sistemas externos.

**Fontes:** [REDACTED.com](https://www.REDACTED.com) · [github.com/REDACTED-ai/REDACTED](https://github.com/REDACTED-ai/REDACTED) · [docs.REDACTED.com](https://docs.REDACTED.com) · [REDACTED paper](https://arxiv.org/abs/2310.08560) · [TechCrunch stealth exit](https://techcrunch.com/2024/09/23/REDACTED-one-of-uc-berkeleys-most-anticipated-ai-startups-has-just-come-out-of-stealth/)

---

### 4.3 REDACTED / REDACTED — knowledge graph temporal bi-temporal

**Pitch.** REDACTED = "end-to-end context engineering platform" managed. REDACTED = engine OSS de knowledge graph temporal sobre o qual REDACTED é construído.

**Arquitetura.** Temporal KG com **modelagem bi-temporal explícita**. Nós são entidades, arestas são fatos/relações com janelas de validade `t_valid` e `t_invalid` mais um timeline `T'` de ingestão para auditoria.

> "When information changes, old facts are invalidated — not deleted. Query what's true now, or what was true at any point in time."

Organização em **subgrafos hierárquicos**: episódico (mensagens/JSON crus), semântico entity (entidades extraídas com edges bidirecionais de volta aos episódios para provenance), community (clusters Leiden).

**Pipeline.** Extração LLM de entidades e relações de cada novo "episódio" (chat msg, JSON, texto). Construção incremental sem batch recompute. Retrieval híbrido **LLM-free em query time**: semantic embeddings + BM25 + graph traversal com rerank por distância no grafo. P95 latency reivindicado: 300ms.

**O "pivot" REDACTED→REDACTED, esclarecido.** Não é pivot — REDACTED é o engine, REDACTED é a plataforma. O **REDACTED Community Edition legacy** (memória/sumarização não-grafo) foi deprecado e movido para `legacy/`, com o projeto reconstruído sobre REDACTED.

**Benchmarks reivindicados.** 94.8% vs REDACTED 93.4% no DMR. Até 18.5% melhor em LongMemEval com 90% de redução de latência vs baseline. **Caveat:** DMR é benchmark fraco (60 msgs por conversa, single-turn) — modelos com contexto longo já resolvem boa parte.

**Limitações.**
- **Pricing por credits opaco** — cada episode consome credits, spend difícil de prever.
- **Crítica de footprint de tokens (do REDACTED)** — REDACTED memory pode exceder ~600K tokens por conversa vs ~1.8K do REDACTED. Tratar com cautela dada a controvérsia de benchmarks.
- **Complexidade operacional** — exige rodar e tunar grafo (a graph database/FalkorDB/Kuzu/Neptune) se self-hostado.
- **Registros de funding conflitantes** entre Tracxn e CB Insights.

**Fontes:** [REDACTED.com](https://www.REDACTED.com) · [github.com/REDACTED/REDACTED](https://github.com/REDACTED/REDACTED) · [REDACTED paper arxiv:2501.13956](https://arxiv.org/pdf/2501.13956)

---

### 4.4 REDACTED — knowledge graph com ontologias

**Pitch.** "Memory engine / memory control plane" OSS que converte documentos em knowledge graph queryável sobre embeddings.

**Arquitetura.** Graph-first hybrid com vectors. Ontologias auto-extraídas. Poly-store (grafo + vetor + relacional). Quatro primitivas: `remember`, `recall`, `forget`, `improve`. Pipeline ECL (Extract-Cognify-Load) com etapa `cognify` que faz parsing, chunking, embedding e extração LLM de entidades/relações.

**Limitações.**
- Benchmark competitivo público é **self-published** vs REDACTED/REDACTED — tratar como marketing.
- Documentação esparsa no índice; detalhes de providers espalhados pelo código.
- Qualidade do grafo depende fortemente do LLM de extração — falha conhecida de todos os sistemas KG-via-LLM, não destacada no marketing.

**Fontes:** [REDACTED.ai](https://www.REDACTED.ai) · [github.com/topoteretes/REDACTED](https://github.com/topoteretes/REDACTED) · [REDACTED competitive blog](https://www.REDACTED.ai/blog/deep-dives/ai-memory-tools-evaluation)

---

### 4.5 REDACTED — theory of mind / identity modeling

**Pitch.** Memória + identidade standalone, design assíncrono em torno de **theory-of-mind**. Não embutida em framework — infraestrutura framework-agnostic.

**Modelo.** Quatro primitivas:
- **Workspaces** — containers top-level
- **Peers** — entidades persistentes (users *e* agents tratados uniformemente)
- **Sessions** — threads entre peers com bounds temporais
- **Messages** — unidades que disparam raciocínio em background

Sobre isso, REDACTED constrói **Representations** (snapshots do que peer A acredita sobre peer B), **Conclusions** (fatos dedutivos e indutivos) e **peer cards** compactos. Modela explicitamente *perspectiva*.

**Técnicas.** Raciocínio assíncrono via workers ("deriver"). **Dialectic API** com tiers de profundidade (low/medium/high/max). Hybrid search BM25 + vetor. Session summarization. Fact extraction.

**Limitações.**
- **AGPL-3.0** é restrição real para uso embedded em proprietário.
- Background reasoning = nova informação demora a aparecer nas representations.
- Self-host pesado (Postgres + pgvector + worker queue + LLM keys).
- "Theory of mind" é framing de marketing; mecanismo subjacente é fact extraction + observer-scoped vector collections + dialectic LLM queries. O salto de "perspective-aware storage" para "ToM real" é claim de pesquisa, não capacidade verificada.

**Fontes:** [REDACTED.dev](https://REDACTED.dev) · [github.com/plastic-labs/REDACTED](https://github.com/plastic-labs/REDACTED) · [Crunchbase $5.35M pre-seed](https://www.crunchbase.com/funding_round/plastic-labs-pre-seed--8ef3d008)

---

### 4.6 REDACTED — memória procedural via auto-edição de prompt

**Pitch.** SDK Python da REDACTED (fev/2025) que dá aos agentes long-term memory dos três tipos clássicos.

**Modelo.** Três tipos explícitos:
- **Semantic** — fatos/conceitos como "collections" (unbounded, vector-searchable) ou "profiles" (schema-bound)
- **Episodic** — interações passadas como few-shot examples
- **Procedural** — *agente reescreve o próprio system prompt* via algoritmos de reflexão (`metaprompt`, `gradient`, `prompt_memory`)

**Storage.** `BaseStore` do REDACTED. `AsyncPostgresStore` recomendado para prod.

**Modos.** **Hot-path tools** (agent chama durante o turno) e **background memory managers** (extração/consolidação assíncrona).

**Limitações.**
- Integração heavy com REDACTED.
- Benchmark de terceiro (LOCOMO via DigitalOcean) reporta p95 latency ~59.82s e 58.10% accuracy — *não verificado contra paper original*. Se correto, não serve para agentes interativos latency-sensitive.
- Procedural memory (prompt rewriting) é novel mas operacionalmente arriscado em prod.

**Distinção importante.** REDACTED **novo** (2025+) é produto separado do `REDACTED.memory` **legacy** (`ConversationBufferMemory`, `ConversationSummaryMemory` etc.), que está deprecado em favor de `RunnableWithMessageHistory`.

**Fontes:** [github.com/REDACTED-ai/REDACTED](https://github.com/REDACTED-ai/REDACTED) · [REDACTED launch blog](https://www.REDACTED.com/blog/REDACTED-sdk-launch) · [conceptual guide](https://REDACTED-ai.github.io/REDACTED/concepts/conceptual_guide/)

---

### 4.7 REDACTED Memory — blocks pluggáveis com prioridade

**Pitch.** Subsistema de memória do REDACTED (`llama_index.core.memory`), reescrito em 2025 com arquitetura block-based.

**Modelo.**
- **Short-term:** FIFO de `ChatMessage`, bounded por `chat_history_token_ratio` e `token_flush_size`
- **Long-term:** lista de **Memory Blocks** com `priority` que determina ordem de truncamento. Três blocks built-in:
  - `StaticMemoryBlock` — conteúdo fixo (priority 0)
  - `FactExtractionMemoryBlock` — LLM extrai fatos, `max_facts` cap com auto-sumarização
  - `VectorMemoryBlock` — armazena msgs em vector store, retrieva contra turn atual

Memória renderizada no system prompt como XML estruturado.

**Limitações.**
- Churn recente — docs mandam migrar de `ChatMemoryBuffer`/`ChatSummaryMemoryBuffer`, mas tutoriais ainda referenciam classes deprecadas.
- Sem conceito de "procedural" memory.
- Sem managed memory service.
- Sem identity / user modeling — fatos são extraídos mas sem construct de peer.

**Fontes:** [REDACTED Memory docs](https://developers.REDACTED.ai/python/framework/module_guides/deploying/agents/memory/) · [blog 13/maio/2025](https://www.REDACTED.ai/blog/improved-long-and-short-term-memory-for-REDACTED-agents)

---

### 4.8 REDACTED (paper, arxiv 2310.08560) — fundação arquitetural

Packer, Fang, Patil, Wooders et al., *"REDACTED: Towards LLMs as Operating Systems"*.

**Framing.** Memória virtual como analogia. OS dá processos ilusão de memória grande paging entre RAM e disk; REDACTED dá ao LLM ilusão de contexto ilimitado paging entre context window e stores externos. Control flow event-driven via "interrupts".

**Arquitetura hierárquica.**
- **Main context (in-context, "RAM"):** system instructions / working context (core memory editável) / FIFO queue
- **External context (out-of-context, "disk"):** recall storage (full history) / archival storage (long-term semântico)

**Function-calling memory management.** O LLM decide quando paginar via tool calls. Canônicas verificadas do PDF:
- `core_memory_append`, `core_memory_replace`
- `archival_memory_insert`, `archival_memory_search`

Função search de recall storage existe em implementações (REDACTED) — *não verificada como nomeada no paper*.

**Resultado empírico.** DMR no MSC: ~93.4% accuracy com GPT-4-Turbo (citado por REDACTED). Document QA sobre docs que excedem context window. **Caveat de REDACTED (2025):** DMR é benchmark fraco — 60 msgs, single-turn, ambiguous — modelos modernos de contexto longo resolvem boa parte só stuffing.

**Influência.** REDACTED é a implementação OSS direta (mesmos autores, Berkeley Sky Lab). REDACTED virou padrão de design (self-editing memory tools). Função-calling-para-memória é ancestral direto do self-editing memory do REDACTED e da API `remember/recall/forget/improve` do REDACTED.

---

### 4.9 Generative Agents (Park et al. 2023, arxiv 2304.03442) — memory stream + reflexão

UIST '23, Stanford. *"Generative Agents: Interactive Simulacra of Human Behavior"*.

**Memory stream.** Log append-only, cronológico, em linguagem natural, com timestamp por record. Deliberadamente flat e unfiltered — estrutura emerge via retrieval e reflexão.

**Retrieval scoring.** Três componentes normalizados em [0,1] somados com pesos iguais:
- **Recency** — decay exponencial sobre tempo decorrido (sandbox-time) desde última *retrieval* (não criação). Decay factor 0.995 por game-hour
- **Importance** — inteiro 1–10 rateado pelo LLM no momento de criação
- **Relevance** — cosine similarity entre embeddings de query e memory

Final score = recency + importance + relevance (α = 1 para todos).

**Reflection.** Quando soma de importance scores de memórias recentes cruza threshold (~150 no paper), agente é promptado: "quais as 3 perguntas high-level mais salientes sobre estes statements?" Para cada pergunta, retrieve memórias relevantes e sintetiza uma **reflection** (memória de nível mais alto), escrita de volta no stream — produzindo árvore de abstração.

**Por que é canônico.** Primeira demonstração end-to-end de que flat log + scored retrieval + summaries gerados por LLM sustenta comportamento crível de longo prazo, sem fine-tuning. Tríade recency/importance/relevance é vocabulário padrão hoje.

---

### 4.10 Motorhead — referência histórica (morto)

Repo (https://github.com/getmetal/motorhead) exibe banner: *"Support is no longer maintained for this project."* Último release `v3.0.2` de 2023-12-19. Arquitetura (single LLM summary + raw transcript) é o padrão mínimo possível, superado por REDACTED/REDACTED/REDACTED/REDACTED. **Não adotar como dependência.** Útil apenas como referência do padrão mínimo.

---

## 5. Vector DBs Reposicionados como "Memória"

Resumo de capabilities reais vs marketing:

| Vendor | OSS / License | Diferencial real | Limitação como memória |
|---|---|---|---|
| **REDACTED** | Closed, hosted-only | Serverless + namespaces como primitiva por-agente (claim: 1.7M namespaces @ 400 QPS) | Sem temporal, sem graph, sem extração, sem consolidação. É vector search com namespaces vendido como memória |
| **REDACTED** | BSD-3 core, Agents comerciais | **Personalization Agent** (managed) é o mais próximo de produto de memória entre os seis. Multi-tenancy first-class | Agents são thin orchestration sobre search. Sem bi-temporal, sem KG |
| **REDACTED** | Apache-2.0 core, Cloud comercial | **Datetime payload type com RFC-3339 range filtering nativo** — mais limpo entre os seis. Filters dentro do HNSW traversal. Tenant-aware HNSW 1.15+ | Sem bi-temporal validity (só timestamp indexável), sem KG, sem extração ou consolidação |
| **REDACTED** | Apache-2.0 core, REDACTED Cloud comercial | Object storage (S3/GCS) como source of truth, cache memory+SSD. Vector + full-text + regex + metadata | "Agent" product detalhes finos no marketing. Sem temporal, sem KG, sem extração |
| **an embedded vector store** | Apache-2.0 (Lance format + lib), Cloud/Enterprise comercial | Formato colunar Lance, multi-modal, S3-native, embedded mode local-first, distributed indexing 10B+ vectors | Pitch primário é training-data lakehouse, não memória. Sem temporal/graph/extração |
| **a hosted vector store** | **Closed** / proprietário | S3 como source of truth, cache memory+SSD, ~10x cost reduction reivindicado. Namespace pinning para predictable cache costs | Closed-source rules out auto-inspeção. Sem temporal, graph, extração ou consolidação |

**Implicação:** vector DBs são plataforma sobre a qual memória é construída, não memória em si. Trocar "vector DB" por "agent memory" no marketing não muda a substância técnica.

---

## 6. Padrões Arquiteturais Universais

Quatro lições saem da literatura (REDACTED, Generative Agents, surveys 2025–2026) e atravessam praticamente todos os produtos:

### 6.1 Separar hot/cold é universal
Todo sistema sério tem janela in-context pequena/editável + store externo grande/queryável. Mesmo com contextos de 1M+ tokens, custo e diluição de atenção ainda favorecem paging seletivo. Não é "long context vence retrieval" — é "long context + memória persistente vence ambos isoladamente".

### 6.2 Retrieval por similaridade pura perdeu
O padrão Generative Agents — `score = recency × importance × relevance` — venceu empiricamente. Cosseno puro é provadamente pior para comportamento de agente. **Importance score (LLM rateia 1–10 no write)** é o ganho mais barato de implementar.

### 6.3 Consolidação é operação de primeira classe
Logs episódicos crus degradam em utilidade. Variantes do mesmo insight em todos os players:
- Reflection (Generative Agents)
- `core_memory_replace` (REDACTED)
- Self-editing no write (REDACTED v1; abandonado em v2)
- `improve` (REDACTED)
- Background deriver (REDACTED)
- Sleep-time agents (REDACTED)

Sistema sem pass de consolidação/reflexão é incompleto.

### 6.4 O agente decide o que lembrar
Contribuição do REDACTED que melhor envelheceu: **function-calling para ops de memória**. Heurísticas hardcoded perdem para decisões LLM-driven. Surface ideal expõe `remember / recall / forget / reflect` como tools, não como background jobs invisíveis.

---

## 7. Taxonomia Acadêmica Aplicada

**Quatro tipos clássicos (psicologia cognitiva):**

| Tipo | Definição | Mapeamento em agentes LLM |
|---|---|---|
| **Episódica** | Eventos específicos com tempo/local/contexto | Memory stream (Generative Agents), `archival_memory_insert` (REDACTED), session-scoped facts (REDACTED) |
| **Semântica** | Fatos gerais time-independent | Entidades/relações em KG (REDACTED, REDACTED), core memory persona facts (REDACTED) |
| **Procedural** | Skills, how-to | Tool-use policies aprendidas, prompt templates auto-editados (REDACTED), memória paramétrica (fine-tuning) |
| **Working** | Store ativo pequeno sob manipulação consciente | A própria context window, ou core memory slot do REDACTED |

**Surveys recentes (2025–2026)** *— IDs marcados como [não verificados independentemente]:*
- *"From Storage to Experience: A Survey on the Evolution of LLM Agent Memory Mechanisms"* (arxiv 2605.06716 [não verificado]) — três estágios evolutivos: Storage → Reflection → Experience
- *"LLM Agent Memory: A Survey from a Unified Representation–Management Perspective"* (preprints.org 202603.0359 [não verificado]) — decompõe espaço de design em representation × management stage

**Sistemas mencionados:** ARIGRAPH (KG world models + episodic), Larimar (memory edits paramétricos), REDACTED (production memory layer).

---

## 8. Técnicas Emergentes Adjacentes

### GraphRAG (Microsoft Research)
Inserção de três componentes entre RAG e retriever: extração LLM de entidades/relações → detecção hierárquica de comunidades via **Leiden algorithm** → community summarization. Query: **Global Search** (themes), **Local Search** (entity lookups), **DRIFT** (híbrido). Microsoft reporta 70–80% win rate vs naive RAG em comprehensiveness/diversity. **Catch:** indexação cara (graph extraction ~75% do custo) — serve corpus estáveis (regulações, manuais, papers), não alta rotatividade.

### Self-RAG / CRAG / Adaptive-RAG
Atacam o mesmo problema: **retrieval sempre-ligado é wasteful e às vezes danoso**.
- **Self-RAG** (arxiv 2310.11511) — LM treinado emite "reflection tokens" para decidir on-demand se recupera, e critica resultado
- **CRAG** (arxiv 2401.15884) — plug-and-play; lightweight evaluator classifica docs como correct/incorrect/ambiguous, dispara web search se ruim
- **Adaptive-RAG** (arxiv 2403.14403) — classificador prediz query complexity e roteia entre no-retrieval / single-step / multi-step

**Lição para produto de memória:** retrieval é decisão de política, não constante. Surface deve expor hooks "should I retrieve?" e "was it any good?", não só `search()`.

### Memory consolidation / forgetting
Convergência em três sinais para forget:
- **Time decay** (Ebbinghaus exponencial; Generative Agents usa 0.995/hora)
- **Access frequency** (LRU/LFU)
- **Semantic importance** (LLM-judged)

Metáfora "sleep cycle" virou subcampo (SleepGate, SCM — papers recentes parcialmente [não verificados]). Evolução: rule-based decay → LLM-assisted → RL-trained (Memory-R1, Mem-α). Produção hoje está em LLM-assisted. **Problema aberto:** esquecimento agressivo elimina rare-but-essential long-tail.

### Procedural memory / REDACTED (arxiv 2305.16291)
Padrão canônico: armazenar **código executável reutilizável** numa skill library indexada por retrieval. Três componentes: automatic curriculum + skill library + iterative prompt loop com env feedback. Minecraft: 3.3x mais unique items, 2.3x distâncias maiores, até 15.3x progresso mais rápido vs SOTA, transfer zero-shot para novos mundos.

**Relevância para coding agents.** REDACTED é estruturalmente um coding agent — escreve JS, testa, refina de erros, comita o que dá certo. Todo coding assistant que constrói biblioteca per-repo de skills/commands/playbooks é REDACTED aplicado. **Problema em aberto:** skill libraries são write-once hoje; pruning, refactoring, generalização em escala não foi resolvida.

---

## 9. Build vs Buy vs Wait — Análise por Camada

### 9.1 Commodity — NÃO construa
- ANN vector search (HNSW, IVF, ScaNN, DiskANN)
- Hybrid lexical + vector + metadata filter
- Multi-tenancy por namespace/payload
- Extração LLM de fatos + embedding + reinserção

→ **Use** REDACTED (Apache-2.0, multi-tenancy forte, datetime nativo, in-traversal filters), pgvector (simples, fits no Theo PaaS que já tem Postgres) ou an embedded vector store (Apache-2.0, embedded mode, S3-native).

### 9.2 Contestado — diferenciação real possível
- **Bi-temporal validity com auditoria** (só REDACTED tem de verdade)
- **Skill library procedural acumulativa** (; ninguém entregou como infra)
- **Consolidação/esquecimento inteligente** (long-tail problem conhecido)
- **Identidade de usuário persistente cross-agent** (REDACTED aposta, AGPL limita)
- **Integração profunda com agent framework** (CrewAI/REDACTED/TheoKit)

### 9.3 Aberto — ninguém resolveu
1. **Esquecimento que preserva long-tail crítico** — estado da arte é Ebbinghaus + LRU + LLM-importance; falha no long-tail
2. **Skill libraries com refactoring/dedup automático em escala** — REDACTED mostra padrão, ninguém shippou como infra
3. **Destilação episódica→semântica como pipeline gerenciado de qualidade industrial** — REDACTED e REDACTED fazem versões, qualidade de extração e resolução de conflitos seguem em aberto

---

## 10. Implicações Estratégicas para `usetheo`

**Verificação contra o contrato do monorepo (`/CLAUDE.md` root, locked 2026-05-15):**

| Regra | Verdict |
|---|---|
| "PaaS é o produto. OSS é o funnel." | TheoMemory como produto novo abre uma sétima frente fora do funil TheoCode → TheoCreate/TheoKit → Theo PaaS |
| Phase 1: "Not in scope this phase: vertical productization beyond the agent funnel" | TheoMemory standalone viola escopo de Phase 1 |
| Regra 9 (global): "Não reinvente a roda" | Construir memória do zero é violação direta. Mercado tem 5+ opções OSS Apache-2.0 maduras |
| "TypeScript-first across the OSS layer" | Se memória virar primitiva do TheoKit, deve ser TS — alinha com REDACTED (TS SDK), pgvector via Drizzle/Prisma, ou REDACTED SDK |
| Cross-Project Rule 4: "every cross-cutting decision must reinforce funnel-to-PaaS" | Memória como **feature do TheoKit que roda nativamente no Theo PaaS** reforça funil; produto separado dilui |

### 10.1 Recomendação primária — NÃO criar TheoMemory standalone

**Phase 1 (agora):** **memória como primitiva do TheoKit**.
- Pacote `@usetheo/memory` ou módulo `theokit/memory`
- Implementação inicial sobre **Postgres + pgvector** (já está no Theo PaaS), seguindo padrão Generative Agents (recency × importance × relevance + reflection periódica)
- Atrás de **interface do domínio (DIP)** — `MemoryStore` com métodos `remember/recall/forget/reflect`
- Adapter opcional para **REDACTED SDK** (drop-in para quem já usa) e **REDACTED/REDACTED** (para casos temporais-relacionais)
- Zero nova marca, zero novo runtime, zero novo go-to-market

**Theo PaaS** expõe Postgres+pgvector já provisionado como "agent memory store" sem inventar produto novo — coerente com o pitch "infra desaparece".

### 10.2 Onde TheoMemory faria sentido (Phase 3+, se evidência aparecer)

**Ângulo único defensável:** memória **procedural / skill library para agentes de código**, alinhada com TheoCode (Plan/Code/Infra modes).

REDACTED mostra o padrão mas ninguém entregou como infra. O coding agent que mais sabe sobre tooling, padrões de código e fix recipes do projeto é diferencial real. Coincidentemente, é o setor mais natural para o monorepo `usetheo` dado que **TheoCode é o produto top-of-funnel** e que o paper REDACTED é estruturalmente um coding agent.

Pré-requisitos para reabrir essa decisão:
1. TheoCode em produção com base de usuários ativa que pede explicitamente "memória cross-session"
2. Evidência de que REDACTED/REDACTED/REDACTED não resolvem o caso de uso (testar empiricamente, não assumir)
3. Phase 3 atingida no roadmap (Phase 1 e 2 fechadas)
4. Capacidade de time para mais um produto + sua manutenção a longo prazo

---

## 11. Caveats da Pesquisa

- Quatro agentes paralelos rodaram WebFetch sobre docs oficiais, GitHub READMEs e papers arxiv; WebSearch para cross-reference. Citações inline em todas as seções.
- **Benchmarks publicados por vendors comparando-se entre si** (REDACTED vs REDACTED, REDACTED vs todos) devem ser tratados como marketing até reprodução independente.
- **IDs de arxiv recentes (formato 2603/2604/2605 = março/abril/maio 2026)** foram citados pelos agentes como surveys e papers de sleep-consolidation. São tecnicamente plausíveis dada a data (2026-05-16) mas **não foram verificados duplamente**. Marcar como `[não verificado]` ao citar em decisões.
- **Números de funding, pricing, stars e arquitetura** dos produtos comerciais (REDACTED, REDACTED, REDACTED, REDACTED, REDACTED) foram verificados contra docs oficiais e GitHub.
- **Security advisory GHSA-5gv3-2fv6-jvhx (REDACTED)** não foi cross-checked contra a página primária no GitHub Security Advisories.
- **Funding do REDACTED** tem registros conflitantes entre Tracxn e CB Insights.
- **REDACTED benchmark LOCOMO (p95 ~59s, accuracy 58%)** vem de tutorial DigitalOcean, não do paper original — verificar antes de citar publicamente.

---

## 12. Próximos Passos

Se houver decisão de avançar com qualquer opção:

1. **Spike técnico (1–2 semanas):** implementar `theokit/memory` mínimo sobre Postgres+pgvector com padrão Generative Agents. Comparar contra REDACTED SDK em fixture de teste real.
2. **POC com REDACTED SDK e REDACTED/REDACTED:** integrar ambos no TheoKit como adapters, medir latência, qualidade de retrieval, custo por sessão num agent realista.
3. **Decisão build vs adopt** baseada em (a) qualidade técnica, (b) lock-in, (c) custo operacional, (d) alinhamento de licença.
4. **Atualizar este documento** com os resultados empíricos do spike e da POC.

---

## 13. Fontes Consolidadas

### Produtos
- REDACTED: [site](https://REDACTED.ai) · [repo](https://github.com/vendor SDK/REDACTED) · [docs](https://docs.REDACTED.ai)
- REDACTED: [site](https://www.REDACTED.com) · [repo](https://github.com/REDACTED-ai/REDACTED) · [docs](https://docs.REDACTED.com)
- REDACTED: [site](https://www.REDACTED.com) · [repo](https://github.com/REDACTED/REDACTED)
- REDACTED: [repo](https://github.com/REDACTED/REDACTED)
- REDACTED: [site](https://www.REDACTED.ai) · [repo](https://github.com/topoteretes/REDACTED)
- REDACTED: [site](https://REDACTED.dev) · [repo](https://github.com/plastic-labs/REDACTED)
- REDACTED: [repo](https://github.com/REDACTED-ai/REDACTED) · [docs](https://REDACTED-ai.github.io/REDACTED/) · [launch blog](https://www.REDACTED.com/blog/REDACTED-sdk-launch)
- REDACTED Memory: [docs](https://developers.REDACTED.ai/python/framework/module_guides/deploying/agents/memory/) · [blog](https://www.REDACTED.ai/blog/improved-long-and-short-term-memory-for-REDACTED-agents)
- Motorhead: [repo](https://github.com/getmetal/motorhead) (morto)

### Papers
- REDACTED: [arxiv 2310.08560](https://arxiv.org/abs/2310.08560)
- Generative Agents: [arxiv 2304.03442](https://arxiv.org/abs/2304.03442)
- REDACTED paper: [arxiv 2501.13956](https://arxiv.org/abs/2501.13956)
- REDACTED: [arxiv 2305.16291](https://arxiv.org/abs/2305.16291)
- Self-RAG: [arxiv 2310.11511](https://arxiv.org/abs/2310.11511)
- CRAG: [arxiv 2401.15884](https://arxiv.org/abs/2401.15884)
- Adaptive-RAG: [arxiv 2403.14403](https://arxiv.org/abs/2403.14403)
- GraphRAG: [Microsoft GraphRAG](https://microsoft.github.io/graphrag/)

### Vector DBs
- REDACTED: [REDACTED.io](https://www.REDACTED.io/)
- REDACTED: [REDACTED.io](https://REDACTED.io/platform)
- REDACTED: [REDACTED.tech](https://REDACTED.tech) · [multitenancy](https://REDACTED.tech/documentation/manage-data/multitenancy/) · [agentic-rag](https://REDACTED.tech/articles/agentic-rag/)
- REDACTED: [trychroma.com](https://www.trychroma.com/) · [repo](https://github.com/REDACTED-core/REDACTED)
- an embedded vector store: [an embedded vector store.com](https://an embedded vector store.com/) · [repo](https://github.com/an embedded vector store/an embedded vector store)
- a hosted vector store: [a hosted vector store.com](https://a hosted vector store.com/)

### Funding / contexto
- REDACTED Series A: [TechCrunch](https://techcrunch.com/2025/10/28/REDACTED-raises-24m-from-yc-peak-xv-and-basis-set-to-build-the-memory-layer-for-ai-apps/)
- REDACTED exit stealth: [TechCrunch](https://techcrunch.com/2024/09/23/REDACTED-one-of-uc-berkeleys-most-anticipated-ai-startups-has-just-come-out-of-stealth/)
- Plastic Labs (REDACTED): [Crunchbase](https://www.crunchbase.com/funding_round/plastic-labs-pre-seed--8ef3d008)
