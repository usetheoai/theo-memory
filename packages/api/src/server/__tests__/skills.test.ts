/**
 * dashboard-phase2b-skills-browse T2.1 — GET /v1/scopes/skill/:repoId/skills.
 *
 * Read-only skills listing. Asserts the DTO shape, empty-repo {skills:[]},
 * EC-1 workspace-resolution parity (skills resolved via the workspace-bound
 * Memory), and EC-4 truncation disclosure at the topK cap.
 */
import type { Memory, Skill } from '@usetheo/memory/contract';
import { describe, expect, test, vi } from 'vitest';

import { SkillAlreadyExists, MemoryNotFound } from '@usetheo/memory/contract';
import { createServer } from '../index.js';

function makeSkill(id: string, opts?: Partial<Skill>): Skill {
  return {
    id,
    text: `skill-${id}`,
    hash: `h-${id}`,
    scope: { kind: 'repo', repoId: 'acme' },
    createdAt: new Date('2026-06-01T00:00:00Z'),
    updatedAt: new Date('2026-06-01T00:00:00Z'),
    metadata: { kind: 'skill' },
    kind: 'skill',
    code: `code-${id}`,
    description: `does ${id}`,
    codeLanguage: 'typescript',
    supersededBy: null,
    derivedFrom: [],
    ...opts,
  } as unknown as Skill;
}

function stubMemory(skills: readonly Skill[], onWithWorkspace?: (ws: string) => void): Memory {
  const scopedSkill = {
    getAll: vi.fn().mockResolvedValue(skills),
    add: vi.fn(),
    recall: vi.fn(),
    consolidate: vi.fn(),
    forget: vi.fn(),
  };
  const base = {
    user: vi.fn(),
    session: vi.fn(),
    agent: vi.fn(),
    skills: vi.fn().mockReturnValue(scopedSkill),
    forget: vi.fn(),
    get: vi.fn(),
    history: vi.fn(),
    reset: vi.fn(),
    flushReflections: vi.fn(),
  } as unknown as Memory;
  // EC-1: withWorkspace returns a memory whose skills() is the same stub, but
  // we record the call so the test can assert the workspace-bound path is used.
  (base as unknown as { withWorkspace: (ws: string) => Memory }).withWorkspace = vi
    .fn()
    .mockImplementation((ws: string) => {
      onWithWorkspace?.(ws);
      return base;
    });
  return base;
}

