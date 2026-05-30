/**
 * v0.6 — 4-phase code-as-skill consolidation orchestrator.
 *
 * Wraps the v0.4a `executeReflection + validateProvenance + insertDerivedSkill`
 * chain (per plan ADR D1 — REUSE, no sibling chain) with skill-aware Orient /
 * Gather / Consolidate / Report phases producing `kind='skill'` derived rows.
 *
 * Pipeline:
 *  1. **Orient**  — fetch all current skills under the scope filter
 *                   (`onlySkills:true, includeSuperseded:false` per EC-3).
 *  2. **Gather**  — greedy union-find clustering on embedding cosine similarity
 *                   above `clusterThreshold` (default 0.85). Clusters of size < 2
 *                   are dropped (single-skill clusters have nothing to consolidate).
 *  3. **Consolidate** — for each cluster, call `executeReflection` with the source
 *                   skills (text projection: `description + "\n\nCode:\n" + code`).
 *                   Validate provenance + assert `draft.derivedFrom.length >= 2`.
 *                   Embed the merged description, then call
 *                   `insertDerivedSkillAtomic(insertArgs, sourceIds)` which on
 *                   pgvector wraps INSERT + UPDATE in BEGIN/COMMIT (EC-2). On
 *                   InMemoryVectorStore the combo runs sequentially as
 *                   best-effort — documented accepted-risk for tests/dev only.
 *  4. **Report**  — return `ConsolidationResult { sourceClusters, derivedSkills,
 *                   supersededIds, durationMs }`.
 *
 * Invariants:
 *  - Every `derivedSkills[i].derivedFrom.length >= 2` (enforced post-LLM).
 *  - Every id in `supersededIds` was an input to some `sourceClusters[j].sourceIds`.
 *  - Source rows are NEVER deleted (Inquebrável Rule 3 — supersession via column).
 *  - When LLM returns 0 drafts for a cluster, the cluster is skipped entirely;
 *    no partial consolidation (no `markSuperseded` without an `insertDerivedSkill`).
 *
 * Architecture:
 *  - Lives under `src/local/skills/` per plan ADR D4 (NOT inside LocalScopedSkillMemory).
 *  - DIP-compliant: depends on the store via runtime-branded `VectorStoreWithSkillInsert`,
 *    NOT on the pg `PoolClient` directly. The atomicity guarantee is honored
 *    inside `insertDerivedSkillAtomic` (pgvector wraps; in-memory best-effort).
 *
 * @see .claude/knowledge-base/plans/skill-library-plan.md § T3.1 + EC-2 + EC-3
 * @see .claude/knowledge-base/discoveries/blueprints/skill-library-blueprint.md § ADR D4
 */
import { context as otelContext, trace as otelTrace, SpanStatusCode, type Span, type Tracer } from '@opentelemetry/api';

import type { Embedder } from '../../core/dip/embedder.js';
import type { LLM } from '../../core/dip/llm.js';
import type { VectorStore } from '../../core/dip/vector-store.js';
import type { MemoryItem } from '../../core/memory-item.js';
import { executeReflection } from '../../core/reflection/execute.js';
import { validateProvenance } from '../../core/reflection/provenance.js';
import type { Filters, Scope } from '../../core/scope.js';
import type {
  ConsolidateOptions,
  ConsolidationResult,
  Skill,
  SourceCluster,
} from '../../core/skill.js';
import type {
  InsertDerivedSkillArgs,
  VectorStoreWithSkillInsert,
} from '../skill-store-args.js';

/** Default embedding-cosine threshold for cluster membership (KISS — calibrate at v0.6.1+). */
const DEFAULT_CLUSTER_THRESHOLD = 0.85;

/** Maximum number of skills the Orient phase scans in one consolidate() call. */
const ORIENT_PAGE_SIZE = 500;

