import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { ROOT, MODEL, hash, labPath, loadCorpus, loadPrompt, evaluatorHash, redact } from '../../src/shared.mjs';
import { validUsage, estimateCost } from '../../src/provider.mjs';
import { evaluate, applyReviews } from '../../src/evaluate.mjs';

export class RecoveryError extends Error {
  constructor(code) { super(code); this.code = code; }
}
export function requireThat(condition, code) { if (!condition) throw new RecoveryError(code); }
export const equal = isDeepStrictEqual;
export const nonnegative = x => typeof x === 'number' && Number.isFinite(x) && x >= 0;
const uuid = x => typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(x);
const digest = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const date = x => typeof x === 'string' && Number.isFinite(Date.parse(x));
export const sumKnown = attempts => attempts.reduce((n,a) => n + (a.estimatedCostUsd ?? 0), 0);
export const unknownCount = attempts => attempts.filter(a => a.estimatedCostUsd === null).length;

export function validRates(rates) {
  return rates && rates.currency === 'USD' && nonnegative(rates.inputPerMillion) && nonnegative(rates.outputPerMillion);
}

export async function artifact(relative, filename) {
  const file = await labPath(path.join(relative, filename));
  requireThat((await stat(file)).size <= 16 * 1024 * 1024, 'ARTIFACT_TOO_LARGE');
  return readFile(file, 'utf8');
}

function parse(raw, code) {
  try { return JSON.parse(raw); } catch { throw new RecoveryError(code); }
}
export function parseLines(raw) {
  requireThat(raw.endsWith('\n') && !raw.includes('\r'), 'ROWS_FORMAT');
  return raw.slice(0, -1).split('\n').map(line => parse(line, 'INVALID_JSONL'));
}

export async function readRun(relative, secret = '') {
  await labPath(relative);
  const manifestRaw = await artifact(relative, 'manifest.json');
  const rowsRaw = await artifact(relative, 'rows.jsonl');
  const manifest = parse(manifestRaw, 'INVALID_MANIFEST_JSON');
  const rows = parseLines(rowsRaw);
  requireThat(digest(manifest.rowsHash) && hash(rowsRaw) === manifest.rowsHash, 'ROWS_HASH');
  // Never propagate a credential accidentally embedded in an imported artifact.
  requireThat(equal(redact(manifest, secret), manifest) && equal(redact(rows, secret), rows), 'UNREDACTED_SECRET');
  return { relative: path.relative(ROOT, await labPath(relative)).split(path.sep).join('/'), manifestRaw, rowsRaw, manifest, rows,
    manifestHash: hash(manifestRaw), rowsHash: hash(rowsRaw) };
}

export async function context() {
  const corpus = await loadCorpus('dev'); // Deliberately never loads the reserved split.
  requireThat(corpus.cases.length === 30, 'DEV_COUNT');
  return { corpus, evaluatorHash: await evaluatorHash(), recoveryToolHash: await recoveryToolHash(), prompts: { v2: await loadPrompt('v2'), v3: await loadPrompt('v3') } };
}

export async function recoveryToolHash() {
  const files = ['tools/recover.mjs','tools/recovery/recover.mjs','tools/recovery/validate.mjs','tools/recovery/provider.mjs'];
  return hash(await Promise.all(files.map(async p => [p, await readFile(path.join(ROOT,p),'utf8')])));
}

