# Snapshot — LongMemEval HF dataset card

**URL:** https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned
**Fetched:** 2026-06-02 via WebFetch (allowlist: `huggingface.co`)
**Used for question:** Q6

---

## Extracted facts

- **Dataset license:** **MIT** (explicit on HF card)
- **Gated:** NO — publicly accessible without HF login (EC-6 does not fire)
- **Total size:** 3.03 GB across 3 splits
- **Splits:** `longmemeval_oracle`, `longmemeval_s_cleaned`, `longmemeval_m_cleaned`
- **No citation block** on the HF card itself
- **Known dataset defect (honest reporting):** the dataset viewer is failing because JSON schema mixes integer + object types in the `answer` column. v0.8 implementation must handle this (Python `dict | int` union or pre-parse normalization). Not a blocker for use, but a quality signal.
- **"-cleaned" variant rationale:** removed noisy history sessions from the original LongMemEval to improve answer correctness.
- **Auxiliary doc:** Google Sheet `https://docs.google.com/spreadsheets/d/16cHPu2B4XhgC-VvolIoWNs8wwm0Zkbpgu8H9x-qhxWg/` linked from card for session-processing details (NOT allowlisted; cited only as reference, not snapshotted).
