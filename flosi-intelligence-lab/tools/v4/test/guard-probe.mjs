// Run one probe per process. The guard must terminate it with status 1 and a
// counter of exactly one. This module imports the guard even without --import,
// so accidentally omitting the CLI preload can never send the probe to Groq.
import assert from 'node:assert/strict';
import { guardCounters } from '../offline-guard.mjs';

const name = process.argv[2];
const probes = {
  fetch: () => fetch('https://api.groq.com/openai/v1/chat/completions'),
  http: async () => (await import('node:http')).get('http://example.invalid'),
  https: async () => (await import('node:https')).request('https://example.invalid'),
  net: async () => (await import('node:net')).connect(443, 'example.invalid'),
  tls: async () => (await import('node:tls')).connect(443, 'example.invalid'),
  reserved: async () => (await import('node:fs/promises')).readFile(new URL('../probe-only/corpus/holdout.json', import.meta.url))
};
if (!Object.hasOwn(probes, name)) throw new Error('UNKNOWN_PROBE');
await assert.rejects(async () => probes[name](), /OFFLINE_NETWORK_BLOCKED|ORIGINAL_HOLDOUT_BLOCKED/u);
assert.deepEqual(guardCounters(), { networkAttempts: name === 'reserved' ? 0 : 1, reservedAttempts: name === 'reserved' ? 1 : 0 });
console.log(`Guard probe ${name}: blocked before IO; expected exit status 1.`);
