import { evidenceFromPayload } from '../../domain/memory-evidence.js';
/**
 * Shared row→MemoryItem mapping extracted from `scoped-memory.ts` (M8 T0 refactor).
 * `getAll` and `episodes` had the IDENTICAL mapping block (the DUPLICATE BLOCK the
 * quality gate flagged); this is the single authoritative version.
 *
 * dashboard-memories-tab-standardization T2.2 + ADR D2 + EC-7: consume a projected
 * `createdAt` when the adapter provides it; fall back to `new Date()` ONLY when
 * undefined, and count the fallbacks in one pass so the caller emits ONE
 * `getall_temporal_fallback` event (never per-row).
 */
import type { MemoryItem } from '../../domain/memory-item.js';
import type { Scope } from '../../domain/scope.js';

/**
 * Structural shape of a store row consumed by the list/episodes read paths —
 * matches `VectorStoreResult` (payload is the persisted-value union, so the mapped
 * `metadata` is assignable to `MemoryItem.metadata`).
 */
export interface MappableRow {
  readonly id: string;
  readonly payload: Readonly<Record<string, string | number | boolean | null>>;
  readonly createdAt?: Date;
}

/**
 * Map store rows to `MemoryItem`s, synthesizing `createdAt` for rows the adapter
 * did not project. Returns the items plus the count of synthesized rows so the
 * caller can emit a single aggregated temporal-fallback event (EC-7).
 */
export function rowsToMemoryItems(
  rows: readonly MappableRow[],
  scope: Scope,
): { items: MemoryItem[]; fallbackCount: number } {
  let fallbackCount = 0;
  const items: MemoryItem[] = rows.map((r) => {
    let createdAt = r.createdAt;
    if (createdAt === undefined) {
      fallbackCount += 1;
      createdAt = new Date();
    }
    // updatedAt + tValid mirror createdAt: under ADR-0003 ADD-only there is no
    // separate mutation timestamp; under D2 fallback, mirroring avoids a SECOND
    // synthesizer that would bypass the OTel audit.
    return {
      id: r.id,
      text: String(r.payload['text'] ?? ''),
      hash: String(r.payload['hash'] ?? r.id),
      scope,
      createdAt,
      updatedAt: createdAt,
      metadata: { ...r.payload },
        tValid: createdAt,
      tInvalid: null,
      ...evidenceFromPayload(r.payload),
    };
  });
  return { items, fallbackCount };
}
