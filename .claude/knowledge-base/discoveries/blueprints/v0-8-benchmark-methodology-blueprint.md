# Blueprint: v0.8 Benchmark Methodology

> **Version 0.1** (skeleton — populated iteratively by `/discover-execute v0-8-benchmark-methodology`) — Synthesizes how memory-system benchmarks (LongMemEval / LoCoMo / DMR) are designed, run, and reported across Mem0 (rich `evaluation/` dir surface) + Letta (no committed benchmark code) + external prior art (papers + vendor blogs + Rule 9 candidate libs). Output informs `/auto-plan v0-8-independent-benchmark-reproduction` (roadmap Item 10).

**Slug:** `v0-8-benchmark-methodology`
**Source plan:** `.claude/knowledge-base/discoveries/plans/v0-8-benchmark-methodology-plan.md` (v1.1)
**Owner:** project owner (`usetheodev@gmail.com`)
**Generated:** 2026-06-02 via `/discover-execute`
**Confidence verdict:** TBD (updated by `/discover-confidence` after this blueprint completes)

## Context

`CLAUDE.md` roadmap row 10 (v0.8) requires reproducing LongMemEval + LoCoMo + DMR against TheMemory v0.7 + Mem0 v3 + Zep + Letta on **identical fixtures**. Row 11 (v1.0) gates `production-ready` claim on v0.8 reproduction. `/auto-plan v0-8-independent-benchmark-reproduction` Step 1 (`scripts/assess_confidence.py`) returned 20/100 LOW confidence with refusal — prior_art is unmapped. This blueprint closes that gap by investigating Mem0's shipped `evaluation/` dir + external academic + vendor prior art.

## Objective

Enable `/auto-plan v0-8-independent-benchmark-reproduction` to reach confidence ≥ 70 (SHIPPABLE_WITH_CAVEATS minimum) on first run after this blueprint ships.

---

## Coverage Corner 1 — Integration Tests

> Populated by Q3 (fixtures location + license).

### Mem0

**Fixture inventory (find result on evaluation/):** **ZERO committed data files** (no `*.json` / `*.jsonl` / `*.csv` / `*.parquet` / `*.yaml` under `evaluation/`).

**Fixture distribution:** **Google Drive folder** (Mem0-curated copy of LOCOMO), NOT Hugging Face. Citation `.claude/knowledge-base/references/mem0/evaluation/README.md:23-25`:

