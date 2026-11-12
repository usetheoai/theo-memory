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
 * Context-window overflow (EC-18) — CLOSED by #112: sourceMemories are BATCHED
 * (count + serialized chars, the same discipline as the #109 import chunking),
 * one LLM call per batch, drafts concatenated. A 441-memory live scope built ONE
 * prompt and the response truncated → "response is not valid JSON" → dashboard 502.
 * Cross-batch consolidation opportunities are deliberately forfeited per batch —
 * per-batch consolidation is still valid, and repeated reflect runs converge.
 */
import { ReflectionLLMResponseError } from '../errors.js';
import type { Role } from '../message.js';

import { buildReflectionPrompt } from './prompt.js';
import type {
  DerivedMemoryDraft,
  ReflectionExecuteContext,
} from './types.js';

/**
 * Max source memories per reflection LLM call (#112). Bounds BOTH the prompt size
 * and — critically — the RESPONSE size (drafts scale with input; a truncated
 * response is unparseable). 40 keeps a worst-case call well inside 4o-mini-class
 * context and response limits.
 */
export const REFLECTION_BATCH_MAX_ITEMS = 40;

/**
 * Serialized-char budget for the memory lines of one reflection prompt (#112).
 * ~48K chars ≈ 12-16K tokens of input — conservative for 4o-mini-class models,
 * leaving ample headroom for the instruction header and the JSON response.
 */
export const REFLECTION_BATCH_MAX_CHARS = 48_000;

/** Split source memories into batches bounded by count AND serialized chars. */
function batchSourceMemories(
  source: ReflectionExecuteContext['sourceMemories'],
): ReflectionExecuteContext['sourceMemories'][] {
  const batches: ReflectionExecuteContext['sourceMemories'][] = [];
  let current: (typeof source)[number][] = [];
  let chars = 0;
  for (const mem of source) {
    const memChars = mem.text.length + mem.id.length + 8; // id + separators per prompt line
    if (current.length > 0 && (current.length >= REFLECTION_BATCH_MAX_ITEMS || chars + memChars > REFLECTION_BATCH_MAX_CHARS)) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(mem);
    chars += memChars;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/**
 * Strip a single wrapping markdown code fence (```json ... ``` or ``` ... ```).
 * Models routinely fence JSON output; the content inside is what parses (#112).
 */
function stripCodeFence(raw: string): string {
  const m = /^\s*```(?:json)?\s*\n?([\s\S]*?)\n?\s*```\s*$/.exec(raw);
  return m?.[1] ?? raw;
}

interface RawDraftCandidate {
  text?: unknown;
  derived_from?: unknown;
}

function parseDraftsResponse(raw: string): DerivedMemoryDraft[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(raw));
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
    const rawDerivedFrom = typeof candidate.derived_from === 'string'
      ? [candidate.derived_from]
      : candidate.derived_from;
    if (!Array.isArray(rawDerivedFrom)) {
      throw new ReflectionLLMResponseError(raw, `draft[${String(i)}].derived_from is not an array`);
    }
    const ids: string[] = [];
    const derivedFromArray = rawDerivedFrom as unknown[];
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

  const SYSTEM_ROLE: Role = 'system';
  const drafts: DerivedMemoryDraft[] = [];
  // #112: one LLM call per bounded batch — never one prompt for the whole scope.
  for (const batch of batchSourceMemories(ctx.sourceMemories)) {
    const promptText = buildReflectionPrompt(ctx.scope, batch);
    const response = await ctx.llm.generateChat([
      { role: SYSTEM_ROLE, content: promptText },
    ]);
    // EC-13: LLM returning '[]' is success (no consolidation possible)
    drafts.push(...parseDraftsResponse(response.content));
  }
  return drafts;
}
