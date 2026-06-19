/**
 * dashboard-phase2b-skills-browse T2.1 — GET /v1/scopes/skill/:repoId/skills.
 *
 * Read-only skills listing. Asserts the DTO shape, empty-repo {skills:[]},
 * EC-1 workspace-resolution parity (skills resolved via the workspace-bound
 * Memory), and EC-4 truncation disclosure at the topK cap.
 */
import type { Memory, Skill } from '@usetheo/memory/contract';
import { describe, expect, test, vi } from 'vitest';

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

  test('EC-4: when getAll returns exactly the cap, the response discloses truncation', async () => {
    const cap = 2;
    const app = createServer({ memory: stubMemory([makeSkill('s1'), makeSkill('s2')]) });
    const res = await app.fetch(
      new Request(`http://localhost/v1/scopes/skill/acme/skills?topK=${cap}`),
    );
    const body = (await res.json()) as { skills: unknown[]; truncated?: boolean };
    expect(body.skills).toHaveLength(2);
    expect(body.truncated).toBe(true);
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
