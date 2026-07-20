/**
 * M6 T1.1 — auth-exempt build/version + healthz alias routes.
 *
 * - `GET /v1/version` reports package identity + env-driven build provenance.
 * - `GET /v1/healthz` + `/v1/healthz/ready` alias the existing health pair.
 *
 * Mirrors health.test.ts (createServer from ../index.js + noopMemory helper).
 * A `hit()` helper factors the createServer+fetch boilerplate so the quality
 * gate's duplicate-block check does not fire.
 *
 * @see Plan claude-code-memory-integration-plan § M6 T1.1
 */
import type { Memory } from '@usetheo/memory/contract';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { createServer } from '../index.js';

function noopMemory(): Memory {
  return {
    user: vi.fn(),
    session: vi.fn(),
    agent: vi.fn(),
    skills: vi.fn(),
    forget: vi.fn(),
    get: vi.fn(),
    history: vi.fn(),
    reset: vi.fn(),
    flushReflections: vi.fn(),
    listSkillsBySubject: vi.fn().mockResolvedValue({ skills: [], total: 0 }),  };
}

async function hit(path: string, dbProbe?: () => Promise<void>): Promise<Response> {
  const app = createServer(
    dbProbe ? { memory: noopMemory(), dbProbe } : { memory: noopMemory() },
  );
  return app.fetch(new Request(`http://localhost${path}`));
}

const VERSION_ENV = ['THEOMEM_VERSION', 'THEOMEM_GIT_SHA', 'THEOMEM_BUILD_TIME'] as const;

describe('M6 T1.1 — GET /v1/version', () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const k of VERSION_ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test('1. returns 200 with env-driven version envelope + live node', async () => {
    process.env['THEOMEM_VERSION'] = '9.9.9';
    process.env['THEOMEM_GIT_SHA'] = 'abcdef0';
    process.env['THEOMEM_BUILD_TIME'] = '2026-07-20T00:00:00Z';
    const res = await hit('/v1/version');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, string>;
    expect(body).toMatchObject({
      name: '@usetheo/memory',
      version: '9.9.9',
      git_sha: 'abcdef0',
      built_at: '2026-07-20T00:00:00Z',
    });
    expect(body['node']).toMatch(/^v\d+/);
  });
});

describe('M6 T1.1 — GET /v1/healthz aliases', () => {
  test('2. healthz returns 200 { status: "ok" }', async () => {
    const res = await hit('/v1/healthz');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('ok');
  });

  test('3. healthz/ready returns 200 when dbProbe resolves', async () => {
    const res = await hit('/v1/healthz/ready', vi.fn().mockResolvedValue(undefined));
    expect(res.status).toBe(200);
  });

  test('4. healthz/ready returns 503 when dbProbe NOT wired', async () => {
    const res = await hit('/v1/healthz/ready');
    expect(res.status).toBe(503);
  });
});
