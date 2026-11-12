import { z } from 'zod';

export const EvaluationRowSchema=z.object({name:z.string(),language:z.enum(['en','pt']),repetition:z.number().int().min(0).max(2),
  expected:z.number().int().nonnegative(),covered:z.number().int().nonnegative(),emitted:z.number().int().nonnegative(),
  relevant:z.number().int().nonnegative(),classified:z.number().int().nonnegative(),forbidden:z.number().int().nonnegative(),
  invalidQuotes:z.number().int().nonnegative(),error:z.string().optional(),errorType:z.string().optional(),transportAttempts:z.number().int().min(1).max(2).optional(),
}).passthrough();
export type EvaluationRow=z.infer<typeof EvaluationRowSchema>;
const resumeSchema=z.object({fixtureDigest:z.string(),model:z.string(),provider:z.string(),temperature:z.literal(0),
  maxOutputTokens:z.literal(1200),fixtureVersion:z.literal(2),completeCorpus:z.literal(true),
  promptDigests:z.array(z.string()),calls:z.number().int().nonnegative().max(360),inputTokens:z.number().nonnegative(),
  outputTokens:z.number().nonnegative(),durationMs:z.number().nonnegative(),rows:z.array(EvaluationRowSchema).length(180)});

/** Only a failed transport slot can be rerun, once. Quality failures are kept verbatim. */
export function restoreEvaluation(raw:unknown,expected:{fixtureDigest:string;model:string;provider:string;caseNames:readonly string[]}) {
  const previous=resumeSchema.parse(raw);
  if(previous.fixtureDigest!==expected.fixtureDigest||previous.model!==expected.model||previous.provider!==expected.provider) {
    throw new Error('Resume requires the same corpus, model and provider.');
  }
  const slots=new Set(previous.rows.map(row=>`${row.name}:${row.repetition}`));
  if(slots.size!==180||expected.caseNames.some(name=>[0,1,2].some(repetition=>!slots.has(`${name}:${repetition}`)))) {
    throw new Error('Resume report does not cover the required evaluation slots.');
  }
  const retryable=previous.rows.filter(row=>row.error!==undefined&&(row.transportAttempts??1)<2&&
    (row.error==='terminated'||row.error==='fetch failed'||row.errorType==='TimeoutError'||row.errorType==='AbortError'||/^Provider failed with HTTP (429|502|503|504)\.$/.test(row.error)));
  const retrySlots=new Set(retryable.map(row=>`${row.name}:${row.repetition}`));
  return {previous,retryable,retained:previous.rows.filter(row=>!retrySlots.has(`${row.name}:${row.repetition}`))};
}
