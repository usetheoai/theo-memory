# Snapshot — DMR (Deep Memory Retrieval) — MemGPT origin + Zep SOTA

**URLs:** https://arxiv.org/abs/2310.08560 (MemGPT) + https://arxiv.org/abs/2501.13956 (Zep)
**Fetched:** 2026-06-02 via WebSearch + WebFetch (allowlist: `arxiv.org`)
**Used for question:** Q7 (DMR row)

---

## Extracted facts

### Origin — MemGPT (arXiv:2310.08560)

- **arXiv ID:** 2310.08560
- **Paper title:** "MemGPT: Towards LLMs as Operating Systems"
- **Authors:** Charles Packer, Vivian Fang (+ others)
- DMR was introduced as a primary evaluation metric in this paper.
- **DMR task description**: agent asked a specific question about a topic discussed in a prior conversation (sessions 1-5); response scored against gold answer.
- MemGPT outperforms GPT-4 / GPT-3.5 on DMR via Recall Memory queries.
- **DMR dataset basis:** 500-conversation subset of the Multi-Session Chat (MSC) dataset from "Beyond Goldfish Memory: Long-Term Open-Domain Conversation" — DMR is NOT a standalone dataset, it's a derived eval task on MSC.
- **No HF link** explicitly for DMR — only the upstream MSC dataset is hosted.

### Reproduction — Zep paper (arXiv:2501.13956)

- **arXiv ID:** 2501.13956 v1 (2025-01-20)
- **Paper title:** "Zep: A Temporal Knowledge Graph Architecture for Agent Memory"
- **Authors:** Daniel Chalef (Zep CEO) + collaborators
- **License (paper):** CC-BY-NC-SA 4.0
- **DMR results (Zep paper Section 4):**
  - **Zep: 94.8%**
  - **MemGPT (baseline): 93.4%**
  - Delta is small (+1.4pp absolute)
- **Paper's own framing on DMR strength:** authors note that LongMemEval is "more challenging" and "better reflects enterprise use cases" — implies DMR is showing ceiling effects (modern systems converge near 95%). Direct critique ("DMR transcripts not challenging enough") appears in vendor blog (`blog.getzep.com/state-of-the-art-agent-memory/`) but NOT in the arXiv abs page itself — caution against over-citing that line.

## DMR honest assessment for v0.8

- **Reproducibility:** MEDIUM — MemGPT shipped code is the canonical runner but DMR has no public HF dataset card (depends on MSC); benchmark has been reproduced by Zep with similar scores, so the methodology IS reproducible
- **Modern relevance:** LOW — Zep score 94.8% ~ MemGPT 93.4% ~ near-ceiling; differences fall in statistical noise of LLM-judge variance
- **License:** dataset (MSC) is governed by Beyond-Goldfish-Memory paper authors (Meta AI / Facebook); MSC was released under CC-BY-4.0 historically; verify per-file if v0.8 ships DMR runs
- **Effort:** SMALL — DMR is essentially "run QA against a memory system on a 500-convo subset"; the heavy lifting is the memory system, not the eval harness

## LoCoMo vs LongMemEval vs DMR — strategic priority for v0.8

| Benchmark | Reproducibility | Modern relevance | Effort | Strategic value |
|---|---|---|---|---|
| LongMemEval | HIGH (MIT data + public HF + ICLR 2025) | HIGH (most current, 30-60% drops still measured) | MEDIUM | **PRIMARY** — establishes v0.8 credibility |
| LoCoMo | MEDIUM (public on snap-research GH + CC-BY-NC-SA) | HIGH (300 turns / 35 sessions / 9k tokens) | MEDIUM | **SECONDARY** — Mem0 already shows their numbers here, comparison ground |
| DMR | MEDIUM (depends on MSC) | LOW (ceiling effects 93-95%) | SMALL | **TERTIARY** — include for historical compat with MemGPT / Zep claims, accept it shows tight scores |