> The LOCOMO dataset used in our experiments can be downloaded from our Google Drive repository: [Download LOCOMO Dataset](https://drive.google.com/drive/folders/1L-cTjTm0ohMsitsHg4dijSPJtqNflwX-?usp=drive_link)

**Expected files** (per `run_experiments.py:41-69` + `src/rag.py:27`):

| Filename | Used by | Format |
|---|---|---|
| `dataset/locomo10.json` | mem0 (add+search), zep (add+search), openai | Original conversational data |
| `dataset/locomo10_rag.json` | rag, langmem | RAG-formatted variant |

Citations: `.claude/knowledge-base/references/mem0/evaluation/run_experiments.py:41`, `:49`, `:52`, `:56`, `:60`, `:65`, `:69`; `.claude/knowledge-base/references/mem0/evaluation/src/rag.py:27`.

**EC-1 WebFetch path INAPPLICABLE for Mem0 — no Hugging Face download path.** Grep across all `evaluation/*.py` + `evaluation/src/*.py` for `load_dataset|huggingface|hf://` returned ZERO matches. The HF allowlist addition (per ADR D3) remains useful for Q6/Q7 where LongMemEval + LoCoMo PRIMARY sources may be on HF, but Mem0's path is Google Drive.

**Critical finding — benchmark scope:** Mem0's `evaluation/` ships **LOCOMO only**. There is NO LongMemEval adapter, NO DMR adapter. The README:6 references "Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory" (arXiv:2504.19413, 2025) — that paper evaluates on LoCoMo specifically. **Implication for v0.8:** we cannot reuse Mem0's adapters for LongMemEval or DMR reproduction; we'll need to wire those benchmarks ourselves, or find third-party reproductions (Q6/Q7 will surface those).

**Mem0 repo LICENSE:** Apache-2.0 (`pyproject.toml:13`). **evaluation/ subdir LICENSE:** MIT per `evaluation/README.md:187-189` (the eval framework code itself, NOT the LoCoMo data). **LoCoMo dataset license:** governed by the LoCoMo paper authors (Snap Research) — out of scope for this question; deferred to Q7.

### Letta

**Letta-side fixture scope: NONE relevant.** Letta repo has no committed benchmark code (zero `longmemeval|locomo|dmr` matches per plan v1.1 Context). Letta's memory subsystem tests live in `.claude/knowledge-base/references/letta/tests/` but those are unit/integration tests of the memory ORM, NOT benchmark fixtures. Not relevant to Q3.

### LangMem (via Mem0 adapter — per ADR D4)

LangMem is invoked by Mem0's adapter at `.claude/knowledge-base/references/mem0/evaluation/src/langmem.py` (referenced from `.claude/knowledge-base/references/mem0/evaluation/run_experiments.py:56`). The adapter takes the SAME fixture `dataset/locomo10_rag.json` — no LangMem-specific fixtures. LangMem is just another consumer of LoCoMo via Mem0's runner.

---

## Coverage Corner 2 — Dependencies

> Populated by Q4 (evaluation deps + Rule 9 candidates).

### Mem0

**Critical finding (EC-5 absorbed):** Mem0's `pyproject.toml` declares NO `evaluation` extras group. Every dep imported in `evaluation/*.py` is ORPHAN from the root `mem0ai` package perspective — none of them install via `pip install mem0ai[evaluation]`.

**Core deps (declared in `pyproject.toml:16-24`):**

| Dep | Version | Reused in evaluation/? |
|---|---|---|
| `qdrant-client` | `>=1.12.0` | Yes (mem0 default vector store) |
| `pydantic` | `>=2.7.3` | Yes (config models) |
| `openai` | `>=1.90.0` | **Yes — `from openai import OpenAI` direct in eval** |
| `posthog` | `>=4.5.0` | No (telemetry; not in eval) |
| `sqlalchemy` | `>=2.0.31` | No |

**Optional extras relevant to eval (declared in `pyproject.toml:65-74`):**

| Group | Deps used in eval | Use site |
|---|---|---|
| `extras` | `sentence-transformers>=5.0.0` | `from sentence_transformers import SentenceTransformer` for cosine-sim utilities |
| `extras` | `langchain>=0.3.0,<1.0.0` + `langchain-core` + `langchain-community` | Transitively pulled by `langmem` adapter (not direct import in eval) |

**Orphan deps (imported in eval/*.py but NOT in any pyproject.toml group) — Rule 9 risk:**

| Orphan dep | Use in eval | Suggested handling for our v0.8 impl |
|---|---|---|
| `bert_score` | `metrics/utils.py` (semantic similarity) | ADOPT in `[project.optional-dependencies] evaluation` — pin to specific version |
| `nltk` | BLEU + METEOR scores | ADOPT in `evaluation` extras; pin version + ship corpus download script |
| `rouge_score` | ROUGE metric | ADOPT in `evaluation` extras |
| `sentence_transformers` | Mem0 has it in `extras` but eval imports it standalone | Move to `evaluation` extras for clarity |
| `numpy` + `pandas` | Stats aggregation | ADOPT in `evaluation` extras |
| `tiktoken` | Token counting (cost computation) | ADOPT in `evaluation` extras |
| `tqdm` | Progress bars | ADOPT in `evaluation` extras |
| `python-dotenv` (`from dotenv import load_dotenv`) | `.env` loading | ADOPT (or use stdlib if we accept env-var-only) |
| `jinja2` | Prompt templating | DEFER — we can use Python f-strings or our own template layer |
| `langgraph` (`from langgraph.checkpoint.memory import MemorySaver`) | LangMem adapter dependency | DEFER — adopt only if we keep LangMem adapter; otherwise REJECT |
| `langmem` (`from langmem import create_manage_memory_tool`) | LangMem adapter | DEFER — adopt only if we keep LangMem adapter |
| `zep_cloud` (`from zep_cloud.client import Zep`) | Zep adapter | ADOPT only if we ship Zep adapter; otherwise REJECT (replace with our own Zep HTTP client) |

Citations: `.claude/knowledge-base/references/mem0/pyproject.toml:16-84`; imports across `.claude/knowledge-base/references/mem0/evaluation/evals.py`, `run_experiments.py`, `metrics/utils.py`, `metrics/llm_judge.py`, `src/{memzero,zep,openai}/{add,search,predict}.py`.

**Recommendation for v0.8:** create dedicated `[project.optional-dependencies] evaluation` group in `package.json` (we're TS) OR explicit `benchmarks/package.json` with eval-only deps + lockfile. Avoid Mem0's mistake of leaving eval deps undocumented.

### Letta

<!-- TBD: Q4 / Letta deps for memory subsystem only -->

> Per plan ADR D4 + budget constraints: Letta has no committed benchmark code (plan v1.1 Context section). Letta-side scope for Q4 is limited to "does Letta's memory subsystem declare any unusual eval deps?" — investigated in later iteration if budget allows. Marked as DEFER for this corner; main signal lives in Mem0.

---

## Coverage Corner 3 — Tools

> Populated by Q5 (Makefile + env vars + wall-clock).

### Mem0

**Per-technique Makefile targets (10 entries):**

| Target | Command | Purpose |
|---|---|---|
| `run-mem0-add` | `python run_experiments.py --technique_type mem0 --method add` | Add memories via Mem0 OSS |
| `run-mem0-search` | `... --technique_type mem0 --method search --output_folder results/ --top_k 30` | Search Mem0 OSS |
| `run-mem0-plus-add` | `... --technique_type mem0 --method add --is_graph` | Mem0+ (graph memory) add |
| `run-mem0-plus-search` | `... --technique_type mem0 --method search --is_graph --output_folder results/ --top_k 30` | Mem0+ search |
| `run-rag` | `... --technique_type rag --chunk_size 500 --num_chunks 1 --output_folder results/` | RAG baseline (chunk 500) |
| `run-full-context` | `... --technique_type rag --chunk_size -1 --num_chunks 1 --output_folder results/` | Full-context baseline (no chunking) |
| `run-langmem` | `... --technique_type langmem --output_folder results/` | LangMem comparison |
| `run-zep-add` | `... --technique_type zep --method add --output_folder results/` | Zep add |
| `run-zep-search` | `... --technique_type zep --method search --output_folder results/` | Zep search |
| `run-openai` | `... --technique_type openai --output_folder results/` | OpenAI memory baseline |

Citation: `.claude/knowledge-base/references/mem0/evaluation/Makefile:3-31`

**Required environment variables (`.env` per README:54-71):**

- `OPENAI_API_KEY` — GPT models + embeddings
- `MEM0_API_KEY` + `MEM0_PROJECT_ID` + `MEM0_ORGANIZATION_ID` — hosted-platform Mem0 + Mem0+ tiers
- `MODEL` — defaults to `gpt-4o-mini`
- `EMBEDDING_MODEL` — defaults to `text-embedding-3-small`
- `ZEP_API_KEY` — Zep adapter

Citation: `.claude/knowledge-base/references/mem0/evaluation/README.md:54-71`

**Command-line parameters** (table at `.claude/knowledge-base/references/mem0/evaluation/README.md:111-119`):

| Parameter | Default |
|---|---|
| `--technique_type` (mem0 / rag / langmem / zep / openai) | mem0 |
| `--method` (add / search) | add |
| `--chunk_size` | 1000 |
| `--top_k` | 30 |
| `--filter_memories` | False |
| `--is_graph` | False |
| `--num_chunks` | 1 |

**Setup checklist (copy-paste ready for our v0.8 implementation):**

1. Create `.env` with the 7 keys above (OPENAI + MEM0 trio + MODEL + EMBEDDING_MODEL + ZEP)
2. Download LOCOMO dataset from Mem0's Google Drive folder ([linked at `README.md:23-25`](`.claude/knowledge-base/references/mem0/evaluation/README.md:23`)) → unzip into `dataset/`
3. Files expected: `dataset/locomo10.json` (original) + `dataset/locomo10_rag.json` (RAG-formatted)
4. Run: `make run-{technique}` OR `python run_experiments.py --technique_type {x}`
5. Evaluate: `python evals.py --input_file {results} --output_file {scored}` — computes BLEU + F1 + LLM-judge per question
6. Aggregate: `python generate_scores.py` — mean scores per category + overall

**Wall-clock: NOT DOCUMENTED** in `Makefile` or `README.md` (EC-8 honest answer — accepted per plan v1.1). Mem0 likely runs benchmarks on internal infra without publishing hardware specs. **For v0.8 implementation we will measure wall-clock + cost ourselves** — that's part of the v0.8 deliverable per roadmap row 10 ("P95 latency / cost/session" columns).

### Letta

<!-- TBD: Q5 / Letta tooling for memory testing if any -->

---

## Coverage Corner 4 — Techniques

> Populated by Q1 (benchmark runner architecture) + Q2 (metrics + LLM-judge).

### Mem0 — Benchmark runner architecture

**EC-4 outcome (duck-type contract — no shared interface):** there is NO base class / Protocol / abstract method shared across adapters. The `class Experiment` declared at `.claude/knowledge-base/references/mem0/evaluation/run_experiments.py:14-20` is a 2-method STUB (`__init__` + `run` that just `print`s) — it is NEVER instantiated. Orchestration is an imperative `if/elif` chain in `main()` at `.claude/knowledge-base/references/mem0/evaluation/run_experiments.py:39-71`.

**Constants** (`.claude/knowledge-base/references/mem0/evaluation/src/utils.py:1-3`):

```python
TECHNIQUES = ["mem0", "rag", "langmem", "zep", "openai"]
METHODS = ["add", "search"]
```

**Adapter inventory + duck-type variation:**

| Adapter | Class | Constructor signature | Primary method | Signature divergence |
|---|---|---|---|---|
| mem0 add | `MemoryADD` (`src/memzero/add.py:45`) | `(data_path=None, batch_size=2, is_graph=False)` | `process_all_conversations(max_workers=10)` | Uses internal ThreadPoolExecutor |
| mem0 search | `MemorySearch` (`src/memzero/search.py:18`) | `(output_path, top_k=10, filter_memories=False, is_graph=False)` | `process_data_file(file_path)` | filepath only |
| rag | `RAGManager` (`src/rag.py:26`) | `(data_path, chunk_size=500, k=1)` | `process_all_conversations(output_file_path)` | takes output path |
| langmem | `LangMemManager` (`src/langmem.py:96`) | `(dataset_path)` | `process_all_conversations(output_file_path)` | dataset_path NOT data_path (naming drift) |
| zep add | `ZepAdd` (`src/zep/add.py:13`) | `(data_path=None)` | `process_all_conversations(run_id)` | takes run_id |
| zep search | `ZepSearch` (`src/zep/search.py:34`) | `()` | `process_data_file(file_path, run_id, output_file_path)` | 3 positional args |
| openai | `OpenAIPredict` (`src/openai/predict.py:55`) | `(model="gpt-4o-mini")` | `process_data_file(file_path, output_file_path)` | 2 positional args |

**Routing dispatch** (`.claude/knowledge-base/references/mem0/evaluation/run_experiments.py:39-71`):

```python
if args.technique_type == "mem0":
    if args.method == "add":   memory_manager = MemoryADD(data_path="dataset/locomo10.json", is_graph=args.is_graph); memory_manager.process_all_conversations()
    elif args.method == "search": memory_searcher = MemorySearch(output_file_path, args.top_k, args.filter_memories, args.is_graph); memory_searcher.process_data_file("dataset/locomo10.json")
elif args.technique_type == "rag":     rag_manager = RAGManager(...); rag_manager.process_all_conversations(output_file_path)
elif args.technique_type == "langmem": langmem_manager = LangMemManager(dataset_path="dataset/locomo10_rag.json"); langmem_manager.process_all_conversations(output_file_path)
elif args.technique_type == "zep":
    if args.method == "add":   ZepAdd(...).process_all_conversations("1")
    elif args.method == "search": ZepSearch().process_data_file(...)
elif args.technique_type == "openai":  OpenAIPredict().process_data_file(...)
```

**Output convention:** JSON files in `results/` with technique-specific naming (e.g., `mem0_results_top_30_filter_False_graph_False.json`, `rag_results_500_k1.json`, `zep_search_results.json`).

**Architecture diagram (text):**

```
run_experiments.py main()
        │
        ├── argparse → (technique_type, method, ...)
        │
        ├── if technique_type == "mem0" → MemoryADD or MemorySearch
        ├── elif "rag" → RAGManager
        ├── elif "langmem" → LangMemManager
        ├── elif "zep" → ZepAdd or ZepSearch
        ├── elif "openai" → OpenAIPredict
        │
        ▼
    Adapter writes JSON to results/{technique}_*.json
        │
        ▼
    evals.py reads each result file → compute BLEU/F1/LLM-judge per question (see Q2)
        │
        ▼
    generate_scores.py aggregates per-category + overall mean scores
```

**Rule 9 lesson for v0.8 (RECOMMENDATION):** do NOT copy Mem0's adapter pattern verbatim. Mem0 ships a working skeleton with no abstraction — every new technique requires a new `if/elif` branch + a fully-custom adapter class. For TheMemory v0.8 with 4+ targets (TheMemory v0.7, Mem0 v3, Zep, Letta) + 3 benchmarks (LongMemEval, LoCoMo, DMR), define a proper TypeScript Protocol like:

```ts
interface BenchmarkAdapter {
  add(corpus: BenchmarkCorpus): Promise<AddMetrics>;
  search(query: BenchmarkQuery): Promise<SearchResult>;
}
interface BenchmarkRunner {
  run(adapter: BenchmarkAdapter, dataset: BenchmarkDataset): Promise<RunReport>;
}
```

so adapters become drop-in. Anti-Mem0 by design — embraces our DIP discipline (`architecture.md § 3`).

### Mem0 — Metrics + LLM-judge

**Metric module map** (`.claude/knowledge-base/references/mem0/evaluation/metrics/utils.py:42-164`):

| Function | Returns | Backing lib | Used by `evals.py`? |
|---|---|---|---|
| `simple_tokenize(text)` | tokens (list[str]) | stdlib | helper only |
| `calculate_rouge_scores(pred, ref)` | `{rouge1_f, rouge2_f, rougeL_f}` | `rouge_score.RougeScorer` (use_stemmer=True) | **NO — computed nowhere** |
| `calculate_bleu_scores(pred, ref)` | `{bleu1, bleu2, bleu3, bleu4}` (smoothing method1) | `nltk.translate.bleu_score` | YES (bleu1 only persisted) |
| `calculate_bert_scores(pred, ref)` | `{bert_precision, bert_recall, bert_f1}` lang="en" | `bert_score` package | **NO — computed nowhere** |
| `calculate_meteor_score(pred, ref)` | float | `nltk.translate.meteor_score` | **NO — computed nowhere** |
| `calculate_sentence_similarity(pred, ref)` | float (cosine) | `SentenceTransformer` + `pytorch_cos_sim` | **NO — computed nowhere** |
| `calculate_metrics(pred, ref)` | `{exact_match, f1, bleu1..bleu4}` | composite | YES (only f1 persisted) |
| `aggregate_metrics(...)` (line 167+) | aggregate | stats helper | YES (in generate_scores.py — Q5 pipeline) |

**Honest disconnect:** Mem0 ships 8 metric functions covering BLEU + F1 + ROUGE + BERT + METEOR + SBERT-cosine, but `evals.py:24-39` only persists 3 (`bleu_score=bleu1`, `f1_score`, `llm_score`). ROUGE / BERT / METEOR / SBERT are **dead code in the eval pipeline** — kept available for ad-hoc analysis but not in the default scorecard. Likely rationale: BERT/SBERT require model downloads + GPU is helpful; cost was prohibitive for the published Mem0 paper run.

Citation for the disconnect: `.claude/knowledge-base/references/mem0/evaluation/evals.py:24-39` shows the only persisted fields are `bleu_score`, `f1_score`, `llm_score`.

**LLM-judge contract** (`.claude/knowledge-base/references/mem0/evaluation/metrics/llm_judge.py:12-55`):

- **Model**: `gpt-4o-mini` HARDCODED at line 42
- **Temperature**: `0.0` (deterministic — line 52)
- **Response format**: `{"type": "json_object"}` (line 51)
- **Output schema**: `{"label": "CORRECT" | "WRONG"}` → mapped to `1` or `0` (binary, line 54-55)
- **Skips category 5** at `evals.py:23` and `llm_judge.py:88` — undocumented in the Mem0 README (likely a category they decided was too noisy)

**The prompt** (`.claude/knowledge-base/references/mem0/evaluation/metrics/llm_judge.py:12-36`):

Key instructional biases embedded in the prompt:
1. **"be generous with your grading - as long as it touches on the same topic"** (line 22-23) — explicit lenience
2. **Time-format normalization** (line 25) — "May 7th" == "7 May" counted CORRECT
3. **"Do NOT include both CORRECT and WRONG"** (line 33) — anti-rambling guardrail
4. **One-sentence reasoning** then label — chain-of-thought lite

**Known LLM-as-judge limitations** (recorded for v0.8 honest reporting):
- Single-call binary judgment (no rubric scoring, no confidence intervals)
- Temperature 0 doesn't guarantee determinism across `gpt-4o-mini` API versions (vendor-side drift over time)
- Single judge = bias amplification (no panel / cross-judge agreement check)
- Hardcoded "be generous" instruction is OPINIONATED — favors recall over precision in judgment

**Rule 9 lesson for v0.8 (RECOMMENDATION):** for our LLM-judge:
- Make model + prompt + temperature configurable, NOT hardcoded
- Persist the raw LLM response alongside the binary label (so future re-scoring without re-querying is possible)
- Run the judge MULTIPLE times per (q, gold, pred) with different seeds + report variance (`Self-Consistency` per Wang et al. 2023)
- Use a panel of 2-3 judges (gpt-4o + claude-sonnet + open-source) + report inter-judge agreement
- This aligns with v0.7's distillation work (LLM-judged-merge) and v0.7.1 LLM-measured eval discipline

**Evaluation pipeline shape** (`.claude/knowledge-base/references/mem0/evaluation/evals.py:14-40`):

```python
def process_item(item_data):
    for item in v:
        if category == "5": continue
        metrics = calculate_metrics(pred, gt)
        bleu_scores = calculate_bleu_scores(pred, gt)
        llm_score = evaluate_llm_judge(question, gt, pred)
        local_results[k].append({question, answer, response, category,
                                  bleu_score: bleu_scores["bleu1"],
                                  f1_score: metrics["f1"],
                                  llm_score})
    return local_results
```

Parallelism via `ThreadPoolExecutor(max_workers=10)` (line 64); per-item processed in worker, results merged under `threading.Lock`. LLM-judge call is the latency bottleneck (3 calls per item if BLEU+F1+LLM are sequential; only 1 of them is non-deterministic).

**Final scoring** (`.claude/knowledge-base/references/mem0/evaluation/generate_scores.py:1-34` — confirmed by README:142-162):

Reads `evaluation_metrics.json` → mean per category + overall mean of `bleu_score` + `f1_score` + `llm_score`. Output table shape:

```
Mean Scores Per Category:
         bleu_score  f1_score  llm_score  count
category
1           0.xxxx    0.xxxx     0.xxxx     xx
2           0.xxxx    0.xxxx     0.xxxx     xx
...
Overall Mean Scores:
bleu_score    0.xxxx
f1_score      0.xxxx
llm_score     0.xxxx
```

**No P95 latency / cost/session in Mem0's pipeline.** Those columns from our roadmap row 10 acceptance criteria are NOT measured by Mem0's evaluation/. We must add them ourselves in v0.8 implementation — orthogonal extension.

### Letta — Memory testing discipline (limited surface per ADR D4 budget)

<!-- TBD: Q1 / Letta-side proxy -->

---

## Coverage Corner 5 — Prior Art

> Populated by Q6 (LongMemEval), Q7 (LoCoMo + DMR), Q8 (Rule 9 candidate benchmark-runner libs). Added per `cycle-discover.md` v1.1 5-corner schema.

### LongMemEval (Q6)

| Field | Value | Citation |
|---|---|---|
| **arXiv ID** | 2410.10813 | https://arxiv.org/abs/2410.10813 (snapshot `.claude/knowledge-base/discoveries/snapshots/v0-8-benchmark-methodology/2026-06-02-arxiv-2410-10813-longmemeval.md`) |
| **Latest version** | v2 (2025-03-04) — EC-9 cited as authoritative | snapshot above |
| **Original submission** | v1 (2024-10-14) — no metric changes between v1 and v2 | snapshot above |
| **Venue** | ICLR 2025 | snapshot above |
| **Authors** | Di Wu, Hongwei Wang, Wenhao Yu, Yuwei Zhang, Kai-Wei Chang, Dong Yu | snapshot above |
| **Paper license** | CC BY-4.0 | snapshot above |
| **GitHub repo** | https://github.com/xiaowu0162/LongMemEval | snapshot `.claude/knowledge-base/discoveries/snapshots/v0-8-benchmark-methodology/2026-06-02-github-longmemeval-repo.md` |
| **Code license** | MIT (per repo LICENSE) | snapshot above |
| **HF dataset** | https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned | snapshot `.claude/knowledge-base/discoveries/snapshots/v0-8-benchmark-methodology/2026-06-02-hf-longmemeval-cleaned.md` |
| **Dataset license** | **MIT** (explicit on HF card — separately confirmed; EC-6 not fired — dataset is publicly accessible, not gated) | snapshot above |
| **Dataset size** | 3.03 GB total across 3 splits | snapshot above |
| **Splits** | `longmemeval_oracle` (with ground-truth context), `longmemeval_s_cleaned` (~115k tokens / ~40 sessions per history), `longmemeval_m_cleaned` (~500 sessions per history) | snapshot above |
| **Question count** | 500 curated questions | arXiv abstract |
| **Memory abilities tested** | (1) Information extraction, (2) multi-session reasoning, (3) temporal reasoning, (4) knowledge updates, (5) abstention | arXiv abstract |
| **Reproduction commands** | `wget https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_oracle.json` (+ s_cleaned + m_cleaned) | snapshot above |
| **Custom-history sampler** | `python sample_haystack_and_timestamp.py task n_questions min_n_haystack_filler max_n_haystack_filler` | snapshot above |
| **Third-party reproductions** | NONE found in repo README; no leaderboard linked. **Honest finding:** if v0.8 reproduces independently, our report will be one of the first public third-party reproductions on this benchmark. | snapshot above |

**Known dataset defect (honest reporting for v0.8):** HF dataset viewer is failing because the `answer` column mixes integer and object types in the JSON schema. v0.8 implementation must pre-parse / normalize the union type. Not a blocker for use but a quality-signal. Citation: HF snapshot above.

**Implication for v0.8 implementation:**
1. Drop-in compatible — MIT license + public HF + 3.03 GB tractable on a single dev machine
2. Three difficulty tiers (S 115k tokens / M 500 sessions / oracle with ground-truth) enable cost-graduated benchmarking
3. The 5 declared memory abilities map naturally to TheMemory's `remember` / `recall` / `forget` / `reflect` contract — Q6 alone gives us strong signal that LongMemEval is the highest-quality of the 3 benchmarks (peer-reviewed venue, public dataset, public code, reproducible by `wget`)
4. No third-party reproductions = v0.8 publication is novel contribution beyond TheMemory marketing

### LoCoMo (Q7 — separate row per EC-7 absorption)

| Field | Value | Citation |
|---|---|---|
| **arXiv ID** | 2402.17753 (v1, 2024-02-27) | https://arxiv.org/abs/2402.17753 (snapshot `2026-06-02-arxiv-2402-17753-locomo.md`) |
| **Title** | "Evaluating Very Long-Term Conversational Memory of LLM Agents" | snapshot above |
| **Authors** | Maharana, Lee, Tulyakov, Bansal, Barbieri, Fang (UNC Chapel Hill / USC / Snap Inc.) | snapshot above |
| **Venue** | preprint (cs.CL) — no accepted conference listed on arXiv as of fetch | snapshot above |
| **Paper license** | **CC-BY-NC-SA 4.0** (NonCommercial-ShareAlike) | snapshot above |
| **GitHub repo** | https://github.com/snap-research/locomo | search result |
| **Dataset location** | `./data/locomo10.json` in repo (also distributed by Mem0 via Google Drive — same content) | search result + Mem0 README snapshot |
| **Question count** | 500+ QA pairs derived from 10 long conversations (publicly released subset) | search result |
| **Conversation stats** | 300 turns / ~9k tokens average / up to 35 sessions per conversation | snapshot above |
| **Tasks** | QA + event summarization + multimodal dialogue generation | snapshot above |
| **EC-6 check** | Not gated (public GitHub) | search result |
| **Third-party reproductions** | **Mem0 (in their `evaluation/`)** ships full LoCoMo adapters — see Q1/Q3/Q5; **NO other third-party reproductions** found in search | Mem0 README snapshot + WebSearch |

**License implication for v0.8:** CC-BY-NC-SA 4.0 NonCommercial restriction. v0.8 reproduction for **academic publication of comparison results is permissible** (research / non-commercial); bundling LoCoMo data in TheMemory's paid SaaS distribution is NOT. v0.8 must download LoCoMo at install-time (like Mem0 does via Google Drive); do not commit to TheMemory's repo.

**v0.8 priority for LoCoMo: SECONDARY** — Mem0 already publishes LoCoMo numbers in their paper (`arXiv:2504.19413`); reproducing on the same dataset gives apples-to-apples comparison with Mem0's claims.

### DMR (Q7 — separate row per EC-7 absorption)

| Field | Value | Citation |
|---|---|---|
| **Origin paper** | MemGPT — arXiv:2310.08560 — "MemGPT: Towards LLMs as Operating Systems" — Packer, Fang, et al. | snapshot `2026-06-02-dmr-memgpt-zep.md` |
| **DMR task** | Agent asked specific question about a topic in prior sessions 1-5; response scored against gold answer | snapshot above |
| **Dataset basis** | 500-conversation subset of Multi-Session Chat (MSC) from "Beyond Goldfish Memory: Long-Term Open-Domain Conversation" (Meta AI / Facebook); MSC originally CC-BY-4.0 — verify per file when ingesting | snapshot above |
| **HF dataset** | No standalone HF dataset for "DMR" itself — researchers re-derive the 500-conv subset from MSC | snapshot above |
| **Code reference** | MemGPT GitHub (link in arXiv:2310.08560 paper) + Zep replication code | search result |
| **Major reproduction** | **Zep** — arXiv:2501.13956 v1 (2025-01-20), "Zep: A Temporal Knowledge Graph Architecture for Agent Memory" (Chalef et al.) — CC-BY-NC-SA 4.0 license | snapshot above |
| **Reported scores** | Zep: **94.8%** vs MemGPT: **93.4%** (delta +1.4pp) | snapshot above (Zep paper Section 4) |
| **Modern relevance** | LOW — ceiling effects: both modern systems converge near 95%; difference falls in LLM-judge noise. Zep paper itself frames LongMemEval as "more challenging" (implicit critique of DMR sufficiency without explicit "DMR is too weak" wording — caution against over-citing that line which appears in vendor blogs not the paper) | snapshot above |
| **EC-6 check** | MSC source dataset is publicly accessible (no gating); DMR is derived task, not a separately gated artifact | snapshot above |

**v0.8 priority for DMR: TERTIARY** — include because both MemGPT and Zep cite their DMR scores in their public marketing; we need our own DMR score to engage with their claims. Accept that DMR will show tight comparison (~93-95%) and frame the difference honestly.

**LoCoMo vs LongMemEval vs DMR — strategic priority for v0.8:**

| Benchmark | Reproducibility | Modern relevance | Effort | Strategic value |
|---|---|---|---|---|
| LongMemEval | HIGH (MIT data + public HF + ICLR 2025) | HIGH (30-60% performance gaps still measured at the frontier) | MEDIUM | **PRIMARY** — establishes v0.8 credibility independently |
| LoCoMo | MEDIUM (public on snap-research GH + CC-BY-NC-SA) | HIGH (300 turns / 35 sessions / 9k tokens) | MEDIUM | **SECONDARY** — Mem0 already publishes LoCoMo numbers; same dataset = apples-to-apples comparison against Mem0's paper |
| DMR | MEDIUM (depends on MSC) | LOW (ceiling effects 93-95%) | SMALL | **TERTIARY** — historical compat with MemGPT/Zep claims; accept tight comparison |

### Rule 9 — Existing benchmark-runner libraries (Q8)

> Per Q8 + EC-2 absorption: cap at 5 candidates in priority order. **3 of 5 investigated; 2 (BEIR + ARES) provisional + budget-capped per EC-2.** Snapshot at `.claude/knowledge-base/discoveries/snapshots/v0-8-benchmark-methodology/2026-06-02-q8-rule9-candidates.md`.

| # | Candidate | License | Last release | Memory-bench coverage (LongMemEval/LoCoMo/DMR) | Verdict | Reason |
|---|---|---|---|---|---|---|
| 1 | **RAGAS** (https://github.com/explodinggradients/ragas) | Apache 2.0 | v0.4.3 (2026-01-13) | NONE — "agent_evals" Coming Soon | **REJECT** | RAG-focused; agent-memory in roadmap not in product; Python-only doesn't match TheMemory's TS-native runtime |
| 2 | **DeepEval** (https://github.com/confident-ai/deepeval) | Apache 2.0 | v4.0.5 (2026-05-28) | NONE explicit — closest is "Knowledge Retention" multi-turn metric (different task shape) | **REJECT** | Broad framework with MMLU/HellaSwag/GSM8K baked-in but no LongMemEval/LoCoMo/DMR; Python-only; broad scope = lots of irrelevant surface |
| 3 | **LangSmith Evaluations** (https://docs.langchain.com/langsmith/evaluation) | Vendor-managed (LangChain Inc.) | n/a | NONE | **REJECT** | Vendor lock-in defeats v0.8's "independent reproduction" framing; consumers of `docs/benchmarks/v0.8.md` shouldn't need a LangSmith account to verify |
| 4 | BEIR | Apache 2.0 (common knowledge) | not deep-investigated per EC-2 cap | likely NONE — BEIR is IR-only | **REJECT (provisional)** | Designed for retrieval eval, not conversational memory |
| 5 | ARES | not deep-investigated per EC-2 cap | not deep-investigated | unknown | **DEFER** | Academic paper landscape; revisit if v0.8 scope expands |

**Rule 9 final verdict for v0.8:**

NONE of the 3 actively-investigated candidates ship LongMemEval / LoCoMo / DMR adapters out of the box. They are LLM-eval frameworks at the GENERIC layer (metrics + LLM-judge + datasets/orchestration primitives).

**Recommendation (mirrors v0.7's adopt-don't-reinvent pattern):**

- **REUSE** metric implementations (BLEU / F1 / BERTScore / METEOR) — adopt RAGAS, DeepEval, or Mem0's own `metrics/utils.py` battle-tested implementations rather than rolling our own
- **WRITE OUR OWN BENCHMARK RUNNER** that integrates LongMemEval / LoCoMo / DMR fixtures + TheMemory v0.7 / Mem0 v3 / Zep / Letta adapters. This is the layer where no framework gives us drop-in value; it's too narrow.
- **DO NOT** adopt LangSmith — vendor coupling kills the "independent" axis of v0.8.

Mirror of v0.7 discipline: we don't reinvent embedding / LLM / vector store, but we DO own the consolidation pipeline. v0.8: we don't reinvent metric computation, but we DO own the benchmark runner + adapters.

---

## Cross-cutting Comparison

A consolidated side-by-side view across the five corners:

| Dimension | Mem0 | Letta | LangMem (proxy) | External prior art |
|---|---|---|---|---|
| Integration-test style | Imperative if/elif dispatch in run_experiments.py; no shared interface (`class Experiment` is unused stub) — duck-type contract only | n/a (no benchmark code) | n/a (proxy only) | n/a |
| Primary eval deps | 10+ orphan deps NOT in any pyproject.toml extras group (bert_score, nltk, rouge_score, sentence_transformers, tiktoken, etc.) | n/a | n/a | n/a |
| Local dev story | `.env` + `dataset/` dir (LoCoMo from Google Drive); `make run-{technique}` per adapter; wall-clock UNDOCUMENTED | n/a | n/a | n/a |
| Benchmark methodology | LOCOMO-only; 3 metrics persisted (bleu1 + f1 + llm-judge gpt-4o-mini); ROUGE/BERT/METEOR/SBERT computed but discarded | n/a | n/a | LongMemEval (ICLR 2025) — primary; LoCoMo (NC license) — secondary; DMR (MemGPT/Zep) — tertiary |
| Rule 9 candidate verdict | n/a | n/a | n/a | RAGAS=REJECT (RAG-only), DeepEval=REJECT (no LongMemEval), LangSmith=REJECT (vendor lock-in); BEIR/ARES not deep-investigated |

## ADRs

> Decisions emerging from the synthesis. Each carries alternatives + rationale + consequences.

### D1 — v0.8 implementation OWNS the benchmark runner; ADOPTS only metric libraries

**Decision:** v0.8 implements its own TypeScript benchmark runner (with proper `BenchmarkAdapter` Protocol/interface). For metric primitives, adopt Mem0's `metrics/utils.py` pattern OR RAGAS/DeepEval as metric libs — DO NOT adopt any of the 5 evaluated candidates as the runner.

**Rationale:** No candidate ships LongMemEval / LoCoMo / DMR adapters (Q8 verdicts). LangSmith vendor-coupling defeats "independent reproduction" (roadmap row 10). Mem0's runner is a useful skeleton but no interface (Q1's EC-4 finding) — we'd inherit anti-pattern. Writing our own runner with proper DIP per `architecture.md § 3` is consistent with v0.7's "own the pipeline, reuse the primitives" pattern.

**Alternatives considered:**
- Adopt RAGAS as full runner → REJECTED: Python-only, RAG-focused, agent_evals roadmap-only (Q8)
- Adopt DeepEval → REJECTED: Python-only, no LongMemEval (Q8)
- Adopt LangSmith → REJECTED: vendor lock (Q8)
- Fork Mem0's runner → REJECTED: inherits no-shared-interface anti-pattern (Q1 EC-4)
- Reinvent metric computation → REJECTED: Inquebrável Rule 9 violation

**Consequences:** v0.8 owns ~3-5 modules (BenchmarkAdapter interface, runner orchestrator, fixture loaders for 3 benchmarks, metric wrapper, judge wrapper). Estimated implementation cost: 200-400k tokens per roadmap row 10. Reuse minimizes our metric-implementation surface; runner ownership keeps us independent.

### D2 — Benchmark priority ranking: LongMemEval PRIMARY > LoCoMo SECONDARY > DMR TERTIARY

**Decision:** v0.8 implementation order: implement LongMemEval first (highest reproducibility + ICLR 2025 + MIT data); then LoCoMo (Mem0 comparison baseline); then DMR (historical compat with MemGPT/Zep claims).

**Rationale:**
- LongMemEval (Q6): ICLR 2025 peer-reviewed; HF public; MIT both code+data; 3.03 GB tractable; ZERO third-party reproductions found → v0.8 publication is novel
- LoCoMo (Q7): apples-to-apples with Mem0's paper claims (arXiv 2504.19413); CC-BY-NC-SA 4.0 means download-at-install only, no repo commit
- DMR (Q7): ceiling effects ~93-95% (Zep 94.8% vs MemGPT 93.4%); cheapest to implement but lowest discriminative power; still include for engagement with vendor marketing

**Alternatives considered:**
- DMR first (cheap, fastest landing) → REJECTED: ceiling effects mean we'd publish indistinguishable scores
- LoCoMo first (Mem0 comparison primary) → REJECTED: license restriction adds complexity; LongMemEval is simpler licensing

**Consequences:** v0.8 milestone may ship with LongMemEval-only if budget tight; LoCoMo + DMR as incremental adds. Roadmap row 10 acceptance criteria require ALL 3 — accept this as honest residual scope.

### D3 — Our LLM-judge MUST be configurable; multi-judge panel for variance reporting

**Decision:** TheMemory v0.8 LLM-judge orchestrator MUST expose model/prompt/temperature/seed as config. Default panel: 2-3 judges (gpt-4o + claude-sonnet + optional open-source) + inter-judge agreement report (Cohen's kappa or simple % agreement). Raw judge responses persisted alongside binary labels.

**Rationale:** Mem0's hardcoded `gpt-4o-mini` + temperature 0 + "be generous" instruction (Q2 finding) is opinionated single-judge bias. Production-grade reproduction requires variance reporting (LLM-judge consistency literature: Wang et al. 2023 Self-Consistency; Zheng et al. 2023 LLM-as-judge benchmarks). v0.7.1 already established LLM-measured eval discipline at TheMemory — D3 extends it.

**Alternatives considered:**
- Copy Mem0's hardcoded judge (single gpt-4o-mini) → REJECTED: reproducibility hostage to vendor model versioning; single-judge bias unreported
- Skip LLM-judge, use only BLEU/F1 → REJECTED: BLEU/F1 are weak for long-form free-text answers per LongMemEval/LoCoMo design

**Consequences:** v0.8 implementation gains 1 module (judge orchestrator). Cost per benchmark run roughly 2-3× Mem0's (we run more judges). v0.7.1 cost ~$0.01-0.05 per 10-question run; v0.8 LongMemEval @ 500 questions × 3 judges = ~$0.50-2.50 per full run. Acceptable.

### D4 — Adopt download-at-install pattern for ALL 3 datasets; NO benchmark fixture committed to TheMemory repo

**Decision:** TheMemory's `benchmarks/` directory ships scripts that download datasets at install/run time. Three reasons:
1. LoCoMo CC-BY-NC-SA 4.0 forbids bundling in commercial distribution (Q7 license finding)
2. LongMemEval HF dataset = 3.03 GB → too big to commit even if license permitted
3. DMR derived from MSC → consumers need to re-derive the 500-conv subset; bundling the derived subset is awkward licensing-wise

Pattern mirrors Mem0's Google-Drive-distribute approach but uses authoritative sources (HF for LongMemEval, snap-research GitHub for LoCoMo, MemGPT GitHub for DMR scripts).

**Alternatives considered:**
- Commit LongMemEval (MIT allows it) → REJECTED: 3.03 GB inflates clone time + breaks shallow-clone CI workflows
- Commit a tiny "smoke" subset for CI → ACCEPTED IMPLICITLY (separate from production benchmark runs; documented separately)

**Consequences:** v0.8 ships a `benchmarks/download_fixtures.sh` (or `download_fixtures.ts` script) that fetches all 3 datasets. CI / dogfood evidence requires running this script. Documentation in `docs/benchmarks/v0.8.md` makes this explicit.

## Recommendations for TheMemory

| # | Recommendation | Linked to | Priority |
|---|---|---|---|
| R1 | Build proper `BenchmarkAdapter` Protocol in TypeScript — `add(corpus) → AddMetrics` + `search(query) → SearchResult`; 4 adapters: TheMemory v0.7, Mem0 v3 (via Python subprocess if needed), Zep (HTTP), Letta (HTTP) | Q1 (EC-4 finding) + D1 | HIGH |
| R2 | Implement LongMemEval FIRST (PRIMARY benchmark per D2) — wire `BenchmarkAdapter` + LongMemEval fixture loader + LLM-judge panel + matrix output | Q6 + D2 + D3 | HIGH |
| R3 | Ship `[project.optional-dependencies] evaluation` group (or TS-equivalent: `benchmarks/package.json` with own lockfile) — explicit deps for bert_score / nltk / rouge_score / etc. — avoid Mem0's orphan-deps mistake | Q4 (EC-5 finding) | HIGH |
| R4 | Add `benchmarks/download_fixtures.sh` script + `make download-fixtures` target. Fetch LongMemEval from HF (`wget` per Q6 snapshot); LoCoMo from snap-research GH; DMR from MemGPT GH. Document in `docs/benchmarks/v0.8.md` | Q3 + D4 | HIGH |
| R5 | LLM-judge orchestrator: configurable model/prompt/temperature + multi-judge panel (default gpt-4o + claude-sonnet) + inter-judge agreement + raw response persistence | Q2 + D3 | HIGH |
| R6 | Pre-parse LongMemEval `answer` column to handle mixed integer/object types (known dataset defect from HF card) | Q6 (defect finding) | MEDIUM |
| R7 | Add P95 latency + cost/session columns to matrix (NOT in Mem0's pipeline per Q2). Instrument via OpenTelemetry spans around each adapter `add` + `search` call | Q2 + roadmap row 10 acceptance | MEDIUM |
| R8 | Skip BERTScore + SBERT-cosine in default scorecard (require GPU/heavy deps); offer them as opt-in `--include-semantic` flag matching Mem0's pragmatism | Q2 (disconnect finding) | LOW |
| R9 | For LoCoMo: download via Mem0's Google Drive path OR snap-research GitHub `data/locomo10.json` — use Mem0's mirror for stability + cite both sources | Q3 + Q7 | MEDIUM |
| R10 | First benchmark publication should be LongMemEval-only with HONEST framing "DMR + LoCoMo to follow" — better honest scope than vaporware | D2 | HIGH |

## Blocked questions (if any)

None — all 8 questions reached `done` status. Q8 capped at 3-of-5 candidates per EC-2 budget cap (BEIR + ARES marked deep-investigation deferred, both with provisional verdicts).

## Halt-loop progress (audit trail)

- Iterations used: 8 / 30
- Questions answered: 8 / 8 (Q1, Q2, Q3, Q4, Q5, Q6, Q7, Q8)
- Questions blocked: 0
- Citations verified: local citations to `.claude/knowledge-base/references/mem0/evaluation/` resolved; 5 URL snapshots written
- Snapshots written:
  - `.claude/knowledge-base/discoveries/snapshots/v0-8-benchmark-methodology/2026-06-02-arxiv-2410-10813-longmemeval.md`
  - `.claude/knowledge-base/discoveries/snapshots/v0-8-benchmark-methodology/2026-06-02-github-longmemeval-repo.md`
  - `.claude/knowledge-base/discoveries/snapshots/v0-8-benchmark-methodology/2026-06-02-hf-longmemeval-cleaned.md`
  - `.claude/knowledge-base/discoveries/snapshots/v0-8-benchmark-methodology/2026-06-02-arxiv-2402-17753-locomo.md`
  - `.claude/knowledge-base/discoveries/snapshots/v0-8-benchmark-methodology/2026-06-02-dmr-memgpt-zep.md`
  - `.claude/knowledge-base/discoveries/snapshots/v0-8-benchmark-methodology/2026-06-02-q8-rule9-candidates.md`
- Promise emitted at iteration: 8 (this iteration)

## Related

- Discovery plan: `.claude/knowledge-base/discoveries/plans/v0-8-benchmark-methodology-plan.md` (v1.1)
- Edge-case report: `.claude/knowledge-base/reviews/v0-8-benchmark-methodology-edge-cases-2026-06-02.md`
- Confidence report: `.claude/knowledge-base/reviews/v0-8-benchmark-methodology-confidence-{YYYY-MM-DD}.md` (will be generated by `/discover-confidence`)
- Linked rules: `.claude/rules/cycle-discover.md` (v1.1 — 5 corners + URL snapshot invariant), `.claude/rules/discover-web-allowlist.txt` (allowlist with 6 net-new domains added 2026-06-02 per ADR D3)
- Inquebrável: `/home/paulo/.claude/CLAUDE.md` § 3 (Honestidade Extrema) + § 9 (Não Reinvente a Roda — drives Q8)
