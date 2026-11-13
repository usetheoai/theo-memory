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
 */
import type { Tracer } from '@opentelemetry/api';

import { hashFact } from '../../domain/dedup.js';
import type { Embedder } from '../../domain/dip/embedder.js';
import type { LLM } from '../../domain/dip/llm.js';
import type {
  SkillExecutor,
  SkillExecutionOptions,
  SkillExecutionResult,
} from '../../domain/dip/skill-executor.js';
import type { VectorStore } from '../../domain/dip/vector-store.js';
import {
  InvalidScope,
  MemoryNotFound,
  SkillAlreadyExists,
  SkillExecutionNotConfiguredError,
} from '../../domain/errors.js';
import type { MemoryItem } from '../../domain/memory-item.js';
import { runRetrievalPipeline } from '../../domain/retrieval/pipeline.js';
import type { Filters, RepoScope } from '../../domain/scope.js';
import type {
  ConsolidateOptions,
  ConsolidationResult,
  ScopedSkillMemory,
  Skill,
  SkillDraft,
  SkillListOptions,
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
  /**
   * agentic-skill-execution-sandbox T2.1 — optional `SkillExecutor` enabling
   * `execute(skillId, args)`. When unset, `execute()` throws
   * `SkillExecutionNotConfiguredError` (ADR D3 — execution is opt-in/gated; the
   * default is STORE-only). Wired by `createLocalMemory({ skillExecutor })` (T2.2).
   */
  readonly skillExecutor?: SkillExecutor;
}

// T3.3: payloadToSkill extraction — see src/local/skills/payload.ts:decodeSkillPayload.

/**
 * skills-write-surface T1.1 / EC-W1 — detect the Postgres unique-violation
 * (`code === '23505'`) raised by the `UNIQUE(hash)` skill index. Guards on the
 * hash constraint name when present so a FUTURE second unique index on the
 * skill insert path is never mis-mapped to 409; falls back to true on a bare
 * 23505 (today the hash index is the only unique constraint hit on insertSkill).
 */
function isHashUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: unknown; constraint?: unknown };
  if (e.code !== '23505') return false;
  const constraint = typeof e.constraint === 'string' ? e.constraint : undefined;
  return constraint === undefined || constraint.includes('hash');
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
    let id: string;
    try {
      id = await this.deps.vectorStore.insertSkill({
        embedding,
        hash,
        code: draft.code,
        description: draft.description,
        codeLanguage: draft.codeLanguage,
        // RepoScope persists in agent_id at the store layer per EC-4.
        // T3.1: stamp the workspace so the skill is found only within it.
        scope: { agentId: this.scope.repoId, workspaceId: this.deps.workspaceId ?? 'default' },
      });
    } catch (err) {
      // skills-write-surface T1.1 / D1 + EC-W1: a same-description add collides on
      // the UNIQUE(hash) index → Postgres unique-violation (code 23505). Map it to
      // the typed SkillAlreadyExists so the REST/MCP boundary can return 409 (not a
      // raw 500). EC-W1: guard on the hash constraint specifically so a FUTURE
      // second unique index is never mis-mapped; re-throw anything else.
      if (isHashUniqueViolation(err)) {
        throw new SkillAlreadyExists(hash, this.scope.repoId, { cause: err });
      }
      throw err;
    }
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
    await this.deps.vectorStore.recordAccess?.(results.map((r) => r.id));
    const skills: SkillWithScore[] = [];
    for (const r of results) {
      const projected = decodeSkillPayload(r.id, r.metadata, this.scope, r.score);
      if (projected !== null) {
        skills.push(projected);
      }
    }
    return skills;
  }

  async getAll(options?: SkillListOptions): Promise<readonly Skill[]> {
    // dashboard-phase2b-skills-browse T1.1 — read-only enumeration. Reuses the
    // VectorStore.list primitive (D1: same projection + soft-delete + ordering
    // the memories tier already relies on) with the skill-scope filters recall
    // builds. workspace_id is inherited via this.filters (EC-1 — the scoped
    // object is constructed from the workspace-resolved Memory).
    const includeSuperseded = options?.includeSuperseded === true;
    const filters: Filters = {
      ...this.filters,
      kind: 'skill',
      excludeSuperseded: !includeSuperseded,
    };
    const [rows] = await this.deps.vectorStore.list(filters, options?.topK ?? 100);
    const skills: Skill[] = [];
    for (const r of rows) {
      // list() projects the row payload; decodeSkillPayload reads the skill
      // columns from it (3-arg form — no recall score for a listing).
      const projected = decodeSkillPayload(r.id, r.payload, this.scope);
      if (projected !== null) {
        // decodeSkillPayload hardcodes createdAt=now() (the payload JSONB does
        // not carry it); VectorStore.list projects the real created_at into the
        // top-level result field, so override with the stored truth when present
        // (the browse surface renders a "Created" column — Inquebrável Rule 3).
        skills.push(r.createdAt !== undefined ? { ...projected, createdAt: r.createdAt } : projected);
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
    //       passed to memory.skills(...).forget),
    //   (d) the row belongs to another WORKSPACE (cross-tenant erasure attempt).
    // All failures surface the SAME error class — consumers cannot distinguish
    // "you don't own it" from "doesn't exist" (information-leak prevention;
    // intentional per plan T4.1 deep-dives § behavior matrix).
    //
    // skills-write-surface /review HIGH fix: the (d) workspace_id check guards
    // HERE so a cross-workspace forget maps to MemoryNotFound (404) at the guard,
    // rather than falling through to LocalMemory.forget which throws the
    // (api-unmapped) WorkspaceMismatch → 500 — a 500-vs-404 differential would
    // leak which (repoId, skillId) tuples exist in OTHER workspaces (ADR D6 +
    // OWASP IDOR). Also closes dashboard-integration-followups § 4.
    const expectedWorkspace = this.deps.workspaceId ?? 'default';
    const row = await this.deps.getDelegate(skillId);
    const isOwnedSkill =
      row !== null
      && row.metadata['kind'] === 'skill'
      && row.metadata['agent_id'] === this.scope.repoId
      && (row.metadata['workspace_id'] ?? 'default') === expectedWorkspace;
    if (!isOwnedSkill) {
      throw new MemoryNotFound(
        `skillId ${skillId} not found in repo '${this.scope.repoId}' (cross-scope, cross-workspace, or non-skill)`,
      );
    }
    await this.deps.forgetDelegate(skillId);
  }

  async execute(
    skillId: string,
    args: Readonly<Record<string, unknown>>,
    opts?: SkillExecutionOptions,
  ): Promise<SkillExecutionResult> {
    // ADR D3 — execution is opt-in/gated. No executor wired ⇒ STORE-only default.
    if (this.deps.skillExecutor === undefined) {
      throw new SkillExecutionNotConfiguredError(
        `repo '${this.scope.repoId}' has no SkillExecutor wired; pass createLocalMemory({ skillExecutor })`,
      );
    }
    // Resolve the skill WITH its code via the workspace+scope-isolated browse path
    // (getAll inherits this.filters → same isolation as forget). includeSuperseded
    // so any stored id resolves; a non-matching id yields MemoryNotFound (404, no
    // existence leak). Bounded by the repo's skill set (small — not the unbounded
    // user scope the gateway forget worried about). A direct by-id read is a future
    // optimization if a repo's skill count ever grows large.
    const skills = await this.getAll({ includeSuperseded: true });
    const skill = skills.find((s) => s.id === skillId);
    if (skill === undefined) {
      throw new MemoryNotFound(
        `skillId ${skillId} not found in repo '${this.scope.repoId}' (absent, cross-scope, or cross-workspace)`,
      );
    }
    return this.deps.skillExecutor.execute(skill, args, opts);
  }
}
