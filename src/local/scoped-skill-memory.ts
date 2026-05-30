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
 * @see .claude/knowledge-base/plans/skill-library-plan.md § T4.1
 */
import { createHash } from 'node:crypto';

import type { Tracer } from '@opentelemetry/api';

import type { Embedder } from '../core/dip/embedder.js';
import type { LLM } from '../core/dip/llm.js';
import type { VectorStore } from '../core/dip/vector-store.js';
import { EmptyScopeError, InvalidScope } from '../core/errors.js';
import { runRetrievalPipeline } from '../core/retrieval/pipeline.js';
import type { Filters, RepoScope } from '../core/scope.js';
import type {
  ConsolidateOptions,
  ConsolidationResult,
  ScopedSkillMemory,
  Skill,
  SkillDraft,
  SkillLanguage,
  SkillRecallOptions,
  SkillWithScore,
} from '../core/skill.js';

import type { VectorStoreWithSkillInsert } from './skill-store-args.js';
import { consolidate } from './skills/consolidate.js';

/** Dependencies the local skill memory closes over (mirrors LocalMemoryConfig subset). */
export interface LocalScopedSkillMemoryDeps {
  readonly vectorStore: VectorStore & VectorStoreWithSkillInsert;
  readonly embedder: Embedder;
  readonly llm: LLM;
  readonly tracer?: Tracer;
}

/** Project a payload Record + id into a `Skill` row shape. */
function payloadToSkill(
  id: string,
  payload: Readonly<Record<string, string | number | boolean | null>>,
  scope: RepoScope,
  score?: number,
): SkillWithScore | null {
  if (payload['kind'] !== 'skill') {
    return null;
  }
  const codeLanguageRaw = payload['code_language'];
  if (codeLanguageRaw !== 'typescript' && codeLanguageRaw !== 'javascript') {
    return null;
  }
  const codeLanguage: SkillLanguage = codeLanguageRaw;
  const supersededByRaw = payload['superseded_by'];
  const supersededBy =
    typeof supersededByRaw === 'string' && supersededByRaw.length > 0 ? supersededByRaw : null;
  const derivedFromRaw = payload['derived_from'];
  let derivedFrom: readonly string[] = [];
  if (typeof derivedFromRaw === 'string' && derivedFromRaw.length > 0) {
    try {
      const parsed: unknown = JSON.parse(derivedFromRaw);
      if (Array.isArray(parsed)) {
        derivedFrom = parsed.filter((s): s is string => typeof s === 'string');
      }
    } catch {
      derivedFrom = [];
    }
  }
  const description = String(payload['description'] ?? '');
  const code = String(payload['code'] ?? '');
  return {
    id,
    text: description,
    hash: String(payload['hash'] ?? id),
    scope,
    createdAt: new Date(),
    updatedAt: new Date(),
    metadata: { ...payload },
    tValid: new Date(),
    tInvalid: null,
    kind: 'skill',
    code,
    description,
    codeLanguage,
    supersededBy,
    derivedFrom,
    score: score ?? 0,
  };
}

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
    this.filters = { agent_id: repoId };
  }

  async add(draft: SkillDraft): Promise<Skill> {
    if (draft.description.trim().length === 0) {
      throw new EmptyScopeError();
    }
    const embedding = await this.deps.embedder.embed(draft.description);
    const hash = createHash('md5').update(draft.code).update('|').update(draft.description).digest('hex');
    const id = await this.deps.vectorStore.insertSkill({
      embedding,
      hash,
      code: draft.code,
      description: draft.description,
      codeLanguage: draft.codeLanguage,
      // RepoScope persists in agent_id at the store layer per EC-4.
      scope: { agentId: this.scope.repoId },
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
      const projected = payloadToSkill(r.id, r.metadata, this.scope, r.score);
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
    // v0.6 ships hard-delete via store.delete. Soft-delete via bi-temporal
    // `tInvalid` is ADR-0006 cloud-only territory (v0.5+) and out of scope here.
    await this.deps.vectorStore.delete(skillId);
  }
}
