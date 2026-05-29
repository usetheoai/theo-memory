/**
 * Reflection executor — orchestrates prompt build + LLM call + JSON parse.
 *
 * Per plan v0-4a-reflection-pipeline § T4.1 + ADR D11.
 *
 * Empty-source short-circuit (EC-5): when sourceMemories.length === 0, returns
 * `[]` WITHOUT calling the LLM. Saves an unnecessary roundtrip + cost.
 *
 * Valid-JSON-empty-array success path (EC-13): when LLM returns `[]`, treated
 * as success — "no consolidation possible". NOT an error.
 *
 * Context-window overflow (EC-18): NOT handled in v0.4a; see
 * F-reflect-context-window-fallback in the plan Followups table.
 *
 * @see .claude/knowledge-base/plans/v0-4a-reflection-pipeline-plan.md § T4.1
 */
import { ReflectionLLMResponseError } from '../errors.js';
import type { Role } from '../message.js';

import { buildReflectionPrompt } from './prompt.js';
import type {
  DerivedMemoryDraft,
  ReflectionExecuteContext,
} from './types.js';

interface RawDraftCandidate {
  text?: unknown;
  derived_from?: unknown;
}

function parseDraftsResponse(raw: string): DerivedMemoryDraft[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ReflectionLLMResponseError(raw, 'response is not valid JSON', { cause: err });
  }
  if (!Array.isArray(parsed)) {
    throw new ReflectionLLMResponseError(raw, 'response is not a JSON array');
  }
  const drafts: DerivedMemoryDraft[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const candidate = parsed[i] as RawDraftCandidate;
    if (typeof candidate !== 'object' || candidate === null) {
      throw new ReflectionLLMResponseError(raw, `draft[${String(i)}] is not an object`);
    }
    if (typeof candidate.text !== 'string') {
      throw new ReflectionLLMResponseError(raw, `draft[${String(i)}].text is not a string`);
    }
    if (!Array.isArray(candidate.derived_from)) {
      throw new ReflectionLLMResponseError(raw, `draft[${String(i)}].derived_from is not an array`);
    }
    const ids: string[] = [];
    const derivedFromArray = candidate.derived_from as unknown[];
    for (let j = 0; j < derivedFromArray.length; j++) {
      const id = derivedFromArray[j];
      if (typeof id !== 'string') {
        throw new ReflectionLLMResponseError(
          raw,
          `draft[${String(i)}].derived_from[${String(j)}] is not a string`,
        );
      }
      ids.push(id);
    }
    drafts.push({ text: candidate.text, derivedFrom: ids });
  }
  return drafts;
}

/**
 * Execute the reflection pipeline: build prompt → call LLM → parse JSON response.
 *
 * Provenance validation (T4.2) is OUT of this function's scope; caller invokes
 * `validateProvenance` separately so the staged drafts can be inspected before
 * persistence.
 *
 * @returns array of DerivedMemoryDraft (may be empty per EC-13)
 */
export async function executeReflection(
  ctx: ReflectionExecuteContext,
): Promise<DerivedMemoryDraft[]> {
  // EC-5: empty-source short-circuit BEFORE LLM call
  if (ctx.sourceMemories.length === 0) {
    return [];
  }

  const promptText = buildReflectionPrompt(ctx.scope, ctx.sourceMemories);
  const SYSTEM_ROLE: Role = 'system';
  const response = await ctx.llm.generateChat([
    { role: SYSTEM_ROLE, content: promptText },
  ]);

  // EC-13: LLM returning '[]' is success (no consolidation possible)
  return parseDraftsResponse(response.content);
}
