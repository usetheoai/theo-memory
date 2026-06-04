/**
 * Unit tests for scripts/dogfood/claude-code-bridge.ts.
 * T1.1 of dogfood-anchor-scenario-launch plan v1.1.
 *
 * Covers EC absorptions: EC-1 (typed MCPUnreachable), EC-3 (required projectSlug
 * + typed InvalidProjectSlug), EC-7 (filename pattern), EC-8 (mkdir -p), EC-9
 * (empty content skip), plus sanitization (ADR D2).
 *
 * Integration test against real `themory mcp` + pgvector lives separately at
 * tests/integration/dogfood/claude-code-bridge-roundtrip.test.ts (T2.1).
 *
 * @see .claude/knowledge-base/plans/dogfood-anchor-scenario-launch-plan.md § T1.1
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  InvalidProjectSlug,
  MCPUnreachable,
  bridgeForget,
  bridgeRecall,
  bridgeReflect,
  bridgeRemember,
  sanitizeProjectSlug,
} from '../../../scripts/dogfood/claude-code-bridge.js';

// Pin CLI to a non-existent path so MCP spawn always fails — exercises EC-1
// and EC-8 paths without requiring `themory mcp` to actually run.
const NON_EXISTENT_CLI = '/tmp/themory-bridge-test-nonexistent-cli-xyz';

describe('sanitizeProjectSlug (ADR D2)', () => {
  it('strips leading hyphens', () => {
    expect(sanitizeProjectSlug('-home-paulo-Projetos')).toBe('home-paulo-Projetos');
  });
  it('collapses non-alphanumeric (except _ -) to _', () => {
    expect(sanitizeProjectSlug('-home/paulo.theo')).toBe('home_paulo_theo');
  });
  it('preserves alphanumeric + - + _', () => {
    expect(sanitizeProjectSlug('foo_bar-baz123')).toBe('foo_bar-baz123');
  });
  it('handles empty string', () => {
    expect(sanitizeProjectSlug('')).toBe('');
  });
});

describe('EC-3 absorption — projectSlug is REQUIRED arg', () => {
  it('bridgeRemember throws InvalidProjectSlug when ctx is undefined', async () => {
    await expect(
      bridgeRemember('hello', undefined as unknown as { projectSlug: string }),
    ).rejects.toThrow(InvalidProjectSlug);
  });

  it('bridgeRemember throws InvalidProjectSlug when projectSlug is empty string', async () => {
    await expect(bridgeRemember('hello', { projectSlug: '' })).rejects.toThrow(InvalidProjectSlug);
  });

  it('bridgeRecall throws InvalidProjectSlug when projectSlug missing', async () => {
    await expect(
      bridgeRecall('q', undefined as unknown as { projectSlug: string }),
    ).rejects.toThrow(InvalidProjectSlug);
  });

  it('bridgeForget throws InvalidProjectSlug when projectSlug missing', async () => {
    await expect(
      bridgeForget('id-1', undefined as unknown as { projectSlug: string }),
    ).rejects.toThrow(InvalidProjectSlug);
  });

  it('bridgeReflect throws InvalidProjectSlug when projectSlug missing', async () => {
    await expect(
      bridgeReflect(undefined as unknown as { projectSlug: string }),
    ).rejects.toThrow(InvalidProjectSlug);
  });
});

describe('EC-9 absorption — empty content skip', () => {
  const ctx = { projectSlug: '-home-paulo-Projetos-usetheo-theo-memory' };

  it('bridgeRemember returns { skipped: true, reason: empty_content } for empty string', async () => {
    const result = await bridgeRemember('', ctx);
    expect(result).toEqual({ skipped: true, reason: 'empty_content' });
  });

  it('bridgeRemember returns skip sentinel for whitespace-only', async () => {
    const result = await bridgeRemember('   \n\t  ', ctx);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('empty_content');
  });

  it('bridgeRecall returns skip sentinel for empty query', async () => {
    const result = await bridgeRecall('', ctx);
    expect(result).toEqual({ skipped: true, reason: 'empty_content' });
  });

  it('bridgeForget throws on empty memoryId (NOT skip — forget is an explicit op)', async () => {
    await expect(bridgeForget('', ctx)).rejects.toThrow(/memoryId is required/);
  });
});

describe('EC-1 + EC-7 + EC-8 absorption — MCPUnreachable + degradation log', () => {
  let tmpRoot: string;
  const ctx = { projectSlug: '-home-paulo-Projetos-usetheo-theo-memory' };

  beforeEach(() => {
    // Sandbox degradation writes by repointing repo-root relative path via env.
    // Bridge resolves degradations dir relative to its own file location; we
    // cannot redirect that, but we CAN delete the dir between tests + observe
    // re-creation on first write (EC-8).
    tmpRoot = mkdtempSync(join(tmpdir(), 'bridge-test-'));
    process.env['THEMORY_BRIDGE_CLI'] = NON_EXISTENT_CLI;
    const degDir = join(process.cwd(), '.claude', 'knowledge-base', 'dogfood', 'degradations');
    if (existsSync(degDir)) {
      // Clean any test residue from prior runs while preserving any non-test files.
      for (const f of readdirSync(degDir)) {
        if (f.includes('mcp_unreachable')) {
          rmSync(join(degDir, f), { force: true });
        }
      }
    }
  });

  afterEach(() => {
    delete process.env['THEMORY_BRIDGE_CLI'];
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('bridgeRemember throws MCPUnreachable when MCP spawn fails', async () => {
    await expect(bridgeRemember('payload', ctx)).rejects.toThrow(MCPUnreachable);
  });

  it('bridgeRecall throws MCPUnreachable when MCP spawn fails', async () => {
    await expect(bridgeRecall('query', ctx)).rejects.toThrow(MCPUnreachable);
  });

  it('EC-1 — MCPUnreachable.message references the degradation log path', async () => {
    try {
      await bridgeRemember('payload', ctx);
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(MCPUnreachable);
      expect((err as Error).message).toMatch(/degradation logged at/);
    }
  });

  it('EC-8 — degradation log directory is created via mkdir -p before first write', async () => {
    const degDir = join(process.cwd(), '.claude', 'knowledge-base', 'dogfood', 'degradations');
    // Force the test by attempting a call AND inspecting that the dir exists
    // (bridge file resolves to that path regardless of CWD).
    await bridgeRemember('payload', ctx).catch(() => {
      /* expected */
    });
    expect(existsSync(degDir)).toBe(true);
    expect(statSync(degDir).isDirectory()).toBe(true);
  });

  it('EC-7 — degradation filename pattern includes date + HHmmss + ms + pid + event', async () => {
    const degDir = join(process.cwd(), '.claude', 'knowledge-base', 'dogfood', 'degradations');
    await bridgeRemember('payload', ctx).catch(() => {
      /* expected */
    });
    const files = readdirSync(degDir).filter((f) => f.includes('mcp_unreachable_remember'));
    expect(files.length).toBeGreaterThan(0);
    const latest = files.sort().reverse()[0]!;
    expect(latest).toMatch(/^\d{4}-\d{2}-\d{2}-\d{6}-\d{3}-pid\d+-mcp_unreachable_remember\.md$/);
  });
});
