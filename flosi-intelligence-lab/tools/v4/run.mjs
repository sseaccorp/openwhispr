import path from 'node:path';
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { hash, redact, labPath } from '../../src/shared.mjs';
import { ratesFromEnv, reserveCost, estimateCost, validUsage } from '../../src/provider.mjs';
import { recoveryRequest } from '../recovery/provider.mjs';
import { audit, GROUPS } from './audit.mjs';
import { plan, verifiedContext, outputDirectory, SETTINGS } from './core.mjs';

// This is an opt-in evaluation tool, never imported by the correction product.
// Tests inject fake HTTP and mark all their artifacts as simulated.
export async function runControlled(options, { env = process.env, fetchImpl, sleep = delay, simulated = false } = {}) {
  if (options.allowPaidApi !== true || options.pricesVerified !== true || options.maxRequests === undefined || options.maxCostUsd === undefined || options.limit === undefined) throw new Error('EXPLICIT_API_LIMIT_BUDGET_PRICES_REQUIRED');
  if (!env.GROQ_API_KEY?.trim()) throw new Error('LOCAL_KEY_REQUIRED');
  if (simulated && typeof fetchImpl !== 'function') throw new Error('SIMULATION_NEEDS_FAKE_HTTP');
  const p = await plan(options);
  const maxRequests = Number(options.maxRequests), budget = Number(options.maxCostUsd);
  const intervalSeconds = options.intervalSeconds === undefined ? 15 : Number(options.intervalSeconds);
  if (!Number.isSafeInteger(maxRequests) || maxRequests !== p.cases.length || !Number.isFinite(budget) || budget <= 0 ||
      !Number.isSafeInteger(intervalSeconds) || intervalSeconds < 15 || intervalSeconds > 300) throw new Error('REQUEST_CAP_BUDGET_OR_INTERVAL');
  const rates = ratesFromEnv(env);
  const reserve = p.requests.reduce((n, r) => n + reserveCost(r.body, rates), 0);
  if (reserve > budget) throw new Error('INSUFFICIENT_BUDGET');
  const directory = await outputDirectory(options.out);
  const manifest = { schemaVersion: 'flosi-v4-run/1', runId: randomUUID(), provenance: simulated ? 'simulated' : 'real',
    simulationNotice: simulated ? 'FABRICATED HTTP; no model evaluation or measured API metrics.' : null,
    startedAt: new Date().toISOString(), state: 'running', prompt: p.prompt, corpus: p.corpus,
    identityHash: p.identityHash, requestsHash: p.requestsHash, settings: SETTINGS, caseIds: p.cases.map(c => c.id),
    prices: rates, pricesVerifiedAt: new Date().toISOString(), pricesSource: 'Operator declaration; https://groq.com/pricing/',
    maxCostUsd: budget, maxRequests, plannedConservativeCostUsd: reserve, intervalSeconds, apiRequests: 0,
    rowsHash: hash(''), nodeVersion: process.version, platform: process.platform };
  const rows = [], responseIds = new Set();
  const persist = () => writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(path.join(directory, 'plan.json'), JSON.stringify(p, null, 2) + '\n', { flag: 'wx' });
  await writeFile(path.join(directory, 'rows.jsonl'), '', { flag: 'wx' });
  await persist();
  let knownCost = 0;
  for (const [i, c] of p.cases.entries()) {
    await sleep(intervalSeconds * 1000);
    // Recheck frozen inputs and code after pacing, before each potential send.
    const current = await verifiedContext();
    if (hash(current.identity) !== p.identityHash) throw new Error('INPUT_CHANGED');
    const req = p.requests[i];
    if (knownCost + reserveCost(req.body, rates) > budget) { manifest.stopReason = 'budget'; break; }
    const requestHash = hash(req.body);
    await appendFile(path.join(directory, 'journal.jsonl'), JSON.stringify({ event: 'send_intent', caseId: c.id, requestHash, at: new Date().toISOString() }) + '\n');
    manifest.apiRequests++;
    await persist();
    let result = await recoveryRequest(req.body, env.GROQ_API_KEY, fetchImpl);
    if (result.status === 'ok') {
      const id = result.rawResponse?.id;
      const mismatch = result.rawResponse?.model !== SETTINGS.model || result.rawResponse?.choices?.[0]?.message?.role !== 'assistant' ||
        typeof id !== 'string' || !id.trim() || responseIds.has(id);
      if (mismatch) result = { ...result, status: 'invalid_response', error: { type: 'model_or_response_identity' } };
      else responseIds.add(id);
    }
    const cost = estimateCost(result.usage, rates);
    if (cost !== null) knownCost += cost;
    const row = redact({ runId: manifest.runId, caseId: c.id, input: c.input, requestHash, ...result }, env.GROQ_API_KEY);
    if (simulated) { row.usage = null; row.latencyMs = null; row.rawResponse = { simulated: true, content: row.output }; }
    row.estimatedCostUsd = simulated ? null : cost;
    row.outputHash = hash(row.output ?? '');
    row.audit = audit(c, row.output, row.status);
    rows.push(row);
    await appendFile(path.join(directory, 'rows.jsonl'), JSON.stringify(row) + '\n');
    await appendFile(path.join(directory, 'journal.jsonl'), JSON.stringify({ event: 'stored', caseId: c.id, outputHash: row.outputHash, at: new Date().toISOString() }) + '\n');
    if (row.status !== 'ok' || cost === null || knownCost > budget) { manifest.stopReason = row.error?.type ?? 'unknown_cost_or_budget'; break; }
  }
  manifest.state = !manifest.stopReason && rows.length === p.cases.length ? 'complete' : 'stopped';
  manifest.completedAt = new Date().toISOString();
  manifest.rowsHash = hash(await readFile(path.join(directory, 'rows.jsonl'), 'utf8'));
  manifest.accounting = { recordedAttempts: rows.length, knownEstimatedCostUsd: simulated ? null : knownCost,
    unknownCostAttempts: simulated ? null : rows.filter(r => r.estimatedCostUsd === null).length,
    totalEstimatedCostUsd: simulated || rows.some(r => r.estimatedCostUsd === null) ? null : knownCost };
  await persist();
  const review = { runId: manifest.runId, promptHash: manifest.prompt.sha256, reviews: rows.map(r => ({ caseId: r.caseId,
    outputHash: r.outputHash, reviewer: '', notes: '', A_fidelity: 'pending', B_cleanup: 'pending', C_technical: 'pending',
    criteria: p.cases.find(c => c.id === r.caseId).rubric })) };
  await writeFile(path.join(directory, 'review-template.json'), JSON.stringify(review, null, 2) + '\n');
  return { directory, manifest, rows };
}

