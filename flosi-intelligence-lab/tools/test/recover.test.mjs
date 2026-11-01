import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, rm, readdir } from 'node:fs/promises';
import { ROOT, MODEL, ENDPOINT, hash, loadCorpus, loadPrompt, evaluatorHash } from '../../src/shared.mjs';
import { evaluate } from '../../src/evaluate.mjs';
import { estimateCost } from '../../src/provider.mjs';
import { compareRuns, loadRun } from '../../src/report.mjs';
import { check, recover, verify } from '../recovery/recover.mjs';
import { safeRateLimits } from '../recovery/provider.mjs';
import { main } from '../recover.mjs';

const root=`runs/recovery-test-${randomUUID()}`;
let serial=0;
const fresh=()=>`${root}/${++serial}`;
const json=x=>JSON.stringify(x,null,2)+'\n';
const lines=rows=>rows.map(r=>JSON.stringify(r)).join('\n')+'\n';
const prices={inputPerMillion:1,outputPerMillion:2,currency:'USD'};
const env={GROQ_API_KEY:'fixture-only-no-real-credential',FLOSI_LAB_INPUT_USD_PER_MILLION:'1',FLOSI_LAB_OUTPUT_USD_PER_MILLION:'2'};
const usage={prompt_tokens:100,completion_tokens:20,total_tokens:120};
const cases=(await loadCorpus('dev')).cases;
const prompts={v2:await loadPrompt('v2'),v3:await loadPrompt('v3')};
const engineHash=await evaluatorHash();
after(async()=>rm(path.join(ROOT,root),{recursive:true,force:true}));

function payload(c,id=randomUUID()) {
  return {id:`fake-${id}`,model:MODEL,usage,choices:[{finish_reason:'stop',message:{role:'assistant',content:c.input+'.'}}]};
}
function response(data,status=200,headers={}) {
  return {ok:status>=200&&status<300,status,headers:new Headers(headers),json:async()=>data};
}

async function legacy(prompt='v3',stopped=true) {
  const relative=fresh(), directory=path.join(ROOT,relative),runId=randomUUID();
  await mkdir(directory,{recursive:true});
  const rows=cases.slice(0,stopped?18:30).map((c,i)=>{
    const failure=stopped&&i===17;
    const raw=failure?null:payload(c);
    const output=raw?.choices[0].message.content??null;
    return {runId,caseId:c.id,language:c.language,tags:c.tags,ambiguous:c.ambiguous,synthetic:true,mode:'real',
      input:c.input,expected:c.expected,rubric:c.rubric,status:failure?'api_error':'ok',output,rawResponse:raw,
      usage:failure?null:usage,latencyMs:1,localElapsedMs:1,error:failure?{type:'http',httpStatus:429}:null,
      outputHash:hash(output??''),estimatedCostUsd:failure?null:estimateCost(usage,prices),evaluation:evaluate(c,output,failure?'api_error':'ok')};
  });
  const raw=lines(rows);
  const manifest={schemaVersion:1,runId,mode:'real',startedAt:'2026-11-01T00:00:00.000Z',completedAt:'2026-11-01T00:01:00.000Z',
    model:MODEL,effort:'low',prompt:prompts[prompt],split:'dev',corpusVersion:'1.0.0',corpusHash:(await loadCorpus('dev')).corpusHash,
    caseIds:cases.map(c=>c.id),plannedCases:30,maxCompletionTokens:512,temperature:0,seed:42,concurrency:1,retries:0,timeoutMs:30000,
    prices,maxCostUsd:1,plannedConservativeCostUsd:0.2,nodeVersion:process.version,platform:process.platform,
    evaluatorHash:engineHash,state:stopped?'stopped':'complete',apiRequests:rows.length,fixtureHash:null,simulationNotice:null,rowsHash:hash(raw)};
  if(stopped)manifest.stopReason='http';
  await writeFile(path.join(directory,'manifest.json'),json(manifest));await writeFile(path.join(directory,'rows.jsonl'),raw);
  return {relative,directory,manifest,rows};
}
async function pair(){return {source:await legacy(),baseline:await legacy('v2',false)};}
const options=(p,extra={})=>({source:p.source.relative,baseline:p.baseline.relative,out:fresh(),allowPaidApi:true,pricesVerified:true,maxNewRequests:13,maxCostUsd:1,...extra});
function transport() {
  const calls=[],delays=[];
  return {calls,delays,env,sleepImpl:async ms=>{delays.push(ms);},fetchImpl:async(url,opts)=>{
    const body=JSON.parse(opts.body);const c=cases.find(c=>c.input===body.messages[1].content);
    assert.equal(url,ENDPOINT);assert.equal(opts.redirect,'error');assert.equal(opts.method,'POST');
    assert.equal(opts.headers.Authorization,`Bearer ${env.GROQ_API_KEY}`);
    assert.equal(body.model,MODEL);assert.equal(body.reasoning_effort,'low');assert.equal(body.messages[0].content,prompts.v3.system);
    assert.equal(body.tools,undefined);assert.equal(body.search_settings,undefined);calls.push(c.id);
    return response(payload(c));
  }};
}
async function rewrite(run,mutate) {
  mutate(run.manifest,run.rows);
  const raw=lines(run.rows);run.manifest.rowsHash=hash(raw);
  await writeFile(path.join(run.directory,'rows.jsonl'),raw);await writeFile(path.join(run.directory,'manifest.json'),json(run.manifest));
}
async function bytes(run) {
  return [await readFile(path.join(run.directory,'manifest.json'),'utf8'),await readFile(path.join(run.directory,'rows.jsonl'),'utf8')];
}

