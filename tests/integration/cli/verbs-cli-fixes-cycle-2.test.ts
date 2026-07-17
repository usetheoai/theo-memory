/**
 * T0.1 RED — verbs-as-CLI fix-cycle-2 integration tests (8 assertions).
 *
 * Locks the post-fix-cycle-2 behavioral contract for the 10 MAJORs surfaced
 * by `/review verbs-as-cli-fixes-cycle-1` (2026-06-04).
 *
 * Test map (sub-goal → test → MAJOR + EC):
 *   test 1 — Theme A.1 (parser decimal rejection)        — M4 + ADR D1
 *   test 2 — Theme A.1 (parser garbage rejection)        — M4 + ADR D1
 *   test 3 — Theme A.1 (float decimal-trailing-garbage)  — M4 + ADR D1
 *   test 4 — Theme A.1 (float non-numeric)               — M4 + ADR D1
 *   test 5 — Theme A.2 (dist clean post-build)           — M5 + ADR D2
 *   test 6 — Theme C.3 (locked names regex-pinned)       — M6 + ADR D6 + EC-4
 *   test 7 — EC-1 absorption (empty string rejected)     — ADR D1 amendment
 *   test 8 — EC-2 absorption (hex notation rejected)     — ADR D1 amendment
 *
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import { describe, expect, test } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const CLI_PATH = join(REPO_ROOT, 'dist', 'agent-tools', 'cli.js');
const CLI_SRC_PATH = join(REPO_ROOT, 'packages', 'cli', 'src', 'cli.ts');
const STALE_DIST_ARTIFACT = join(REPO_ROOT, 'dist', 'agent-tools', 'cli-memory-factory.js');

const DIST_EXISTS = existsSync(CLI_PATH);

if (!DIST_EXISTS) {
  // eslint-disable-next-line no-console
  console.warn(
    'verbs-cli-fixes-cycle-2 SKIP — dist/agent-tools/cli.js missing. Run `npm run build` first.',
  );
}

interface SpawnResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function runCliRaw(args: readonly string[], extraEnv: Record<string, string> = {}): SpawnResult {
  const result = spawnSync('node', [CLI_PATH, ...args], {
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, ...extraEnv },
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

describe.skipIf(!DIST_EXISTS)('verbs-as-CLI fix-cycle-2 integration', () => {
  // ─── Theme A.1: parser correctness regressions ───────────────────────────

  test('test 1 — --top-k 5.7 decimal exits 2 (M4)', () => {
    const userId = randomUUID();
    const result = runCliRaw(['recall', 'q', '--user', userId, '--top-k', '5.7']);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/Invalid --top-k.*5\.7.*integer/i);
  });

  test('test 2 — --top-k 5abc trailing garbage exits 2 (M4)', () => {
    const userId = randomUUID();
    const result = runCliRaw(['recall', 'q', '--user', userId, '--top-k', '5abc']);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/Invalid --top-k.*5abc.*integer/i);
  });

  test('test 3 — --threshold 0.5abc trailing garbage exits 2 (M4)', () => {
    const userId = randomUUID();
    const result = runCliRaw(['recall', 'q', '--user', userId, '--threshold', '0.5abc']);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/Invalid --threshold.*0\.5abc.*float/i);
  });

  test('test 4 — --threshold abc non-numeric exits 2 (M4)', () => {
    const userId = randomUUID();
    const result = runCliRaw(['recall', 'q', '--user', userId, '--threshold', 'abc']);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/Invalid --threshold.*abc.*float/i);
  });

  // ─── Theme A.2: build hygiene ──────────────────────────────────────────────

  test('test 5 — dist/agent-tools/cli-memory-factory.js absent post-build (M5)', () => {
    expect(
      existsSync(STALE_DIST_ARTIFACT),
      'STALE dist artifact MUST be absent post-build — prebuild:clean rmSync(dist) per ADR D2',
    ).toBe(false);
  });

  // ─── Theme C.3: locked-names sentinel (regex-pinned) ─────────────────────

  test('test 6 — cli.ts locked-name regexes pinned to .command()/.option() call sites (M6 + EC-4)', () => {
    const src = readFileSync(CLI_SRC_PATH, 'utf8');
    // Verbs MUST be inside .command('verb-pattern')
    expect(src).toMatch(/\.command\(\s*['"]remember <text>['"]/);
    expect(src).toMatch(/\.command\(\s*['"]recall <query>['"]/);
    expect(src).toMatch(/\.command\(\s*['"]forget <id>['"]/);
    expect(src).toMatch(/\.command\(\s*['"]reflect['"]/);
    // Flags MUST be inside .option('--flag<boundary>') — boundary char prevents
    // false-positive matches against `--user-name` or factory invocations like
    // `parseIntInRange('--top-k', 1, 100)`.
    expect(src).toMatch(/\.option\(\s*['"]--user[\s'"<]/);
    expect(src).toMatch(/\.option\(\s*['"]--session[\s'"<]/);
    expect(src).toMatch(/\.option\(\s*['"]--agent[\s'"<]/);
    expect(src).toMatch(/\.option\(\s*['"]--top-k[\s'"<]/);
    expect(src).toMatch(/\.option\(\s*['"]--threshold[\s'"<]/);
    expect(src).toMatch(/\.option\(\s*['"]--diversify[\s'"<]/);
    expect(src).toMatch(/\.option\(\s*['"]--hard[\s'"<]/);
    expect(src).toMatch(/\.option\(\s*['"]--json[\s'"<]/);
    expect(src).toMatch(/\.option\(\s*['"]--text[\s'"<]/);
  });

  // ─── EC-1 absorption ──────────────────────────────────────────────────────

  test('test 7 — --top-k empty string exits 2 (EC-1)', () => {
    const userId = randomUUID();
    const result = runCliRaw(['recall', 'q', '--user', userId, '--top-k', '']);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/Invalid --top-k/i);
  });

  // ─── EC-2 absorption ──────────────────────────────────────────────────────

  test('test 8 — --top-k 0x1F hex notation exits 2 (EC-2)', () => {
    const userId = randomUUID();
    const result = runCliRaw(['recall', 'q', '--user', userId, '--top-k', '0x1F']);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/Invalid --top-k.*0x1F/i);
  });
});
