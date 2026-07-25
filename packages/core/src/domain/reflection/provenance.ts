/**
 * Provenance validator for reflection drafts per plan v0-4a-reflection-pipeline § T4.2 + ADR D7.
 *
 * Given DerivedMemoryDraft[] + the source-memory IDs sent to the LLM, asserts:
 *   (a) every draft.derivedFrom is non-empty (at least one citation)
 *   (b) every ID in draft.derivedFrom appears in the source set (no LLM-hallucinated IDs)
 *
 * Throws ReflectionProvenanceMissingError on the FIRST offending draft so the
 * caller can roll back the in-flight reflection cycle with a typed error.
 *
 * Performance: source IDs pre-built into a Set for O(1) lookup; total O(N drafts × M citations).
 *
 */
import { ReflectionProvenanceMissingError } from '../errors.js';

import type { DerivedMemoryDraft } from './types.js';

/**
 * M24 T3.2 (#145) — non-throwing per-draft provenance predicate.
 *
 * A draft is valid iff its `derivedFrom` is non-empty AND every cited id is in
 * the source set. Same rule `validateProvenance` enforces, expressed as a
 * boolean so the reflect path can QUARANTINE one bad draft (skip + emit event)
 * instead of aborting the whole reflect (Rule 8 recoverable-vs-unrecoverable).
 */
export function isDraftProvenanceValid(
  draft: DerivedMemoryDraft,
  sourceIds: readonly string[],
): boolean {
  if (draft.derivedFrom.length === 0) {
    return false;
  }
  const sourceSet = new Set(sourceIds);
  return draft.derivedFrom.every((id) => sourceSet.has(id));
}

/**
 * Validates every draft's `derivedFrom` array against the source-set IDs.
 *
 * Throws on the FIRST violation found. Returns void on success.
 */
export function validateProvenance(
  drafts: readonly DerivedMemoryDraft[],
  sourceIds: readonly string[],
): void {
  const sourceSet = new Set(sourceIds);
  for (let i = 0; i < drafts.length; i++) {
    const draft = drafts[i];
    if (draft === undefined) {
      continue;
    }
    if (draft.derivedFrom.length === 0) {
      throw new ReflectionProvenanceMissingError(
        i,
        [],
        'draft has empty derivedFrom array (must cite at least one source memory id)',
      );
    }
    const unknown: string[] = [];
    for (const id of draft.derivedFrom) {
      if (!sourceSet.has(id)) {
        unknown.push(id);
      }
    }
    if (unknown.length > 0) {
      throw new ReflectionProvenanceMissingError(
        i,
        unknown,
        'draft.derivedFrom references unknown ids not present in source set',
      );
    }
  }
}