/** Dependencies required by the orchestrator. */
export interface ConsolidateDeps {
  /** Local store with skill-insertion + supersession capabilities. */
  readonly vectorStore: VectorStore & VectorStoreWithSkillInsert;
  /** LLM used by the v0.4a `executeReflection` primitive. */
  readonly llm: LLM;
  /** Embedder used to embed the LLM-produced merged description. */
  readonly embedder: Embedder;
  /** Scope object passed to `executeReflection` (LLM prompt formatting). */
  readonly scope: Scope;
  /** Store-layer filter (already projected from scope by the caller). */
  readonly filters: Filters;
  /**
   * Optional OTel tracer. When present, emits parent span `skills.consolidate`
   * with child spans `skills.consolidate.orient` / `skills.consolidate.gather` /
   * `skills.consolidate.consolidate` / `skills.consolidate.report` per plan
   * acceptance criterion + architecture.md § Telemetry. When absent, no spans
   * are emitted (no fabricated telemetry).
   */
  readonly tracer?: Tracer;
}

/**
 * Run a function inside an OTel span when `tracer` is present; otherwise just
 * invoke the function directly. Records exceptions + sets ERROR status on throw.
 */
async function withSpan<T>(
  tracer: Tracer | undefined,
  name: string,
  fn: (span?: Span) => Promise<T>,
): Promise<T> {
  if (tracer === undefined) {
    return fn();
  }
  const span = tracer.startSpan(name);
  return otelContext.with(otelTrace.setSpan(otelContext.active(), span), async () => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      if (err instanceof Error) {
        span.recordException(err);
      }
      throw err;
    } finally {
      span.end();
    }
  });
}

/**
 * Project a stored skill row (read back from `vectorStore.list`) into the
 * `MemoryItem` shape the v0.4a `executeReflection` primitive expects.
 *
 * The `text` field carries `description + "\n\nCode:\n" + code` so the LLM
 * extraction sees BOTH the semantic (description) and the executable
 * (code) signals when proposing a merged skill.
 *
 * @internal exported for unit-test introspection only.
 */
export function projectSkillToMemoryItem(skill: Skill): MemoryItem {
  const text =
    skill.code.length === 0
      ? skill.description
      : `${skill.description}\n\nCode:\n${skill.code}`;
  return {
    id: skill.id,
    text,
    hash: skill.hash,
    scope: skill.scope,
    createdAt: skill.createdAt,
    updatedAt: skill.updatedAt,
    metadata: skill.metadata,
    tValid: skill.tValid,
    tInvalid: skill.tInvalid,
  };
}

