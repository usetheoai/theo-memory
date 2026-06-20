/**
 * entity-relation-extraction-slice2 T3.1 — graphHandler composes nodes (via the
 * MemoryEntityStore.list port) + edges (via the MemoryGraphStore.listEdges port)
 * into `{nodes, edges}`. D6: when the graph store is absent, edges = [] (nodes
 * still served). Invalid scope type → 404.
 *
 * @see .claude/knowledge-base/plans/entity-relation-extraction-slice2-plan.md § T3.1
 */
import type { EntityNodeSummary, EdgeSummary, Memory } from '@usetheo/memory/contract';
import { describe, expect, test, vi } from 'vitest';

import { createServer } from '../index.js';

function stubMemory(): Memory {
  const scoped = {
    getAll: vi.fn().mockResolvedValue([]),
    remember: vi.fn(), recall: vi.fn(), forget: vi.fn(), history: vi.fn(),
  };
  const base = {
    user: vi.fn().mockReturnValue(scoped),
    session: vi.fn().mockReturnValue(scoped),
    agent: vi.fn().mockReturnValue(scoped),
    skills: vi.fn(), forget: vi.fn(), get: vi.fn(), history: vi.fn(), reset: vi.fn(), flushReflections: vi.fn(),
  } as unknown as Memory;
  (base as unknown as { withWorkspace: (ws: string) => Memory }).withWorkspace = vi.fn().mockReturnValue(base);
  return base;
}

const nodes: EntityNodeSummary[] = [
  { id: 'e1', name: 'John Smith', type: 'PROPER', memoryCount: 2, lastSeenAt: '2026-06-03T00:00:00.000Z' },
  { id: 'e2', name: 'Google', type: 'PROPER', memoryCount: 1, lastSeenAt: '2026-06-01T00:00:00.000Z' },
];
const edges: EdgeSummary[] = [{ source: 'John Smith', relation: 'works at', target: 'Google', memoryCount: 1 }];

describe('T3.1 — graphHandler {nodes, edges}', () => {
  test('graph_returns_nodes_and_edges', async () => {
    const app = createServer({
      memory: stubMemory(),
      memoryEntityStore: { upsertAndLink: vi.fn(), list: vi.fn().mockResolvedValue(nodes) },
      memoryGraphStore: { upsertEdges: vi.fn(), listEdges: vi.fn().mockResolvedValue(edges) },
    });
    const res = await app.fetch(new Request('http://localhost/v1/scopes/user/alice/graph'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { nodes: { id: string }[]; edges: { source: string; target: string }[] };
    expect(body.nodes.length).toBeGreaterThan(0);
    expect(body.edges.length).toBeGreaterThan(0);
    expect(body.edges[0]?.source).toBe('John Smith');
  });

  test('graph_empty_edges_when_graph_store_absent (D6)', async () => {
    const app = createServer({
      memory: stubMemory(),
      memoryEntityStore: { upsertAndLink: vi.fn(), list: vi.fn().mockResolvedValue(nodes) },
      // no memoryGraphStore
    });
    const res = await app.fetch(new Request('http://localhost/v1/scopes/user/alice/graph'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { edges: unknown[] };
    expect(body.edges).toEqual([]);
  });

  test('graph_invalid_scope_type_404', async () => {
    const app = createServer({
      memory: stubMemory(),
      memoryEntityStore: { upsertAndLink: vi.fn(), list: vi.fn().mockResolvedValue([]) },
      memoryGraphStore: { upsertEdges: vi.fn(), listEdges: vi.fn().mockResolvedValue([]) },
    });
    const res = await app.fetch(new Request('http://localhost/v1/scopes/bogus/alice/graph'));
    expect(res.status).toBe(404);
  });
});
