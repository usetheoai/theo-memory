/**
 * Entity/relation LABEL language correction (EG-5). Extends the EG-4 source-language
 * guarantee from the `memory[].text` fact to the extracted `entities[]` names +
 * `relations[]` labels, which the live-test (2026-06-23) showed still drift to a
 * different language than the input (English input → `surfar`/`fins de semana` nodes).
 *
 * Detection is NOT used to gate the correction: entity/relation labels in one
 * extraction are short AND mixed (English nouns next to Portuguese ones), and a
 * language detector classifies the mixed join as the MAJORITY language, so a
 * detect-gate would skip and the wrong-language labels would leak. Instead the
 * correction is ALWAYS-ON (gated only by the caller having a detected INPUT
 * language + ≥1 non-speaker label): ONE corrective LLM call returns a
 * `{ original: translated }` map covering ONLY the labels not already in the target
 * language; the map is applied to entity names AND relation
 * source/relationship/destination — the SAME surface always maps to the SAME
 * translation, so a relation endpoint stays connected to its renamed node
 * (referential integrity). The literal speaker token `user` is never translated.
 *
 * FAIL-SOFT: any error keeps the original labels; the caller never fails `remember()`.
 *
 * @see .claude/knowledge-base/plans/entity-label-language-determinism-plan.md
 */
import type { LLM } from '../dip/llm.js';
import type { Message } from '../message.js';

import type { RelationTriple } from './entity-linking.js';
import type { DetectedLanguage } from './language.js';

/** The speaker node is always the literal token `user` (EG-4 fact rule mirror). */
const SPEAKER_TOKEN = 'user';

/** The LLM-extracted entity shape this module rewrites (matches the pipeline's
 *  inline `llmEntities` type). Named distinctly from the DIP `ExtractedEntity`
 *  (dip/entity-extractor.ts) to avoid a same-name/different-shape clash (F-arch-1). */
export interface LlmEntityLabel {
  readonly name: string;
  readonly type?: string | undefined;
}

export interface LabelCorrectionResult {
  readonly entities: readonly LlmEntityLabel[] | undefined;
  readonly relations: readonly RelationTriple[] | undefined;
  /** Distinct non-speaker labels considered for normalization. */
  readonly labelCount: number;
  /** How many distinct labels were actually rewritten into the target language. */
  readonly corrected: number;
}

function collectDistinctLabels(
  entities: readonly LlmEntityLabel[] | undefined,
  relations: readonly RelationTriple[] | undefined,
): string[] {
  const set = new Set<string>();
  for (const e of entities ?? []) {
    if (e.name !== SPEAKER_TOKEN) set.add(e.name);
  }
  for (const r of relations ?? []) {
    if (r.source !== SPEAKER_TOKEN) set.add(r.source);
    if (r.destination !== SPEAKER_TOKEN) set.add(r.destination);
    set.add(r.relationship); // relationship verbs are never the speaker token
  }
  return [...set];
}

/** Parse the corrective LLM response into a flat string→string map. Accepts the
 *  object shape (OpenAILLM `{type:'json'}`) or a JSON string (stubs/other impls). */
function parseTranslationMap(raw: unknown): Record<string, string> {
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (obj === null || typeof obj !== 'object') {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof v === 'string' && v.trim().length > 0) {
      out[k] = v.trim();
    }
  }
  return out;
}

/**
 * Correct entity/relation labels to the target (input) language. Pure of side
 * effects beyond the single LLM call; returns NEW structures (no mutation).
 */
export async function correctEntityRelationLanguage(
  llm: LLM,
  entities: readonly LlmEntityLabel[] | undefined,
  relations: readonly RelationTriple[] | undefined,
  target: DetectedLanguage,
): Promise<LabelCorrectionResult> {
  const distinct = collectDistinctLabels(entities, relations);
  if (distinct.length === 0) {
    return { entities, relations, labelCount: 0, corrected: 0 };
  }

  // Always-on normalization (D1): ask the model for the target-language form of EVERY
  // label (translating non-target ones, keeping already-target + proper names
  // unchanged). Detect-gating is unreliable for mixed short labels, so we do not gate
  // on label-language detection. Fail-soft on any error.
  let map: Record<string, string> = {};
  try {
    const messages: Message[] = [
      {
        role: 'system',
        content:
          `The user's message is a JSON array of short entity/relationship labels. Return a JSON object ` +
          `with EVERY label as a key, mapping it to its ${target.name} form: translate labels that are ` +
          `in another language into ${target.name}; keep labels already in ${target.name} unchanged; keep ` +
          'proper names (people, organizations, products, places) unchanged. Use the EXACT original string ' +
          'as each key. Return ONLY the JSON object, no commentary.',
      },
      { role: 'user', content: JSON.stringify(distinct) },
    ];
    const raw = await llm.generateResponse(messages, { type: 'json' });
    map = parseTranslationMap(raw);
  } catch {
    // fail-soft: keep originals.
    return { entities, relations, labelCount: distinct.length, corrected: 0 };
  }

  let corrected = 0;
  for (const label of distinct) {
    const t = map[label];
    if (t !== undefined && t !== label) corrected += 1;
  }

  // Never translate the speaker token; and never let a label map ONTO the speaker
  // token (F-dom-8: a wrong translation to "user" would over-merge into the speaker node).
  const apply = (s: string): string => {
    if (s === SPEAKER_TOKEN) return s;
    const t = map[s];
    return t === undefined || t === SPEAKER_TOKEN ? s : t;
  };

  const newEntities = entities?.map((e) => ({ ...e, name: apply(e.name) }));
  const newRelations = relations?.map((r) => ({
    source: apply(r.source),
    relationship: apply(r.relationship),
    destination: apply(r.destination),
  }));

  return {
    entities: newEntities,
    relations: newRelations,
    labelCount: distinct.length,
    corrected,
  };
}