export function validateRow(row, c, m, responseIds) {
  requireThat(row && row.runId === m.runId && row.caseId === c.id && row.mode === 'real' && row.synthetic === true, 'ROW_IDENTITY');
  for (const key of ['input','expected','rubric','tags','language','ambiguous']) requireThat(equal(row[key], c[key]), 'ROW_CORPUS');
  requireThat(row.output === null || typeof row.output === 'string', 'OUTPUT_TYPE');
  requireThat(row.outputHash === hash(row.output ?? ''), 'OUTPUT_HASH');
  requireThat(nonnegative(row.latencyMs) && nonnegative(row.localElapsedMs), 'LATENCY');
  requireThat(row.estimatedCostUsd === null || nonnegative(row.estimatedCostUsd), 'COST_TYPE');
  if (row.usage !== null) requireThat(validUsage(row.usage), 'USAGE');
  if (row.status === 'ok') {
    const raw = row.rawResponse;
    const choice = raw?.choices?.[0];
    requireThat(raw?.model === MODEL && typeof raw.id === 'string' && raw.id.length > 0 && raw.id.length <= 200 && raw.simulated !== true, 'PROVIDER_IDENTITY');
    requireThat(!responseIds.has(raw.id), 'DUPLICATE_RESPONSE'); responseIds.add(raw.id);
    requireThat(raw.choices.length === 1 && choice.finish_reason === 'stop' && choice.message?.role === 'assistant' &&
      !choice.message.tool_calls?.length && !choice.message.function_call && typeof row.output === 'string' && row.output.trim() &&
      choice.message.content === row.output && equal(raw.usage, row.usage) && validUsage(row.usage) && row.error === null, 'SAVED_RESPONSE');
    requireThat(row.usage.completion_tokens <= m.maxCompletionTokens, 'COMPLETION_LIMIT');
  } else {
    // Only a final, explicit 429 is eligible for manual recovery. Never infer safety after a timeout.
    requireThat(row.status === 'api_error' && row.error?.type === 'http' && row.error.httpStatus === 429 &&
      row.output === null && row.rawResponse === null && row.usage === null && row.estimatedCostUsd === null, 'UNSAFE_FAILURE');
  }
  if (row.estimatedCostUsd !== null) {
    requireThat(validRates(m.prices) && validUsage(row.usage), 'UNVERIFIABLE_CLAIMED_COST');
    const calculated = estimateCost(row.usage, m.prices);
    requireThat(Math.abs(calculated - row.estimatedCostUsd) <= 1e-12, 'COST_MISMATCH');
  }
  const expected = evaluate(c, row.output, row.status);
  if (row.review) applyReviews([{ ...row, evaluation: expected }], { schemaVersion: 1, runId: m.runId, reviews: [row.review] });
  requireThat(equal(row.evaluation, expected), 'EVALUATION_MISMATCH');
}

export function validateRun(run, ctx, promptId, state) {
  const m = run.manifest;
  requireThat(m.schemaVersion === 1 && uuid(m.runId) && m.mode === 'real' && m.split === 'dev' && m.model === MODEL && m.state === state, 'MANIFEST_IDENTITY');
  requireThat(equal(m.prompt, ctx.prompts[promptId]), 'PROMPT_MISMATCH');
  requireThat(m.corpusVersion === ctx.corpus.corpusVersion && m.corpusHash === ctx.corpus.corpusHash && m.evaluatorHash === ctx.evaluatorHash, 'CONTEXT_HASH');
  requireThat(m.plannedCases === 30 && equal(m.caseIds, ctx.corpus.cases.map(c => c.id)), 'CASE_ORDER');
  requireThat(m.effort === 'low' && m.temperature === 0 && m.seed === 42 && Number.isSafeInteger(m.maxCompletionTokens) &&
    m.maxCompletionTokens >= 64 && m.maxCompletionTokens <= 4096 && m.concurrency === 1 && m.retries === 0 && m.timeoutMs === 30000, 'PARAMETERS');
  requireThat(date(m.startedAt) && date(m.completedAt) && Date.parse(m.completedAt) >= Date.parse(m.startedAt) &&
    typeof m.nodeVersion === 'string' && typeof m.platform === 'string', 'ENVIRONMENT');
  requireThat(nonnegative(m.maxCostUsd) && m.maxCostUsd > 0 && (m.prices === null || validRates(m.prices)) &&
    nonnegative(m.plannedConservativeCostUsd) && m.plannedConservativeCostUsd <= m.maxCostUsd && m.fixtureHash === null && m.simulationNotice === null, 'MANIFEST_BILLING');
  requireThat(state === 'complete' ? run.rows.length === 30 && !m.stopReason : run.rows.length >= 18 && run.rows.length <= 30 && m.stopReason === 'http', 'RUN_STATE');
  const ids = new Set();
  const responseIds = new Set();
  for (let i=0; i<run.rows.length; i++) {
    const row = run.rows[i];
    requireThat(!ids.has(row.caseId), 'DUPLICATE_CASE'); ids.add(row.caseId);
    requireThat(i === run.rows.length-1 && state === 'stopped' ? row.status === 'api_error' : row.status === 'ok', 'VALID_PREFIX');
    // A combined run can mix verified historical rates and the new rate snapshot.
    validateRow(row, ctx.corpus.cases[i], row.provenance?.prices ? { ...m, prices: row.provenance.prices } : m, responseIds);
  }
  if (!m.recovery) {
    requireThat(m.apiRequests === run.rows.length, 'REQUEST_COUNT');
    if (state === 'stopped') requireThat(run.rows.length === 18 && run.rows[17].caseId === 'dev-en-03', 'ORIGINAL_STOP_SHAPE');
    requireThat(!run.rows.some(r => r.provenance), 'UNEXPECTED_PROVENANCE');
  }
  return run;
}

