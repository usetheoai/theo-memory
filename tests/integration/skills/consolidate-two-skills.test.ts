/**
 * THE GOAL TEST — v0.6 skill-library T5.1.
 *
 * Proves the Goal metric (per plan v1.1 Goal statement + CLAUDE.md Roadmap
 * Item 8 acceptance criterion): consolidate two syntactically-different but
 * semantically-equivalent skills against real `ankane/pgvector:v0.5.1` and
 * verify that:
 *
 *   1. exactly 1 derived skill is produced
 *   2. derived.derivedFrom contains BOTH source ids (the "derived_from
 *      provenance" invariant — the single most load-bearing assertion)
 *   3. recall({onlySkills:true, includeSuperseded:false}) returns ONLY the
 *      derived skill (proves the supersession + filter chain end-to-end)
 *   4. source rows have supersededBy === derived.id (atomicity proof via
 *      EC-2's insertDerivedSkillAtomic withTransaction wrap)
 *
 * Gated by THEOMEM_PG_URI env var (EC-17 absorption: CI=true with absent
 * env fails loudly, never silently skips).
 *
 * @see .claude/knowledge-base/plans/skill-library-plan.md § T5.1 + Goal
 */
import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest';
import pg from 'pg';

import { MAX_EMBEDDING_DIM } from '../../../src/core/constants.js';
import type { Embedder } from '../../../src/core/dip/embedder.js';
import type { LLM } from '../../../src/core/dip/llm.js';
import { createLocalMemory, PgvectorStore } from '../../../src/index.js';

import { SKILL_AXIOS, SKILL_FETCH } from './fixtures/two-similar-skills.js';

const PG_URI = process.env['THEOMEM_PG_URI'];

// EC-17: CI env guard
function guardCiEnv(): void {
  if (process.env['CI'] === 'true' && (PG_URI === undefined || PG_URI === '')) {
    throw new Error(
      'EC-17: THEOMEM_PG_URI must be set in CI for tests/integration/skills/** to run',
    );
  }
}
guardCiEnv();

/**
 * Build a deterministic embedding from a description. Same description → same
 * vector → cosine 1.0. Different descriptions → orthogonal vectors. Since the
 * two source fixtures share an identical description, they produce identical
 * vectors AND cluster together (above any threshold).
 */
function descriptionVector(description: string): readonly number[] {
  const v = new Array<number>(MAX_EMBEDDING_DIM).fill(0);
  // Hash-spread the description across a small index range so distinct
  // descriptions land on different basis vectors.
  let h = 0;
  for (let i = 0; i < description.length; i += 1) {
    h = (h * 31 + description.charCodeAt(i)) >>> 0;
  }
  v[h % 64] = 1;
  return v;
}

const fixedEmbedder = (): Embedder => ({
  embed: vi.fn(async (text: string) => descriptionVector(text)),
  embedBatch: vi.fn(async (texts: readonly string[]) =>
    texts.map((t) => descriptionVector(t)),
  ),
});

/**
 * LLM stub that recognizes a 2-source skill cluster from the reflection prompt
 * and returns a deterministic merged-skill draft citing both source ids in
 * `derived_from` so validateProvenance + length≥2 invariants pass.
 *
 * The reflection prompt embeds source memory ids; we parse them out and echo
 * them back in the draft's derived_from array.
 */
const consolidatingLlm = (): LLM => ({
  generateResponse: vi.fn(async () => ({ memory: [] })),
  generateChat: vi.fn(async (messages: readonly { role: string; content: string }[]) => {
    const content = messages.map((m) => m.content).join('\n');
    // Parse UUID v4 ids out of the prompt (each source memory carries one).
    const uuids = content.match(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
    ) ?? [];
    const unique = Array.from(new Set(uuids));
    const draft = {
      text: 'merged retry helper with exponential backoff (unified fetch+axios)',
      derived_from: unique,
    };
    return {
      role: 'assistant' as const,
      content: JSON.stringify([draft]),
    };
  }),
});

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('THE GOAL TEST — consolidate two skills (THEOMEM_PG_URI not set)', () => {
    test('placeholder', () => undefined);
  });
} else {
  const pool = new pg.Pool({ connectionString: PG_URI, max: 4 });

  afterAll(async () => {
    await pool.query('TRUNCATE memories, entities, history CASCADE');
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE memories, entities, history RESTART IDENTITY CASCADE');
  });

  describe('THE GOAL TEST — v0.6 consolidate two semantically-equivalent skills', () => {
    test('consolidate(): 2 source skills -> 1 derived skill with derived_from carrying both source ids', async () => {
      // Given: a real memory + skills scope under a single repoId, seeded with
      // two semantically-equivalent skills (different implementations).
      const memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool),
        embedder: fixedEmbedder(),
        llm: consolidatingLlm(),
      });
      const skills = memory.skills('repo-payments');
      const srcFetch = await skills.add(SKILL_FETCH);
      const srcAxios = await skills.add(SKILL_AXIOS);

      // When: consolidate runs (Phase 1 Orient + Phase 2 Gather see the cluster;
      // Phase 3 Consolidate runs the LLM stub + insertDerivedSkillAtomic).
      const result = await skills.consolidate({ clusterThreshold: 0.9 });

      // Then: exactly 1 derived skill produced + both source ids cited.
      expect(result.sourceClusters.length).toBe(1);
      expect(result.derivedSkills.length).toBe(1);
      const derived = result.derivedSkills[0];
      expect(derived).toBeDefined();
      expect([...(derived?.derivedFrom ?? [])].sort()).toEqual(
        [srcFetch.id, srcAxios.id].sort(),
      );
      // EC-2 atomicity: source rows are marked superseded by the derived.
      expect([...result.supersededIds].sort()).toEqual([srcFetch.id, srcAxios.id].sort());

      // And: recall({onlySkills:true, includeSuperseded:false}) returns ONLY
      // the derived skill — the source skills are filtered out as superseded.
      // Query by the merged description so the deterministic embedder lands
      // on the derived skill's basis vector.
      const recalled = await skills.recall(
        'merged retry helper with exponential backoff (unified fetch+axios)',
        { topK: 10, threshold: 0 },
      );
      expect(recalled.length).toBe(1);
      expect(recalled[0]?.id).toBe(derived?.id);

      // And: source rows in the DB have superseded_by = derived.id (verifies
      // the atomic UPDATE landed alongside the INSERT inside withTransaction).
      const checkA = await pool.query<{ superseded_by: string | null }>(
        'SELECT superseded_by FROM memories WHERE id = $1',
        [srcFetch.id],
      );
      const checkB = await pool.query<{ superseded_by: string | null }>(
        'SELECT superseded_by FROM memories WHERE id = $1',
        [srcAxios.id],
      );
      expect(checkA.rows[0]?.superseded_by).toBe(derived?.id);
      expect(checkB.rows[0]?.superseded_by).toBe(derived?.id);
    });

    test('scope isolation: skills under repo-A are invisible to consolidate under repo-B', async () => {
      const memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool),
        embedder: fixedEmbedder(),
        llm: consolidatingLlm(),
      });
      await memory.skills('repo-A').add(SKILL_FETCH);
      await memory.skills('repo-A').add(SKILL_AXIOS);
      // Under a different repoId there are 0 skills; consolidate is a no-op.
      const result = await memory.skills('repo-B').consolidate({ clusterThreshold: 0.9 });
      expect(result.sourceClusters).toEqual([]);
      expect(result.derivedSkills).toEqual([]);
      expect(result.supersededIds).toEqual([]);
    });
  });
}
