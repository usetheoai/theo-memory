/**
 * Loading the BM25 stemmer must not touch the consumer's environment.
 *
 * The `natural` package entry point pulls in its storage plugins, and each of
 * them calls `require('dotenv').config()` at load time. Importing that entry
 * point therefore copied the `.env` file of the consumer's working directory
 * into `process.env`. In this repository it switched on bearer auth in every
 * integration test that built a server, because the developer `.env` holds
 * `THEMEMORY_API_KEY`. The stemmer is now loaded from its own module.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, test } from 'vitest';

const moduleUrl = new URL('./lemmatization.ts', import.meta.url).href;
const tsxLoader = createRequire(import.meta.url).resolve('tsx');
const workDir = mkdtempSync(join(tmpdir(), 'lemmatization-env-'));
writeFileSync(join(workDir, '.env'), 'LEMMATIZATION_ENV_SENTINEL=leaked\n');

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function importInChild(): { sentinel: string; stem: string[] } {
  const script = `const m = await import(${JSON.stringify(moduleUrl)});
process.stdout.write("\\n" + JSON.stringify({ sentinel: process.env.LEMMATIZATION_ENV_SENTINEL ?? 'absent', stem: m.lemmatizeForBm25('connections running') }));`;
  const env = { ...process.env };
  delete env['LEMMATIZATION_ENV_SENTINEL'];
  const result = spawnSync(process.execPath, ['--import', tsxLoader, '--input-type=module', '-e', script], {
    cwd: workDir,
    env,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`child import of ${fileURLToPath(moduleUrl)} exited ${String(result.status)}: ${result.stderr}`);
  }
  // A dotenv load also prints a banner to stdout, so the result is the last line.
  const lastLine = result.stdout.trimEnd().split('\n').at(-1) ?? '';
  return JSON.parse(lastLine) as { sentinel: string; stem: string[] };
}

describe('lemmatization module loading', () => {
  test('importing it does not load the .env file of the working directory', () => {
    expect(importInChild().sentinel).toBe('absent');
  });

  test('the Porter stemmer is still the one in use', () => {
    expect(importInChild().stem).toEqual(['connect', 'run']);
  });
});
