/**
 * v0.6.1 — DRY helper for decoding a payload Record into a Skill row shape.
 *
 * Closes F9 (DRY violation: `payloadToSkill` and `rowToSkill` previously had
 * identical inline implementations in `src/local/scoped-skill-memory.ts` and
 * `src/local/skills/consolidate.ts`).
 *
 * Absorbs v1.1 EC-1 (codeLanguage / code may be NULL on derived skills post
 * skill-library-fixes-v0-6-1 plan T0.2). The decoder accepts
 * `code_language` ∈ `{null, undefined, 'typescript', 'javascript'}` when
 * `kind === 'skill'` so derived skills (which carry NULL) are not silently
 * filtered out of recall + the consolidate Orient phase. Same handling for
 * `code` — propagate NULL straight through instead of coercing to `''`.
 *
 * @see .claude/knowledge-base/plans/skill-library-fixes-v0-6-1-plan.md § T3.3 + EC-1
 */
import type { Scope } from '../../../domain/scope.js';
import type { Skill, SkillLanguage, SkillWithScore } from '../../../domain/skill.js';

type Payload = Readonly<Record<string, string | number | boolean | null>>;

/**
 * Project a store-row payload into a `Skill` (or `SkillWithScore` when `score`
 * is supplied). Returns `null` when the payload is not a skill row or its
 * `code_language` is corrupted to a non-allowed positive string.
 *
 * Acceptance predicate for `code_language`:
 *   `null | undefined | 'typescript' | 'javascript'`
 *
 * Rejection: positive non-matching string (e.g. `'python'`) — signals row
 * corruption + caller should fall through without crashing.
 */
export function decodeSkillPayload(
  id: string,
  payload: Payload,
  scope: Scope,
  score?: number,
): SkillWithScore | null {
  if (payload['kind'] !== 'skill') {
    return null;
  }
  const codeLanguageRaw = payload['code_language'];
  // EC-1 absorption (v1.1): NULL / undefined are valid (derived skills) AND
  // the two known string values are valid. Anything else is row corruption.
  if (
    codeLanguageRaw != null
    && codeLanguageRaw !== 'typescript'
    && codeLanguageRaw !== 'javascript'
  ) {
    return null;
  }
  const codeLanguage: SkillLanguage | null = codeLanguageRaw ?? null;
  const code: string | null = payload['code'] == null ? null : String(payload['code']);

  const supersededByRaw = payload['superseded_by'];
  const supersededBy =
    typeof supersededByRaw === 'string' && supersededByRaw.length > 0 ? supersededByRaw : null;

  const derivedFromRaw = payload['derived_from'];
  let derivedFrom: readonly string[] = [];
  if (typeof derivedFromRaw === 'string' && derivedFromRaw.length > 0) {
    try {
      const parsed: unknown = JSON.parse(derivedFromRaw);
      if (Array.isArray(parsed)) {
        derivedFrom = parsed.filter((s): s is string => typeof s === 'string');
      }
    } catch {
      derivedFrom = [];
    }
  }

  const description = String(payload['description'] ?? '');
  const skill: Skill = {
    id,
    text: description,
    hash: String(payload['hash'] ?? id),
    scope,
    createdAt: new Date(),
    updatedAt: new Date(),
    metadata: { ...payload },
    tValid: new Date(),
    tInvalid: null,
    kind: 'skill',
    code,
    description,
    codeLanguage,
    supersededBy,
    derivedFrom,
  };
  return { ...skill, score: score ?? 0 };
}
