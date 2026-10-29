/**
 * M24 T3.2 (#145) — reflect draft persistence with per-draft provenance
 * quarantine.
 *
 * Extracted from `reflect-orchestrator.ts` (keeping it under the 300-LoC budget).
 * The old path called `validateProvenance`, which THROWS on the first bad draft
 * and aborts the whole reflect — the M23 bench hit this twice. Per Rule 8
 * (recoverable vs unrecoverable), one hallucinated `derivedFrom` id must not
 * discard the otherwise-good drafts: skip it (emit `reflection_draft_quarantined`
 * + a counter, Princípio 3) and persist the valid drafts.
 */
import { metrics, type Counter, type Tracer } from '@opentelemetry/api';

import type { Embedder } from '../../domain/dip/embedder.js';
import type { VectorStoreResult } from '../../domain/dip/vector-store.js';
import { emitEvent } from '../../domain/memory-event.js';
import { evidenceFromPayload } from '../../domain/memory-evidence.js';
import type { MemoryItem } from '../../domain/memory-item.js';
import { isDraftProvenanceValid } from '../../domain/reflection/provenance.js';
import type { DerivedMemoryDraft } from '../../domain/reflection/types.js';
import type { Scope } from '../../domain/scope.js';

/** The store surface reflect draft-persistence consumes. */
export interface VectorStoreWithDerivedInsert {
  get?(memoryId: string): Promise<VectorStoreResult | null>;
  insertDerivedMemory(args: {
    text: string;
    hash: string;
    embedding: readonly number[];
    derivedFrom: readonly string[];
    scope: {
      workspaceId?: string | null;
      userId?: string | null;
      sessionId?: string | null;
      agentId?: string | null;
    };
  }): Promise<string>;
}

interface CounterTuple {
  readonly userId: string | null;
  readonly sessionId: string | null;
  readonly agentId: string | null;
}

const QUARANTINE_COUNTER = 'theo.memory.reflection.draft_quarantined';
let quarantineCounter: Counter | undefined;
function getQuarantineCounter(): Counter {
  quarantineCounter ??= metrics.getMeter('@usetheo/memory').createCounter(QUARANTINE_COUNTER);
  return quarantineCounter;
}

/**
 * Embed + persist every provenance-valid draft; quarantine the invalid ones.
 * Returns the persisted items plus the quarantine count. Never throws on a bad
 * draft — an all-invalid batch simply persists nothing (caller returns a
 * no-consolidation result).
 */
export async function persistDraftsWithQuarantine(args: {
  readonly drafts: readonly DerivedMemoryDraft[];
  readonly sourceIds: readonly string[];
  readonly embedder: Embedder;
  readonly store: VectorStoreWithDerivedInsert;
  readonly scope: Scope;
  readonly counterTuple: CounterTuple;
  readonly workspaceId: string | null;
  readonly tracer: Tracer | undefined;
}): Promise<{ readonly persisted: MemoryItem[]; readonly quarantined: number }> {
  const { drafts, sourceIds, embedder, store, scope, counterTuple, workspaceId, tracer } = args;
  const persisted: MemoryItem[] = [];
  let quarantined = 0;

  for (let i = 0; i < drafts.length; i += 1) {
    const draft = drafts[i];
    if (draft === undefined) {
      continue;
    }
    if (!isDraftProvenanceValid(draft, sourceIds)) {
      quarantined += 1;
      getQuarantineCounter().add(1);
      emitEvent(tracer, 'reflection_draft_quarantined', {
        scope_tier: scope.kind,
        draft_index: i,
      });
      continue;
    }
    const embedding = await embedder.embed(draft.text);
    const hash = `derived-${String(Date.now())}-${String(Math.random()).slice(2, 8)}`;
    const id = await store.insertDerivedMemory({
      text: draft.text,
      hash,
      embedding,
      derivedFrom: draft.derivedFrom,
      // The reflection-derived row stays in the SAME workspace as its sources.
      scope: { ...counterTuple, workspaceId },
    });
    const row = await store.get?.(id);
    const metadata = row?.payload ?? { kind: 'derived' };
    persisted.push({
      id,
      text: draft.text,
      hash,
      scope,
      metadata,
      evidence: { kind: 'inferred' },
      createdAt: new Date(),
      updatedAt: new Date(),
      tValid: new Date(),
      tInvalid: null,
      ...evidenceFromPayload(metadata),
    });
  }

  return { persisted, quarantined };
}
