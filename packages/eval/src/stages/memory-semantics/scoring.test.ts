import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { scoreCase } from './scoring.js';

test('empty extraction does not count as covered or classified evidence', () => {
  expect(scoreCase({ name: 'preference', language: 'en', input: 'I prefer dark colors', expected: [{ pattern: 'dark', kind: 'stated' }], forbidden: [] }, []))
    .toEqual({ expected: 1, covered: 0, emitted: 0, relevant: 0, classified: 0, forbidden: 0, invalidQuotes: 0 });
});

test('one prediction cannot cover two expected meanings and incorrect evidence is not classified',()=>{
  const item={id:'1',text:'dark simple style',hash:'1',scope:{kind:'user' as const,userId:'test'},
    createdAt:new Date(0),updatedAt:new Date(0),metadata:{},tValid:null,tInvalid:null,
    evidence:{kind:'inferred' as const,sourceQuote:'fabricated quote'}};
  const result=scoreCase({name:'ambiguous',language:'en',input:'I prefer dark clothes',
    expected:[{pattern:'dark',kind:'stated'},{pattern:'simple',kind:'inferred'}],forbidden:['simple']},[item]);
  expect(result).toMatchObject({expected:2,covered:1,classified:0,forbidden:1,invalidQuotes:1});
});


test('the full corpus has sixty unique cases balanced across Portuguese and English, including inferred patterns',()=>{
  const cases=JSON.parse(readFileSync(new URL('./golden.json',import.meta.url),'utf8')) as {name:string;language:string;expected:{kind:string}[]}[];
  expect(new Set(cases.map(item=>item.name)).size).toBe(60);
  for(const language of ['pt','en']) {
    const subset=cases.filter(item=>item.language===language);
    expect(subset).toHaveLength(30);
    expect(subset.some(item=>item.expected.some(expectation=>expectation.kind==='inferred'))).toBe(true);
  }
});
