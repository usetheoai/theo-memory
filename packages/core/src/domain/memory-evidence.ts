import { z } from 'zod';

import type { VectorStore } from './dip/vector-store.js';
import { InvalidScope } from './errors.js';
import type { MemoryItem } from './memory-item.js';
import type { Filters } from './scope.js';

/**
 * Evidence describes how a memory was obtained, never whether it is authoritative.
 * A stated purchase remains a statement; the purchase system owns its confirmation.
 * Confidence is a subjective estimate, not a calibrated probability.
 * @see docs/memory-semantics.md
 */
export const MemoryEvidenceSchema = z.object({
  kind: z.enum(['stated', 'inferred', 'observed']),
  originSourceId: z.string().trim().min(1).max(512).optional(),
  sourceId: z.string().trim().min(1).max(512).optional(),
  sourceQuote: z.string().trim().min(1).max(4000).optional(),
  modality: z.enum(['text', 'audio', 'video']).optional(),
  confidence: z.number().finite().min(0).max(1).optional(),
}).strict();

/** Evidence attached to a contextual memory; absence means unknown on legacy rows. */
export type MemoryEvidence = z.infer<typeof MemoryEvidenceSchema>;

/** Reserved primitive payload field; JSON keeps the existing flat metadata contract. */
export const MEMORY_EVIDENCE_KEY = 'theo_memory_evidence';

/** Validate SDK input before any I/O. REST and MCP use the same schema. */
export function validateMemoryEvidence(value: unknown): MemoryEvidence {
  const parsed = MemoryEvidenceSchema.safeParse(value);
  if (!parsed.success) throw new InvalidScope('Invalid memory evidence.');
  return parsed.data;
}

/** Old or externally written rows with invalid evidence retain unknown provenance. */
export function evidenceFromPayload(
  payload: Readonly<Record<string, string | number | boolean | null>>,
): { readonly evidence?: MemoryEvidence; readonly expiresAt?: Date | null; readonly confirmationCount?: number; readonly distinctSourceCount?: number | null; readonly tValid?: Date | null; readonly tInvalid?: Date | null } {
  const lifecycle = {
    ...(typeof payload['confirmation_count'] === 'number' ? { confirmationCount: payload['confirmation_count'] } : {}),
    ...(payload['t_valid'] === null ? { tValid: null } : typeof payload['t_valid'] === 'string' ? { tValid: new Date(payload['t_valid']) } : {}),
    ...(payload['t_invalid'] === null ? { tInvalid: null } : typeof payload['t_invalid'] === 'string' ? { tInvalid: new Date(payload['t_invalid']) } : {}),
    ...(payload['expires_at'] === null ? { expiresAt: null } : typeof payload['expires_at'] === 'string' ? { expiresAt: new Date(payload['expires_at']) } : {}),
    ...(typeof payload['distinct_source_count'] === 'number' || payload['distinct_source_count'] === null
      ? { distinctSourceCount: payload['distinct_source_count'] } : {}),
  };
  if (payload['kind'] === 'derived') return { ...lifecycle, evidence: { kind: 'inferred' } };
  const raw = payload[MEMORY_EVIDENCE_KEY];
  if (typeof raw !== 'string') return lifecycle;
  let decoded: unknown;
  try { decoded = JSON.parse(raw); } catch { return lifecycle; }
  const parsed = MemoryEvidenceSchema.safeParse(decoded);
  return parsed.success ? { ...lifecycle, evidence: parsed.data } : lifecycle;
}

/** Stamp provenance after caller metadata so a flat field cannot impersonate evidence. */
export function attachEvidence(
  payload: Record<string, string | number | boolean | null>,
  evidence: MemoryEvidence | undefined,
): void {
  delete payload[MEMORY_EVIDENCE_KEY];
  if (evidence !== undefined) payload[MEMORY_EVIDENCE_KEY] = JSON.stringify(evidence);
}

/** Dedup retains the first row's evidence; do not report a new citation as persisted. */
export async function restoreDuplicateEvidence(
  items: readonly MemoryItem[],
  store: Pick<VectorStore, 'get'>,
): Promise<readonly MemoryItem[]> {
  return Promise.all(items.map(async (item) => {
    if (item.rejectedAsDuplicate !== true) return item;
    const existing = await store.get(item.id);
    if (existing === null) throw new Error('Deduplicated memory disappeared before evidence could be read.');
    const { evidence: _evidence, ...rest } = item;
    const metadata = { ...existing.payload };
    return { ...rest, text: String(existing.payload['text'] ?? item.text), hash: String(existing.payload['hash'] ?? item.hash),
      ...(existing.createdAt !== undefined ? { createdAt: existing.createdAt, updatedAt: existing.createdAt } : {}),
      metadata, ...evidenceFromPayload(existing.payload) };
  }));
}

export interface MemoryEvidencePage {
  readonly items: readonly { readonly evidenceId: string; readonly originSourceId: string;
    readonly evidence: MemoryEvidence; readonly createdAt: Date }[];
  readonly nextOffset?: number;
}

export interface MemoryEvidenceReader {
  list(memoryId: string, filters: Filters, options?: { limit?: number; offset?: number }): Promise<MemoryEvidencePage>;
}
