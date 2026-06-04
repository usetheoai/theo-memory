/**
 * T3.2 — REST server stub removal sentinel.
 *
 * Verifies src/agent-tools/run-server.ts no longer imports StubLLM or
 * DeterministicStubEmbedder (mirror of commit e43d801 MCP fix).
 *
 * EC-2 absorption (MUST FIX): docker-stack.test.ts + cli-consolidated.test.ts
 * boot tests have OPENAI_API_KEY injection (fake-key sufficient for boot;
 * real LLM calls out of GOAL-TEST scope).
 *
 * @see .claude/knowledge-base/plans/p0-api-sdk-mcp-correctness-audit-plan.md § T3.2
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const RUN_SERVER_PATH = join(REPO_ROOT, 'src', 'agent-tools', 'run-server.ts');
const README_PATH = join(REPO_ROOT, 'README.md');

describe('T3.2 — REST server stub removal', () => {
  const runServer = readFileSync(RUN_SERVER_PATH, 'utf8');
  const readme = readFileSync(README_PATH, 'utf8');

  test('1. run-server.ts does NOT import StubLLM', () => {
    expect(runServer).not.toMatch(/import\b.*\bStubLLM\b/);
  });

  test('2. run-server.ts does NOT import DeterministicStubEmbedder', () => {
    expect(runServer).not.toMatch(/import\b.*\bDeterministicStubEmbedder\b/);
  });

  test('3. run-server.ts imports LocalTransformerEmbedder', () => {
    expect(runServer).toMatch(/import\b.*\bLocalTransformerEmbedder\b/);
  });

  test('4. run-server.ts imports OpenAILLM', () => {
    expect(runServer).toMatch(/import\b.*\bOpenAILLM\b/);
  });

  test('5. run-server.ts hard-fails on missing OPENAI_API_KEY', () => {
    expect(runServer).toMatch(/OPENAI_API_KEY required/);
  });

  test('6. run-server.ts declares LOCAL_EMBEDDER_DIM constant (mirror MCP)', () => {
    expect(runServer).toMatch(/LOCAL_EMBEDDER_DIM\s*=\s*384/);
  });

  test('7. README no longer claims "MCP wires DeterministicStubEmbedder"', () => {
    expect(readme).not.toMatch(/Both `themory server` \(REST\) and `themory mcp` \(MCP\) wire `DeterministicStubEmbedder`/);
  });

  test('8. README documents the new no-stub policy', () => {
    expect(readme).toMatch(/no stubs in production path/i);
  });
});
