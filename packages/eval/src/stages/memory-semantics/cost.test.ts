import { expect, test } from 'vitest';

import { evaluationCost, parseEvaluationTariff } from './cost.js';

test('does not invent a price without a configured tariff',()=>{
  expect(evaluationCost(1000,200,parseEvaluationTariff(undefined))).toBeUndefined();
});
test('computes an explicitly denominated token estimate and discloses missing usage',()=>{
  const tariff=parseEvaluationTariff('{"currency":"USD","inputPerMillion":2,"outputPerMillion":8}');
  expect(evaluationCost(500_000,250_000,tariff)).toMatchObject({currency:'USD',estimatedAmount:3,excludesUnreportedUsage:true});
  expect(()=>parseEvaluationTariff('{"currency":"USD","inputPerMillion":-1,"outputPerMillion":8}')).toThrow();
});
