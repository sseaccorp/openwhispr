import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { verifiedContext, prepare } from './core.mjs';
import { runControlled, compareControlled } from './run.mjs';

export async function main(args = process.argv.slice(2)) {
  const { values: v, positionals: p } = parseArgs({ args, allowPositionals: true, strict: true, options: {
    corpus: { type: 'string' }, prompt: { type: 'string' }, ids: { type: 'string' }, limit: { type: 'string' }, out: { type: 'string' },
    baseline: { type: 'string' }, candidate: { type: 'string' }, 'allow-paid-api': { type: 'boolean' },
    'prices-verified': { type: 'boolean' }, 'max-requests': { type: 'string' }, 'max-cost-usd': { type: 'string' }, 'interval-seconds': { type: 'string' }
  } });
  const common = ['corpus', 'prompt', 'ids', 'limit', 'out'];
  const allowed = { verify: [], prepare: common, run: [...common, 'allow-paid-api', 'prices-verified', 'max-requests', 'max-cost-usd', 'interval-seconds'], compare: ['baseline', 'candidate', 'out'] }[p[0]];
  if (p.length !== 1 || !allowed || Object.keys(v).some(k => !allowed.includes(k))) throw new Error('COMMAND_OR_OPTIONS');
  const options = Object.fromEntries(Object.entries(v).map(([k, val]) => [k.replace(/-([a-z])/gu, (_, c) => c.toUpperCase()), val]));
  if (p[0] === 'verify') {
    const ctx = await verifiedContext();
    console.log(JSON.stringify({ v4: ctx.prompts.v4.sha256, historical: ctx.development.length, challenge: ctx.challenge.length, apiRequests: 0 }));
  } else if (p[0] === 'prepare') console.log(JSON.stringify(await prepare(options)));
  else if (p[0] === 'compare') {
    if (!v.baseline || !v.candidate || !v.out) throw new Error('COMPARISON_PATHS_REQUIRED');
    const result = await compareControlled(v.baseline, v.candidate, v.out);
    console.log(JSON.stringify({ directory: result.directory, pairs: result.pairs.length, apiRequests: 0 }));
  } else {
    const result = await runControlled(options);
    console.log(JSON.stringify({ directory: result.directory, state: result.manifest.state, apiRequests: result.manifest.apiRequests }));
    if (result.manifest.state !== 'complete') process.exitCode = 2;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => {
  console.error('V4 command failed. Check frozen files, explicit options, local prices/key, complete comparable runs and unique output paths. No provider error body or secret was logged.');
  process.exitCode = 1;
});