test('offline preflight recognizes 17 reusable responses and exactly 13 pending from dev-en-03',async()=>{
  const p=await pair();const plan=await check(options(p),{});
  assert.equal(plan.reused,17);assert.equal(plan.pending.length,13);assert.equal(plan.pending[0].id,'dev-en-03');assert.equal(plan.pending.at(-1).id,'dev-en-15');
  assert.equal(plan.ctx.evaluatorHash,engineHash);
});

test('recovery preserves 17 original responses, makes only 13 calls, and is comparable with the unchanged v2 comparator',async()=>{
  const p=await pair(),http=transport(),before=await bytes(p.source),baseBefore=await bytes(p.baseline);
  const r=await recover(options(p),http);
  assert.deepEqual(http.calls,cases.slice(17).map(c=>c.id));assert.deepEqual(http.delays,Array(13).fill(15000));
  assert.equal(r.manifest.state,'complete');assert.equal(r.manifest.apiRequests,13);assert.equal(r.rows.length,30);
  assert.equal(r.manifest.evaluatorHash,engineHash);assert.deepEqual(await bytes(p.source),before);assert.deepEqual(await bytes(p.baseline),baseBefore);
  for(let i=0;i<17;i++) {
    const {provenance,runId,...row}=r.rows[i];const {runId:oldRun,...original}=p.source.rows[i];
    assert.deepEqual(row,original);assert.equal(provenance.originRunId,oldRun);assert.equal(provenance.originRowHash,hash(p.source.rows[i]));assert.equal(runId,r.manifest.runId);
  }
  const a=r.manifest.recovery.accounting;
  assert.equal(a.historicalApiRequests,18);assert.equal(a.newApiRequests,13);assert.equal(a.totalApiRequests,31);
  assert.equal(a.unknownCostAttempts,1);assert.equal(a.totalEstimatedCostUsd,null);
  assert.ok(Math.abs(a.newKnownEstimatedCostUsd-13*0.00014)<1e-12);
  assert.ok((await readFile(path.join(r.directory,'report.md'),'utf8')).includes('DESCONOCIDO'));
  const loaded=await loadRun(path.relative(ROOT,r.directory));assert.equal(loaded.rows.length,30);
  await verify({source:path.relative(ROOT,r.directory),baseline:p.baseline.relative},{});
  const compared=await compareRuns(p.baseline.relative,path.relative(ROOT,r.directory),fresh());
  assert.ok((await readdir(compared.directory)).includes('comparison.csv'));
});

test('another 429 records allowlisted rate metadata, never reads its body or retries, and retains old unknown costs',async()=>{
  const p=await pair(),http=transport();let calls=0;
  http.fetchImpl=async()=>{calls++;return {ok:false,status:429,headers:new Headers({
    'x-ratelimit-limit-tokens':'8000','x-ratelimit-remaining-tokens':'0','x-ratelimit-reset-tokens':'12.5s','retry-after':'15',
    'authorization':`Bearer ${env.GROQ_API_KEY}`,'set-cookie':'secret','x-ratelimit-limit-requests':env.GROQ_API_KEY
  }),json:async()=>{throw new Error('Error body must not be read');}};};
  const r=await recover(options(p),http);
  assert.equal(calls,1);assert.equal(r.manifest.state,'stopped');assert.equal(r.rows.length,18);
  assert.equal(r.rows.at(-1).error.httpStatus,429);
  assert.deepEqual(r.rows.at(-1).error.rateLimit,{'x-ratelimit-limit-tokens':'8000','x-ratelimit-remaining-tokens':'0','x-ratelimit-reset-tokens':'12.5s','retry-after':'15'});
  assert.equal(r.manifest.recovery.accounting.unknownCostAttempts,2);
  for(const name of ['manifest.json','rows.jsonl','attempts.jsonl','accounting.json','report.md'])assert.ok(!(await readFile(path.join(r.directory,name),'utf8')).includes(env.GROQ_API_KEY));
});

