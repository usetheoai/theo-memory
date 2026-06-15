/**
 * T3.2 — REST server stub removal sentinel.
 *
 * Verifies src/agent-tools/run-server.ts no longer imports StubLLM or
 * DeterministicStubEmbedder (mirror of commit e43d801 MCP fix).
 *
 * Sentinel locus updated 2026-06-04 (verbs-as-cli-fixes-cycle-2 T3.1 ADR D4
 * extracted the provider tuple to `wireMemoryFromPool` at
 * `src/agent-tools/agent-tools-memory.ts` — single source of truth — and the
 * subsequent hotfix `3a53db8` (M2 closure) extended that centralization to
 * the `LOCAL_EMBEDDER_DIM = 384` constant. The no-stub invariant is now
 * checked at the SINGLE-SOURCE-OF-TRUTH file rather than at the run-server.ts
 * call site, AND we still defensively verify run-server.ts does NOT
 * accidentally re-introduce stub imports at its own composition root).
 *
 * EC-2 absorption (MUST FIX): docker-stack.test.ts + cli-consolidated.test.ts
 * boot tests have OPENAI_API_KEY injection (fake-key sufficient for boot;
 * real LLM calls out of GOAL-TEST scope).
 *
 * @see .claude/knowledge-base/plans/p0-api-sdk-mcp-correctness-audit-plan.md § T3.2
 * @see .claude/knowledge-base/plans/verbs-as-cli-fixes-cycle-2-plan.md § T3.1 + ADR D4
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const RUN_SERVER_PATH = join(REPO_ROOT, 'packages', 'cli', 'src', 'run-server.ts');
const AGENT_TOOLS_MEMORY_PATH = join(
  REPO_ROOT,
  'packages',
  'agent-core',
  'src',
  'agent-tools-memory.ts',
);
const README_PATH = join(REPO_ROOT, 'README.md');

describe('T3.2 — REST server stub removal (post-fix-cycle-2 ADR D4 locus update)', () => {
  const runServer = readFileSync(RUN_SERVER_PATH, 'utf8');
  const agentToolsMemory = readFileSync(AGENT_TOOLS_MEMORY_PATH, 'utf8');
  const readme = readFileSync(README_PATH, 'utf8');

  // ── Defensive: run-server.ts must NOT re-introduce stub imports directly.

  test('1. run-server.ts does NOT import StubLLM', () => {
    expect(runServer).not.toMatch(/import\b.*\bStubLLM\b/);
  });

  test('2. run-server.ts does NOT import DeterministicStubEmbedder', () => {
    expect(runServer).not.toMatch(/import\b.*\bDeterministicStubEmbedder\b/);
  });

  // ── Source-of-truth: the provider tuple is now composed at
  //    agent-tools-memory.ts (wireMemoryFromPool) per ADR D4 of
  //    verbs-as-cli-fixes-cycle-2. The 3 callers (CLI factory + MCP + REST)
  //    delegate to that single helper. Sentinels updated accordingly.

  test('3. agent-tools-memory.ts imports LocalTransformerEmbedder (single source of truth)', () => {
    expect(agentToolsMemory).toMatch(/import\b.*\bLocalTransformerEmbedder\b/);
  });

  test('4. agent-tools-memory.ts imports OpenAILLM (single source of truth)', () => {
    expect(agentToolsMemory).toMatch(/import\b.*\bOpenAILLM\b/);
  });

  test('5. run-server.ts hard-fails on missing OPENAI_API_KEY (via assertEnvOrExit boundary)', () => {
    // Post-fix-cycle-1 T2.1, run-server.ts calls
    // `assertEnvOrExit([PG_URI_ENV_SPEC, OPENAI_API_KEY_ENV_SPEC])` which
    // emits the byte-identical `Error: OPENAI_API_KEY required ...` stderr
    // string at runtime. Sentinel matches either the literal substring
    // (when run-server.ts retained it) OR the imported spec name (post
    // T2.1 retrofit — current state).
    expect(runServer).toMatch(/OPENAI_API_KEY_ENV_SPEC|OPENAI_API_KEY required/);
  });

  test('6. agent-tools-memory.ts declares LOCAL_EMBEDDER_DIM = 384 constant (single source of truth post-hotfix M2)', () => {
    expect(agentToolsMemory).toMatch(/LOCAL_EMBEDDER_DIM\s*=\s*384/);
  });

  test('7. README no longer claims "MCP wires DeterministicStubEmbedder"', () => {
    expect(readme).not.toMatch(
      /Both `themory server` \(REST\) and `themory mcp` \(MCP\) wire `DeterministicStubEmbedder`/,
    );
  });

  test('8. README documents the new no-stub policy', () => {
    expect(readme).toMatch(/no stubs in production path/i);
  });
});
