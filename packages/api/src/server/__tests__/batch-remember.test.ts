/**
 * M6 T1.3 — batch remember per-item failure isolation (unit, mock memory, no pg).
 * A poison item (its `remember` throws) is caught + reported in the aggregate;
 * it NEVER fails the whole batch and NEVER surfaces a silent 500 (error-handling.md).
 */
import type { Memory } from '@usetheo/memory/contract';
import { describe, expect, test, vi } from 'vitest';

import { createServer } from '../index.js';

/** Mock memory whose `user(id).remember(text)` throws for a poison text. */
function memoryThatFailsOn(poison: string): Memory {
  const scoped = {
    remember: vi.fn(async (text: string) => {
      if (text === poison) throw new Error('boom: poison item');
      return [{ id: `id-${text}`, rejectedAsDuplicate: false }];
    }),
  };
  return {
    withWorkspace: vi.fn(() => ({ user: vi.fn(() => scoped) }) as unknown as Memory),
    user: vi.fn(() => scoped),
    session: vi.fn(),
    agent: vi.fn(),
    skills: vi.fn(),
    forget: vi.fn(),
    get: vi.fn(),
    history: vi.fn(),
    reset: vi.fn(),
    flushReflections: vi.fn(),
    listSkillsBySubject: vi.fn().mockResolvedValue({ skills: [], total: 0 }),
  } as unknown as Memory;
}

describe('M6 T1.3 — POST /v1/remember/batch per-item failure isolation', () => {
  test('a poison item is reported failed; the rest import; status stays 201', async () => {
    const app = createServer({ memory: memoryThatFailsOn('BOOM') });
    const res = await app.fetch(
      new Request('http://localhost/v1/remember/batch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          items: [
            { userId: 'u', text: 'ok-1', infer: false },
            { userId: 'u', text: 'BOOM', infer: false },
            { userId: 'u', text: 'ok-2', infer: false },
          ],
        }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      imported: number;
      failed: number;
      errors?: { index: number; code: string; message: string }[];
    };
    expect(body.imported).toBe(2);
    expect(body.failed).toBe(1);
    expect(body.errors?.[0]?.index).toBe(1);
    // M6-SEC-02: the per-item error is the SANITIZED envelope, never the raw
    // throw. An unmapped Error maps to 500 INTERNAL_ERROR — the raw 'poison'
    // detail (which could be a pg internal or a token-bearing message) is NOT
    // echoed to the client.
    expect(body.errors?.[0]?.code).toBe('INTERNAL_ERROR');
    expect(body.errors?.[0]?.message).toBe('Internal server error');
    expect(body.errors?.[0]?.message).not.toContain('poison');
  });
});

describe('#109 live E2E — batch items inherit the edge-injected user scope (single-remember parity)', () => {
  test('tier-less items bind to X-Theo-User-Id instead of 422 INVALID_SCOPE', async () => {
    // The kit hooks post tier-less bodies and /v1/remember binds them to the auth-trusted
    // X-Theo-User-Id (applyHeaderUserScope). The batch surface rejected the same shape with
    // 422 — the live import through the gateway could never succeed. Batch must mirror single.
    const userIds: string[] = [];
    const scoped = { remember: vi.fn(async (text: string) => [{ id: `id-${text}`, rejectedAsDuplicate: false }]) };
    const memory = {
      withWorkspace: vi.fn(() => ({
        user: vi.fn((id: string) => {
          userIds.push(id);
          return scoped;
        }),
      })),
    } as unknown as Memory;
    const app = createServer({ memory });
    const res = await app.fetch(
      new Request('http://localhost/v1/remember/batch', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-Theo-User-Id': 'edge-user-1' },
        body: JSON.stringify({
          items: [
            { text: 'no-tier-a', infer: false }, // ← tier-less: previously 422'd the WHOLE batch
            { text: 'no-tier-b', infer: false },
          ],
        }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { imported: number; failed: number };
    expect(body.imported).toBe(2);
    expect(body.failed).toBe(0);
    expect(userIds).toEqual(['edge-user-1', 'edge-user-1']); // bound to the trusted header, per item
  });

  test('without an edge header a tier-less item still fails closed (422 INVALID_SCOPE)', async () => {
    const app = createServer({ memory: memoryThatFailsOn('never') });
    const res = await app.fetch(
      new Request('http://localhost/v1/remember/batch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items: [{ text: 'no-tier', infer: false }] }),
      }),
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as { code: string }).code).toBe('INVALID_SCOPE');
  });
});
