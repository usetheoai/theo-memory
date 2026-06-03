/**
 * EC-1 absorption: robust JSON extraction from raw LLM responses.
 *
 * Two-pass strategy:
 *   1. Try `JSON.parse(trim)` directly (bare object case)
 *   2. Strip markdown fences ```json ... ``` and retry parse
 *   3. Scan for the first balanced `{...}` substring containing
 *      `"label"` and try parsing that
 *
 * Normalizes label to canonical uppercase {'CORRECT', 'WRONG'};
 * returns null on any failure mode (malformed JSON, missing label
 * field, label value outside the canonical set).
 *
 * @see plan v1.2 § T1.2 + EC-1
 */

export type JudgeLabel = 'CORRECT' | 'WRONG';

export interface ExtractedJudgeJson {
  readonly label: JudgeLabel;
  readonly reasoning: string;
}

const FENCE_RE = /```(?:json)?\s*([\s\S]*?)```/i;

function normalizeLabel(raw: unknown): JudgeLabel | null {
  if (typeof raw !== 'string') return null;
  const upper = raw.trim().toUpperCase();
  if (upper === 'CORRECT' || upper === 'WRONG') return upper;
  return null;
}

function tryParseJudgeJson(input: string): ExtractedJudgeJson | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  if (!('label' in obj)) return null;
  const label = normalizeLabel(obj['label']);
  if (label === null) return null;
  const reasoning = typeof obj['reasoning'] === 'string' ? obj['reasoning'] : '';
  return { label, reasoning };
}

function scanBalancedObjectWithLabel(input: string): string | null {
  const lower = input.toLowerCase();
  let searchStart = 0;
  while (true) {
    const open = input.indexOf('{', searchStart);
    if (open === -1) return null;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = open; i < input.length; i += 1) {
      const ch = input[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          const candidate = input.slice(open, i + 1);
          if (lower.slice(open, i + 1).includes('"label"')) {
            return candidate;
          }
          break;
        }
      }
    }
    searchStart = open + 1;
  }
}

export function extractJudgeJson(rawResponse: string): ExtractedJudgeJson | null {
  const trimmed = rawResponse.trim();
  if (trimmed.length === 0) return null;

  const directParse = tryParseJudgeJson(trimmed);
  if (directParse !== null) return directParse;

  const fenceMatch = FENCE_RE.exec(trimmed);
  if (fenceMatch?.[1] !== undefined) {
    const fenceParse = tryParseJudgeJson(fenceMatch[1].trim());
    if (fenceParse !== null) return fenceParse;
  }

  const balanced = scanBalancedObjectWithLabel(trimmed);
  if (balanced !== null) {
    return tryParseJudgeJson(balanced);
  }

  return null;
}
