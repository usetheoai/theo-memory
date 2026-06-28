/**
 * Issue #79 — `themory remember --no-infer` verbatim-path integration.
 *
 * The REST surface `POST /v1/remember` accepts `infer: false` (store verbatim,
 * skip LLM fact-extraction). This suite locks the CLI parity: `themory remember
 * --no-infer "<fact>"` must persist the text verbatim and a subsequent recall
 * must return it — making a CLI write → recall round-trip deterministic without
 * depending on the two-stage extraction pipeline.
 *
 * Pattern mirrors verbs-cli.test.ts: spawnSync against real ankane/pgvector,
 * unique --user UUID per test, skipped unless dist + OPENAI + PG are present.
 *
 * @see https://github.com/usetheodev/theo-memory/issues/79
 * @see tests/integration/cli/verbs-cli.test.ts
 */
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const CLI_PATH = join(REPO_ROOT, 'dist', 'agent-tools', 'cli.js');

const DIST_EXISTS = existsSync(CLI_PATH);
const HAS_OPENAI =
  process.env['OPENAI_API_KEY'] !== undefined && process.env['OPENAI_API_KEY'] !== '';
const HAS_PG_URI =
  process.env['THEOMEM_PG_URI'] !== undefined && process.env['THEOMEM_PG_URI'] !== '';

interface SpawnResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function runCli(args: readonly string[]): SpawnResult {
  const result = spawnSync('node', [CLI_PATH, ...args], {
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, DOTENV_CONFIG_QUIET: 'true' },
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

describe.skipIf(!DIST_EXISTS || !HAS_OPENAI || !HAS_PG_URI)(
  'Issue #79 — themory remember --no-infer verbatim round-trip',
  () => {
    test('1. remember --no-infer persists the text verbatim (single item, exit 0)', () => {
      const userId = randomUUID();
      const fact = 'verbatim CLI fact: the deploy token is CLI-9090';
      const result = runCli(['remember', fact, '--user', userId, '--no-infer']);
      expect(result.status, `stderr=${result.stderr}`).toBe(0);
      const items = JSON.parse(result.stdout) as ReadonlyArray<{ id: string; text: string }>;
      // Verbatim path stores exactly one row carrying the original text (no
      // extraction fan-out into N facts).
      expect(items).toHaveLength(1);
      expect(items[0]!.text).toBe(fact);
    });

    test('2. write (--no-infer) → recall round-trip returns the verbatim fact', () => {
      const userId = randomUUID();
      const fact = 'verbatim round-trip: my pet zebra is named Octopus';
      const rem = runCli(['remember', fact, '--user', userId, '--no-infer']);
      expect(rem.status, `stderr=${rem.stderr}`).toBe(0);
      const recall = runCli(['recall', 'zebra Octopus', '--user', userId, '--threshold', '0']);
      expect(recall.status, `stderr=${recall.stderr}`).toBe(0);
      const items = JSON.parse(recall.stdout) as ReadonlyArray<{ text: string }>;
      expect(items.some((it) => it.text === fact)).toBe(true);
    });
  },
);
