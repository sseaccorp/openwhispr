import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DIMENSIONS, ROOT, csv, md, labPath, readJson, newOutput, hash } from './shared.mjs';
import { applyReviews } from './evaluate.mjs';

export function summarize(rows) {
  const ok = rows.filter(r => r.status === 'ok');
  const latencies = ok.map(r => r.latencyMs).filter(Number.isFinite).sort((a,b) => a-b);
  const percentile = p => latencies.length ? latencies[Math.max(0, Math.ceil(p * latencies.length)-1)] : null;
  return {
    recorded: rows.length, ok: ok.length, errors: rows.length - ok.length,
    exactReferenceMatches: ok.filter(r => r.evaluation.exactReferenceMatch).length,
    automaticFlags: ok.filter(r => r.evaluation.automaticFlags > 0).length,
    humanPass: ok.filter(r => r.evaluation.decision === 'pass').length,
    humanFail: ok.filter(r => r.evaluation.decision === 'fail').length,
    humanUncertain: ok.filter(r => r.evaluation.decision === 'uncertain').length,
    humanPending: ok.filter(r => r.evaluation.decision === 'pending').length,
    p50LatencyMs: percentile(0.50), p95LatencyMs: percentile(0.95),
    knownEstimatedCostUsd: rows.reduce((sum, r) => sum + (r.estimatedCostUsd ?? 0), 0),
    unknownCostRows: rows.filter(r => r.mode === 'real' && r.estimatedCostUsd === null).length,
    promptTokens: rows.reduce((sum,r) => sum + (r.usage?.prompt_tokens ?? 0), 0),
    completionTokens: rows.reduce((sum,r) => sum + (r.usage?.completion_tokens ?? 0), 0)
  };
}