export function attempt(row, prices, originRunId, attemptNumber) {
  return { originRunId, attemptNumber, caseId: row.caseId, status: row.status,
    providerResponseId: row.rawResponse?.id ?? null, rawResponseHash: hash(row.rawResponse), outputHash: row.outputHash,
    usage: row.usage, prices, estimatedCostUsd: row.estimatedCostUsd, error: row.error };
}

export function provenance(row, source, index) {
  return row.provenance ?? { originRunId: source.manifest.runId, originRow: index+1, originRowHash: hash(row), prices: source.manifest.prices };
}

export async function validateSource(relative, ctx, secret='', seen=new Set(), nodes=[]) {
  const source = await readRun(relative, secret);
  requireThat(!seen.has(source.relative) && seen.size < 32, 'SOURCE_CYCLE'); seen.add(source.relative); nodes.push(source);
  validateRun(source, ctx, 'v3', source.manifest.state);
  requireThat(['stopped','complete'].includes(source.manifest.state), 'UNFINISHED_SOURCE');
  const recovery = source.manifest.recovery;
  if (!recovery) {
    source.attempts = source.rows.map((r,i) => attempt(r, source.manifest.prices, source.manifest.runId, i+1));
    source.reusedCount = 0;
    return source;
  }
  requireThat(recovery.schemaVersion === 1 && recovery.source && typeof recovery.source.relative === 'string', 'RECOVERY_METADATA');
  requireThat(recovery.toolHash === ctx.recoveryToolHash && Number.isFinite(recovery.intervalSeconds) && recovery.intervalSeconds >= 1 && recovery.intervalSeconds <= 300 &&
    Number.isSafeInteger(recovery.maxNewRequests) && recovery.maxNewRequests >= recovery.newApiRequests && recovery.maxNewRequests <= 13 &&
    date(recovery.pricesVerifiedAt) && recovery.priceSource === 'https://groq.com/pricing/' && source.manifest.pricesScope === 'new_requests_only', 'RECOVERY_PARAMETERS');
  const parent = await validateSource(recovery.source.relative, ctx, secret, seen, nodes);
  requireThat(parent.manifest.state === 'stopped' && parent.manifest.runId !== source.manifest.runId &&
    recovery.source.runId === parent.manifest.runId && recovery.source.manifestHash === parent.manifestHash && recovery.source.rowsHash === parent.rowsHash, 'SOURCE_SNAPSHOT');
  requireThat(await artifact(source.relative, 'source/manifest.json') === parent.manifestRaw && await artifact(source.relative, 'source/rows.jsonl') === parent.rowsRaw, 'SOURCE_COPY');
  const reused = parent.rows.length-1;
  requireThat(30-reused <= recovery.maxNewRequests && validRates(source.manifest.prices), 'RECOVERY_LIMIT');
  requireThat(recovery.reusedResponses === reused && recovery.newApiRequests === source.rows.length-reused &&
    source.manifest.apiRequests === recovery.newApiRequests && recovery.newApiRequests >= 1 && recovery.newApiRequests <= 13, 'RECOVERY_COUNT');
  for (let i=0;i<reused;i++) {
    requireThat(equal(source.rows[i], { ...parent.rows[i], runId: source.manifest.runId, provenance: provenance(parent.rows[i], parent, i) }), 'REUSED_RESPONSE_CHANGED');
  }
  const newRows = source.rows.slice(reused);
  newRows.forEach((r,i) => requireThat(equal(r.provenance, { originRunId: source.manifest.runId, originRow: reused+i+1, originRowHash: r.provenance?.originRowHash, prices: source.manifest.prices }) &&
    r.provenance.originRowHash === hash(Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'provenance'))), 'NEW_PROVENANCE'));
  const ledgerRaw = await artifact(source.relative,'attempts.jsonl');
  requireThat(hash(ledgerRaw) === recovery.attemptsHash, 'ATTEMPTS_HASH');
  source.attempts = parseLines(ledgerRaw);
  const expected = [...parent.attempts, ...newRows.map((r,i) => attempt(r, source.manifest.prices, source.manifest.runId, i+1))];
  requireThat(equal(source.attempts, expected), 'ATTEMPTS_MISMATCH');
  requireThat(equal(recovery.accounting, accounting(parent.attempts, expected.slice(parent.attempts.length))), 'ACCOUNTING_MISMATCH');
  requireThat(equal(parse(await artifact(source.relative,'accounting.json'),'ACCOUNTING_JSON'),recovery.accounting) &&
    equal(parse(await artifact(source.relative,'baseline-reference.json'),'BASELINE_JSON'),recovery.baseline), 'ACCOUNTING_ARTIFACTS');
  source.reusedCount = reused;
  return source;
}

