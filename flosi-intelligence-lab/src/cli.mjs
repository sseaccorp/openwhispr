import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, loadCorpus, loadPrompt } from './shared.mjs';
import { run } from './runner.mjs';
import { compareRuns, reviewRun } from './report.mjs';

const HELP=`Flosi Intelligence Lab (Node.js >=22; no dependencies)
  node src/cli.mjs validate
  node src/cli.mjs run [--mode simulate|real] [--prompt v1|v2] [--split dev|holdout|all]
    [--effort low|medium] [--limit N] [--max-tokens N] [--out runs/name]
    [--unlock-holdout] [--allow-paid-api --max-cost-usd N]
  node src/cli.mjs compare --baseline runs/base --candidate runs/new --out runs/comparison
  node src/cli.mjs review --run runs/name --reviews runs/review.json --out runs/reviewed
Default is simulation, low effort, dev split. Never calls the API during installation.
Real mode requires explicit paid opt-in, limit, budget, prices, and GROQ_API_KEY.
See README.md before running real mode. All artifact paths are relative to the lab.`;

export async function main(args=process.argv.slice(2)) {
  const {values:v,positionals:p}=parseArgs({args,allowPositionals:true,strict:true,options:{
    mode:{type:'string'},prompt:{type:'string'},split:{type:'string'},effort:{type:'string'},limit:{type:'string'},
    'max-tokens':{type:'string'},out:{type:'string'},'unlock-holdout':{type:'boolean'},
    'allow-paid-api':{type:'boolean'},'max-cost-usd':{type:'string'},baseline:{type:'string'},candidate:{type:'string'},
    run:{type:'string'},reviews:{type:'string'},help:{type:'boolean'}
  }});
  if(v.help || !p.length){ console.log(HELP);return; }
  if(p.length!==1) throw new Error('Specify exactly one command');
  const allowed={validate:[],run:['mode','prompt','split','effort','limit','max-tokens','out','unlock-holdout','allow-paid-api','max-cost-usd'],compare:['baseline','candidate','out'],review:['run','reviews','out']}[p[0]];
  if(!allowed || Object.keys(v).some(k=>!allowed.includes(k))) throw new Error('Unknown command or options for command');
  if(p[0]==='validate') {
    const corpus=await loadCorpus('all',true);
    if(corpus.cases.length!==50||new Set(corpus.cases.map(c=>c.id)).size!==50) throw new Error('Expected 50 unique cases');
    for(const id of ['v1','v2']) await loadPrompt(id);
    const lock=JSON.parse(await readFile(path.join(ROOT,'corpus/manifest.json'),'utf8'));
    for(const [key,n] of Object.entries(lock.counts)) {
      if(corpus.cases.filter(c=>c.language===key||c.split===key).length!==n) throw new Error('Unexpected corpus distribution');
    }
    console.log('Validated 50 synthetic cases: 30 dev / 20 holdout; 25 es / 25 en. No API calls.');
  } else if(p[0]==='run') {
    const options=Object.fromEntries(Object.entries(v).map(([k,val])=>[k.replace(/-([a-z])/g,(_,c)=>c.toUpperCase()),val]));
    const result=await run(options);
    console.log(`${result.manifest.mode.toUpperCase()}: ${result.rows.length} rows; API requests: ${result.manifest.apiRequests}; state: ${result.manifest.state}. Results: ${path.relative(ROOT,result.directory)}`);
    if(result.manifest.state!=='complete') process.exitCode=2;
  } else {
    const required=p[0]==='compare'?['baseline','candidate','out']:['run','reviews','out'];
    if(required.some(k=>!v[k])) throw new Error(`Required: ${required.map(k=>'--'+k).join(', ')}`);
    const result=p[0]==='compare'?await compareRuns(v.baseline,v.candidate,v.out):await reviewRun(v.run,v.reviews,v.out);
    console.log(`Written: ${path.relative(ROOT,result.directory??result)}`);
  }
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  main().catch(()=>{
    // Do not echo user arguments, provider exceptions, paths, or environment values.
    console.error('Command failed. Check options, corpus hashes, output folder uniqueness, local key/prices and README. No secrets were logged.');
    process.exitCode=1;
  });
}
