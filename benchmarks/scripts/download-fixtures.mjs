#!/usr/bin/env node
/**
 * v0.8 benchmark fixture downloader.
 *
 * EC-6 absorption: TypeScript-derived JS using Node 20+ native fetch.
 * Portable across macOS / Linux / Windows without requiring wget.
 *
 * EC-8 absorption: idempotent — HEAD-checks Content-Length against local
 * file size before re-downloading. Skip with log when sizes match.
 *
 * ADR D4: download-at-install discipline. Fixtures live under
 * benchmarks/data/ which is gitignored. LoCoMo CC-BY-NC-SA 4.0 banner
 * surfaced to stdout before its download.
 *
 * Written as .mjs (not .ts) to avoid introducing tsx as a new dependency
 * — plan v1.2 originally declared .ts but the script is operational
 * tooling (~80 LoC of fetch+save) without type-safety load-bearing.
 * Drift-T2.1-1 documented in implementation md.
 *
 * @see plan v1.2 § T2.1 + EC-6 + EC-8 + ADR D4
 */

import { createWriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATA_DIR = join(REPO_ROOT, 'benchmarks', 'data');

const FIXTURES = [
  {
    name: 'longmemeval_oracle',
    url: 'https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_oracle.json',
    relPath: 'longmemeval/longmemeval_oracle.json',
    licenseBanner: '[LongMemEval] MIT license. See benchmarks/README.md.',
  },
  {
    name: 'longmemeval_s_cleaned',
    url: 'https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_s_cleaned.json',
    relPath: 'longmemeval/longmemeval_s_cleaned.json',
    licenseBanner: '[LongMemEval] MIT license. See benchmarks/README.md.',
  },
  {
    name: 'longmemeval_m_cleaned',
    url: 'https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_m_cleaned.json',
    relPath: 'longmemeval/longmemeval_m_cleaned.json',
    licenseBanner: '[LongMemEval] MIT license. Large file (~500 sessions per conversation). Use longmemeval_s_cleaned for CI.',
  },
  {
    name: 'locomo10',
    url: 'https://raw.githubusercontent.com/snap-research/locomo/main/data/locomo10.json',
    relPath: 'locomo/locomo10.json',
    licenseBanner: '[LoCoMo] CC-BY-NC-SA 4.0 — non-commercial use only. See benchmarks/README.md.',
  },
];

async function getRemoteSize(url) {
  try {
    const head = await fetch(url, { method: 'HEAD' });
    if (!head.ok) {
      return null;
    }
    const len = head.headers.get('content-length');
    return len === null ? null : Number(len);
  } catch {
    return null;
  }
}

async function getLocalSize(path) {
  try {
    const s = await stat(path);
    return s.size;
  } catch {
    return null;
  }
}

async function downloadToFile(url, destPath) {
  const response = await fetch(url);
  if (!response.ok || response.body === null) {
    throw new Error(`HTTP ${response.status} fetching ${url}`);
  }
  await mkdir(dirname(destPath), { recursive: true });
  const out = createWriteStream(destPath);
  await new Promise((resolve, reject) => {
    const stream = Readable.fromWeb(response.body);
    stream.on('error', reject);
    out.on('error', reject);
    out.on('finish', resolve);
    stream.pipe(out);
  });
}

async function downloadFixture(fixture) {
  const destPath = join(DATA_DIR, fixture.relPath);
  console.log(fixture.licenseBanner);
  console.log(`[${fixture.name}] target: ${destPath}`);
  const remoteSize = await getRemoteSize(fixture.url);
  const localSize = await getLocalSize(destPath);
  if (remoteSize !== null && localSize !== null && remoteSize === localSize) {
    console.log(`[${fixture.name}] already present at expected size (${localSize} bytes) — skipping`);
    return;
  }
  if (localSize !== null) {
    console.log(`[${fixture.name}] size mismatch (local ${localSize}, remote ${remoteSize}) — re-downloading`);
  } else {
    console.log(`[${fixture.name}] downloading (~${remoteSize ?? '?'} bytes)`);
  }
  await downloadToFile(fixture.url, destPath);
  console.log(`[${fixture.name}] done`);
}

async function main() {
  console.log('=== v0.8 benchmark fixture downloader ===');
  console.log(`data dir: ${DATA_DIR}`);
  console.log('');
  for (const fixture of FIXTURES) {
    try {
      await downloadFixture(fixture);
    } catch (err) {
      console.error(`[${fixture.name}] FAILED:`, err instanceof Error ? err.message : err);
      process.exitCode = 1;
    }
    console.log('');
  }
  console.log('[DMR] derived at T7.2 via benchmarks/scripts/derive-dmr-subset (not shipped yet).');
}

main().catch((err) => {
  console.error('Downloader fatal:', err);
  process.exit(1);
});