export function accounting(previous, fresh) {
  const all = [...previous, ...fresh];
  return { historicalApiRequests: previous.length, newApiRequests: fresh.length, totalApiRequests: all.length,
    historicalKnownEstimatedCostUsd: sumKnown(previous), historicalUnknownCostAttempts: unknownCount(previous),
    newKnownEstimatedCostUsd: sumKnown(fresh), newUnknownCostAttempts: unknownCount(fresh),
    totalKnownEstimatedCostUsd: sumKnown(all), unknownCostAttempts: unknownCount(all),
    totalEstimatedCostUsd: unknownCount(all) ? null : sumKnown(all) };
}

export async function preflight(sourcePath, baselinePath, secret='') {
  const ctx = await context();
  const nodes = [];
  const source = await validateSource(sourcePath, ctx, secret, new Set(), nodes);
  const baseline = validateRun(await readRun(baselinePath, secret), ctx, 'v2', 'complete');
  requireThat(!baseline.manifest.recovery && baseline.manifest.runId !== source.manifest.runId, 'BASELINE');
  requireThat(source.manifest.maxCompletionTokens === baseline.manifest.maxCompletionTokens, 'BASELINE_PARAMETERS');
  nodes.push(baseline);
  requireThat(new Set(nodes.map(n=>n.manifest.runId)).size === nodes.length, 'DUPLICATE_RUN_ID');
  for(const node of nodes) if(node.manifest.recovery) requireThat(equal(node.manifest.recovery.baseline, reference(baseline)), 'BASELINE_CHANGED');
  const reused = source.manifest.state === 'complete' ? 30 : source.rows.length-1;
  return { ctx, source, baseline, nodes, reused, pending: ctx.corpus.cases.slice(reused) };
}

export function reference(run) {
  return { relative: run.relative, runId: run.manifest.runId, manifestHash: run.manifestHash, rowsHash: run.rowsHash };
}

export async function assertPinned(plan) {
  for (const node of plan.nodes) requireThat(hash(await artifact(node.relative,'manifest.json')) === node.manifestHash && hash(await artifact(node.relative,'rows.jsonl')) === node.rowsHash, 'INPUT_CHANGED');
  const current = await context();
  requireThat(equal(current, plan.ctx), 'CODE_OR_CORPUS_CHANGED');
}
