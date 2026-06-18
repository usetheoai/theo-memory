/**
 * Compat-mode resolution tests — OpenMemory compat (plan T2.1).
 *
 * `resolveCompat` precedence: CLI flag (Tier-1) → THEOMEM_MCP_COMPAT env (Tier-2)
 * → undefined (native). Asserts the flag/env matrix without booting a server.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveCompat } from '../run-mcp-server.js';

const ENV = 'THEOMEM_MCP_COMPAT';
let saved: string | undefined;
beforeEach(() => {
  saved = process.env[ENV];
  delete process.env[ENV];
});
afterEach(() => {
  if (saved === undefined) delete process.env[ENV];
  else process.env[ENV] = saved;
});

describe('resolveCompat', () => {
  it('returns undefined (native) when neither flag nor env set', () => {
    expect(resolveCompat(undefined)).toBeUndefined();
  });

  it('returns openmemory from the CLI flag (Tier-1)', () => {
    expect(resolveCompat('openmemory')).toBe('openmemory');
  });

  it('returns openmemory from THEOMEM_MCP_COMPAT env (Tier-2)', () => {
    process.env[ENV] = 'openmemory';
    expect(resolveCompat(undefined)).toBe('openmemory');
  });

  it('ignores an unknown env value (native)', () => {
    process.env[ENV] = 'REDACTED';
    expect(resolveCompat(undefined)).toBeUndefined();
  });
});
