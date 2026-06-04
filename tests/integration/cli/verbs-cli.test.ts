/**
 * T0.1 RED — verbs-as-CLI integration test (19 assertions).
 *
 * Locks the post-implementation behavioral contract for the 4 CLI verbs
 * (themory remember / recall / forget / reflect) per plan
 * verbs-as-cli-themory-remember-recall-forget-reflect v1.1.
 *
 * Pattern: spawnSync('node', ['dist/agent-tools/cli.js', verb, ...args])
 * against real ankane/pgvector. Each test isolates via a unique --user
 * UUID generated per test (no cross-test pollution).
 *
 * EC absorption map (from /edge-case-plan 2026-06-04 v1.1 report):
 * - EC-1 (MUST FIX): tests 8+9+12 do NOT pass --user to forget (memoryId
 *   globally unique per ADR-0002 + memory-store.ts:59-60)
 * - EC-3 (MUST FIX): test 13 asserts exit 2 on missing OPENAI_API_KEY
 *   (commander v12 would default to exit 1; handler calls process.exit(2)
 *   directly per ADR D4 amendment)
 * - EC-4: test 14 asserts empty text rejection
 * - EC-5: test 15 asserts UUID v4 validator
 * - EC-6: tests 16+17+18 assert bounds rejection for top-k/threshold/diversify
 * - EC-7: test 19 asserts no embedding array in recall JSON (size + key check)
 *
 * @see .claude/knowledge-base/plans/verbs-as-cli-themory-remember-recall-forget-reflect-plan.md § T0.1
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import { describe, expect, test } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const CLI_PATH = join(REPO_ROOT, 'dist', 'agent-tools', 'cli.js');

const DIST_EXISTS = existsSync(CLI_PATH);
const HAS_OPENAI =
  process.env['OPENAI_API_KEY'] !== undefined && process.env['OPENAI_API_KEY'] !== '';
const HAS_PG_URI =
  process.env['THEOMEM_PG_URI'] !== undefined && process.env['THEOMEM_PG_URI'] !== '';

if (!DIST_EXISTS) {
  // eslint-disable-next-line no-console
  console.warn(
    'T0.1 SKIP — dist/agent-tools/cli.js missing. Run `npm run build` first (per plan T4.1 build-first ordering).',
  );
}
if (!HAS_OPENAI) {
  // eslint-disable-next-line no-console
  console.warn('T0.1 SKIP — OPENAI_API_KEY env not set. Required for all verb subcommands.');
}
if (!HAS_PG_URI) {
  // eslint-disable-next-line no-console
  console.warn(
    'T0.1 SKIP — THEOMEM_PG_URI env not set. Required for createLocalMemory factory.',
  );
}

interface SpawnResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function runCli(args: readonly string[], extraEnv: Record<string, string> = {}): SpawnResult {
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

describe.skipIf(!DIST_EXISTS || !HAS_OPENAI || !HAS_PG_URI)(
  'T0.1 — verbs-as-CLI integration (19 assertions per plan v1.1)',
  () => {
    test('1. remember outputs JSON with user scope', () => {
      const userId = randomUUID();
      const result = runCli(['remember', 'I prefer dark mode', '--user', userId]);
      expect(result.status, `stderr=${result.stderr}`).toBe(0);
      const parsed = JSON.parse(result.stdout) as ReadonlyArray<{
        id: string;
        text: string;
        scope: { kind: string; userId: string };
      }>;
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBeGreaterThanOrEqual(1);
      expect(parsed[0]!.scope.kind).toBe('user');
      expect(parsed[0]!.scope.userId).toBe(userId);
    });

    test('2. remember outputs text format when --text flag', () => {
      const userId = randomUUID();
      const result = runCli(['remember', 'I prefer dark mode', '--user', userId, '--text']);
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/Wrote \d+ memor/i);
    });

    test('3. remember with zero scope flags exits 2', () => {
      const result = runCli(['remember', 'fact']);
      expect(result.status).toBe(2);
    });

    test('4. remember with multi scope flags exits 2', () => {
      const result = runCli(['remember', 'fact', '--user', 'a', '--session', 'b']);
      expect(result.status).toBe(2);
    });

    test('5. recall returns items, --top-k caps result count', () => {
      const userId = randomUUID();
      // Seed: 1 remember (LLM might extract 1-5 facts from prose).
      runCli(['remember', 'I like coffee, tea, juice, water, and milk', '--user', userId]);
      const result = runCli(['recall', 'beverages', '--user', userId, '--top-k', '3']);
      expect(result.status).toBe(0);
      const items = JSON.parse(result.stdout) as readonly unknown[];
      expect(items.length).toBeLessThanOrEqual(3);
    });

    test('6. recall --threshold high-pass returns array (filter exercised)', () => {
      const userId = randomUUID();
      runCli(['remember', 'I like beer', '--user', userId]);
      const result = runCli(['recall', 'random noise', '--user', userId, '--threshold', '0.95']);
      expect(result.status).toBe(0);
      const items = JSON.parse(result.stdout) as readonly unknown[];
      expect(Array.isArray(items)).toBe(true);
    });

    test('7. recall --text format', () => {
      const userId = randomUUID();
      runCli(['remember', 'I like coffee', '--user', userId]);
      const result = runCli(['recall', 'beverage', '--user', userId, '--text']);
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/Found \d+ memor/i);
    });

    test('8. EC-1 — forget (NO scope flag) outputs JSON with id', () => {
      const userId = randomUUID();
      const remResult = runCli(['remember', 'fact-to-forget', '--user', userId]);
      const items = JSON.parse(remResult.stdout) as ReadonlyArray<{ id: string }>;
      const targetId = items[0]!.id;
      const result = runCli(['forget', targetId]);
      expect(result.status, `stderr=${result.stderr}`).toBe(0);
      const out = JSON.parse(result.stdout) as { id: string };
      expect(out.id).toBe(targetId);
    });

    test('9. EC-1 — forget --hard (NO scope flag) outputs JSON', () => {
      const userId = randomUUID();
      const remResult = runCli(['remember', 'fact-to-hard-delete', '--user', userId]);
      const items = JSON.parse(remResult.stdout) as ReadonlyArray<{ id: string }>;
      const targetId = items[0]!.id;
      const result = runCli(['forget', targetId, '--hard']);
      expect(result.status).toBe(0);
      const out = JSON.parse(result.stdout) as { id: string; hard: boolean };
      expect(out.id).toBe(targetId);
      expect(out.hard).toBe(true);
    });

    test('10. reflect outputs JSON with shape { sourceCount, derivedCount, ... }', () => {
      const userId = randomUUID();
      runCli(['remember', 'I prefer dark mode', '--user', userId]);
      runCli(['remember', 'I always use dark themes', '--user', userId]);
      const result = runCli(['reflect', '--user', userId]);
      expect(result.status, `stderr=${result.stderr}`).toBe(0);
      const parsed = JSON.parse(result.stdout) as { sourceCount: number; derivedCount: number };
      expect(typeof parsed.sourceCount).toBe('number');
      expect(typeof parsed.derivedCount).toBe('number');
    });

    test('11. reflect --text format', () => {
      const userId = randomUUID();
      runCli(['remember', 'I prefer dark mode', '--user', userId]);
      const result = runCli(['reflect', '--user', userId, '--text']);
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/Reflected \d+/i);
    });

    test('12. EC-1 — round-trip remember → recall → forget (NO scope) → recall', () => {
      const userId = randomUUID();
      const remResult = runCli(['remember', 'unique-fact-zebra-octopus', '--user', userId]);
      const items = JSON.parse(remResult.stdout) as ReadonlyArray<{ id: string }>;
      const targetId = items[0]!.id;
      const recall1 = runCli(['recall', 'zebra octopus', '--user', userId]);
      const recall1Items = JSON.parse(recall1.stdout) as ReadonlyArray<{ id: string }>;
      expect(recall1Items.some((it) => it.id === targetId)).toBe(true);
      const forgetRes = runCli(['forget', targetId]);
      expect(forgetRes.status).toBe(0);
      const recall2 = runCli(['recall', 'zebra octopus', '--user', userId]);
      const recall2Items = JSON.parse(recall2.stdout) as ReadonlyArray<{ id: string }>;
      expect(recall2Items.some((it) => it.id === targetId)).toBe(false);
    });

    test('13. EC-3 — remember without OPENAI_API_KEY exits 2 (not commander default 1)', () => {
      const result = runCli(['remember', 'fact', '--user', 'u'], { OPENAI_API_KEY: '' });
      expect(result.status).toBe(2);
    });

    test('14. EC-4 — remember with empty text exits 2', () => {
      const result = runCli(['remember', '', '--user', 'u']);
      expect(result.status).toBe(2);
      expect(result.stderr).toMatch(/text/i);
    });

    test('15. EC-5 — forget with invalid UUID exits 2', () => {
      const result = runCli(['forget', 'not-a-uuid']);
      expect(result.status).toBe(2);
      expect(result.stderr).toMatch(/uuid/i);
    });

    test('16. EC-6 sub-1 — recall --top-k out of bounds exits 2', () => {
      expect(runCli(['recall', 'q', '--user', 'u', '--top-k', '0']).status).toBe(2);
      expect(runCli(['recall', 'q', '--user', 'u', '--top-k', '1000']).status).toBe(2);
      expect(runCli(['recall', 'q', '--user', 'u', '--top-k', '-1']).status).toBe(2);
    });

    test('17. EC-6 sub-2 — recall --threshold out of bounds exits 2', () => {
      expect(runCli(['recall', 'q', '--user', 'u', '--threshold', '2.0']).status).toBe(2);
      expect(runCli(['recall', 'q', '--user', 'u', '--threshold', '-0.1']).status).toBe(2);
    });

    test('18. EC-6 sub-3 — recall --diversify out of bounds exits 2', () => {
      expect(runCli(['recall', 'q', '--user', 'u', '--diversify', '1.5']).status).toBe(2);
    });

    test('19. EC-7 — recall JSON does NOT include embedding array; stdout < 50 KB', () => {
      const userId = randomUUID();
      runCli(['remember', 'small fact', '--user', userId]);
      const result = runCli(['recall', 'fact', '--user', userId, '--top-k', '10']);
      expect(result.status).toBe(0);
      expect(result.stdout.length).toBeLessThan(50_000);
      const items = JSON.parse(result.stdout) as ReadonlyArray<Record<string, unknown>>;
      if (items.length > 0) {
        expect(Object.keys(items[0]!)).not.toContain('embedding');
      }
    });
  },
);
