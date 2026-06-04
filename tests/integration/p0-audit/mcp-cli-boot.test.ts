/**
 * T3.3 — MCP CLI dist-artifact boot sentinel.
 *
 * Spawns `node dist/agent-tools/cli.js mcp` and asserts it boots + responds
 * to MCP `tools/list` with the 4 verbs registered (remember / recall /
 * forget / reflect).
 *
 * EC-3 absorption (MUST FIX): 3-tier `describe.skipIf` LOUDLY surfaces when
 * dist artifact, `OPENAI_API_KEY`, or `THEOMEM_PG_URI` are absent. Without
 * pre-flight, child_process spawn fails with ENOENT or exit-2 silently → a
 * confusing CI debug session. Each skip reason logged to stderr via console
 * so CI runs show WHY the test skipped.
 *
 * EC-9 absorption (SHOULD TEST): the helper `mcp-stdio-client.ts` uses
 * `readline.createInterface` for line-delimited JSON-RPC parsing (NOT raw
 * buffer concat).
 *
 * @see .claude/knowledge-base/plans/p0-api-sdk-mcp-correctness-audit-plan.md § T3.3
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import { spawnMcpAndListTools } from './_helpers/mcp-stdio-client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const CLI_PATH = join(REPO_ROOT, 'dist', 'agent-tools', 'cli.js');

const DIST_EXISTS = existsSync(CLI_PATH);
const HAS_OPENAI = process.env['OPENAI_API_KEY'] !== undefined && process.env['OPENAI_API_KEY'] !== '';
const HAS_PG_URI = process.env['THEOMEM_PG_URI'] !== undefined && process.env['THEOMEM_PG_URI'] !== '';

if (!DIST_EXISTS) {
  console.warn('T3.3 SKIP — dist/agent-tools/cli.js missing. Run `npm run build` first.');
}
if (!HAS_OPENAI) {
  console.warn('T3.3 SKIP — OPENAI_API_KEY env not set. Required by run-mcp-server.ts hard-fail (T3.2 sibling).');
}
if (!HAS_PG_URI) {
  console.warn('T3.3 SKIP — THEOMEM_PG_URI env not set. Required for runMigrations + PgvectorStore.');
}

describe.skipIf(!DIST_EXISTS || !HAS_OPENAI || !HAS_PG_URI)(
  'T3.3 — MCP CLI dist-artifact boot',
  () => {
    test('1. `themory mcp` lists 4 verbs (remember / recall / forget / reflect)', async () => {
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        // Ensure dim-aware migrations run successfully (matches run-mcp-server's
        // LOCAL_EMBEDDER_DIM = 384). The dev DB may already be at 384 from
        // prior dogfood work this session.
      };
      const result = await spawnMcpAndListTools(CLI_PATH, env, 30_000);
      const toolNames = new Set(result.tools.map((t) => t.name));
      expect(toolNames.has('remember')).toBe(true);
      expect(toolNames.has('recall')).toBe(true);
      expect(toolNames.has('forget')).toBe(true);
      expect(toolNames.has('reflect')).toBe(true);
    }, 60_000);

    test('2. `themory mcp` registers exactly 4 tools (no extras leaked)', async () => {
      const env: NodeJS.ProcessEnv = { ...process.env };
      const result = await spawnMcpAndListTools(CLI_PATH, env, 30_000);
      expect(result.tools.length).toBe(4);
    }, 60_000);
  },
);

// Always-run sanity test — verifies the skipIf preconditions are introspectable.
describe('T3.3 — preconditions sanity', () => {
  test('3. EC-3 sentinel — skipIf decisions are based on observable env state', () => {
    // Either dist exists OR the warn message above was emitted.
    // Either OPENAI_API_KEY is set OR the warn message above was emitted.
    // Either THEOMEM_PG_URI is set OR the warn message above was emitted.
    // This test always passes; it documents the skip semantic for CI auditors.
    expect(typeof DIST_EXISTS).toBe('boolean');
    expect(typeof HAS_OPENAI).toBe('boolean');
    expect(typeof HAS_PG_URI).toBe('boolean');
  });
});
