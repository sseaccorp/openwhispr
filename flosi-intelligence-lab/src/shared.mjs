import { createHash } from 'node:crypto';
import { readFile, mkdir, lstat, realpath, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const MODEL = 'openai/gpt-oss-120b';
export const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
export const DIMENSIONS = ['self_correction', 'fillers', 'meaning', 'names', 'numbers', 'negations', 'punctuation'];
export const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
export const normalize = text => text.normalize('NFC').toLocaleLowerCase('en').replace(/\s+/gu, ' ').trim();
export const csv = value => {
  let text = String(value ?? '');
  if (typeof value === 'string' && /^\s*[=+@-]/u.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
};
export const md = value => String(value ?? '').replace(/\|/g, '\\|').replace(/[\r\n]/g, ' ');

// Only known synthetic files can be sent. No arbitrary transcript path is accepted.
export async function loadCorpus(split, unlock = false) {
  if (!['dev', 'holdout', 'all'].includes(split)) throw new Error('split must be dev, holdout, or all');
  if (split !== 'dev' && !unlock) throw new Error('Reserved evaluation requires --unlock-holdout; freeze the prompt first.');
  const names = split === 'all' ? ['dev', 'holdout'] : [split];
  const manifest = await readJson(path.join(ROOT, 'corpus/manifest.json'));
  const cases = [];
  for (const name of names) {
    const raw = await readFile(path.join(ROOT, `corpus/${name}.json`), 'utf8');
    if (hash(raw) !== manifest.files[name]) throw new Error('Corpus hash mismatch; version the corpus and manifest deliberately.');
    const data = JSON.parse(raw);
    validateCases(data, name);
    cases.push(...data);
  }
  return { cases, corpusVersion: manifest.version, corpusHash: hash(manifest), split };
}

export function validateCases(cases, split) {
  const ids = new Set();
  for (const c of cases) {
    if (ids.has(c.id) || !/^(dev|hold)-(es|en)-\d{2}$/.test(c.id)) throw new Error('Invalid or duplicate case ID');
    ids.add(c.id);
    if (c.split !== split || !['es', 'en'].includes(c.language) || c.synthetic !== true ||
      typeof c.input !== 'string' || !c.input.trim() || !Array.isArray(c.expected) || !c.expected.length ||
      c.expected.some(x => typeof x !== 'string' || !x.trim()) || !c.rubric || !c.tags?.length || !c.checks?.length ||
      typeof c.ambiguous !== 'boolean') throw new Error(`Invalid case ${c.id}`);
    for (const check of c.checks) {
      if (!DIMENSIONS.includes(check.dimension) || !['contains', 'absent', 'terminal'].includes(check.kind) ||
        (check.kind !== 'terminal' && (!Array.isArray(check.values) || !check.values.length ||
          check.values.some(x => typeof x !== 'string' || !x)))) throw new Error(`Invalid check ${c.id}`);
    }
  }
}

export async function loadPrompt(id) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Invalid prompt ID');
  const raw = await readFile(path.join(ROOT, 'prompts', `${id}.json`), 'utf8');
  const prompt = JSON.parse(raw);
  if (prompt.id !== id || !prompt.version || typeof prompt.system !== 'string' || !prompt.system.trim()) throw new Error('Invalid prompt');
  return { ...prompt, sha256: hash(raw) };
}

export async function evaluatorHash() {
  const files=(await readdir(path.join(ROOT,'src'))).filter(f=>f.endsWith('.mjs')).sort();
  const contents=await Promise.all(files.map(f=>readFile(path.join(ROOT,'src',f),'utf8')));
  return hash(contents.map((content,i)=>[files[i],content]));
}

// Both input artifacts and output folders stay inside this independent lab.
export async function labPath(relative) {
  const absolute = path.resolve(ROOT, relative);
  if (absolute === path.resolve(ROOT) || !absolute.startsWith(path.resolve(ROOT) + path.sep)) throw new Error('Path must stay inside the lab');
  let cursor = absolute;
  while (cursor !== path.resolve(ROOT)) {
    try { if ((await lstat(cursor)).isSymbolicLink()) throw new Error('Symlinks are not allowed in artifact paths'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    cursor = path.dirname(cursor);
  }
  if (await realpath(ROOT) !== path.resolve(ROOT).replace(/[\\/]$/, '')) throw new Error('Lab root must not be a symlink');
  return absolute;
}

export async function newOutput(relative) {
  const absolute = await labPath(relative);
  // Never overwrite an existing result, source, or example folder.
  await mkdir(path.dirname(absolute), { recursive: true });
  await mkdir(absolute);
  return absolute;
}

export function redact(value, secret = '') {
  if (typeof value === 'string') {
    let safe = secret ? value.split(secret).join('[REDACTED]') : value;
    return safe.replace(/\b(?:gsk_|sk-)[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
      .replace(/Bearer\s+[^\s"<>]+/gi, 'Bearer [REDACTED]');
  }
  if (Array.isArray(value)) return value.map(x => redact(x, secret));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k,
    /authorization|api.?key|secret|token$/i.test(k) && !/tokens$/i.test(k) ? '[REDACTED]' : redact(v, secret)]));
  return value;
}
