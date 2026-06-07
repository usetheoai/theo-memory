/**
 * T2.3 RED tests — `themory keys` subcommand orchestrator.
 *
 * Plan: `theo-memory-faang-auth-lifecycle` § T2.3.
 *
 * @see .claude/knowledge-base/plans/theo-memory-faang-auth-lifecycle-plan.md § T2.3
 */
import { describe, expect, test, vi } from 'vitest';

import { runKeysCreate, runKeysList, runKeysRevoke, runKeysRotate } from '../run-keys.js';

function makeCtx(opts: {
  fetchResponse?: { status: number; body: unknown };
  fetchThrows?: Error;
}): {
  ctx: Parameters<typeof runKeysCreate>[0];
  stdout: string[];
  stderr: string[];
  fetchCalls: { url: string; init?: RequestInit }[];
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const fetchCalls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = vi.fn((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    // exactOptionalPropertyTypes — omit `init` key entirely when undefined
    // so the recorded entry matches the optional-only shape `{ url; init? }`.
    fetchCalls.push(init === undefined ? { url } : { url, init });
    if (opts.fetchThrows) return Promise.reject(opts.fetchThrows);
    const r = opts.fetchResponse ?? { status: 200, body: {} };
    // 204 No Content per RFC 9110 § 15.3.5 MUST NOT have a body — Response
    // ctor throws when given one. Use null body for 204.
    if (r.status === 204) {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    return Promise.resolve(
      new Response(typeof r.body === 'string' ? r.body : JSON.stringify(r.body), { status: r.status }),
    );
  }) as unknown as typeof fetch;
  return {
    ctx: {
      baseUrl: 'http://localhost:3000',
      bearerToken: 'theo_live_admin_test',
      fetchImpl,
      writeStdout: (s) => stdout.push(s),
      writeStderr: (s) => stderr.push(s),
    },
    stdout,
    stderr,
    fetchCalls,
  };
}

describe('runKeysCreate', () => {
  test('1. POSTs /v1/admin/keys with name + scopes + Bearer auth + prints secret + warning', async () => {
    const { ctx, stdout, fetchCalls } = makeCtx({
      fetchResponse: {
        status: 200,
        body: {
          id: 'apk-1111111111111111',
          name: 'prod-agent',
          key_prefix: 'theo_live_Ab',
          scopes: ['memory:read'],
          secret: 'theo_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        },
      },
    });
    const code = await runKeysCreate(ctx, { name: 'prod-agent', scopes: ['memory:read'] });
    expect(code).toBe(0);
    expect(fetchCalls[0]?.url).toBe('http://localhost:3000/v1/admin/keys');
    expect(fetchCalls[0]?.init?.method).toBe('POST');
    expect((fetchCalls[0]?.init?.headers as Record<string, string>)?.['Authorization']).toBe('Bearer theo_live_admin_test');
    // Show-once warning printed
    const joined = stdout.join('');
    expect(joined).toContain('theo_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
    expect(joined).toContain('NEVER be shown again');
  });

  test('5. on HTTP 400 from server, prints stderr + returns exit 1', async () => {
    const { ctx, stderr } = makeCtx({
      fetchResponse: { status: 400, body: { code: 'EMPTY_NAME', message: 'API key name is required.' } },
    });
    const code = await runKeysCreate(ctx, { name: '', scopes: ['memory:read'] });
    expect(code).toBe(1);
    expect(stderr.join('')).toContain('HTTP 400');
  });
});

describe('runKeysList', () => {
  test('2. GETs /v1/admin/keys/list with Bearer auth and prints one row per key', async () => {
    const { ctx, stdout, fetchCalls } = makeCtx({
      fetchResponse: {
        status: 200,
        body: {
          keys: [
            {
              id: 'apk-1111111111111111',
              name: 'prod-agent',
              key_prefix: 'theo_live_Ab',
              scopes: ['memory:read'],
              created_at: '2026-06-07T10:00:00Z',
              last_used_at: null,
            },
          ],
        },
      },
    });
    const code = await runKeysList(ctx);
    expect(code).toBe(0);
    expect(fetchCalls[0]?.url).toBe('http://localhost:3000/v1/admin/keys/list');
    expect(fetchCalls[0]?.init?.method).toBe('GET');
    const joined = stdout.join('');
    expect(joined).toContain('apk-1111111111111111');
    expect(joined).toContain('theo_live_Ab');
    expect(joined).toContain('prod-agent');
    expect(joined).toContain('memory:read');
  });
});

describe('runKeysRevoke', () => {
  test('3. DELETEs /v1/admin/keys/{id} and prints success on 204', async () => {
    const { ctx, stdout, fetchCalls } = makeCtx({
      fetchResponse: { status: 204, body: '' },
    });
    const code = await runKeysRevoke(ctx, 'apk-2222222222222222');
    expect(code).toBe(0);
    expect(fetchCalls[0]?.url).toBe('http://localhost:3000/v1/admin/keys/apk-2222222222222222');
    expect(fetchCalls[0]?.init?.method).toBe('DELETE');
    expect(stdout.join('')).toContain('Revoked apk-2222222222222222');
  });
});

describe('runKeysRotate', () => {
  test('4. POSTs /v1/admin/keys/{id}/rotate and prints new secret + grace window', async () => {
    const { ctx, stdout, fetchCalls } = makeCtx({
      fetchResponse: {
        status: 200,
        body: {
          id: 'apk-3333333333333333',
          old_id: 'apk-2222222222222222',
          secret: 'theo_live_newrotatedsecret_yyyyyyyyyyyyyyyyyyyyyyyy',
          grace_window_hours: 24,
        },
      },
    });
    const code = await runKeysRotate(ctx, 'apk-2222222222222222');
    expect(code).toBe(0);
    expect(fetchCalls[0]?.url).toBe('http://localhost:3000/v1/admin/keys/apk-2222222222222222/rotate');
    expect(fetchCalls[0]?.init?.method).toBe('POST');
    const joined = stdout.join('');
    expect(joined).toContain('Rotated apk-2222222222222222 -> apk-3333333333333333');
    expect(joined).toContain('Grace window: 24h');
    expect(joined).toContain('theo_live_newrotatedsecret');
  });
});