export async function loadControlled(relative) {
  const directory = await labPath(relative);
  const manifest = JSON.parse(await readFile(await labPath(path.join(relative, 'manifest.json')), 'utf8'));
  if (manifest.schemaVersion !== 'flosi-v4-run/1' || manifest.state !== 'complete' || !['real', 'simulated'].includes(manifest.provenance)) throw new Error('COMPLETE_V4_TOOL_RUN_REQUIRED');
  if (!Array.isArray(manifest.caseIds) || !manifest.caseIds.length) throw new Error('CASE_IDS_REQUIRED');
  const current = await plan({ corpus: manifest.corpus, prompt: manifest.prompt?.id, ids: manifest.caseIds.join(',') });
  if (manifest.identityHash !== current.identityHash || hash(manifest.prompt) !== hash(current.prompt) ||
      manifest.requestsHash !== current.requestsHash || hash(manifest.settings) !== hash(SETTINGS) ||
      hash(manifest.caseIds) !== hash(current.cases.map(c => c.id)) ||
      manifest.apiRequests !== current.cases.length || manifest.maxRequests !== current.cases.length) throw new Error('RUN_CONTEXT_MISMATCH');
  const raw = await readFile(await labPath(path.join(relative, 'rows.jsonl')), 'utf8');
  if (hash(raw) !== manifest.rowsHash) throw new Error('ROWS_HASH');
  const rows = raw.trim().split('\n').map(JSON.parse);
  if (rows.length !== current.cases.length) throw new Error('ROW_COUNT');
  const seenIds = new Set();
  if (!manifest.prices || !['inputPerMillion', 'outputPerMillion'].every(k => Number.isFinite(manifest.prices[k]) && manifest.prices[k] >= 0) || manifest.prices.currency !== 'USD') throw new Error('INVALID_STORED_PRICES');
  for (const [i, row] of rows.entries()) {
    const c = current.cases[i];
    if (row.caseId !== c.id || row.input !== c.input || row.runId !== manifest.runId || row.outputHash !== hash(row.output ?? '') ||
        row.requestHash !== hash(current.requests[i].body) || row.status !== 'ok' || typeof row.output !== 'string' || !row.output.trim()) throw new Error('ROW_MISMATCH');
    if (manifest.provenance === 'real') {
      const id = row.rawResponse?.id;
      if (!validUsage(row.usage) || hash(row.usage) !== hash(row.rawResponse?.usage) || row.rawResponse?.model !== SETTINGS.model ||
          row.rawResponse?.choices?.[0]?.finish_reason !== 'stop' || row.rawResponse?.choices?.[0]?.message?.role !== 'assistant' || row.rawResponse?.choices?.[0]?.message?.content !== row.output ||
          row.rawResponse?.choices?.[0]?.message?.tool_calls?.length || typeof id !== 'string' || !id || seenIds.has(id) ||
          !Number.isFinite(row.latencyMs) || row.latencyMs < 0 || row.estimatedCostUsd !== estimateCost(row.usage, manifest.prices)) throw new Error('PROVIDER_RECORD_MISMATCH');
      seenIds.add(id);
    } else if (row.usage !== null || row.latencyMs !== null || row.estimatedCostUsd !== null || row.rawResponse?.simulated !== true) throw new Error('SIMULATED_METRICS_FORBIDDEN');
    // Recompute: never trust stored green signals to approve a comparison.
    row.audit = audit(c, row.output, row.status);
  }
  const known = rows.reduce((n, r) => n + (r.estimatedCostUsd ?? 0), 0);
  const expectedAccounting = { recordedAttempts: rows.length, knownEstimatedCostUsd: manifest.provenance === 'real' ? known : null,
    unknownCostAttempts: manifest.provenance === 'real' ? 0 : null, totalEstimatedCostUsd: manifest.provenance === 'real' ? known : null };
  const reserve = current.requests.reduce((n, r) => n + reserveCost(r.body, manifest.prices), 0);
  if (hash(manifest.accounting) !== hash(expectedAccounting) || manifest.plannedConservativeCostUsd !== reserve ||
      !Number.isSafeInteger(manifest.intervalSeconds) || manifest.intervalSeconds < 15 || manifest.intervalSeconds > 300 ||
      !Number.isFinite(manifest.maxCostUsd) || manifest.maxCostUsd < reserve || manifest.maxCostUsd <= 0 ||
      (manifest.provenance === 'real' && known > manifest.maxCostUsd)) throw new Error('ACCOUNTING_MISMATCH');
  return { directory, manifest, rows };
}

