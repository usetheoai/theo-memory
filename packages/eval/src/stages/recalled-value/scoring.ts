/**
 * Scoring for the recalled-value evaluation: does a reader answer a question about a detail of
 * something the user said, given what recall returns?
 *
 * A case is one person: the messages they wrote, each with a main fact and incidental details,
 * and questions whose answer is a value written in one of those messages.
 */
import { z } from 'zod';

export const RecalledValueCaseSchema = z
  .object({
    id: z.string().min(1),
    language: z.enum(['en', 'pt']),
    messages: z.array(z.string().min(1)).min(1),
    questions: z
      .array(
        z
          .object({
            kind: z.enum(['main', 'detail']),
            question: z.string().min(1),
            value: z.string().min(1),
            /** Index of the message that states the value. */
            message: z.number().int().min(0),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export type RecalledValueCase = z.infer<typeof RecalledValueCaseSchema>;

const LEADING_ARTICLE = /^(?:an?|the|uma?|o|a|os|as)\s+/iu;

function plain(text: string): string {
  return text.toLowerCase().replace(/\s+/gu, ' ').trim();
}

/** True when the text carries the value, ignoring case, spacing and a leading article of the value. */
export function carries(text: string, value: string): boolean {
  return plain(text).includes(plain(value).replace(LEADING_ARTICLE, ''));
}
