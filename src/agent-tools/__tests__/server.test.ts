/**
 * McpServer wrapper class tests — T1.1.
 *
 * Asserts the wrapper around `@modelcontextprotocol/sdk/server/index.js#Server`:
 * 1. Declares `capabilities.tools.listChanged: false` per ADR D2 (4 static tools).
 * 2. Defaults server name to `'themory'` per plan T1.1 § Deep Dives.
 * 3. Honors version from McpServerOptions when provided.
 *
 * Per SEPA pre-RED Option A: tests assert via the wrapper's PUBLIC readonly getters
 * (`name`, `version`, `capabilities`) rather than bracket-accessing SDK private state.
 * This honors testing.md § "What to test — public API" and survives SDK internal refactors.
 *
 * @see ADR D2 — Tool schema: 4 separate tools, listChanged: false
 * @see ADR D4 — SDK integration via existing MCP client
 */
import { describe, expect, test } from 'vitest';

import { McpServer } from '../server.js';

describe('McpServer — construction (T1.1)', () => {
  test('declares tools.listChanged: false in capabilities when constructed', () => {
    // Given: a fresh McpServer with no options (defaults apply)
    // When: we read its capabilities
    const server = new McpServer({});
    // Then: tools.listChanged is false per ADR D2 (4 static tools, no dynamic registration)
    expect(server.capabilities.tools?.listChanged).toBe(false);
  });

  test('defaults server name to "themory" when no name option is provided', () => {
    // Given: McpServer constructed with no name in options
    const server = new McpServer({});
    // Then: name is the locked default per plan T1.1 § Deep Dives
    expect(server.name).toBe('themory');
  });

  test('uses the version option when provided', () => {
    // Given: McpServer constructed with explicit version
    const server = new McpServer({ version: '0.3.0-test' });
    // Then: that version surfaces on the wrapper
    expect(server.version).toBe('0.3.0-test');
  });
});
