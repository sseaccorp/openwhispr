import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { ROOT, MODEL, hash, readJson, loadCorpus, loadPrompt, evaluatorHash, newOutput } from '../../src/shared.mjs';
import { requestBody } from '../../src/provider.mjs';
import { audit, validateRules, tokens } from './audit.mjs';

export const TOOL_FILES = ['audit.mjs', 'core.mjs', 'run.mjs', 'cli.mjs', 'offline-guard.mjs', '../recovery/provider.mjs'];
export const V4_ROOT = path.join(ROOT, 'tools/v4');
export const SETTINGS = Object.freeze({ model: MODEL, effort: 'low', maxCompletionTokens: 512, temperature: 0, seed: 42, concurrency: 1, retries: 0, timeoutMs: 30000 });
export const digestFile = async file => hash(await readFile(file, 'utf8'));

export async function context() {
  const [historical, v3, v4] = await Promise.all([loadCorpus('dev'), loadPrompt('v3'), loadPrompt('v4')]);
  const challenge = await readJson(path.join(V4_ROOT, 'dev.json'));
  const overlays = await readJson(path.join(V4_ROOT, 'historical-checks.json'));
  const seen = new Set();
  if (challenge.length !== 32) throw new Error('CHALLENGE_COUNT');
  for (const c of challenge) {
    if (!/^v4-dev-(es|en)-\d{2}$/u.test(c.id) || seen.has(c.id) || c.synthetic !== true || c.split !== 'development' ||
        !['es', 'en'].includes(c.language) || !c.id.startsWith(`v4-dev-${c.language}-`) || typeof c.ambiguous !== 'boolean' ||
        typeof c.input !== 'string' || !c.input.trim() || typeof c.rubric !== 'string' || !c.rubric.trim() ||
        !Array.isArray(c.expected) || !c.expected.length || c.expected.some(x => typeof x !== 'string' || !x.trim())) throw new Error('INVALID_CHALLENGE');
    seen.add(c.id); validateRules(c.rules);
    for (const r of c.rules.filter(r => ['exact', 'exact_output', 'tokens'].includes(r.kind))) {
      // Every protected span must come from the input, not an invented fact.
      const grounded = r.kind === 'tokens' ? tokens(r.value).every(t => tokens(c.input).includes(t)) :
        audit({ input: c.input, rules: [r] }, c.input).rules[0].state === 'no_flag';
      if (!grounded) throw new Error(`RULE_NOT_IN_INPUT:${c.id}`);
    }
    for (const expected of c.expected) if (audit(c, expected).rules.some(r => r.state === 'flag')) throw new Error(`REFERENCE_RULE_CONFLICT:${c.id}`);
  }
  for (const lang of ['es', 'en']) if (challenge.filter(c => c.language === lang).length !== 16) throw new Error('CHALLENGE_BALANCE');
  const development = historical.cases.map(c => ({ ...c, rules: overlays[c.id]?.rules ?? [] }));
  for (const [id, o] of Object.entries(overlays)) {
    const c = development.find(c => c.id === id);
    if (!c || hash(c.input) !== o.inputSha256) throw new Error('OVERLAY_INPUT_MISMATCH');
    validateRules(o.rules);
  }
  if (v4.id !== 'v4' || v4.version !== '4.0.0' || v4.system.split(/\s+/u).length > 360) throw new Error('V4_ID_VERSION_OR_LENGTH');
  for (const c of [...development, ...challenge]) for (const text of [c.input, ...c.expected]) {
    if (v4.system.includes(text)) throw new Error('PROMPT_EXAMPLE_LEAKAGE');
  }
  const files = ['dev.json', 'historical-checks.json', ...TOOL_FILES];
  const digests = Object.fromEntries(await Promise.all(files.map(async f => [f, await digestFile(path.join(V4_ROOT, f))])));
  return { development, challenge, prompts: { v3, v4 }, identity: {
    schemaVersion: 'flosi-v4-freeze/1', baseCommit: '1ad9adbcb7068e3eb606bfd2075599fdeaf1ebb8',
    prompts: { v3: v3.sha256, v4: v4.sha256 }, historicalCorpus: historical.corpusHash,
    historicalEvaluator: await evaluatorHash(), files: digests, settings: SETTINGS
  } };
}

export async function verifiedContext() {
  const current = await context();
  const frozen = await readJson(path.join(V4_ROOT, 'freeze.json'));
  if (hash(current.identity) !== hash(frozen)) throw new Error('FREEZE_MISMATCH');
  return current;
}

export async function plan(options) {
  if (!['historical', 'challenge'].includes(options.corpus) || !['v3', 'v4'].includes(options.prompt)) throw new Error('CORPUS_OR_PROMPT');
  const ctx = await verifiedContext();
  let cases = options.corpus === 'historical' ? ctx.development : ctx.challenge;
  if (options.ids !== undefined) {
    const ids = options.ids.split(',');
    if (!ids.length || new Set(ids).size !== ids.length || ids.some(id => !cases.some(c => c.id === id))) throw new Error('CASE_SELECTION');
    cases = cases.filter(c => ids.includes(c.id));
  }
  const limit = options.limit === undefined ? cases.length : Number(options.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > cases.length) throw new Error('LIMIT');
  cases = cases.slice(0, limit);
  const prompt = ctx.prompts[options.prompt];
  const requests = cases.map(c => ({ caseId: c.id, body: requestBody(prompt, c.input, SETTINGS.effort, SETTINGS.maxCompletionTokens) }));
  return { schemaVersion: 'flosi-v4-plan/1', corpus: options.corpus, prompt,
    identity: ctx.identity, identityHash: hash(ctx.identity), cases, requests, requestsHash: hash(requests) };
}

// Outputs are always new folders under runs/, never source/recovery folders.
export async function outputDirectory(relative) {
  if (typeof relative !== 'string' || !/^runs[/\\][^/\\]+(?:[/\\][^/\\]+)*$/u.test(relative) ||
      relative.split(/[/\\]/u).some(x => ['.', '..'].includes(x))) throw new Error('OUTPUT_MUST_BE_UNIQUE_RUN');
  return newOutput(relative);
}

export async function prepare(options) {
  const p = await plan(options);
  const dir = await outputDirectory(options.out);
  await writeFile(path.join(dir, 'plan.json'), JSON.stringify(p, null, 2) + '\n', { flag: 'wx' });
  await writeFile(path.join(dir, 'requests.jsonl'), p.requests.map(x => JSON.stringify(x)).join('\n') + '\n', { flag: 'wx' });
  return { directory: dir, requests: p.requests.length, requestsHash: p.requestsHash, apiRequests: 0 };
}
