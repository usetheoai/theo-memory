/**
 * T2.1 — GOAL integration test for production-runtime-hardening.
 *
 * Proves the opt-in skill-execution WIRING end-to-end against REAL
 * `ankane/pgvector:v0.5.1` + REAL `isolated-vm`:
 *   - ENABLED path (the exact object `wireMemoryFromPool` constructs when
 *     `THEOMEM_SKILL_EXECUTION=true`): a stored skill executes to its captured
 *     output via the SandboxedSkillExecutor.
 *   - DISABLED path (env unset → no skillExecutor): `execute()` throws
 *     `SkillExecutionNotConfiguredError` (→ REST 501) — the secure STORE-only
 *     default is preserved.
 *
 * The env→executor mapping itself is unit-tested in
 * `packages/agent-core/src/__tests__/agent-tools-memory.test.ts` (mocked
 * createLocalMemory); this test proves the runtime BEHAVIOR of each path.
 *
 * Gated by THEOMEM_PG_URI (skips clean when unset; EC-17 CI guard).
 *
 * @see .claude/knowledge-base/plans/production-runtime-hardening-plan.md § T2.1 + GOAL
 */
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

import type { Embedder, LLM } from '@usetheo/memory';
import {
  createLocalMemory,
  PgvectorStore,
  runMigrations,
  SandboxedSkillExecutor,
  SkillExecutionNotConfiguredError,
} from '@usetheo/memory';

const PG_URI = process.env['THEOMEM_PG_URI'];
const DIM = 1536;

if (process.env['CI'] === 'true' && (PG_URI === undefined || PG_URI === '')) {
  throw new Error('EC-17: THEOMEM_PG_URI must be set in CI for tests/integration/**');
}

function mkEmbedder(): Embedder {
  const vec = (t: string): readonly number[] => {
    const v = new Array<number>(DIM).fill(0);
    v[(t.length + t.charCodeAt(0)) % DIM] = 1;
    return v;
  };
  return {
    embed: vi.fn(async (t: string) => vec(t)),
    embedBatch: vi.fn(async (texts: readonly string[]) => texts.map((t) => vec(t))),
  };
}
const stubLlm = (): LLM => ({
  generateResponse: vi.fn(async () => ({ memory: [] })),
  generateChat: vi.fn(async () => ({ role: 'assistant' as const, content: '' })),
});

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('skill-execution-server-wiring GOAL (THEOMEM_PG_URI not set — skipping)', () => {
    test('placeholder', () => undefined);
  });
} else {
  const pool = new pg.Pool({ connectionString: PG_URI, max: 4 });

  beforeAll(async () => {
    await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
    await runMigrations(pool);
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE memories, entities, history RESTART IDENTITY CASCADE');
  });

  // The exact wiring `wireMemoryFromPool` performs per THEOMEM_SKILL_EXECUTION.
  function buildMemory(skillExecutionEnabled: boolean): ReturnType<typeof createLocalMemory> {
    return createLocalMemory({
      vectorStore: new PgvectorStore(pool),
      embedder: mkEmbedder(),
      llm: stubLlm(),
      entityBoost: false,
      ...(skillExecutionEnabled ? { skillExecutor: new SandboxedSkillExecutor() } : {}),
    });
  }

  describe('THE GOAL — opt-in skill execution wiring (real pg + real isolated-vm)', () => {
    test('ENABLED: a stored skill executes to its captured output', async () => {
      const memory = await buildMemory(true);
      const skills = memory.skills('wiring-on');
      const added = await skills.add({
        code: 'export function add(x, y) { return x + y; }',
        description: 'wiring-on add skill',
        codeLanguage: 'javascript',
      });
      const result = await skills.execute(added.id, { x: 2, y: 3 });
      expect(result.output).toBe(5);
      expect(result.truncated).toBe(false);
    });

    test('DISABLED (default): execute throws SkillExecutionNotConfiguredError (→ REST 501)', async () => {
      const memory = await buildMemory(false);
      const skills = memory.skills('wiring-off');
      const added = await skills.add({
        code: 'export function add(x, y) { return x + y; }',
        description: 'wiring-off add skill',
        codeLanguage: 'javascript',
      });
      await expect(skills.execute(added.id, { x: 2, y: 3 })).rejects.toBeInstanceOf(
        SkillExecutionNotConfiguredError,
      );
    });
  });
}
