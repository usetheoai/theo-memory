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
import type { Memory } from '@usetheo/memory/contract';
import { describe, expect, test, vi } from 'vitest';

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
    listSkillsBySubject: vi.fn().mockResolvedValue({ skills: [], total: 0 }),  };
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

  test('durable job operations and evidence pagination are discoverable with their wire fields', async () => {
    const app = createServer({memory: stubMemory()});
    const response = await app.fetch(new Request('http://localhost/v1/openapi.json'));
    const spec = await response.json() as {paths: Record<string, {post?: {operationId: string}; get?: {operationId: string}}>};
    expect(spec.paths['/v1/memory-jobs']?.post?.operationId).toBe('submitMemoryJob');
    expect(spec.paths['/v1/memory-jobs/{jobId}']?.get?.operationId).toBe('getMemoryJob');
    expect(spec.paths['/v1/memory-jobs/{jobId}/retry']?.post?.operationId).toBe('retryMemoryJob');
    expect(spec.paths['/v1/scopes/{type}/{id}/memories/{memoryId}/evidence']?.get?.operationId).toBe('listMemoryEvidence');
    const json = JSON.stringify(spec);
    for (const property of ['Idempotency-Key','originSourceId','distinctSourceCount','expiresAt','nextOffset','idempotentReplay']) {
      expect(json).toContain(property);
    }
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

  test('rest-graph-aware-recall — /v1/recall request schema advertises graphExpand (auto-derive regression)', async () => {
    const app = createServer({ memory: stubMemory() });
    const res = await app.fetch(new Request('http://localhost/v1/openapi.json'));
    const spec = (await res.json()) as Record<string, unknown>;
    // The recall request body schema must include the graphExpand property
    // (auto-derived from RecallBody). Serialize + assert the key is present.
    const json = JSON.stringify(spec);
    expect(json).toContain('graphExpand');
  });

  test('explainable-recall-read S2 — spec advertises recallId + the recall-traces read path', async () => {
    const app = createServer({ memory: stubMemory() });
    const res = await app.fetch(new Request('http://localhost/v1/openapi.json'));
    const json = JSON.stringify(await res.json());
    // The recall response gained recallId (T2.1) and the read endpoint is registered (T4.1).
    expect(json).toContain('recallId');
    expect(json).toContain('/v1/recall-traces/{recallId}');
    expect(json).toContain('getRecallTrace');
  });

  test('4. spec advertises license MIT', async () => {
    const app = createServer({ memory: stubMemory() });
    const res = await app.fetch(new Request('http://localhost/v1/openapi.json'));
    interface Spec { info: { license?: { name: string } } }
    const spec = (await res.json()) as Spec;
    expect(spec.info.license?.name).toBe('MIT');
  });

  test('8. FC2-T1.4-RED — ScopeTypeEnum description documents 501-for-skill semantic (F-arch-2 + F-dom-api-6 absorption)', async () => {
    const app = createServer({ memory: stubMemory() });
    const res = await app.fetch(new Request('http://localhost/v1/openapi.json'));
    interface Param { name?: string; description?: string; schema?: { description?: string } }
    interface Op { parameters?: Param[] }
    interface PathItem { get?: Op }
    interface Spec { paths: Record<string, PathItem> }
    const spec = (await res.json()) as Spec;
    const params = spec.paths['/v1/scopes/{type}/{id}/memories']?.get?.parameters ?? [];
    const typeParam = params.find((p) => p.name === 'type');
    // EC-1 absorption: zod-to-openapi may put .describe() at Parameter Object
    // level OR Schema Object level depending on version. Walk BOTH paths via
    // fallback chain. Both are OpenAPI 3.1-conformant; both equally satisfy
    // the F-arch-2 / F-dom-api-6 honesty intent.
    const descr = typeParam?.description ?? typeParam?.schema?.description;
    expect(descr).toBeDefined();
    expect(descr).toMatch(/501|SDK-only/);
    expect(descr).toMatch(/skill/i);
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
