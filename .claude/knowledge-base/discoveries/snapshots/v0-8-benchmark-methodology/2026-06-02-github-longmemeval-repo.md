# Snapshot — LongMemEval GitHub repo README

**URL:** https://github.com/xiaowu0162/LongMemEval
**Fetched:** 2026-06-02 via WebFetch (allowlist: `github.com`)
**Used for question:** Q6

---

## Extracted facts

- **HF dataset URL:** https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned
- **Code license:** MIT (per repo LICENSE)
- **Dataset license:** NOT explicitly separated from code license (defaults to repo MIT in absence of dataset-specific terms; v0.8 should verify HF dataset card)
- **HF gating:** None observed (publicly accessible via `wget`)
- **Reproduction commands** (excerpted):
  ```bash
  mkdir -p data/
  cd data/
  wget https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_oracle.json
  wget https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_s_cleaned.json
  wget https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_m_cleaned.json
  ```
- **Dataset variants:**
  - 3 files, each 500 questions
  - LongMemEval_S: ~115k tokens (~40 sessions) per Llama 3 tokenizer
  - LongMemEval_M: ~500 sessions per history
- **Third-party reproductions:** none mentioned in repo README
- **Custom-history sampler:** `python sample_haystack_and_timestamp.py task n_questions min_n_haystack_filler max_n_haystack_filler`
