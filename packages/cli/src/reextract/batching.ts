/**
 * Reextract batching mechanics (M13 T3.1, #111 — blueprint ADR D3).
 *
 * Pure/IO primitives the engine orchestrates: count+bytes chunking, the file
 * checkpoint (resume), and the bounded-concurrency semaphore. Split from
 * engine.ts per the 300-line module budget (SRP: mechanics here, orchestration
 * there).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export interface ReextractTarget {
  readonly id: string;
  readonly text: string;
  readonly workspace_id: string;
  readonly user_id: string | null;
  readonly session_id: string | null;
  readonly agent_id: string | null;
}

/** EC-4 input cap — mirrors the #109 embedder precedent value (EMBED_INPUT_MAX_CHARS). */
export const REEXTRACT_INPUT_MAX_CHARS = 16000;

/** Mechanism labels the M13 DoD zeroes (pre-Phase-A write path). */
export const MECHANISM_TYPES = ['PROPER', 'COMPOUND', 'QUOTED'] as const;

export class ReextractCheckpointCorrupted extends Error {}

/** Count+bytes chunking (D3): closes at `size` items OR `maxBytes` total; a single
 *  item above the byte cap gets its OWN chunk (processed, never silently skipped). */
export function chunkTargets(
  targets: readonly ReextractTarget[],
  size: number,
  maxBytes: number,
): readonly (readonly ReextractTarget[])[] {
  const chunks: ReextractTarget[][] = [];
  let current: ReextractTarget[] = [];
  let currentBytes = 0;
  for (const t of targets) {
    const bytes = Buffer.byteLength(t.text, 'utf8');
    if (current.length > 0 && (current.length >= size || currentBytes + bytes > maxBytes)) {
      chunks.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(t);
    currentBytes += bytes;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** Fail-loud checkpoint load (Deep Dives negative case): a corrupted file is a
 *  typed error with the `--restart` instruction — never a silent full re-run. */
export function loadCheckpoint(path: string, resume: boolean): Set<string> {
  if (!resume || !existsSync(path)) return new Set();
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    const doneRaw = (parsed as { done?: unknown }).done;
    if (!Array.isArray(doneRaw) || doneRaw.some((d) => typeof d !== 'string')) {
      throw new Error('shape');
    }
    return new Set(doneRaw as string[]);
  } catch {
    throw new ReextractCheckpointCorrupted(
      `reextract checkpoint at ${path} is corrupted — fix the file or run with --restart to start over`,
    );
  }
}

export function saveCheckpoint(path: string, done: ReadonlySet<string>, startedAt: string): void {
  writeFileSync(path, JSON.stringify({ done: [...done], startedAt }));
}

/** Bounded in-flight map (semaphore). `fn` never rejects (per-target try/catch). */
export async function mapWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const executing = new Set<Promise<void>>();
  for (const item of items) {
    const p: Promise<void> = fn(item).finally(() => executing.delete(p));
    executing.add(p);
    if (executing.size >= limit) await Promise.race(executing);
  }
  await Promise.all(executing);
}
