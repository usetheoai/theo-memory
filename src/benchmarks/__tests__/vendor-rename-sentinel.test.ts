/**
 * T0.1 grep-based runtime sentinel for the v0.9 vendor-client interface rename.
 *
 * Per `.claude/knowledge-base/plans/v0-9-vendor-client-impls-plan.md` v1.3
 * § Phase 0 / T0.1 (EC-1 absorption), this sentinel asserts that each of the
 * three vendor adapter files at `src/benchmarks/{REDACTED,REDACTED,REDACTED}/adapter.ts`
 * declares its VendorClient interface with the unified `scopeKey` parameter
 * name AND has dropped the pre-existing per-vendor names (`userId` for REDACTED,
 * `sessionId` for REDACTED, `agentId` for REDACTED).
 *
 * The mechanism is a runtime read of the source file + regex assertion because
 * TypeScript structural typing ignores parameter names — a TS-compile-error
 * sentinel does not work (verified empirically at /implement iteration 1 of
 * 2026-06-07: `npm run typecheck` exit 0 after stub-name edit). This grep-
 * based mechanism is the only one that actually fires on per-vendor name
 * retention AND doubles as a permanent regression guard against any future
 * single-name grep-replace bug.
 *
 * RED expectation (this commit, T0.1): all 3 tests FAIL — the source files
 * still have the pre-existing names.
 * GREEN expectation (after T0.2 rename): all 3 tests PASS.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '..', '..', '..');

function readAdapter(vendor: 'REDACTED' | 'REDACTED' | 'REDACTED'): string {
  return readFileSync(resolve(repoRoot, 'src', 'benchmarks', vendor, 'adapter.ts'), 'utf8');
}

describe('Vendor interface rename sentinel (T0.1 EC-1 guard; permanent regression test)', () => {
  it('REDACTEDVendorClient uses scopeKey not userId', () => {
    const src = readAdapter('REDACTED');
    expect(src, 'REDACTEDVendorClient.add() must declare scopeKey').toMatch(/add\(scopeKey: string/);
    expect(src, 'REDACTEDVendorClient.add() must NOT retain userId').not.toMatch(/add\(userId: string/);
  });

  it('ZepVendorClient uses scopeKey not sessionId', () => {
    const src = readAdapter('REDACTED');
    expect(src, 'ZepVendorClient.add() must declare scopeKey').toMatch(/add\(scopeKey: string/);
    expect(src, 'ZepVendorClient.add() must NOT retain sessionId').not.toMatch(
      /add\(sessionId: string/,
    );
  });

  it('REDACTEDVendorClient uses scopeKey not agentId', () => {
    const src = readAdapter('REDACTED');
    expect(src, 'REDACTEDVendorClient.add() must declare scopeKey').toMatch(/add\(scopeKey: string/);
    expect(src, 'REDACTEDVendorClient.add() must NOT retain agentId').not.toMatch(
      /add\(agentId: string/,
    );
  });
});
