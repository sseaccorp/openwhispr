import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { ROOT, MODEL, hash, loadPrompt } from '../../../src/shared.mjs';
import { estimateCost } from '../../../src/provider.mjs';
import { audit, exactSpan, validateRules } from '../audit.mjs';
import { context, verifiedContext, plan, prepare, outputDirectory, V4_ROOT } from '../core.mjs';
import { runControlled, loadControlled, compareControlled, metrics } from '../run.mjs';
import { main } from '../cli.mjs';

const prefix = `runs/v4-test-${randomUUID()}`;
let counter = 0;
const out = () => `${prefix}/${++counter}`;
const env = { GROQ_API_KEY: 'fabricated-only-not-a-credential', FLOSI_LAB_INPUT_USD_PER_MILLION: '1', FLOSI_LAB_OUTPUT_USD_PER_MILLION: '2' };
const usage = { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, completion_tokens_details: { reasoning_tokens: 7 } };
const reply = (content = 'Fabricated response.', extra = {}) => ({ ok: true, status: 200, json: async () => ({ id: `fabricated-${randomUUID()}`, model: MODEL,
  usage, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }], ...extra }) });
const opts = (extra = {}) => ({ corpus: 'historical', prompt: 'v4', limit: 2, maxRequests: 2, maxCostUsd: .1,
  allowPaidApi: true, pricesVerified: true, out: out(), ...extra });
const deps = (extra = {}) => ({ env, simulated: true, fetchImpl: async () => reply(), sleep: async () => {}, ...extra });
after(async () => { await rm(path.join(ROOT, prefix), { recursive: true, force: true }); });

test('v4 loads with frozen hash/version; 32 balanced original development cases and no reference leakage', async () => {
  const ctx = await verifiedContext();
  assert.equal(ctx.prompts.v4.version, '4.0.0');
  assert.equal(ctx.prompts.v4.sha256, ctx.identity.prompts.v4);
  assert.deepEqual(ctx.identity, (await context()).identity);
  assert.equal(ctx.development.length, 30); assert.equal(ctx.challenge.length, 32);
  for (const lang of ['es', 'en']) assert.equal(ctx.challenge.filter(c => c.language === lang).length, 16);
  for (const c of ctx.challenge) for (const expected of c.expected) {
    const a = audit(c, expected);
    assert.equal(a.rules.filter(r => r.state === 'flag').length, 0, c.id);
    assert.equal(a.decision, 'pending'); assert.equal(a.reviewRequired, true);
  }
  assert.equal((await loadPrompt('v3')).sha256, '05296a338d41f67a2f648b71180c03e952df2a685c37b55cb7ce3b7989793fc1');
});

test('124 payloads use identical provider settings and only system + original input', async () => {
  for (const corpus of ['historical', 'challenge']) for (const prompt of ['v3', 'v4']) {
    const p = await plan({ corpus, prompt });
    for (const [i, r] of p.requests.entries()) {
      assert.deepEqual(r.body.messages, [{ role: 'system', content: p.prompt.system }, { role: 'user', content: p.cases[i].input }]);
      assert.deepEqual(Object.keys(r.body).sort(), ['max_completion_tokens', 'messages', 'model', 'reasoning_effort', 'seed', 'stream', 'temperature']);
      assert.equal(r.body.model, MODEL); assert.equal(r.body.reasoning_effort, 'low');
      assert.equal(r.body.temperature, 0); assert.equal(r.body.seed, 42); assert.equal(r.body.max_completion_tokens, 512);
      assert.equal(r.body.stream, false);
    }
  }
});

test('preparation writes new request artifacts offline and rejects unknown or duplicate selections', async () => {
  const p = { corpus: 'historical', prompt: 'v4', ids: 'dev-en-14,dev-en-03,dev-es-07', out: out() };
  const a = await prepare(p); assert.equal(a.requests, 3); assert.equal(a.apiRequests, 0);
  const saved = JSON.parse(await readFile(path.join(a.directory, 'plan.json'), 'utf8'));
  assert.deepEqual(saved.cases.map(c => c.id), ['dev-es-07', 'dev-en-03', 'dev-en-14']);
  await assert.rejects(prepare(p), /EEXIST/);
  for (const bad of [{ corpus: 'holdout' }, { prompt: '../v4' }, { ids: 'dev-en-14,dev-en-14' }, { ids: 'hold-en-01' }, { limit: 0 }, { limit: 31 }]) {
    await assert.rejects(plan({ corpus: 'historical', prompt: 'v4', ...bad }));
  }
});

