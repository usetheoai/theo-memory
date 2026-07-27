#!/usr/bin/env node
/**
 * M27 T6.1 — write-quality parity benchmark runner (executable consumer of the fixture + metric).
 *
 * Feeds WRITE_QUALITY_FIXTURE through a REAL extraction over REST (`POST /v1/remember`, infer:true —
 * a real LLM on the target instance), reads the stored rows back (`GET /v1/scopes/user/:id/memories`),
 * and scores the single-third-person-fact ratio with `singleThirdPersonFactRatio`. This is the
 * executable harness the /review flagged as missing (the fixture + metric had no consumer). Run it
 * against the deployed instance (real OpenAI) for the DoD evidence; run >= 3x for mean +- std.
 *
 * Env:
 *   THEOMEM_API_URL   base URL (e.g. https://app-dev.usetheo.dev/v1/memory or http://localhost:8081)
 *   THEOMEM_API_KEY   bearer token for the target
 *   THEOMEM_BENCH_USER user id to write under (default: m27-write-quality-bench)
 *   THEOMEM_BENCH_RUNS number of runs (default 3)
 *
 * Usage: pnpm --filter @usetheo/memory-eval exec tsx scripts/write-quality-benchmark.mjs
 */
import {
  WRITE_QUALITY_FIXTURE,
  singleThirdPersonFactRatio,
} from '../src/stages/extraction/write-quality.js';

const BASE = process.env.THEOMEM_API_URL;
const KEY = process.env.THEOMEM_API_KEY;
const RUNS = Number.parseInt(process.env.THEOMEM_BENCH_RUNS ?? '3', 10);

if (!BASE || !KEY) {
  console.error('Set THEOMEM_API_URL and THEOMEM_API_KEY (target with a real LLM).');
  process.exit(2);
}

const headers = { 'content-type': 'application/json', authorization: `Bearer ${KEY}` };

async function runOnce(runIdx) {
  const userId = `${process.env.THEOMEM_BENCH_USER ?? 'm27-write-quality-bench'}-${runIdx}-${Date.now()}`;
  for (const text of WRITE_QUALITY_FIXTURE) {
    const res = await fetch(`${BASE}/v1/remember`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ userId, text, infer: true, attributedTo: 'assistant' }),
    });
    if (!res.ok) throw new Error(`remember ${res.status}: ${await res.text()}`);
  }
  // small settle for async extraction if the server writes detached
  await new Promise((r) => setTimeout(r, 1500));
  const list = await fetch(`${BASE}/v1/scopes/user/${encodeURIComponent(userId)}/memories?limit=100`, {
    headers,
  });
  if (!list.ok) throw new Error(`list ${list.status}: ${await list.text()}`);
  const body = await list.json();
  const texts = (body.items ?? body.memories ?? []).map((m) => m.text ?? m.content ?? '');
  const metric = singleThirdPersonFactRatio(texts);
  console.log(`run ${runIdx}: stored=${metric.total} clean=${metric.singleThirdPersonFacts} ratio=${metric.ratio.toFixed(3)}`);
  return metric.ratio;
}

const ratios = [];
for (let i = 1; i <= RUNS; i++) ratios.push(await runOnce(i));
const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
const std = Math.sqrt(ratios.reduce((a, b) => a + (b - mean) ** 2, 0) / ratios.length);
console.log(`\nmean=${mean.toFixed(3)} std=${std.toFixed(3)} over ${RUNS} runs (DoD target >= 0.90)`);
process.exit(mean >= 0.9 ? 0 : 1);