test('a manually authorized second recovery resumes only what is still pending with full lineage',async()=>{
  const p=await pair(),http=transport();const realFake=http.fetchImpl;let n=0;
  http.fetchImpl=async(...args)=>++n===4?response(null,429,{'retry-after':'60'}):realFake(...args);
  const first=await recover(options(p),http);assert.equal(first.manifest.state,'stopped');assert.equal(first.rows.length,21);
  const secondHttp=transport();
  const second=await recover(options(p,{source:path.relative(ROOT,first.directory)}),secondHttp);
  assert.deepEqual(secondHttp.calls,cases.slice(20).map(c=>c.id));assert.equal(second.manifest.apiRequests,10);
  assert.equal(second.manifest.recovery.accounting.totalApiRequests,32);assert.equal(second.manifest.recovery.accounting.unknownCostAttempts,2);
  assert.equal(second.rows[0].provenance.originRunId,p.source.manifest.runId);
  assert.equal(second.rows[17].provenance.originRunId,first.manifest.runId);
  assert.equal(second.manifest.state,'complete');
});

test('bad rows hash and tampered prompt/evaluator/corpus identities fail before any call',async()=>{
  for(const mutation of [m=>m.rowsHash='0'.repeat(64),m=>m.prompt={...m.prompt,system:'different'},m=>m.prompt={...m.prompt,sha256:'0'.repeat(64)},m=>m.evaluatorHash='0'.repeat(64),m=>m.corpusHash='0'.repeat(64)]){
    const p=await pair(),http=transport();mutation(p.source.manifest);
    await writeFile(path.join(p.source.directory,'manifest.json'),json(p.source.manifest));
    await assert.rejects(recover(options(p),http));assert.equal(http.calls.length,0);
  }
});

test('duplicate case, duplicate provider response, reordered rows and changed saved outputs fail even with a recomputed rows hash',async()=>{
  const mutations=[
    (m,r)=>r[1]=structuredClone(r[0]),
    (m,r)=>r[1].rawResponse.id=r[0].rawResponse.id,
    (m,r)=>[r[0],r[1]]=[r[1],r[0]],
    (m,r)=>{r[0].output='changed';r[0].outputHash=hash('changed');},
    (m,r)=>r[0].input='private or changed input',
    (m,r)=>r[0].evaluation.decision='pass',
    (m,r)=>r[0].estimatedCostUsd=0
  ];
  for(const mutation of mutations){const p=await pair(),http=transport();await rewrite(p.source,mutation);await assert.rejects(recover(options(p),http));assert.equal(http.calls.length,0);}
});

test('wrong model, effort, request parameters, case list or unsuccessful baseline are rejected',async()=>{
  for(const change of [m=>m.model='another',m=>m.effort='medium',m=>m.temperature=1,m=>m.seed=1,m=>m.concurrency=2,m=>m.timeoutMs=1,m=>m.retries=1,m=>m.plannedCases=18,m=>m.caseIds.reverse(),m=>m.apiRequests=17]){
    const p=await pair(),http=transport();await rewrite(p.source,change);await assert.rejects(recover(options(p),http));assert.equal(http.calls.length,0);
  }
  const p=await pair(),http=transport();await rewrite(p.baseline,m=>m.maxCompletionTokens=1024);await assert.rejects(recover(options(p),http),/BASELINE_PARAMETERS/);assert.equal(http.calls.length,0);
});

test('insufficient budget, too few authorized requests, missing key/prices and missing explicit flags make no requests or output',async()=>{
  const p=await pair();
  for(const extra of [{maxCostUsd:0.00000001},{maxCostUsd:0},{maxNewRequests:12},{maxNewRequests:14},{allowPaidApi:false},{pricesVerified:false},{intervalSeconds:0}]){
    const http=transport(),opts=options(p,extra);await assert.rejects(recover(opts,http));assert.equal(http.calls.length,0);await assert.rejects(readFile(path.join(ROOT,opts.out,'manifest.json')));
  }
  const http=transport();await assert.rejects(recover(options(p),{...http,env:{}}));
  await assert.rejects(recover(options(p),{...http,env:{GROQ_API_KEY:env.GROQ_API_KEY}}));assert.equal(http.calls.length,0);
});

test('existing output directory, overlapping source, or escaped path is never written',async()=>{
  const p=await pair(),http=transport(),existing=fresh();await mkdir(path.join(ROOT,existing),{recursive:true});
  await writeFile(path.join(ROOT,existing,'keep.txt'),'keep');
  for(const out of [existing,p.source.relative,`${p.source.relative}/new`,'../outside'])await assert.rejects(recover(options(p,{out}),http));
  assert.equal(http.calls.length,0);assert.equal(await readFile(path.join(ROOT,existing,'keep.txt'),'utf8'),'keep');
});

