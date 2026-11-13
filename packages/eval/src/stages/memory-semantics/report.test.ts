import { expect, test } from 'vitest';
import { restoreEvaluation } from './report.js';

const names=Array.from({length:60},(_,index)=>`case-${index}`);
function report(){return {fixtureDigest:'corpus',model:'model',provider:'provider',temperature:0,maxOutputTokens:1200,
  fixtureVersion:2,completeCorpus:true,promptDigests:['prompt'],calls:180,inputTokens:100,outputTokens:10,durationMs:100,
  rows:names.flatMap(name=>[0,1,2].map(repetition=>({name,language:'en',repetition,expected:1,covered:0,emitted:1,relevant:0,classified:0,forbidden:1,invalidQuotes:0}))) };}
const expected={fixtureDigest:'corpus',model:'model',provider:'provider',caseNames:names};
test('resume retries a transport failure and preserves every bad quality result',()=>{
  const data=report();Object.assign(data.rows[0]!,{error:'terminated'});
  const resumed=restoreEvaluation(data,expected);
  expect(resumed.retryable).toHaveLength(1);expect(resumed.retained).toHaveLength(179);
  expect(resumed.retained.every(row=>row.forbidden===1&&row.covered===0)).toBe(true);
});
test('resume refuses another model, missing slots and repeated transport retries',()=>{
  expect(()=>restoreEvaluation(report(),{...expected,model:'different'})).toThrow('same corpus');
  const data=report();data.rows[1]=data.rows[0]!;
  expect(()=>restoreEvaluation(data,expected)).toThrow('evaluation slots');
  const exhausted=report();Object.assign(exhausted.rows[0]!,{error:'terminated',transportAttempts:2});
  expect(restoreEvaluation(exhausted,expected).retryable).toHaveLength(0);
});
