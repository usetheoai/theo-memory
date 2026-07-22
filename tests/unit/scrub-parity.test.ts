/**
 * M12 T1.1 — scrub single-source sentinel (M6-SEC-01).
 *
 * The kit hooks run standalone from `~/.claude/hooks` (copied files — they cannot import the npm
 * package), so the kit MUST carry a file copy of the scrub. This sentinel makes ANY divergence
 * between the CANONICAL package module and the kit copy a CI failure — the enforceable single-source
 * (blueprint D3; M12 risk #1: a diverged scrub copy leaks secrets).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const CANONICAL = 'packages/cli/src/import/theo-scrub.mjs';
const KIT_COPY = 'docs/claude-code-kit/hooks/theo-scrub.mjs';

describe('M12 scrub parity sentinel (M6-SEC-01)', () => {
  it('test_scrub_parity_kit_copy_is_byte_identical_to_canonical', () => {
    const canonical = readFileSync(CANONICAL, 'utf8');
    const kit = readFileSync(KIT_COPY, 'utf8');
    // Byte equality — a drift in EITHER file fails CI until both are re-synced deliberately.
    expect(kit).toBe(canonical);
  });

  it('test_scrub_exports_unchanged_behavior_lock', async () => {
    const { scrub } = await import('../../packages/cli/src/import/theo-scrub.mjs');
    const sample = 'token theo_live_abc123DEF456ghi789jkl012mno345p and npm npm_abc123DEF456ghi789jkl012mno345pqr678 end';
    const out = scrub(sample);
    // Fail-closed: neither secret survives; the surrounding text does.
    expect(out.clean).not.toContain('theo_live_abc123DEF456ghi789jkl012mno345p');
    expect(out.clean).not.toContain('npm_abc123DEF456ghi789jkl012mno345pqr678');
    expect(out.clean).toContain('token');
    expect(out.clean).toContain('end');
    expect(out.redactedChars).toBeGreaterThan(0);
    expect(out.kinds.length).toBeGreaterThan(0);
  });
});
