import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFile, readdir, rm, writeFile, symlink } from 'node:fs/promises';
import { ROOT, MODEL, ENDPOINT, DIMENSIONS, hash, loadCorpus, loadPrompt, readJson, labPath, newOutput, redact, csv } from '../src/shared.mjs';
import { evaluate, applyReviews } from '../src/evaluate.mjs';
import { requestBody, ratesFromEnv, reserveCost, estimateCost, validUsage, callGroq } from '../src/provider.mjs';
import { run } from '../src/runner.mjs';
import { compareRuns, loadRun, reviewRun, summarize } from '../src/report.mjs';
import { main } from '../src/cli.mjs';

const testRoot=`runs/test-${randomUUID()}`;
let counter=0;
const out=()=>`${testRoot}/${++counter}`;
const fakeEnv={GROQ_API_KEY:'fixture-only-not-a-real-credential',FLOSI_LAB_INPUT_USD_PER_MILLION:'1',FLOSI_LAB_OUTPUT_USD_PER_MILLION:'2'};
const usage={prompt_tokens:100,completion_tokens:20,total_tokens:120,completion_tokens_details:{reasoning_tokens:7}};
const reply=(content='Book it for Friday at ten.',extra={})=>({ok:true,status:200,json:async()=>({id:'fake',model:MODEL,usage,choices:[{finish_reason:'stop',message:{role:'assistant',content}}],...extra})});
const paid=(extra={})=>({mode:'real',prompt:'v2',split:'dev',allowPaidApi:true,limit:1,maxCostUsd:'0.05',out:out(),...extra});
after(async()=>{await rm(path.join(ROOT,testRoot),{recursive:true,force:true});});

test('50 synthetic cases, disjoint IDs and balanced languages/splits',async()=>{
  const {cases}=await loadCorpus('all',true);
  assert.equal(cases.length,50); assert.equal(new Set(cases.map(c=>c.id)).size,50);
  for(const language of ['es','en']) {
    assert.equal(cases.filter(c=>c.language===language).length,25);
    assert.equal(cases.filter(c=>c.language===language&&c.split==='dev').length,15);
    assert.equal(cases.filter(c=>c.language===language&&c.split==='holdout').length,10);
    for(const tag of ['self_correction','whole_phrase','names','dates','numbers','negations','fillers','natural','technical','ambiguous']) assert.ok(cases.some(c=>c.language===language&&c.tags.includes(tag)),`${language}: ${tag}`);
  }
  for(const c of cases) assert.equal(evaluate(c,c.expected[0]).automaticFlags,0,`${c.id}: own reference must satisfy declared checks`);
});

test('holdout requires deliberate unlock, dev is default',async()=>{
  await assert.rejects(loadCorpus('holdout'),/unlock/); await assert.rejects(loadCorpus('all'),/unlock/);
  assert.equal((await loadCorpus('dev')).cases.length,30);
  await assert.rejects(loadCorpus('../private'),/split/);
});

test('prompts contain no reserved case examples or expected outputs',async()=>{
  const cases=(await loadCorpus('holdout',true)).cases;
  for(const id of ['v1','v2']) {
    const p=await loadPrompt(id); assert.equal(p.sha256.length,64);
    for(const c of cases) {assert.ok(!p.system.includes(c.input)); assert.ok(!p.system.includes(c.expected[0]));}
  }
});

test('textual match never approves semantics or punctuation',async()=>{
  const c=(await loadCorpus('dev')).cases[0]; const e=evaluate(c,c.expected[0]);
  assert.equal(e.exactReferenceMatch,true);assert.equal(e.decision,'pending');assert.equal(e.human.meaning,'pending');assert.equal(e.reviewRequired,true);
  assert.equal(evaluate(c,'').signals.punctuation,'flag');
});

