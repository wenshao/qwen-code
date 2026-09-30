// show.cjs <run-dir> <name...> -- compact view of RESULT lines
const fs = require('fs');
const [run, ...names] = process.argv.slice(2);
for (const name of names) {
  const file = `${run}/${name}.log`;
  if (!fs.existsSync(file)) { console.log(`## ${name}: NO LOG`); continue; }
  const text = fs.readFileSync(file, 'utf8');
  const line = text.split('\n').filter((l) => l.startsWith('RESULT ')).at(-1);
  if (!line) { console.log(`## ${name}: NO RESULT\n` + text.split('\n').slice(-12).join('\n').slice(0, 1500)); continue; }
  const r = JSON.parse(line.replace(/^RESULT \S+ /, ''));
  console.log(`## ${name} [${r.arm}] servers=${r.servers ?? ''} fault=${r.fault ?? r.mode ?? ''} ${r.acquireFault ? 'acquire=' + r.acquireFault : ''} warm=${r.warm} final=${r.final} lease=${r.lease}`);
  for (const key of ['detach', 'tries', 'oldWriter', 'newWriter', 'B_detach', 'oldStore', 'newStoreSameHarness', 'newStoreNewHarness'])
    for (const d of r[key] ?? []) {
      console.log(`  ${key}#${d.n ?? ''} ${d.at ?? ''} → ${d.status ?? JSON.stringify(d)} holder=${d.holder ?? d.holderStillA} runtime=${d.runtime ?? ''} records=${d.records ?? ''}` + (d.pipeHolderAlive !== undefined ? ` server=${d.serverAlive} pipe=${d.pipeHolderAlive}` : ''));
      if (d.timeline) console.log('     ' + d.timeline.join(' | '));
      if (d.releaseOps?.length) console.log('     ops: ' + d.releaseOps.join(', '));
      if (d.storeErrors?.length) console.log('     storeErrors: ' + d.storeErrors.join(' ;; '));
    }
  for (const key of ['pipeClosedAt', 'reload', 'newWriterLoad', 'sameReleaseIdentity', 'owners', 'A_prompt', 'B_prompt_while_A_holds', 'A_detach', 'statusWhileStuck'])
    if (r[key] !== undefined) console.log(`  ${key}: ${JSON.stringify(r[key])}`);
}
