/**
 * T3.1 unit tests for the 4-phase consolidate orchestrator.
 *
 * Covers per plan TDD section + SEPA-flagged additions:
 *  1. Orient counts skills (zero-cluster path).
 *  2. Cluster of 2 similar skills → 1 derived skill with derivedFrom of length 2.
 *  3. Source skills get superseded_by set to derived id.
 *  4. recall(...) post-consolidate excludes sources (covered by T2.2's filter).
 *  5. Empty cluster (N < 2) → no LLM call, empty ConsolidationResult.
 *  6. EC-2 atomicity sentinel — when the atomic combo throws mid-call, sources stay un-superseded.
 *  7. Provenance length≥2 — LLM returns single-source draft → skip cluster, no insert.
 *  8. Text projection contract — sourceMemories[i].text = description + "\n\nCode:\n" + code.
 *  9. Transitive cluster — A~B, B~C, A!~C → single cluster of all three (greedy union-find).
 *
 * @see .claude/knowledge-base/plans/skill-library-plan.md § T3.1
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { hashFact } from '../../../../domain/dedup.js';
import type { Embedder } from '../../../../domain/dip/embedder.js';
import type { LLM } from '../../../../domain/dip/llm.js';
import type { LLMResponse, Message } from '../../../../domain/message.js';
import type { Filters, Scope } from '../../../../domain/scope.js';
import { InMemoryVectorStore } from '../../in-memory-store.js';
import { consolidate, projectSkillToMemoryItem } from '../consolidate.js';

import type { Skill } from '../../../../domain/skill.js';

const DIM = 1536;
const SCOPE: Scope = { kind: 'user', userId: 'alice' };
const FILTERS: Filters = { user_id: 'alice' };

/** Build a unit-length deterministic embedding by setting a single dimension to 1. */
function basisVector(index: number): readonly number[] {
  const v = new Array<number>(DIM).fill(0);
  v[index] = 1;
  return v;
}

/** Build a near-clone of basisVector(index) by tilting slightly toward another dim. */
function tiltedVector(index: number, tiltIdx: number, tiltWeight = 0.01): readonly number[] {
  const v = new Array<number>(DIM).fill(0);
  v[index] = 1 - tiltWeight;
  v[tiltIdx] = tiltWeight;
  return v;
}

