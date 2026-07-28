/**
 * M4 T4.1 — explain_recall MCP tool. Unit-level: the handler resolves the
 * workspace from the scope (never the args) + projects the drops; without a
 * store it returns an honest "not enabled" result.
 */
import type { Memory, RecallTraceRow, RecallTraceStore } from '@usetheo/memory/contract';
import { withScope } from '@usetheo/memory-agent-core';
import { describe, expect, it } from 'vitest';


import { explainRecallHandler } from './explain-recall-handler.js';

const memoryFactory = (): Memory => ({}) as unknown as Memory;

function stubStore(rowsByWs: (id: string, ws: string) => readonly RecallTraceRow[]): RecallTraceStore {
  return {
    record: async () => {},
    getByRecallId: async (id: string, ws: string) => rowsByWs(id, ws),
  };
}

const row = (id: string, ws: string): RecallTraceRow => ({
  recallId: id,
  workspaceId: ws,
  scopeKey: 'user:u',
  memoryId: 'm1',
  semantic: 0.1,
  bm25: 0,
  entity: 0,
  composite: 0.1,
  threshold: 0.5,
  dropReason: 'sub_threshold',
  createdAt: new Date(0),
});

describe('explain_recall MCP tool', () => {
  it('returns the projected drops for the scoped workspace', async () => {
    const store = stubStore((id, ws) => (ws === 'default' ? [row(id, ws)] : []));
    const res = await withScope({ session: { userId: 'u' } }, () =>
      explainRecallHandler({ recallId: 'r1' }, { memoryFactory, recallTraceStore: store }),
    );
    expect(res.isError).toBe(false);
    const body = JSON.parse((res.content[0] as { text: string }).text) as {
      recallId: string;
      drops: { dropReason: string; workspaceId?: string }[];
    };
    expect(body.recallId).toBe('r1');
    expect(body.drops[0]?.dropReason).toBe('sub_threshold');
    // internal fields NOT leaked (projected DTO).
    expect(body.drops[0]?.workspaceId).toBeUndefined();
  });

  it('returns an honest "not enabled" result when no store is wired', async () => {
    const res = await withScope({ session: { userId: 'u' } }, () =>
      explainRecallHandler({ recallId: 'r1' }, { memoryFactory }),
    );
    expect((res.content[0] as { text: string }).text).toContain('not enabled');
  });

  it('reads the workspace from the scope, not the args (a foreign trace is empty)', async () => {
    // The store only has rows for workspace "other"; the scope resolves to "default".
    const store = stubStore((id, ws) => (ws === 'other' ? [row(id, ws)] : []));
    const res = await withScope({ session: { userId: 'u' } }, () =>
      explainRecallHandler({ recallId: 'r1' }, { memoryFactory, recallTraceStore: store }),
    );
    expect((res.content[0] as { text: string }).text).toContain('No recall trace');
  });
});
