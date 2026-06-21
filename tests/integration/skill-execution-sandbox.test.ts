/**
 * T3.1 — THE GOAL integration test for agentic-skill-execution-sandbox (M1).
 *
 * End-to-end against REAL `ankane/pgvector:v0.5.1` (skill store + read) AND REAL
 * `isolated-vm` (execution): a benign stored skill executes to its captured
 * output; one malicious skill per guard category is denied with a typed
 * `ToolInvocationDeniedError` + the `tool_invocation_denied` audit event, with
 * ZERO host escape (the host `process` is intact and a subsequent benign call
 * still works). Mirrors Letta's TS tool-execution suite shape.
 *
 * Gated by THEOMEM_PG_URI (skips cleanly when unset, per the integration-suite
 * convention). isolated-vm must be installed (optional addon).
 *
 * @see .claude/knowledge-base/plans/agentic-skill-execution-sandbox-plan.md § T3.1
 */
import type { Tracer } from '@opentelemetry/api';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

import type { Embedder, LLM } from '@usetheo/memory';
import {
  createLocalMemory,
  PgvectorStore,
  runMigrations,
  SandboxedSkillExecutor,
  ToolInvocationDeniedError,
} from '@usetheo/memory';

const PG_URI = process.env['THEOMEM_PG_URI'];
const DIM = 1536;

function mkEmbedder(): Embedder {
  const vec = (text: string): readonly number[] => {
    const v = new Array<number>(DIM).fill(0);
    v[(text.length + text.charCodeAt(0)) % DIM] = 1;
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

interface RecordedEvent {
  readonly event: string;
  readonly attributes: Record<string, unknown>;
}
function recordingTracer(sink: RecordedEvent[]): Tracer {
  return {
    startActiveSpan(name: string, fn: (span: unknown) => void): void {
      const attributes: Record<string, unknown> = {};
      fn({
        setAttribute(k: string, v: unknown) {
          attributes[k] = v;
        },
        end() {
          /* no-op */
        },
      });
      sink.push({ event: name, attributes });
    },
  } as unknown as Tracer;
}

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('skill-execution-sandbox GOAL (THEOMEM_PG_URI not set — skipping)', () => {
    test('placeholder', () => undefined);
  });
} else {
  const pool = new pg.Pool({ connectionString: PG_URI, max: 4 });
  const events: RecordedEvent[] = [];

  beforeAll(async () => {
    await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
    await runMigrations(pool);
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    events.length = 0;
    await pool.query('TRUNCATE memories, entities, history RESTART IDENTITY CASCADE');
  });

  function buildMemory(): Awaited<ReturnType<typeof createLocalMemory>> | Promise<unknown> {
    return createLocalMemory({
      vectorStore: new PgvectorStore(pool),
      embedder: mkEmbedder(),
      llm: stubLlm(),
      entityBoost: false,
      skillExecutor: new SandboxedSkillExecutor({ tracer: recordingTracer(events) }),
    });
  }

  describe('THE GOAL — execute a stored skill in a hardened sandbox (real pg + real isolated-vm)', () => {
    test('benign: a stored JS skill executes end-to-end to its captured output', async () => {
      const memory = await buildMemory();
      const skills = memory.skills('goal-repo');
      const added = await skills.add({
        code: 'export function add(x, y) { return x + y; }',
        description: 'benign add skill',
        codeLanguage: 'javascript',
      });
      const result = await skills.execute(added.id, { x: 2, y: 3 });
      expect(result.output).toBe(5);
      expect(result.truncated).toBe(false);
      expect(events.some((e) => e.event === 'skill_executed')).toBe(true);
    });

    const malicious: ReadonlyArray<{
      readonly name: string;
      readonly code: string;
      readonly reason: string;
      readonly opts?: Record<string, number>;
    }> = [
      {
        name: 'node-binding reach',
        code: 'export function f() { return process.env; }',
        reason: 'node-binding-attempt',
      },
      {
        name: 'fs access',
        code: "export function f() { return require('fs'); }",
        reason: 'fs-access-attempt',
      },
      {
        name: 'infinite loop',
        code: 'export function f() { while (true) {} return 1; }',
        reason: 'timeout',
        opts: { timeoutMs: 50 },
      },
      {
        name: 'output flood',
        code: "export function f() { return 'x'.repeat(100000); }",
        reason: 'output-cap',
        opts: { maxOutputBytes: 64 },
      },
      {
        name: 'non-cloneable result',
        code: 'export function f() { return function () {}; }',
        reason: 'non-cloneable-result',
      },
    ];

    for (const m of malicious) {
      test(`malicious denied + audited + zero host escape: ${m.name} → ${m.reason}`, async () => {
        const memory = await buildMemory();
        const skills = memory.skills('goal-repo');
        const added = await skills.add({
          code: m.code,
          description: `malicious ${m.name}`,
          codeLanguage: 'javascript',
        });
        await expect(skills.execute(added.id, {}, m.opts)).rejects.toMatchObject({
          name: 'ToolInvocationDeniedError',
          reason: m.reason,
        });
        // audited: the denial emitted tool_invocation_denied with the reason
        expect(
          events.some((e) => e.event === 'tool_invocation_denied' && e.attributes['reason'] === m.reason),
        ).toBe(true);
        // zero host escape: the host process is intact AND a benign skill still runs
        expect(typeof process.env).toBe('object');
        const benign = await skills.add({
          code: 'export function ok() { return 7; }',
          description: `post-${m.name} sanity`,
          codeLanguage: 'javascript',
        });
        const ok = await skills.execute(benign.id, {});
        expect(ok.output).toBe(7);
      });
    }

    test('ToolInvocationDeniedError is the exported typed error (instanceof)', async () => {
      const memory = await buildMemory();
      const skills = memory.skills('goal-repo');
      const added = await skills.add({
        code: 'export function f() { return process; }',
        description: 'instanceof check skill',
        codeLanguage: 'javascript',
      });
      await expect(skills.execute(added.id, {})).rejects.toBeInstanceOf(ToolInvocationDeniedError);
    });
  });
}
