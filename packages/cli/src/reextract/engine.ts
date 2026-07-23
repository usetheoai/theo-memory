/**
 * `themory reextract` engine (M13 T3.1, #111 — blueprint ADR D3).
 *
 * Orchestrates EXISTING public primitives (parsimony rung 4 — zero new stack):
 * target selection via SQL → count+bytes chunks → bounded semaphore → per-memory
 * re-extraction (prompt → parse → default-taxonomy coercion → linkEntities) →
 * identity-driven supersede (ADR D2) → file checkpoint (resume) → typed report.
 * Batching mechanics (chunking / checkpoint / semaphore) live in ./batching.ts.
 *
 * Composition-root module (architecture.md § 1): the domain never learns the job
 * exists. Pseudo-signature refined from the plan (`{ pool; memory; llm }`): the
 * `Memory` facade is unnecessary — linking needs the embedder + stores explicitly
 * (DIP), so they are injected (unit tests stub them; the CLI verb wires Pg impls).
 */
import type { Tracer } from '@opentelemetry/api';
import {
  AdditiveExtractionSchema,
  applyOntologyToEntities,
  DEFAULT_ENTITY_TAXONOMY,
  emitEvent,
  generateAdditiveExtractionPrompt,
  linkEntities,
} from '@usetheo/memory';
import type {
  Embedder,
  Filters,
  LLM,
  MemoryEntityStore,
  MemoryGraphStore,
  Ontology,
} from '@usetheo/memory';

import {
  chunkTargets,
  loadCheckpoint,
  MECHANISM_TYPES,
  mapWithConcurrency,
  REEXTRACT_INPUT_MAX_CHARS,
  saveCheckpoint,
  type ReextractTarget,
} from './batching.js';

export {
  chunkTargets,
  MECHANISM_TYPES,
  REEXTRACT_INPUT_MAX_CHARS,
  ReextractCheckpointCorrupted,
  type ReextractTarget,
} from './batching.js';

/** Minimal query surface the engine needs (unit tests stub it; prod passes pg.Pool). */
export interface ReextractPool {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: R[]; rowCount?: number | null }>;
}

export interface ReextractDeps {
  readonly pool: ReextractPool;
  readonly llm: LLM;
  readonly embedder: Embedder;
  readonly memoryEntityStore: MemoryEntityStore;
  readonly memoryGraphStore?: MemoryGraphStore;
  readonly tracer?: Tracer;
  readonly ontology?: Ontology;
  readonly checkpointPath?: string;
}

export interface ReextractOptions {
  dryRun: boolean;
  limit?: number;
  resume: boolean;
  concurrency: number; // default 5
  chunkSize: number; // default 25
  chunkMaxBytes: number; // default 512 KB
}

export interface ReextractReport {
  targets: number;
  processed: number;
  skipped: Record<string, number>;
  llmCalls: number;
  estTokens: number;
  durationMs: number;
  /** Entities newly LINKED to their memory during this run (created by the
   *  linking upsert OR resolved to a pre-existing semantic identity — EC-3). */
  entitiesCreated: number;
  entitiesSuperseded: number;
}

const MECHANISM_SQL = MECHANISM_TYPES.map((t) => `'${t}'`).join(',');

interface PreLinkRow extends Record<string, unknown> {
  id: string;
  normalized_key: string;
  type: string | null;
}

function bumpSkip(skipped: Record<string, number>, key: string): void {
  skipped[key] = (skipped[key] ?? 0) + 1;
}

function filtersFromRow(t: ReextractTarget): Filters {
  // EC-1 (M8 isolation): the Filters are derived from the SOURCE MEMORY's own
  // scope columns — a re-extracted entity inherits EXACTLY that scope.
  const filters: { workspace_id: string; user_id?: string; session_id?: string; agent_id?: string } = {
    workspace_id: t.workspace_id,
  };
  if (t.user_id !== null) filters.user_id = t.user_id;
  if (t.session_id !== null) filters.session_id = t.session_id;
  if (t.agent_id !== null) filters.agent_id = t.agent_id;
  return filters;
}

