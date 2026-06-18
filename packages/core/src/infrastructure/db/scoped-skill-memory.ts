/**
 * v0.6 — local-runtime implementation of `ScopedSkillMemory` per plan T4.1.
 *
 * Composes the existing `VectorStore` + `VectorStoreWithSkillInsert` adapters
 * (pgvector / in-memory) and the `consolidate` orchestrator from `src/local/skills/`.
 * Honors the `RepoScope` kind (mapped to `agent_id` column at the store layer per
 * the EC-4 switch-site absorption in `filtersFromScope`).
 *
 * SRP: this class is a thin façade — every method delegates to a primitive
 * (insertSkill, runRetrievalPipeline, consolidate orchestrator, store.delete).
 * No business logic beyond projection of payload rows into `Skill` shape.
 *
 * @see .claude/knowledge-base/plans/voyager-skill-library-plan.md § T4.1
 */
import type { Tracer } from '@opentelemetry/api';

import { hashFact } from '../../domain/dedup.js';
import type { Embedder } from '../../domain/dip/embedder.js';
import type { LLM } from '../../domain/dip/llm.js';
import type { VectorStore } from '../../domain/dip/vector-store.js';
import { InvalidScope, MemoryNotFound } from '../../domain/errors.js';
import type { MemoryItem } from '../../domain/memory-item.js';
import { runRetrievalPipeline } from '../../domain/retrieval/pipeline.js';
import type { Filters, RepoScope } from '../../domain/scope.js';
import type {
  ConsolidateOptions,
  ConsolidationResult,
  ScopedSkillMemory,
  Skill,
  SkillDraft,
  SkillRecallOptions,
  SkillWithScore,
} from '../../domain/skill.js';

import type { VectorStoreWithSkillInsert } from './skill-store-args.js';
import { consolidate } from './skills/consolidate.js';
import { decodeSkillPayload } from './skills/payload.js';

/** Dependencies the local skill memory closes over (mirrors LocalMemoryConfig subset). */
export interface LocalScopedSkillMemoryDeps {
  readonly vectorStore: VectorStore & VectorStoreWithSkillInsert;
  readonly embedder: Embedder;
  readonly llm: LLM;
  readonly tracer?: Tracer;
  /**
   * multi-tenant-rbac-and-slice1-completion T3.1 — the workspace this skill
   * memory is bound to (from `Memory.withWorkspace(...).skills(repoId)`). When
   * set, every skill add/recall/consolidate is workspace-isolated via the
   * `workspace_id` filter + insert column; when unset, the store default
   * (`'default'`) applies (ADR D7).
   */
  readonly workspaceId?: string;
  /**
   * v0.6.1 T4.1 / F10: `forget(skillId)` delegates here so the canonical
   * `LocalMemory.forget` path runs — that path writes the `'forget'` history
   * event via the configured `HistoryManager`. The delegate is `LocalMemory.forget`
   * bound by the `Memory.skills()` factory.
   */
  readonly forgetDelegate: (memoryId: string) => Promise<void>;
  /**
   * v0.6.1 T4.1 EC-2: `forget(skillId)` reads the row first and rejects with
   * `MemoryNotFound` when the row is not a skill in this repo's scope. The
   * delegate is `LocalMemory.get` bound by the `Memory.skills()` factory.
   */
  readonly getDelegate: (memoryId: string) => Promise<MemoryItem | null>;
}

// T3.3: payloadToSkill extraction — see src/local/skills/payload.ts:decodeSkillPayload.

export class LocalScopedSkillMemory implements ScopedSkillMemory {
  private readonly scope: RepoScope;
  private readonly filters: Filters;

  constructor(
    repoId: string,
    private readonly deps: LocalScopedSkillMemoryDeps,
  ) {
    if (repoId === '') {
      throw new InvalidScope('Memory.skills(repoId) requires a non-empty repoId');
    }
    this.scope = { kind: 'repo', repoId };
    // RepoScope maps to agent_id at the store layer per EC-4 (filtersFromScope arm).
    // T3.1: carry workspace_id so recall + consolidate isolate via composeFilters.
    this.filters = this.deps.workspaceId !== undefined
      ? { agent_id: repoId, workspace_id: this.deps.workspaceId }
      : { agent_id: repoId };
  }

