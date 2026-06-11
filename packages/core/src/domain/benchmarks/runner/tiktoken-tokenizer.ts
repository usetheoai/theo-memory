/**
 * Tiktoken-backed Tokenizer implementation for v0.8 cost-tracker.
 *
 * Wraps `@dqbd/tiktoken` (canonical JS port of OpenAI BPE) to provide
 * accurate prompt + completion token counts per ADR D7. Defaults to the
 * `cl100k_base` encoding which covers gpt-4 / gpt-4o / gpt-3.5-turbo
 * families. For claude / open-source models, cl100k_base over-estimates
 * slightly; aggregate matrix accuracy is preserved at the per-session
 * level (a couple percent drift is within reporting tolerance).
 *
 * Drift-T5.1-3 (promoted Tokenizer impl location from inline at T3.1).
 *
 * @see plan v1.2 § T5.1 + ADR D7
 */

import { encoding_for_model, get_encoding, type Tiktoken } from '@dqbd/tiktoken';

import type { Tokenizer } from '../../dip/tokenizer.js';

export class TiktokenTokenizer implements Tokenizer {
  private readonly enc: Tiktoken;

  constructor(modelName?: string) {
    if (modelName !== undefined) {
      try {
        this.enc = encoding_for_model(modelName as Parameters<typeof encoding_for_model>[0]);
        return;
      } catch {
        // model not supported by tiktoken (e.g., claude); fall back to cl100k_base
      }
    }
    this.enc = get_encoding('cl100k_base');
  }

  count(text: string): number {
    if (text.length === 0) return 0;
    return this.enc.encode(text).length;
  }

  free(): void {
    this.enc.free();
  }
}