async function processTarget(
  t: ReextractTarget,
  deps: ReextractDeps,
  report: ReextractReport,
  done: Set<string>,
): Promise<void> {
  const text = t.text.trim();
  if (text.length < 10) {
    bumpSkip(report.skipped, 'target_skipped_empty');
    done.add(t.id);
    return;
  }
  // EC-4 (#109 precedent): imported memories reach 40K+ chars — cap the LLM input.
  const input = text.slice(0, REEXTRACT_INPUT_MAX_CHARS);
  const filters = filtersFromRow(t);

  // Pre-state: current links (for created-count) + mechanism rows (supersede set).
  const { rows: pre } = await deps.pool.query<PreLinkRow>(
    `/* reextract:pre-links */
     SELECT e.id, e.normalized_key, e.type
       FROM memory_entities me JOIN entities e ON e.id = me.entity_id
      WHERE me.memory_id = $1 AND e.superseded_by IS NULL`,
    [t.id],
  );
  const preIds = new Set(pre.map((r) => r.id));
  const preMechanism = pre.filter((r) => (MECHANISM_TYPES as readonly string[]).includes(r.type ?? ''));

  // LLM re-extraction — same call convention as the write pipeline (Phase 2).
  let parsed: ReturnType<typeof AdditiveExtractionSchema.parse>;
  try {
    const { prompt } = generateAdditiveExtractionPrompt([], [{ role: 'user', content: input }], undefined, deps.ontology);
    report.llmCalls += 1;
    report.estTokens += Math.ceil(prompt.length / 4);
    const raw: unknown = await deps.llm.generateResponse(
      [
        { role: 'system', content: prompt },
        { role: 'user', content: `user: ${input}` },
      ],
      { type: 'json' },
    );
    parsed = AdditiveExtractionSchema.parse(typeof raw === 'string' ? JSON.parse(raw) : raw);
  } catch {
    // Recoverable (timeout/429/bad JSON): typed skip, NOT added to the checkpoint
    // so a resume retries it. The batch never aborts on one memory.
    bumpSkip(report.skipped, 'target_failed_llm');
    return;
  }

  // Coerce against exactly one vocabulary (ADR D1 — same rule as the write path).
  const coerced = applyOntologyToEntities(
    parsed.entities ?? [],
    deps.ontology ?? DEFAULT_ENTITY_TAXONOMY,
    deps.tracer,
  );

  await linkEntities(
    [{ id: t.id, text: input }],
    filters,
    {
      embedder: deps.embedder,
      memoryEntityStore: deps.memoryEntityStore,
      // exactOptionalPropertyTypes: only present keys, never explicit undefined.
      ...(deps.memoryGraphStore !== undefined ? { memoryGraphStore: deps.memoryGraphStore } : {}),
      ...(deps.ontology !== undefined ? { ontology: deps.ontology } : {}),
      ...(deps.tracer !== undefined ? { tracer: deps.tracer } : {}),
    },
    deps.tracer,
    parsed.relations,
    coerced,
  );

  // ADR D2 + EC-3: OLD (mechanism) → NEW = the LIVE semantic row with the SAME
  // normalized_key in the SAME scope (the linking upsert either created it or
  // resolved the pre-existing identity — never a third row).
  for (const old of preMechanism) {
    const { rows: nw } = await deps.pool.query<{ id: string }>(
      `/* reextract:resolve-new */
       SELECT id FROM entities
        WHERE workspace_id = $1
          AND COALESCE(user_id,'') = COALESCE($2,'')
          AND COALESCE(session_id,'') = COALESCE($3,'')
          AND COALESCE(agent_id,'') = COALESCE($4,'')
          AND normalized_key = $5
          AND superseded_by IS NULL
          AND id <> $6
          AND COALESCE(type,'') NOT IN (${MECHANISM_SQL})
        ORDER BY created_at ASC
        LIMIT 1`,
      [t.workspace_id, t.user_id, t.session_id, t.agent_id, old.normalized_key, old.id],
    );
    const newId = nw[0]?.id;
    if (newId !== undefined) {
      const won = await deps.memoryEntityStore.supersedeEntity({
        oldId: old.id,
        newId,
        workspaceId: t.workspace_id,
      });
      if (won) report.entitiesSuperseded += 1;
    }
  }

  const { rows: post } = await deps.pool.query<{ entity_id: string }>(
    `/* reextract:post-links */ SELECT entity_id FROM memory_entities WHERE memory_id = $1`,
    [t.id],
  );
  report.entitiesCreated += post.filter((r) => !preIds.has(r.entity_id)).length;
  report.processed += 1;
  done.add(t.id);
}