test('unknown historical valid-response cost stays null rather than being silently reconstructed',async()=>{
  const p=await pair();await rewrite(p.source,(m,r)=>r[0].estimatedCostUsd=null);
  const r=await recover(options(p),transport());assert.equal(r.rows[0].estimatedCostUsd,null);assert.equal(r.manifest.recovery.accounting.unknownCostAttempts,2);
});

test('new prices are applied only to new requests, preserving historical verified prices and costs',async()=>{
  const p=await pair(),http=transport();http.env={...env,FLOSI_LAB_INPUT_USD_PER_MILLION:'2',FLOSI_LAB_OUTPUT_USD_PER_MILLION:'4'};
  const r=await recover(options(p),http);assert.equal(r.rows[0].estimatedCostUsd,0.00014);assert.equal(r.rows[17].estimatedCostUsd,0.00028);
  assert.deepEqual(r.rows[0].provenance.prices,prices);await verify({source:path.relative(ROOT,r.directory),baseline:p.baseline.relative},{});
});

test('input changes during cooldown prevent the next request',async()=>{
  const p=await pair(),http=transport();http.sleepImpl=async()=>writeFile(path.join(p.source.directory,'manifest.json'),'{}');
  await assert.rejects(recover(options(p),http),/INPUT_CHANGED/);assert.equal(http.calls.length,0);
});

test('duplicate fresh provider response is billed if usage is known but stops the batch as invalid',async()=>{
  const p=await pair(),http=transport();let n=0;
  http.fetchImpl=async()=>{n++;return response(payload(cases[17],p.source.rows[0].rawResponse.id.slice(5)));};
  const r=await recover(options(p),http);assert.equal(n,1);assert.equal(r.manifest.state,'stopped');assert.equal(r.rows.at(-1).error.reasonCode,'DUPLICATE_RESPONSE');assert.equal(r.rows.at(-1).estimatedCostUsd,0.00014);
});

test('timeout and missing usage stop without retry; their cost remains unknown',async()=>{
  for(const fake of [async()=>{throw Object.assign(new Error(env.GROQ_API_KEY),{name:'TimeoutError'});},async()=>response({...payload(cases[17]),usage:null})]){
    const p=await pair(),http=transport();let calls=0;http.fetchImpl=async()=>{calls++;return fake();};
    const r=await recover(options(p),http);assert.equal(calls,1);assert.equal(r.manifest.state,'stopped');assert.equal(r.rows.at(-1).estimatedCostUsd,null);assert.equal(r.manifest.recovery.accounting.unknownCostAttempts,2);
  }
});

test('tampering with recovery accounting, lineage or ledger is rejected before a subsequent request',async()=>{
  for(const mutate of [m=>m.recovery.accounting.totalApiRequests=0,m=>m.recovery.source.rowsHash='0'.repeat(64),m=>m.recovery.attemptsHash='0'.repeat(64)]){
    const p=await pair(),http=transport();http.fetchImpl=async()=>response(null,429);
    const r=await recover(options(p),http);mutate(r.manifest);await writeFile(path.join(r.directory,'manifest.json'),json(r.manifest));
    const next=transport();await assert.rejects(recover(options(p,{source:path.relative(ROOT,r.directory)}),next));assert.equal(next.calls.length,0);
  }
});

test('safe headers reject arbitrary values, cookies, authorization and secret-shaped metadata',()=>{
  assert.deepEqual(safeRateLimits(new Headers({'authorization':'secret','set-cookie':'secret','x-ratelimit-reset-tokens':env.GROQ_API_KEY,'retry-after':'Sun, 01 Nov 2026 01:00:00 GMT'})),{'retry-after':'Sun, 01 Nov 2026 01:00:00 GMT'});
});

test('CLI check is offline and rejects paid flags; the recover command requires explicit authorization',async()=>{
  const p=await pair(),messages=[],log=console.log;
  try {
    console.log=x=>messages.push(x);
    await main(['check','--source',p.source.relative,'--baseline',p.baseline.relative],{env:{}});
    assert.equal(JSON.parse(messages[0]).apiRequests,0);assert.equal(JSON.parse(messages[0]).newRequests,13);
    await assert.rejects(main(['check','--source',p.source.relative,'--baseline',p.baseline.relative,'--allow-paid-api'],{env:{}}));
    const http=transport();await assert.rejects(main(['recover','--source',p.source.relative,'--baseline',p.baseline.relative,'--out',fresh()],http));assert.equal(http.calls.length,0);
  }finally{console.log=log;}
});
