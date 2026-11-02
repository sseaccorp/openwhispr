import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';

let networkAttempts = 0, reservedAttempts = 0;
const denyNetwork = () => { networkAttempts++; throw new Error('OFFLINE_NETWORK_BLOCKED'); };
globalThis.fetch = async () => denyNetwork();
for (const module of [http, https]) for (const name of ['request', 'get']) module[name] = denyNetwork;
for (const name of ['connect', 'createConnection']) net[name] = denyNetwork;
net.Socket.prototype.connect = denyNetwork;
tls.connect = denyNetwork;
const originalRealpath = fs.realpathSync.bind(fs);
function guard(file) {
  if (typeof file === 'number') return;
  let name = file instanceof URL ? fileURLToPath(file) : String(file);
  try { name = originalRealpath(name); } catch { /* Missing paths are handled by fs. */ }
  if (/(?:^|[/\\])corpus[/\\]holdout\.json$/u.test(name)) {
    reservedAttempts++; throw new Error('ORIGINAL_HOLDOUT_BLOCKED');
  }
}
for (const name of ['readFile', 'readFileSync', 'open', 'openSync', 'createReadStream']) {
  const original = fs[name].bind(fs);
  fs[name] = (file, ...args) => { guard(file); return original(file, ...args); };
}
for (const name of ['readFile', 'open']) {
  const original = fsp[name].bind(fsp);
  fsp[name] = async (file, ...args) => { guard(file); return original(file, ...args); };
}
syncBuiltinESMExports();
export const guardCounters = () => ({ networkAttempts, reservedAttempts });
process.on('exit', () => {
  console.log(`V4 offline guard: ${JSON.stringify(guardCounters())}`);
  if (networkAttempts || reservedAttempts) process.exitCode = 1;
});
