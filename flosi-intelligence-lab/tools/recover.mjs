import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ROOT } from '../src/shared.mjs';
import { check, recover, verify, availableOutput } from './recovery/recover.mjs';
import { requireThat } from './recovery/validate.mjs';

const HELP=`Recovery of the 30-case v3 dev run. Defaults to no network.
  node tools/recover.mjs check --source runs/real-v3-full30-win1 --baseline runs/real-v2-full30-win1 [--out runs/recovered]
  node tools/recover.mjs recover --source runs/real-v3-full30-win1 --baseline runs/real-v2-full30-win1 --out runs/recovered
    --allow-paid-api --prices-verified --max-new-requests 13 --max-cost-usd N [--interval-seconds 15]
  node tools/recover.mjs verify --source runs/recovered --baseline runs/real-v2-full30-win1
No retries. Paths are relative to the lab. GROQ_API_KEY and verified prices must be local environment variables.
See tools/README.md. The paid flag does not replace explicit user approval.`;

export async function main(args=process.argv.slice(2),dependencies={}) {
  const {values,positionals}=parseArgs({args,strict:true,allowPositionals:true,options:{
    source:{type:'string'},baseline:{type:'string'},out:{type:'string'},'allow-paid-api':{type:'boolean'},'prices-verified':{type:'boolean'},
    'max-new-requests':{type:'string'},'max-cost-usd':{type:'string'},'interval-seconds':{type:'string'},help:{type:'boolean'}
  }});
  if(values.help || !positionals.length){console.log(HELP);return;}
  requireThat(positionals.length===1 && ['check','recover','verify'].includes(positionals[0]),'COMMAND');
  const options=Object.fromEntries(Object.entries(values).map(([k,v])=>[k.replace(/-([a-z])/g,(_,c)=>c.toUpperCase()),v]));
  if(positionals[0]!=='recover') requireThat(Object.keys(values).every(k=>['source','baseline','out'].includes(k)),'OPTIONS');
  const result=positionals[0]==='recover'?await recover(options,dependencies):positionals[0]==='verify'?await verify(options,dependencies.env):await check(options,dependencies.env);
  if(positionals[0]==='recover') {
    console.log(JSON.stringify({state:result.manifest.state,reused:result.manifest.recovery.reusedResponses,newApiRequests:result.manifest.apiRequests,output:path.relative(ROOT,result.directory)}));
    if(result.manifest.state!=='complete')process.exitCode=2;
  } else {
    if(options.out)await availableOutput(options.out,result);
    console.log(JSON.stringify({state:result.source.manifest.state,reused:result.reused,pending:result.pending.map(c=>c.id),newRequests:result.pending.length,evaluatorHash:result.ctx.evaluatorHash,apiRequests:0}));
  }
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{
  // Only internal constant codes; never echo provider text, arguments, paths, keys, or native errors.
  const code=typeof error.code==='string'&&/^[A-Z][A-Z_]{2,60}$/.test(error.code)?error.code:'LOCAL_VALIDATION_OR_IO';
  console.error(`Recovery stopped: ${code}. See tools/README.md. No automatic retry.`);process.exitCode=1;
});
