/**
 * M24 T3.2 (#145) — `persistDraftsWithQuarantine` skips a provenance-invalid
 * reflect draft instead of throwing and aborting the whole reflect.
 *
 * The M23 bench aborted reflect twice on a single hallucinated `derivedFrom`
 * id (the old `validateProvenance` throws on the FIRST bad draft). Per Rule 8
 * (recoverable vs unrecoverable), one bad row of many must be quarantined
 * (emit `reflection_draft_quarantined` + counter, Princípio 3), not fatal.
 */
import type { Tracer } from '@opentelemetry/api';
import { describe, expect, test, vi } from 'vitest';

import type { Embedder } from '../../domain/dip/embedder.js';
import type { DerivedMemoryDraft } from '../../domain/reflection/types.js';
import type { Scope } from '../../domain/scope.js';

import { persistDraftsWithQuarantine } from './reflect-drafts.js';

const SCOPE: Scope = { kind: 'user', userId: 'u1' };
const COUNTER_TUPLE = { userId: 'u1', sessionId: null, agentId: null };

function stubEmbedder(): Embedder {
  return {
    embed: () => Promise.resolve([0.1, 0.2, 0.3]),
    embedBatch: (texts) => Promise.resolve(texts.map(() => [0.1, 0.2, 0.3])),
  };
}

/** Fake tracer that records the event names emitted via emitEvent. */
function recordingTracer(): { tracer: Tracer; events: string[] } {
  const events: string[] = [];
  const tracer = {
    startActiveSpan: (name: string, cb: (s: unknown) => unknown): unknown => {
      events.push(name);
      return cb({ setAttribute: vi.fn(), end: vi.fn() });
    },
  } as unknown as Tracer;
  return { tracer, events };
}

/** Run the helper against a fresh recording store + tracer; return the outcome + probes. */
async function runPersist(drafts: DerivedMemoryDraft[], sourceIds: string[]): Promise<{
  persisted: number;
  quarantined: number;
  inserted: string[];
  events: string[];
}> {
  const inserted: string[] = [];
  const store = {
    insertDerivedMemory: (args: { text: string }): Promise<string> => {
      inserted.push(args.text);
      return Promise.resolve(`id-${String(inserted.length)}`);
    },
  };
  const { tracer, events } = recordingTracer();
  const out = await persistDraftsWithQuarantine({
    drafts,
    sourceIds,
    embedder: stubEmbedder(),
    store,
    scope: SCOPE,
    counterTuple: COUNTER_TUPLE,
    workspaceId: null,
    tracer,
  });
  return { persisted: out.persisted.length, quarantined: out.quarantined, inserted, events };
}

describe('persistDraftsWithQuarantine (M24 T3.2 / #145)', () => {
  test('quarantines the one invalid draft, persists the valid two, emits event, does NOT throw', async () => {
    const r = await runPersist(
      [
        { text: 'valid A', derivedFrom: ['m1'] },
        { text: 'HALLUCINATED', derivedFrom: ['ghost'] }, // unknown id → quarantine
        { text: 'valid B', derivedFrom: ['m2', 'm3'] },
      ],
      ['m1', 'm2', 'm3'],
    );
    expect(r.persisted).toBe(2);
    expect(r.quarantined).toBe(1);
    expect(r.inserted).toEqual(['valid A', 'valid B']); // the hallucinated draft never persisted
    expect(r.events).toContain('reflection_draft_quarantined');
  });

  test('all-valid drafts persist unchanged (regression — no quarantine, no event)', async () => {
    const r = await runPersist(
      [
        { text: 'insight A', derivedFrom: ['m1'] },
        { text: 'insight B', derivedFrom: ['m2'] },
      ],
      ['m1', 'm2'],
    );
    expect(r.persisted).toBe(2);
    expect(r.quarantined).toBe(0);
    expect(r.inserted).toEqual(['insight A', 'insight B']);
    expect(r.events).not.toContain('reflection_draft_quarantined');
  });

  test('ALL drafts invalid → zero persisted, no throw (caller returns no-consolidation)', async () => {
    const r = await runPersist(
      [
        { text: 'bad1', derivedFrom: [] },
        { text: 'bad2', derivedFrom: ['ghost'] },
      ],
      ['m1'],
    );
    expect(r.persisted).toBe(0);
    expect(r.quarantined).toBe(2);
    expect(r.inserted).toEqual([]);
  });
});