test('entity, negation, filler and self-correction regressions are separate signals',async()=>{
  const c=(await loadCorpus('dev')).cases;
  const find=id=>c.find(c=>c.id===id);
  assert.equal(evaluate(find('dev-es-01'),'La reunión será el jueves.').signals.self_correction,'flag');
  assert.equal(evaluate(find('dev-es-06'),find('dev-es-06').input+'.').signals.fillers,'flag');
  assert.equal(evaluate(find('dev-es-08'),'Quiero cancelar la cita con Iñaki.').signals.negations,'flag');
  assert.equal(evaluate(find('dev-es-03'),'Escribe a Marta sobre el presupuesto.').signals.names,'flag');
  assert.equal(evaluate(find('dev-en-09'),'The reading is 0.5 volts and the serial is ZX-007.').signals.numbers,'flag');
  assert.equal(evaluate(find('dev-es-01'),null,'api_error').signals.self_correction,'unavailable');
});

test('request uses exact Groq model, low default, no tools/search, no reference leakage',async()=>{
  const p=await loadPrompt('v2'); const body=requestBody(p,'dictation only');
  assert.equal(body.model,MODEL);assert.equal(body.reasoning_effort,'low');assert.equal(body.stream,false);
  assert.deepEqual(body.messages,[{role:'system',content:p.system},{role:'user',content:'dictation only'}]);
  for(const k of ['tools','tool_choice','search_settings','expected','rubric','checks'])assert.equal(body[k],undefined);
  assert.equal(requestBody(p,'x','medium').reasoning_effort,'medium');
});

test('simulation never invokes transport even when a key exists',async()=>{
  let calls=0;
  const r=await run({out:out(),limit:2},{env:fakeEnv,fetchImpl:()=>{calls++;throw new Error('not allowed');}});
  assert.equal(calls,0);assert.equal(r.manifest.apiRequests,0);assert.equal(r.manifest.mode,'simulate');
  assert.equal(r.rows[0].usage,null);assert.equal(r.rows[0].estimatedCostUsd,null);assert.equal(r.rows[0].latencyMs,null);
  assert.equal((await loadRun(path.relative(ROOT,r.directory))).rows.length,2);
});

test('real mode rejects absent approval, limit, budget, key and prices before fetch',async()=>{
  let calls=0;const deps={env:fakeEnv,fetchImpl:()=>{calls++;return reply();}};
  for(const missing of ['allowPaidApi','limit','maxCostUsd']) {
    const opts=paid();delete opts[missing];await assert.rejects(run(opts,deps));
  }
  await assert.rejects(run(paid(),{...deps,env:{}}),/GROQ_API_KEY/);
  await assert.rejects(run(paid(),{...deps,env:{GROQ_API_KEY:fakeEnv.GROQ_API_KEY}}),/price/);
  await assert.rejects(run(paid({maxCostUsd:'0.00000001'}),deps),/budget/);
  assert.equal(calls,0);
});

test('strict options reject high effort and invalid limits without transport',async()=>{
  for(const opts of [{mode:'auto'},{effort:'high'},{limit:0},{limit:51},{limit:1.5},{maxTokens:0},{maxTokens:5000},{prompt:'../../secret'}]) await assert.rejects(run({...opts,out:out()},{env:{}}));
  await assert.rejects(run({mode:'simulate',allowPaidApi:true,out:out()},{env:{}}));
});

test('cost uses configurable rates and all completion tokens including reasoning',()=>{
  const rates=ratesFromEnv(fakeEnv);assert.equal(estimateCost(usage,rates),0.00014);
  assert.equal(estimateCost(null,rates),null);assert.equal(validUsage({...usage,total_tokens:99}),false);
  assert.ok(reserveCost({messages:[{content:'á'}],max_completion_tokens:512},rates)>0);
  for(const value of ['-1','Infinity','text',''])assert.throws(()=>ratesFromEnv({...fakeEnv,FLOSI_LAB_INPUT_USD_PER_MILLION:value}));
});

