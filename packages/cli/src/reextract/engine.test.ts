/**
 * M13 T3.1 unit suite — reextract engine mechanics with stubs (no DB, no LLM).
 * Integration counterpart: tests/integration/reextract.test.ts (real pgvector).
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test, vi } from 'vitest';

import type { LLM, MemoryEntityStore } from '@usetheo/memory';

import {
  chunkTargets,
  runReextract,
  ReextractCheckpointCorrupted,
  REEXTRACT_INPUT_MAX_CHARS,
  type ReextractOptions,
  type ReextractPool,
  type ReextractTarget,
} from './engine.js';

function makeTargets(n: number, textLen = 20): ReextractTarget[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    text: 'x'.repeat(textLen),
    workspace_id: 'ws1',
    user_id: 'alice',
    session_id: null,
    agent_id: null,
  }));
}

function stubPool(targets: readonly ReextractTarget[]): ReextractPool {
  return {
    query: async <R extends Record<string, unknown>>(sql: string): Promise<{ rows: R[] }> => {
      if (sql.includes('reextract:select-targets')) {
        return { rows: targets as unknown as R[] };
      }
      // link-check probe: report a fresh (non-pre-existing) link so the
      // F-dom-db-3 guard sees a successful persist in the stubbed world.
      if (sql.includes('reextract:link-check')) {
        return { rows: [{ entity_id: 'stub-new-link' }] as unknown as R[] };
      }
      return { rows: [] };
    },
  };
}

function stubEntityStore(): MemoryEntityStore {
  return {
    upsertAndLink: vi.fn(async () => undefined),
    list: vi.fn(async () => []),
    supersedeEntity: vi.fn(async () => true), forgetEntity: vi.fn(async () => ({ entitiesRemoved: 0, linksRemoved: 0, edgesRemoved: 0 })),
  };
}

function stubLlm(onCall?: (messages: unknown, callIndex: number) => unknown): {
  llm: LLM;
  spy: ReturnType<typeof vi.fn>;
} {
  let calls = 0;
  const spy = vi.fn(async (messages: unknown) => {
    const i = calls;
    calls += 1;
    return onCall !== undefined
      ? onCall(messages, i)
      : { memory: [], entities: [{ name: 'Codex', type: 'PRODUCT' }] };
  });
  return { llm: { generateResponse: spy, generateChat: vi.fn() }, spy };
}

const embedder = {
  embed: async () => [0.1, 0.2],
  embedBatch: async (t: readonly string[]) => t.map(() => [0.1, 0.2]),
};

function baseOpts(overrides: Partial<ReextractOptions> = {}): ReextractOptions {
  return { dryRun: false, resume: false, concurrency: 5, chunkSize: 25, chunkMaxBytes: 512 * 1024, ...overrides };
}

function freshCheckpoint(): string {
  return join(mkdtempSync(join(tmpdir(), 'reextract-test-')), 'cp.json');
}

describe('chunkTargets (D3 count+bytes)', () => {
  test('test_chunking_respects_count_and_bytes', () => {
    // 60 small targets → 3 chunks (25/25/10) by count.
    const byCount = chunkTargets(makeTargets(60), 25, 512 * 1024);
    expect(byCount.map((c) => c.length)).toEqual([25, 25, 10]);

    // Byte boundary: 4 targets of 300 bytes with a 700-byte cap → chunks close
    // at the cap (2/2), never mid-item.
    const byBytes = chunkTargets(makeTargets(4, 300), 25, 700);
    expect(byBytes.map((c) => c.length)).toEqual([2, 2]);

    // A single item ABOVE the cap gets its own chunk — processed, not skipped
    // (#109 lesson: an oversized single item is never a silent skip).
    const oversized = chunkTargets(makeTargets(1, 5000), 25, 700);
    expect(oversized).toHaveLength(1);
    expect(oversized[0]).toHaveLength(1);
  });
});

describe('runReextract (unit, stubs)', () => {
  test('test_dry_run_makes_zero_llm_calls_and_estimates', async () => {
    const { llm, spy } = stubLlm();
    const report = await runReextract(
      { pool: stubPool(makeTargets(7)), llm, embedder, memoryEntityStore: stubEntityStore(), checkpointPath: freshCheckpoint() },
      baseOpts({ dryRun: true }),
    );
    expect(spy).toHaveBeenCalledTimes(0);
    expect(report.targets).toBe(7);
    expect(report.estTokens).toBeGreaterThan(0);
    // Report shape: all 8 declared fields present (AC).
    expect(Object.keys(report).sort()).toEqual(
      ['durationMs', 'entitiesCreated', 'entitiesSuperseded', 'estTokens', 'llmCalls', 'processed', 'skipped', 'targets'].sort(),
    );
  });

  test('test_resume_skips_checkpointed_targets', async () => {
    const targets = makeTargets(7);
    const cp = freshCheckpoint();
    writeFileSync(cp, JSON.stringify({ done: targets.slice(0, 3).map((t) => t.id), startedAt: 'x' }));
    const { llm } = stubLlm();
    const report = await runReextract(
      { pool: stubPool(targets), llm, embedder, memoryEntityStore: stubEntityStore(), checkpointPath: cp },
      baseOpts({ resume: true }),
    );
    expect(report.processed).toBe(4);
    expect(report.skipped['target_already_done']).toBe(3);
  });

  test('test_corrupted_checkpoint_is_typed_error', async () => {
    const cp = freshCheckpoint();
    writeFileSync(cp, '{not json');
    const { llm } = stubLlm();
    // Single run, both assertions on the captured rejection (typed class + the
    // actionable --restart instruction) — negative case per testing.md § 4.1.
    const rejection = runReextract(
      { pool: stubPool(makeTargets(2)), llm, embedder, memoryEntityStore: stubEntityStore(), checkpointPath: cp },
      baseOpts({ resume: true }),
    );
    await expect(rejection).rejects.toThrow(ReextractCheckpointCorrupted);
    await expect(rejection).rejects.toThrow(/--restart/);
  });

  test('test_parse_failure_is_distinct_typed_skip', async () => {
    // /review F-arch-6/F-dom-cli-2: malformed LLM output → target_failed_parse
    // (distinct from transport target_failed_llm), and the batch never aborts.
    const targets = makeTargets(2);
    const { llm } = stubLlm((_m, i) => (i === 0 ? '{not valid json' : { memory: [], entities: [] }));
    const report = await runReextract(
      { pool: stubPool(targets), llm, embedder, memoryEntityStore: stubEntityStore(), checkpointPath: freshCheckpoint() },
      baseOpts({ concurrency: 1 }),
    );
    expect(report.skipped['target_failed_parse']).toBe(1);
    expect(report.skipped['target_failed_llm']).toBeUndefined();
    expect(report.processed).toBe(1);
  });

  test('test_llm_failure_is_typed_skip_not_abort', async () => {
    const targets = makeTargets(3);
    const { llm } = stubLlm((_prompt, i) => {
      if (i === 1) throw new Error('429 rate limited');
      return { memory: [], entities: [{ name: 'Codex', type: 'PRODUCT' }] };
    });
    const report = await runReextract(
      { pool: stubPool(targets), llm, embedder, memoryEntityStore: stubEntityStore(), checkpointPath: freshCheckpoint() },
      baseOpts({ concurrency: 1 }),
    );
    expect(report.skipped['target_failed_llm']).toBe(1);
    expect(report.processed).toBe(2);
  });

  test('test_short_text_is_typed_skip', async () => {
    const targets = [...makeTargets(1, 20), { ...makeTargets(1)[0]!, id: '00000000-0000-4000-8000-00000000ffff', text: 'abc' }];
    const { llm, spy } = stubLlm();
    const report = await runReextract(
      { pool: stubPool(targets), llm, embedder, memoryEntityStore: stubEntityStore(), checkpointPath: freshCheckpoint() },
      baseOpts(),
    );
    expect(report.skipped['target_skipped_empty']).toBe(1);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test('test_large_memory_input_truncated_not_crashed', async () => {
    // EC-4: a 40K-char memory reaches the LLM with the input truncated to the cap.
    const big = makeTargets(1, 40_000);
    let seenChars = 0;
    const { llm } = stubLlm((messages) => {
      // Total chars actually sent to the LLM (system prompt embeds the rendered
      // input once; the user message carries it once more).
      seenChars = JSON.stringify(messages).length;
      return { memory: [], entities: [] };
    });
    const report = await runReextract(
      { pool: stubPool(big), llm, embedder, memoryEntityStore: stubEntityStore(), checkpointPath: freshCheckpoint() },
      baseOpts(),
    );
    expect(report.processed).toBe(1);
    expect(seenChars).toBeGreaterThan(0);
    // Untruncated, the 40K input would appear twice (≥ 80K chars). Truncated to
    // the 16K cap, the total stays under 2×cap + template slack.
    expect(seenChars).toBeLessThan(REEXTRACT_INPUT_MAX_CHARS * 2 + 8_000);
  });
});

describe('retireMechanism (T1.1 noise retirement)', () => {
  test('test_retire_emits_typed_event', async () => {
    // Stub tracer captures the reextract_noise_retired event with counts.
    const events: { name: string; attrs: Record<string, unknown> }[] = [];
    const tracer = {
      startActiveSpan: (name: string, optsOrFn: unknown, maybeFn?: unknown) => {
        const attrs: Record<string, unknown> = {};
        events.push({ name, attrs });
        const span = {
          end: () => undefined,
          setAttribute: (k: string, v: unknown) => {
            attrs[k] = v;
          },
        };
        const fn = (typeof maybeFn === 'function' ? maybeFn : optsOrFn) as (s: typeof span) => void;
        fn(span);
      },
    } as never;
    const pool: ReextractPool = {
      query: async <R extends Record<string, unknown>>(sql: string): Promise<{ rows: R[]; rowCount?: number | null }> => {
        if (sql.includes('retire:select')) {
          return { rows: [{ id: 'a' }, { id: 'b' }] as unknown as R[] };
        }
        return { rows: [{ edges: '1', links: '2', ents: '2' }] as unknown as R[] };
      },
    };
    const { retireMechanism } = await import('./retire.js');
    const report = await retireMechanism({ pool, tracer }, { commit: true });
    expect(report.retired).toBe(2);
    const ev = events.find((e) => e.name === 'reextract_noise_retired');
    expect(ev).toBeDefined();
    expect(ev?.attrs['retired']).toBe(2);
    expect(ev?.attrs['candidates']).toBe(2);
  });
});

describe('concurrency (semaphore)', () => {
  test('test_semaphore_bounds_inflight_llm_calls', async () => {
    // Atomic-counter invariant: with concurrency 5 and 20 targets, the async-gated
    // stub never observes more than 5 in-flight generateResponse calls.
    let inFlight = 0;
    let maxInFlight = 0;
    const { llm } = stubLlm(() => ({ memory: [], entities: [] }));
    const gated: LLM = {
      ...(llm as object),
      generateResponse: async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 10));
        inFlight -= 1;
        return { memory: [], entities: [] };
      },
    } as unknown as LLM;
    const report = await runReextract(
      { pool: stubPool(makeTargets(20)), llm: gated, embedder, memoryEntityStore: stubEntityStore(), checkpointPath: freshCheckpoint() },
      baseOpts({ concurrency: 5, chunkSize: 25 }),
    );
    expect(report.processed).toBe(20);
    expect(maxInFlight).toBeLessThanOrEqual(5);
    expect(maxInFlight).toBeGreaterThan(1);
  });
});
