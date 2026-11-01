import { readFile, writeFile, appendFile, mkdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { ROOT, DIMENSIONS, hash, labPath, newOutput, redact } from '../../src/shared.mjs';
import { requestBody, ratesFromEnv, reserveCost, estimateCost } from '../../src/provider.mjs';
import { evaluate } from '../../src/evaluate.mjs';
import { writeReports, compareRuns } from '../../src/report.mjs';
import { preflight, requireThat, reference, provenance, attempt, accounting, assertPinned, validateRow, nonnegative, recoveryToolHash } from './validate.mjs';
import { recoveryRequest } from './provider.mjs';

const json = x => JSON.stringify(x,null,2)+'\n';
const jsonl = rows => rows.map(r => JSON.stringify(r)).join('\n')+(rows.length?'\n':'');
const relative = directory => path.relative(ROOT,directory);

export const toolHash = recoveryToolHash;

export async function check(options, env={}) {
  requireThat(typeof options.source === 'string' && typeof options.baseline === 'string', 'SOURCE_AND_BASELINE_REQUIRED');
  return preflight(options.source,options.baseline,env.GROQ_API_KEY);
}

export async function availableOutput(out, plan) {
  requireThat(typeof out === 'string' && out.length > 0, 'OUTPUT_REQUIRED');
  const directory = await labPath(out);
  for (const node of plan.nodes) {
    const input = await labPath(node.relative);
    requireThat(directory !== input && !directory.startsWith(input+path.sep) && !input.startsWith(directory+path.sep), 'OUTPUT_OVERLAP');
  }
  try { await lstat(directory); requireThat(false, 'OUTPUT_EXISTS'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return directory;
}

function limits(options, plan, env) {
  requireThat(options.allowPaidApi === true && options.pricesVerified === true, 'EXPLICIT_AUTHORIZATION_REQUIRED');
  requireThat(typeof env.GROQ_API_KEY === 'string' && env.GROQ_API_KEY.trim().length > 0, 'LOCAL_KEY_REQUIRED');
  requireThat(options.maxNewRequests !== undefined && options.maxCostUsd !== undefined, 'REQUEST_AND_BUDGET_LIMIT_REQUIRED');
  const maxNewRequests = Number(options.maxNewRequests);
  const maxCostUsd = Number(options.maxCostUsd);
  const intervalSeconds = options.intervalSeconds === undefined ? 15 : Number(options.intervalSeconds);
  requireThat(Number.isSafeInteger(maxNewRequests) && maxNewRequests >= plan.pending.length && maxNewRequests <= 13, 'MAX_NEW_REQUESTS');
  requireThat(nonnegative(maxCostUsd) && maxCostUsd > 0, 'BUDGET');
  requireThat(Number.isFinite(intervalSeconds) && intervalSeconds >= 1 && intervalSeconds <= 300, 'INTERVAL');
  let prices;
  try { prices = ratesFromEnv(env); } catch { requireThat(false,'PRICES_REQUIRED_OR_INVALID'); }
  const bodies = plan.pending.map(c => requestBody(plan.source.manifest.prompt,c.input,plan.source.manifest.effort,plan.source.manifest.maxCompletionTokens));
  const reservations = bodies.map(b => reserveCost(b,prices));
  const plannedConservativeCostUsd = reservations.reduce((s,x)=>s+x,0);
  requireThat(plannedConservativeCostUsd <= maxCostUsd, 'INSUFFICIENT_BUDGET');
  return { maxNewRequests,maxCostUsd,intervalSeconds,prices,bodies,reservations,plannedConservativeCostUsd };
}

async function reports(directory, manifest, rows) {
  await writeReports(directory,manifest,rows);
  const review = { schemaVersion:1,runId:manifest.runId,reviews:rows.filter(r=>r.status==='ok'&&!r.review).map(r=>({caseId:r.caseId,outputHash:r.outputHash,reviewer:'',notes:'',dimensions:Object.fromEntries(DIMENSIONS.map(d=>[d,'pending']))})) };
  await writeFile(path.join(directory,'review-template.json'),json(review));
  const costs = manifest.recovery.accounting;
  const note = `\n## Recuperación y coste de todos los intentos\n\nRespuestas reutilizadas: ${manifest.recovery.reusedResponses}. Solicitudes nuevas: ${costs.newApiRequests}. Solicitudes históricas: ${costs.historicalApiRequests}. Total de intentos: ${costs.totalApiRequests}.\n\nCoste estimado conocido de todos los intentos: USD ${costs.totalKnownEstimatedCostUsd.toFixed(8)}. Intentos con coste desconocido: ${costs.unknownCostAttempts}. Coste total: ${costs.totalEstimatedCostUsd === null ? 'DESCONOCIDO' : 'USD '+costs.totalEstimatedCostUsd.toFixed(8)}. El presupuesto de esta recuperación limita solo las solicitudes nuevas, mediante una reserva conservadora, sin garantizar la factura del proveedor.\n\nEl CSV y el comparador existentes contabilizan las filas canónicas por caso; no incluyen intentos anteriores sustituidos. Para gasto total consultar accounting.json y attempts.jsonl. La combinación de observaciones de distintas sesiones puede afectar a latencias y a la comparación del modelo.\n`;
  await appendFile(path.join(directory,'report.md'),note);
  await writeFile(path.join(directory,'accounting.json'),json(costs));
  return note;
}

export async function recover(options, { env=process.env, fetchImpl=globalThis.fetch, sleepImpl=ms=>sleep(ms) }={}) {
  const plan = await check(options,env);
  requireThat(plan.source.manifest.state === 'stopped' && plan.pending.length >= 1 && plan.pending.length <= 13, 'NO_PENDING_RECOVERY');
  const cfg = limits(options,plan,env);
  await availableOutput(options.out,plan);
  await assertPinned(plan);
  const directory = await newOutput(options.out);
  const runId = randomUUID();
  const source = plan.source;
  const manifest = { ...source.manifest, runId, startedAt:new Date().toISOString(), completedAt:null, state:'running',
    rowsHash:null,prices:cfg.prices,pricesScope:'new_requests_only',maxCostUsd:cfg.maxCostUsd,
    plannedConservativeCostUsd:cfg.plannedConservativeCostUsd,apiRequests:0,nodeVersion:process.version,platform:process.platform,
    recovery:{schemaVersion:1,toolHash:await toolHash(),source:reference(source),baseline:reference(plan.baseline),
      reusedResponses:plan.reused,maxNewRequests:cfg.maxNewRequests,newApiRequests:0,intervalSeconds:cfg.intervalSeconds,
      pricesVerifiedAt:new Date().toISOString(),priceSource:'https://groq.com/pricing/',attemptsHash:null,accounting:null} };
  delete manifest.stopReason; delete manifest.reviewedFrom;
  const rows = source.rows.slice(0,plan.reused).map((row,i)=>({...structuredClone(row),runId,provenance:provenance(row,source,i)}));
  const fresh = [];
  const attempts = [...source.attempts];
  const responseIds = new Set(attempts.map(a=>a.providerResponseId).filter(Boolean));
  await mkdir(path.join(directory,'source'));
  await writeFile(path.join(directory,'source/manifest.json'),source.manifestRaw);
  await writeFile(path.join(directory,'source/rows.jsonl'),source.rowsRaw);
  await writeFile(path.join(directory,'baseline-reference.json'),json(reference(plan.baseline)));
  async function checkpoint() {
    const raw = jsonl(rows), ledger = jsonl(attempts);
    manifest.rowsHash=hash(raw);manifest.recovery.attemptsHash=hash(ledger);
    manifest.recovery.accounting=accounting(source.attempts,fresh);
    await writeFile(path.join(directory,'rows.jsonl'),raw);
    await writeFile(path.join(directory,'attempts.jsonl'),ledger);
    await writeFile(path.join(directory,'manifest.json'),json(manifest));
  }
  await checkpoint();
  for (let i=0;i<plan.pending.length;i++) {
    // Initial cooldown too: the source ended with 429. Never interpret Retry-After as permission to retry.
    await sleepImpl(cfg.intervalSeconds*1000);
    await assertPinned(plan);
    const spent = fresh.reduce((s,a)=>s+(a.estimatedCostUsd??0),0);
    requireThat(manifest.apiRequests < cfg.maxNewRequests && spent+cfg.reservations[i] <= cfg.maxCostUsd, 'RUNTIME_BUDGET');
    const c = plan.pending[i];
    await appendFile(path.join(directory,'journal.jsonl'),JSON.stringify({runId,caseId:c.id,attemptNumber:i+1,state:'about_to_send',at:new Date().toISOString()})+'\n');
    // If interrupted here, state remains running. Do not automatically resend an uncertain in-flight request.
    const started=performance.now();
    manifest.apiRequests++;manifest.recovery.newApiRequests++;
    const response=await recoveryRequest(cfg.bodies[i],env.GROQ_API_KEY,fetchImpl);
    let row=redact({runId,caseId:c.id,language:c.language,tags:c.tags,ambiguous:c.ambiguous,synthetic:true,mode:'real',
      input:c.input,expected:c.expected,rubric:c.rubric,...response,localElapsedMs:performance.now()-started,
      estimatedCostUsd:estimateCost(response.usage,cfg.prices)},env.GROQ_API_KEY);
    row.outputHash=hash(row.output??'');
    row.evaluation=evaluate(c,row.output,row.status);
    if (row.status==='ok') {
      try { validateRow(row,c,manifest,responseIds); }
      catch(error) {
        row.status='invalid_response';row.error={type:'integrity',reasonCode:error.code??'INVALID_RESPONSE'};
        row.evaluation=evaluate(c,row.output,row.status);
      }
    }
    row.provenance={originRunId:runId,originRow:rows.length+1,originRowHash:hash(row),prices:cfg.prices};
    rows.push(row);
    const item=attempt(row,cfg.prices,runId,i+1);fresh.push(item);attempts.push(item);
    await checkpoint();
    await appendFile(path.join(directory,'journal.jsonl'),JSON.stringify({runId,caseId:c.id,attemptNumber:i+1,state:'recorded',at:new Date().toISOString()})+'\n');
    if (row.status!=='ok' || row.estimatedCostUsd===null || spent+row.estimatedCostUsd>cfg.maxCostUsd) {
      manifest.stopReason=row.error?.type??'unknown_cost_or_budget';break;
    }
  }
  manifest.state=rows.length===30 && rows.every(r=>r.status==='ok') && !manifest.stopReason?'complete':'stopped';
  manifest.completedAt=new Date().toISOString();
  await checkpoint();
  const note=await reports(directory,manifest,rows);
  if (manifest.state==='complete') {
    // Validate the actual output + all lineage, not a synthetic projection, before comparing.
    try {
      const verified=await preflight(relative(directory),plan.baseline.relative,env.GROQ_API_KEY);
      requireThat(verified.reused===30,'INCOMPLETE_RESULT');
    } catch(error) {
      manifest.state='stopped';manifest.stopReason='final_validation';
      await checkpoint();await reports(directory,manifest,rows);throw error;
    }
    const comparison=await compareRuns(plan.baseline.relative,relative(directory),path.join(relative(directory),'comparison'));
    await appendFile(path.join(comparison.directory,'comparison.md'),note);
  }
  return { directory,manifest,rows };
}

export async function verify(options,env={}) {
  const plan=await check(options,env);
  requireThat(plan.source.manifest.state==='complete' && plan.source.rows.length===30,'NOT_COMPLETE');
  return plan;
}
