/**
 * M27 T4.1 — one-shot cleanup of already-stored write-quality pollution.
 *
 * The dogfound pollution (transcript dumps, questions, first-person voice) predates the
 * T1.1/T2.1 write-path fix. This retires those rows REVERSIBLY: `forget(id)` is a soft-delete
 * (`t_invalid`), never a hard-delete (ADR-3), a dry-run reports first, and each retirement
 * emits an audit event (Princípio 3). Conservative — reuses the same `isNonDurableFact` net as
 * the live gate, plus a multi-paragraph "dump" heuristic.
 */
import { isNonDurableFact } from '../domain/extraction/fact-gate.js';
import type { MemoryItem } from '../domain/memory-item.js';
import { emitEvent } from '../domain/memory-event.js';
import type { Tracer } from '@opentelemetry/api';

export type PollutionReason = 'non_fact' | 'dump';

export interface CleanupCandidate {
  readonly id: string;
  readonly reason: PollutionReason;
}

/** A stored row is a multi-paragraph transcript dump (not an atomic fact). */
export function isDumpMemory(text: string): boolean {
  const t = text.trim();
  if (t.length <= 400) return false;
  const sentenceBreaks = (t.match(/[.!?]\s/g) ?? []).length;
  return sentenceBreaks >= 3 || t.includes('\n');
}

/** Classify a stored row's pollution, or null when it is a clean durable fact. */
export function classifyPollution(text: string): PollutionReason | null {
  if (isNonDurableFact(text)) return 'non_fact';
  if (isDumpMemory(text)) return 'dump';
  return null;
}

/** Pure: the polluted rows among a stored set (dry-run report basis). */
export function findPollutedMemories(items: readonly MemoryItem[]): readonly CleanupCandidate[] {
  const out: CleanupCandidate[] = [];
  for (const m of items) {
    const reason = classifyPollution(m.text);
    if (reason !== null) out.push({ id: m.id, reason });
  }
  return out;
}

export interface CleanupDeps {
  /** List the currently-valid rows in the target scope. */
  readonly list: () => Promise<readonly MemoryItem[]>;
  /** Soft-delete one row by id (sets `t_invalid`; reversible). */
  readonly forget: (id: string) => Promise<void>;
  readonly tracer?: Tracer | undefined;
}

export interface CleanupResult {
  readonly candidates: readonly CleanupCandidate[];
  readonly forgotten: readonly string[];
  readonly skipped: readonly string[];
  readonly dryRun: boolean;
}

/**
 * Run the cleanup. `dryRun` (default true) only reports; without it, each candidate is
 * soft-deleted, an audit event is emitted per retirement, and a per-row failure is skipped
 * (graceful degradation) rather than aborting the run.
 */
export async function cleanupWriteQuality(
  deps: CleanupDeps,
  opts?: { readonly dryRun?: boolean },
): Promise<CleanupResult> {
  const dryRun = opts?.dryRun ?? true;
  const items = await deps.list();
  const candidates = findPollutedMemories(items);
  if (dryRun) {
    return { candidates, forgotten: [], skipped: [], dryRun: true };
  }
  const forgotten: string[] = [];
  const skipped: string[] = [];
  for (const c of candidates) {
    try {
      await deps.forget(c.id);
      forgotten.push(c.id);
      emitEvent(deps.tracer, 'write_quality_cleanup_forgot', { reason: c.reason });
    } catch {
      skipped.push(c.id);
      emitEvent(deps.tracer, 'write_quality_cleanup_skipped', { id: c.id });
    }
  }
  return { candidates, forgotten, skipped, dryRun: false };
}
