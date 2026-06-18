/**
 * Compat-mode resolution tests — OpenMemory compat (plan T2.1).
 *
 * `resolveCompat` precedence: CLI flag (Tier-1) → THEOMEM_MCP_COMPAT env (Tier-2)
 * → undefined (native). Asserts the flag/env matrix without booting a server.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveCompat, resolveCompatPort } from '../run-mcp-server.js';

const ENV = 'THEOMEM_MCP_COMPAT';
const PORT_ENV = 'THEOMEM_MCP_HTTP_PORT';
let saved: string | undefined;
let savedPort: string | undefined;
beforeEach(() => {
  saved = process.env[ENV];
  savedPort = process.env[PORT_ENV];
  delete process.env[ENV];
  delete process.env[PORT_ENV];
});
afterEach(() => {
  if (saved === undefined) delete process.env[ENV];
  else process.env[ENV] = saved;
  if (savedPort === undefined) delete process.env[PORT_ENV];
  else process.env[PORT_ENV] = savedPort;
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

  it('the CLI flag wins over a conflicting env (Tier-1 > Tier-2)', () => {
    process.env[ENV] = 'REDACTED'; // unknown env
    expect(resolveCompat('openmemory')).toBe('openmemory');
  });

  it('ignores an unknown env value (native)', () => {
    process.env[ENV] = 'REDACTED';
    expect(resolveCompat(undefined)).toBeUndefined();
  });
});

describe('resolveCompatPort', () => {
  it('defaults to OpenMemory port 8765 when neither flag nor env set', () => {
    expect(resolveCompatPort(undefined)).toBe(8765);
  });

  it('uses THEOMEM_MCP_HTTP_PORT env when set (Tier-2)', () => {
    process.env[PORT_ENV] = '9999';
    expect(resolveCompatPort(undefined)).toBe(9999);
  });

  it('uses the CLI port flag over env (Tier-1 > Tier-2)', () => {
    process.env[PORT_ENV] = '9999';
    expect(resolveCompatPort(7000)).toBe(7000);
  });

  it('rejects an out-of-range port flag', () => {
    expect(() => resolveCompatPort(70_000)).toThrow(/Invalid port/);
  });
});