test('supplement detects known EN-03, EN-14, ES-07 and exact Unicode quantity failures using fabricated outputs', async () => {
  const ctx = await verifiedContext();
  const c = id => ctx.development.find(x => x.id === id);
  const a = audit(c('dev-en-03'), 'Sorry, email Bryan Chen about the renewal.');
  assert.equal(a.rules.find(r => r.id === 'repair-marker').state, 'flag');
  assert.equal(a.rules.filter(r => r.kind.startsWith('legacy_') && r.state === 'flag').length, 0);
  assert.equal(audit(c('dev-en-14'), 'She literally said make it Friday and then laughed.').rules.find(r => r.id === 'verbatim').state, 'flag');
  assert.equal(audit(c('dev-es-07'), 'Bueno, el pozo es bueno y no necesita otro filtro.').rules.find(r => r.id === 'intro-bueno').state, 'flag');
  for (const space of ['\u00a0', '\u202f', '\u2009']) {
    const b = audit(c('dev-es-09'), `La dosis es de 0,5${space}mg y el lote es AB-019.`);
    assert.equal(b.rules.find(r => r.id === 'quantity').state, 'flag');
    assert.equal(b.rules.find(r => r.id === 'special-unicode').state, 'flag');
  }
  for (const control of ['\u0000', '\u00ad', '\u202e']) {
    assert.equal(audit(c('dev-es-09'), `La dosis es de 0,5 mg y el lote es AB-019${control}.`).rules.find(r => r.id === 'special-unicode').state, 'flag');
  }
});

test('quote word checks tolerate punctuation but reject deletion, reordering, or lost negation', async () => {
  const c = (await verifiedContext()).development.find(c => c.id === 'dev-en-14');
  for (const output of ['She literally said "wait, no, make it Friday" and then laughed.', 'She literally said: wait—no; make it Friday, and then laughed.']) {
    assert.equal(audit(c, output).rules.find(r => r.id === 'verbatim').state, 'no_flag');
  }
  for (const output of ['She literally said no wait make it Friday and then laughed.', 'She literally said wait make it Friday and then laughed.']) {
    assert.equal(audit(c, output).rules.find(r => r.id === 'verbatim').state, 'flag');
  }
});

test('technical matching rejects sign, decimal, case, hyphen, extension and partial identifier changes', () => {
  for (const [output, expected] of [['AB-0190', 'AB-019'], ['ab-019', 'AB-019'], ['AB‑019', 'AB-019'], ['-0,5 mg', '0,5 mg'],
    ['+0,5 mg', '0,5 mg'], ['0.5 mg', '0,5 mg'], ['0,5 mg/s', '0,5 mg'], ['C:\\Data\\qa.csv.bak', 'C:\\Data\\qa.csv'], ['--dry-run-more', '--dry-run']]) assert.equal(exactSpan(output, expected), false, output);
  assert.equal(exactSpan('The code is AB-019.', 'AB-019'), true);
  assert.equal(exactSpan('La dosis es 0,5 mg.', '0,5 mg'), true);
});

test('semantic and cleanup signals stay separate; meaningful apologies and filler-like words are counterexamples', async () => {
  const cases = (await verifiedContext()).challenge;
  for (const id of ['v4-dev-es-05', 'v4-dev-es-06', 'v4-dev-es-07', 'v4-dev-es-16', 'v4-dev-en-05', 'v4-dev-en-06', 'v4-dev-en-07', 'v4-dev-en-15']) {
    const c = cases.find(c => c.id === id);
    assert.equal(audit(c, c.expected[0]).rules.filter(r => r.state === 'flag').length, 0, id);
  }
  const c = cases.find(c => c.id === 'v4-dev-en-12');
  const bad = audit(c, 'Unlock it unless the supervisor is present.');
  assert.ok(bad.groups.A.flags > 0); assert.equal(bad.decision, 'pending');
  assert.equal(audit(c, null, 'api_error').groups.A.unavailable, c.rules.length);
  assert.throws(() => validateRules([{ id: 'x', kind: 'regex', group: 'A', value: 'x', priority: 'P0' }]));
});

