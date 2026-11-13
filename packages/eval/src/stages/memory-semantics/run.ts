import { CallBudget } from './call-budget.js';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createLocalMemory, InMemoryVectorStore } from '@usetheo/memory';
import type { LLM, Message } from '@usetheo/memory';
import { z } from 'zod';

import { evaluationCost, parseEvaluationTariff } from './cost.js';
import { restoreEvaluation, type EvaluationRow } from './report.js';
import { scoreCase } from './scoring.js';

const fixtureSchema = z.object({ name: z.string(), language: z.enum(['en','pt']), input: z.string(),
  expected: z.array(z.object({ pattern: z.string(), kind: z.enum(['stated','inferred']) })),
  forbidden: z.array(z.string()), attributedTo: z.string(), category: z.string() });
const tariff=parseEvaluationTariff(process.env['THEOMEM_EVAL_TARIFF']);
const here = dirname(fileURLToPath(import.meta.url));
const allCases = z.array(fixtureSchema).length(60).parse(JSON.parse(readFileSync(resolve(here,'golden.json'),'utf8')));
const selected = process.env['THEOMEM_EVAL_CASES']?.split(',');
const cases = selected === undefined ? allCases : allCases.filter((fixture) => selected.includes(fixture.name));
if (cases.length === 0) throw new Error('No matching evaluation cases.');
const apiKey = process.env['OPENAI_API_KEY'] ?? process.env['OPENROUTER_API_KEY'] ?? process.env['OPENROUTER_KEY'];
if (!apiKey) throw new Error('Live evaluation requires a configured provider credential.');
const base = process.env['OPENAI_BASE_URL'] ?? (process.env['OPENAI_API_KEY'] ? 'https://api.openai.com/v1' : 'https://openrouter.ai/api/v1');
const model = process.env['OPENAI_CHAT_MODEL'] ?? (base.includes('openrouter.ai') ? 'openai/gpt-4o-mini' : 'gpt-4o-mini');
const responseSchema = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })),
  usage: z.object({ prompt_tokens: z.number(), completion_tokens: z.number() }).optional() });
const fixtureDigest=createHash('sha256').update(JSON.stringify(allCases)).digest('hex');
const resumePath=process.env['THEOMEM_EVAL_RESUME'];
const resumed=resumePath===undefined?undefined:restoreEvaluation(JSON.parse(readFileSync(resumePath,'utf8')) as unknown,
  {fixtureDigest,model,provider:new URL(base).hostname,caseNames:cases.map(item=>item.name)});
let calls=resumed?.previous.calls??0,inputTokens=resumed?.previous.inputTokens??0,outputTokens=resumed?.previous.outputTokens??0;
let primaryDrafts:unknown;
const promptDigests=new Set<string>(resumed?.previous.promptDigests??[]);
const started = Date.now();
const budget=new CallBudget(4);
const llm: LLM = {
  async generateResponse(messages: readonly Message[], format?: { readonly type: 'json'|'text' }) {
    const system=messages[0]?.content??'';
    if(system.includes('You are a memory extractor')) {
      if(!system.includes('multiple INDEPENDENT sessions')) throw new Error('The evaluation SDK build is stale; rebuild core before evaluating.');
      const promptHash=createHash('sha256').update(system).digest('hex');
      if(resumed!==undefined&&!promptDigests.has(promptHash))throw new Error('Resume refused because the extraction prompt changed.');
      promptDigests.add(promptHash);
    }
    budget.spend();calls++;
    const response = await fetch(`${base.replace(/\/$/,'')}/chat/completions`, {
      method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'content-type':'application/json'},
      body:JSON.stringify({model,messages,temperature:0,max_tokens:1200,response_format:{type:format?.type==='json'?'json_object':'text'}}),
      signal:AbortSignal.timeout(90_000),
    });
    if (!response.ok) throw new Error(`Provider failed with HTTP ${response.status}.`);
    const result=responseSchema.parse(await response.json());
    inputTokens+=result.usage?.prompt_tokens??0;outputTokens+=result.usage?.completion_tokens??0;
    const content=result.choices[0]?.message.content??'';
    const decoded:unknown=format?.type==='json'?JSON.parse(content):{text:content};
    if(system.includes('You are a memory extractor')) primaryDrafts=decoded;
    return decoded;
  },
  generateChat(){throw new Error('Chat generation is not part of this evaluation.');},
};
const rows:EvaluationRow[]=[...(resumed?.retained??[])];
for(let repetition=0;repetition<3;repetition++) {
  for(const fixture of cases) {
    if(rows.some(row=>row.name===fixture.name&&row.repetition===repetition))continue;
    const transportAttempts=resumed===undefined?1:2;
    const memory=await createLocalMemory({vectorStore:new InMemoryVectorStore(),embedder:{embed:async()=>[1,0,0],embedBatch:async(texts)=>texts.map(()=>[1,0,0])},llm,embeddingDim:3,entityBoost:false});
    primaryDrafts=undefined;
    budget.startCase();
    try {
      const items=await memory.user('evaluation').remember(fixture.input,{strictExtraction:true,attributedTo:fixture.attributedTo,evidence:{kind:'stated',sourceId:fixture.name}});
      rows.push({name:fixture.name,language:fixture.language,repetition,transportAttempts,...scoreCase(fixture,items),texts:items.map(item=>item.text),evidence:items.map(item=>item.evidence),primaryDrafts});
    } catch(error) {
      rows.push({name:fixture.name,language:fixture.language,repetition,transportAttempts,errorType:error instanceof Error?error.name:'UnknownError',expected:fixture.expected.length,covered:0,emitted:0,relevant:0,classified:0,forbidden:0,invalidQuotes:0,error:error instanceof Error?error.message:'Evaluation failed'});
    }
    console.log(`Evaluated ${rows.length}/${cases.length*3}`);
  }
}
const sum=(key:'expected'|'covered'|'emitted'|'relevant'|'classified'|'forbidden'|'invalidQuotes')=>rows.reduce((total,row)=>total+row[key],0);
const metrics={precision:sum('relevant')/Math.max(1,sum('emitted')),recall:sum('covered')/Math.max(1,sum('expected')),classification:sum('classified')/Math.max(1,sum('covered')),forbidden:sum('forbidden'),invalidQuotes:sum('invalidQuotes'),errors:rows.filter(row=>'error' in row).length};
const passed=metrics.precision>=0.9&&metrics.recall>=0.85&&metrics.classification>=0.9&&metrics.forbidden===0&&metrics.invalidQuotes===0&&metrics.errors===0;
const output=resolve(process.env['THEOMEM_EVAL_OUTPUT']??resolve(here,'../../../../../benchmarks/results/memory-semantics.json'));
mkdirSync(dirname(output),{recursive:true});
const cost=evaluationCost(inputTokens,outputTokens,tariff);
const report={...(cost===undefined?{}:{cost}),passed,metrics,model,provider:new URL(base).hostname,temperature:0,maxOutputTokens:1200,fixtureVersion:2,completeCorpus:cases.length===60,fixtureDigest,commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),promptDigests:[...promptDigests],workingTreeDirty:execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim().length>0,calls,inputTokens,outputTokens,durationMs:(resumed?.previous.durationMs??0)+Date.now()-started,
  resumedFrom:resumePath??null,parentReportDigest:resumePath===undefined?null:createHash('sha256').update(readFileSync(resumePath)).digest('hex'),
  transportRetryHistory:resumed?.retryable??[],rows};
writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed,metrics,output}));
if(!passed)process.exitCode=1;