export async function runReextract(
  deps: ReextractDeps,
  opts: ReextractOptions,
): Promise<ReextractReport> {
  const start = Date.now();
  const startedAt = new Date().toISOString();
  const checkpointPath = deps.checkpointPath ?? '.reextract-checkpoint.json';
  const done = loadCheckpoint(checkpointPath, opts.resume);

  const report: ReextractReport = {
    targets: 0,
    processed: 0,
    skipped: {},
    llmCalls: 0,
    estTokens: 0,
    durationMs: 0,
    entitiesCreated: 0,
    entitiesSuperseded: 0,
  };

  // Selection (plan Deep analysis): live non-skill memories that either have NO
  // graph at all OR still link a mechanism-labeled (pre-Phase-A) live entity.
  const limitSql = opts.limit !== undefined ? ` LIMIT ${String(Math.max(0, Math.floor(opts.limit)))}` : '';
  const { rows: targets } = await deps.pool.query<ReextractTarget & Record<string, unknown>>(
    `/* reextract:select-targets */
     SELECT m.id, m.text, m.workspace_id, m.user_id, m.session_id, m.agent_id
       FROM memories m
      WHERE m.t_invalid IS NULL
        AND COALESCE(m.kind,'') <> 'skill'
        AND (
          NOT EXISTS (SELECT 1 FROM memory_entities me WHERE me.memory_id = m.id)
          OR EXISTS (SELECT 1 FROM memory_entities me
                       JOIN entities e ON e.id = me.entity_id
                      WHERE me.memory_id = m.id
                        AND e.superseded_by IS NULL
                        AND e.type IN (${MECHANISM_SQL}))
        )
      ORDER BY m.created_at ASC${limitSql}`,
  );
  report.targets = targets.length;

  const pending = targets.filter((t) => {
    if (done.has(t.id)) {
      bumpSkip(report.skipped, 'target_already_done');
      return false;
    }
    return true;
  });

  if (opts.dryRun) {
    // Cost estimate only — ZERO LLM calls, ZERO writes (D3 dry-run contract).
    report.estTokens = pending.reduce(
      (acc, t) => acc + Math.ceil(Math.min(t.text.length, REEXTRACT_INPUT_MAX_CHARS) / 4),
      0,
    );
    report.durationMs = Date.now() - start;
    return report;
  }

  for (const chunk of chunkTargets(pending, opts.chunkSize, opts.chunkMaxBytes)) {
    await mapWithConcurrency(chunk, Math.max(1, opts.concurrency), (t) =>
      processTarget(t, deps, report, done),
    );
    // Single-writer checkpoint append per chunk + Princípio 3 progress event.
    saveCheckpoint(checkpointPath, done, startedAt);
    emitEvent(deps.tracer, 'reextract_chunk_done', {
      chunk_size: chunk.length,
      processed: report.processed,
      superseded: report.entitiesSuperseded,
      llm_calls: report.llmCalls,
    });
  }

  report.durationMs = Date.now() - start;
  return report;
}