export async function writeReports(directory, manifest, rows) {
  const s = summarize(rows);
  const columns = ['caseId','language','tags','status','mode','promptId','promptVersion','promptHash','effort','latencyMs','promptTokens','completionTokens','estimatedCostUsd','error','exactReferenceMatch','humanDecision',...DIMENSIONS.map(d=>`signal_${d}`),...DIMENSIONS.map(d=>`human_${d}`),'input','output','expected','rubric'];
  const table = [columns.map(csv).join(',')];
  for (const r of rows) {
    table.push([r.caseId,r.language,r.tags.join(';'),r.status,r.mode,manifest.prompt.id,manifest.prompt.version,manifest.prompt.sha256,manifest.effort,r.latencyMs,r.usage?.prompt_tokens,r.usage?.completion_tokens,r.estimatedCostUsd,r.error?.type,r.evaluation.exactReferenceMatch,r.evaluation.decision,...DIMENSIONS.map(d=>r.evaluation.signals[d]),...DIMENSIONS.map(d=>r.evaluation.human[d]),r.input,r.output,r.expected.join(' | '),r.rubric].map(csv).join(','));
  }
  const lines = [
    '# Flosi Intelligence Lab', '',
    manifest.mode === 'simulate' ? '**SIMULACIÓN FABRICADA. No se llamó ni se evaluó GPT-OSS. Tokens y latencia del proveedor no están disponibles.**' : '**Ejecución real de Groq. Las señales automáticas no certifican calidad semántica.**', '',
    `Run: ${manifest.runId}. Prompt: ${manifest.prompt.id} (${manifest.prompt.version}), SHA-256 ${manifest.prompt.sha256}.`,
    `Modelo solicitado: ${manifest.model}. Esfuerzo: ${manifest.effort}. Split: ${manifest.split}. Corpus ${manifest.corpusVersion}, SHA-256 ${manifest.corpusHash}.`,
    `Casos planificados: ${manifest.plannedCases}. Registrados: ${s.recorded}. Correctamente respondidos: ${s.ok}. Errores: ${s.errors}. Estado: ${manifest.state}.`, '',
    '| Medida | Valor |', '| --- | --- |',
    `| Coincidencia textual normalizada (diagnóstico) | ${s.exactReferenceMatches}/${s.ok} |`,
    `| Casos con alguna señal automática fallida | ${s.automaticFlags}/${s.ok} |`,
    `| Revisión humana: pass / fail / uncertain / pending | ${s.humanPass} / ${s.humanFail} / ${s.humanUncertain} / ${s.humanPending} |`,
    `| Latencia cliente p50 / p95 (ms, respuestas válidas) | ${s.p50LatencyMs ?? 'N/A'} / ${s.p95LatencyMs ?? 'N/A'} |`,
    `| Tokens informados: entrada / salida | ${manifest.mode === 'simulate' ? 'N/A' : `${s.promptTokens} / ${s.completionTokens}`} |`,
    `| Coste estimado conocido (USD) | ${manifest.mode === 'simulate' ? 'N/A (sin API)' : s.knownEstimatedCostUsd.toFixed(8)} |`,
    `| Respuestas con coste desconocido | ${s.unknownCostRows} |`, '',
    'Los denominadores anteriores incluyen solo respuestas válidas. Los errores de API se cuentan aparte. El coste total es desconocido si falta usage en alguna solicitud. La latencia mide la petición completa desde el cliente, incluida la red; no es tiempo de inferencia aislado.', '',
    '## Señales por dimensión', '', '| Dimensión | Pass léxico | Flag léxico | No comprobado | No disponible |', '| --- | --- | --- | --- | --- |'
  ];
  for (const d of DIMENSIONS) lines.push(`| ${d} | ${rows.filter(r=>r.evaluation.signals[d]==='pass').length} | ${rows.filter(r=>r.evaluation.signals[d]==='flag').length} | ${rows.filter(r=>r.evaluation.signals[d]==='not_checked').length} | ${rows.filter(r=>r.evaluation.signals[d]==='unavailable').length} |`);
  lines.push('', 'Los checks contains/absent son búsquedas de fragmentos, con falsos positivos y negativos posibles. El check terminal solo comprueba un signo final. Meaning y puntuación completa requieren lectura humana en todos los casos. No hay una puntuación global de calidad.', '', '## Casos que requieren atención', '', '| Caso | Estado | Flags | Decisión humana | Criterio |', '| --- | --- | --- | --- | --- |');
  for (const r of rows.filter(r=>r.status !== 'ok' || r.evaluation.automaticFlags || r.ambiguous || r.evaluation.decision !== 'pass')) lines.push(`| ${r.caseId} | ${r.status} | ${r.evaluation.automaticFlags} | ${r.evaluation.decision} | ${md(r.rubric)} |`);
  lines.push('', 'Salida original y JSON del proveedor: rows.jsonl (con redacción de secretos). Datos de comparación: summary.csv. Revisión: review-template.json. Los ejemplos simulados derivan de referencias con errores plantados y no permiten elegir un prompt por calidad.', '');
  await writeFile(path.join(directory,'summary.csv'), table.join('\r\n')+'\r\n');
  await writeFile(path.join(directory,'report.md'), lines.join('\n'));
}

export async function loadRun(relative) {
  const directory = await labPath(relative);
  const manifest = await readJson(await labPath(path.relative(ROOT,path.join(directory,'manifest.json'))));
  const raw = await readFile(await labPath(path.relative(ROOT,path.join(directory,'rows.jsonl'))),'utf8');
  const rows = raw.trim() ? raw.trim().split('\n').map(JSON.parse) : [];
  if (hash(raw) !== manifest.rowsHash || rows.some(r=>r.runId !== manifest.runId)) throw new Error('Run integrity mismatch');
  return { directory, manifest, rows };
}

export async function reviewRun(runPath, reviewsPath, outputPath) {
  const { manifest, rows } = await loadRun(runPath);
  const document = await readJson(await labPath(reviewsPath));
  applyReviews(rows, document);
  const directory = await newOutput(outputPath);
  const raw = rows.map(r=>JSON.stringify(r)).join('\n')+'\n';
  const reviewed = {...manifest, reviewedFrom: runPath, rowsHash: hash(raw)};
  await writeFile(path.join(directory,'manifest.json'),JSON.stringify(reviewed,null,2)+'\n');
  await writeFile(path.join(directory,'rows.jsonl'),raw);
  await writeFile(path.join(directory,'reviews.json'),JSON.stringify(document,null,2)+'\n');
  await writeReports(directory,reviewed,rows);
  return directory;
}

