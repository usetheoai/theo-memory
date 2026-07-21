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
      errors?: { index: number; message: string }[];
    };
    expect(body.imported).toBe(2);
    expect(body.failed).toBe(1);
    expect(body.errors?.[0]?.index).toBe(1);
    expect(body.errors?.[0]?.message).toContain('poison');
  });
});
