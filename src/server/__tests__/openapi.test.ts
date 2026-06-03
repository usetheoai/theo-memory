/**
 * T1.4 RED — OpenAPI 3.1 spec auto-derived from zod schemas via
 * @hono/zod-openapi. Spec exposed at GET /v1/openapi.json AUTH-EXEMPT
 * (EC-19 per RFC 6750 + OWASP REST cheatsheet — codegen tools fetch spec
 * before having credentials).
 *
 * @see Plan theo-memory-standalone-p0 § T1.4 + ADR D1 (Hono) + ADR D14
 *      (@hono/zod-openapi pinned at ^0.18.0)
 */
import SwaggerParser from '@apidevtools/swagger-parser';
import { describe, expect, test, vi } from 'vitest';

import type { Memory } from '../../core/memory-store.js';
import { createServer } from '../index.js';

function stubMemory(): Memory {
  const stub = {
    user: vi.fn(),
    session: vi.fn(),
    agent: vi.fn(),
    skills: vi.fn(),
    forget: vi.fn(),
    get: vi.fn(),
    history: vi.fn(),
    reset: vi.fn(),
    flushReflections: vi.fn(),
  };
  return stub;
}

describe('T1.4 — GET /v1/openapi.json', () => {
  test('1. returns valid OpenAPI 3.1 spec (swagger-parser validates)', async () => {
    const app = createServer({ memory: stubMemory() });
    const res = await app.fetch(new Request('http://localhost/v1/openapi.json'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/json/);
    const spec = (await res.json()) as Record<string, unknown>;
    expect(spec['openapi']).toMatch(/^3\.1/);
    // Validate against OpenAPI 3.1 spec via swagger-parser.
     
    const clone = JSON.parse(JSON.stringify(spec)) as unknown;
    await expect(SwaggerParser.validate(clone as Parameters<typeof SwaggerParser.validate>[0])).resolves.toBeDefined();
     
  });

  test('2. accessible WITHOUT bearer token even when THEMEMORY_API_KEY set (EC-19)', async () => {
    process.env['THEMEMORY_API_KEY'] = 'sk-secret';
    const app = createServer({ memory: stubMemory() });
    const res = await app.fetch(new Request('http://localhost/v1/openapi.json'));
    delete process.env['THEMEMORY_API_KEY'];
    expect(res.status).toBe(200);
  });

  test('3. spec lists all 6 operations with stable operationId', async () => {
    const app = createServer({ memory: stubMemory() });
    const res = await app.fetch(new Request('http://localhost/v1/openapi.json'));
    interface PathItem { post?: { operationId?: string }; get?: { operationId?: string } }
    interface Spec { paths: Record<string, PathItem> }
    const spec = (await res.json()) as Spec;
    const operationIds: string[] = [];
    for (const [, item] of Object.entries(spec.paths ?? {})) {
      if (item.post?.operationId !== undefined) operationIds.push(item.post.operationId);
      if (item.get?.operationId !== undefined) operationIds.push(item.get.operationId);
    }
    expect(operationIds).toContain('remember');
    expect(operationIds).toContain('recall');
    expect(operationIds).toContain('forget');
    expect(operationIds).toContain('reflect');
    expect(operationIds).toContain('getHealth');
    expect(operationIds).toContain('listScopeMemories');
  });

  test('4. spec advertises license MIT', async () => {
    const app = createServer({ memory: stubMemory() });
    const res = await app.fetch(new Request('http://localhost/v1/openapi.json'));
    interface Spec { info: { license?: { name: string } } }
    const spec = (await res.json()) as Spec;
    expect(spec.info.license?.name).toBe('MIT');
  });

  test('7. FC2-T1.3-RED — all 4 verbs advertise 413 CONTENT_TOO_LARGE (F-dom-api-2 absorption)', async () => {
    const app = createServer({ memory: stubMemory() });
    const res = await app.fetch(new Request('http://localhost/v1/openapi.json'));
    interface Op { responses?: Record<string, { description?: string }> }
    interface PathItem { post?: Op }
    interface Spec { paths: Record<string, PathItem> }
    const spec = (await res.json()) as Spec;
    for (const verb of ['/v1/remember', '/v1/recall', '/v1/forget', '/v1/reflect']) {
      const responses = spec.paths[verb]?.post?.responses;
      expect(responses?.['413']).toBeDefined();
      expect(responses?.['413']?.description).toMatch(/1\s*MB|body|content too large/i);
    }
  });

  test('6. FC2-T1.2-RED — listScopeMemories advertises 501 SKILL_LISTING_NOT_IMPLEMENTED (F-dom-api-1 absorption)', async () => {
    const app = createServer({ memory: stubMemory() });
    const res = await app.fetch(new Request('http://localhost/v1/openapi.json'));
    interface Op { responses?: Record<string, { description?: string }> }
    interface PathItem { get?: Op }
    interface Spec { paths: Record<string, PathItem> }
    const spec = (await res.json()) as Spec;
    const responses = spec.paths['/v1/scopes/{type}/{id}/memories']?.get?.responses;
    expect(responses?.['501']).toBeDefined();
    expect(responses?.['501']?.description).toMatch(/skill/i);
    expect(responses?.['501']?.description).toMatch(/ADR-0010|SDK-only|not implemented/i);
  });

  test('5. FC1-T1.1 EC-5 — skillRepoId absent from all 4 verb request bodies (F-rev-1 absorption)', async () => {
    const app = createServer({ memory: stubMemory() });
    const res = await app.fetch(new Request('http://localhost/v1/openapi.json'));
    interface Schema { properties?: Record<string, unknown> }
    interface RequestBody { content?: { 'application/json'?: { schema?: Schema } } }
    interface Op { requestBody?: RequestBody }
    interface PathItem { post?: Op }
    interface Spec { paths: Record<string, PathItem> }
    const spec = (await res.json()) as Spec;
    for (const verb of ['/v1/remember', '/v1/recall', '/v1/reflect', '/v1/forget']) {
      const props = spec.paths[verb]?.post?.requestBody?.content?.['application/json']?.schema?.properties;
      if (props !== undefined) {
        expect(Object.keys(props)).not.toContain('skillRepoId');
      }
    }
  });
});