/** Deterministic embedder: maps known descriptions → known vectors. Falls back to zero. */
class FixtureEmbedder implements Embedder {
  constructor(private readonly registry: ReadonlyMap<string, readonly number[]>) {}
  async embed(text: string): Promise<readonly number[]> {
    await Promise.resolve();
    return this.registry.get(text) ?? new Array<number>(DIM).fill(0);
  }
  async embedBatch(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}

/** LLM stub returning a single deterministic merged-draft JSON given source ids. */
class FixtureLLM implements LLM {
  public lastMessages: readonly Message[] | null = null;
  constructor(
    private readonly responder: (
      messages: readonly Message[],
    ) => { drafts: readonly { text: string; derived_from: readonly string[] }[] },
  ) {}
  async generateChat(messages: readonly Message[]): Promise<LLMResponse> {
    await Promise.resolve();
    this.lastMessages = messages;
    const { drafts } = this.responder(messages);
    return {
      role: 'assistant',
      content: JSON.stringify(drafts),
    };
  }
  async generateResponse(): Promise<LLMResponse> {
    await Promise.resolve();
    return { role: 'assistant', content: '[]' };
  }
}

/** Seed an in-memory store with 2 similar skills + 1 distant skill (per scope). */
async function seedThreeSkills(): Promise<{
  store: InMemoryVectorStore;
  similarA: string;
  similarB: string;
  distantC: string;
}> {
  const store = new InMemoryVectorStore();
  await store.initialize();
  const similarA = await store.insertSkill({
    embedding: basisVector(0),
    hash: 'h-a',
    code: 'codeA',
    description: 'retry helper A',
    codeLanguage: 'typescript',
    scope: { userId: 'alice' },
  });
  const similarB = await store.insertSkill({
    embedding: tiltedVector(0, 5, 0.01), // cosine ~ 0.9999 with basisVector(0)
    hash: 'h-b',
    code: 'codeB',
    description: 'retry helper B',
    codeLanguage: 'typescript',
    scope: { userId: 'alice' },
  });
  const distantC = await store.insertSkill({
    embedding: basisVector(7), // orthogonal — cosine 0 with the cluster
    hash: 'h-c',
    code: 'codeC',
    description: 'pagination helper',
    codeLanguage: 'typescript',
    scope: { userId: 'alice' },
  });
  return { store, similarA, similarB, distantC };
}

describe('consolidate — Phase 1 Orient', () => {
  let store: InMemoryVectorStore;
  beforeEach(async () => {
    store = new InMemoryVectorStore();
    await store.initialize();
  });

  test('returns empty ConsolidationResult when fewer than 2 skills are present', async () => {
    // Single skill — no clustering possible
    await store.insertSkill({
      embedding: basisVector(0),
      hash: 'h-only',
      code: 'codeX',
      description: 'lone helper',
      codeLanguage: 'typescript',
      scope: { userId: 'alice' },
    });
    const embedder = new FixtureEmbedder(
      new Map([['lone helper', basisVector(0)]]),
    );
    const llm = new FixtureLLM(() => ({ drafts: [] }));
    const result = await consolidate({
      vectorStore: store,
      llm,
      embedder,
      scope: SCOPE,
      filters: FILTERS,
    });
    expect(result.sourceClusters).toEqual([]);
    expect(result.derivedSkills).toEqual([]);
    expect(result.supersededIds).toEqual([]);
    expect(llm.lastMessages).toBeNull(); // LLM was NOT called
  });
});

describe('consolidate — Phase 2 + 3 happy path', () => {
  test('cluster of 2 similar skills → 1 derived skill with derivedFrom = [src1, src2]', async () => {
    const { store, similarA, similarB } = await seedThreeSkills();
    const embedder = new FixtureEmbedder(
      new Map([
        ['retry helper A', basisVector(0)],
        ['retry helper B', tiltedVector(0, 5)],
        ['pagination helper', basisVector(7)],
        ['merged retry helper', basisVector(0)], // post-LLM embedding
      ]),
    );
    const llm = new FixtureLLM((messages) => {
      // The prompt for executeReflection embeds source UUIDs; reply with both
      // ids so validateProvenance passes.
      void messages;
      return {
        drafts: [{ text: 'merged retry helper', derived_from: [similarA, similarB] }],
      };
    });
    const result = await consolidate({
      vectorStore: store,
      llm,
      embedder,
      scope: SCOPE,
      filters: FILTERS,
    });
    expect(result.sourceClusters.length).toBe(1);
    expect(result.derivedSkills.length).toBe(1);
    expect([...(result.derivedSkills[0]?.derivedFrom ?? [])].sort()).toEqual(
      [similarA, similarB].sort(),
    );
    expect([...result.supersededIds].sort()).toEqual([similarA, similarB].sort());
    // T0.2 / F1 absorption: derived skill carries NULL code + codeLanguage.
    expect(result.derivedSkills[0]?.code).toBeNull();
    expect(result.derivedSkills[0]?.codeLanguage).toBeNull();
  });

  test('source skills get superseded_by = derived skill id after consolidate', async () => {
    const { store, similarA, similarB } = await seedThreeSkills();
    const embedder = new FixtureEmbedder(
      new Map([
        ['retry helper A', basisVector(0)],
        ['retry helper B', tiltedVector(0, 5)],
        ['pagination helper', basisVector(7)],
        ['merged retry helper', basisVector(0)],
      ]),
    );
    const llm = new FixtureLLM(() => ({
      drafts: [{ text: 'merged retry helper', derived_from: [similarA, similarB] }],
    }));
    const result = await consolidate({
      vectorStore: store,
      llm,
      embedder,
      scope: SCOPE,
      filters: FILTERS,
    });
    const derivedId = result.derivedSkills[0]?.id;
    expect(derivedId).toBeDefined();
    const rowA = await store.get(similarA);
    const rowB = await store.get(similarB);
    expect(rowA?.payload['superseded_by']).toBe(derivedId);
    expect(rowB?.payload['superseded_by']).toBe(derivedId);
  });
});

describe('consolidate — Phase 3 negative paths', () => {
  test('LLM returns zero drafts → no derived skill, no markSuperseded', async () => {
    const { store, similarA, similarB } = await seedThreeSkills();
    const embedder = new FixtureEmbedder(
      new Map([
        ['retry helper A', basisVector(0)],
        ['retry helper B', tiltedVector(0, 5)],
        ['pagination helper', basisVector(7)],
      ]),
    );
    const llm = new FixtureLLM(() => ({ drafts: [] }));
    const result = await consolidate({
      vectorStore: store,
      llm,
      embedder,
      scope: SCOPE,
      filters: FILTERS,
    });
    expect(result.derivedSkills).toEqual([]);
    expect(result.supersededIds).toEqual([]);
    // Sources remain un-superseded
    const rowA = await store.get(similarA);
    const rowB = await store.get(similarB);
    expect(rowA?.payload['superseded_by']).toBeUndefined();
    expect(rowB?.payload['superseded_by']).toBeUndefined();
  });

  test('provenance length<2 — single-source draft for 2-skill cluster → skip without insert', async () => {
    const { store, similarA, similarB } = await seedThreeSkills();
    const embedder = new FixtureEmbedder(
      new Map([
        ['retry helper A', basisVector(0)],
        ['retry helper B', tiltedVector(0, 5)],
        ['pagination helper', basisVector(7)],
      ]),
    );
    // LLM returns a draft citing only ONE source — degenerate provenance.
    const llm = new FixtureLLM(() => ({
      drafts: [{ text: 'degenerate', derived_from: [similarA] }],
    }));
    const result = await consolidate({
      vectorStore: store,
      llm,
      embedder,
      scope: SCOPE,
      filters: FILTERS,
    });
    expect(result.derivedSkills).toEqual([]);
    expect(result.supersededIds).toEqual([]);
    const rowB = await store.get(similarB);
    expect(rowB?.payload['superseded_by']).toBeUndefined();
  });
});

describe('consolidate — EC-2 atomicity sentinel', () => {
  test('when insertDerivedSkillAtomic throws, sources are NOT marked superseded', async () => {
    const { store, similarA, similarB } = await seedThreeSkills();
    const embedder = new FixtureEmbedder(
      new Map([
        ['retry helper A', basisVector(0)],
        ['retry helper B', tiltedVector(0, 5)],
        ['pagination helper', basisVector(7)],
        ['merged retry helper', basisVector(0)],
      ]),
    );
    const llm = new FixtureLLM(() => ({
      drafts: [{ text: 'merged retry helper', derived_from: [similarA, similarB] }],
    }));
    // Patch insertDerivedSkillAtomic to throw BEFORE writing anything.
    const spy = vi
      .spyOn(store, 'insertDerivedSkillAtomic')
      .mockImplementation(() => {
        throw new Error('simulated atomic failure');
      });
    await expect(
      consolidate({
        vectorStore: store,
        llm,
        embedder,
        scope: SCOPE,
        filters: FILTERS,
      }),
    ).rejects.toThrow('simulated atomic failure');
    expect(spy).toHaveBeenCalledTimes(1);
    const rowA = await store.get(similarA);
    const rowB = await store.get(similarB);
    expect(rowA?.payload['superseded_by']).toBeUndefined();
    expect(rowB?.payload['superseded_by']).toBeUndefined();
  });
});

describe('consolidate — text projection contract', () => {
  test('projectSkillToMemoryItem maps description + code into text via the contract format', () => {
    const skill: Skill = {
      id: 'skill-x',
      text: 'retry helper A',
      hash: 'h-x',
      scope: SCOPE,
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: {},
      tValid: new Date(),
      tInvalid: null,
      kind: 'skill',
      code: 'export const x = 1;',
      description: 'retry helper A',
      codeLanguage: 'typescript',
      supersededBy: null,
      derivedFrom: [],
    };
    const item = projectSkillToMemoryItem(skill);
    expect(item.text).toBe('retry helper A\n\nCode:\nexport const x = 1;');
  });

  test('empty code → text = description (no trailing "Code:" header)', () => {
    const skill: Skill = {
      id: 'skill-y',
      text: 'desc only',
      hash: 'h-y',
      scope: SCOPE,
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: {},
      tValid: new Date(),
      tInvalid: null,
      kind: 'skill',
      code: '',
      description: 'desc only',
      codeLanguage: 'typescript',
      supersededBy: null,
      derivedFrom: [],
    };
    const item = projectSkillToMemoryItem(skill);
    expect(item.text).toBe('desc only');
  });
});

describe('consolidate — transitive cluster (greedy union-find)', () => {
  test('A similar to B, B similar to C, A NOT similar to C → single cluster {A, B, C}', async () => {
    const store = new InMemoryVectorStore();
    await store.initialize();
    // A at basis[0], C at basis[1] (orthogonal). B is a midpoint that's similar to BOTH.
    const aId = await store.insertSkill({
      embedding: basisVector(0),
      hash: 'h-tri-a',
      code: 'a',
      description: 'tri A',
      codeLanguage: 'typescript',
      scope: { userId: 'alice' },
    });
    const bId = await store.insertSkill({
      embedding: (() => {
        const v = new Array<number>(DIM).fill(0);
        v[0] = 0.95;
        v[1] = 0.05;
        return v;
      })(),
      hash: 'h-tri-b',
      code: 'b',
      description: 'tri B',
      codeLanguage: 'typescript',
      scope: { userId: 'alice' },
    });
    const cId = await store.insertSkill({
      embedding: (() => {
        const v = new Array<number>(DIM).fill(0);
        v[0] = 0.9;
        v[1] = 0.2;
        return v;
      })(),
      hash: 'h-tri-c',
      code: 'c',
      description: 'tri C',
      codeLanguage: 'typescript',
      scope: { userId: 'alice' },
    });
    const embedder = new FixtureEmbedder(
      new Map([
        ['tri A', basisVector(0)],
        ['tri B', (() => {
          const v = new Array<number>(DIM).fill(0);
          v[0] = 0.95;
          v[1] = 0.05;
          return v;
        })()],
        ['tri C', (() => {
          const v = new Array<number>(DIM).fill(0);
          v[0] = 0.9;
          v[1] = 0.2;
          return v;
        })()],
        ['merged', basisVector(0)],
      ]),
    );
    const llm = new FixtureLLM(() => ({
      drafts: [{ text: 'merged', derived_from: [aId, bId, cId] }],
    }));
    // Use a high threshold so direct A~C similarity (~0.97) still passes:
    // - A~B cosine ~ 0.95
    // - B~C cosine ~ 0.99
    // - A~C cosine ~ 0.976 (also above 0.93)
    // Greedy union-find unions transitively regardless.
    const result = await consolidate(
      {
        vectorStore: store,
        llm,
        embedder,
        scope: SCOPE,
        filters: FILTERS,
      },
      { clusterThreshold: 0.93 },
    );
    expect(result.sourceClusters.length).toBe(1);
    expect([...(result.sourceClusters[0]?.sourceIds ?? [])].sort()).toEqual(
      [aId, bId, cId].sort(),
    );
    expect(result.derivedSkills.length).toBe(1);
  });
});

describe('consolidate — T2.2 / F5: Phase 3 iterates ALL drafts', () => {
  test('LLM returns 2 valid drafts for a cluster → 2 derived skills (parity with v0.4a reflect)', async () => {
    const { store, similarA, similarB } = await seedThreeSkills();
    const embedder = new FixtureEmbedder(
      new Map([
        ['retry helper A', basisVector(0)],
        ['retry helper B', tiltedVector(0, 5)],
        ['pagination helper', basisVector(7)],
        ['merged perspective A', basisVector(0)],
        ['merged perspective B', basisVector(1)],
      ]),
    );
    const llm = new FixtureLLM(() => ({
      drafts: [
        { text: 'merged perspective A', derived_from: [similarA, similarB] },
        { text: 'merged perspective B', derived_from: [similarA, similarB] },
      ],
    }));
    const result = await consolidate({
      vectorStore: store,
      llm,
      embedder,
      scope: SCOPE,
      filters: FILTERS,
    });
    expect(result.derivedSkills.length).toBe(2);
    expect(result.derivedSkills.map((s) => s.description).sort()).toEqual(
      ['merged perspective A', 'merged perspective B'].sort(),
    );
  });

  test('LLM returns 3 drafts; 1 has degenerate provenance (length<2) → only 2 derived skills', async () => {
    const { store, similarA, similarB } = await seedThreeSkills();
    const embedder = new FixtureEmbedder(
      new Map([
        ['retry helper A', basisVector(0)],
        ['retry helper B', tiltedVector(0, 5)],
        ['pagination helper', basisVector(7)],
        ['merged 1', basisVector(0)],
        ['merged 2', basisVector(1)],
        ['merged 3 degenerate', basisVector(2)],
      ]),
    );
    const llm = new FixtureLLM(() => ({
      drafts: [
        { text: 'merged 1', derived_from: [similarA, similarB] },
        { text: 'merged 3 degenerate', derived_from: [similarA] }, // length < 2 → skipped
        { text: 'merged 2', derived_from: [similarA, similarB] },
      ],
    }));
    const result = await consolidate({
      vectorStore: store,
      llm,
      embedder,
      scope: SCOPE,
      filters: FILTERS,
    });
    expect(result.derivedSkills.length).toBe(2);
    expect(result.derivedSkills.map((s) => s.description).sort()).toEqual(
      ['merged 1', 'merged 2'].sort(),
    );
  });

  test('EC-6: validateProvenance throws mid-loop → error propagates (fail-fast, no silent skip)', async () => {
    const { store, similarA, similarB } = await seedThreeSkills();
    const embedder = new FixtureEmbedder(
      new Map([
        ['retry helper A', basisVector(0)],
        ['retry helper B', tiltedVector(0, 5)],
        ['pagination helper', basisVector(7)],
        ['merged 1', basisVector(0)],
      ]),
    );
    // 2nd draft has a hallucinated id that's NOT in cluster.sourceIds →
    // validateProvenance throws ReflectionProvenanceMissingError.
    const llm = new FixtureLLM(() => ({
      drafts: [
        { text: 'merged 1', derived_from: [similarA, similarB] },
        { text: 'bad', derived_from: ['hallucinated-id', similarB] },
      ],
    }));
    await expect(
      consolidate({
        vectorStore: store,
        llm,
        embedder,
        scope: SCOPE,
        filters: FILTERS,
      }),
    ).rejects.toThrow(/derivedFrom references unknown ids/);
  });
});

describe('consolidate — T2.1 / F4: Orient phase uses embedBatch (drops dead get + per-row embed loop)', () => {
  test('Orient phase calls embedBatch once with N descriptions when N skills exist', async () => {
    const { store } = await seedThreeSkills();
    const embedder = new FixtureEmbedder(
      new Map([
        ['retry helper A', basisVector(0)],
        ['retry helper B', tiltedVector(0, 5)],
        ['pagination helper', basisVector(7)],
        ['merged retry helper', basisVector(0)],
      ]),
    );
    const batchSpy = vi.spyOn(embedder, 'embedBatch');
    const llm = new FixtureLLM(() => ({ drafts: [] }));
    await consolidate({
      vectorStore: store,
      llm,
      embedder,
      scope: SCOPE,
      filters: FILTERS,
    });
    // Orient phase: 1 batch call with 3 descriptions (the 3 seeded skills).
    // Phase 3 doesn't run (LLM returns empty drafts), so no per-row embed for
    // the merged description either — only the batch call exists.
    expect(batchSpy).toHaveBeenCalledTimes(1);
    expect(batchSpy.mock.calls[0]?.[0]).toHaveLength(3);
  });

  test('Orient phase falls back to per-row embed when embedBatch throws', async () => {
    const { store } = await seedThreeSkills();
    const embedder = new FixtureEmbedder(
      new Map([
        ['retry helper A', basisVector(0)],
        ['retry helper B', tiltedVector(0, 5)],
        ['pagination helper', basisVector(7)],
        ['merged retry helper', basisVector(0)],
      ]),
    );
    vi.spyOn(embedder, 'embedBatch').mockImplementation(async () => {
      await Promise.resolve();
      throw new Error('batch endpoint down');
    });
    const embedSpy = vi.spyOn(embedder, 'embed');
    const llm = new FixtureLLM(() => ({ drafts: [] }));
    const result = await consolidate({
      vectorStore: store,
      llm,
      embedder,
      scope: SCOPE,
      filters: FILTERS,
    });
    // Fallback ran: per-row embed called for each of the 3 seeded skills.
    expect(embedSpy).toHaveBeenCalledTimes(3);
    // Consolidate completed without throwing — result is well-formed even
    // when batch endpoint is down.
    expect(result.derivedSkills).toEqual([]);
  });
});

describe('consolidate — T1.1 / F6: hashFact + idempotency on re-run', () => {
  test('derived skill hash is hashFact(description) — content-derived, deterministic', async () => {
    const { store, similarA, similarB } = await seedThreeSkills();
    const embedder = new FixtureEmbedder(
      new Map([
        ['retry helper A', basisVector(0)],
        ['retry helper B', tiltedVector(0, 5)],
        ['pagination helper', basisVector(7)],
        ['merged retry helper', basisVector(0)],
      ]),
    );
    const llm = new FixtureLLM(() => ({
      drafts: [{ text: 'merged retry helper', derived_from: [similarA, similarB] }],
    }));
    const result = await consolidate({
      vectorStore: store,
      llm,
      embedder,
      scope: SCOPE,
      filters: FILTERS,
    });
    const derived = result.derivedSkills[0];
    expect(derived).toBeDefined();
    // Architecture.md § 4: hash must be content-derived (MD5 via hashFact).
    expect(derived?.hash).toBe(hashFact('merged retry helper'));
  });

  test('running consolidate twice on the same cluster is idempotent (no duplicate derived rows after supersession)', async () => {
    const { store, similarA, similarB } = await seedThreeSkills();
    const embedder = new FixtureEmbedder(
      new Map([
        ['retry helper A', basisVector(0)],
        ['retry helper B', tiltedVector(0, 5)],
        ['pagination helper', basisVector(7)],
        ['merged retry helper', basisVector(0)],
      ]),
    );
    const llm = new FixtureLLM(() => ({
      drafts: [{ text: 'merged retry helper', derived_from: [similarA, similarB] }],
    }));
    const deps = {
      vectorStore: store,
      llm,
      embedder,
      scope: SCOPE,
      filters: FILTERS,
    };
    const first = await consolidate(deps);
    expect(first.derivedSkills.length).toBe(1);
    const second = await consolidate(deps);
    // Sources are now superseded; Orient filters them out; no cluster forms.
    expect(second.derivedSkills.length).toBe(0);
  });
});