  async add(draft: SkillDraft): Promise<Skill> {
    // T0.1 / F2 absorption: empty-description rejection happens at the store layer
    // via assertSkillArgs, which throws the correctly-typed `InvalidSkillError`
    // (reason='empty-description'). The early throw used to use `EmptyScopeError`
    // which is the reflection-counters contract — wrong class entirely.
    const embedding = await this.deps.embedder.embed(draft.description);
    // T1.2 / F7: hash MUST be content-derived via canonical hashFact per
    // architecture.md § 4. description IS the embedding target AND the
    // canonical identity of the skill — two add() calls with same
    // description (different code) DO collide on the UNIQUE(hash) index.
    // Consumer rewriting the same skill must use a distinct description.
    const hash = hashFact(draft.description);
    const id = await this.deps.vectorStore.insertSkill({
      embedding,
      hash,
      code: draft.code,
      description: draft.description,
      codeLanguage: draft.codeLanguage,
      // RepoScope persists in agent_id at the store layer per EC-4.
      // T3.1: stamp the workspace so the skill is found only within it.
      scope: { agentId: this.scope.repoId, workspaceId: this.deps.workspaceId ?? 'default' },
    });
    return {
      id,
      text: draft.description,
      hash,
      scope: this.scope,
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: { kind: 'skill' },
      tValid: new Date(),
      tInvalid: null,
      kind: 'skill',
      code: draft.code,
      description: draft.description,
      codeLanguage: draft.codeLanguage,
      supersededBy: null,
      derivedFrom: [],
    };
  }

  async recall(
    query: string,
    options?: SkillRecallOptions,
  ): Promise<readonly SkillWithScore[]> {
    // Honor includeSuperseded (default false). Skills always require kind='skill'.
    const includeSuperseded = options?.includeSuperseded === true;
    const filters: Filters = {
      ...this.filters,
      kind: 'skill',
      excludeSuperseded: !includeSuperseded,
    };
    const results = await runRetrievalPipeline(
      query,
      filters,
      {
        vectorStore: this.deps.vectorStore,
        embedder: this.deps.embedder,
        ...(this.deps.tracer !== undefined ? { tracer: this.deps.tracer } : {}),
      },
      options,
    );
    const skills: SkillWithScore[] = [];
    for (const r of results) {
      const projected = decodeSkillPayload(r.id, r.metadata, this.scope, r.score);
      if (projected !== null) {
        skills.push(projected);
      }
    }
    return skills;
  }

  async consolidate(options?: ConsolidateOptions): Promise<ConsolidationResult> {
    return consolidate(
      {
        vectorStore: this.deps.vectorStore,
        llm: this.deps.llm,
        embedder: this.deps.embedder,
        scope: this.scope,
        filters: this.filters,
        ...(this.deps.tracer !== undefined ? { tracer: this.deps.tracer } : {}),
      },
      options,
    );
  }

  async forget(skillId: string): Promise<void> {
    // T4.1 / F10 + v1.1 EC-2: scope-isolation guard BEFORE delegating to the
    // canonical LocalMemory.forget path. The guard reads the row, then rejects
    // with MemoryNotFound when:
    //   (a) the row does not exist (parity with LocalMemory.forget EC-12),
    //   (b) the row belongs to another repoId (cross-scope erasure attempt),
    //   (c) the row is not a skill (kind mismatch — a user/agent memory id was
    //       passed to memory.skills(...).forget).
    // All three failures surface the SAME error class — consumers cannot
    // distinguish "you don't own it" from "doesn't exist" (information-leak
    // prevention; intentional per plan T4.1 deep-dives § behavior matrix).
    const row = await this.deps.getDelegate(skillId);
    const isOwnedSkill =
      row !== null
      && row.metadata['kind'] === 'skill'
      && row.metadata['agent_id'] === this.scope.repoId;
    if (!isOwnedSkill) {
      throw new MemoryNotFound(
        `skillId ${skillId} not found in repo '${this.scope.repoId}' (cross-scope or non-skill)`,
      );
    }
    await this.deps.forgetDelegate(skillId);
  }
}