export function metrics(run) {
  const real = run.manifest.provenance === 'real';
  const latencies = run.rows.map(r => r.latencyMs).filter(Number.isFinite).sort((a, b) => a - b);
  const pct = p => real && latencies.length ? latencies[Math.ceil(latencies.length * p) - 1] : null;
  return { samples: run.rows.length, providerErrors: run.rows.filter(r => r.status !== 'ok').length,
    promptTokens: real ? run.rows.reduce((n, r) => n + (r.usage?.prompt_tokens ?? 0), 0) : null,
    completionTokens: real ? run.rows.reduce((n, r) => n + (r.usage?.completion_tokens ?? 0), 0) : null,
    p50LatencyMs: pct(.5), p95LatencyMs: pct(.95), estimatedCostUsd: real ? run.manifest.accounting.totalEstimatedCostUsd : null };
}

export async function compareControlled(baseline, candidate, out) {
  const a = await loadControlled(baseline), b = await loadControlled(candidate);
  if (a.manifest.prompt.id !== 'v3' || b.manifest.prompt.id !== 'v4' || a.manifest.provenance !== b.manifest.provenance ||
      a.manifest.corpus !== b.manifest.corpus || a.manifest.identityHash !== b.manifest.identityHash ||
      hash(a.manifest.caseIds) !== hash(b.manifest.caseIds) || hash(a.manifest.prices) !== hash(b.manifest.prices) ||
      a.manifest.intervalSeconds !== b.manifest.intervalSeconds) throw new Error('COMPARISON_CONTEXT_MISMATCH');
  const pairs = a.rows.map((row, i) => ({ caseId: row.caseId, before: row.audit, after: b.rows[i].audit,
    newlyFlagged: b.rows[i].audit.rules.filter(r => r.state === 'flag' && row.audit.rules.find(x => x.id === r.id)?.state === 'no_flag'),
    input: row.input, v3: row.output, v4: b.rows[i].output, review: 'pending' }));
  const directory = await outputDirectory(out);
  const data = { provenance: a.manifest.provenance, baseline, candidate, identityHash: a.manifest.identityHash,
    metrics: { v3: metrics(a), v4: metrics(b) }, pairs, semanticApproval: 'pending' };
  await writeFile(path.join(directory, 'comparison.json'), JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
  const lines = ['# Comparación v3/v4', '', a.manifest.provenance === 'simulated' ? '**SIMULACIÓN FABRICADA: no se evaluó el modelo.**' : '**Respuestas registradas como reales; requieren revisión humana. Los hashes no acreditan autenticidad del proveedor.**', '',
    'A: fidelidad; B: limpieza; C: integridad técnica. Una señal sin alerta no aprueba significado. Sin puntuación agregada.', '',
    '| Grupo | Casos con alertas v3 | Casos con alertas v4 | Casos con alertas nuevas |', '| --- | --- | --- | --- |',
    ...GROUPS.map(g => `| ${g} | ${a.rows.filter(r => r.audit.groups[g].flags > 0).length}/${a.rows.length} | ${b.rows.filter(r => r.audit.groups[g].flags > 0).length}/${b.rows.length} | ${pairs.filter(p => p.newlyFlagged.some(r => r.group === g)).length} |`), '',
    'Métricas D (tokens, latencias de API cliente, errores y coste estimado), salidas originales y alertas por caso: comparison.json. Los costes son estimaciones a las tarifas declaradas, no facturas. Revisar A y C antes de valorar B.', '',
    'Revisión humana pendiente en todos los casos. Usar review-template.json de cada ejecución; no editar rows.jsonl. La herramienta no adjudica las revisiones ni certifica aceptación comercial.', ''];
  await writeFile(path.join(directory, 'comparison.md'), lines.join('\n'), { flag: 'wx' });
  return { directory, pairs };
}