test('run gates reject missing authorization, key, verified prices, cap, budget and pacing before fake transport', async () => {
  let calls = 0;
  const d = deps({ fetchImpl: async () => { calls++; return reply(); } });
  for (const missing of ['allowPaidApi', 'pricesVerified', 'limit', 'maxRequests', 'maxCostUsd']) {
    const o = opts(); delete o[missing]; await assert.rejects(runControlled(o, d));
  }
  for (const bad of [{ maxRequests: 1 }, { intervalSeconds: 0 }, { maxCostUsd: .00000001 }, { intervalSeconds: 301 }]) await assert.rejects(runControlled(opts(bad), d));
  await assert.rejects(runControlled(opts(), { ...d, env: {} }));
  await assert.rejects(runControlled(opts(), { ...d, env: { GROQ_API_KEY: env.GROQ_API_KEY } }));
  assert.equal(calls, 0);
});

test('fake HTTP is paced, single-call per case, no reference leakage; simulated API metrics remain null', async () => {
  const sleeps = [], payloads = [];
  const r = await runControlled(opts(), deps({ sleep: async ms => sleeps.push(ms), fetchImpl: async (url, init) => {
    assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions'); payloads.push(JSON.parse(init.body)); return reply();
  } }));
  assert.equal(r.manifest.state, 'complete'); assert.equal(r.manifest.provenance, 'simulated');
  assert.deepEqual(sleeps, [15000, 15000]); assert.equal(payloads.length, 2);
  for (const row of r.rows) { assert.equal(row.usage, null); assert.equal(row.latencyMs, null); assert.equal(row.estimatedCostUsd, null); }
  assert.equal((await loadControlled(path.relative(ROOT, r.directory))).rows.length, 2);
  assert.equal(metrics(r).p50LatencyMs, null); assert.equal(metrics(r).promptTokens, null);
  assert.equal(estimateCost(usage, { inputPerMillion: 1, outputPerMillion: 2 }), .00014);
});

test('429, timeout, invalid JSON, missing usage, truncation and wrong model stop without retry', async () => {
  const variants = [
    [async () => ({ ok: false, status: 429, headers: new Headers({ 'retry-after': '15', authorization: 'forbidden' }), json: () => { throw new Error('must not read error body'); } }), 'http'],
    [async () => { throw Object.assign(new Error(env.GROQ_API_KEY), { name: 'TimeoutError' }); }, 'timeout'],
    [async () => ({ ok: true, json: async () => { throw new Error('malformed'); } }), 'invalid_json'],
    [async () => reply('x', { usage: undefined }), 'missing_or_invalid_usage'],
    [async () => reply('x', { choices: [{ finish_reason: 'length', message: { content: 'partial' } }] }), 'truncated'],
    [async () => reply('x', { model: 'wrong-model' }), 'model_or_response_identity']
  ];
  for (const [fake, type] of variants) {
    let calls = 0;
    const r = await runControlled(opts(), deps({ fetchImpl: async (...args) => { calls++; return fake(...args); } }));
    assert.equal(calls, 1); assert.equal(r.manifest.state, 'stopped'); assert.equal(r.rows[0].error.type, type);
    assert.equal(r.manifest.accounting.totalEstimatedCostUsd, null);
    await assert.rejects(loadControlled(path.relative(ROOT, r.directory)), /COMPLETE/);
    assert.ok(!JSON.stringify(r).includes(env.GROQ_API_KEY));
  }
});

test('duplicate provider response is recorded as invalid and stops the batch', async () => {
  const r = await runControlled(opts(), deps({ fetchImpl: async () => reply('x', { id: 'same-id' }) }));
  assert.equal(r.rows.length, 2); assert.equal(r.rows[1].status, 'invalid_response'); assert.equal(r.manifest.state, 'stopped');
});

test('freeze changes during pacing prevent any send and preserve interrupted evidence', async () => {
  const file = path.join(V4_ROOT, 'freeze.json'), raw = await readFile(file, 'utf8');
  let calls = 0;
  const o = opts();
  try {
    await assert.rejects(runControlled(o, deps({ sleep: async () => writeFile(file, '{}\n'), fetchImpl: async () => { calls++; return reply(); } })), /FREEZE/);
    assert.equal(calls, 0);
    const m = JSON.parse(await readFile(path.join(ROOT, o.out, 'manifest.json'), 'utf8'));
    assert.equal(m.state, 'running'); assert.equal(m.apiRequests, 0);
  } finally { await writeFile(file, raw); }
});