test('successful fake HTTP request records raw response, usage, latency, prices and prompt',async()=>{
  let calls=0;
  const result=await run(paid({effort:'medium'}),{env:fakeEnv,fetchImpl:async(url,opts)=>{
    calls++;assert.equal(url,ENDPOINT);assert.equal(opts.redirect,'error');assert.equal(opts.method,'POST');
    assert.equal(JSON.parse(opts.body).reasoning_effort,'medium');assert.equal(opts.headers.Authorization,`Bearer ${fakeEnv.GROQ_API_KEY}`);
    return reply('La reunión será el viernes a las diez.');
  }});
  assert.equal(calls,1);assert.equal(result.manifest.apiRequests,1);assert.equal(result.manifest.state,'complete');
  const row=result.rows[0];assert.equal(row.rawResponse.id,'fake');assert.deepEqual(row.usage,usage);
  assert.ok(row.latencyMs>=0);assert.equal(row.estimatedCostUsd,0.00014);assert.equal(row.evaluation.decision,'pending');
});

test('HTTP errors, malformed replies, timeouts and network failures never retry',async()=>{
  const variants=[
    [async()=>({ok:false,status:429,json:()=>{throw new Error('body must not be read');}}),'http'],
    [async()=>({ok:false,status:401}),'http'],
    [async()=>({ok:false,status:500}),'http'],
    [async()=>{throw Object.assign(new Error(fakeEnv.GROQ_API_KEY),{name:'TimeoutError'});},'timeout'],
    [async()=>{throw new Error(fakeEnv.GROQ_API_KEY);},'network'],
    [async()=>({ok:true,json:async()=>{throw new Error('bad json');}}),'invalid_json'],
    [async()=>reply('',{choices:[{finish_reason:'length',message:{content:'unfinished'}}]}),'truncated'],
    [async()=>reply('',{usage:undefined}),'unexpected_response'],
    [async()=>reply('valid text',{usage:undefined}),'missing_or_invalid_usage'],
    [async()=>reply('valid text',{choices:[{finish_reason:'stop',message:{content:'x',tool_calls:[{}]}}]}),'unexpected_response']
  ];
  for(const [fake,type]of variants){
    let calls=0;const r=await run(paid({limit:2}),{env:fakeEnv,fetchImpl:async()=>{calls++;return fake();}});
    assert.equal(calls,1);assert.equal(r.rows.length,1);assert.equal(r.manifest.state,'stopped');assert.equal(r.rows[0].error.type,type);
    assert.ok(!JSON.stringify(r).includes(fakeEnv.GROQ_API_KEY));
  }
});

test('unknown API cost stays unknown instead of being reported as zero',async()=>{
  const r=await run(paid(),{env:fakeEnv,fetchImpl:async()=>({ok:false,status:503})});
  const s=summarize(r.rows);assert.equal(s.unknownCostRows,1);assert.equal(s.errors,1);assert.equal(r.rows[0].estimatedCostUsd,null);
});

test('secret redaction covers raw provider output, nested structures and error bodies',async()=>{
  const r=await run(paid(),{env:fakeEnv,fetchImpl:async()=>reply(`Bearer ${fakeEnv.GROQ_API_KEY}`)});
  for(const name of await readdir(r.directory)) assert.ok(!(await readFile(path.join(r.directory,name),'utf8')).includes(fakeEnv.GROQ_API_KEY),name);
  assert.equal(redact({api_key:'anything',nested:['gsk_0000000000000000'],usage},{})?.api_key,'[REDACTED]');
});

test('output folders cannot overwrite artifacts, escape lab or follow symlinks',async()=>{
  const relative=out();const dir=await newOutput(relative);await assert.rejects(newOutput(relative));
  await assert.rejects(labPath('../outside'));await assert.rejects(labPath(ROOT));
  const link=path.join(dir,'link');await symlink(path.join(ROOT,'prompts'),link,process.platform==='win32'?'junction':'dir');
  await assert.rejects(labPath(path.relative(ROOT,path.join(link,'v2.json'))),/Symlinks/);
});

