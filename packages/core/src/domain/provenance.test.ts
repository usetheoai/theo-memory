/**
 * T4.2 tests for validateProvenance per plan v0-4a-reflection-pipeline.
 *
 */
import { describe, expect, test } from 'vitest';

import { ReflectionProvenanceMissingError } from './errors.js';
import { validateProvenance } from './reflection/provenance.js';
import type { DerivedMemoryDraft } from './reflection/types.js';

describe('validateProvenance (T4.2)', () => {
  test('happy path: drafts citing only source-set IDs succeed', () => {
    const sourceIds = ['m1', 'm2', 'm3'];
    const drafts: DerivedMemoryDraft[] = [
      { text: 'insight A', derivedFrom: ['m1', 'm2'] },
      { text: 'insight B', derivedFrom: ['m3'] },
    ];
    expect(() => validateProvenance(drafts, sourceIds)).not.toThrow();
  });

  test('empty drafts array is a no-op (no throw)', () => {
    expect(() => validateProvenance([], ['m1'])).not.toThrow();
  });

  test('sad path: draft with empty derivedFrom throws ReflectionProvenanceMissingError', () => {
    const sourceIds = ['m1', 'm2'];
    const drafts: DerivedMemoryDraft[] = [{ text: 'orphan', derivedFrom: [] }];
    expect(() => validateProvenance(drafts, sourceIds)).toThrow(ReflectionProvenanceMissingError);
  });

  test('sad path: draft.derivedFrom referencing unknown id throws', () => {
    const sourceIds = ['m1', 'm2'];
    const drafts: DerivedMemoryDraft[] = [{ text: 'fabricated', derivedFrom: ['fake-id'] }];
    expect(() => validateProvenance(drafts, sourceIds)).toThrow(ReflectionProvenanceMissingError);
  });

  test('error message includes the unknown IDs', () => {
    const sourceIds = ['m1'];
    const drafts: DerivedMemoryDraft[] = [{ text: 'bad', derivedFrom: ['unknown1', 'unknown2'] }];
    try {
      validateProvenance(drafts, sourceIds);
      expect.fail('expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ReflectionProvenanceMissingError);
      const e = err as ReflectionProvenanceMissingError;
      expect(e.unknownIds).toEqual(['unknown1', 'unknown2']);
      expect(e.message).toContain('unknown1');
      expect(e.message).toContain('unknown2');
    }
  });

  test('error exposes offendingDraftIndex', () => {
    const sourceIds = ['m1'];
    const drafts: DerivedMemoryDraft[] = [
      { text: 'ok', derivedFrom: ['m1'] },
      { text: 'bad', derivedFrom: ['ghost'] },
    ];
    try {
      validateProvenance(drafts, sourceIds);
      expect.fail('expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ReflectionProvenanceMissingError);
      const e = err as ReflectionProvenanceMissingError;
      expect(e.offendingDraftIndex).toBe(1);
    }
  });

  test('throws on FIRST violation; later drafts not inspected', () => {
    const sourceIds = ['m1'];
    const drafts: DerivedMemoryDraft[] = [
      { text: 'first-bad', derivedFrom: [] },
      { text: 'also-bad', derivedFrom: ['fake'] },
    ];
    try {
      validateProvenance(drafts, sourceIds);
      expect.fail('expected to throw');
    } catch (err) {
      const e = err as ReflectionProvenanceMissingError;
      expect(e.offendingDraftIndex).toBe(0);
    }
  });

  test('mixed valid+invalid IDs in same derivedFrom array still throws', () => {
    const sourceIds = ['m1', 'm2'];
    const drafts: DerivedMemoryDraft[] = [
      { text: 'mixed', derivedFrom: ['m1', 'unknown', 'm2'] },
    ];
    try {
      validateProvenance(drafts, sourceIds);
      expect.fail('expected to throw');
    } catch (err) {
      const e = err as ReflectionProvenanceMissingError;
      expect(e.unknownIds).toEqual(['unknown']);
    }
  });
});