test('comparison separates A/B/C and rejects mismatched corpus, selection, provenance and altered rows/accounting', async () => {
  const o = opts({ limit: 1, maxRequests: 1 });
  const a = await runControlled({ ...o, prompt: 'v3', out: out() }, deps());
  const b = await runControlled({ ...o, out: out() }, deps());
  const aPath = path.relative(ROOT, a.directory), bPath = path.relative(ROOT, b.directory);
  const compared = await compareControlled(aPath, bPath, out());
  assert.equal(compared.pairs.length, 1);
  assert.match(await readFile(path.join(compared.directory, 'comparison.md'), 'utf8'), /SIMULACIÓN FABRICADA/);
  const file = path.join(b.directory, 'manifest.json'), raw = await readFile(file, 'utf8');
  for (const change of [m => m.provenance = 'real', m => m.settings.effort = 'medium', m => m.accounting.totalEstimatedCostUsd = 0,
    m => m.caseIds = ['dev-en-14'], m => m.corpus = 'challenge', m => m.intervalSeconds = 30]) {
    const m = JSON.parse(raw); change(m); await writeFile(file, JSON.stringify(m));
    await assert.rejects(compareControlled(aPath, bPath, out()));
  }
  await writeFile(file, raw);
  await writeFile(path.join(b.directory, 'rows.jsonl'), '{}\n');
  await assert.rejects(compareControlled(aPath, bPath, out()), /ROWS_HASH/);
});

test('fabricated comparison exposes a new meaning regression even when cleanup and technical signals improve', async () => {
  const ids = 'dev-es-07,dev-es-09,dev-en-03,dev-en-05,dev-en-14';
  const p = await plan({ corpus: 'historical', prompt: 'v3', ids });
  const fixtures = Object.fromEntries(p.cases.map(c => [c.input, c.expected[0]]));
  const before = { ...fixtures,
    [p.cases.find(c => c.id === 'dev-es-07').input]: 'Bueno, el pozo es bueno y no necesita otro filtro.',
    [p.cases.find(c => c.id === 'dev-es-09').input]: 'La dosis es de 0,5\u202fmg y el lote es AB-019.',
    [p.cases.find(c => c.id === 'dev-en-03').input]: 'Sorry, email Bryan Chen about the renewal.',
    [p.cases.find(c => c.id === 'dev-en-14').input]: 'She literally said make it Friday and then laughed.' };
  const after = { ...fixtures, [p.cases.find(c => c.id === 'dev-en-05').input]: 'Enable backups on the test server.' };
  const fake = outputs => deps({ fetchImpl: async (_, init) => reply(outputs[JSON.parse(init.body).messages[1].content]) });
  const options = { ids, limit: 5, maxRequests: 5 };
  const a = await runControlled(opts({ ...options, prompt: 'v3' }), fake(before));
  const b = await runControlled(opts(options), fake(after));
  const result = await compareControlled(path.relative(ROOT, a.directory), path.relative(ROOT, b.directory), out());
  assert.ok(result.pairs.find(p => p.caseId === 'dev-en-05').newlyFlagged.some(r => r.group === 'A'));
  for (const id of ['dev-es-07', 'dev-en-03']) {
    const pair = result.pairs.find(p => p.caseId === id);
    assert.ok(pair.before.groups.B.flags > 0); assert.equal(pair.after.groups.B.flags, 0);
  }
  const quantity = result.pairs.find(p => p.caseId === 'dev-es-09');
  assert.ok(quantity.before.groups.C.flags > 0); assert.equal(quantity.after.groups.C.flags, 0);
});

test('output protection rejects source paths, traversal, existing artifacts and symlinks', async () => {
  for (const p of ['prompts/v4.json', '../runs/no', 'runs/../prompts', 'runs/./x', 'runs']) await assert.rejects(outputDirectory(p));
  const target = await outputDirectory(out());
  const link = path.join(ROOT, prefix, 'link');
  await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(outputDirectory(`${prefix}/link/new`), /Symlinks/);
});

test('CLI offline verify works; paid flags on preparation, unknown flags, holdout and incomplete run opt-in are rejected', async () => {
  const original = console.log;
  try {
    console.log = () => {};
    await main(['verify']);
    for (const args of [['verify', '--allow-paid-api'], ['prepare', '--typo'], ['run'], ['prepare', '--corpus', 'holdout', '--prompt', 'v4', '--out', out()]]) await assert.rejects(main(args));
  } finally { console.log = original; }
});