test('CSV quotes newlines and commas and neutralizes spreadsheet formulas',()=>{
  assert.equal(csv('a,"b"\nc'),'"a,""b""\nc"');assert.equal(csv('=1+1'),'"\'=1+1"');assert.equal(csv(0),'"0"');
});

test('comparison finds deliberately planted number and negation regressions',async()=>{
  const a=await run({prompt:'v1',out:out()},{env:{}});const b=await run({prompt:'v2',out:out()},{env:{}});
  const c=await compareRuns(path.relative(ROOT,a.directory),path.relative(ROOT,b.directory),out());
  assert.ok(c.changes.some(x=>x.caseId==='dev-es-08'&&x.dimension==='negations'&&x.regression));
  assert.ok(c.changes.some(x=>x.caseId==='dev-en-09'&&x.dimension==='numbers'&&x.regression));
  assert.ok(c.changes.some(x=>x.caseId==='dev-es-01'&&x.before==='flag'&&x.after==='pass'));
  assert.match(await readFile(path.join(c.directory,'comparison.md'),'utf8'),/SIMULACIÓN FABRICADA/);
  const short=await run({out:out(),limit:1},{env:{}});
  await assert.rejects(compareRuns(path.relative(ROOT,a.directory),path.relative(ROOT,short.directory),out()));
});

test('review is bound to run, output hash, reviewer, notes and every dimension',async()=>{
  const r=await run({out:out(),limit:1},{env:{}});const row=r.rows[0];
  const review={schemaVersion:1,runId:row.runId,reviews:[{caseId:row.caseId,outputHash:row.outputHash,reviewer:'local reviewer',notes:'All facts preserved; punctuation checked manually.',dimensions:Object.fromEntries(DIMENSIONS.map(d=>[d,'pass']))}]};
  assert.equal(applyReviews(structuredClone(r.rows),review)[0].evaluation.decision,'pass');
  for(const mutate of [d=>d.runId='other',d=>d.reviews[0].outputHash='other',d=>d.reviews[0].notes='',d=>d.reviews[0].dimensions.meaning='na',d=>d.reviews[0].dimensions.names='pending',d=>d.reviews.push(d.reviews[0])]) {
    const bad=structuredClone(review);mutate(bad);assert.throws(()=>applyReviews(structuredClone(r.rows),bad));
  }
  review.reviews[0].dimensions.meaning='uncertain';
  const reviewFile=path.join(r.directory,'manual.json');await writeFile(reviewFile,JSON.stringify(review));
  const reviewed=await reviewRun(path.relative(ROOT,r.directory),path.relative(ROOT,reviewFile),out());
  const loaded=await loadRun(path.relative(ROOT,reviewed));assert.equal(loaded.rows[0].evaluation.decision,'uncertain');assert.equal(loaded.rows[0].evaluation.reviewRequired,true);
});

test('tampering with result rows is detected',async()=>{
  const r=await run({out:out(),limit:1},{env:{}});await writeFile(path.join(r.directory,'rows.jsonl'),'{}\n');
  await assert.rejects(loadRun(path.relative(ROOT,r.directory)),/integrity/);
});

test('CLI validates offline and rejects unknown flags or paid mode without explicit opt-in',async()=>{
  const original=console.log;const messages=[];
  try {
    console.log=(...args)=>messages.push(args.join(' '));
    await main(['validate']);assert.match(messages.join('\n'),/50 synthetic/);
    await assert.rejects(main(['run','--typo']));await assert.rejects(main(['run','--mode','real']));
  } finally {console.log=original;}
});

test('package has no dependencies or installation lifecycle scripts',async()=>{
  const pkg=await readJson(path.join(ROOT,'package.json'));
  assert.equal(pkg.dependencies,undefined);assert.equal(pkg.devDependencies,undefined);
  for(const name of ['preinstall','install','postinstall','prepare'])assert.equal(pkg.scripts[name],undefined);
});
