import fs from 'node:fs';
const dir = '/Users/wenshao/git/rig-10357/out';
const scen = process.argv[2];
for (const v of ['base', 'head']) {
  const r = JSON.parse(fs.readFileSync(`${dir}/${v}-${scen}.json`, 'utf8'));
  const A = r.clients.find((c) => c.name === 'A');
  const B = r.clients.find((c) => c.name === 'B');
  // merge timeline
  const ts = [...new Set([...A.history, ...B.history].map((h) => h.t))].sort((a, b) => a - b);
  const at = (hist, t) => { let last = 0; for (const h of hist) { if (h.t <= t) last = h.len; } return last; };
  console.log(`--- ${v} (${scen})`);
  let firstRepair = null;
  const offlineAt = A.history.find((h) => h.via === 'disconnect')?.t;
  const onlineAt = A.history.find((h) => h.via === 'reconnect')?.t;
  console.log(`   A offline ${offlineAt}ms -> online ${onlineAt}ms`);
  for (const t of ts) {
    const a = at(A.history, t), b = at(B.history, t);
    if (onlineAt && t > onlineAt && firstRepair === null && a === b && a > 0) firstRepair = t;
  }
  const samples = ts.filter((t) => t % 1 === 0).filter((_, i) => true);
  const marks = [offlineAt, onlineAt, onlineAt + 1000, onlineAt + 3000, onlineAt + 6000, onlineAt + 9000, onlineAt + 12000].filter((x) => x != null);
  for (const m of marks) console.log(`   t=${String(m).padStart(6)}ms  A=${String(at(A.history, m)).padStart(5)}  B=${String(at(B.history, m)).padStart(5)}  lag=${at(B.history, m) - at(A.history, m)}`);
  console.log(`   first moment A == B after reconnect: ${firstRepair === null ? 'never (until terminal)' : firstRepair + 'ms (' + (firstRepair - onlineAt) + 'ms after reconnect)'}`);
  const viaAfter = A.history.filter((h) => onlineAt && h.t > onlineAt).map((h) => `${h.t}:${h.via}:${h.len}`);
  console.log(`   A events after reconnect: ${viaAfter.slice(0, 14).join(' ')}`);
}
