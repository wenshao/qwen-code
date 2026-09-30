// show-r78.cjs <file...> -- compact view of r7 (drained window) and r8 (Broker restart) results
const fs = require('fs');
for (const f of process.argv.slice(2)) {
  const line = fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.startsWith('RESULT ')).at(-1);
  if (!line) { console.log(`## ${f}: NO RESULT`); continue; }
  const r = JSON.parse(line.replace(/^RESULT \S+ /, ''));
  console.log(`## ${f.split('/').slice(-2).join('/')} [${r.arm}]`);
  const show = (d) => { console.log(`  ${d.n} → ${d.status} holder=${d.holder} runtime=${d.runtime} records=${d.records}`); console.log('     ' + (d.timeline ?? []).join(' | ')); };
  if (r.afterRestart) {
    console.log(`  fault=${r.fault} restart=${r.restart} servers=${r.servers} warm=${r.warm} reloadFirst=${r.reloadFirst ?? '-'} reload=${r.reload ?? '-'}`);
    (r.beforeRestart ?? []).forEach(show);
    if (r.brokerRestart) console.log('  Broker restart: ' + JSON.stringify(r.brokerRestart));
    r.afterRestart.forEach(show);
    if (r.promptWhileStuck) console.log('  prompt while stuck: ' + JSON.stringify(r.promptWhileStuck));
    console.log(`  final=${r.final} lease=${r.lease}`);
  } else {
    for (const [k, v] of Object.entries(r)) console.log(`  ${k}: ${JSON.stringify(v).slice(0, 900)}`);
  }
}
