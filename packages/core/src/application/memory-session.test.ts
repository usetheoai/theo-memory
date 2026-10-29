import { AsyncLocalStorage } from 'node:async_hooks';
import { describe, expect, test, vi } from 'vitest';

import { MemorySession, MemorySessionUnavailable } from './memory-session.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function fixture(maxPending = 32) {
  const facts = { lookup: vi.fn(async (_query: string) => [{ eventId: 'dinner', date: 'Thursday' }]),
    write: vi.fn(async (command: string) => ({ eventId: command, date: 'Thursday' })) };
  const memory = { recall: vi.fn(async () => []), remember: vi.fn(async () => []) };
  return { facts, memory, session: new MemorySession({ facts, memory, maxPending }) };
}

describe('memory session lifecycle', () => {
  test('loads exact facts and understanding before the session, and never falls back on an exact miss', async () => {
    const { session, facts, memory } = fixture();
    expect(await session.loadContext('Thursday', 'dinner style')).toEqual({ facts: [{ eventId: 'dinner', date: 'Thursday' }], memories: [] });
    expect(memory.recall).toHaveBeenCalledWith('dinner style', undefined);
    facts.lookup.mockResolvedValueOnce([]);
    expect(await session.lookupFacts('missing')).toEqual([]);
    expect(memory.recall).toHaveBeenCalledTimes(1);
    await session.close();
  });

  test('starts extraction on a later turn and allows exact writes during a slow extraction', async () => {
    const { session, memory, facts } = fixture();
    const blocked = deferred<[]>();
    memory.remember.mockImplementationOnce(() => blocked.promise);
    const job = session.enqueueUnderstanding({ text: 'I usually prefer dark colors', sourceId: 'turn-1', originSourceId: 'original-1', modality: 'audio' });
    expect(memory.remember).not.toHaveBeenCalled();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(memory.remember).toHaveBeenCalledWith('I usually prefer dark colors', {
      infer: true, strictExtraction: true, evidence: { kind: 'inferred', sourceId: 'turn-1', originSourceId: 'original-1', modality: 'audio' },
    });
    expect(await session.writeFact('blue-jacket')).toEqual({ eventId: 'blue-jacket', date: 'Thursday' });
    expect(facts.write).toHaveBeenCalledWith('blue-jacket');
    blocked.resolve([]);
    await expect(job.completion).resolves.toEqual({ status: 'succeeded', items: [] });
    await session.close();
  });

  test('acknowledges operational writes only after persistence and propagates failures', async () => {
    const { session, facts } = fixture();
    const persisted = deferred<{ eventId: string; date: string }>();
    facts.write.mockImplementationOnce(() => persisted.promise);
    let acknowledged = false;
    const write = session.writeFact('wishlist-item').then(() => { acknowledged = true; });
    await Promise.resolve();
    expect(acknowledged).toBe(false);
    persisted.resolve({ eventId: 'wishlist-item', date: 'Thursday' });
    await write;
    expect(acknowledged).toBe(true);
    facts.write.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(session.writeFact('another-item')).rejects.toThrow('database unavailable');
    await session.close();
  });

  test('bounds unfinished work and drains accepted observations on close', async () => {
    const { session, memory } = fixture(1);
    const blocked = deferred<[]>();
    memory.remember.mockImplementationOnce(() => blocked.promise);
    session.enqueueUnderstanding({ text: 'First turn', sourceId: 'turn-1' });
    expect(() => session.enqueueUnderstanding({ text: 'Second turn', sourceId: 'turn-2' })).toThrow(MemorySessionUnavailable);
    let closed = false;
    const closing = session.close().then(() => { closed = true; });
    expect(closed).toBe(false);
    expect(() => session.lookupFacts('Thursday')).toThrow('closed');
    expect(() => session.enqueueUnderstanding({ text: 'Late turn', sourceId: 'turn-3' })).toThrow('closed');
    blocked.resolve([]);
    await closing;
    expect(closed).toBe(true);
  });

  test('reports failed jobs without unhandled rejections and continues processing later jobs', async () => {
    const { session, memory } = fixture();
    const failure = new Error('provider unavailable');
    memory.remember.mockRejectedValueOnce(failure);
    const first = session.enqueueUnderstanding({ text: 'First', sourceId: 'turn-1' });
    const second = session.enqueueUnderstanding({ text: 'Second', sourceId: 'turn-2' });
    await expect(first.completion).resolves.toEqual({ status: 'failed', error: failure });
    await expect(second.completion).resolves.toEqual({ status: 'succeeded', items: [] });
    await expect(session.close()).rejects.toBeInstanceOf(AggregateError);
    await expect(session.flush()).resolves.toBeUndefined();
  });

  test('serializes turns and carries the enqueueing async context into each job', async () => {
    const context = new AsyncLocalStorage<string>();
    const { session, memory } = fixture();
    const seen: (string | undefined)[] = [];
    memory.remember.mockImplementation(async () => { seen.push(context.getStore()); return []; });
    context.run('workspace-a', () => session.enqueueUnderstanding({ text: 'First', sourceId: 'a' }));
    context.run('workspace-b', () => session.enqueueUnderstanding({ text: 'Second', sourceId: 'b' }));
    await session.close();
    expect(seen).toEqual(['workspace-a', 'workspace-b']);
  });

  test('rejects raw media and malformed observations without accepting work', async () => {
    const { session, memory } = fixture();
    expect(() => session.enqueueUnderstanding({ text: 'A frame', sourceId: 'frame-1',
      // @ts-expect-error Raw media is not a memory observation.
      video: Buffer.from('raw video'),
    })).toThrow();
    expect(() => session.enqueueUnderstanding({ text: ' ', sourceId: 'turn-1' })).toThrow();
    expect(memory.remember).not.toHaveBeenCalled();
    await session.close();
  });
});
