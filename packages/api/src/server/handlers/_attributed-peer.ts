/**
 * Shared helper for the subject-scoped metrics + entities aggregation handlers.
 *
 * Reads a memory's attributed peer. `ScopedMemory.getAll()` projects the
 * `attributed_to` column into `MemoryItem.metadata` (NOT the top-level
 * `attributedTo` field), so metadata is the source of truth with the top-level
 * field as a fallback (stubs / future shapes). Returns undefined for
 * null / empty-string / missing / non-string.
 *
 * Extracted from metrics.ts + entities.ts per /review F-arch-3 (DRY — the
 * metadata-vs-top-level precedence is one business rule, not two copies).
 *
 * @see .claude/knowledge-base/reviews/dashboard-phase2a-attribution-asof-review-2026-06-19.md § F-arch-3
 */
export function attributedPeerOf(m: {
  attributedTo?: string;
  metadata?: Readonly<Record<string, unknown>>;
}): string | undefined {
  if (typeof m.attributedTo === 'string' && m.attributedTo !== '') return m.attributedTo;
  const fromMeta = m.metadata?.['attributed_to'];
  if (typeof fromMeta === 'string' && fromMeta !== '') return fromMeta;
  return undefined;
}
