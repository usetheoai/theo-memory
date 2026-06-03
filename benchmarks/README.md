# v0.8 Benchmarks — Fixture distribution

Per plan v0-8-independent-benchmark-reproduction ADR D4, this directory hosts the runtime infrastructure for the LongMemEval / LoCoMo / DMR matrix runs. **No dataset files are committed to the repo** — they are downloaded at install time via the script described below.

## Quickstart

```bash
node benchmarks/scripts/download-fixtures.mjs
# or, via the npm alias:
npm run download-fixtures
```

The script is **idempotent**: it HEAD-checks each remote URL and skips files whose local size already matches the upstream `Content-Length` header.

## Datasets

### LongMemEval — MIT

- Source: https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned
- Paper: Wu et al., ICLR 2025 (arXiv:2410.10813 v2)
- Variants: `longmemeval_oracle` (with ground-truth context), `longmemeval_s_cleaned` (~115k tokens / ~40 sessions per history), `longmemeval_m_cleaned` (~500 sessions per history)
- License permits commercial use with attribution.

### LoCoMo — CC-BY-NC-SA 4.0 (NonCommercial)

- Source: https://github.com/snap-research/locomo
- Paper: Maharana et al., 2024 (arXiv:2402.17753)
- **License constraint:** Creative Commons Attribution-NonCommercial-ShareAlike 4.0. Reproduction for **academic publication** of comparison results is permissible. **Bundling LoCoMo data in any commercial distribution of TheMemory is NOT permitted.** Recipients of the published benchmark matrix should download LoCoMo themselves via the script above.

### DMR (Deep Memory Retrieval) — derived from MSC

- Origin: REDACTED paper (arXiv:2310.08560)
- Dataset basis: 500-conversation subset of Multi-Session Chat (MSC), originally CC-BY-4.0
- T2.1 ships a `dmr-loader.ts` that parses a derived JSON; the actual subset derivation will land in `benchmarks/scripts/derive-dmr-subset.{mjs,ts}` at T7.2.

## Directory layout

```
benchmarks/
├── README.md              (this file)
├── scripts/
│   ├── download-fixtures.mjs   (T2.1 — operational tooling, plain JS, no extra deps)
│   ├── run-longmemeval.ts      (T5.1 — pending)
│   ├── run-locomo.ts           (T7.1 — pending)
│   ├── run-dmr.ts              (T7.2 — pending)
│   └── derive-dmr-subset.ts    (T7.2 — pending)
├── data/                  (gitignored — fixtures downloaded here)
└── results/               (gitignored — per-run JSON outputs)
```

## EC absorptions in this layer

- **EC-1** — `normalizeLongMemEvalAnswer` in `src/benchmarks/fixtures/longmemeval-loader.ts` handles the HF dataset defect where `answer` mixes integer + object + string types across rows.
- **EC-6** — `download-fixtures.mjs` uses Node 20+ native `fetch`, portable across macOS / Linux / Windows. No `wget` requirement.
- **EC-8** — idempotent: HEAD `Content-Length` check before each download.

## Why `.mjs` and not `.ts` (Drift-T2.1-1)

Plan v1.2 originally declared `tsx benchmarks/scripts/download-fixtures.ts`. Adding `tsx` as a new devDep would have required an entry in plan's `## Dependencies` section + `/deps-audit` re-run. The script is operational tooling (~80 LoC of `fetch` + `pipe` to disk) without type-safety load-bearing concerns, so writing it as `.mjs` (plain JS, Node 20+ native) preserves the EC-6 intent (cross-platform, no bash, no wget) without growing the dependency surface. Drift documented in `.claude/knowledge-base/implementations/v0-8-independent-benchmark-reproduction-implementation.md`.