/** Cosine similarity in [-1, 1]. Returns 0 for length-mismatch or zero-magnitude. */
function cosineSim(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    magA += ai * ai;
    magB += bi * bi;
  }
  if (magA === 0 || magB === 0) {
    return 0;
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/**
 * Greedy union-find clustering on a list of (skill, embedding) pairs:
 *   - Each skill starts in its own cluster (parent[i] = i).
 *   - For every pair (i, j) with cosine ≥ threshold, union(i, j).
 *   - Transitive closure: A~B + B~C produces a single cluster {A,B,C}.
 *
 * Returns a list of clusters, each as the index list of its members.
 */
function clusterByEmbedding(
  embeddings: readonly (readonly number[])[],
  threshold: number,
): readonly (readonly number[])[] {
  const n = embeddings.length;
  const parent = new Array<number>(n);
  for (let i = 0; i < n; i += 1) {
    parent[i] = i;
  }
  const find = (x: number): number => {
    let cur = x;
    while ((parent[cur] ?? cur) !== cur) {
      cur = parent[cur] ?? cur;
    }
    let walk = x;
    while ((parent[walk] ?? walk) !== cur) {
      const next = parent[walk] ?? walk;
      parent[walk] = cur;
      walk = next;
    }
    return cur;
  };
  const union = (x: number, y: number): void => {
    const rx = find(x);
    const ry = find(y);
    if (rx !== ry) {
      parent[rx] = ry;
    }
  };
  for (let i = 0; i < n; i += 1) {
    const ei = embeddings[i];
    if (ei === undefined) {
      continue;
    }
    for (let j = i + 1; j < n; j += 1) {
      const ej = embeddings[j];
      if (ej === undefined) {
        continue;
      }
      if (cosineSim(ei, ej) >= threshold) {
        union(i, j);
      }
    }
  }
  const clusters = new Map<number, number[]>();
  for (let i = 0; i < n; i += 1) {
    const root = find(i);
    const existing = clusters.get(root);
    if (existing !== undefined) {
      existing.push(i);
    } else {
      clusters.set(root, [i]);
    }
  }
  return [...clusters.values()];
}

/**
 * Reconstruct a Skill from a store row. The store projects v0.6 columns into
 * payload (per T2.1 rowToResult extension) so the fields are present here.
 */
function rowToSkill(
  id: string,
  payload: Readonly<Record<string, string | number | boolean | null>>,
  scope: Scope,
): Skill | null {
  if (payload['kind'] !== 'skill') {
    return null;
  }
  const description = String(payload['description'] ?? '');
  const code = String(payload['code'] ?? '');
  const codeLanguageRaw = payload['code_language'];
  if (codeLanguageRaw !== 'typescript' && codeLanguageRaw !== 'javascript') {
    return null;
  }
  const supersededBy = payload['superseded_by'];
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
    codeLanguage: codeLanguageRaw,
    supersededBy:
      typeof supersededBy === 'string' && supersededBy.length > 0 ? supersededBy : null,
    derivedFrom,
  };
}

/**
 * Run the 4-phase consolidation orchestrator.
 *
 * Returns a `ConsolidationResult` summarizing what was clustered, what got
 * consolidated, and which source ids were marked superseded. An empty Map of
 * results is a valid outcome — when no clusters meet the threshold OR when the
 * LLM returns no drafts, `consolidate()` reports zero derivedSkills without
 * mutating any rows.
 */
