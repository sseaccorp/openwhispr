import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';

let networkAttempts=0, reservedAttempts=0;
globalThis.fetch=async()=>{networkAttempts++;throw new Error('External fetch forbidden in recovery tests');};
function guard(file) {
  const name=file instanceof URL?fileURLToPath(file):String(file);
  if (/(?:^|[/\\])corpus[/\\]holdout\.json$/u.test(name)) {reservedAttempts++;throw new Error('Reserved corpus forbidden in recovery tests');}
}
for(const name of ['readFile','readFileSync']) {
  const original=fs[name].bind(fs);
  fs[name]=(file,...args)=>{guard(file);return original(file,...args);};
}
const read=fsp.readFile.bind(fsp);
fsp.readFile=(file,...args)=>{guard(file);return read(file,...args);};
syncBuiltinESMExports();
process.on('exit',()=>{
  console.log(`Offline guard: external fetch attempts=${networkAttempts}; reserved corpus read attempts=${reservedAttempts}`);
  if(networkAttempts||reservedAttempts)process.exitCode=1;
});
