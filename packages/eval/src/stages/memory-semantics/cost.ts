import { z } from 'zod';

const tariffSchema=z.object({currency:z.string().min(1),inputPerMillion:z.number().finite().nonnegative(),
  outputPerMillion:z.number().finite().nonnegative()}).strict();
export type EvaluationTariff=z.infer<typeof tariffSchema>;

/** Tariffs are supplied explicitly; no model-name based price guesses. */
export function parseEvaluationTariff(value:string|undefined):EvaluationTariff|undefined {
  return value===undefined?undefined:tariffSchema.parse(JSON.parse(value) as unknown);
}
export function evaluationCost(inputTokens:number,outputTokens:number,tariff:EvaluationTariff|undefined) {
  if(tariff===undefined)return undefined;
  return {currency:tariff.currency,estimatedAmount:(inputTokens*tariff.inputPerMillion+outputTokens*tariff.outputPerMillion)/1_000_000,
    tariff,basis:'reported-token-usage' as const,excludesUnreportedUsage:true};
}
