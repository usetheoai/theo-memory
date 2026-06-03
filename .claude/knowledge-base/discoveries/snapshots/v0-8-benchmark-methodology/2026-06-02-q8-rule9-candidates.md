# Snapshot — Q8 Rule 9 candidate benchmark-runner libs

**URLs evaluated:** github.com/explodinggradients/ragas + github.com/confident-ai/deepeval + docs.langchain.com/langsmith/evaluation
**Fetched:** 2026-06-02 via WebFetch (allowlist: `github.com`, `docs.langchain.com`)
**Used for question:** Q8

---

## EC-2 absorbed — 3 of 5 priority candidates evaluated

Per plan v1.1 ADR D3 + EC-2: cap at 5 candidates in priority order. Stopped at 3 because the 2-verdict minimum is satisfied + remaining 2 (BEIR + ARES) are unlikely to alter the verdict (BEIR is IR-only; ARES is academic-paper only — both unlikely to ship LongMemEval/LoCoMo/DMR support).

### 1. RAGAS (https://github.com/explodinggradients/ragas)

- **License:** Apache 2.0
- **Last release:** v0.4.3 (2026-01-13)
- **Language:** Python only
- **Scope:** RAG-focused evaluation; "agent_evals" template marked **"Coming Soon"** — agent-memory benchmarking NOT yet shipped
- **Memory-benchmark coverage (LongMemEval / LoCoMo / DMR):** NONE
- **Verdict: REJECT** — RAG-focused, agent-memory in roadmap not in product, Python-only doesn't match TheMemory's TypeScript-native runtime.

### 2. DeepEval (https://github.com/confident-ai/deepeval)

- **License:** Apache 2.0
- **Last release:** v4.0.5 (2026-05-28)
- **Language:** Python (100%) — TS folder exists but supplementary
- **Scope:** Broad LLM testing framework — RAG + agents + chatbots; LLM-as-judge + NLP + statistical methods
- **Pre-built benchmarks:** MMLU, HellaSwag, GSM8K (general LLM benchmarks, NOT memory)
- **Memory-benchmark coverage (LongMemEval / LoCoMo / DMR):** NONE explicit. "Knowledge Retention" multi-turn metric is the closest — measures factual retention across turns but is NOT the LongMemEval/LoCoMo/DMR task shape.
- **Verdict: REJECT** — strong framework but no out-of-the-box LongMemEval/LoCoMo/DMR; Python-only same as RAGAS; broad scope means lots of irrelevant surface for our narrow benchmark-reproduction need.

### 3. LangChain LangSmith Evaluations (https://docs.langchain.com/langsmith/evaluation)

- **License:** vendor-managed (LangChain Inc.) — NOT open-source
- **Self-hosting:** mentioned but pricing/licensing not surfaced on docs page
- **Language:** not specified in docs page (LangChain ecosystem supports Python + JS/TS)
- **Scope:** evaluators + datasets + orchestration with repetitions/concurrency/caching
- **Memory-benchmark coverage:** NOT mentioned — "general evaluation types"
- **Vendor coupling:** v0.8's whole point is INDEPENDENT reproduction; adopting LangSmith would couple v0.8 to LangChain Inc.'s SaaS + force consumers of `docs/benchmarks/v0.8.md` to have a LangSmith account to verify our numbers
- **Verdict: REJECT** — vendor lock-in defeats the "independent" framing of v0.8 (roadmap row 10); no memory-benchmark coverage either.

### 4. BEIR (not investigated within budget per EC-2 cap)

- **Known shape from common-knowledge** (NOT cited; common-knowledge is not a citation): IR-only benchmark suite (BEIR = Benchmarking IR). Designed for retrieval evaluation, not conversational memory.
- **Verdict (provisional, not deep-investigated):** REJECT for v0.8 memory benchmarks. BEIR could be relevant if v0.8 later added a separate "retrieval-only" axis.

### 5. ARES (not investigated within budget per EC-2 cap)

- **Verdict (provisional):** DEFER — academic paper landscape; revisit if v0.8 scope expands to RAG-style auxiliary measurement.

---

## Rule 9 final verdict for v0.8

**None of the 3 actively-investigated candidates (RAGAS / DeepEval / LangSmith) ship LongMemEval / LoCoMo / DMR adapters out of the box.** They are LLM-eval frameworks at the GENERIC layer — they cover metrics + LLM-judge + datasets/orchestration primitives.

**Strategic recommendation for v0.8:**

Adopt RAGAS or DeepEval as a **METRIC LIBRARY** dependency (their BLEU / F1 / LLM-judge / BERTScore implementations are battle-tested), BUT WRITE OUR OWN BENCHMARK RUNNER that integrates LongMemEval / LoCoMo / DMR fixtures + TheMemory + Mem0 + Zep + Letta adapters. This is honest Rule 9:

- Don't reinvent metric computation → use Mem0's own metric/utils.py pattern OR DeepEval/RAGAS for metrics
- Don't reinvent LLM-judge orchestration → write thin wrapper around OpenAI/Anthropic chat completion with prompt-from-config (anti-Mem0-hardcoded)
- DO write the runner ourselves → the LongMemEval/LoCoMo/DMR specific fixture parsing + adapter calls are too narrow for any framework to encode

This mirrors v0.7's pattern: we DON'T reinvent embedding/LLM/vector store, but we DO own the consolidation pipeline.
