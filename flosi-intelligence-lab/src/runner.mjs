import path from 'node:path';
import { appendFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { ROOT, MODEL, DIMENSIONS, loadCorpus, loadPrompt, readJson, hash, newOutput, redact, evaluatorHash } from './shared.mjs';
import { requestBody, ratesFromEnv, callGroq, estimateCost, reserveCost } from './provider.mjs';
import { evaluate } from './evaluate.mjs';
import { writeReports } from './report.mjs';

export async function run(options, { env = process.env, fetchImpl } = {}) {
  const {mode='simulate',prompt:promptId='v2',split='dev',effort='low'}=options;
  if(!['simulate','real'].includes(mode)) throw new Error('mode must be simulate or real');
  if(!['low','medium'].includes(effort)) throw new Error('effort must be low or explicitly medium');
  const maxTokens=options.maxTokens===undefined?512:Number(options.maxTokens);
  if(!Number.isSafeInteger(maxTokens)||maxTokens<64||maxTokens>4096) throw new Error('max-tokens must be an integer from 64 to 4096');
  const corpus=await loadCorpus(split,options.unlockHoldout);
  const prompt=await loadPrompt(promptId);
  const limit=options.limit===undefined?corpus.cases.length:Number(options.limit);
  if(!Number.isSafeInteger(limit)||limit<1||limit>corpus.cases.length) throw new Error('limit must select 1..split size cases');
  const cases=corpus.cases.slice(0,limit);
  let rates=null, budget=null, reserve=0, fixtures=null;
  if(mode==='real') {
    if(options.allowPaidApi!==true || options.limit===undefined || options.maxCostUsd===undefined) throw new Error('Real mode requires --allow-paid-api, --limit, and --max-cost-usd after explicit user approval');
    if(!env.GROQ_API_KEY?.trim()) throw new Error('Set GROQ_API_KEY in this process');
    rates=ratesFromEnv(env); budget=Number(options.maxCostUsd);
    if(!Number.isFinite(budget)||budget<=0) throw new Error('max-cost-usd must be positive');
    reserve=cases.reduce((sum,c)=>sum+reserveCost(requestBody(prompt,c.input,effort,maxTokens),rates),0);
    if(reserve>budget) throw new Error('Conservative planned cost exceeds budget; reduce limit/tokens or verify rates');
  } else {
    if(options.allowPaidApi || options.maxCostUsd!==undefined) throw new Error('Paid options are not accepted in simulation');
    fixtures=await readJson(path.join(ROOT,'fixtures',`${promptId}.json`));
    if(fixtures.simulated!==true || cases.some(c=>typeof fixtures.outputs?.[c.id]!=='string')) throw new Error('Simulation requires explicit fabricated fixtures for every selected case');
  }
  const runId=randomUUID();
  const directory=await newOutput(options.out ?? `runs/${new Date().toISOString().replace(/[:.]/g,'-')}-${promptId}-${mode}`);
  const manifest={schemaVersion:1,runId,mode,startedAt:new Date().toISOString(),model:MODEL,effort,
    prompt,split,corpusVersion:corpus.corpusVersion,corpusHash:corpus.corpusHash,caseIds:cases.map(c=>c.id),
    plannedCases:cases.length,maxCompletionTokens:maxTokens,temperature:0,seed:42,
    concurrency:1,retries:0,timeoutMs:30000,prices:rates,maxCostUsd:budget,plannedConservativeCostUsd:mode==='real'?reserve:null,
    evaluatorHash:await evaluatorHash(),nodeVersion:process.version,platform:process.platform,state:'running',apiRequests:0,
    fixtureHash:fixtures?hash(fixtures):null,simulationNotice:fixtures?.notice ?? null};
  await writeFile(path.join(directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  const rows=[];
  let cumulativeKnownCost=0;
  for(const c of cases) {
    const started=performance.now();
    let result;
    if(mode==='simulate') result={status:'ok',output:fixtures.outputs[c.id],rawResponse:{simulated:true,content:fixtures.outputs[c.id]},usage:null,latencyMs:null,error:null};
    else {
      const body=requestBody(prompt,c.input,effort,maxTokens);
      if(cumulativeKnownCost+reserveCost(body,rates)>budget) {manifest.stopReason='budget'; break;}
      manifest.apiRequests++;
      result=await callGroq(body,env.GROQ_API_KEY,{fetchImpl});
    }
    const row=redact({runId,caseId:c.id,language:c.language,tags:c.tags,ambiguous:c.ambiguous,synthetic:true,mode,
      input:c.input,expected:c.expected,rubric:c.rubric,...result,
      localElapsedMs:performance.now()-started,outputHash:hash(result.output ?? ''),
      estimatedCostUsd:mode==='real'?estimateCost(result.usage,rates):null,
      evaluation:evaluate(c,result.output,result.status)},env.GROQ_API_KEY);
    // Hash the actual stored output, including any redaction.
    row.outputHash=hash(row.output ?? '');
    rows.push(row);
    await appendFile(path.join(directory,'rows.jsonl'),JSON.stringify(row)+'\n');
    cumulativeKnownCost+=row.estimatedCostUsd??0;
    if(mode==='real' && (row.status!=='ok'||row.estimatedCostUsd===null||cumulativeKnownCost>budget)) {manifest.stopReason=row.error?.type??'unknown_cost_or_budget'; break;}
  }
  manifest.state=!manifest.stopReason && rows.length===cases.length?'complete':'stopped';
  manifest.completedAt=new Date().toISOString();
  manifest.rowsHash=hash(rows.map(r=>JSON.stringify(r)).join('\n')+(rows.length?'\n':''));
  if(!rows.length) await writeFile(path.join(directory,'rows.jsonl'),'');
  await writeFile(path.join(directory,'manifest.json'),JSON.stringify(redact(manifest,env.GROQ_API_KEY),null,2)+'\n');
  const reviews={schemaVersion:1,runId,reviews:rows.filter(r=>r.status==='ok').map(r=>({caseId:r.caseId,outputHash:r.outputHash,reviewer:'',notes:'',dimensions:Object.fromEntries(DIMENSIONS.map(d=>[d,'pending']))}))};
  await writeFile(path.join(directory,'review-template.json'),JSON.stringify(reviews,null,2)+'\n');
  await writeReports(directory,manifest,rows);
  return {directory,manifest,rows};
}
