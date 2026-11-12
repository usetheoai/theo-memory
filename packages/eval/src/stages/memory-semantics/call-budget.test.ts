import { expect, test } from 'vitest';

import { CallBudget } from './call-budget.js';

test('refuses a call past the per-case limit',()=>{
  const budget=new CallBudget(2);
  budget.startCase();
  budget.spend();budget.spend();
  expect(()=>budget.spend()).toThrow('Provider call budget exceeded for one case.');
});
test('gives every case its own allowance, so a long run does not starve its last cases',()=>{
  const budget=new CallBudget(2);
  for(let i=0;i<200;i++){budget.startCase();budget.spend();budget.spend();}
  expect(budget.total).toBe(400);
});
