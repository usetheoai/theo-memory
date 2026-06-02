/**
 * SingleJudge — one LLM evaluating one query/answer pair.
 *
 * EC-1 absorption: returns null when JSON extraction fails.
 * EC-2 absorption: returns null when the LLM throws (network / quota).
 *
 * ADR-DEFER-WIRING-A: first production caller arrives at T4.1
 * (runner orchestration).
 *
 * @see plan v1.2 § T1.2 + EC-1 + EC-2
 */
import type { LLM } from '../../core/dip/llm.js';

import { extractJudgeJson, type JudgeLabel } from './json-extractor.js';
import { ACCURACY_PROMPT, renderJudgePrompt } from './judge-prompt.js';

export interface JudgeConfig {
  readonly name: string;
  readonly llm: LLM;
  readonly promptTemplate?: string;
}

export interface JudgeQuery {
  readonly questionText: string;
  readonly goldAnswer: string;
  readonly generated: string;
}

export interface JudgeOutcome {
  readonly label: JudgeLabel;
  readonly reasoning: string;
  readonly rawResponse: string;
  readonly model: string;
}

function extractRawString(result: unknown): string {
  if (typeof result === 'string') return result;
  if (result !== null && typeof result === 'object') {
    const obj = result as Record<string, unknown>;
    if (typeof obj['text'] === 'string') return obj['text'];
    if (typeof obj['content'] === 'string') return obj['content'];
    if (typeof obj['raw'] === 'string') return obj['raw'];
    // Already-parsed JSON: serialize back so the extractor sees a consistent surface
    try {
      return JSON.stringify(result);
    } catch {
      return '';
    }
  }
  return '';
}

export class SingleJudge {
  constructor(private readonly config: JudgeConfig) {}

  async judge(query: JudgeQuery): Promise<JudgeOutcome | null> {
    const template = this.config.promptTemplate ?? ACCURACY_PROMPT;
    const messages = renderJudgePrompt(template, query);
    let result: unknown;
    try {
      result = await this.config.llm.generateResponse(messages, { type: 'json' });
    } catch {
      return null;
    }
    const rawResponse = extractRawString(result);
    if (rawResponse === '') return null;
    const parsed = extractJudgeJson(rawResponse);
    if (parsed === null) return null;
    return {
      label: parsed.label,
      reasoning: parsed.reasoning,
      rawResponse,
      model: this.config.name,
    };
  }
}
