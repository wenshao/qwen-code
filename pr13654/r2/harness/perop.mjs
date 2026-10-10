// Per-operation time-to-receipt from the fault-proxy ledger saved by s654.ts.
import fs from 'node:fs';
for (const f of process.argv.slice(2)) {
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  const L = j.ledger;
  const ops = new Map();
  for (const e of L) {
    if (!e.op) continue;
    const o = ops.get(e.op) ?? { start: Infinity, done: null, posts: 0, polls: 0 };
    if (e.method === 'POST' && !/\/recover$/.test(e.url)) { o.start = Math.min(o.start, e.t); o.posts++; if (e.state === 'receipt' || e.state === 'SUCCEEDED' || (e.status === 200 && !e.state)) o.done = e.t + e.ms; }
    if (e.method === 'GET' && /\/operations\//.test(e.url)) { o.polls++; if (e.state === 'SUCCEEDED') o.done = e.t + e.ms; }
    ops.set(e.op, o);
  }
  const d = [...ops.entries()].filter(([, o]) => o.done).map(([k, o]) => [k, o.done - o.start]);
  const seg = d.filter(([k]) => k.startsWith('seg-')).map(([, v]) => v).sort((a, b) => a - b);
  const all = d.map(([, v]) => v);
  const med = (a) => a[Math.floor(a.length / 2)];
  console.log(`${j.tag}: ops ${d.length}, sum time-to-receipt ${all.reduce((a, b) => a + b, 0)} ms; segment median ${med(seg)} ms (n=${seg.length}); seal/prefix/finish ${d.filter(([k]) => /^(seal|prefix|finish)/.test(k)).map(([k, v]) => `${k.split('-')[0]}:${v}`).join(' ')}`);
}