export async function compareRuns(baselinePath, candidatePath, outputPath) {
  const [a,b] = await Promise.all([loadRun(baselinePath),loadRun(candidatePath)]);
  if (a.manifest.evaluatorHash !== b.manifest.evaluatorHash || a.manifest.corpusHash !== b.manifest.corpusHash || a.manifest.split !== b.manifest.split ||
    a.manifest.mode !== b.manifest.mode || a.manifest.state !== 'complete' || b.manifest.state !== 'complete' ||
    JSON.stringify(a.rows.map(r=>r.caseId)) !== JSON.stringify(b.rows.map(r=>r.caseId))) throw new Error('Compare requires complete runs of the same mode, corpus, split and ordered case IDs');
  const changes=[];
  for (let i=0;i<a.rows.length;i++) {
    const before=a.rows[i], after=b.rows[i];
    for(const d of DIMENSIONS) {
      const from=before.evaluation.signals[d], to=after.evaluation.signals[d];
      if(from!==to) changes.push({caseId:before.caseId,dimension:d,kind:'lexical_signal',before:from,after:to,regression:from==='pass' && to==='flag'});
      const hfrom=before.evaluation.human[d], hto=after.evaluation.human[d];
      if(hfrom!==hto) changes.push({caseId:before.caseId,dimension:d,kind:'human_review',before:hfrom,after:hto,regression:hfrom==='pass' && ['fail','uncertain'].includes(hto)});
    }
    if(before.status!==after.status) changes.push({caseId:before.caseId,dimension:'api',kind:'availability',before:before.status,after:after.status,regression:before.status==='ok' && after.status!=='ok'});
  }
  const directory=await newOutput(outputPath);
  const columns=['caseId','dimension','kind','before','after','regression'];
  await writeFile(path.join(directory,'comparison.csv'),[columns.map(csv).join(','),...changes.map(c=>columns.map(k=>csv(c[k])).join(','))].join('\r\n')+'\r\n');
  const statsA=summarize(a.rows),statsB=summarize(b.rows);
  const lines=['# Comparación de prompts','',a.manifest.mode==='simulate'?'**SIMULACIÓN FABRICADA: estas diferencias son errores plantados, no resultados de GPT-OSS.**':'**Resultados reales: las diferencias léxicas requieren revisión humana.**','',
    `Base: ${a.manifest.prompt.id} (${a.manifest.prompt.sha256}). Candidato: ${b.manifest.prompt.id} (${b.manifest.prompt.sha256}).`,
    `Esfuerzo: ${a.manifest.effort} → ${b.manifest.effort}. Modelo: ${a.manifest.model} → ${b.manifest.model}.`,
    'Cambiar esfuerzo o parámetros junto al prompt impide atribuir las diferencias exclusivamente al prompt. Revisar ambos manifest.json, incluidas tarifas y parámetros.','',
    '| Medida | Base | Candidato |','| --- | --- | --- |',
    ...['recorded','errors','automaticFlags','humanPass','humanFail','humanPending','p50LatencyMs','p95LatencyMs','knownEstimatedCostUsd','unknownCostRows'].map(k=>`| ${k} | ${a.manifest.mode==='simulate' && /Cost|Latency/.test(k)?'N/A':statsA[k]??'N/A'} | ${b.manifest.mode==='simulate' && /Cost|Latency/.test(k)?'N/A':statsB[k]??'N/A'} |`),'',
    '| Caso | Dimensión | Tipo | Antes | Después | Regresión candidata |','| --- | --- | --- | --- | --- | --- |',
    ...changes.map(c=>`| ${c.caseId} | ${c.dimension} | ${c.kind} | ${c.before} | ${c.after} | ${c.regression?'sí':'no'} |`),'',
    'Una regresión candidata de señal léxica no es un juicio semántico. Las referencias textuales no son un ranking. El corpus es pequeño, sintético y no estima la calidad en usuarios reales.',''];
  await writeFile(path.join(directory,'comparison.md'),lines.join('\n'));
  return {directory,changes};
}
