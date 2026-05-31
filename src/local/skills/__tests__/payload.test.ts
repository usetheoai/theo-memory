/**
 * T3.3 unit tests for `decodeSkillPayload` — extracted DRY helper closing F9
 * AND absorbing v1.1 EC-1 (codeLanguage / code may be NULL on derived skills
 * post-T0.2; the decoder MUST accept that shape so derived skills don't get
 * silently filtered out of recall + Orient phase).
 *
 * Total: 6 tests (4 F9 + 2 EC-1).
 *
 * @see .claude/knowledge-base/plans/voyager-skill-library-fixes-v0-6-1-plan.md § T3.3
 */
import { describe, expect, test } from 'vitest';

import type { Scope } from '../../../core/scope.js';
import { decodeSkillPayload } from '../payload.js';

const SCOPE: Scope = { kind: 'repo', repoId: 'repo-x' };

describe('decodeSkillPayload — F9 (extracted DRY) + EC-1 (null code/codeLanguage)', () => {
  test('valid skill payload (code + codeLanguage non-null) decodes to Skill', () => {
    const result = decodeSkillPayload(
      'sk-1',
      {
        kind: 'skill',
        hash: 'h-1',
        code: 'export const x = 1;',
        description: 'helper x',
        code_language: 'typescript',
      },
      SCOPE,
    );
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('skill');
    expect(result?.code).toBe('export const x = 1;');
    expect(result?.description).toBe('helper x');
    expect(result?.codeLanguage).toBe('typescript');
    expect(result?.derivedFrom).toEqual([]);
    expect(result?.supersededBy).toBeNull();
  });

  test('payload with kind !== \'skill\' returns null', () => {
    const result = decodeSkillPayload('mem-1', { kind: 'extracted', text: 'x' }, SCOPE);
    expect(result).toBeNull();
  });

  test('malformed derived_from JSON falls back to empty array (graceful)', () => {
    const result = decodeSkillPayload(
      'sk-2',
      {
        kind: 'skill',
        hash: 'h-2',
        code: 'x',
        description: 'desc',
        code_language: 'typescript',
        derived_from: 'not-valid-json',
      },
      SCOPE,
    );
    expect(result).not.toBeNull();
    expect(result?.derivedFrom).toEqual([]);
  });

  test('score parameter populates SkillWithScore.score', () => {
    const result = decodeSkillPayload(
      'sk-3',
      {
        kind: 'skill',
        hash: 'h-3',
        code: 'x',
        description: 'desc',
        code_language: 'javascript',
      },
      SCOPE,
      0.87,
    );
    expect(result?.score).toBe(0.87);
  });

  // === EC-1 absorption (v1.1) — derived skills carry NULL code + codeLanguage ===

  test('EC-1: payload with code = null AND code_language = null decodes to Skill (NOT null)', () => {
    const result = decodeSkillPayload(
      'sk-derived-1',
      {
        kind: 'skill',
        hash: 'h-derived',
        code: null,
        description: 'merged narrative',
        code_language: null,
        derived_from: JSON.stringify(['src-a', 'src-b']),
      },
      SCOPE,
    );
    expect(result).not.toBeNull();
    expect(result?.code).toBeNull();
    expect(result?.codeLanguage).toBeNull();
    expect(result?.description).toBe('merged narrative');
    expect(result?.derivedFrom).toEqual(['src-a', 'src-b']);
  });

  test('EC-1: payload with code_language undefined (column missing) decodes to Skill (NOT null)', () => {
    const result = decodeSkillPayload(
      'sk-derived-2',
      {
        kind: 'skill',
        hash: 'h-derived-2',
        description: 'another merged',
        derived_from: JSON.stringify(['src-c', 'src-d']),
      },
      SCOPE,
    );
    expect(result).not.toBeNull();
    expect(result?.code).toBeNull();
    expect(result?.codeLanguage).toBeNull();
  });
});