export async function consolidate(
  deps: ConsolidateDeps,
  options?: ConsolidateOptions,
): Promise<ConsolidationResult> {
  return withSpan(deps.tracer, 'skills.consolidate', async (parentSpan) => {
    const startedAt = Date.now();
    const threshold = options?.clusterThreshold ?? DEFAULT_CLUSTER_THRESHOLD;
    parentSpan?.setAttribute('skills.consolidate.cluster_threshold', threshold);

    // --- Phase 1 (Orient) --------------------------------------------------
    const skillsWithEmbedding = await withSpan(
      deps.tracer,
      'skills.consolidate.orient',
      async (span) => {
        const orientFilters: Filters = {
          ...deps.filters,
          kind: 'skill',
          excludeSuperseded: true,
        };
        const [rawRows] = await deps.vectorStore.list(orientFilters, ORIENT_PAGE_SIZE);
        const acc: { skill: Skill; embedding: readonly number[] }[] = [];
        for (const row of rawRows) {
          const skill = rowToSkill(row.id, row.payload, deps.scope);
          if (skill === null) {
            continue;
          }
          const get = await deps.vectorStore.get(row.id);
          // Conformance contract does not include direct vector access; re-embed
          // from the description as the deterministic source for clustering.
          if (get === null) {
            continue;
          }
          const embedding = await deps.embedder.embed(skill.description);
          acc.push({ skill, embedding });
        }
        span?.setAttribute('skills.consolidate.orient.skills_found', acc.length);
        return acc;
      },
    );

    if (skillsWithEmbedding.length < 2) {
      parentSpan?.setAttribute('skills.consolidate.derived_skills', 0);
      return {
        sourceClusters: [],
        derivedSkills: [],
        supersededIds: [],
        durationMs: Date.now() - startedAt,
      };
    }

    // --- Phase 2 (Gather) --------------------------------------------------
    const sourceClusters = await withSpan(
      deps.tracer,
      'skills.consolidate.gather',
      (span) => {
        const allEmbeddings = skillsWithEmbedding.map((s) => s.embedding);
        const clusterIndices = clusterByEmbedding(allEmbeddings, threshold).filter(
          (c) => c.length >= 2,
        );
        const result: SourceCluster[] = clusterIndices.map((idxs) => {
          const members = idxs
            .map((i) => skillsWithEmbedding[i]?.skill)
            .filter((s): s is Skill => s !== undefined);
          return { sourceIds: members.map((s) => s.id), skills: members };
        });
        span?.setAttribute('skills.consolidate.gather.cluster_count', result.length);
        return Promise.resolve(result);
      },
    );

    if (sourceClusters.length === 0) {
      parentSpan?.setAttribute('skills.consolidate.derived_skills', 0);
      return {
        sourceClusters: [],
        derivedSkills: [],
        supersededIds: [],
        durationMs: Date.now() - startedAt,
      };
    }

    // --- Phase 3 (Consolidate) --------------------------------------------
    const { derivedSkills, supersededIds } = await withSpan(
      deps.tracer,
      'skills.consolidate.consolidate',
      async (span) => {
        const derived: Skill[] = [];
        const superseded: string[] = [];
        for (const cluster of sourceClusters) {
          const sourceMemories: MemoryItem[] = cluster.skills.map(projectSkillToMemoryItem);
          const drafts = await executeReflection({
            llm: deps.llm,
            sourceMemories,
            scope: deps.scope,
          });
          if (drafts.length === 0) {
            // No-consolidation outcome: skip cluster entirely; do NOT mark superseded.
            continue;
          }
          validateProvenance(drafts, cluster.sourceIds);
          const draft = drafts[0];
          if (draft === undefined || draft.derivedFrom.length < 2) {
            // Skip degenerate provenance (single-source derived skill is not a
            // valid consolidation outcome per plan invariant).
            continue;
          }
          const description = draft.text;
          const embedding = await deps.embedder.embed(description);
          const hash = `derived-skill-${String(Date.now())}-${String(Math.random()).slice(2, 8)}`;
          const scopeForArgs = {
            userId: 'userId' in deps.scope ? deps.scope.userId : null,
            sessionId: 'sessionId' in deps.scope ? deps.scope.sessionId : null,
            agentId: 'agentId' in deps.scope ? deps.scope.agentId : null,
          };
          const insertArgs: InsertDerivedSkillArgs = {
            embedding,
            hash,
            // LLM produces a single merged text; code = description until v0.6.1
            // expands the draft shape with structured code/description.
            code: description,
            description,
            codeLanguage: 'typescript',
            derivedFrom: draft.derivedFrom,
            scope: scopeForArgs,
          };
          const derivedId = await deps.vectorStore.insertDerivedSkillAtomic(
            insertArgs,
            cluster.sourceIds,
          );
          derived.push({
            id: derivedId,
            text: description,
            hash,
            scope: deps.scope,
            createdAt: new Date(),
            updatedAt: new Date(),
            metadata: { kind: 'skill' },
            tValid: new Date(),
            tInvalid: null,
            kind: 'skill',
            code: description,
            description,
            codeLanguage: 'typescript',
            supersededBy: null,
            derivedFrom: draft.derivedFrom,
          });
          superseded.push(...cluster.sourceIds);
        }
        span?.setAttribute('skills.consolidate.consolidate.derived_count', derived.length);
        span?.setAttribute('skills.consolidate.consolidate.superseded_count', superseded.length);
        return { derivedSkills: derived, supersededIds: superseded };
      },
    );

    // --- Phase 4 (Report) --------------------------------------------------
    return withSpan(deps.tracer, 'skills.consolidate.report', () => {
      parentSpan?.setAttribute('skills.consolidate.derived_skills', derivedSkills.length);
      return Promise.resolve({
        sourceClusters,
        derivedSkills,
        supersededIds,
        durationMs: Date.now() - startedAt,
      });
    });
  });
}