describe('T2.1 — GET /v1/scopes/skill/:repoId/skills', () => {
  test('returns the repo skills in the documented DTO shape', async () => {
    const app = createServer({ memory: stubMemory([makeSkill('s1'), makeSkill('s2')]) });
    const res = await app.fetch(new Request('http://localhost/v1/scopes/skill/acme/skills'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      skills: {
        id: string;
        hash: string;
        description: string;
        code: string | null;
        codeLanguage: string | null;
        createdAt: string;
        derivedFrom: string[];
        supersededBy: string | null;
      }[];
    };
    expect(body.skills).toHaveLength(2);
    const s1 = body.skills.find((s) => s.id === 's1')!;
    expect(s1.hash).toBe('h-s1');
    expect(s1.description).toBe('does s1');
    expect(s1.code).toBe('code-s1');
    expect(s1.codeLanguage).toBe('typescript');
    expect(s1.createdAt).toBe('2026-06-01T00:00:00.000Z');
    expect(s1.derivedFrom).toEqual([]);
    expect(s1.supersededBy).toBeNull();
  });

  test('empty repo returns { skills: [] } (never null)', async () => {
    const app = createServer({ memory: stubMemory([]) });
    const res = await app.fetch(new Request('http://localhost/v1/scopes/skill/empty/skills'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { skills: unknown[] };
    expect(body.skills).toEqual([]);
  });

  test('EC-1: resolves skills via the workspace-bound Memory (withWorkspace path)', async () => {
    let boundWs: string | undefined;
    const memory = stubMemory([makeSkill('s1')], (ws) => {
      boundWs = ws;
    });
    const app = createServer({ memory });
    await app.fetch(new Request('http://localhost/v1/scopes/skill/acme/skills'));
    // The handler MUST route through workspaceBoundMemory → withWorkspace.
    expect(boundWs).toBeDefined();
  });

  test('EC-4: truncation disclosed when MORE than topK skills exist (over-fetch topK+1)', async () => {
    const cap = 2;
    // 3 skills exist; topK=2 → over-fetch 3, truncated, page sliced to 2.
    const app = createServer({
      memory: stubMemory([makeSkill('s1'), makeSkill('s2'), makeSkill('s3')]),
    });
    const res = await app.fetch(
      new Request(`http://localhost/v1/scopes/skill/acme/skills?topK=${cap}`),
    );
    const body = (await res.json()) as { skills: unknown[]; truncated?: boolean };
    expect(body.skills).toHaveLength(2);
    expect(body.truncated).toBe(true);
  });

  test('EC-4: exactly topK skills (no tail) reports truncated:false (no false positive)', async () => {
    const cap = 2;
    // Exactly 2 skills; topK=2 → over-fetch 3 returns only 2 → NOT truncated.
    const app = createServer({ memory: stubMemory([makeSkill('s1'), makeSkill('s2')]) });
    const res = await app.fetch(
      new Request(`http://localhost/v1/scopes/skill/acme/skills?topK=${cap}`),
    );
    const body = (await res.json()) as { skills: unknown[]; truncated?: boolean };
    expect(body.skills).toHaveLength(2);
    expect(body.truncated).toBe(false);
  });

  test('OpenAPI documents GET /v1/scopes/skill/{repoId}/skills with a 200 schema', async () => {
    const app = createServer({ memory: stubMemory([]) });
    const res = await app.fetch(new Request('http://localhost/v1/openapi.json'));
    expect(res.status).toBe(200);
    const spec = (await res.json()) as {
      paths: Record<string, Record<string, { responses?: Record<string, unknown> }>>;
    };
    const path = spec.paths['/v1/scopes/skill/{repoId}/skills'];
    expect(path).toBeDefined();
    expect(path?.get?.responses?.['200']).toBeDefined();
  });

  test('D5: the generic memories endpoint still returns 501 for type=skill', async () => {
    const app = createServer({ memory: stubMemory([]) });
    const res = await app.fetch(new Request('http://localhost/v1/scopes/skill/acme/memories'));
    expect(res.status).toBe(501);
  });

  test('EC-2: a repoId with non-slash special chars resolves the segment (no route-miss)', async () => {
    const app = createServer({ memory: stubMemory([makeSkill('s1')]) });
    // The gateway namespaces repoId as `{subject}:{repoId}` (plan D3) and
    // url.PathEscapes it (T3.1). A dot/colon-bearing single segment must resolve.
    const res = await app.fetch(
      new Request('http://localhost/v1/scopes/skill/sub-123:org.repo/skills'),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { skills: unknown[] };
    expect(body.skills).toHaveLength(1);
  });
});


// Write-surface stub: lets each test program add()/forget() behavior.
function stubWriteMemory(opts: {
  add?: (d: unknown) => Promise<unknown>;
  forget?: (id: string) => Promise<void>;
}): Memory {
  const scopedSkill = {
    getAll: vi.fn().mockResolvedValue([]),
    add: vi.fn(opts.add ?? (async () => ({ id: 'new-id', hash: 'new-hash' }))),
    recall: vi.fn(),
    consolidate: vi.fn(),
    forget: vi.fn(opts.forget ?? (async () => undefined)),
  };
  const base = {
    user: vi.fn(), session: vi.fn(), agent: vi.fn(),
    skills: vi.fn().mockReturnValue(scopedSkill),
    forget: vi.fn(), get: vi.fn(), history: vi.fn(), reset: vi.fn(), flushReflections: vi.fn(),
  } as unknown as Memory;
  (base as unknown as { withWorkspace: (ws: string) => Memory }).withWorkspace = vi
    .fn().mockReturnValue(base);
  return base;
}

function postReq(repoId: string, body: unknown): Request {
  return new Request(`http://localhost/v1/scopes/skill/${repoId}/skills`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('T2.1 — POST /v1/scopes/skill/:repoId/skills', () => {
  const valid = { code: 'export const x=1;', description: 'a skill', codeLanguage: 'typescript' };

  test('201 with {id,hash} on a valid SkillDraft', async () => {
    const app = createServer({ memory: stubWriteMemory({ add: async () => ({ id: 's1', hash: 'h1' }) }) });
    const res = await app.fetch(postReq('acme', valid));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; hash: string };
    expect(body.id).toBe('s1');
    expect(body.hash).toBe('h1');
  });

  test('409 when add throws SkillAlreadyExists', async () => {
    const app = createServer({
      memory: stubWriteMemory({ add: async () => { throw new SkillAlreadyExists('h1', 'acme'); } }),
    });
    const res = await app.fetch(postReq('acme', valid));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('SKILL_ALREADY_EXISTS');
  });

  test('422 on invalid codeLanguage and on empty description', async () => {
    const app = createServer({ memory: stubWriteMemory({}) });
    expect((await app.fetch(postReq('acme', { ...valid, codeLanguage: 'python' }))).status).toBe(422);
    expect((await app.fetch(postReq('acme', { ...valid, description: '' }))).status).toBe(422);
  });

  test('413 when code exceeds the byte cap', async () => {
    const app = createServer({ memory: stubWriteMemory({}) });
    const big = { ...valid, code: 'x'.repeat(64 * 1024 + 1) };
    expect((await app.fetch(postReq('acme', big))).status).toBe(413);
  });

  test('400 on empty repoId path / malformed body', async () => {
    const app = createServer({ memory: stubWriteMemory({}) });
    const malformed = new Request('http://localhost/v1/scopes/skill/acme/skills', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json',
    });
    expect((await app.fetch(malformed)).status).toBe(400);
  });

  test('OpenAPI documents POST + DELETE for skills', async () => {
    const app = createServer({ memory: stubWriteMemory({}) });
    const spec = (await (await app.fetch(new Request('http://localhost/v1/openapi.json'))).json()) as {
      paths: Record<string, Record<string, unknown>>;
    };
    expect(spec.paths['/v1/scopes/skill/{repoId}/skills']?.post).toBeDefined();
    expect(spec.paths['/v1/scopes/skill/{repoId}/skills/{skillId}']?.delete).toBeDefined();
  });
});

describe('T2.2 — DELETE /v1/scopes/skill/:repoId/skills/:skillId', () => {
  test('204 on successful forget', async () => {
    const app = createServer({ memory: stubWriteMemory({ forget: async () => undefined }) });
    const res = await app.fetch(new Request('http://localhost/v1/scopes/skill/acme/skills/s1', { method: 'DELETE' }));
    expect(res.status).toBe(204);
  });

  test('404 when forget throws MemoryNotFound (cross-repo/non-existent)', async () => {
    const app = createServer({
      memory: stubWriteMemory({ forget: async () => { throw new MemoryNotFound('s1'); } }),
    });
    const res = await app.fetch(new Request('http://localhost/v1/scopes/skill/acme/skills/s1', { method: 'DELETE' }));
    expect(res.status).toBe(404);
  });
});
